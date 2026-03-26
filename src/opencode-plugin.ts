import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Config, Event, OpencodeClient, Part } from "@opencode-ai/sdk";
import type { Plugin } from "@opencode-ai/plugin";
import { createPluginBackedOpencodeStudioHost, type PluginBackedOpencodeStudioHost } from "./host-opencode-plugin.js";
import { openBrowserUrl } from "./open-browser.js";
import {
  startPrototypeServer,
  type PrototypeModelCatalogEntry,
  type PrototypeServerInstance,
  type PrototypeServerOptions,
} from "./prototype-server.js";

const STUDIO_COMMAND_NAME = "studio";
const CANCEL_LAUNCH_MESSAGE = "PI_STUDIO_OPENCODE_COMMAND_HANDLED";
const COMMAND_DESCRIPTION = "Open π Studio attached to the current opencode session";
const COMMAND_TEMPLATE = "Open π Studio for this active opencode session.";
const FORBIDDEN_LAUNCHER_FLAGS = new Set(["--base-url", "--session", "--directory"]);

type PluginStudioLaunchOptions = Pick<PrototypeServerOptions, "host" | "port" | "title"> & {
  openBrowser: boolean;
};

type ActiveStudioBridge = {
  sessionId: string;
  directory: string;
  launchOptions: PluginStudioLaunchOptions;
  host: PluginBackedOpencodeStudioHost;
  instance: PrototypeServerInstance;
};

function tokenizeCommandArguments(input: string): string[] {
  const source = String(input ?? "").trim();
  if (!source) return [];

  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (escaping) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}

function sanitizeLauncherArgs(args: string[]): string[] {
  const sanitized: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const token = args[i]!;
    const eqIndex = token.indexOf("=");
    const flag = eqIndex >= 0 ? token.slice(0, eqIndex) : token;

    if (FORBIDDEN_LAUNCHER_FLAGS.has(flag)) {
      if (eqIndex < 0 && i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
        i += 1;
      }
      continue;
    }

    sanitized.push(token);
  }

  return sanitized;
}

function getExtraLauncherArgsFromEnvironment(): string[] {
  const raw = String(process.env.PI_STUDIO_OPENCODE_LAUNCH_ARGS ?? "").trim();
  if (!raw) return [];
  return sanitizeLauncherArgs(tokenizeCommandArguments(raw));
}

function getLauncherLogPathFromEnvironment(): string | null {
  const raw = String(process.env.PI_STUDIO_OPENCODE_CHILD_LOG ?? "").trim();
  return raw || null;
}

function appendLauncherLog(line: string): void {
  const logPath = getLauncherLogPathFromEnvironment();
  if (!logPath) return;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`, "utf8");
}

function parseFiniteContextLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

async function readPrototypeModelCatalog(client: OpencodeClient, directory: string): Promise<PrototypeModelCatalogEntry[]> {
  try {
    const response = await client.config.providers({
      query: { directory },
      throwOnError: true,
    });
    const providers = Array.isArray(response.data?.providers) ? response.data.providers : [];
    const catalog: PrototypeModelCatalogEntry[] = [];

    for (const provider of providers) {
      const providerID = typeof provider?.id === "string" ? provider.id.trim() : "";
      if (!providerID) continue;

      const models = provider?.models && typeof provider.models === "object"
        ? Object.entries(provider.models)
        : [];

      for (const [modelID, model] of models) {
        const normalizedModelID = typeof modelID === "string" ? modelID.trim() : "";
        if (!normalizedModelID) continue;

        catalog.push({
          providerID,
          modelID: normalizedModelID,
          contextLimit: parseFiniteContextLimit((model as { limit?: { context?: unknown } }).limit?.context),
        });
      }
    }

    return catalog;
  } catch (error) {
    appendLauncherLog(`model catalog load failed error=${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function ensureStudioCommand(config: Config): void {
  config.command ??= {};
  if (!config.command[STUDIO_COMMAND_NAME]) {
    config.command[STUDIO_COMMAND_NAME] = {
      template: COMMAND_TEMPLATE,
      description: COMMAND_DESCRIPTION,
    };
  }
}

function clearCommandParts(parts: Part[]): void {
  parts.splice(0, parts.length);
}

function parsePluginStudioLaunchArgs(args: string[]): PluginStudioLaunchOptions {
  const options: PluginStudioLaunchOptions = {
    host: "127.0.0.1",
    port: 0,
    openBrowser: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];

    if (arg === "--host" && next) {
      options.host = next;
      i += 1;
      continue;
    }
    if (arg === "--port" && next) {
      options.port = Number.parseInt(next, 10);
      if (!Number.isFinite(options.port) || options.port < 0) {
        throw new Error(`Invalid --port value: ${next}`);
      }
      i += 1;
      continue;
    }
    if (arg === "--title" && next) {
      options.title = next;
      i += 1;
      continue;
    }
    if (arg === "--no-open") {
      options.openBrowser = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error("/studio does not support --help yet. Supported flags: --host, --port, --title, --no-open");
    }
    throw new Error(`Unknown /studio argument: ${arg}`);
  }

  return options;
}

function sameLaunchOptions(a: PluginStudioLaunchOptions, b: PluginStudioLaunchOptions): boolean {
  return a.host === b.host
    && a.port === b.port
    && (a.title ?? "") === (b.title ?? "");
}

class StudioBridgeManager {
  private readonly bridges = new Map<string, ActiveStudioBridge>();
  private cleanupInstalled = false;

  constructor(private readonly ctx: Parameters<Plugin>[0]) {}

  private installCleanup(): void {
    if (this.cleanupInstalled) return;
    this.cleanupInstalled = true;

    process.once("exit", () => {
      void this.stopAll();
    });
  }

  async openStudio(input: {
    sessionId: string;
    directory: string;
    launchOptions: PluginStudioLaunchOptions;
  }): Promise<PrototypeServerInstance> {
    this.installCleanup();

    const existing = this.bridges.get(input.sessionId);
    if (existing && existing.directory === input.directory && sameLaunchOptions(existing.launchOptions, input.launchOptions)) {
      appendLauncherLog(`reuse session=${input.sessionId} url=${existing.instance.url}`);
      await this.maybeOpenBrowser(existing.instance.url, input.launchOptions.openBrowser);
      return existing.instance;
    }

    if (existing) {
      await existing.instance.stop();
      this.bridges.delete(input.sessionId);
    }

    const modelCatalog = await readPrototypeModelCatalog(this.ctx.client, input.directory);

    let hostRef: PluginBackedOpencodeStudioHost | null = null;
    const instance = await startPrototypeServer({
      directory: input.directory,
      sessionId: input.sessionId,
      title: input.launchOptions.title,
      host: input.launchOptions.host,
      port: input.launchOptions.port,
      consoleLogs: false,
      modelCatalog,
    }, async ({ options, eventLogger, telemetryListener }) => {
      hostRef = await createPluginBackedOpencodeStudioHost({
        client: this.ctx.client,
        directory: options.directory,
        sessionId: options.sessionId,
        title: options.title,
        eventLogger,
        telemetryListener,
      });
      return hostRef;
    });

    if (!hostRef) {
      await instance.stop();
      throw new Error("Failed to initialize plugin-backed Studio host.");
    }

    const bridge: ActiveStudioBridge = {
      sessionId: input.sessionId,
      directory: input.directory,
      launchOptions: { ...input.launchOptions },
      host: hostRef,
      instance,
    };
    this.bridges.set(input.sessionId, bridge);

    appendLauncherLog(`bridge ready session=${input.sessionId} url=${instance.url}`);
    await this.maybeOpenBrowser(instance.url, input.launchOptions.openBrowser);
    return instance;
  }

  async handleEvent(event: Event): Promise<void> {
    const active = [...this.bridges.values()];
    if (active.length === 0) return;
    await Promise.allSettled(active.map(async (bridge) => {
      await bridge.host.ingestEvent(event);
    }));
  }

  private async maybeOpenBrowser(url: string, openBrowser: boolean): Promise<void> {
    if (!openBrowser) {
      appendLauncherLog(`browser skipped url=${url}`);
      await this.showToast(`π Studio ready: ${url}`, "info");
      return;
    }

    try {
      await openBrowserUrl(url);
      appendLauncherLog(`browser opened url=${url}`);
      await this.showToast("Opened π Studio in your browser.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLauncherLog(`browser open failed url=${url} error=${message}`);
      await this.showToast(`π Studio ready: ${url}`, "warning");
    }
  }

  private async showToast(message: string, variant: "info" | "success" | "warning" | "error"): Promise<void> {
    try {
      await this.ctx.client.tui.showToast({
        query: { directory: this.ctx.directory },
        body: {
          title: "π Studio",
          message,
          variant,
          duration: 4500,
        },
        throwOnError: true,
      });
    } catch {
      // ignore toast failures; the browser URL is still logged if logging is enabled
    }
  }

  private async stopAll(): Promise<void> {
    const active = [...this.bridges.values()];
    this.bridges.clear();
    await Promise.allSettled(active.map(async (bridge) => {
      await bridge.instance.stop();
    }));
  }
}

export const PiStudioOpencodePlugin: Plugin = async (ctx) => {
  const bridgeManager = new StudioBridgeManager(ctx);

  return {
    config: async (config) => {
      ensureStudioCommand(config);
    },
    event: async ({ event }) => {
      await bridgeManager.handleEvent(event);
    },
    "command.execute.before": async (input, output) => {
      if (input.command !== STUDIO_COMMAND_NAME) {
        return;
      }

      clearCommandParts(output.parts);
      const launchOptions = parsePluginStudioLaunchArgs([
        ...getExtraLauncherArgsFromEnvironment(),
        ...sanitizeLauncherArgs(tokenizeCommandArguments(input.arguments)),
      ]);
      await bridgeManager.openStudio({
        sessionId: input.sessionID,
        directory: ctx.directory,
        launchOptions,
      });
      throw new Error(CANCEL_LAUNCH_MESSAGE);
    },
  };
};

export default PiStudioOpencodePlugin;
