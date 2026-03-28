import { randomUUID } from "node:crypto";
import {
  buildEffectivePrompt,
  type StudioHostHistoryItem,
  type StudioHostRunState,
  type StudioHostState,
  type StudioPromptMode,
} from "./studio-host-types.js";

type StudioCoreSubmission = {
  localPromptId: string;
  chainId: string;
  chainIndex: number;
  promptMode: StudioPromptMode;
  promptSteeringCount: number;
  promptText: string;
  effectivePrompt: string;
  queuedWhileBusy: boolean;
  submittedAt: number;
  userMessageId?: string;
  responseMessageId?: string;
  responseText?: string;
  responseThinking?: string;
  responseError?: string;
  completedAt?: number;
};

type StudioCoreChain = {
  chainId: string;
  chainIndex: number;
  basePrompt: string;
  steeringPrompts: string[];
};

export type StudioCoreOptions = {
  backend: string;
  sessionId?: string | null;
  sessionTitle?: string | null;
};

export type StudioCoreResponsePayload = {
  responseMessageId?: string | null;
  responseText?: string | null;
  responseThinking?: string | null;
  responseError?: string;
  completedAt?: number;
};

export class StudioCore {
  private state: StudioHostState;
  private activeChain: StudioCoreChain | null = null;
  private activeSubmission: StudioCoreSubmission | null = null;
  private queuedSteers: StudioCoreSubmission[] = [];
  private readonly history: StudioHostHistoryItem[] = [];
  private nextChainIndexValue = 1;

  constructor(options: StudioCoreOptions) {
    this.state = {
      backend: options.backend,
      sessionId: options.sessionId ?? null,
      sessionTitle: options.sessionTitle ?? null,
      runState: "idle",
      activeChainId: null,
      activeChainIndex: null,
      activePromptId: null,
      queueLength: 0,
      historyCount: 0,
      lastBackendStatus: null,
      lastError: null,
    };
  }

  getState(): StudioHostState {
    return { ...this.state };
  }

  getHistory(): StudioHostHistoryItem[] {
    return this.history.map((item) => ({ ...item }));
  }

  getActiveSubmission(): StudioHostHistoryItem | null {
    return this.activeSubmission ? this.snapshotSubmission(this.activeSubmission) : null;
  }

  getQueuedSteeringCount(): number {
    return this.queuedSteers.length;
  }

  hasActiveChain(): boolean {
    return Boolean(this.activeChain);
  }

  setSessionInfo(input: { sessionId?: string | null; sessionTitle?: string | null }): void {
    if (Object.prototype.hasOwnProperty.call(input, "sessionId")) {
      this.state.sessionId = input.sessionId ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, "sessionTitle")) {
      this.state.sessionTitle = input.sessionTitle ?? null;
    }
    this.refreshDerivedState();
  }

  noteBackendStatus(status: string | null): void {
    this.state.lastBackendStatus = status;
    this.refreshDerivedState();
  }

  startRun(prompt: string): StudioHostHistoryItem {
    this.assertReady();
    if (this.activeChain || this.activeSubmission || this.queuedSteers.length > 0 || this.state.runState !== "idle") {
      throw new Error("Cannot start a new run while another chain is active.");
    }

    const chain: StudioCoreChain = {
      chainId: `chain_${randomUUID()}`,
      chainIndex: this.nextChainIndexValue++,
      basePrompt: prompt,
      steeringPrompts: [],
    };
    this.activeChain = chain;
    this.activeSubmission = this.buildSubmission(chain, "run", prompt, false);
    this.refreshDerivedState();
    return this.requireActiveSubmission();
  }

  queueSteer(prompt: string): StudioHostHistoryItem {
    this.assertReady();
    if (!this.activeChain) {
      throw new Error("Cannot queue steering without an active run chain.");
    }
    if (this.state.runState === "stopping") {
      throw new Error("Cannot queue steering while stop is in progress.");
    }

    this.activeChain.steeringPrompts.push(prompt);
    const queued = this.buildSubmission(this.activeChain, "steer", prompt, true);
    this.queuedSteers.push(queued);
    this.refreshDerivedState();
    return this.snapshotSubmission(queued);
  }

  activateNextQueuedSteer(): StudioHostHistoryItem | null {
    if (this.activeSubmission) {
      throw new Error("Cannot activate queued steering while another Studio prompt is active.");
    }
    const next = this.queuedSteers.shift() ?? null;
    if (!next) {
      this.refreshDerivedState();
      return null;
    }
    this.activeSubmission = next;
    this.refreshDerivedState();
    return this.snapshotSubmission(next);
  }

  noteUserMessage(input: { text?: string | null; messageId?: string | null }): { activated: boolean; activeSubmission: StudioHostHistoryItem | null } {
    const text = typeof input.text === "string" ? input.text.trim() : "";
    const messageId = typeof input.messageId === "string" ? input.messageId : undefined;
    let activated = false;

    if (!this.activeSubmission && text) {
      const nextQueued = this.queuedSteers[0];
      if (nextQueued && nextQueued.promptText === text) {
        this.activeSubmission = this.queuedSteers.shift() ?? null;
        activated = Boolean(this.activeSubmission);
      }
    }

    if (this.activeSubmission && text && this.activeSubmission.promptText === text && messageId && !this.activeSubmission.userMessageId) {
      this.activeSubmission.userMessageId = messageId;
    }

    this.refreshDerivedState();
    return {
      activated,
      activeSubmission: this.activeSubmission ? this.snapshotSubmission(this.activeSubmission) : null,
    };
  }

  completeActiveResponse(payload: StudioCoreResponsePayload): StudioHostHistoryItem | null {
    const active = this.activeSubmission;
    if (!active) return null;

    active.responseMessageId = payload.responseMessageId ?? undefined;
    active.responseText = payload.responseText ?? "";
    active.responseThinking = payload.responseThinking ?? "";
    active.responseError = payload.responseError;
    active.completedAt = payload.completedAt ?? Date.now();

    const historyItem = this.snapshotSubmission(active);
    this.history.push(historyItem);
    this.activeSubmission = null;
    this.refreshDerivedState();
    return historyItem;
  }

  recordObservedResponse(input: {
    promptText?: string | null;
    userMessageId?: string | null;
    responseMessageId?: string | null;
    responseText?: string | null;
    responseThinking?: string | null;
    responseError?: string;
    submittedAt?: number;
    completedAt?: number;
  }): StudioHostHistoryItem {
    this.assertReady();

    const promptText = typeof input.promptText === "string" ? input.promptText.trim() : "";
    const submittedAt = typeof input.submittedAt === "number" && Number.isFinite(input.submittedAt)
      ? input.submittedAt
      : Date.now();
    const completedAt = typeof input.completedAt === "number" && Number.isFinite(input.completedAt)
      ? input.completedAt
      : submittedAt;

    const observed: StudioCoreSubmission = {
      localPromptId: `prompt_${randomUUID()}`,
      chainId: `chain_${randomUUID()}`,
      chainIndex: this.nextChainIndexValue++,
      promptMode: "response",
      promptSteeringCount: 0,
      promptText,
      effectivePrompt: promptText,
      queuedWhileBusy: false,
      submittedAt,
      userMessageId: input.userMessageId ?? undefined,
      responseMessageId: input.responseMessageId ?? undefined,
      responseText: input.responseText ?? "",
      responseThinking: input.responseThinking ?? "",
      responseError: input.responseError,
      completedAt,
    };

    const historyItem = this.snapshotSubmission(observed);
    this.history.push(historyItem);
    this.refreshDerivedState();
    return historyItem;
  }

  markStopRequested(options?: { clearQueuedSteers?: boolean; backendStatus?: string | null }): void {
    this.assertReady();
    this.state.runState = "stopping";
    if (options?.backendStatus !== undefined) {
      this.state.lastBackendStatus = options.backendStatus;
    }
    if (options?.clearQueuedSteers) {
      this.queuedSteers = [];
    }
    this.refreshDerivedState();
  }

  noteBackendIdle(): void {
    this.state.lastBackendStatus = "idle";
    if (!this.activeSubmission && this.queuedSteers.length === 0) {
      this.activeChain = null;
    }
    if (!this.activeChain && !this.activeSubmission && this.queuedSteers.length === 0 && this.state.runState !== "error" && this.state.runState !== "closed") {
      this.state.runState = "idle";
    }
    this.refreshDerivedState();
  }

  markError(message: string): void {
    this.state.lastError = message;
    this.state.runState = "error";
    this.refreshDerivedState();
  }

  markClosed(): void {
    this.state.runState = this.state.runState === "error" ? "error" : "closed";
    this.refreshDerivedState();
  }

  private buildSubmission(
    chain: StudioCoreChain,
    promptMode: StudioPromptMode,
    promptText: string,
    queuedWhileBusy: boolean,
  ): StudioCoreSubmission {
    const steeringCount = promptMode === "run" ? 0 : chain.steeringPrompts.length;
    return {
      localPromptId: `prompt_${randomUUID()}`,
      chainId: chain.chainId,
      chainIndex: chain.chainIndex,
      promptMode,
      promptSteeringCount: steeringCount,
      promptText,
      effectivePrompt: promptMode === "run"
        ? chain.basePrompt
        : buildEffectivePrompt(chain.basePrompt, chain.steeringPrompts.slice(0, steeringCount)),
      queuedWhileBusy,
      submittedAt: Date.now(),
    };
  }

  private snapshotSubmission(submission: StudioCoreSubmission): StudioHostHistoryItem {
    return {
      localPromptId: submission.localPromptId,
      chainId: submission.chainId,
      chainIndex: submission.chainIndex,
      promptMode: submission.promptMode,
      promptSteeringCount: submission.promptSteeringCount,
      promptText: submission.promptText,
      effectivePrompt: submission.effectivePrompt,
      queuedWhileBusy: submission.queuedWhileBusy,
      submittedAt: submission.submittedAt,
      userMessageId: submission.userMessageId ?? null,
      responseMessageId: submission.responseMessageId ?? null,
      responseText: submission.responseText ?? null,
      responseThinking: submission.responseThinking ?? null,
      responseError: submission.responseError,
      completedAt: submission.completedAt,
    };
  }

  private requireActiveSubmission(): StudioHostHistoryItem {
    if (!this.activeSubmission) {
      throw new Error("No active Studio submission is available.");
    }
    return this.snapshotSubmission(this.activeSubmission);
  }

  private refreshDerivedState(): void {
    this.state.activeChainId = this.activeChain?.chainId ?? null;
    this.state.activeChainIndex = this.activeChain?.chainIndex ?? null;
    this.state.activePromptId = this.activeSubmission?.localPromptId ?? null;
    this.state.queueLength = this.queuedSteers.length;
    this.state.historyCount = this.history.length;

    if (this.state.runState === "error" || this.state.runState === "closed" || this.state.runState === "stopping") {
      return;
    }

    const hasWork = Boolean(this.activeChain || this.activeSubmission || this.queuedSteers.length > 0);
    this.state.runState = hasWork ? "running" : "idle";
  }

  private assertReady(): void {
    if (this.state.runState === "closed") {
      throw new Error("Studio core is closed.");
    }
    if (this.state.runState === "error") {
      throw new Error(this.state.lastError ?? "Studio core is in an error state.");
    }
  }
}
