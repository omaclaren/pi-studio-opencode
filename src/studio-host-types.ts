export type StudioPromptMode = "run" | "steer" | "response";
export type StudioHostRunState = "idle" | "running" | "stopping" | "closed" | "error";
export type StudioHostSteeringMode = "native-steer" | "adapter-queue" | "native-queue";

export type StudioHostCapabilities = {
  steeringMode: StudioHostSteeringMode;
  stopSupported: boolean;
};

export type StudioHostState = {
  backend: string;
  sessionId: string | null;
  sessionTitle: string | null;
  runState: StudioHostRunState;
  activeChainId: string | null;
  activeChainIndex: number | null;
  activePromptId: string | null;
  queueLength: number;
  historyCount: number;
  lastBackendStatus: string | null;
  lastError: string | null;
};

export type StudioHostHistoryItem = {
  localPromptId: string;
  chainId: string;
  chainIndex: number;
  promptMode: StudioPromptMode;
  promptSteeringCount: number;
  promptText: string;
  effectivePrompt: string;
  queuedWhileBusy: boolean;
  submittedAt: number;
  userMessageId: string | null;
  responseMessageId: string | null;
  responseText: string | null;
  responseError?: string;
  completedAt?: number;
};

export type StudioHostListener = (state: StudioHostState) => void;

export interface StudioHost {
  getState(): StudioHostState;
  getCapabilities(): StudioHostCapabilities;
  subscribe(listener: StudioHostListener): () => void;
  startRun(prompt: string): Promise<void>;
  queueSteer(prompt: string): Promise<void>;
  stop(): Promise<void>;
  getHistory(): StudioHostHistoryItem[];
  waitUntilIdle(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export function describeStudioHostCapabilities(capabilities: StudioHostCapabilities): string {
  const stopText = capabilities.stopSupported ? "native stop/abort" : "no stop";
  return `${capabilities.steeringMode}, ${stopText}`;
}

export function buildEffectivePrompt(basePrompt: string, steeringPrompts: string[]): string {
  if (steeringPrompts.length === 0) return basePrompt;
  const blocks = [`## Original run prompt\n\n${basePrompt}`];
  for (let i = 0; i < steeringPrompts.length; i++) {
    blocks.push(`## Steering ${i + 1}\n\n${steeringPrompts[i]}`);
  }
  return blocks.join("\n\n");
}
