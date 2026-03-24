import { setTimeout as sleep } from "node:timers/promises";
import { createOpencodeStudioHost } from "./host-opencode.js";
import { describeStudioHostCapabilities, type StudioHostState } from "./studio-host-types.js";

type CliOptions = {
  directory: string;
  baseUrl?: string;
  sessionId?: string;
  title?: string;
  queueDelayMs: number;
  secondQueueDelayMs: number;
  abortDelayMs: number;
  abortTest: boolean;
};

const RUN_PROMPT = [
  "Respond with exactly this plain text and nothing else:",
  "INITIAL_RUN_OK",
].join("\n");

const STEER_1 = [
  "Respond with exactly this plain text and nothing else:",
  "INITIAL_RUN_OK QUEUE_ONE_OK",
].join("\n");

const STEER_2 = [
  "Respond with exactly this plain text and nothing else:",
  "INITIAL_RUN_OK QUEUE_ONE_OK QUEUE_TWO_OK",
].join("\n");

const ABORT_PROMPT = [
  "Write 120 numbered bullet points about event streams.",
  "Do not summarize.",
].join("\n");

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    directory: process.cwd(),
    queueDelayMs: 700,
    secondQueueDelayMs: 500,
    abortDelayMs: 500,
    abortTest: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--directory" && next) {
      options.directory = next;
      i += 1;
      continue;
    }
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--session" && next) {
      options.sessionId = next;
      i += 1;
      continue;
    }
    if (arg === "--title" && next) {
      options.title = next;
      i += 1;
      continue;
    }
    if (arg === "--queue-delay-ms" && next) {
      options.queueDelayMs = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (arg === "--second-queue-delay-ms" && next) {
      options.secondQueueDelayMs = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (arg === "--abort-delay-ms" && next) {
      options.abortDelayMs = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (arg === "--no-abort-test") {
      options.abortTest = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsageAndExit();
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printUsageAndExit(): never {
  console.log(`Usage: npm run host-demo -- [options]

Options:
  --directory <path>            Project directory / working directory
  --base-url <url>              Use an existing opencode server
  --session <id>                Reuse an existing session
  --title <title>               Title for a newly created session
  --queue-delay-ms <n>          Delay before queueing the first steer (default: 700)
  --second-queue-delay-ms <n>   Delay before queueing the second steer (default: 500)
  --abort-delay-ms <n>          Delay before stop() in the abort demo (default: 500)
  --no-abort-test               Skip the abort scenario
`);
  process.exit(0);
}

function formatState(state: StudioHostState): string {
  return [
    `runState=${state.runState}`,
    `activeChain=${state.activeChainIndex ?? "-"}`,
    `activePrompt=${state.activePromptId ? state.activePromptId.slice(0, 16) : "-"}`,
    `queue=${state.queueLength}`,
    `history=${state.historyCount}`,
    `backend=${state.lastBackendStatus ?? "-"}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const host = await createOpencodeStudioHost({
    directory: options.directory,
    baseUrl: options.baseUrl,
    sessionId: options.sessionId,
    title: options.title,
    eventLogger: (line) => console.log(line),
  });

  console.log(`host capabilities: ${describeStudioHostCapabilities(host.getCapabilities())}`);

  const unsubscribe = host.subscribe((state) => {
    console.log(`[state] ${formatState(state)}`);
  });

  try {
    console.log("\n--- scenario 1: run + locally queued steers ---\n");
    await host.startRun(RUN_PROMPT);
    await sleep(options.queueDelayMs);
    await host.queueSteer(STEER_1);
    await sleep(options.secondQueueDelayMs);
    await host.queueSteer(STEER_2);
    await host.waitUntilIdle();

    console.log("History after scenario 1:");
    for (const item of host.getHistory()) {
      console.log(`- chain=${item.chainIndex} mode=${item.promptMode} steeringCount=${item.promptSteeringCount} queuedWhileBusy=${item.queuedWhileBusy}`);
      console.log(`  response=${(item.responseText ?? "").replace(/\s+/g, " ").slice(0, 140)}`);
      if (item.responseError) {
        console.log(`  error=${item.responseError}`);
      }
    }

    if (options.abortTest) {
      console.log("\n--- scenario 2: abort current run ---\n");
      await host.startRun(ABORT_PROMPT);
      await sleep(options.abortDelayMs);
      await host.stop();
      await host.waitUntilIdle();

      const last = host.getHistory().at(-1);
      if (last) {
        console.log(`Abort result: responseId=${last.responseMessageId ?? "(missing)"} error=${last.responseError ?? "(none)"}`);
      }
    }

    console.log("\nFinal history:\n");
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
