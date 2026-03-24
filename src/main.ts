import { createOpencode, createOpencodeClient, type Event, type Message, type Part, type Session } from "@opencode-ai/sdk";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type StudioPromptMode = "run" | "steer";
type StudioPromptTriggerKind = "run" | "steer";

type CliOptions = {
  baseUrl?: string;
  directory: string;
  sessionId?: string;
  title: string;
  runPrompt: string;
  queuePrompt: string;
  secondQueuePrompt: string;
  secondRunPrompt: string;
  queueDelayMs: number;
  secondQueueDelayMs: number;
  settleTimeoutMs: number;
  pollIntervalMs: number;
  artifactsDir: string;
  multiSteerTest: boolean;
  newRunAfterIdleTest: boolean;
  abortTest: boolean;
  abortDelayMs: number;
  abortPrompt: string;
};

type SessionMessageRecord = {
  info: Message;
  parts: Part[];
};

type NormalizedMessage = {
  id: string;
  role: Message["role"];
  created: number;
  completed?: number;
  error?: string;
  text: string;
  reasoning: string;
  partTypes: string[];
  partCount: number;
};

type ChainRecord = {
  chainId: string;
  chainIndex: number;
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  observedAssistantReplies?: number;
  basePromptText: string;
  steeringPrompts: string[];
  submissionIds: string[];
};

type PromptSubmission = {
  localPromptId: string;
  submissionIndex: number;
  sessionId: string;
  chainId: string;
  chainIndex: number;
  scenarioName: string;
  stepLabel: string;
  promptMode: StudioPromptMode;
  triggerKind: StudioPromptTriggerKind;
  submittedAt: number;
  sessionStatusAtSubmit: string | null;
  queuedWhileBusy: boolean;
  promptText: string;
  promptSteeringCount: number;
  promptTriggerText: string;
  effectivePrompt: string;
  expectedReply: boolean;
  abortRequestedAt?: number;
  userMessageId?: string;
  userMessageCreated?: number;
  responseMessageId?: string;
  responseCreated?: number;
  responseCompleted?: number;
  responseText?: string;
  responseError?: string;
};

type ResponseHistoryItem = {
  responseIndex: number;
  localPromptId: string;
  chainId: string;
  chainIndex: number;
  scenarioName: string;
  stepLabel: string;
  responseMessageId: string | null;
  responseText: string | null;
  responseError?: string;
  promptMode: "run" | "effective";
  triggerKind: StudioPromptTriggerKind;
  promptSteeringCount: number;
  promptTriggerText: string;
  effectivePrompt: string;
  queuedWhileBusy: boolean;
  sessionStatusAtSubmit: string | null;
  userMessageId: string | null;
};

type ChainSummary = {
  chainId: string;
  chainIndex: number;
  sessionId: string;
  startedAt: number;
  completedAt?: number;
  observedAssistantReplies?: number;
  basePromptText: string;
  steeringPrompts: string[];
  submissionIds: string[];
  responseMessageIds: string[];
  responseCount: number;
};

type MatchingDiagnostics = {
  initialMessageCount: number;
  newMessageCount: number;
  newUserMessageCount: number;
  newAssistantMessageCount: number;
  missingUserMatches: string[];
  missingResponseMatches: string[];
  unassignedUserMessageIds: string[];
  unassignedAssistantMessageIds: string[];
};

type ScenarioResult = {
  scenarioName: string;
  description: string;
  submittedPromptCount: number;
  observedAssistantReplies: number;
};

type RunContext = {
  client: ReturnType<typeof createOpencodeClient>;
  session: Session;
  options: CliOptions;
  chains: ChainRecord[];
  submissions: PromptSubmission[];
  currentChain: ChainRecord | null;
  expectedAssistantCount: number;
};

const DEFAULT_RUN_PROMPT = [
  "Please reply in two short paragraphs.",
  "In the first paragraph, say that the initial run started.",
  "In the second paragraph, say you are waiting for any queued follow-up instructions.",
].join("\n");

const DEFAULT_QUEUE_PROMPT = [
  "Queued instruction:",
  "append one extra final paragraph that says exactly QUEUED_PROMPT_WORKED.",
].join("\n");

const DEFAULT_SECOND_QUEUE_PROMPT = [
  "Queued instruction 2:",
  "append one more final paragraph that says exactly SECOND_QUEUED_PROMPT_WORKED.",
].join("\n");

const DEFAULT_SECOND_RUN_PROMPT = [
  "This is a fresh run after the earlier chain has already gone idle.",
  "Reply with exactly this one line and nothing else:",
  "SECOND_RUN_STARTED",
].join("\n");

const DEFAULT_ABORT_PROMPT = [
  "Write 150 numbered bullet points.",
  "Each point should be a complete sentence about why deterministic event logs are useful.",
  "Do not summarize.",
].join("\n");

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    directory: process.cwd(),
    title: `Studio spike ${new Date().toISOString()}`,
    runPrompt: DEFAULT_RUN_PROMPT,
    queuePrompt: DEFAULT_QUEUE_PROMPT,
    secondQueuePrompt: DEFAULT_SECOND_QUEUE_PROMPT,
    secondRunPrompt: DEFAULT_SECOND_RUN_PROMPT,
    queueDelayMs: 1200,
    secondQueueDelayMs: 300,
    settleTimeoutMs: 120_000,
    pollIntervalMs: 1000,
    artifactsDir: resolve(process.cwd(), "artifacts", `pi-studio-opencode-${Date.now()}`),
    multiSteerTest: false,
    newRunAfterIdleTest: false,
    abortTest: false,
    abortDelayMs: 1500,
    abortPrompt: DEFAULT_ABORT_PROMPT,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--directory" && next) {
      options.directory = resolve(next);
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
    if (arg === "--run-prompt" && next) {
      options.runPrompt = next;
      i += 1;
      continue;
    }
    if (arg === "--queue-prompt" && next) {
      options.queuePrompt = next;
      i += 1;
      continue;
    }
    if (arg === "--second-queue-prompt" && next) {
      options.secondQueuePrompt = next;
      i += 1;
      continue;
    }
    if (arg === "--second-run-prompt" && next) {
      options.secondRunPrompt = next;
      i += 1;
      continue;
    }
    if (arg === "--queue-delay-ms" && next) {
      options.queueDelayMs = parseIntegerFlag("--queue-delay-ms", next);
      i += 1;
      continue;
    }
    if (arg === "--second-queue-delay-ms" && next) {
      options.secondQueueDelayMs = parseIntegerFlag("--second-queue-delay-ms", next);
      i += 1;
      continue;
    }
    if (arg === "--settle-timeout-ms" && next) {
      options.settleTimeoutMs = parseIntegerFlag("--settle-timeout-ms", next);
      i += 1;
      continue;
    }
    if (arg === "--poll-interval-ms" && next) {
      options.pollIntervalMs = parseIntegerFlag("--poll-interval-ms", next);
      i += 1;
      continue;
    }
    if (arg === "--artifacts-dir" && next) {
      options.artifactsDir = resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--multi-steer-test") {
      options.multiSteerTest = true;
      continue;
    }
    if (arg === "--new-run-after-idle-test") {
      options.newRunAfterIdleTest = true;
      continue;
    }
    if (arg === "--abort-test") {
      options.abortTest = true;
      continue;
    }
    if (arg === "--abort-delay-ms" && next) {
      options.abortDelayMs = parseIntegerFlag("--abort-delay-ms", next);
      i += 1;
      continue;
    }
    if (arg === "--abort-prompt" && next) {
      options.abortPrompt = next;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsageAndExit();
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseIntegerFlag(flag: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function printUsageAndExit(): never {
  console.log(`Usage: npm start -- [options]

Options:
  --base-url <url>              Connect to an existing opencode server instead of starting one
  --directory <path>            Working directory / project directory (default: current directory)
  --session <id>                Reuse an existing session instead of creating one
  --title <title>               Session title for a new session
  --run-prompt <text>           Initial run prompt text
  --queue-prompt <text>         First queued steering prompt
  --second-queue-prompt <text>  Second queued steering prompt for --multi-steer-test
  --second-run-prompt <text>    Fresh run prompt for --new-run-after-idle-test
  --queue-delay-ms <n>          Delay before queueing the first steer (default: 1200)
  --second-queue-delay-ms <n>   Delay before queueing the second steer (default: 300)
  --settle-timeout-ms <n>       Timeout waiting for idle / replies (default: 120000)
  --poll-interval-ms <n>        Poll interval for status/messages (default: 1000)
  --artifacts-dir <path>        Output directory for logs/artifacts
  --multi-steer-test            Queue a second steer while the first chain is still busy
  --new-run-after-idle-test     Start a fresh run in the same session after the first chain settles
  --abort-test                  Start another fresh run and abort it after a short delay
  --abort-delay-ms <n>          Delay before aborting the extra run (default: 1500)
  --abort-prompt <text>         Prompt used for the optional abort test
`);
  process.exit(0);
}

function summarizeEvent(event: Event): string {
  const props = event.properties as Record<string, unknown> | undefined;
  if (event.type === "session.status") {
    const status = props?.status as { type?: string } | undefined;
    const sessionID = typeof props?.sessionID === "string" ? props.sessionID : "?";
    return `${event.type} session=${sessionID} status=${status?.type ?? "unknown"}`;
  }
  if (event.type === "session.idle") {
    return `${event.type} session=${String(props?.sessionID ?? "?")}`;
  }
  if (event.type === "message.updated") {
    const info = props?.info as { role?: string; id?: string; sessionID?: string } | undefined;
    return `${event.type} role=${info?.role ?? "?"} message=${info?.id ?? "?"} session=${info?.sessionID ?? "?"}`;
  }
  if (event.type === "message.part.updated") {
    const part = props?.part as { type?: string; sessionID?: string; messageID?: string; id?: string } | undefined;
    return `${event.type} partType=${part?.type ?? "?"} session=${part?.sessionID ?? "?"} message=${part?.messageID ?? "?"} part=${part?.id ?? "?"}`;
  }
  if (event.type === "permission.updated") {
    return `${event.type} session=${String(props?.sessionID ?? "?")}`;
  }
  return event.type;
}

function normalizeMessage(record: SessionMessageRecord): NormalizedMessage {
  const created = record.info.time.created;
  const completed = record.info.role === "assistant" ? record.info.time.completed : undefined;
  const error = record.info.role === "assistant" && record.info.error
    ? `${record.info.error.name}: ${record.info.error.data.message ?? "unknown error"}`
    : undefined;
  const text = record.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  const reasoning = record.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n\n")
    .trim();

  return {
    id: record.info.id,
    role: record.info.role,
    created,
    completed,
    error,
    text,
    reasoning,
    partTypes: record.parts.map((part) => part.type),
    partCount: record.parts.length,
  };
}

function buildEffectivePrompt(basePrompt: string, steeringPrompts: string[]): string {
  if (steeringPrompts.length === 0) return basePrompt;

  const blocks = [`## Original run prompt\n\n${basePrompt}`];
  for (let i = 0; i < steeringPrompts.length; i++) {
    blocks.push(`## Steering ${i + 1}\n\n${steeringPrompts[i]}`);
  }
  return blocks.join("\n\n");
}

function countAssistantMessages(messages: SessionMessageRecord[]): number {
  return messages.filter((entry) => entry.info.role === "assistant").length;
}

async function fetchSessionMessages(client: ReturnType<typeof createOpencodeClient>, sessionID: string, directory: string): Promise<SessionMessageRecord[]> {
  const response = await client.session.messages({
    path: { id: sessionID },
    query: { directory, limit: 200 },
    throwOnError: true,
  });

  return response.data ?? [];
}

async function fetchSessionStatus(client: ReturnType<typeof createOpencodeClient>, sessionID: string, directory: string): Promise<string | null> {
  const response = await client.session.status({
    query: { directory },
    throwOnError: true,
  });

  const statusMap = response.data ?? {};
  const status = statusMap[sessionID];
  return status?.type ?? null;
}

async function waitForSessionToSettle(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string,
  directory: string,
  expectedAssistantCount: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<SessionMessageRecord[]> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const [messages, status] = await Promise.all([
      fetchSessionMessages(client, sessionID, directory),
      fetchSessionStatus(client, sessionID, directory),
    ]);

    const assistantCount = countAssistantMessages(messages);
    const completedAssistantCount = messages.filter(
      (entry) => entry.info.role === "assistant" && Boolean(entry.info.time.completed),
    ).length;

    if ((status === "idle" || status === null) && assistantCount >= expectedAssistantCount && completedAssistantCount >= expectedAssistantCount) {
      return messages;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for session ${sessionID} to settle.`);
}

async function waitForSessionToBecomeIdle(
  client: ReturnType<typeof createOpencodeClient>,
  sessionID: string,
  directory: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<SessionMessageRecord[]> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const [messages, status] = await Promise.all([
      fetchSessionMessages(client, sessionID, directory),
      fetchSessionStatus(client, sessionID, directory),
    ]);

    if (status === "idle" || status === null) {
      return messages;
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Timed out waiting for session ${sessionID} to become idle.`);
}

async function createOrReuseSession(client: ReturnType<typeof createOpencodeClient>, options: CliOptions): Promise<Session> {
  if (options.sessionId) {
    const response = await client.session.get({
      path: { id: options.sessionId },
      query: { directory: options.directory },
      throwOnError: true,
    });
    if (!response.data) throw new Error(`Session not found: ${options.sessionId}`);
    return response.data;
  }

  const response = await client.session.create({
    query: { directory: options.directory },
    body: { title: options.title },
    throwOnError: true,
  });

  if (!response.data) {
    throw new Error("Session creation returned no data.");
  }

  return response.data;
}

async function submitPrompt(
  context: RunContext,
  input: {
    scenarioName: string;
    stepLabel: string;
    promptMode: StudioPromptMode;
    promptText: string;
  },
): Promise<PromptSubmission> {
  const sessionStatusAtSubmit = await fetchSessionStatus(context.client, context.session.id, context.options.directory);
  const queuedWhileBusy = sessionStatusAtSubmit === "busy";
  const submittedAt = Date.now();

  let pendingChain: ChainRecord | null = null;
  let activeChain = context.currentChain;
  let steeringPromptsForEffective: string[] = [];

  if (input.promptMode === "run") {
    pendingChain = {
      chainId: `chain_${randomUUID()}`,
      chainIndex: context.chains.length + 1,
      sessionId: context.session.id,
      startedAt: submittedAt,
      basePromptText: input.promptText,
      steeringPrompts: [],
      submissionIds: [],
    };
    activeChain = pendingChain;
  } else {
    if (!activeChain) {
      throw new Error(`Cannot submit steer prompt without an active chain: ${input.stepLabel}`);
    }
    steeringPromptsForEffective = [...activeChain.steeringPrompts, input.promptText];
  }

  await context.client.session.promptAsync({
    path: { id: context.session.id },
    query: { directory: context.options.directory },
    body: {
      parts: [{ type: "text", text: input.promptText }],
    },
    throwOnError: true,
  });

  if (pendingChain) {
    context.chains.push(pendingChain);
    context.currentChain = pendingChain;
    activeChain = pendingChain;
  }

  if (!activeChain) {
    throw new Error(`Active chain missing after prompt submission: ${input.stepLabel}`);
  }

  const submission: PromptSubmission = {
    localPromptId: `prompt_${randomUUID()}`,
    submissionIndex: context.submissions.length + 1,
    sessionId: context.session.id,
    chainId: activeChain.chainId,
    chainIndex: activeChain.chainIndex,
    scenarioName: input.scenarioName,
    stepLabel: input.stepLabel,
    promptMode: input.promptMode,
    triggerKind: input.promptMode,
    submittedAt,
    sessionStatusAtSubmit,
    queuedWhileBusy,
    promptText: input.promptText,
    promptSteeringCount: input.promptMode === "run" ? 0 : steeringPromptsForEffective.length,
    promptTriggerText: input.promptText,
    effectivePrompt: input.promptMode === "run"
      ? buildEffectivePrompt(activeChain.basePromptText, [])
      : buildEffectivePrompt(activeChain.basePromptText, steeringPromptsForEffective),
    expectedReply: true,
  };

  context.submissions.push(submission);
  activeChain.submissionIds.push(submission.localPromptId);
  if (input.promptMode === "steer") {
    activeChain.steeringPrompts.push(input.promptText);
  }

  return submission;
}

async function waitForIdleAndRefreshAssistantCount(context: RunContext): Promise<{ messages: SessionMessageRecord[]; observedAssistantReplies: number }> {
  const before = context.expectedAssistantCount;
  const messages = await waitForSessionToBecomeIdle(
    context.client,
    context.session.id,
    context.options.directory,
    context.options.settleTimeoutMs,
    context.options.pollIntervalMs,
  );
  const after = countAssistantMessages(messages);
  context.expectedAssistantCount = after;
  return {
    messages,
    observedAssistantReplies: Math.max(0, after - before),
  };
}

function closeActiveChain(context: RunContext, observedAssistantReplies?: number): void {
  if (!context.currentChain) return;
  context.currentChain.completedAt = Date.now();
  if (observedAssistantReplies !== undefined) {
    context.currentChain.observedAssistantReplies = observedAssistantReplies;
  }
  context.currentChain = null;
}

function attachMatchesToSubmissions(
  chains: ChainRecord[],
  submissions: PromptSubmission[],
  normalizedMessages: NormalizedMessage[],
  initialMessageIds: Set<string>,
): MatchingDiagnostics {
  const newMessages = normalizedMessages.filter((message) => !initialMessageIds.has(message.id));
  const userMessages = newMessages.filter((message) => message.role === "user");
  const assistantMessages = newMessages.filter((message) => message.role === "assistant");

  const usedUserIds = new Set<string>();
  for (const submission of submissions) {
    const exactMatch = userMessages.find((message) => (
      !usedUserIds.has(message.id)
      && message.text === submission.promptText
      && message.created >= submission.submittedAt - 10_000
    ));
    const fallbackMatch = exactMatch
      ? null
      : userMessages.find((message) => !usedUserIds.has(message.id) && message.text === submission.promptText);
    const matchedUser = exactMatch ?? fallbackMatch;

    if (matchedUser) {
      usedUserIds.add(matchedUser.id);
      submission.userMessageId = matchedUser.id;
      submission.userMessageCreated = matchedUser.created;
    }
  }

  const usedAssistantIds = new Set<string>();
  let assistantCursor = 0;

  for (const chain of chains.slice().sort((a, b) => a.chainIndex - b.chainIndex)) {
    const chainSubmissions = submissions
      .filter((submission) => submission.chainId === chain.chainId && submission.expectedReply)
      .sort((a, b) => a.submissionIndex - b.submissionIndex);
    const observedAssistantReplies = chain.observedAssistantReplies ?? chainSubmissions.length;

    for (let i = 0; i < observedAssistantReplies && i < chainSubmissions.length; i++) {
      while (assistantCursor < assistantMessages.length && usedAssistantIds.has(assistantMessages[assistantCursor].id)) {
        assistantCursor += 1;
      }
      const matchedAssistant = assistantMessages[assistantCursor];
      if (!matchedAssistant) break;

      assistantCursor += 1;
      usedAssistantIds.add(matchedAssistant.id);

      const submission = chainSubmissions[i];
      submission.responseMessageId = matchedAssistant.id;
      submission.responseCreated = matchedAssistant.created;
      submission.responseCompleted = matchedAssistant.completed;
      submission.responseText = matchedAssistant.text;
      submission.responseError = matchedAssistant.error;
    }
  }

  return {
    initialMessageCount: initialMessageIds.size,
    newMessageCount: newMessages.length,
    newUserMessageCount: userMessages.length,
    newAssistantMessageCount: assistantMessages.length,
    missingUserMatches: submissions.filter((submission) => !submission.userMessageId).map((submission) => submission.localPromptId),
    missingResponseMatches: submissions.filter((submission) => submission.expectedReply && !submission.responseMessageId).map((submission) => submission.localPromptId),
    unassignedUserMessageIds: userMessages.filter((message) => !usedUserIds.has(message.id)).map((message) => message.id),
    unassignedAssistantMessageIds: assistantMessages.filter((message) => !usedAssistantIds.has(message.id)).map((message) => message.id),
  };
}

function buildResponseHistory(submissions: PromptSubmission[]): ResponseHistoryItem[] {
  return submissions
    .filter((submission) => submission.expectedReply)
    .sort((a, b) => a.submissionIndex - b.submissionIndex)
    .map((submission, index) => ({
      responseIndex: index + 1,
      localPromptId: submission.localPromptId,
      chainId: submission.chainId,
      chainIndex: submission.chainIndex,
      scenarioName: submission.scenarioName,
      stepLabel: submission.stepLabel,
      responseMessageId: submission.responseMessageId ?? null,
      responseText: submission.responseText ?? null,
      responseError: submission.responseError,
      promptMode: submission.promptMode === "run" ? "run" : "effective",
      triggerKind: submission.triggerKind,
      promptSteeringCount: submission.promptSteeringCount,
      promptTriggerText: submission.promptTriggerText,
      effectivePrompt: submission.effectivePrompt,
      queuedWhileBusy: submission.queuedWhileBusy,
      sessionStatusAtSubmit: submission.sessionStatusAtSubmit,
      userMessageId: submission.userMessageId ?? null,
    }));
}

function buildChainSummaries(chains: ChainRecord[], submissions: PromptSubmission[]): ChainSummary[] {
  return chains
    .slice()
    .sort((a, b) => a.chainIndex - b.chainIndex)
    .map((chain) => {
      const chainSubmissions = submissions.filter((submission) => submission.chainId === chain.chainId);
      return {
        chainId: chain.chainId,
        chainIndex: chain.chainIndex,
        sessionId: chain.sessionId,
        startedAt: chain.startedAt,
        completedAt: chain.completedAt,
        observedAssistantReplies: chain.observedAssistantReplies,
        basePromptText: chain.basePromptText,
        steeringPrompts: [...chain.steeringPrompts],
        submissionIds: [...chain.submissionIds],
        responseMessageIds: chainSubmissions
          .map((submission) => submission.responseMessageId)
          .filter((value): value is string => Boolean(value)),
        responseCount: chainSubmissions.filter((submission) => Boolean(submission.responseMessageId)).length,
      };
    });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.artifactsDir, { recursive: true });

  const eventsPath = resolve(options.artifactsDir, "events.jsonl");
  const messagesPath = resolve(options.artifactsDir, "messages-final.json");
  const promptSubmissionsPath = resolve(options.artifactsDir, "prompt-submissions.json");
  const historyPath = resolve(options.artifactsDir, "response-history.json");
  const chainsPath = resolve(options.artifactsDir, "chains.json");
  const matchingDiagnosticsPath = resolve(options.artifactsDir, "matching-diagnostics.json");
  const summaryPath = resolve(options.artifactsDir, "summary.json");

  const eventLogStream = createWriteStream(eventsPath, { flags: "a" });
  const sseController = new AbortController();

  let startedServer: { url: string; close(): void } | null = null;
  let client: ReturnType<typeof createOpencodeClient>;

  if (options.baseUrl) {
    client = createOpencodeClient({
      baseUrl: options.baseUrl,
      directory: options.directory,
    });
    console.log(`Connected to existing opencode server at ${options.baseUrl}`);
  } else {
    const runtime = await createOpencode({});
    client = runtime.client;
    startedServer = runtime.server;
    console.log(`Started local opencode server at ${runtime.server.url}`);
  }

  let eventLoop: Promise<void> | null = null;

  try {
    const events = await client.event.subscribe({
      query: { directory: options.directory },
      signal: sseController.signal,
      onSseError: (error) => {
        if (sseController.signal.aborted) return;
        console.error("[sse-error]", error);
      },
    });

    eventLoop = (async () => {
      for await (const event of events.stream as AsyncIterable<Event>) {
        const line = JSON.stringify({ ts: Date.now(), event }) + "\n";
        eventLogStream.write(line);
        console.log(`[event] ${summarizeEvent(event)}`);
      }
    })().catch((error: unknown) => {
      if (sseController.signal.aborted) return;
      console.error("Event stream failed:", error);
    });

    const session = await createOrReuseSession(client, options);
    console.log(`Using session ${session.id} (${session.title})`);

    const initialMessages = await fetchSessionMessages(client, session.id, options.directory);
    const initialMessageIds = new Set(initialMessages.map((entry) => entry.info.id));
    const context: RunContext = {
      client,
      session,
      options,
      chains: [],
      submissions: [],
      currentChain: null,
      expectedAssistantCount: countAssistantMessages(initialMessages),
    };
    const scenarioResults: ScenarioResult[] = [];

    console.log(`Initial session message count: ${initialMessages.length}`);

    console.log("Submitting initial run...");
    await submitPrompt(context, {
      scenarioName: "initial-queue",
      stepLabel: "run-1",
      promptMode: "run",
      promptText: options.runPrompt,
    });

    await sleep(options.queueDelayMs);

    console.log("Submitting first queued steer...");
    await submitPrompt(context, {
      scenarioName: "initial-queue",
      stepLabel: "steer-1",
      promptMode: "steer",
      promptText: options.queuePrompt,
    });

    let initialScenarioPromptCount = 2;
    if (options.multiSteerTest) {
      await sleep(options.secondQueueDelayMs);
      console.log("Submitting second queued steer...");
      await submitPrompt(context, {
        scenarioName: "multi-steer",
        stepLabel: "steer-2",
        promptMode: "steer",
        promptText: options.secondQueuePrompt,
      });
      initialScenarioPromptCount += 1;
    }

    const initialScenarioSettle = await waitForIdleAndRefreshAssistantCount(context);
    closeActiveChain(context, initialScenarioSettle.observedAssistantReplies);
    scenarioResults.push({
      scenarioName: "initial-queue",
      description: options.multiSteerTest
        ? "Started a run and queued two steering prompts before the session went idle."
        : "Started a run and queued one steering prompt before the session went idle.",
      submittedPromptCount: initialScenarioPromptCount,
      observedAssistantReplies: initialScenarioSettle.observedAssistantReplies,
    });

    if (options.newRunAfterIdleTest) {
      console.log("Submitting fresh run after idle...");
      await submitPrompt(context, {
        scenarioName: "fresh-run-after-idle",
        stepLabel: "run-2",
        promptMode: "run",
        promptText: options.secondRunPrompt,
      });

      const freshRunSettle = await waitForIdleAndRefreshAssistantCount(context);
      closeActiveChain(context, freshRunSettle.observedAssistantReplies);
      scenarioResults.push({
        scenarioName: "fresh-run-after-idle",
        description: "Started a fresh run in the same session after the previous chain had already settled.",
        submittedPromptCount: 1,
        observedAssistantReplies: freshRunSettle.observedAssistantReplies,
      });
    }

    if (options.abortTest) {
      console.log("Submitting fresh run for abort test...");
      const abortSubmission = await submitPrompt(context, {
        scenarioName: "abort-run",
        stepLabel: "run-abort",
        promptMode: "run",
        promptText: options.abortPrompt,
      });

      await sleep(options.abortDelayMs);
      abortSubmission.abortRequestedAt = Date.now();

      console.log("Aborting session...");
      const assistantCountBeforeAbortWait = context.expectedAssistantCount;
      await client.session.abort({
        path: { id: session.id },
        query: { directory: options.directory },
        throwOnError: true,
      });

      const abortMessages = await waitForSessionToBecomeIdle(
        client,
        session.id,
        options.directory,
        options.settleTimeoutMs,
        options.pollIntervalMs,
      );
      const assistantCountAfterAbort = countAssistantMessages(abortMessages);
      context.expectedAssistantCount = assistantCountAfterAbort;
      closeActiveChain(context, Math.max(0, assistantCountAfterAbort - assistantCountBeforeAbortWait));
      scenarioResults.push({
        scenarioName: "abort-run",
        description: "Started a fresh run after idle and then aborted it before completion.",
        submittedPromptCount: 1,
        observedAssistantReplies: Math.max(0, assistantCountAfterAbort - assistantCountBeforeAbortWait),
      });
    }

    const finalMessages = await fetchSessionMessages(client, session.id, options.directory);
    const normalizedMessages = finalMessages
      .map(normalizeMessage)
      .sort((a, b) => a.created - b.created);

    const matchingDiagnostics = attachMatchesToSubmissions(context.chains, context.submissions, normalizedMessages, initialMessageIds);
    const responseHistory = buildResponseHistory(context.submissions);
    const chainSummaries = buildChainSummaries(context.chains, context.submissions);

    await writeFile(messagesPath, JSON.stringify(normalizedMessages, null, 2));
    await writeFile(promptSubmissionsPath, JSON.stringify(context.submissions, null, 2));
    await writeFile(historyPath, JSON.stringify(responseHistory, null, 2));
    await writeFile(chainsPath, JSON.stringify(chainSummaries, null, 2));
    await writeFile(matchingDiagnosticsPath, JSON.stringify(matchingDiagnostics, null, 2));
    await writeFile(summaryPath, JSON.stringify({
      directory: options.directory,
      artifactsDir: options.artifactsDir,
      usedExistingServer: Boolean(options.baseUrl),
      baseUrl: options.baseUrl ?? startedServer?.url ?? null,
      session: {
        id: session.id,
        title: session.title,
      },
      counts: {
        initialMessages: initialMessages.length,
        finalMessages: finalMessages.length,
        finalAssistantMessages: countAssistantMessages(finalMessages),
        submittedPrompts: context.submissions.length,
        matchedUserMessages: context.submissions.filter((submission) => Boolean(submission.userMessageId)).length,
        matchedResponses: context.submissions.filter((submission) => Boolean(submission.responseMessageId)).length,
        chains: context.chains.length,
      },
      tests: {
        multiSteerTest: options.multiSteerTest,
        newRunAfterIdleTest: options.newRunAfterIdleTest,
        abortTest: options.abortTest,
      },
      scenarioResults,
      matchingDiagnostics,
      options,
    }, null, 2));

    console.log(`Wrote event log to ${eventsPath}`);
    console.log(`Wrote normalized messages to ${messagesPath}`);
    console.log(`Wrote prompt submissions to ${promptSubmissionsPath}`);
    console.log(`Wrote reconstructed response history to ${historyPath}`);
    console.log(`Wrote chain summaries to ${chainsPath}`);
    console.log(`Wrote matching diagnostics to ${matchingDiagnosticsPath}`);
    console.log(`Wrote summary to ${summaryPath}`);

    console.log("\nExplicitly reconstructed response history:\n");
    for (const item of responseHistory) {
      console.log(
        `Response ${item.responseIndex}: chain=${item.chainIndex}, scenario=${item.scenarioName}, trigger=${item.triggerKind}, mode=${item.promptMode}, steeringCount=${item.promptSteeringCount}, queuedWhileBusy=${item.queuedWhileBusy}`,
      );
      console.log(`  local prompt id: ${item.localPromptId}`);
      console.log(`  user message id: ${item.userMessageId ?? "(missing)"}`);
      console.log(`  response message id: ${item.responseMessageId ?? "(missing)"}`);
      console.log(`  trigger text: ${item.promptTriggerText.replace(/\s+/g, " ").slice(0, 140)}`);
      if (item.responseError) {
        console.log(`  response error: ${item.responseError}`);
      }
      console.log(`  response preview: ${(item.responseText || "").replace(/\s+/g, " ").slice(0, 140)}`);
      console.log("");
    }

    if (
      matchingDiagnostics.missingUserMatches.length > 0
      || matchingDiagnostics.missingResponseMatches.length > 0
      || matchingDiagnostics.unassignedUserMessageIds.length > 0
      || matchingDiagnostics.unassignedAssistantMessageIds.length > 0
    ) {
      console.log("Matching diagnostics detected some gaps:");
      console.log(JSON.stringify(matchingDiagnostics, null, 2));
    } else {
      console.log("Matching diagnostics: all submitted prompts matched cleanly to user and assistant messages.");
    }
  } finally {
    sseController.abort();
    eventLogStream.end();
    try {
      await eventLoop;
    } catch {
      // ignore shutdown race
    }
    if (startedServer) {
      startedServer.close();
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
