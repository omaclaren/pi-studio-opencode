import test from "node:test";
import assert from "node:assert/strict";
import { StudioCore } from "../src/studio-core.js";

test("StudioCore tracks direct run chain, queued steering, and idle completion", () => {
  const core = new StudioCore({ backend: "test" });

  const run = core.startRun("run prompt");
  assert.equal(run.promptMode, "run");
  assert.equal(core.getState().runState, "running");
  assert.equal(core.getState().activeChainIndex, 1);
  assert.equal(core.getState().queueLength, 0);

  const steer1 = core.queueSteer("steer one");
  const steer2 = core.queueSteer("steer two");
  assert.equal(steer1.promptMode, "steer");
  assert.equal(steer1.promptSteeringCount, 1);
  assert.equal(steer2.promptSteeringCount, 2);
  assert.equal(core.getState().queueLength, 2);

  core.noteUserMessage({ text: "run prompt", messageId: "user-1" });
  const first = core.completeActiveResponse({
    responseMessageId: "assistant-1",
    responseText: "first response",
    completedAt: 101,
  });
  assert.ok(first);
  assert.equal(first?.userMessageId, "user-1");
  assert.equal(first?.responseText, "first response");
  assert.equal(core.getHistory().length, 1);
  assert.equal(core.getState().queueLength, 2);
  assert.equal(core.getState().runState, "running");

  const nextSteer = core.activateNextQueuedSteer();
  assert.ok(nextSteer);
  assert.equal(nextSteer?.promptText, "steer one");
  assert.equal(core.getState().activePromptId, nextSteer?.localPromptId ?? null);
  assert.equal(core.getState().queueLength, 1);

  core.noteUserMessage({ text: "steer one", messageId: "user-2" });
  core.completeActiveResponse({
    responseMessageId: "assistant-2",
    responseText: "second response",
    completedAt: 102,
  });

  const lastSteer = core.activateNextQueuedSteer();
  assert.ok(lastSteer);
  assert.equal(lastSteer?.promptText, "steer two");
  core.noteUserMessage({ text: "steer two", messageId: "user-3" });
  core.completeActiveResponse({
    responseMessageId: "assistant-3",
    responseText: "third response",
    completedAt: 103,
  });

  assert.equal(core.getHistory().length, 3);
  assert.equal(core.getState().queueLength, 0);
  assert.equal(core.getState().runState, "running");

  core.noteBackendIdle();
  assert.equal(core.getState().runState, "idle");
  assert.equal(core.getState().activeChainId, null);
  assert.equal(core.getState().activePromptId, null);

  const history = core.getHistory();
  assert.deepEqual(
    history.map((item) => [item.promptMode, item.promptSteeringCount, item.responseText]),
    [
      ["run", 0, "first response"],
      ["steer", 1, "second response"],
      ["steer", 2, "third response"],
    ],
  );
  assert.match(history[2]!.effectivePrompt, /## Steering 2/);
});

test("StudioCore can activate next queued steer from a user-message event", () => {
  const core = new StudioCore({ backend: "test" });

  core.startRun("run prompt");
  core.queueSteer("steer one");
  core.noteUserMessage({ text: "run prompt", messageId: "user-1" });
  core.completeActiveResponse({ responseMessageId: "assistant-1", responseText: "done" });

  const activation = core.noteUserMessage({ text: "steer one", messageId: "user-2" });
  assert.equal(activation.activated, true);
  assert.ok(activation.activeSubmission);
  assert.equal(activation.activeSubmission?.promptText, "steer one");
  assert.equal(activation.activeSubmission?.userMessageId, "user-2");
  assert.equal(core.getState().activePromptId, activation.activeSubmission?.localPromptId ?? null);
  assert.equal(core.getState().queueLength, 0);
});

test("StudioCore stop request clears queued steers and returns idle after backend idle", () => {
  const core = new StudioCore({ backend: "test" });

  core.startRun("run prompt");
  core.queueSteer("steer one");
  assert.equal(core.getState().queueLength, 1);

  core.markStopRequested({ clearQueuedSteers: true, backendStatus: "aborting" });
  assert.equal(core.getState().runState, "stopping");
  assert.equal(core.getState().queueLength, 0);
  assert.equal(core.getState().lastBackendStatus, "aborting");

  core.noteUserMessage({ text: "run prompt", messageId: "user-1" });
  core.completeActiveResponse({
    responseMessageId: "assistant-1",
    responseText: "",
    responseError: "Aborted",
    completedAt: 200,
  });
  core.noteBackendIdle();

  assert.equal(core.getState().runState, "idle");
  assert.equal(core.getState().activeChainId, null);
  assert.equal(core.getHistory().length, 1);
  assert.equal(core.getHistory()[0]?.responseError, "Aborted");
});

test("StudioCore can record externally observed terminal responses", () => {
  const core = new StudioCore({ backend: "test" });

  const observed = core.recordObservedResponse({
    promptText: "typed in terminal",
    userMessageId: "user-ext-1",
    responseMessageId: "assistant-ext-1",
    responseText: "external response",
    submittedAt: 300,
    completedAt: 345,
  });

  assert.equal(observed.promptMode, "response");
  assert.equal(observed.chainIndex, 1);
  assert.equal(observed.promptText, "typed in terminal");
  assert.equal(observed.effectivePrompt, "typed in terminal");
  assert.equal(observed.userMessageId, "user-ext-1");
  assert.equal(observed.responseMessageId, "assistant-ext-1");
  assert.equal(observed.responseText, "external response");
  assert.equal(observed.completedAt, 345);
  assert.equal(core.getHistory().length, 1);
  assert.equal(core.getState().runState, "idle");
});
