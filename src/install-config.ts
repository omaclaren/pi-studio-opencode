import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";
export const OPENCODE_TUI_CONFIG_SCHEMA = "https://opencode.ai/tui.json";
export const DEFAULT_STUDIO_COMMAND_NAME = "studio";
export const DEFAULT_STUDIO_COMMAND_TEMPLATE = "Open π Studio for this active opencode session.";
export const DEFAULT_STUDIO_COMMAND_DESCRIPTION = "Open π Studio attached to the current opencode session";

export type PluginConfigEntry = string | [string, Record<string, unknown>];

export type OpencodeCommandEntry = {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  [key: string]: unknown;
};

export type OpencodeConfigFile = {
  $schema?: string;
  plugin?: PluginConfigEntry[];
  command?: Record<string, OpencodeCommandEntry>;
  [key: string]: unknown;
};

export type TuiConfigFile = {
  $schema?: string;
  plugin?: PluginConfigEntry[];
  plugin_enabled?: Record<string, boolean>;
  [key: string]: unknown;
};

export type MergePiStudioPluginConfigResult<ConfigFile extends { $schema?: string; plugin?: PluginConfigEntry[] }> = {
  config: ConfigFile;
  changed: boolean;
  addedPlugin: boolean;
  setSchema: boolean;
  existingPluginSpec: string | null;
};

export type MergePiStudioOpencodeConfigResult = MergePiStudioPluginConfigResult<OpencodeConfigFile> & {
  addedCommand: boolean;
  removedCommand: boolean;
};

export type MergePiStudioTuiConfigResult = MergePiStudioPluginConfigResult<TuiConfigFile>;

function isLegacyStudioCommandEntry(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const template = typeof (entry as { template?: unknown }).template === "string"
    ? (entry as { template: string }).template.trim()
    : "";
  const description = typeof (entry as { description?: unknown }).description === "string"
    ? (entry as { description: string }).description.trim()
    : "";

  if (template !== DEFAULT_STUDIO_COMMAND_TEMPLATE) return false;
  return !description || description === DEFAULT_STUDIO_COMMAND_DESCRIPTION;
}

export function stripJsonComments(input: string): string {
  let out = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    const next = input[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      out += ch;
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    out += ch;
  }

  return out;
}

export function parseOpencodeConfigText(text: string): OpencodeConfigFile {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(stripJsonComments(text)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OpenCode config must be a JSON object.");
  }
  return parsed as OpencodeConfigFile;
}

function readPluginSpecifier(entry: PluginConfigEntry): string {
  return Array.isArray(entry) ? entry[0] : entry;
}

function isLikelyPathSpec(spec: string): boolean {
  return spec.startsWith("file://")
    || spec.startsWith("/")
    || spec.startsWith("./")
    || spec.startsWith("../")
    || spec.startsWith("~/")
    || /^[A-Za-z]:[\\/]/.test(spec);
}

function normalizePackageSpec(spec: string): string {
  const trimmed = spec.trim();
  const lastAtIndex = trimmed.lastIndexOf("@");
  return lastAtIndex > 0 ? trimmed.slice(0, lastAtIndex) : trimmed;
}

export function normalizePluginIdentity(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return "";

  if (isLikelyPathSpec(trimmed)) {
    const pathValue = trimmed.startsWith("file://") ? fileURLToPath(trimmed) : trimmed;
    return basename(pathValue.replace(/[\\/]+$/, "")).toLowerCase();
  }

  return normalizePackageSpec(trimmed).toLowerCase();
}

export function formatOpencodeConfig(config: Record<string, unknown>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

function mergePiStudioPluginIntoConfig<ConfigFile extends { $schema?: string; plugin?: PluginConfigEntry[] }>(
  config: ConfigFile,
  schema: string,
  options?: {
    pluginSpec?: string;
    packageName?: string;
  },
): MergePiStudioPluginConfigResult<ConfigFile> {
  const pluginSpec = options?.pluginSpec?.trim() || "pi-studio-opencode@latest";
  const packageName = options?.packageName?.trim() || "pi-studio-opencode";
  const packageIdentity = normalizePluginIdentity(packageName);

  const existingPlugins = Array.isArray(config.plugin) ? [...config.plugin] : [];
  const existingPluginEntry = existingPlugins.find((entry) => normalizePluginIdentity(readPluginSpecifier(entry)) === packageIdentity);
  const existingPluginSpec = existingPluginEntry ? readPluginSpecifier(existingPluginEntry) : null;
  const addedPlugin = !existingPluginEntry;
  const plugin = addedPlugin ? [...existingPlugins, pluginSpec] : existingPlugins;
  const setSchema = !config.$schema;

  return {
    config: {
      ...config,
      ...(setSchema ? { $schema: schema } : {}),
      plugin,
    },
    changed: addedPlugin || setSchema,
    addedPlugin,
    setSchema,
    existingPluginSpec,
  };
}

export function mergePiStudioOpencodeIntoConfig(
  config: OpencodeConfigFile,
  options?: {
    pluginSpec?: string;
    packageName?: string;
    commandName?: string;
  },
): MergePiStudioOpencodeConfigResult {
  const commandName = options?.commandName?.trim() || DEFAULT_STUDIO_COMMAND_NAME;
  const pluginResult = mergePiStudioPluginIntoConfig(config, OPENCODE_CONFIG_SCHEMA, options);

  const existingCommands = config.command && typeof config.command === "object" && !Array.isArray(config.command)
    ? { ...config.command }
    : {};
  const addedCommand = false;
  const removedCommand = isLegacyStudioCommandEntry(existingCommands[commandName]);
  if (removedCommand) {
    delete existingCommands[commandName];
  }

  const nextConfig: OpencodeConfigFile = {
    ...pluginResult.config,
  };
  if (config.command) {
    if (Object.keys(existingCommands).length > 0) {
      nextConfig.command = existingCommands;
    } else {
      delete nextConfig.command;
    }
  }

  return {
    config: nextConfig,
    changed: pluginResult.changed || removedCommand,
    addedPlugin: pluginResult.addedPlugin,
    addedCommand,
    removedCommand,
    setSchema: pluginResult.setSchema,
    existingPluginSpec: pluginResult.existingPluginSpec,
  };
}

export function mergePiStudioOpencodeIntoTuiConfig(
  config: TuiConfigFile,
  options?: {
    pluginSpec?: string;
    packageName?: string;
  },
): MergePiStudioTuiConfigResult {
  return mergePiStudioPluginIntoConfig(config, OPENCODE_TUI_CONFIG_SCHEMA, options);
}
