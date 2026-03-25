#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { startPrototypeServer, type PrototypeServerOptions } from "./prototype-server.js";

type LauncherOptions = PrototypeServerOptions & {
  openBrowser: boolean;
};

function parseArgs(argv: string[]): LauncherOptions {
  const options: LauncherOptions = {
    directory: process.cwd(),
    host: "127.0.0.1",
    port: 0,
    openBrowser: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--directory" && next) {
      options.directory = resolve(next);
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
    if (arg === "--no-open") {
      options.openBrowser = false;
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
  console.log(`Usage: pi-studio-opencode [options]

Options:
  --directory <path>    Project directory / working directory
  --base-url <url>      Use an existing opencode server
  --session <id>        Reuse an existing opencode session
  --title <title>       Title for a newly created session
  --host <host>         HTTP bind host for Studio (default: 127.0.0.1)
  --port <port>         HTTP bind port for Studio (default: 0 = auto-select)
  --no-open             Start Studio without opening a browser automatically
`);
  process.exit(0);
}

export async function openBrowserUrl(url: string): Promise<void> {
  await new Promise<void>((resolveOpen, rejectOpen) => {
    let command = "";
    let args: string[] = [];

    if (process.platform === "darwin") {
      command = "open";
      args = [url];
    } else if (process.platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", rejectOpen);
    child.once("spawn", () => {
      child.unref();
      resolveOpen();
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const instance = await startPrototypeServer(options);

  const shutdown = async (): Promise<void> => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await instance.stop();
  };

  const onSignal = (): void => {
    void shutdown().finally(() => process.exit(0));
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  console.log(`π Studio (opencode) ready at ${instance.url}`);
  console.log(`Session: ${instance.getState().sessionId ?? "(pending)"}`);
  console.log(`Working directory: ${options.directory}`);

  if (!options.openBrowser) {
    console.log("Browser launch skipped (--no-open).");
    return;
  }

  try {
    await openBrowserUrl(instance.url);
    console.log("Browser opened.");
  } catch (error) {
    console.warn(`Browser auto-open failed: ${error instanceof Error ? error.message : String(error)}`);
    console.warn(`Open manually: ${instance.url}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
