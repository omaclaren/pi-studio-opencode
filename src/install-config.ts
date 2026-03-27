import { basename } from "node:path";
import { fileURLToPath } from "node:url";

export const OPENCODE_CONFIG_SCHEMA = "https://opencode.ai/config.json";
export const DEFAULT_STUDIO_COMMAND_NAME = "studio";
export const DEFAULT_STUDIO_COMMAND_TEMPLATE = "Open π Studio for this active opencode session.";
export const DEFAULT_STUDIO_COMMAND_DESCRIPTION = "Open π Studio attached to the current opencode session";

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
  plugin?: string[];
  command?: Record<string, OpencodeCommandEntry>;
  [key: string]: unknown;
};

export type MergePiStudioOpencodeConfigResult = {
  config: OpencodeConfigFile;
  changed: boolean;
  addedPlugin: boolean;
  addedCommand: boolean;
  setSchema: boolean;
  existingPluginSpec: string | null;
};

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

export function buildStudioCommandEntry(): OpencodeCommandEntry {
  return {
    template: DEFAULT_STUDIO_COMMAND_TEMPLATE,
    description: DEFAULT_STUDIO_COMMAND_DESCRIPTION,
  };
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

export function formatOpencodeConfig(config: OpencodeConfigFile): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function mergePiStudioOpencodeIntoConfig(
  config: OpencodeConfigFile,
  options?: {
    pluginSpec?: string;
    packageName?: string;
    commandName?: string;
  },
): MergePiStudioOpencodeConfigResult {
  const pluginSpec = options?.pluginSpec?.trim() || "pi-studio-opencode@latest";
  const packageName = options?.packageName?.trim() || "pi-studio-opencode";
  const commandName = options?.commandName?.trim() || DEFAULT_STUDIO_COMMAND_NAME;
  const packageIdentity = normalizePluginIdentity(packageName);

  const existingPlugins = Array.isArray(config.plugin) ? [...config.plugin] : [];
  const existingPluginSpec = existingPlugins.find((entry) => normalizePluginIdentity(entry) === packageIdentity) ?? null;
  const addedPlugin = !existingPluginSpec;
  const plugin = addedPlugin ? [...existingPlugins, pluginSpec] : existingPlugins;

  const existingCommands = config.command && typeof config.command === "object" && !Array.isArray(config.command)
    ? { ...config.command }
    : {};
  const addedCommand = !existingCommands[commandName];
  if (addedCommand) {
    existingCommands[commandName] = buildStudioCommandEntry();
  }

  const setSchema = !config.$schema;

  const nextConfig: OpencodeConfigFile = {
    ...config,
    ...(setSchema ? { $schema: OPENCODE_CONFIG_SCHEMA } : {}),
    plugin,
    command: existingCommands,
  };

  return {
    config: nextConfig,
    changed: addedPlugin || addedCommand || setSchema,
    addedPlugin,
    addedCommand,
    setSchema,
    existingPluginSpec,
  };
}
