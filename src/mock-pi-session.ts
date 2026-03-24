import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { PiSessionEventLike, PiSessionLike } from "./host-pi.js";

type Listener = (event: PiSessionEventLike) => void;

type QueueItem = {
  text: string;
};

export class MockPiSession implements PiSessionLike {
  readonly sessionId = `mock-pi-session-${randomUUID()}`;
  readonly sessionFile = undefined;
  isStreaming = false;

  private readonly listeners = new Set<Listener>();
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private abortRequested = false;
  private responseTokens: string[] = [];

  async prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void> {
    if (this.isStreaming && options?.streamingBehavior === "steer") {
      return this.steer(text);
    }
    if (this.isStreaming) {
      throw new Error("MockPiSession.prompt() cannot be called while streaming without streamingBehavior=steer.");
    }
    this.enqueue(text);
  }

  async steer(text: string): Promise<void> {
    this.enqueue(text);
  }

  async abort(): Promise<void> {
    this.abortRequested = true;
    this.queue.length = 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.listeners.clear();
    this.queue.length = 0;
  }

  private enqueue(text: string): void {
    this.queue.push({ text });
    if (!this.processing) {
      void this.processLoop();
    }
  }

  private async processLoop(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        this.emit({
          type: "message_end",
          message: this.makeUserMessage(item.text),
        });
        this.emit({ type: "agent_start" });
        this.isStreaming = true;
        await sleep(120);

        if (this.abortRequested) {
          this.abortRequested = false;
          this.isStreaming = false;
          this.emit({
            type: "message_end",
            message: this.makeAssistantErrorMessage(),
          });
          this.emit({ type: "agent_end" });
          continue;
        }

        const responseText = this.renderResponse(item.text);
        this.isStreaming = false;
        this.emit({
          type: "message_end",
          message: this.makeAssistantMessage(responseText),
        });
        this.emit({ type: "agent_end" });
      }
    } finally {
      this.isStreaming = false;
      this.processing = false;
    }
  }

  private renderResponse(text: string): string {
    if (text.includes("SECOND_RUN_STARTED")) {
      this.responseTokens = ["SECOND_RUN_STARTED"];
      return this.responseTokens.join(" ");
    }

    if (text.includes("INITIAL_RUN_OK")) {
      this.responseTokens = ["INITIAL_RUN_OK"];
      return this.responseTokens.join(" ");
    }

    if (text.includes("QUEUE_ONE_OK")) {
      if (!this.responseTokens.includes("QUEUE_ONE_OK")) {
        this.responseTokens.push("QUEUE_ONE_OK");
      }
      return this.responseTokens.join(" ");
    }

    if (text.includes("QUEUE_TWO_OK")) {
      if (!this.responseTokens.includes("QUEUE_TWO_OK")) {
        this.responseTokens.push("QUEUE_TWO_OK");
      }
      return this.responseTokens.join(" ");
    }

    if (text.includes("Write 120 numbered bullet points")) {
      return Array.from({ length: 5 }, (_, index) => `${index + 1}. event streams help coordination.`).join("\n");
    }

    const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? text;
    return firstLine.trim();
  }

  private makeUserMessage(text: string): unknown {
    return {
      id: `msg_${randomUUID()}`,
      role: "user",
      content: [{ type: "input_text", text }],
    };
  }

  private makeAssistantMessage(text: string): unknown {
    return {
      id: `msg_${randomUUID()}`,
      role: "assistant",
      content: [{ type: "output_text", text }],
    };
  }

  private makeAssistantErrorMessage(): unknown {
    return {
      id: `msg_${randomUUID()}`,
      role: "assistant",
      stopReason: "aborted",
      error: { name: "AbortError", message: "The operation was aborted." },
      content: [{ type: "output_text", text: "" }],
    };
  }

  private emit(event: PiSessionEventLike): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
