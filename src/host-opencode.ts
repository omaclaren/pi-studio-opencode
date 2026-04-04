import { createOpencode, createOpencodeClient, type Event, type Message, type Part } from "@opencode-ai/sdk";
import type { OpencodeClient as V2OpencodeClient } from "@opencode-ai/sdk/v2";
import { setTimeout as sleep } from "node:timers/promises";
import { StudioCore } from "./studio-core.js";
import type { StudioHost, StudioHostCapabilities, StudioHostHistoryItem, StudioHostListener, StudioHostState } from "./studio-host-types.js";

export type OpencodeMessageTokenUsage = {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
};

export type OpencodeStudioHostTelemetryEvent =
  | {
    type: "submission.dispatched";
    at: number;
    submission: StudioHostHistoryItem;
  }
  | {
    type: "backend.status";
    at: number;
    status: string | null;
  }
  | {
    type: "user.message.updated";
    at: number;
    messageId: string;
    providerID?: string;
    modelID?: string;
    agent?: string;
    variant?: string;
  }
  | {
    type: "assistant.message.updated";
    at: number;
    messageId: string;
    providerID?: string;
    modelID?: string;
    agent?: string;
    variant?: string;
    tokenUsage?: OpencodeMessageTokenUsage;
  }
  | {
    type: "assistant.part.updated";
    at: number;
    messageId: string;
    partId: string;
    partType: string;
    text?: string;
  }
  | {
    type: "assistant.part.delta";
    at: number;
    messageId: string;
    partId: string;
    field: string;
    delta: string;
    partType?: string;
  }
  | {
    type: "session.idle";
    at: number;
  }
  | {
    type: "submission.completed";
    at: number;
    historyItem: StudioHostHistoryItem;
  };

export type OpencodeStudioHostOptions = {
  directory: string;
  baseUrl?: string;
  clientV2?: V2OpencodeClient;
  sessionId?: string;
  title?: string;
  eventLogger?: (line: string) => void;
  telemetryListener?: (event: OpencodeStudioHostTelemetryEvent) => void;
};

export type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

type SessionStatusRecord = {
  id: string;
  status?: {
    type?: string;
  } | null;
};

type SessionStatusMap = Record<string, { type?: string } | null | undefined>;

const SESSION_POLL_INTERVAL_MS = 400;

export type ObservedSessionMessage = {
  id: string;
  role: Message["role"];
  created: number;
  completed?: number;
  error?: string;
  text: string;
  thinking?: string;
  parentMessageId?: string | null;
};

export type NormalizedMessage = ObservedSessionMessage;

function finiteTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

export function extractMessageVariant(info: unknown): string | undefined {
  const raw = typeof (info as { variant?: unknown })?.variant === "string"
    ? (info as { variant: string }).variant.trim()
    : "";
  return raw || undefined;
}

export function extractMessageTokenUsage(info: unknown): OpencodeMessageTokenUsage | undefined {
  const tokens = (info as { tokens?: unknown })?.tokens;
  if (!tokens || typeof tokens !== "object") return undefined;

  const usage: OpencodeMessageTokenUsage = {
    total: finiteTokenCount((tokens as { total?: unknown }).total),
    input: finiteTokenCount((tokens as { input?: unknown }).input),
    output: finiteTokenCount((tokens as { output?: unknown }).output),
    reasoning: finiteTokenCount((tokens as { reasoning?: unknown }).reasoning),
  };

  return usage.total != null || usage.input != null || usage.output != null || usage.reasoning != null
    ? usage
    : undefined;
}

export type ObservedExternalResponse = {
  userMessageId: string | null;
  promptText: string;
  submittedAt: number;
  response: ObservedSessionMessage;
  consumedAssistantMessageIds: string[];
};

type StartedServer = {
  url: string;
  close(): void;
};

const OPENCODE_HOST_CAPABILITIES: StudioHostCapabilities = {
  steeringMode: "adapter-queue",
  stopSupported: true,
};

export function normalizeSessionMessageRecord(record: SessionMessageRecord): NormalizedMessage {
  const text = record.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  const thinking = record.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  const parentMessageId = typeof (record.info as { parentID?: unknown }).parentID === "string"
    ? (record.info as { parentID: string }).parentID
    : undefined;

  return {
    id: record.info.id,
    role: record.info.role,
    created: record.info.time.created,
    completed: record.info.role === "assistant" ? record.info.time.completed : undefined,
    error: record.info.role === "assistant" && record.info.error
      ? `${record.info.error.name}: ${record.info.error.data.message ?? "unknown error"}`
      : undefined,
    text,
    thinking,
    parentMessageId,
  };
}

export function compareObservedMessages(a: ObservedSessionMessage, b: ObservedSessionMessage): number {
  if (a.created !== b.created) return a.created - b.created;
  if (a.completed !== b.completed) return (a.completed ?? a.created) - (b.completed ?? b.created);
  if (a.role === b.role) return a.id.localeCompare(b.id);
  return a.role === "user" ? -1 : 1;
}

export function sortObservedMessages(messages: ReadonlyArray<ObservedSessionMessage>): ObservedSessionMessage[] {
  return [...messages].sort(compareObservedMessages);
}

export function hasObservedAssistantContent(message: ObservedSessionMessage): boolean {
  return message.role === "assistant" && Boolean(message.text || message.thinking || message.error);
}

export function resolveObservedRootUserMessage(
  message: ObservedSessionMessage,
  messageById: ReadonlyMap<string, ObservedSessionMessage>,
): ObservedSessionMessage | null {
  if (message.role === "user") return message;

  const visited = new Set<string>();
  let parentMessageId = message.parentMessageId ?? null;
  while (parentMessageId && !visited.has(parentMessageId)) {
    visited.add(parentMessageId);
    const parent = messageById.get(parentMessageId);
    if (!parent) return null;
    if (parent.role === "user") return parent;
    parentMessageId = parent.parentMessageId ?? null;
  }

  return null;
}

export function selectLatestObservedAssistantResponse(
  messages: ReadonlyArray<ObservedSessionMessage>,
): ObservedSessionMessage | null {
  const ordered = sortObservedMessages(messages);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const candidate = ordered[i];
    if (candidate && hasObservedAssistantContent(candidate)) {
      return candidate;
    }
  }
  return ordered[ordered.length - 1] ?? null;
}

export function collectObservedAssistantResponsesForUser(
  messages: ReadonlyArray<ObservedSessionMessage>,
  matchedAssistantIds: ReadonlySet<string>,
  userMessageId: string,
): ObservedSessionMessage[] {
  const ordered = sortObservedMessages(messages);
  const messageById = new Map(ordered.map((message) => [message.id, message]));
  return ordered.filter((message) => (
    message.role === "assistant"
    && !matchedAssistantIds.has(message.id)
    && resolveObservedRootUserMessage(message, messageById)?.id === userMessageId
  ));
}

export function eventSessionId(event: Event): string | null {
  const props = event.properties as Record<string, unknown> | undefined;
  if (!props) return null;
  if (typeof props.sessionID === "string") return props.sessionID;
  if (event.type === "message.updated") {
    const info = props.info as { sessionID?: string } | undefined;
    return typeof info?.sessionID === "string" ? info.sessionID : null;
  }
  if (event.type === "message.part.updated") {
    const part = props.part as { sessionID?: string } | undefined;
    return typeof part?.sessionID === "string" ? part.sessionID : null;
  }
  const deltaEvent = event as unknown as { type?: string; properties?: unknown };
  if (isMessagePartDeltaEvent(deltaEvent)) {
    return typeof deltaEvent.properties.sessionID === "string" ? deltaEvent.properties.sessionID : null;
  }
  return null;
}

export function summarizeEvent(event: Event): string {
  const props = event.properties as Record<string, unknown> | undefined;
  if (event.type === "session.status") {
    const status = props?.status as { type?: string } | undefined;
    return `${event.type} status=${status?.type ?? "unknown"}`;
  }
  if (event.type === "message.updated") {
    const info = props?.info as { role?: string; id?: string } | undefined;
    return `${event.type} role=${info?.role ?? "?"} message=${info?.id ?? "?"}`;
  }
  if (event.type === "message.part.updated") {
    const part = props?.part as { type?: string; id?: string } | undefined;
    return `${event.type} partType=${part?.type ?? "?"} part=${part?.id ?? "?"}`;
  }
  const deltaEvent = event as unknown as { type?: string; properties?: unknown };
  if (isMessagePartDeltaEvent(deltaEvent)) {
    return `${deltaEvent.type} field=${typeof deltaEvent.properties.field === "string" ? deltaEvent.properties.field : "?"} part=${typeof deltaEvent.properties.partID === "string" ? deltaEvent.properties.partID : "?"}`;
  }
  return event.type;
}

export function extractAssistantPartText(part: Part): string | undefined {
  if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
    return part.text;
  }
  return undefined;
}

function extractUserPromptText(record: SessionMessageRecord): string {
  return record.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

export function collectObservedExternalResponses(
  messages: ReadonlyArray<ObservedSessionMessage>,
  matchedAssistantIds: ReadonlySet<string>,
): ObservedExternalResponse[] {
  const ordered = sortObservedMessages(messages);
  const messageById = new Map(ordered.map((message) => [message.id, message]));
  const grouped = new Map<string, {
    order: number;
    userMessageId: string | null;
    promptText: string;
    submittedAt: number;
    assistants: ObservedSessionMessage[];
  }>();
  let latestUser: ObservedSessionMessage | null = null;
  let nextOrder = 0;

  for (const message of ordered) {
    if (message.role === "user") {
      latestUser = message;
      continue;
    }
    if (message.role !== "assistant") continue;
    if (matchedAssistantIds.has(message.id)) continue;
    if (!hasObservedAssistantContent(message)) continue;

    const rootedUser = resolveObservedRootUserMessage(message, messageById);
    const observedUser = rootedUser ?? latestUser;
    const key = observedUser?.id ? `user:${observedUser.id}` : `orphan:${message.id}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        order: nextOrder++,
        userMessageId: observedUser?.id ?? null,
        promptText: observedUser?.text ?? "",
        submittedAt: observedUser?.created ?? message.created,
        assistants: [],
      };
      grouped.set(key, group);
    }
    group.assistants.push(message);
  }

  return [...grouped.values()]
    .sort((a, b) => a.order - b.order)
    .map((group) => {
      const response = selectLatestObservedAssistantResponse(group.assistants);
      if (!response) return null;
      return {
        userMessageId: group.userMessageId,
        promptText: group.promptText,
        submittedAt: group.submittedAt,
        response,
        consumedAssistantMessageIds: group.assistants.map((assistant) => assistant.id),
      } satisfies ObservedExternalResponse;
    })
    .filter((value): value is ObservedExternalResponse => Boolean(value));
}

export function isMessagePartDeltaEvent(event: { type?: string; properties?: unknown }): event is {
  type: "message.part.delta";
  properties: {
    sessionID?: string;
    messageID?: string;
    partID?: string;
    field?: string;
    delta?: string;
  };
} {
  return event.type === "message.part.delta";
}

export class OpencodeStudioHost implements StudioHost {
  private readonly options: OpencodeStudioHostOptions;
  private readonly listeners = new Set<StudioHostListener>();
  private readonly baselineMessageIds = new Set<string>();
  private readonly matchedUserIds = new Set<string>();
  private readonly matchedAssistantIds = new Set<string>();
  private readonly partTypesById = new Map<string, string>();
  private readonly messageRolesById = new Map<string, Message["role"]>();
  private readonly messageCreatedAtById = new Map<string, number>();
  private readonly partTextById = new Map<string, string>();
  private readonly core = new StudioCore({ backend: "opencode" });

  private client!: ReturnType<typeof createOpencodeClient>;
  private clientV2: V2OpencodeClient | null = null;
  private startedServer: StartedServer | null = null;
  private session!: { id: string; title?: string };
  private eventAbortController = new AbortController();
  private eventLoop: Promise<void> | null = null;
  private pollLoop: Promise<void> | null = null;
  private handlingIdle = false;
  private closed = false;

  static async create(options: OpencodeStudioHostOptions): Promise<OpencodeStudioHost> {
    const host = new OpencodeStudioHost(options);
    await host.initialize();
    return host;
  }

  private constructor(options: OpencodeStudioHostOptions) {
    this.options = options;
  }

  getState(): StudioHostState {
    return this.core.getState();
  }

  getCapabilities(): StudioHostCapabilities {
    return { ...OPENCODE_HOST_CAPABILITIES };
  }

  getHistory(): StudioHostHistoryItem[] {
    return this.core.getHistory();
  }

  subscribe(listener: StudioHostListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startRun(prompt: string): Promise<void> {
    this.assertReady();
    const submission = this.core.startRun(prompt);
    this.core.noteBackendStatus("busy");
    this.emitState();
    await this.dispatchSubmission(submission);
  }

  async queueSteer(prompt: string): Promise<void> {
    this.assertReady();
    this.core.queueSteer(prompt);
    this.emitState();
  }

  async stop(): Promise<void> {
    this.assertReady();
    const active = this.core.getActiveSubmission();
    if (!active) return;

    this.core.markStopRequested({ clearQueuedSteers: true, backendStatus: "aborting" });
    this.emitState();

    if (this.clientV2) {
      await this.clientV2.session.abort({
        sessionID: this.session.id,
        directory: this.options.directory,
      }, {
        throwOnError: true,
      });
      return;
    }

    await this.client.session.abort({
      path: { id: this.session.id },
      query: { directory: this.options.directory },
      throwOnError: true,
    });
  }

  async waitUntilIdle(timeoutMs = 60_000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = this.core.getState();
      if (state.runState === "idle" && !this.core.hasActiveChain() && !state.activePromptId && state.queueLength === 0) {
        return;
      }
      await sleep(100);
    }
    throw new Error("Timed out waiting for host to become idle.");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.core.markClosed();
    this.emitState();
    this.eventAbortController.abort();
    try {
      await this.eventLoop;
    } catch {
      // ignore shutdown races
    }
    try {
      await this.pollLoop;
    } catch {
      // ignore shutdown races
    }
    if (this.startedServer) {
      this.startedServer.close();
      this.startedServer = null;
    }
  }

  private async initialize(): Promise<void> {
    if (this.options.clientV2) {
      this.clientV2 = this.options.clientV2;
      this.options.eventLogger?.("[host] using live TUI client bridge");
    } else if (this.options.baseUrl) {
      this.options.eventLogger?.(`[host] connecting via baseUrl ${this.options.baseUrl}`);
      this.client = createOpencodeClient({
        baseUrl: this.options.baseUrl,
        directory: this.options.directory,
      });
    } else {
      const runtime = await createOpencode({});
      this.client = runtime.client;
      this.startedServer = runtime.server;
    }

    this.session = await this.createOrReuseSession();
    this.core.setSessionInfo({ sessionId: this.session.id, sessionTitle: this.session.title });
    this.emitState();

    const initialMessages = await this.fetchSessionMessages();
    for (const message of initialMessages) {
      this.baselineMessageIds.add(message.info.id);
      this.messageRolesById.set(message.info.id, message.info.role);
      this.messageCreatedAtById.set(message.info.id, message.info.time.created);
      for (const part of message.parts) {
        this.partTypesById.set(part.id, part.type);
      }
      this.emitModelTelemetryForMessage(message.info);
    }

    const events = this.clientV2
      ? await this.clientV2.event.subscribe({
        directory: this.options.directory,
      }, {
        signal: this.eventAbortController.signal,
        onSseError: (error) => {
          if (this.eventAbortController.signal.aborted) return;
          this.fail(error instanceof Error ? error : new Error(String(error)));
        },
      })
      : await this.client.event.subscribe({
        query: { directory: this.options.directory },
        signal: this.eventAbortController.signal,
        onSseError: (error) => {
          if (this.eventAbortController.signal.aborted) return;
          this.fail(error instanceof Error ? error : new Error(String(error)));
        },
      });

    this.eventLoop = (async () => {
      for await (const event of events.stream as AsyncIterable<Event>) {
        if (this.closed) return;
        if (eventSessionId(event) !== this.session.id && event.type !== "server.connected") continue;
        this.options.eventLogger?.(`[event] ${summarizeEvent(event)}`);
        await this.handleEvent(event);
      }
    })().catch((error: unknown) => {
      if (this.eventAbortController.signal.aborted) return;
      this.fail(error instanceof Error ? error : new Error(String(error)));
    });

    this.pollLoop = (async () => {
      while (!this.closed && !this.eventAbortController.signal.aborted) {
        try {
          await this.pollSessionState();
        } catch (error) {
          if (!this.eventAbortController.signal.aborted) {
            this.options.eventLogger?.(`[poll] ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        await sleep(SESSION_POLL_INTERVAL_MS);
      }
    })();
  }

  private async createOrReuseSession(): Promise<{ id: string; title?: string }> {
    if (this.options.sessionId) {
      const existing = this.clientV2
        ? await this.clientV2.session.get({
          sessionID: this.options.sessionId,
          directory: this.options.directory,
        }, {
          throwOnError: true,
        })
        : await this.client.session.get({
          path: { id: this.options.sessionId },
          query: { directory: this.options.directory },
          throwOnError: true,
        });
      if (!existing.data) {
        throw new Error(`Session not found: ${this.options.sessionId}`);
      }
      return existing.data as { id: string; title?: string };
    }

    const created = this.clientV2
      ? await this.clientV2.session.create({
        directory: this.options.directory,
        title: this.options.title ?? "π Studio",
      }, {
        throwOnError: true,
      })
      : await this.client.session.create({
        query: { directory: this.options.directory },
        body: { title: this.options.title ?? "π Studio" },
        throwOnError: true,
      });
    if (!created.data) {
      throw new Error("Session creation returned no data.");
    }
    return created.data as { id: string; title?: string };
  }

  private emitModelTelemetryForMessage(info: Message): void {
    const at = info.role === "assistant"
      ? (info.time.completed ?? info.time.created)
      : info.time.created;

    if (info.role === "user") {
      this.emitTelemetry({
        type: "user.message.updated",
        at,
        messageId: info.id,
        providerID: info.model?.providerID,
        modelID: info.model?.modelID,
        agent: info.agent,
        variant: extractMessageVariant(info),
      });
      return;
    }

    this.emitTelemetry({
      type: "assistant.message.updated",
      at,
      messageId: info.id,
      providerID: info.providerID,
      modelID: info.modelID,
      agent: typeof ((info as unknown) as { agent?: unknown }).agent === "string"
        ? ((info as unknown) as { agent: string }).agent
        : undefined,
      variant: extractMessageVariant(info),
      tokenUsage: extractMessageTokenUsage(info),
    });
  }

  private async handleEvent(event: Event): Promise<void> {
    if (event.type === "session.status") {
      const props = event.properties as { status?: { type?: string } };
      const status = props.status?.type ?? null;
      this.core.noteBackendStatus(status);
      this.emitTelemetry({ type: "backend.status", at: Date.now(), status });
      this.emitState();
      return;
    }

    if (event.type === "message.updated") {
      const props = event.properties as { info?: Message };
      if (props.info && typeof props.info.id === "string" && typeof props.info.role === "string") {
        this.messageRolesById.set(props.info.id, props.info.role);
        this.messageCreatedAtById.set(props.info.id, props.info.time.created);
        this.emitModelTelemetryForMessage(props.info);
        if (props.info.role === "user") {
          await this.observeExternalPromptFromMessage(props.info);
        }
      }
      return;
    }

    if (event.type === "message.part.updated") {
      const props = event.properties as { part?: Part; time?: number };
      const part = props.part;
      if (part) {
        this.partTypesById.set(part.id, part.type);
        if (
          part.type === "text"
          && typeof part.messageID === "string"
          && this.messageRolesById.get(part.messageID) === "user"
        ) {
          this.observeExternalPrompt({
            promptText: part.text,
            userMessageId: part.messageID,
            submittedAt: this.messageCreatedAtById.get(part.messageID) ?? props.time,
          });
        }
        if (typeof part.messageID === "string" && this.messageRolesById.get(part.messageID) === "assistant") {
          this.emitTelemetry({
            type: "assistant.part.updated",
            at: Date.now(),
            messageId: part.messageID,
            partId: part.id,
            partType: part.type,
            text: extractAssistantPartText(part),
          });
        }
      }
      return;
    }

    const deltaEvent = event as unknown as { type?: string; properties?: unknown };
    if (isMessagePartDeltaEvent(deltaEvent)) {
      const props = deltaEvent.properties;
      if (
        typeof props.messageID === "string"
        && typeof props.partID === "string"
        && typeof props.field === "string"
        && typeof props.delta === "string"
        && this.messageRolesById.get(props.messageID) === "assistant"
      ) {
        this.emitTelemetry({
          type: "assistant.part.delta",
          at: Date.now(),
          messageId: props.messageID,
          partId: props.partID,
          field: props.field,
          delta: props.delta,
          partType: this.partTypesById.get(props.partID),
        });
      }
      return;
    }

    if (event.type === "session.idle") {
      this.core.noteBackendStatus("idle");
      this.emitTelemetry({ type: "session.idle", at: Date.now() });
      this.emitState();
      await this.handleSessionIdle();
    }
  }

  private async handleSessionIdle(): Promise<void> {
    if (this.handlingIdle || this.closed) return;
    this.handlingIdle = true;
    try {
      const active = this.core.getActiveSubmission();
      if (active) {
        await this.finalizeActiveSubmission(active);
      }

      const next = this.core.activateNextQueuedSteer();
      if (next) {
        this.emitState();
        await this.dispatchSubmission(next);
        return;
      }

      const observed = await this.reconcileObservedExternalResponses();
      this.core.noteBackendIdle();
      for (const item of observed) {
        this.emitTelemetry({ type: "submission.completed", at: item.completedAt ?? Date.now(), historyItem: item });
      }
      this.emitState();
    } finally {
      this.handlingIdle = false;
    }
  }

  private async dispatchSubmission(submission: StudioHostHistoryItem): Promise<void> {
    this.emitTelemetry({ type: "submission.dispatched", at: Date.now(), submission });
    this.emitState();
    try {
      if (this.clientV2) {
        await this.clientV2.session.promptAsync({
          sessionID: this.session.id,
          directory: this.options.directory,
          parts: [{ type: "text", text: submission.promptText }],
        }, {
          throwOnError: true,
        });
      } else {
        await this.client.session.promptAsync({
          path: { id: this.session.id },
          query: { directory: this.options.directory },
          body: {
            parts: [{ type: "text", text: submission.promptText }],
          },
          throwOnError: true,
        });
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private observeExternalPrompt(input: {
    promptText?: string | null;
    userMessageId?: string | null;
    submittedAt?: number;
  }): void {
    const userMessageId = typeof input.userMessageId === "string" ? input.userMessageId : null;
    if (!userMessageId) return;
    if (this.baselineMessageIds.has(userMessageId) || this.matchedUserIds.has(userMessageId)) return;

    const observed = this.core.observeExternalPrompt({
      promptText: input.promptText,
      userMessageId,
      submittedAt: input.submittedAt,
    });
    if (!observed) return;

    this.emitTelemetry({
      type: "submission.dispatched",
      at: observed.submittedAt,
      submission: observed,
    });
    this.emitState();
  }

  private async observeExternalPromptFromMessage(info: Message): Promise<void> {
    if (info.role !== "user") return;
    if (this.baselineMessageIds.has(info.id) || this.matchedUserIds.has(info.id)) return;

    const record = await this.fetchSessionMessage(info.id).catch(() => null);
    if (!record) return;
    this.observeExternalPrompt({
      promptText: extractUserPromptText(record),
      userMessageId: info.id,
      submittedAt: info.time.created,
    });
  }

  private async finalizeActiveSubmission(active: StudioHostHistoryItem): Promise<void> {
    const bound = await this.bindSubmissionToMessages(active);
    this.completeActiveSubmissionFromBound(active, bound);
  }

  private completeActiveSubmissionFromBound(active: StudioHostHistoryItem, bound: {
    userMessageId: string | null;
    response: NormalizedMessage | null;
    consumedAssistantMessageIds: string[];
  }): void {
    if (bound.userMessageId) {
      this.matchedUserIds.add(bound.userMessageId);
      this.core.noteUserMessage({ text: active.promptText, messageId: bound.userMessageId });
    }
    for (const assistantMessageId of bound.consumedAssistantMessageIds) {
      this.matchedAssistantIds.add(assistantMessageId);
    }
    const stopping = this.core.getState().runState === "stopping";
    const completed = this.core.completeActiveResponse({
      responseMessageId: bound.response?.id ?? null,
      responseText: bound.response?.text ?? "",
      responseThinking: bound.response?.thinking ?? "",
      responseError: bound.response?.error ?? (stopping ? "Aborted" : undefined),
      completedAt: bound.response?.completed ?? Date.now(),
    });
    if (completed) {
      this.emitTelemetry({ type: "submission.completed", at: Date.now(), historyItem: completed });
    }
    this.emitState();
  }

  private resolveSubmissionFromMessages(
    active: StudioHostHistoryItem,
    messages: ReadonlyArray<NormalizedMessage>,
  ): {
    userMessageId: string | null;
    response: NormalizedMessage | null;
    consumedAssistantMessageIds: string[];
  } {
    let userMessageId: string | null = active.userMessageId ?? null;

    if (!userMessageId) {
      const userMatch = [...messages].reverse().find((message) => (
        message.role === "user"
        && !this.matchedUserIds.has(message.id)
        && message.text === active.promptText
        && message.created >= active.submittedAt - 10_000
      ));
      if (userMatch) {
        userMessageId = userMatch.id;
      }
    }

    if (userMessageId) {
      const linkedAssistantMessages = collectObservedAssistantResponsesForUser(messages, this.matchedAssistantIds, userMessageId);
      return {
        userMessageId,
        response: selectLatestObservedAssistantResponse(linkedAssistantMessages),
        consumedAssistantMessageIds: linkedAssistantMessages.map((message) => message.id),
      };
    }

    const assistantCandidates = sortObservedMessages(messages).filter((message) => (
      message.role === "assistant"
      && !this.matchedAssistantIds.has(message.id)
      && message.created >= active.submittedAt - 10_000
    ));
    return {
      userMessageId,
      response: selectLatestObservedAssistantResponse(assistantCandidates),
      consumedAssistantMessageIds: assistantCandidates.map((message) => message.id),
    };
  }

  private async bindSubmissionToMessages(active: StudioHostHistoryItem): Promise<{
    userMessageId: string | null;
    response: NormalizedMessage | null;
    consumedAssistantMessageIds: string[];
  }> {
    const deadline = Date.now() + 4000;
    let response: NormalizedMessage | null = null;
    let consumedAssistantMessageIds: string[] = [];
    let userMessageId: string | null = active.userMessageId ?? null;

    while (Date.now() < deadline) {
      const messages = (await this.fetchSessionMessages())
        .map(normalizeSessionMessageRecord)
        .filter((message) => !this.baselineMessageIds.has(message.id));

      const resolved = this.resolveSubmissionFromMessages(active, messages);
      userMessageId = resolved.userMessageId;
      const responseCandidate = resolved.response;
      const consumedCandidateIds = resolved.consumedAssistantMessageIds;

      if (responseCandidate) {
        response = responseCandidate;
        consumedAssistantMessageIds = consumedCandidateIds;
      }

      if (userMessageId && responseCandidate) {
        return { userMessageId, response: responseCandidate, consumedAssistantMessageIds: consumedCandidateIds };
      }

      await sleep(150);
    }

    return { userMessageId, response, consumedAssistantMessageIds };
  }

  private async reconcileObservedExternalResponses(): Promise<StudioHostHistoryItem[]> {
    const messages = (await this.fetchSessionMessages())
      .map(normalizeSessionMessageRecord)
      .filter((message) => !this.baselineMessageIds.has(message.id));

    const observed = collectObservedExternalResponses(messages, this.matchedAssistantIds);
    if (observed.length === 0) {
      return [];
    }

    const adopted: StudioHostHistoryItem[] = [];
    for (const item of observed) {
      if (item.userMessageId) {
        this.matchedUserIds.add(item.userMessageId);
      }
      for (const assistantMessageId of item.consumedAssistantMessageIds) {
        this.matchedAssistantIds.add(assistantMessageId);
      }
      adopted.push(this.core.recordObservedResponse({
        promptText: item.promptText,
        userMessageId: item.userMessageId,
        responseMessageId: item.response.id,
        responseText: item.response.text,
        responseThinking: item.response.thinking,
        responseError: item.response.error,
        submittedAt: item.submittedAt,
        completedAt: item.response.completed ?? item.response.created,
      }));
    }

    return adopted;
  }

  private async pollSessionState(): Promise<void> {
    const messages = await this.fetchSessionMessages();
    this.observeSessionMessages(messages);
    const normalizedMessages = messages
      .map(normalizeSessionMessageRecord)
      .filter((message) => !this.baselineMessageIds.has(message.id));

    const status = await this.fetchSessionStatus();
    if (status != null && status !== this.core.getState().lastBackendStatus) {
      this.core.noteBackendStatus(status);
      this.emitTelemetry({ type: "backend.status", at: Date.now(), status });
      this.emitState();
    }

    const active = this.core.getActiveSubmission();
    if (active) {
      const resolved = this.resolveSubmissionFromMessages(active, normalizedMessages);
      const stopping = this.core.getState().runState === "stopping";
      if (resolved.response && (resolved.response.completed != null || resolved.response.error || status === "idle" || stopping)) {
        await this.handleSessionIdle();
        return;
      }
    }

    if (status === "idle") {
      const shouldHandleIdle = this.core.getState().runState !== "idle"
        || this.core.getState().lastBackendStatus !== "idle"
        || this.hasPendingObservedExternalResponses(messages);
      if (shouldHandleIdle) {
        await this.handleSessionIdle();
      }
    }
  }

  private observeSessionMessages(messages: ReadonlyArray<SessionMessageRecord>): void {
    for (const record of messages) {
      const info = record.info;
      this.messageRolesById.set(info.id, info.role);
      this.messageCreatedAtById.set(info.id, info.time.created);
      this.emitModelTelemetryForMessage(info);

      if (info.role === "user") {
        this.observeExternalPrompt({
          promptText: extractUserPromptText(record),
          userMessageId: info.id,
          submittedAt: info.time.created,
        });
      }

      for (const part of record.parts) {
        this.partTypesById.set(part.id, part.type);
        if (info.role !== "assistant") {
          continue;
        }

        const text = extractAssistantPartText(part);
        if (typeof text !== "string") {
          continue;
        }
        if (this.partTextById.get(part.id) === text) {
          continue;
        }

        this.partTextById.set(part.id, text);
        this.emitTelemetry({
          type: "assistant.part.updated",
          at: Date.now(),
          messageId: info.id,
          partId: part.id,
          partType: part.type,
          text,
        });
      }
    }
  }

  private hasPendingObservedExternalResponses(messages: ReadonlyArray<SessionMessageRecord>): boolean {
    const normalized = messages
      .map(normalizeSessionMessageRecord)
      .filter((message) => !this.baselineMessageIds.has(message.id));
    return collectObservedExternalResponses(normalized, this.matchedAssistantIds).length > 0;
  }

  private async fetchSessionMessages(): Promise<SessionMessageRecord[]> {
    const response = this.clientV2
      ? await this.clientV2.session.messages({
        sessionID: this.session.id,
        directory: this.options.directory,
        limit: 200,
      }, {
        throwOnError: true,
      })
      : await this.client.session.messages({
        path: { id: this.session.id },
        query: { directory: this.options.directory, limit: 200 },
        throwOnError: true,
      });
    return (response.data as SessionMessageRecord[] | undefined) ?? [];
  }

  private async fetchSessionStatus(): Promise<string | null> {
    const response = this.clientV2
      ? await this.clientV2.session.status({
        directory: this.options.directory,
      }, {
        throwOnError: true,
      })
      : await this.client.session.status({
        query: { directory: this.options.directory },
        throwOnError: true,
      });
    const data = response.data as unknown;
    if (Array.isArray(data)) {
      const session = (data as unknown as SessionStatusRecord[]).find((item) => item.id === this.session.id);
      return typeof session?.status?.type === "string" ? session.status.type : null;
    }

    const session = (data as SessionStatusMap | undefined)?.[this.session.id];
    return typeof session?.type === "string" ? session.type : null;
  }

  private async fetchSessionMessage(messageID: string): Promise<SessionMessageRecord | null> {
    const response = this.clientV2
      ? await this.clientV2.session.message({
        sessionID: this.session.id,
        messageID,
        directory: this.options.directory,
      }, {
        throwOnError: true,
      })
      : await this.client.session.message({
        path: { id: this.session.id, messageID },
        query: { directory: this.options.directory },
        throwOnError: true,
      });
    return (response.data as SessionMessageRecord | undefined) ?? null;
  }

  private emitState(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private emitTelemetry(event: OpencodeStudioHostTelemetryEvent): void {
    this.options.telemetryListener?.(event);
  }

  private fail(error: Error): void {
    this.core.markError(error.message);
    this.emitState();
  }

  private assertReady(): void {
    const state = this.core.getState();
    if (this.closed || state.runState === "closed") {
      throw new Error("Host is closed.");
    }
    if (!this.session) {
      throw new Error("Host is not initialized.");
    }
    if (state.runState === "error") {
      throw new Error(state.lastError ?? "Host is in an error state.");
    }
  }
}

export async function createOpencodeStudioHost(options: OpencodeStudioHostOptions): Promise<StudioHost> {
  return OpencodeStudioHost.create(options);
}
