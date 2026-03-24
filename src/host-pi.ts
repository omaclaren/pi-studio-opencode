import { setTimeout as sleep } from "node:timers/promises";
import { StudioCore } from "./studio-core.js";
import type { StudioHost, StudioHostCapabilities, StudioHostListener, StudioHostState } from "./studio-host-types.js";

export type PiSessionEventLike = {
  type: string;
  message?: unknown;
};

export type PiSessionLike = {
  sessionId: string;
  sessionFile?: string;
  isStreaming: boolean;
  prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>;
  steer(text: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(listener: (event: PiSessionEventLike) => void): () => void;
  dispose?(): void;
};

export type PiStudioHostOptions = {
  session: PiSessionLike;
  eventLogger?: (line: string) => void;
};

const PI_HOST_CAPABILITIES: StudioHostCapabilities = {
  steeringMode: "native-steer",
  stopSupported: true,
};

function normalizePromptText(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractMessageId(message: unknown): string | null {
  const msg = message as { id?: unknown } | null | undefined;
  return typeof msg?.id === "string" ? msg.id : null;
}

function extractStopReason(message: unknown): string | null {
  const msg = message as { stopReason?: unknown } | null | undefined;
  return typeof msg?.stopReason === "string" ? msg.stopReason : null;
}

function extractAssistantText(message: unknown): string | null {
  const msg = message as {
    role?: string;
    content?: Array<{ type?: string; text?: string | { value?: string } }> | string;
  };

  if (!msg || msg.role !== "assistant") return null;

  if (typeof msg.content === "string") {
    return normalizePromptText(msg.content);
  }

  if (!Array.isArray(msg.content)) return null;

  const blocks: string[] = [];
  for (const part of msg.content) {
    if (!part || typeof part !== "object") continue;
    const partType = typeof part.type === "string" ? part.type : "";
    if (typeof part.text === "string") {
      if (!partType || partType === "text" || partType === "output_text") {
        blocks.push(part.text);
      }
      continue;
    }
    if (part.text && typeof part.text === "object" && typeof part.text.value === "string") {
      if (!partType || partType === "text" || partType === "output_text") {
        blocks.push(part.text.value);
      }
    }
  }

  return normalizePromptText(blocks.join("\n\n"));
}

function extractUserText(message: unknown): string | null {
  const msg = message as {
    role?: string;
    content?: Array<{ type?: string; text?: string | { value?: string } }> | string;
  };

  if (!msg || msg.role !== "user") return null;

  if (typeof msg.content === "string") {
    return normalizePromptText(msg.content);
  }

  if (!Array.isArray(msg.content)) return null;

  const blocks: string[] = [];
  for (const part of msg.content) {
    if (!part || typeof part !== "object") continue;
    const partType = typeof part.type === "string" ? part.type : "";
    if (typeof part.text === "string") {
      if (!partType || partType === "text" || partType === "input_text") {
        blocks.push(part.text);
      }
      continue;
    }
    if (part.text && typeof part.text === "object" && typeof part.text.value === "string") {
      if (!partType || partType === "text" || partType === "input_text") {
        blocks.push(part.text.value);
      }
    }
  }

  return normalizePromptText(blocks.join("\n\n"));
}

function extractAssistantError(message: unknown): string | undefined {
  const msg = message as {
    error?: { message?: unknown; name?: unknown } | string;
    stopReason?: unknown;
  } | null | undefined;

  if (typeof msg?.error === "string" && msg.error.trim()) {
    return msg.error;
  }
  if (msg?.error && typeof msg.error === "object") {
    const name = typeof msg.error.name === "string" ? msg.error.name : "AssistantError";
    const messageText = typeof msg.error.message === "string" ? msg.error.message : "unknown error";
    return `${name}: ${messageText}`;
  }
  if (msg?.stopReason === "aborted") {
    return "Aborted";
  }
  return undefined;
}

function summarizeEvent(event: PiSessionEventLike): string {
  if (event.type === "message_end") {
    const role = typeof (event.message as { role?: unknown } | undefined)?.role === "string"
      ? (event.message as { role?: string }).role
      : "?";
    return `${event.type} role=${role}`;
  }
  return event.type;
}

export class PiStudioHost implements StudioHost {
  private readonly options: PiStudioHostOptions;
  private readonly session: PiSessionLike;
  private readonly listeners = new Set<StudioHostListener>();
  private readonly core: StudioCore;

  private unsubscribeSession: (() => void) | null = null;
  private closed = false;

  static async create(options: PiStudioHostOptions): Promise<PiStudioHost> {
    const host = new PiStudioHost(options);
    host.initialize();
    return host;
  }

  private constructor(options: PiStudioHostOptions) {
    this.options = options;
    this.session = options.session;
    this.core = new StudioCore({
      backend: "pi",
      sessionId: options.session.sessionId,
      sessionTitle: options.session.sessionFile ?? null,
    });
    this.core.noteBackendStatus(options.session.isStreaming ? "streaming" : "idle");
  }

  getState(): StudioHostState {
    return this.core.getState();
  }

  getCapabilities(): StudioHostCapabilities {
    return { ...PI_HOST_CAPABILITIES };
  }

  getHistory() {
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
    await this.session.prompt(submission.promptText);
  }

  async queueSteer(prompt: string): Promise<void> {
    this.assertReady();
    this.core.queueSteer(prompt);
    this.emitState();

    if (this.session.isStreaming) {
      await this.session.steer(prompt);
      return;
    }

    const activated = this.core.activateNextQueuedSteer();
    if (!activated) return;
    this.emitState();
    await this.session.prompt(activated.promptText);
  }

  async stop(): Promise<void> {
    this.assertReady();
    if (this.core.getState().runState !== "running") return;
    this.core.markStopRequested({ clearQueuedSteers: true, backendStatus: "aborting" });
    this.emitState();
    await this.session.abort();
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
    throw new Error("Timed out waiting for pi host to become idle.");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    if (this.session.dispose) {
      this.session.dispose();
    }
    this.core.markClosed();
    this.emitState();
  }

  private initialize(): void {
    this.unsubscribeSession = this.session.subscribe((event) => {
      this.options.eventLogger?.(`[event] ${summarizeEvent(event)}`);
      this.handleEvent(event);
    });
  }

  private handleEvent(event: PiSessionEventLike): void {
    if (this.closed) return;

    if (event.type === "agent_start") {
      this.core.noteBackendStatus("streaming");
      this.emitState();
      return;
    }

    if (event.type === "agent_end") {
      this.core.noteBackendIdle();
      this.emitState();
      return;
    }

    if (event.type !== "message_end") return;

    const userText = extractUserText(event.message);
    if (userText) {
      this.core.noteUserMessage({
        text: userText,
        messageId: extractMessageId(event.message),
      });
      this.emitState();
      return;
    }

    const role = typeof (event.message as { role?: unknown } | undefined)?.role === "string"
      ? (event.message as { role?: string }).role
      : null;
    if (role !== "assistant") return;
    if (extractStopReason(event.message) === "toolUse") return;

    const assistantText = extractAssistantText(event.message);
    const assistantError = extractAssistantError(event.message);
    if (!assistantText && !assistantError) return;

    this.core.completeActiveResponse({
      responseMessageId: extractMessageId(event.message),
      responseText: assistantText ?? "",
      responseError: assistantError,
      completedAt: Date.now(),
    });
    this.emitState();
  }

  private emitState(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private assertReady(): void {
    const state = this.core.getState();
    if (this.closed || state.runState === "closed") {
      throw new Error("Host is closed.");
    }
    if (state.runState === "error") {
      throw new Error(state.lastError ?? "Host is in an error state.");
    }
  }
}

export async function createPiStudioHost(options: PiStudioHostOptions): Promise<StudioHost> {
  return PiStudioHost.create(options);
}
