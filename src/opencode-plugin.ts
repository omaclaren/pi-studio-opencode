import { spawn, type StdioOptions } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config, Part } from "@opencode-ai/sdk";
import type { Plugin } from "@opencode-ai/plugin";

const STUDIO_COMMAND_NAME = "studio";
const CANCEL_LAUNCH_MESSAGE = "PI_STUDIO_OPENCODE_COMMAND_HANDLED";
const COMMAND_DESCRIPTION = "Open π Studio attached to the current opencode session";
const COMMAND_TEMPLATE = "Open π Studio for this active opencode session.";
const FORBIDDEN_LAUNCHER_FLAGS = new Set(["--base-url", "--session", "--directory"]);

function getLauncherExecutable(): string {
  const override = String(process.env.PI_STUDIO_OPENCODE_EXECUTABLE ?? "").trim();
  if (override) return override;
  return "node";
}

function getLauncherScriptPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return resolve(dirname(currentFile), "launcher.js");
}

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

function launchStudioBrowser(input: {
  launcherArgs: string[];
  directory: string;
  baseUrl: string;
  sessionId: string;
}): void {
  const launcherScriptPath = getLauncherScriptPath();
  if (!existsSync(launcherScriptPath)) {
    throw new Error(`Studio launcher was not found at ${launcherScriptPath}`);
  }

  const argv = [
    launcherScriptPath,
    "--directory",
    input.directory,
    "--base-url",
    input.baseUrl,
    "--session",
    input.sessionId,
    ...input.launcherArgs,
  ];

  const logPath = getLauncherLogPathFromEnvironment();
  let stdio: StdioOptions = "ignore";
  if (logPath) {
    mkdirSync(dirname(logPath), { recursive: true });
    const fd = openSync(logPath, "a");
    stdio = ["ignore", fd, fd];
  }

  const executable = getLauncherExecutable();
  appendLauncherLog(`spawn exec=${executable} argv=${JSON.stringify(argv)}`);
  const child = spawn(executable, argv, {
    cwd: input.directory,
    detached: true,
    stdio,
    env: {
      ...process.env,
    },
  });

  child.once("error", (error: Error) => {
    appendLauncherLog(`spawn error: ${error instanceof Error ? error.message : String(error)}`);
  });
  child.unref();
}

export const PiStudioOpencodePlugin: Plugin = async (ctx) => {
  return {
    config: async (config) => {
      ensureStudioCommand(config);
    },
    "command.execute.before": async (input, output) => {
      if (input.command !== STUDIO_COMMAND_NAME) {
        return;
      }

      clearCommandParts(output.parts);
      const launcherArgs = [
        ...getExtraLauncherArgsFromEnvironment(),
        ...sanitizeLauncherArgs(tokenizeCommandArguments(input.arguments)),
      ];
      launchStudioBrowser({
        launcherArgs,
        directory: ctx.directory,
        baseUrl: ctx.serverUrl.toString(),
        sessionId: input.sessionID,
      });
      throw new Error(CANCEL_LAUNCH_MESSAGE);
    },
  };
};

export default PiStudioOpencodePlugin;
