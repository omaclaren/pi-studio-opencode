import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_STUDIO_COMMAND_NAME,
  formatOpencodeConfig,
  mergePiStudioOpencodeIntoConfig,
  mergePiStudioOpencodeIntoTuiConfig,
  parseOpencodeConfigText,
  type MergePiStudioTuiConfigResult,
  type MergePiStudioOpencodeConfigResult,
  type OpencodeConfigFile,
  type TuiConfigFile,
} from "./install-config.js";

const DEFAULT_PUBLISHED_PLUGIN_SPEC = "pi-studio-opencode@latest";
const DEFAULT_PACKAGE_NAME = "pi-studio-opencode";

type InstallOptions = {
  configPath?: string;
  projectDir?: string;
  pluginSpec: string;
  packageName: string;
  commandName: string;
};

export type InstallConfigResult = MergePiStudioOpencodeConfigResult & {
  configPath: string;
  tuiConfigPath: string;
  tui: MergePiStudioTuiConfigResult;
  scope: "user" | "project" | "explicit";
};

function expandHome(input: string): string {
  if (!input) return input;
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return join(homedir(), input.slice(2));
  return input;
}

function getXdgConfigDirectory(): string {
  const configured = String(process.env.XDG_CONFIG_HOME ?? "").trim();
  return configured || join(homedir(), ".config");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function pickExistingConfigPath(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

function resolveExplicitTuiConfigPath(configPath: string): string {
  const resolvedPath = resolve(expandHome(configPath));
  const name = resolvedPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (name === "tui.json" || name === "tui.jsonc") {
    return resolvedPath;
  }
  return join(dirname(resolvedPath), "tui.json");
}

async function resolveInstallConfigPaths(options: InstallOptions): Promise<{
  opencodePath: string;
  tuiPath: string;
  scope: InstallConfigResult["scope"];
}> {
  if (options.configPath) {
    return {
      opencodePath: resolve(expandHome(options.configPath)),
      tuiPath: resolveExplicitTuiConfigPath(options.configPath),
      scope: "explicit",
    };
  }

  if (options.projectDir) {
    const directory = resolve(expandHome(options.projectDir));
    return {
      opencodePath: await pickExistingConfigPath([
        join(directory, ".opencode", "opencode.jsonc"),
        join(directory, ".opencode", "opencode.json"),
      ]),
      tuiPath: await pickExistingConfigPath([
        join(directory, ".opencode", "tui.json"),
        join(directory, ".opencode", "tui.jsonc"),
      ]),
      scope: "project",
    };
  }

  const configDir = getXdgConfigDirectory();
  return {
    opencodePath: await pickExistingConfigPath([
      join(configDir, "opencode", "opencode.jsonc"),
      join(configDir, "opencode", "opencode.json"),
    ]),
    tuiPath: await pickExistingConfigPath([
      join(configDir, "opencode", "tui.json"),
      join(configDir, "opencode", "tui.jsonc"),
    ]),
    scope: "user",
  };
}

async function readExistingConfig(path: string): Promise<OpencodeConfigFile> {
  try {
    return parseOpencodeConfigText(await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return {};
    }
    throw new Error(`Failed to read OpenCode config at ${path}: ${message}`);
  }
}

async function readExistingTuiConfig(path: string): Promise<TuiConfigFile> {
  return readExistingConfig(path) as Promise<TuiConfigFile>;
}

export async function installPiStudioOpencode(options: InstallOptions): Promise<InstallConfigResult> {
  const target = await resolveInstallConfigPaths(options);
  const config = await readExistingConfig(target.opencodePath);
  const tuiConfig = await readExistingTuiConfig(target.tuiPath);
  const result = mergePiStudioOpencodeIntoConfig(config, {
    pluginSpec: options.pluginSpec,
    packageName: options.packageName,
    commandName: options.commandName,
  });
  const tuiResult = mergePiStudioOpencodeIntoTuiConfig(tuiConfig, {
    pluginSpec: options.pluginSpec,
    packageName: options.packageName,
  });

  if (result.changed || !(await pathExists(target.opencodePath))) {
    await mkdir(dirname(target.opencodePath), { recursive: true });
    await writeFile(target.opencodePath, formatOpencodeConfig(result.config), "utf8");
  }

  if (tuiResult.changed || !(await pathExists(target.tuiPath))) {
    await mkdir(dirname(target.tuiPath), { recursive: true });
    await writeFile(target.tuiPath, formatOpencodeConfig(tuiResult.config), "utf8");
  }

  return {
    ...result,
    configPath: target.opencodePath,
    tuiConfigPath: target.tuiPath,
    tui: tuiResult,
    scope: target.scope,
  };
}

function printInstallUsageAndExit(): never {
  console.log(`Usage: pi-studio-opencode install [options]

Options:
  --project [path]      Install into .opencode/opencode.jsonc for the current directory or the given path
  --config <path>       Install into an explicit OpenCode config file
  --plugin <spec>       Plugin spec to write (default: ${DEFAULT_PUBLISHED_PLUGIN_SPEC})
  --help, -h            Show this help
`);
  process.exit(0);
}

export function parseInstallArgs(argv: string[]): InstallOptions {
  const options: InstallOptions = {
    pluginSpec: DEFAULT_PUBLISHED_PLUGIN_SPEC,
    packageName: DEFAULT_PACKAGE_NAME,
    commandName: DEFAULT_STUDIO_COMMAND_NAME,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--project") {
      if (options.configPath) {
        throw new Error("Use either --project or --config, not both.");
      }
      if (next && !next.startsWith("-")) {
        options.projectDir = next;
        i += 1;
      } else {
        options.projectDir = process.cwd();
      }
      continue;
    }

    if (arg === "--config" && next) {
      if (options.projectDir) {
        throw new Error("Use either --project or --config, not both.");
      }
      options.configPath = next;
      i += 1;
      continue;
    }

    if (arg === "--plugin" && next) {
      options.pluginSpec = next;
      i += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printInstallUsageAndExit();
    }

    throw new Error(`Unknown install argument: ${arg}`);
  }

  return options;
}

export async function runInstallCli(argv: string[]): Promise<void> {
  const options = parseInstallArgs(argv);
  const result = await installPiStudioOpencode(options);

  console.log(`Updated OpenCode config: ${result.configPath}`);
  console.log(`Updated OpenCode TUI config: ${result.tuiConfigPath}`);
  console.log(`Scope: ${result.scope}`);

  if (result.addedPlugin) {
    console.log(`Added plugin: ${options.pluginSpec}`);
  } else if (result.existingPluginSpec) {
    console.log(`Plugin already configured: ${result.existingPluginSpec}`);
  }

  if (result.removedCommand) {
    console.log(`Removed legacy /${options.commandName} command entry.`);
  }
  console.log(`/${options.commandName} is provided by the plug-in itself.`);

  if (result.setSchema) {
    console.log("Set OpenCode config schema.");
  }
  if (result.tui.setSchema) {
    console.log("Set OpenCode TUI config schema.");
  }

  if (!result.changed && !result.tui.changed) {
    console.log("No changes were needed.");
  }

  console.log("Restart OpenCode, then run /studio from an active session.");
}
