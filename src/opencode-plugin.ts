import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "@opencode-ai/sdk";
import type { OpencodeClient as TuiOpencodeClient } from "@opencode-ai/sdk/v2";
import type { Plugin } from "@opencode-ai/plugin";
import { openBrowserUrl } from "./open-browser.js";
import {
  startPrototypeServer,
  type PrototypeServerInstance,
  type PrototypeServerOptions,
} from "./prototype-server.js";

const STUDIO_COMMAND_NAME = "studio";
const COMMAND_DESCRIPTION = "Open π Studio attached to the current opencode session";
const COMMAND_TEMPLATE = "Open π Studio for this active opencode session.";
const FORBIDDEN_LAUNCHER_FLAGS = new Set(["--base-url", "--session", "--directory"]);

type PluginStudioLaunchOptions = Pick<PrototypeServerOptions, "host" | "port" | "title"> & {
  openBrowser: boolean;
};

type StudioToastVariant = "info" | "success" | "warning" | "error";

type StudioTuiCommand = {
  title: string;
  value: string;
  description?: string;
  category?: string;
  enabled?: boolean;
  slash?: {
    name: string;
    aliases?: string[];
  };
  onSelect?: () => void | Promise<void>;
};

type StudioTuiApi = {
  command: {
    register: (cb: () => StudioTuiCommand[]) => unknown;
  };
  route: {
    current: {
      name: string;
      params?: Record<string, unknown>;
    };
    navigate: (name: string, params?: Record<string, unknown>) => void;
  };
  ui: {
    toast: (input: {
      title?: string;
      message: string;
      variant: StudioToastVariant;
      duration?: number;
    }) => void;
  };
  state: {
    path: {
      directory: string;
    };
  };
  client: TuiOpencodeClient;
  lifecycle: {
    onDispose: (fn: () => void | Promise<void>) => unknown;
  };
};

type ActiveStudioSurface = {
  sessionId: string;
  directory: string;
  baseUrl: string;
  launchOptions: PluginStudioLaunchOptions;
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

function isLegacyStudioCommandEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const template = typeof (entry as { template?: unknown }).template === "string"
    ? (entry as { template: string }).template.trim()
    : "";
  const description = typeof (entry as { description?: unknown }).description === "string"
    ? (entry as { description: string }).description.trim()
    : "";

  if (template !== COMMAND_TEMPLATE) return false;
  return !description || description === COMMAND_DESCRIPTION;
}

function removeLegacyStudioCommand(config: Config): void {
  const commands = config.command;
  if (!commands || typeof commands !== "object") return;
  if (!isLegacyStudioCommandEntry(commands[STUDIO_COMMAND_NAME])) return;
  delete commands[STUDIO_COMMAND_NAME];
  if (Object.keys(commands).length === 0) {
    delete config.command;
  }
}

function readTuiSessionId(api: StudioTuiApi): string | null {
  if (api.route.current.name !== "session") return null;
  const sessionId = api.route.current.params?.sessionID;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId : null;
}

async function ensureTuiSessionId(api: StudioTuiApi): Promise<string> {
  const existing = readTuiSessionId(api);
  if (existing) return existing;

  const sessionClient = api.client.session;
  if (!sessionClient?.create) {
    throw new Error("Could not create an OpenCode session for /studio.");
  }

  const created = await sessionClient.create({
    directory: api.state.path.directory,
  }, {
    throwOnError: true,
  });
  const sessionId = created.data?.id;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new Error("OpenCode did not return a session id for /studio.");
  }

  api.route.navigate("session", { sessionID: sessionId });
  return sessionId;
}

function readTuiBaseUrl(api: StudioTuiApi): string | null {
  const baseUrl = (api.client as unknown as {
    client?: {
      getConfig?: () => {
        baseUrl?: string;
      };
    };
  }).client?.getConfig?.().baseUrl;
  return typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : null;
}

class StudioSurfaceManager {
  private readonly surfaces = new Map<string, ActiveStudioSurface>();

  async openStudio(input: {
    sessionId: string;
    directory: string;
    baseUrl: string;
    clientV2: TuiOpencodeClient;
    launchOptions: PluginStudioLaunchOptions;
    showToast: (message: string, variant: StudioToastVariant) => void;
  }): Promise<PrototypeServerInstance> {
    const existing = this.surfaces.get(input.sessionId);
    if (
      existing
      && existing.directory === input.directory
      && existing.baseUrl === input.baseUrl
      && sameLaunchOptions(existing.launchOptions, input.launchOptions)
    ) {
      appendLauncherLog(`reuse session=${input.sessionId} url=${existing.instance.url}`);
      await this.maybeOpenBrowser(existing.instance.url, input.launchOptions.openBrowser, input.showToast);
      return existing.instance;
    }

    if (existing) {
      await existing.instance.stop();
      this.surfaces.delete(input.sessionId);
    }

    const instance = await startPrototypeServer({
      directory: input.directory,
      baseUrl: input.baseUrl,
      clientV2: input.clientV2,
      sessionId: input.sessionId,
      title: input.launchOptions.title,
      host: input.launchOptions.host,
      port: input.launchOptions.port,
      consoleLogs: false,
    });

    this.surfaces.set(input.sessionId, {
      sessionId: input.sessionId,
      directory: input.directory,
      baseUrl: input.baseUrl,
      launchOptions: { ...input.launchOptions },
      instance,
    });

    appendLauncherLog(`surface ready session=${input.sessionId} url=${instance.url}`);
    await this.maybeOpenBrowser(instance.url, input.launchOptions.openBrowser, input.showToast);
    return instance;
  }

  async stopAll(): Promise<void> {
    const active = [...this.surfaces.values()];
    this.surfaces.clear();
    await Promise.allSettled(active.map(async (surface) => {
      await surface.instance.stop();
    }));
  }

  private async maybeOpenBrowser(
    url: string,
    openBrowser: boolean,
    showToast: (message: string, variant: StudioToastVariant) => void,
  ): Promise<void> {
    if (!openBrowser) {
      appendLauncherLog(`browser skipped url=${url}`);
      showToast(`π Studio ready: ${url}`, "info");
      return;
    }

    try {
      await openBrowserUrl(url);
      appendLauncherLog(`browser opened url=${url}`);
      showToast("Opened π Studio in your browser.", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLauncherLog(`browser open failed url=${url} error=${message}`);
      showToast(`π Studio ready: ${url}`, "warning");
    }
  }
}

export const PiStudioOpencodePlugin: Plugin = async () => {
  return {
    config: async (config) => {
      removeLegacyStudioCommand(config);
    },
  };
};

export async function PiStudioOpencodeTuiPlugin(api: StudioTuiApi): Promise<void> {
  const surfaceManager = new StudioSurfaceManager();
  const showToast = (message: string, variant: StudioToastVariant): void => {
    api.ui.toast({
      title: "π Studio",
      message,
      variant,
      duration: 4500,
    });
  };

  api.lifecycle.onDispose(() => surfaceManager.stopAll());

  api.command.register(() => [
    {
      title: "Open π Studio",
      value: "pi-studio-opencode.open",
      description: COMMAND_DESCRIPTION,
      category: "Plugin",
      slash: {
        name: STUDIO_COMMAND_NAME,
      },
      onSelect: async () => {
        const baseUrl = readTuiBaseUrl(api);
        if (!baseUrl) {
          showToast("Could not determine the OpenCode server URL for /studio.", "error");
          return;
        }

        let sessionId = readTuiSessionId(api) ?? "unknown";
        try {
          sessionId = await ensureTuiSessionId(api);
          const launchOptions = parsePluginStudioLaunchArgs(getExtraLauncherArgsFromEnvironment());
          await surfaceManager.openStudio({
            sessionId,
            directory: api.state.path.directory,
            baseUrl,
            clientV2: api.client,
            launchOptions,
            showToast,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          appendLauncherLog(`tui launch failed session=${sessionId} error=${message}`);
          showToast(message, "error");
        }
      },
    },
  ]);
}

export const PiStudioOpencodePluginModule = {
  id: "pi-studio-opencode",
  server: PiStudioOpencodePlugin,
};

export default PiStudioOpencodePluginModule;
