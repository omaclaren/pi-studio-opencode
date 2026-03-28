import test from "node:test";
import assert from "node:assert/strict";
import { collectObservedExternalResponses, type ObservedSessionMessage } from "../src/host-opencode.js";

function msg(input: ObservedSessionMessage): ObservedSessionMessage {
  return input;
}

test("collectObservedExternalResponses adopts external assistant replies using the latest preceding user prompt", () => {
  const observed = collectObservedExternalResponses([
    msg({ id: "u1", role: "user", created: 100, text: "typed in terminal" }),
    msg({ id: "a1", role: "assistant", created: 140, completed: 150, text: "terminal reply" }),
  ], new Set());

  assert.deepEqual(observed, [
    {
      userMessageId: "u1",
      promptText: "typed in terminal",
      submittedAt: 100,
      response: { id: "a1", role: "assistant", created: 140, completed: 150, text: "terminal reply" },
      consumedAssistantMessageIds: ["a1"],
    },
  ]);
});

test("collectObservedExternalResponses collapses multiple assistant messages for one user turn into the final response", () => {
  const observed = collectObservedExternalResponses([
    msg({ id: "u1", role: "user", created: 100, text: "typed in terminal" }),
    msg({ id: "a1", role: "assistant", created: 120, completed: 125, text: "Let me inspect that.", parentMessageId: "u1" }),
    msg({ id: "a2", role: "assistant", created: 140, completed: 145, text: "Trying a different approach.", parentMessageId: "u1" }),
    msg({ id: "a3", role: "assistant", created: 160, completed: 170, text: "Final answer.", parentMessageId: "u1" }),
  ], new Set());

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.response.id, "a3");
  assert.equal(observed[0]?.promptText, "typed in terminal");
  assert.deepEqual(observed[0]?.consumedAssistantMessageIds, ["a1", "a2", "a3"]);
});

test("collectObservedExternalResponses resolves assistant chains back to the originating user turn", () => {
  const observed = collectObservedExternalResponses([
    msg({ id: "u1", role: "user", created: 100, text: "typed in terminal" }),
    msg({ id: "a1", role: "assistant", created: 120, completed: 125, text: "Planning.", parentMessageId: "u1" }),
    msg({ id: "a2", role: "assistant", created: 140, completed: 150, text: "Final answer.", parentMessageId: "a1" }),
  ], new Set());

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.userMessageId, "u1");
  assert.equal(observed[0]?.response.id, "a2");
  assert.deepEqual(observed[0]?.consumedAssistantMessageIds, ["a1", "a2"]);
});

test("collectObservedExternalResponses skips already matched or contentless assistant messages", () => {
  const observed = collectObservedExternalResponses([
    msg({ id: "u1", role: "user", created: 100, text: "typed in terminal" }),
    msg({ id: "a-tool", role: "assistant", created: 120, text: "" }),
    msg({ id: "a-old", role: "assistant", created: 130, completed: 131, text: "already recorded" }),
    msg({ id: "a2", role: "assistant", created: 140, completed: 150, text: "new reply" }),
  ], new Set(["a-old"]));

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.response.id, "a2");
  assert.equal(observed[0]?.promptText, "typed in terminal");
  assert.deepEqual(observed[0]?.consumedAssistantMessageIds, ["a2"]);
});

test("collectObservedExternalResponses can still surface assistant errors when no text is present", () => {
  const observed = collectObservedExternalResponses([
    msg({ id: "u1", role: "user", created: 100, text: "typed in terminal" }),
    msg({ id: "a1", role: "assistant", created: 140, completed: 145, text: "", error: "Aborted" }),
  ], new Set());

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.response.error, "Aborted");
  assert.equal(observed[0]?.userMessageId, "u1");
  assert.deepEqual(observed[0]?.consumedAssistantMessageIds, ["a1"]);
});

test("collectObservedExternalResponses preserves assistant thinking text", () => {
  const observed = collectObservedExternalResponses([
    msg({ id: "u1", role: "user", created: 100, text: "typed in terminal" }),
    msg({ id: "a1", role: "assistant", created: 140, completed: 150, text: "terminal reply", thinking: "reasoning trace" }),
  ], new Set());

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.response.text, "terminal reply");
  assert.equal(observed[0]?.response.thinking, "reasoning trace");
});
