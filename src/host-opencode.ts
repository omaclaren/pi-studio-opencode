import { createOpencode, createOpencodeClient, type Event, type Message, type Part, type Session } from "@opencode-ai/sdk";
import { setTimeout as sleep } from "node:timers/promises";
import { StudioCore } from "./studio-core.js";
import type { StudioHost, StudioHostCapabilities, StudioHostHistoryItem, StudioHostListener, StudioHostState } from "./studio-host-types.js";

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
  }
  | {
    type: "assistant.message.updated";
    at: number;
    messageId: string;
    providerID?: string;
    modelID?: string;
    agent?: string;
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
  sessionId?: string;
  title?: string;
  eventLogger?: (line: string) => void;
  telemetryListener?: (event: OpencodeStudioHostTelemetryEvent) => void;
};

type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

export type ObservedSessionMessage = {
  id: string;
  role: Message["role"];
  created: number;
  completed?: number;
  error?: string;
  text: string;
};

type NormalizedMessage = ObservedSessionMessage;

export type ObservedExternalResponse = {
  userMessageId: string | null;
  promptText: string;
  submittedAt: number;
  response: ObservedSessionMessage;
};

type StartedServer = {
  url: string;
  close(): void;
};

const OPENCODE_HOST_CAPABILITIES: StudioHostCapabilities = {
  steeringMode: "adapter-queue",
  stopSupported: true,
};

function normalizeMessage(record: SessionMessageRecord): NormalizedMessage {
  const text = record.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();

  return {
    id: record.info.id,
    role: record.info.role,
    created: record.info.time.created,
    completed: record.info.role === "assistant" ? record.info.time.completed : undefined,
    error: record.info.role === "assistant" && record.info.error
      ? `${record.info.error.name}: ${record.info.error.data.message ?? "unknown error"}`
      : undefined,
    text,
  };
}

function eventSessionId(event: Event): string | null {
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

function summarizeEvent(event: Event): string {
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

function extractAssistantPartText(part: Part): string | undefined {
  if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
    return part.text;
  }
  return undefined;
}

export function collectObservedExternalResponses(
  messages: ReadonlyArray<ObservedSessionMessage>,
  matchedAssistantIds: ReadonlySet<string>,
): ObservedExternalResponse[] {
  const ordered = [...messages].sort((a, b) => {
    if (a.created !== b.created) return a.created - b.created;
    if (a.role === b.role) return a.id.localeCompare(b.id);
    return a.role === "user" ? -1 : 1;
  });

  const observed: ObservedExternalResponse[] = [];
  let latestUser: ObservedSessionMessage | null = null;

  for (const message of ordered) {
    if (message.role === "user") {
      latestUser = message;
      continue;
    }
    if (message.role !== "assistant") continue;
    if (matchedAssistantIds.has(message.id)) continue;
    if (!message.text && !message.error) continue;

    observed.push({
      userMessageId: latestUser?.id ?? null,
      promptText: latestUser?.text ?? "",
      submittedAt: latestUser?.created ?? message.created,
      response: message,
    });
  }

  return observed;
}

function isMessagePartDeltaEvent(event: { type?: string; properties?: unknown }): event is {
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
  private readonly core = new StudioCore({ backend: "opencode" });

  private client!: ReturnType<typeof createOpencodeClient>;
  private startedServer: StartedServer | null = null;
  private session!: Session;
  private eventAbortController = new AbortController();
  private eventLoop: Promise<void> | null = null;
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
    if (this.startedServer) {
      this.startedServer.close();
      this.startedServer = null;
    }
  }

  private async initialize(): Promise<void> {
    if (this.options.baseUrl) {
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
    }

    const events = await this.client.event.subscribe({
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
  }

  private async createOrReuseSession(): Promise<Session> {
    if (this.options.sessionId) {
      const existing = await this.client.session.get({
        path: { id: this.options.sessionId },
        query: { directory: this.options.directory },
        throwOnError: true,
      });
      if (!existing.data) {
        throw new Error(`Session not found: ${this.options.sessionId}`);
      }
      return existing.data;
    }

    const created = await this.client.session.create({
      query: { directory: this.options.directory },
      body: { title: this.options.title ?? "π Studio" },
      throwOnError: true,
    });
    if (!created.data) {
      throw new Error("Session creation returned no data.");
    }
    return created.data;
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
      const props = event.properties as {
        info?: {
          role?: Message["role"];
          id?: string;
          agent?: string;
          model?: { providerID?: string; modelID?: string };
          providerID?: string;
          modelID?: string;
        };
      };
      if (typeof props.info?.id === "string" && typeof props.info.role === "string") {
        this.messageRolesById.set(props.info.id, props.info.role);
      }
      if (props.info?.role === "user" && typeof props.info.id === "string") {
        this.emitTelemetry({
          type: "user.message.updated",
          at: Date.now(),
          messageId: props.info.id,
          providerID: props.info.model?.providerID,
          modelID: props.info.model?.modelID,
          agent: props.info.agent,
        });
        return;
      }
      if (props.info?.role === "assistant" && typeof props.info.id === "string") {
        this.emitTelemetry({
          type: "assistant.message.updated",
          at: Date.now(),
          messageId: props.info.id,
          providerID: props.info.providerID,
          modelID: props.info.modelID,
          agent: props.info.agent,
        });
      }
      return;
    }

    if (event.type === "message.part.updated") {
      const props = event.properties as { part?: Part };
      const part = props.part;
      if (part) {
        this.partTypesById.set(part.id, part.type);
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
      await this.client.session.promptAsync({
        path: { id: this.session.id },
        query: { directory: this.options.directory },
        body: {
          parts: [{ type: "text", text: submission.promptText }],
        },
        throwOnError: true,
      });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async finalizeActiveSubmission(active: StudioHostHistoryItem): Promise<void> {
    const bound = await this.bindSubmissionToMessages(active);
    if (bound.userMessageId) {
      this.core.noteUserMessage({ text: active.promptText, messageId: bound.userMessageId });
    }
    const stopping = this.core.getState().runState === "stopping";
    const completed = this.core.completeActiveResponse({
      responseMessageId: bound.response?.id ?? null,
      responseText: bound.response?.text ?? "",
      responseError: bound.response?.error ?? (stopping ? "Aborted" : undefined),
      completedAt: bound.response?.completed ?? Date.now(),
    });
    if (completed) {
      this.emitTelemetry({ type: "submission.completed", at: Date.now(), historyItem: completed });
    }
    this.emitState();
  }

  private async bindSubmissionToMessages(active: StudioHostHistoryItem): Promise<{
    userMessageId: string | null;
    response: NormalizedMessage | null;
  }> {
    const deadline = Date.now() + 4000;
    let userMessageId: string | null = active.userMessageId ?? null;
    let response: NormalizedMessage | null = null;

    while (Date.now() < deadline) {
      const messages = (await this.fetchSessionMessages())
        .map(normalizeMessage)
        .filter((message) => !this.baselineMessageIds.has(message.id));

      if (!userMessageId) {
        const userMatch = [...messages].reverse().find((message) => (
          message.role === "user"
          && !this.matchedUserIds.has(message.id)
          && message.text === active.promptText
          && message.created >= active.submittedAt - 10_000
        ));
        if (userMatch) {
          userMessageId = userMatch.id;
          this.matchedUserIds.add(userMatch.id);
        }
      }

      if (!response) {
        const assistantCandidates = [...messages].reverse().filter((message) => (
          message.role === "assistant"
          && !this.matchedAssistantIds.has(message.id)
          && message.created >= active.submittedAt - 10_000
        ));
        const assistantMatch = assistantCandidates.find((message) => Boolean(message.text || message.error))
          ?? assistantCandidates[0];
        if (assistantMatch) {
          response = assistantMatch;
          this.matchedAssistantIds.add(assistantMatch.id);
        }
      }

      if (userMessageId && response) {
        return { userMessageId, response };
      }

      await sleep(150);
    }

    return { userMessageId, response };
  }

  private async reconcileObservedExternalResponses(): Promise<StudioHostHistoryItem[]> {
    const messages = (await this.fetchSessionMessages())
      .map(normalizeMessage)
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
      this.matchedAssistantIds.add(item.response.id);
      adopted.push(this.core.recordObservedResponse({
        promptText: item.promptText,
        userMessageId: item.userMessageId,
        responseMessageId: item.response.id,
        responseText: item.response.text,
        responseError: item.response.error,
        submittedAt: item.submittedAt,
        completedAt: item.response.completed ?? item.response.created,
      }));
    }

    return adopted;
  }

  private async fetchSessionMessages(): Promise<SessionMessageRecord[]> {
    const response = await this.client.session.messages({
      path: { id: this.session.id },
      query: { directory: this.options.directory, limit: 200 },
      throwOnError: true,
    });
    return response.data ?? [];
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
