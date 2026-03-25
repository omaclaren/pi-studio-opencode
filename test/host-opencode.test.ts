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
    },
  ]);
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
});

test("collectObservedExternalResponses can still surface assistant errors when no text is present", () => {
  const observed = collectObservedExternalResponses([
    msg({ id: "u1", role: "user", created: 100, text: "typed in terminal" }),
    msg({ id: "a1", role: "assistant", created: 140, completed: 145, text: "", error: "Aborted" }),
  ], new Set());

  assert.equal(observed.length, 1);
  assert.equal(observed[0]?.response.error, "Aborted");
  assert.equal(observed[0]?.userMessageId, "u1");
});
