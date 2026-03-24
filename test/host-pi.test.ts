import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createPiStudioHost } from "../src/host-pi.js";
import { MockPiSession } from "../src/mock-pi-session.js";

const RUN_PROMPT = [
  "Please reply in one short paragraph.",
  "Say INITIAL_RUN_OK exactly once.",
].join("\n");

const STEER_1 = [
  "Queued steering:",
  "append QUEUE_ONE_OK as a new final sentence.",
].join("\n");

const STEER_2 = [
  "Queued steering 2:",
  "append QUEUE_TWO_OK as a new final sentence.",
].join("\n");

const ABORT_PROMPT = [
  "Write 120 numbered bullet points about event streams.",
  "Do not summarize.",
].join("\n");

test("PiStudioHost preserves run chain provenance across native steer messages", async () => {
  const session = new MockPiSession();
  const host = await createPiStudioHost({ session });

  try {
    assert.deepEqual(host.getCapabilities(), {
      steeringMode: "native-steer",
      stopSupported: true,
    });

    await host.startRun(RUN_PROMPT);
    await sleep(20);
    await host.queueSteer(STEER_1);
    await sleep(20);
    await host.queueSteer(STEER_2);
    await host.waitUntilIdle();

    const history = host.getHistory();
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((item) => [item.chainIndex, item.promptMode, item.promptSteeringCount]),
      [
        [1, "run", 0],
        [1, "steer", 1],
        [1, "steer", 2],
      ],
    );
    assert.match(history[0]!.responseText ?? "", /INITIAL_RUN_OK/);
    assert.match(history[1]!.responseText ?? "", /QUEUE_ONE_OK/);
    assert.match(history[2]!.responseText ?? "", /QUEUE_TWO_OK/);
    assert.equal(host.getState().runState, "idle");
    assert.equal(host.getState().queueLength, 0);
  } finally {
    await host.close();
  }
});

test("PiStudioHost surfaces aborted runs as errored history items", async () => {
  const session = new MockPiSession();
  const host = await createPiStudioHost({ session });

  try {
    await host.startRun(ABORT_PROMPT);
    await sleep(20);
    await host.stop();
    await host.waitUntilIdle();

    const last = host.getHistory().at(-1);
    assert.ok(last);
    assert.match(last?.responseError ?? "", /aborted/i);
    assert.equal(host.getState().runState, "idle");
    assert.equal(host.getState().activeChainId, null);
  } finally {
    await host.close();
  }
});
