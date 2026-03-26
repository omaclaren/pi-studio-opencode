import type { Event, Message, OpencodeClient, Part, Session } from "@opencode-ai/sdk";
import { setTimeout as sleep } from "node:timers/promises";
import {
  collectObservedAssistantResponsesForUser,
  collectObservedExternalResponses,
  eventSessionId,
  extractAssistantPartText,
  extractMessageTokenUsage,
  extractMessageVariant,
  isMessagePartDeltaEvent,
  normalizeSessionMessageRecord,
  selectLatestObservedAssistantResponse,
  sortObservedMessages,
  summarizeEvent,
  type ObservedSessionMessage,
  type OpencodeStudioHostTelemetryEvent,
} from "./host-opencode.js";
import { StudioCore } from "./studio-core.js";
import type { StudioHost, StudioHostCapabilities, StudioHostHistoryItem, StudioHostListener, StudioHostState } from "./studio-host-types.js";

type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

type NormalizedMessage = ObservedSessionMessage;

export type PluginBackedOpencodeStudioHostOptions = {
  client: OpencodeClient;
  directory: string;
  sessionId?: string;
  title?: string;
  eventLogger?: (line: string) => void;
  telemetryListener?: (event: OpencodeStudioHostTelemetryEvent) => void;
};

const OPENCODE_PLUGIN_HOST_CAPABILITIES: StudioHostCapabilities = {
  steeringMode: "adapter-queue",
  stopSupported: true,
};

export class PluginBackedOpencodeStudioHost implements StudioHost {
  private readonly options: PluginBackedOpencodeStudioHostOptions;
  private readonly listeners = new Set<StudioHostListener>();
  private readonly baselineMessageIds = new Set<string>();
  private readonly matchedUserIds = new Set<string>();
  private readonly matchedAssistantIds = new Set<string>();
  private readonly partTypesById = new Map<string, string>();
  private readonly messageRolesById = new Map<string, Message["role"]>();
  private readonly core = new StudioCore({ backend: "opencode" });

  private readonly client: OpencodeClient;
  private session!: Session;
  private handlingIdle = false;
  private closed = false;

  static async create(options: PluginBackedOpencodeStudioHostOptions): Promise<PluginBackedOpencodeStudioHost> {
    const host = new PluginBackedOpencodeStudioHost(options);
    await host.initialize();
    return host;
  }

  private constructor(options: PluginBackedOpencodeStudioHostOptions) {
    this.options = options;
    this.client = options.client;
  }

  getState(): StudioHostState {
    return this.core.getState();
  }

  getCapabilities(): StudioHostCapabilities {
    return { ...OPENCODE_PLUGIN_HOST_CAPABILITIES };
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
  }

  async ingestEvent(event: Event): Promise<void> {
    if (this.closed) return;
    if (eventSessionId(event) !== this.session.id && event.type !== "server.connected") return;
    this.options.eventLogger?.(`[event] ${summarizeEvent(event)}`);
    await this.handleEvent(event);
  }

  private async initialize(): Promise<void> {
    this.session = await this.createOrReuseSession();
    this.core.setSessionInfo({ sessionId: this.session.id, sessionTitle: this.session.title });
    this.emitState();

    const initialMessages = await this.fetchSessionMessages();
    for (const message of initialMessages) {
      this.baselineMessageIds.add(message.info.id);
      this.messageRolesById.set(message.info.id, message.info.role);
      for (const part of message.parts) {
        this.partTypesById.set(part.id, part.type);
      }
      this.emitModelTelemetryForMessage(message.info);
    }
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
        this.emitModelTelemetryForMessage(props.info);
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
    consumedAssistantMessageIds: string[];
  }> {
    const deadline = Date.now() + 4000;
    let userMessageId: string | null = active.userMessageId ?? null;
    let response: NormalizedMessage | null = null;
    let consumedAssistantMessageIds: string[] = [];

    while (Date.now() < deadline) {
      const messages = (await this.fetchSessionMessages())
        .map(normalizeSessionMessageRecord)
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
        }
      }

      let responseCandidate: NormalizedMessage | null = null;
      let consumedCandidateIds: string[] = [];

      if (userMessageId) {
        const linkedAssistantMessages = collectObservedAssistantResponsesForUser(messages, this.matchedAssistantIds, userMessageId);
        responseCandidate = selectLatestObservedAssistantResponse(linkedAssistantMessages);
        consumedCandidateIds = linkedAssistantMessages.map((message) => message.id);
      } else {
        const assistantCandidates = sortObservedMessages(messages).filter((message) => (
          message.role === "assistant"
          && !this.matchedAssistantIds.has(message.id)
          && message.created >= active.submittedAt - 10_000
        ));
        responseCandidate = selectLatestObservedAssistantResponse(assistantCandidates);
        consumedCandidateIds = assistantCandidates.map((message) => message.id);
      }

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

export async function createPluginBackedOpencodeStudioHost(options: PluginBackedOpencodeStudioHostOptions): Promise<PluginBackedOpencodeStudioHost> {
  return PluginBackedOpencodeStudioHost.create(options);
}
