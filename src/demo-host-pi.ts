import { setTimeout as sleep } from "node:timers/promises";
import { createPiStudioHost } from "./host-pi.js";
import { MockPiSession } from "./mock-pi-session.js";
import { describeStudioHostCapabilities, type StudioHostState } from "./studio-host-types.js";

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

function formatState(state: StudioHostState): string {
  return [
    `backend=${state.backend}`,
    `runState=${state.runState}`,
    `activeChain=${state.activeChainIndex ?? "-"}`,
    `activePrompt=${state.activePromptId ? state.activePromptId.slice(0, 16) : "-"}`,
    `queue=${state.queueLength}`,
    `history=${state.historyCount}`,
    `status=${state.lastBackendStatus ?? "-"}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const session = new MockPiSession();
  const host = await createPiStudioHost({
    session,
    eventLogger: (line) => console.log(line),
  });

  console.log(`host capabilities: ${describeStudioHostCapabilities(host.getCapabilities())}`);

  const unsubscribe = host.subscribe((state) => {
    console.log(`[state] ${formatState(state)}`);
  });

  try {
    console.log("\n--- pi sketch: native steer semantics ---\n");
    await host.startRun(RUN_PROMPT);
    await sleep(50);
    await host.queueSteer(STEER_1);
    await sleep(50);
    await host.queueSteer(STEER_2);
    await host.waitUntilIdle();

    console.log("History after steering chain:");
    for (const item of host.getHistory()) {
      console.log(`- chain=${item.chainIndex} mode=${item.promptMode} steeringCount=${item.promptSteeringCount} response=${(item.responseText ?? "").replace(/\s+/g, " ")}`);
    }

    console.log("\n--- pi sketch: abort ---\n");
    await host.startRun(ABORT_PROMPT);
    await sleep(50);
    await host.stop();
    await host.waitUntilIdle();

    console.log("Final history:\n");
    console.log(JSON.stringify(host.getHistory(), null, 2));
  } finally {
    unsubscribe();
    await host.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
