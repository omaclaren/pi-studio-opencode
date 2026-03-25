import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type PrototypeThemePreference = "light" | "dark" | "system";
export type PrototypeThemeSource = "opencode-local-state" | "opencode-config" | "default";

export type PrototypeThemeRecord = Record<string, string>;

export type PrototypeThemeDescriptor = {
  raw: string | null;
  preference: PrototypeThemePreference;
  source: PrototypeThemeSource;
  family: string | null;
  darkVars: PrototypeThemeRecord;
  lightVars: PrototypeThemeRecord;
};

type PrototypePaletteSeed = {
  bg: string;
  panel: string;
  panel2: string;
  text: string;
  muted: string;
  accent: string;
  warn: string;
  error: string;
  ok: string;
  mdHeading: string;
  mdLink: string;
  mdLinkUrl: string;
  mdCode: string;
  mdQuote: string;
  mdListBullet: string;
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxFunction: string;
  syntaxVariable: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxOperator: string;
  border?: string;
  borderMuted?: string;
  accentSoft?: string;
  accentSoftStrong?: string;
  markerBorder?: string;
  accentContrast?: string;
  errorContrast?: string;
  editorBg?: string;
  panelShadow?: string;
};

type PrototypeThemeFamilyDefinition = {
  id: string;
  match: RegExp;
  preference?: PrototypeThemePreference;
  dark?: Partial<PrototypePaletteSeed>;
  light?: Partial<PrototypePaletteSeed>;
};

const BASE_DARK_PALETTE: PrototypePaletteSeed = {
  bg: "#0f141b",
  panel: "#171b24",
  panel2: "#11161f",
  text: "#e6edf3",
  muted: "#9aa6b2",
  accent: "#2f81f7",
  warn: "#d29922",
  error: "#ff7b72",
  ok: "#3fb950",
  mdHeading: "#c9dfff",
  mdLink: "#7fb6ff",
  mdLinkUrl: "#8fd3ff",
  mdCode: "#f0d28c",
  mdQuote: "#c8d1d9",
  mdListBullet: "#7fb6ff",
  syntaxComment: "#8b949e",
  syntaxKeyword: "#ff7ab8",
  syntaxFunction: "#7ee787",
  syntaxVariable: "#79c0ff",
  syntaxString: "#a5d6ff",
  syntaxNumber: "#f2cc60",
  syntaxOperator: "#c9d1d9",
  border: "rgba(255, 255, 255, 0.08)",
  borderMuted: "rgba(255, 255, 255, 0.08)",
  accentSoft: "rgba(47, 129, 247, 0.14)",
  accentSoftStrong: "rgba(47, 129, 247, 0.30)",
  markerBorder: "rgba(47, 129, 247, 0.45)",
  accentContrast: "#08101f",
  errorContrast: "#210908",
  editorBg: "#171b24",
  panelShadow: "0 12px 30px rgba(0, 0, 0, 0.22)",
};

const BASE_LIGHT_PALETTE: PrototypePaletteSeed = {
  bg: "#f5f7fb",
  panel: "#ffffff",
  panel2: "#f8fafc",
  text: "#1f2328",
  muted: "#57606a",
  accent: "#0969da",
  warn: "#9a6700",
  error: "#cf222e",
  ok: "#1a7f37",
  mdHeading: "#9a7326",
  mdLink: "#547da7",
  mdLinkUrl: "#767676",
  mdCode: "#5a8080",
  mdQuote: "#6c6c6c",
  mdListBullet: "#588458",
  syntaxComment: "#008000",
  syntaxKeyword: "#0000ff",
  syntaxFunction: "#795e26",
  syntaxVariable: "#001080",
  syntaxString: "#a31515",
  syntaxNumber: "#098658",
  syntaxOperator: "#000000",
  border: "rgba(31, 35, 40, 0.12)",
  borderMuted: "rgba(31, 35, 40, 0.10)",
  accentSoft: "rgba(9, 105, 218, 0.12)",
  accentSoftStrong: "rgba(9, 105, 218, 0.20)",
  markerBorder: "rgba(9, 105, 218, 0.30)",
  accentContrast: "#ffffff",
  errorContrast: "#ffffff",
  editorBg: "#ffffff",
  panelShadow: "0 12px 28px rgba(15, 23, 42, 0.10)",
};

const KNOWN_THEME_FAMILIES: PrototypeThemeFamilyDefinition[] = [
  {
    id: "github-light",
    match: /github\s*light/,
    preference: "light",
    light: {
      bg: "#f6f8fa",
      panel: "#ffffff",
      panel2: "#f6f8fa",
      text: "#1f2328",
      muted: "#57606a",
      accent: "#0969da",
      warn: "#9a6700",
      error: "#cf222e",
      ok: "#1a7f37",
      mdHeading: "#9a6700",
      mdLink: "#0969da",
      mdLinkUrl: "#1b7fd1",
      mdCode: "#8250df",
      mdQuote: "#57606a",
      mdListBullet: "#1a7f37",
      syntaxComment: "#6e7781",
      syntaxKeyword: "#cf222e",
      syntaxFunction: "#8250df",
      syntaxVariable: "#0550ae",
      syntaxString: "#0a3069",
      syntaxNumber: "#0550ae",
      syntaxOperator: "#24292f",
    },
  },
  {
    id: "github-dark",
    match: /github\s*dark/,
    preference: "dark",
    dark: {
      bg: "#0d1117",
      panel: "#161b22",
      panel2: "#21262d",
      text: "#e6edf3",
      muted: "#8b949e",
      accent: "#2f81f7",
      warn: "#d29922",
      error: "#f85149",
      ok: "#3fb950",
      mdHeading: "#d2a8ff",
      mdLink: "#58a6ff",
      mdLinkUrl: "#79c0ff",
      mdCode: "#ffa657",
      mdQuote: "#8b949e",
      mdListBullet: "#3fb950",
      syntaxComment: "#8b949e",
      syntaxKeyword: "#ff7b72",
      syntaxFunction: "#d2a8ff",
      syntaxVariable: "#79c0ff",
      syntaxString: "#a5d6ff",
      syntaxNumber: "#79c0ff",
      syntaxOperator: "#c9d1d9",
    },
  },
  {
    id: "catppuccin-latte",
    match: /(catppuccin.*latte|\blatte\b)/,
    preference: "light",
    light: {
      bg: "#eff1f5",
      panel: "#ffffff",
      panel2: "#e6e9ef",
      text: "#4c4f69",
      muted: "#6c6f85",
      accent: "#1e66f5",
      warn: "#df8e1d",
      error: "#d20f39",
      ok: "#40a02b",
      mdHeading: "#8839ef",
      mdLink: "#1e66f5",
      mdLinkUrl: "#179299",
      mdCode: "#fe640b",
      mdQuote: "#8c8fa1",
      mdListBullet: "#179299",
      syntaxComment: "#8c8fa1",
      syntaxKeyword: "#8839ef",
      syntaxFunction: "#179299",
      syntaxVariable: "#4c4f69",
      syntaxString: "#40a02b",
      syntaxNumber: "#fe640b",
      syntaxOperator: "#4c4f69",
    },
  },
  {
    id: "catppuccin-frappe",
    match: /(catppuccin.*frappe|\bfrappe\b)/,
    preference: "dark",
    dark: {
      bg: "#303446",
      panel: "#292c3c",
      panel2: "#414559",
      text: "#c6d0f5",
      muted: "#a5adce",
      accent: "#8caaee",
      warn: "#e5c890",
      error: "#e78284",
      ok: "#a6d189",
      mdHeading: "#f4b8e4",
      mdLink: "#8caaee",
      mdLinkUrl: "#81c8be",
      mdCode: "#ef9f76",
      mdQuote: "#737994",
      mdListBullet: "#81c8be",
      syntaxComment: "#737994",
      syntaxKeyword: "#ca9ee6",
      syntaxFunction: "#81c8be",
      syntaxVariable: "#c6d0f5",
      syntaxString: "#a6d189",
      syntaxNumber: "#ef9f76",
      syntaxOperator: "#b5bfe2",
    },
  },
  {
    id: "catppuccin-macchiato",
    match: /(catppuccin.*macchiato|\bmacchiato\b)/,
    preference: "dark",
    dark: {
      bg: "#24273a",
      panel: "#1e2030",
      panel2: "#363a4f",
      text: "#cad3f5",
      muted: "#a5adcb",
      accent: "#8aadf4",
      warn: "#eed49f",
      error: "#ed8796",
      ok: "#a6da95",
      mdHeading: "#f5bde6",
      mdLink: "#8aadf4",
      mdLinkUrl: "#91d7e3",
      mdCode: "#f5a97f",
      mdQuote: "#6e738d",
      mdListBullet: "#91d7e3",
      syntaxComment: "#6e738d",
      syntaxKeyword: "#c6a0f6",
      syntaxFunction: "#8bd5ca",
      syntaxVariable: "#cad3f5",
      syntaxString: "#a6da95",
      syntaxNumber: "#f5a97f",
      syntaxOperator: "#b8c0e0",
    },
  },
  {
    id: "catppuccin-mocha",
    match: /(catppuccin.*mocha|\bmocha\b|\bcatppuccin\b)/,
    preference: "dark",
    dark: {
      bg: "#1e1e2e",
      panel: "#181825",
      panel2: "#313244",
      text: "#cdd6f4",
      muted: "#a6adc8",
      accent: "#89b4fa",
      warn: "#f9e2af",
      error: "#f38ba8",
      ok: "#a6e3a1",
      mdHeading: "#f5c2e7",
      mdLink: "#89b4fa",
      mdLinkUrl: "#94e2d5",
      mdCode: "#fab387",
      mdQuote: "#6c7086",
      mdListBullet: "#94e2d5",
      syntaxComment: "#6c7086",
      syntaxKeyword: "#cba6f7",
      syntaxFunction: "#89dceb",
      syntaxVariable: "#cdd6f4",
      syntaxString: "#a6e3a1",
      syntaxNumber: "#fab387",
      syntaxOperator: "#bac2de",
    },
  },
  {
    id: "dracula",
    match: /dracula/,
    preference: "dark",
    dark: {
      bg: "#282a36",
      panel: "#232530",
      panel2: "#303341",
      text: "#f8f8f2",
      muted: "#a4acc4",
      accent: "#bd93f9",
      warn: "#ffb86c",
      error: "#ff5555",
      ok: "#50fa7b",
      mdHeading: "#ff79c6",
      mdLink: "#8be9fd",
      mdLinkUrl: "#8be9fd",
      mdCode: "#50fa7b",
      mdQuote: "#6272a4",
      mdListBullet: "#8be9fd",
      syntaxComment: "#6272a4",
      syntaxKeyword: "#ff79c6",
      syntaxFunction: "#50fa7b",
      syntaxVariable: "#8be9fd",
      syntaxString: "#f1fa8c",
      syntaxNumber: "#bd93f9",
      syntaxOperator: "#f8f8f2",
    },
  },
  {
    id: "nord",
    match: /nord/,
    preference: "dark",
    dark: {
      bg: "#2e3440",
      panel: "#3b4252",
      panel2: "#434c5e",
      text: "#eceff4",
      muted: "#d8dee9",
      accent: "#88c0d0",
      warn: "#ebcb8b",
      error: "#bf616a",
      ok: "#a3be8c",
      mdHeading: "#81a1c1",
      mdLink: "#88c0d0",
      mdLinkUrl: "#8fbcbb",
      mdCode: "#a3be8c",
      mdQuote: "#4c566a",
      mdListBullet: "#81a1c1",
      syntaxComment: "#616e88",
      syntaxKeyword: "#81a1c1",
      syntaxFunction: "#88c0d0",
      syntaxVariable: "#d8dee9",
      syntaxString: "#a3be8c",
      syntaxNumber: "#b48ead",
      syntaxOperator: "#eceff4",
    },
  },
  {
    id: "gruvbox-light",
    match: /gruvbox.*light/,
    preference: "light",
    light: {
      bg: "#fbf1c7",
      panel: "#f9f5d7",
      panel2: "#ebdbb2",
      text: "#3c3836",
      muted: "#7c6f64",
      accent: "#458588",
      warn: "#b57614",
      error: "#cc241d",
      ok: "#98971a",
      mdHeading: "#d65d0e",
      mdLink: "#458588",
      mdLinkUrl: "#689d6a",
      mdCode: "#b16286",
      mdQuote: "#928374",
      mdListBullet: "#98971a",
      syntaxComment: "#928374",
      syntaxKeyword: "#cc241d",
      syntaxFunction: "#b57614",
      syntaxVariable: "#458588",
      syntaxString: "#98971a",
      syntaxNumber: "#b16286",
      syntaxOperator: "#3c3836",
    },
  },
  {
    id: "gruvbox-dark",
    match: /gruvbox/,
    preference: "dark",
    dark: {
      bg: "#282828",
      panel: "#32302f",
      panel2: "#3c3836",
      text: "#ebdbb2",
      muted: "#a89984",
      accent: "#83a598",
      warn: "#fabd2f",
      error: "#fb4934",
      ok: "#b8bb26",
      mdHeading: "#fe8019",
      mdLink: "#83a598",
      mdLinkUrl: "#8ec07c",
      mdCode: "#d3869b",
      mdQuote: "#665c54",
      mdListBullet: "#b8bb26",
      syntaxComment: "#928374",
      syntaxKeyword: "#fb4934",
      syntaxFunction: "#fabd2f",
      syntaxVariable: "#83a598",
      syntaxString: "#b8bb26",
      syntaxNumber: "#d3869b",
      syntaxOperator: "#ebdbb2",
    },
  },
  {
    id: "tokyo-night",
    match: /(tokyo\s*night|tokyonight)/,
    preference: "dark",
    dark: {
      bg: "#1a1b26",
      panel: "#1f2335",
      panel2: "#24283b",
      text: "#c0caf5",
      muted: "#9aa5ce",
      accent: "#7aa2f7",
      warn: "#e0af68",
      error: "#f7768e",
      ok: "#9ece6a",
      mdHeading: "#bb9af7",
      mdLink: "#7aa2f7",
      mdLinkUrl: "#7dcfff",
      mdCode: "#9ece6a",
      mdQuote: "#565f89",
      mdListBullet: "#7dcfff",
      syntaxComment: "#565f89",
      syntaxKeyword: "#bb9af7",
      syntaxFunction: "#7dcfff",
      syntaxVariable: "#c0caf5",
      syntaxString: "#9ece6a",
      syntaxNumber: "#ff9e64",
      syntaxOperator: "#c0caf5",
    },
  },
  {
    id: "rose-pine",
    match: /(rose\s*pine|rosepine)/,
    preference: "dark",
    dark: {
      bg: "#191724",
      panel: "#1f1d2e",
      panel2: "#26233a",
      text: "#e0def4",
      muted: "#908caa",
      accent: "#9ccfd8",
      warn: "#f6c177",
      error: "#eb6f92",
      ok: "#9ccfd8",
      mdHeading: "#c4a7e7",
      mdLink: "#9ccfd8",
      mdLinkUrl: "#ebbcba",
      mdCode: "#f6c177",
      mdQuote: "#6e6a86",
      mdListBullet: "#ebbcba",
      syntaxComment: "#6e6a86",
      syntaxKeyword: "#c4a7e7",
      syntaxFunction: "#9ccfd8",
      syntaxVariable: "#e0def4",
      syntaxString: "#f6c177",
      syntaxNumber: "#ea9a97",
      syntaxOperator: "#e0def4",
    },
  },
  {
    id: "monokai",
    match: /monokai/,
    preference: "dark",
    dark: {
      bg: "#272822",
      panel: "#2f3129",
      panel2: "#3a3d32",
      text: "#f8f8f2",
      muted: "#a6a895",
      accent: "#66d9ef",
      warn: "#fd971f",
      error: "#f92672",
      ok: "#a6e22e",
      mdHeading: "#ae81ff",
      mdLink: "#66d9ef",
      mdLinkUrl: "#a6e22e",
      mdCode: "#fd971f",
      mdQuote: "#75715e",
      mdListBullet: "#a6e22e",
      syntaxComment: "#75715e",
      syntaxKeyword: "#f92672",
      syntaxFunction: "#a6e22e",
      syntaxVariable: "#66d9ef",
      syntaxString: "#e6db74",
      syntaxNumber: "#ae81ff",
      syntaxOperator: "#f8f8f2",
    },
  },
  {
    id: "everforest",
    match: /everforest/,
    preference: "dark",
    dark: {
      bg: "#2d353b",
      panel: "#343f44",
      panel2: "#3d484d",
      text: "#d3c6aa",
      muted: "#859289",
      accent: "#7fbbb3",
      warn: "#dbbc7f",
      error: "#e67e80",
      ok: "#a7c080",
      mdHeading: "#e69875",
      mdLink: "#7fbbb3",
      mdLinkUrl: "#83c092",
      mdCode: "#d699b6",
      mdQuote: "#5c6a72",
      mdListBullet: "#83c092",
      syntaxComment: "#5c6a72",
      syntaxKeyword: "#e67e80",
      syntaxFunction: "#dbbc7f",
      syntaxVariable: "#7fbbb3",
      syntaxString: "#a7c080",
      syntaxNumber: "#d699b6",
      syntaxOperator: "#d3c6aa",
    },
  },
  {
    id: "solarized-light",
    match: /solarized.*light/,
    preference: "light",
    light: {
      bg: "#fdf6e3",
      panel: "#fffdf7",
      panel2: "#f5efdc",
      text: "#586e75",
      muted: "#657b83",
      accent: "#268bd2",
      warn: "#b58900",
      error: "#dc322f",
      ok: "#859900",
      mdHeading: "#cb4b16",
      mdLink: "#268bd2",
      mdLinkUrl: "#2aa198",
      mdCode: "#859900",
      mdQuote: "#93a1a1",
      mdListBullet: "#2aa198",
      syntaxComment: "#93a1a1",
      syntaxKeyword: "#859900",
      syntaxFunction: "#268bd2",
      syntaxVariable: "#586e75",
      syntaxString: "#2aa198",
      syntaxNumber: "#d33682",
      syntaxOperator: "#586e75",
    },
  },
  {
    id: "solarized-dark",
    match: /solarized/,
    preference: "dark",
    dark: {
      bg: "#002b36",
      panel: "#073642",
      panel2: "#0b3b46",
      text: "#93a1a1",
      muted: "#657b83",
      accent: "#268bd2",
      warn: "#b58900",
      error: "#dc322f",
      ok: "#859900",
      mdHeading: "#cb4b16",
      mdLink: "#268bd2",
      mdLinkUrl: "#2aa198",
      mdCode: "#859900",
      mdQuote: "#586e75",
      mdListBullet: "#2aa198",
      syntaxComment: "#586e75",
      syntaxKeyword: "#859900",
      syntaxFunction: "#268bd2",
      syntaxVariable: "#93a1a1",
      syntaxString: "#2aa198",
      syntaxNumber: "#d33682",
      syntaxOperator: "#93a1a1",
    },
  },
];

function getXdgStateDirectory(): string {
  const configured = String(process.env.XDG_STATE_HOME ?? "").trim();
  return configured || join(homedir(), ".local", "state");
}

function getXdgConfigDirectory(): string {
  const configured = String(process.env.XDG_CONFIG_HOME ?? "").trim();
  return configured || join(homedir(), ".config");
}

function normalizeThemeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function stripJsonComments(input: string): string {
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

async function readJsonValue(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(stripJsonComments(raw)) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readConfiguredTheme(): Promise<{ raw: string | null; source: PrototypeThemeSource }> {
  const localState = await readJsonValue(join(getXdgStateDirectory(), "opencode", "kv.json"));
  const localTheme = typeof localState?.theme === "string" ? localState.theme.trim() : "";
  if (localTheme) {
    return { raw: localTheme, source: "opencode-local-state" };
  }

  const configPaths = [
    join(getXdgConfigDirectory(), "opencode", "opencode.jsonc"),
    join(getXdgConfigDirectory(), "opencode", "opencode.json"),
    join(getXdgConfigDirectory(), "opencode", "config.json"),
  ];

  for (const path of configPaths) {
    const parsed = await readJsonValue(path);
    const configTheme = typeof parsed?.theme === "string" ? parsed.theme.trim() : "";
    if (configTheme) {
      return { raw: configTheme, source: "opencode-config" };
    }
  }

  return { raw: null, source: "default" };
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim();
  const long = value.match(/^#([0-9a-fA-F]{6})$/);
  if (long) {
    const hex = long[1]!;
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }

  const short = value.match(/^#([0-9a-fA-F]{3})$/);
  if (short) {
    const hex = short[1]!;
    return {
      r: Number.parseInt(hex[0]! + hex[0]!, 16),
      g: Number.parseInt(hex[1]! + hex[1]!, 16),
      b: Number.parseInt(hex[2]! + hex[2]!, 16),
    };
  }

  return null;
}

function withAlpha(color: string, alpha: number, fallback: string): string {
  const rgb = hexToRgb(color);
  if (!rgb) return fallback;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped.toFixed(2)})`;
}

function relativeLuminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function defaultContrastColor(color: string, darkText: string, lightText: string): string {
  return relativeLuminance(color) >= 0.6 ? darkText : lightText;
}

function inferThemePreference(raw: string | null): PrototypeThemePreference {
  if (!raw) return "system";
  const key = normalizeThemeKey(raw);
  if (!key) return "system";
  if (key === "system" || key === "auto" || key.includes("system")) return "system";
  if (/\b(light|day|latte|dawn)\b/.test(key)) return "light";
  if (/\b(dark|night|mocha|macchiato|frappe|moon)\b/.test(key)) return "dark";
  return "dark";
}

function resolveThemeFamily(raw: string | null): PrototypeThemeFamilyDefinition | undefined {
  if (!raw) return undefined;
  const key = normalizeThemeKey(raw);
  return KNOWN_THEME_FAMILIES.find((entry) => entry.match.test(key));
}

function buildThemeVars(mode: Exclude<PrototypeThemePreference, "system">, override: Partial<PrototypePaletteSeed> | undefined): PrototypeThemeRecord {
  const base = mode === "light" ? BASE_LIGHT_PALETTE : BASE_DARK_PALETTE;
  const palette: PrototypePaletteSeed = {
    ...base,
    ...(override ?? {}),
  };

  const border = palette.border ?? withAlpha(palette.text, mode === "light" ? 0.12 : 0.10, base.border ?? "rgba(0, 0, 0, 0.1)");
  const borderMuted = palette.borderMuted ?? withAlpha(palette.text, mode === "light" ? 0.10 : 0.08, base.borderMuted ?? "rgba(0, 0, 0, 0.08)");
  const accentSoft = palette.accentSoft ?? withAlpha(palette.accent, mode === "light" ? 0.12 : 0.14, base.accentSoft ?? "rgba(0, 0, 0, 0.12)");
  const accentSoftStrong = palette.accentSoftStrong ?? withAlpha(palette.accent, mode === "light" ? 0.22 : 0.30, base.accentSoftStrong ?? "rgba(0, 0, 0, 0.22)");
  const markerBorder = palette.markerBorder ?? withAlpha(palette.accent, mode === "light" ? 0.30 : 0.45, base.markerBorder ?? "rgba(0, 0, 0, 0.3)");
  const accentContrast = palette.accentContrast ?? defaultContrastColor(palette.accent, "#08101f", "#ffffff");
  const errorContrast = palette.errorContrast ?? defaultContrastColor(palette.error, "#210908", "#ffffff");
  const panelShadow = palette.panelShadow ?? (mode === "light"
    ? "0 12px 28px rgba(15, 23, 42, 0.10)"
    : "0 12px 30px rgba(0, 0, 0, 0.22)");

  return {
    "--bg": palette.bg,
    "--panel": palette.panel,
    "--panel-2": palette.panel2,
    "--card": palette.panel,
    "--editor-bg": palette.editorBg ?? palette.panel,
    "--text": palette.text,
    "--muted": palette.muted,
    "--border": border,
    "--border-muted": borderMuted,
    "--accent": palette.accent,
    "--accent-contrast": accentContrast,
    "--accent-soft": accentSoft,
    "--accent-soft-strong": accentSoftStrong,
    "--ok": palette.ok,
    "--warn": palette.warn,
    "--error": palette.error,
    "--error-contrast": errorContrast,
    "--panel-shadow": panelShadow,
    "--md-heading": palette.mdHeading,
    "--md-link": palette.mdLink,
    "--md-link-url": palette.mdLinkUrl,
    "--md-code": palette.mdCode,
    "--md-quote": palette.mdQuote,
    "--md-list-bullet": palette.mdListBullet,
    "--syntax-comment": palette.syntaxComment,
    "--syntax-keyword": palette.syntaxKeyword,
    "--syntax-function": palette.syntaxFunction,
    "--syntax-variable": palette.syntaxVariable,
    "--syntax-string": palette.syntaxString,
    "--syntax-number": palette.syntaxNumber,
    "--syntax-operator": palette.syntaxOperator,
    "--marker-border": markerBorder,
  };
}

function cssDeclarations(vars: PrototypeThemeRecord): string {
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
}

export function buildPrototypeThemeDescriptor(raw: string | null | undefined, source: PrototypeThemeSource = "default"): PrototypeThemeDescriptor {
  const normalizedRaw = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const family = resolveThemeFamily(normalizedRaw);
  const inferredPreference = family?.preference ?? inferThemePreference(normalizedRaw);
  const lightVars = buildThemeVars("light", family?.light);
  const darkVars = buildThemeVars("dark", family?.dark);

  return {
    raw: normalizedRaw,
    preference: inferredPreference,
    source,
    family: family?.id ?? null,
    darkVars,
    lightVars,
  };
}

export function buildPrototypeThemeStylesheet(theme: PrototypeThemeDescriptor): string {
  const lightBlock = cssDeclarations(theme.lightVars);
  const darkBlock = cssDeclarations(theme.darkVars);

  if (theme.preference === "light") {
    return `:root {\n  color-scheme: light;\n${lightBlock}\n}`;
  }

  if (theme.preference === "dark") {
    return `:root {\n  color-scheme: dark;\n${darkBlock}\n}`;
  }

  return `:root {\n  color-scheme: dark;\n${darkBlock}\n}\n@media (prefers-color-scheme: light) {\n  :root {\n    color-scheme: light;\n${lightBlock}\n  }\n}`;
}

export async function readPrototypeThemeDescriptor(): Promise<PrototypeThemeDescriptor> {
  const configured = await readConfiguredTheme();
  return buildPrototypeThemeDescriptor(configured.raw, configured.source);
}
