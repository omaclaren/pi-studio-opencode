import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type PrototypeThemePreference = "light" | "dark" | "system";
export type PrototypeThemeSource = "opencode-local-state" | "opencode-config" | "ghostty-config" | "default";

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
  markerBg: string;
  okBorder: string;
  warnBorder: string;
  mdHeading: string;
  mdLink: string;
  mdLinkUrl: string;
  mdCode: string;
  mdCodeBlock: string;
  mdCodeBlockBorder: string;
  mdQuote: string;
  mdQuoteBorder: string;
  mdHr: string;
  mdListBullet: string;
  syntaxComment: string;
  syntaxKeyword: string;
  syntaxFunction: string;
  syntaxVariable: string;
  syntaxString: string;
  syntaxNumber: string;
  syntaxType: string;
  syntaxOperator: string;
  syntaxPunctuation: string;
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

type ResolvedConfiguredTheme = {
  raw: string | null;
  source: PrototypeThemeSource;
  mode: Exclude<PrototypeThemePreference, "system"> | null;
};

export type GhosttyThemeReference = {
  single: string | null;
  light: string | null;
  dark: string | null;
};

export type PrototypeGhosttyThemeInput = {
  background: string;
  foreground: string;
  cursorColor?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  palette: Map<number, string>;
};

type GhosttyThemeDefinition = {
  name: string;
  background?: string;
  foreground?: string;
  cursorColor?: string;
  cursorText?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  palette: Map<number, string>;
};

export type PrototypeOpencodeThemeInput = {
  $schema?: string;
  defs?: Record<string, unknown>;
  theme: Record<string, unknown>;
};

export type PrototypeOpencodeThemeMode = Exclude<PrototypeThemePreference, "system">;

const BASE_DARK_PALETTE: PrototypePaletteSeed = {
  bg: "#0f1117",
  panel: "#171b24",
  panel2: "#11161f",
  text: "#e6edf3",
  muted: "#9aa5b1",
  accent: "#5ea1ff",
  warn: "#f9c74f",
  error: "#ff6b6b",
  ok: "#73d13d",
  markerBg: "rgba(94, 161, 255, 0.25)",
  okBorder: "rgba(115, 209, 61, 0.70)",
  warnBorder: "rgba(249, 199, 79, 0.70)",
  mdHeading: "#f0c674",
  mdLink: "#81a2be",
  mdLinkUrl: "#666666",
  mdCode: "#8abeb7",
  mdCodeBlock: "#b5bd68",
  mdCodeBlockBorder: "#808080",
  mdQuote: "#808080",
  mdQuoteBorder: "#808080",
  mdHr: "#808080",
  mdListBullet: "#8abeb7",
  syntaxComment: "#6A9955",
  syntaxKeyword: "#569CD6",
  syntaxFunction: "#DCDCAA",
  syntaxVariable: "#9CDCFE",
  syntaxString: "#CE9178",
  syntaxNumber: "#B5CEA8",
  syntaxType: "#4EC9B0",
  syntaxOperator: "#D4D4D4",
  syntaxPunctuation: "#D4D4D4",
  border: "#2d3748",
  borderMuted: "#242b38",
  accentSoft: "rgba(94, 161, 255, 0.35)",
  accentSoftStrong: "rgba(94, 161, 255, 0.40)",
  markerBorder: "rgba(94, 161, 255, 0.65)",
  accentContrast: "#0e1616",
  errorContrast: "#0e1616",
  editorBg: "#171b24",
  panelShadow: "0 1px 2px rgba(0, 0, 0, 0.36), 0 6px 18px rgba(0, 0, 0, 0.22)",
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
  markerBg: "rgba(9, 105, 218, 0.13)",
  okBorder: "rgba(26, 127, 55, 0.55)",
  warnBorder: "rgba(154, 103, 0, 0.55)",
  mdHeading: "#9a7326",
  mdLink: "#547da7",
  mdLinkUrl: "#767676",
  mdCode: "#5a8080",
  mdCodeBlock: "#588458",
  mdCodeBlockBorder: "#6c6c6c",
  mdQuote: "#6c6c6c",
  mdQuoteBorder: "#6c6c6c",
  mdHr: "#6c6c6c",
  mdListBullet: "#588458",
  syntaxComment: "#008000",
  syntaxKeyword: "#0000FF",
  syntaxFunction: "#795E26",
  syntaxVariable: "#001080",
  syntaxString: "#A31515",
  syntaxNumber: "#098658",
  syntaxType: "#267F99",
  syntaxOperator: "#000000",
  syntaxPunctuation: "#000000",
  border: "#d0d7de",
  borderMuted: "#e0e6ee",
  accentSoft: "rgba(9, 105, 218, 0.28)",
  accentSoftStrong: "rgba(9, 105, 218, 0.35)",
  markerBorder: "rgba(9, 105, 218, 0.45)",
  accentContrast: "#ffffff",
  errorContrast: "#ffffff",
  editorBg: "#ffffff",
  panelShadow: "0 1px 2px rgba(15, 23, 42, 0.03), 0 4px 14px rgba(15, 23, 42, 0.04)",
};

const KNOWN_THEME_FAMILIES: PrototypeThemeFamilyDefinition[] = [
  {
    id: "aura",
    match: /\baura\b/,
    preference: "dark",
    dark: {
      bg: "#0f0f0f",
      panel: "#15141b",
      panel2: "#15141b",
      text: "#edecee",
      muted: "#6d6d6d",
      accent: "#a277ff",
      warn: "#ffca85",
      error: "#ff6767",
      ok: "#61ffca",
      mdHeading: "#a277ff",
      mdLink: "#f694ff",
      mdLinkUrl: "#a277ff",
      mdCode: "#61ffca",
      mdQuote: "#6d6d6d",
      mdListBullet: "#a277ff",
      syntaxComment: "#6d6d6d",
      syntaxKeyword: "#f694ff",
      syntaxFunction: "#a277ff",
      syntaxVariable: "#a277ff",
      syntaxString: "#61ffca",
      syntaxNumber: "#9dff65",
      syntaxOperator: "#f694ff",
    },
  },
  {
    id: "github",
    match: /github/,
    light: {
      bg: "#ffffff",
      panel: "#f6f8fa",
      panel2: "#f0f3f6",
      text: "#24292f",
      muted: "#57606a",
      accent: "#1b7c83",
      warn: "#9a6700",
      error: "#cf222e",
      ok: "#1a7f37",
      mdHeading: "#0969da",
      mdLink: "#0969da",
      mdLinkUrl: "#1b7c83",
      mdCode: "#bf3989",
      mdQuote: "#57606a",
      mdListBullet: "#0969da",
      syntaxComment: "#57606a",
      syntaxKeyword: "#cf222e",
      syntaxFunction: "#8250df",
      syntaxVariable: "#bc4c00",
      syntaxString: "#0969da",
      syntaxNumber: "#1b7c83",
      syntaxOperator: "#cf222e",
    },
    dark: {
      bg: "#0d1117",
      panel: "#010409",
      panel2: "#161b22",
      text: "#c9d1d9",
      muted: "#8b949e",
      accent: "#39c5cf",
      warn: "#e3b341",
      error: "#f85149",
      ok: "#3fb950",
      mdHeading: "#58a6ff",
      mdLink: "#58a6ff",
      mdLinkUrl: "#39c5cf",
      mdCode: "#ff7b72",
      mdQuote: "#8b949e",
      mdListBullet: "#58a6ff",
      syntaxComment: "#8b949e",
      syntaxKeyword: "#ff7b72",
      syntaxFunction: "#bc8cff",
      syntaxVariable: "#d29922",
      syntaxString: "#39c5cf",
      syntaxNumber: "#58a6ff",
      syntaxOperator: "#ff7b72",
    },
  },
  {
    id: "momo-pro",
    match: /(momo\s*pro|momo-pro|cutie\s*pro)/,
    light: {
      bg: "#ffffff",
      panel: "#f6f8fa",
      panel2: "#f0f3f6",
      text: "#0e1116",
      muted: "#656e77",
      accent: "#1b7c83",
      warn: "#4e2c00",
      error: "#a0111f",
      ok: "#024c1a",
      mdHeading: "#622cbc",
      mdLink: "#1b7c83",
      mdLinkUrl: "#656e77",
      mdCode: "#024c1a",
      mdQuote: "#656e77",
      mdListBullet: "#1b7c83",
      syntaxComment: "#656e77",
      syntaxKeyword: "#622cbc",
      syntaxFunction: "#1b7c83",
      syntaxVariable: "#0e1116",
      syntaxString: "#024c1a",
      syntaxNumber: "#a0111f",
      syntaxOperator: "#0e1116",
    },
    dark: {
      bg: "#181818",
      panel: "#1f1f1f",
      panel2: "#1a1a1a",
      text: "#d5d0c9",
      muted: "#88847f",
      accent: "#42d9c5",
      warn: "#f1bb79",
      error: "#f56e7f",
      ok: "#bec975",
      mdHeading: "#d286b7",
      mdLink: "#42d9c5",
      mdLinkUrl: "#88847f",
      mdCode: "#bec975",
      mdQuote: "#f58669",
      mdListBullet: "#42d9c5",
      syntaxComment: "#88847f",
      syntaxKeyword: "#d286b7",
      syntaxFunction: "#42d9c5",
      syntaxVariable: "#d5d0c9",
      syntaxString: "#bec975",
      syntaxNumber: "#f58669",
      syntaxOperator: "#d5d0c9",
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

async function readConfiguredTheme(): Promise<ResolvedConfiguredTheme> {
  const configPaths = [
    join(getXdgConfigDirectory(), "opencode", "opencode.jsonc"),
    join(getXdgConfigDirectory(), "opencode", "opencode.json"),
    join(getXdgConfigDirectory(), "opencode", "config.json"),
  ];

  let configTheme = "";
  let configMode: ResolvedConfiguredTheme["mode"] = null;

  for (const path of configPaths) {
    const parsed = await readJsonValue(path);
    const nextTheme = typeof parsed?.theme === "string" ? parsed.theme.trim() : "";
    const nextMode = typeof parsed?.theme_mode === "string" ? parsed.theme_mode.trim().toLowerCase() : "";
    if (!configTheme && nextTheme) {
      configTheme = nextTheme;
    }
    if (!configMode && (nextMode === "light" || nextMode === "dark")) {
      configMode = nextMode;
    }
    if (configTheme && configMode) {
      break;
    }
  }

  const localState = await readJsonValue(join(getXdgStateDirectory(), "opencode", "kv.json"));
  const localTheme = typeof localState?.theme === "string" ? localState.theme.trim() : "";
  const localMode = typeof localState?.theme_mode === "string" ? localState.theme_mode.trim().toLowerCase() : "";
  const resolvedLocalMode = localMode === "light" || localMode === "dark" ? localMode : null;

  if (configTheme) {
    return {
      raw: configTheme,
      source: "opencode-config",
      mode: resolvedLocalMode ?? configMode,
    };
  }

  if (localTheme) {
    return {
      raw: localTheme,
      source: "opencode-local-state",
      mode: resolvedLocalMode ?? configMode,
    };
  }

  return { raw: null, source: "default", mode: configMode };
}

async function readFirstExistingTextFile(paths: string[]): Promise<string | null> {
  for (const path of paths) {
    try {
      const text = await readFile(path, "utf8");
      if (text.trim()) return text;
    } catch {
      // ignore missing/unreadable paths
    }
  }
  return null;
}

function normalizeThemeNameToken(value: string): string | null {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "").trim();
  return trimmed || null;
}

function normalizeThemeModeToken(value: string | null | undefined): Exclude<PrototypeThemePreference, "system"> | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "light" || normalized === "dark" ? normalized : null;
}

function shouldUseGhosttyTheme(configured: ResolvedConfiguredTheme): boolean {
  const key = normalizeThemeKey(configured.raw ?? "");
  return key === "system" || key === "auto";
}

function getGhosttyConfigPaths(): string[] {
  return [
    join(getXdgConfigDirectory(), "ghostty", "config"),
    join(homedir(), "Library", "Application Support", "com.mitchellh.ghostty", "config"),
  ];
}

function getGhosttyThemeSearchPaths(themeName: string): string[] {
  return [
    join(getXdgConfigDirectory(), "ghostty", "themes", themeName),
    join(homedir(), "Library", "Application Support", "com.mitchellh.ghostty", "themes", themeName),
    join("/Applications", "Ghostty.app", "Contents", "Resources", "ghostty", "themes", themeName),
  ];
}

async function resolveGhosttyThemePath(themeName: string): Promise<string | null> {
  const candidates = getGhosttyThemeSearchPaths(themeName);

  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, "utf8");
      if (text.trim()) return candidate;
    } catch {
      // ignore exact-path misses
    }
  }

  for (const candidate of candidates) {
    const parent = dirname(candidate);
    const leaf = candidate.split("/").pop()?.toLowerCase();
    if (!leaf) continue;
    try {
      const entries = await readdir(parent);
      const match = entries.find((entry) => entry.toLowerCase() === leaf);
      if (match) return join(parent, match);
    } catch {
      // ignore missing directories
    }
  }

  return null;
}

export function parseGhosttyThemeReference(value: string): GhosttyThemeReference {
  const out: GhosttyThemeReference = { single: null, light: null, dark: null };
  const raw = String(value ?? "").trim();
  if (!raw) return out;

  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const modeMatch = trimmed.match(/^(dark|light)\s*:\s*(.+)$/i);
    if (modeMatch) {
      const mode = normalizeThemeModeToken(modeMatch[1]);
      const name = normalizeThemeNameToken(modeMatch[2] ?? "");
      if (mode === "dark") out.dark = name;
      if (mode === "light") out.light = name;
      continue;
    }
    out.single = normalizeThemeNameToken(trimmed);
  }

  if (!out.light && out.single) out.light = out.single;
  if (!out.dark && out.single) out.dark = out.single;
  return out;
}

async function readGhosttyThemeReference(): Promise<GhosttyThemeReference | null> {
  const content = await readFirstExistingTextFile(getGhosttyConfigPaths());
  if (!content) return null;

  let themeValue: string | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^theme\s*=\s*(.+)$/i);
    if (!match) continue;
    themeValue = match[1]?.trim() ?? null;
  }

  if (!themeValue) return null;
  const parsed = parseGhosttyThemeReference(themeValue);
  return parsed.single || parsed.light || parsed.dark ? parsed : null;
}

async function readGhosttyThemeDefinition(themeName: string): Promise<GhosttyThemeDefinition | null> {
  const resolvedPath = await resolveGhosttyThemePath(themeName);
  if (!resolvedPath) return null;
  const content = await readFile(resolvedPath, "utf8");
  if (!content.trim()) return null;

  const definition: GhosttyThemeDefinition = {
    name: themeName,
    palette: new Map<number, string>(),
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const paletteMatch = line.match(/^palette\s*=\s*(\d{1,2})\s*=\s*(#[0-9a-fA-F]{3,6})$/i);
    if (paletteMatch) {
      definition.palette.set(Number.parseInt(paletteMatch[1] ?? "", 10), paletteMatch[2]!.toLowerCase());
      continue;
    }

    const colorMatch = line.match(/^(background|foreground|cursor-color|cursor-text|selection-background|selection-foreground)\s*=\s*(#[0-9a-fA-F]{3,6})$/i);
    if (!colorMatch) continue;
    const key = colorMatch[1]!.toLowerCase();
    const value = colorMatch[2]!.toLowerCase();
    if (key === "background") definition.background = value;
    else if (key === "foreground") definition.foreground = value;
    else if (key === "cursor-color") definition.cursorColor = value;
    else if (key === "cursor-text") definition.cursorText = value;
    else if (key === "selection-background") definition.selectionBackground = value;
    else if (key === "selection-foreground") definition.selectionForeground = value;
  }

  if (!definition.background || !definition.foreground) {
    return null;
  }

  return definition;
}

function getOpencodeThemeNameCandidates(raw: string): string[] {
  const trimmed = raw.trim();
  const normalized = normalizeThemeKey(trimmed);
  const hyphenated = normalized.replace(/\s+/g, "-");
  return Array.from(new Set([
    trimmed,
    trimmed.toLowerCase(),
    normalized,
    hyphenated,
  ].map((value) => value.trim()).filter(Boolean)));
}

function isPrototypeOpencodeThemeInput(value: unknown): value is PrototypeOpencodeThemeInput {
  if (!value || typeof value !== "object") return false;
  const theme = (value as { theme?: unknown }).theme;
  return Boolean(theme && typeof theme === "object" && !Array.isArray(theme));
}

async function readFirstExistingJsonFile<T>(paths: string[], guard: (value: unknown) => value is T): Promise<T | null> {
  for (const path of paths) {
    const parsed = await readJsonValue(path);
    if (guard(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getPrototypeOpencodeThemeWorkspacePaths(themeName: string, directory?: string): string[] {
  if (!directory) return [];
  const paths: string[] = [];
  let current = resolve(directory);

  for (;;) {
    paths.push(join(current, ".opencode", "themes", `${themeName}.json`));
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return paths;
}

async function getPrototypeOpencodeBuiltinThemePaths(themeName: string): Promise<string[]> {
  const cacheDir = join(homedir(), ".bun", "install", "cache");
  const paths = [join(cacheDir, "critique", "src", "themes", `${themeName}.json`)];

  try {
    const entries = await readdir(cacheDir);
    for (const entry of entries) {
      if (!entry.startsWith("critique@")) continue;
      paths.push(join(cacheDir, entry, "src", "themes", `${themeName}.json`));
    }
  } catch {
    // ignore missing bun cache directories
  }

  return paths;
}

async function readPrototypeOpencodeThemeDefinition(rawThemeName: string, directory?: string): Promise<PrototypeOpencodeThemeInput | null> {
  for (const themeName of getOpencodeThemeNameCandidates(rawThemeName)) {
    const candidatePaths = [
      join(getXdgConfigDirectory(), "opencode", "themes", `${themeName}.json`),
      ...getPrototypeOpencodeThemeWorkspacePaths(themeName, directory),
      ...(await getPrototypeOpencodeBuiltinThemePaths(themeName)),
    ];
    const definition = await readFirstExistingJsonFile(candidatePaths, isPrototypeOpencodeThemeInput);
    if (definition) {
      return definition;
    }
  }

  return null;
}

function ansiColorCodeToHex(code: number): string {
  const normalized = Math.max(0, Math.min(255, Math.trunc(code)));
  const standardAnsi = [
    "#000000",
    "#800000",
    "#008000",
    "#808000",
    "#000080",
    "#800080",
    "#008080",
    "#c0c0c0",
    "#808080",
    "#ff0000",
    "#00ff00",
    "#ffff00",
    "#0000ff",
    "#ff00ff",
    "#00ffff",
    "#ffffff",
  ];

  if (normalized < 16) {
    return standardAnsi[normalized] ?? "#808080";
  }

  if (normalized < 232) {
    const index = normalized - 16;
    const blue = index % 6;
    const green = Math.floor(index / 6) % 6;
    const red = Math.floor(index / 36);
    const component = (value: number): number => (value === 0 ? 0 : value * 40 + 55);
    return rgbToHex(component(red), component(green), component(blue));
  }

  const gray = (normalized - 232) * 10 + 8;
  return rgbToHex(gray, gray, gray);
}

function isTransparentThemeColor(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "transparent" || normalized === "none";
}

function resolvePrototypeOpencodeThemeColor(
  definition: PrototypeOpencodeThemeInput,
  value: unknown,
  mode: PrototypeOpencodeThemeMode,
  seen = new Set<string>(),
): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isTransparentThemeColor(trimmed)) return "transparent";
    if (/^#[0-9a-fA-F]{3,6}$/.test(trimmed)) return trimmed.toLowerCase();

    if (definition.defs && Object.prototype.hasOwnProperty.call(definition.defs, trimmed)) {
      const key = `def:${trimmed}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return resolvePrototypeOpencodeThemeColor(definition, definition.defs[trimmed], mode, seen);
    }

    if (Object.prototype.hasOwnProperty.call(definition.theme, trimmed)) {
      const key = `theme:${trimmed}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return resolvePrototypeOpencodeThemeColor(definition, definition.theme[trimmed], mode, seen);
    }

    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return ansiColorCodeToHex(value);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const variant = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(variant, "dark") || Object.prototype.hasOwnProperty.call(variant, "light")) {
      return resolvePrototypeOpencodeThemeColor(definition, variant[mode] ?? variant.dark ?? variant.light, mode, seen);
    }
  }

  return null;
}

function resolvePrototypeOpencodeThemeSlot(
  definition: PrototypeOpencodeThemeInput,
  key: string,
  mode: PrototypeOpencodeThemeMode,
): string | null {
  return resolvePrototypeOpencodeThemeColor(definition, definition.theme[key], mode);
}

function pickSolidThemeColor(primary: string | null | undefined, fallback: string): string {
  if (!primary || isTransparentThemeColor(primary)) return fallback;
  return primary;
}

function buildOpencodePaletteSeed(
  definition: PrototypeOpencodeThemeInput,
  mode: PrototypeOpencodeThemeMode,
): Partial<PrototypePaletteSeed> {
  const base = mode === "light" ? BASE_LIGHT_PALETTE : BASE_DARK_PALETTE;
  const text = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "text", mode), base.text);
  const muted = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "textMuted", mode), base.muted);
  const bg = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "background", mode), base.bg);
  const panel = pickSolidThemeColor(
    resolvePrototypeOpencodeThemeSlot(definition, "backgroundPanel", mode),
    pickSolidThemeColor(
      resolvePrototypeOpencodeThemeSlot(definition, "backgroundElement", mode),
      mode === "light" ? blendHexColors(bg, text, 0.03) : blendHexColors(bg, text, 0.07),
    ),
  );
  const panel2 = pickSolidThemeColor(
    resolvePrototypeOpencodeThemeSlot(definition, "backgroundElement", mode),
    derivePrototypePanel2Color(panel, bg, muted, mode),
  );
  const primary = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "primary", mode), base.accent);
  const secondary = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "secondary", mode), primary);
  const info = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "info", mode), secondary);
  const warning = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "warning", mode), base.warn);
  const error = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "error", mode), base.error);
  const success = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "success", mode), base.ok);
  const border = pickSolidThemeColor(
    resolvePrototypeOpencodeThemeSlot(definition, "border", mode),
    blendHexColors(text, bg, mode === "light" ? 0.82 : 0.76),
  );
  const borderSubtle = pickSolidThemeColor(
    resolvePrototypeOpencodeThemeSlot(definition, "borderSubtle", mode),
    blendHexColors(text, bg, mode === "light" ? 0.90 : 0.86),
  );
  const borderActive = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "borderActive", mode), primary);
  const syntaxComment = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxComment", mode), muted);
  const syntaxKeyword = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxKeyword", mode), primary);
  const syntaxFunction = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxFunction", mode), secondary);
  const syntaxVariable = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxVariable", mode), text);
  const syntaxString = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxString", mode), success);
  const syntaxNumber = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxNumber", mode), warning);
  const syntaxType = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxType", mode), secondary);
  const syntaxOperator = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxOperator", mode), text);
  const syntaxPunctuation = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "syntaxPunctuation", mode), text);
  const mdHeading = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownHeading", mode), primary);
  const mdLink = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownLink", mode), primary);
  const mdLinkText = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownLinkText", mode), muted);
  const mdCode = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownCode", mode), syntaxString);
  const mdCodeBlock = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownCodeBlock", mode), text);
  const mdQuote = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownBlockQuote", mode), syntaxComment);
  const mdHr = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownHorizontalRule", mode), borderSubtle);
  const mdListBullet = pickSolidThemeColor(resolvePrototypeOpencodeThemeSlot(definition, "markdownListItem", mode), primary);

  return {
    bg,
    panel,
    panel2,
    text,
    muted,
    accent: primary,
    warn: warning,
    error,
    ok: success,
    mdHeading,
    mdLink,
    mdLinkUrl: mdLinkText,
    mdCode,
    mdCodeBlock,
    mdCodeBlockBorder: borderSubtle,
    mdQuote,
    mdQuoteBorder: borderActive,
    mdHr,
    mdListBullet,
    syntaxComment,
    syntaxKeyword,
    syntaxFunction,
    syntaxVariable,
    syntaxString,
    syntaxNumber,
    syntaxType,
    syntaxOperator,
    syntaxPunctuation,
    border,
    borderMuted: borderSubtle,
    editorBg: panel,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function blendHexColors(base: string, mix: string, amount: number): string {
  const a = hexToRgb(base);
  const b = hexToRgb(mix);
  if (!a || !b) return base;
  const t = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  );
}

function pickPaletteColor(
  palette: Map<number, string>,
  indices: number[],
  fallback: string,
): string {
  for (const index of indices) {
    const value = palette.get(index);
    if (value) return value;
  }
  return fallback;
}

function buildGhosttyPaletteSeed(
  definition: PrototypeGhosttyThemeInput,
  mode: Exclude<PrototypeThemePreference, "system">,
): Partial<PrototypePaletteSeed> {
  const base = mode === "light" ? BASE_LIGHT_PALETTE : BASE_DARK_PALETTE;
  const bg = definition.background;
  const text = definition.foreground;
  const muted = pickPaletteColor(definition.palette, [8, 7], blendHexColors(text, bg, 0.45));
  const accent = pickPaletteColor(definition.palette, [4, 12, 6, 14], definition.cursorColor ?? base.accent);
  const warn = pickPaletteColor(definition.palette, [11, 3], base.warn);
  const error = pickPaletteColor(definition.palette, [1, 9], base.error);
  const ok = pickPaletteColor(definition.palette, [2, 10], base.ok);
  const keyword = pickPaletteColor(definition.palette, [5, 13], accent);
  const panel = blendHexColors(bg, text, mode === "light" ? 0.03 : 0.07);
  const panel2 = blendHexColors(bg, text, mode === "light" ? 0.06 : 0.12);

  return {
    bg,
    panel,
    panel2,
    text,
    muted,
    accent,
    warn,
    error,
    ok,
    mdHeading: keyword,
    mdLink: accent,
    mdLinkUrl: muted,
    mdCode: ok,
    mdCodeBlock: ok,
    mdCodeBlockBorder: muted,
    mdQuote: muted,
    mdQuoteBorder: accent,
    mdHr: muted,
    mdListBullet: accent,
    syntaxComment: muted,
    syntaxKeyword: keyword,
    syntaxFunction: accent,
    syntaxVariable: text,
    syntaxString: ok,
    syntaxNumber: warn,
    syntaxType: accent,
    syntaxOperator: text,
    syntaxPunctuation: text,
    editorBg: panel,
    border: blendHexColors(text, bg, mode === "light" ? 0.82 : 0.76),
    borderMuted: blendHexColors(text, bg, mode === "light" ? 0.90 : 0.86),
  };
}

export function buildPrototypeThemeVarsFromGhosttyTheme(
  definition: PrototypeGhosttyThemeInput,
  mode: Exclude<PrototypeThemePreference, "system">,
): PrototypeThemeRecord {
  return buildThemeVars(mode, buildGhosttyPaletteSeed(definition, mode));
}

export function buildPrototypeThemeVarsFromOpencodeTheme(
  definition: PrototypeOpencodeThemeInput,
  mode: PrototypeOpencodeThemeMode,
): PrototypeThemeRecord {
  return buildThemeVars(mode, buildOpencodePaletteSeed(definition, mode));
}

async function buildGhosttyThemeDescriptor(configured: ResolvedConfiguredTheme): Promise<PrototypeThemeDescriptor | null> {
  const reference = shouldUseGhosttyTheme(configured)
    ? await readGhosttyThemeReference()
    : (configured.raw ? parseGhosttyThemeReference(configured.raw) : null);
  if (!reference) return null;

  const effectiveMode = configured.mode;
  const lightName = reference.light;
  const darkName = reference.dark;
  const currentName = effectiveMode === "light"
    ? (lightName ?? darkName)
    : effectiveMode === "dark"
      ? (darkName ?? lightName)
      : (reference.single ?? darkName ?? lightName);

  const lightTheme = lightName ? await readGhosttyThemeDefinition(lightName) : null;
  const darkTheme = darkName ? await readGhosttyThemeDefinition(darkName) : null;
  const currentTheme = currentName ? await readGhosttyThemeDefinition(currentName) : null;

  if (!lightTheme && !darkTheme && !currentTheme) {
    return null;
  }

  const inferredPreference = effectiveMode ?? inferThemePreference(currentName ?? configured.raw);
  const singleThemeReference = Boolean(reference.single) && lightName === darkName;

  let lightSeed = lightTheme ? buildGhosttyPaletteSeed(lightTheme as PrototypeGhosttyThemeInput, "light") : undefined;
  let darkSeed = darkTheme ? buildGhosttyPaletteSeed(darkTheme as PrototypeGhosttyThemeInput, "dark") : undefined;

  if (singleThemeReference && currentTheme) {
    if (inferredPreference === "light") {
      lightSeed = buildGhosttyPaletteSeed(currentTheme as PrototypeGhosttyThemeInput, "light");
      darkSeed = undefined;
    } else if (inferredPreference === "dark") {
      lightSeed = undefined;
      darkSeed = buildGhosttyPaletteSeed(currentTheme as PrototypeGhosttyThemeInput, "dark");
    } else {
      lightSeed = buildGhosttyPaletteSeed(currentTheme as PrototypeGhosttyThemeInput, "light");
      darkSeed = buildGhosttyPaletteSeed(currentTheme as PrototypeGhosttyThemeInput, "dark");
    }
  }

  return {
    raw: currentName ?? configured.raw,
    preference: inferredPreference === "system" && lightSeed && darkSeed ? "system" : inferredPreference,
    source: shouldUseGhosttyTheme(configured) ? "ghostty-config" : configured.source,
    family: null,
    lightVars: buildThemeVars("light", lightSeed),
    darkVars: buildThemeVars("dark", darkSeed),
  };
}

async function buildOpencodeThemeDescriptor(
  configured: ResolvedConfiguredTheme,
  directory?: string,
): Promise<PrototypeThemeDescriptor | null> {
  const raw = configured.raw?.trim();
  const normalized = normalizeThemeKey(raw ?? "");
  if (!raw || normalized === "system" || normalized === "auto") {
    return null;
  }

  const definition = await readPrototypeOpencodeThemeDefinition(raw, directory);
  if (!definition) {
    return null;
  }

  const preference = configured.mode ?? inferThemePreference(raw);

  return {
    raw,
    preference,
    source: configured.source,
    family: null,
    lightVars: buildPrototypeThemeVarsFromOpencodeTheme(definition, "light"),
    darkVars: buildPrototypeThemeVarsFromOpencodeTheme(definition, "dark"),
  };
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

function getThemeFamilySeed(
  family: PrototypeThemeFamilyDefinition | undefined,
  mode: Exclude<PrototypeThemePreference, "system">,
): Partial<PrototypePaletteSeed> | undefined {
  return mode === "light" ? family?.light : family?.dark;
}

function resolveThemePreference(
  raw: string | null,
  family: PrototypeThemeFamilyDefinition | undefined,
  modeOverride?: Exclude<PrototypeThemePreference, "system"> | null,
): PrototypeThemePreference {
  if (modeOverride) {
    if (!family) return modeOverride;
    if (modeOverride === "light" && family.light) return "light";
    if (modeOverride === "dark" && family.dark) return "dark";
  }
  return family?.preference ?? inferThemePreference(raw);
}

function normalizeColorToken(value: string | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function derivePrototypePanel2Color(
  panel: string,
  bg: string,
  muted: string,
  mode: Exclude<PrototypeThemePreference, "system">,
): string {
  return mode === "light"
    ? blendHexColors(panel, muted, 0.06)
    : blendHexColors(panel, bg, 0.45);
}

function buildThemeVars(mode: Exclude<PrototypeThemePreference, "system">, override: Partial<PrototypePaletteSeed> | undefined): PrototypeThemeRecord {
  const base = mode === "light" ? BASE_LIGHT_PALETTE : BASE_DARK_PALETTE;
  const explicit = override ?? {};
  const palette: PrototypePaletteSeed = {
    ...base,
    ...explicit,
  };

  const panel2 = !palette.panel2 || normalizeColorToken(palette.panel2) === normalizeColorToken(palette.panel)
    ? derivePrototypePanel2Color(palette.panel, palette.bg, palette.muted, mode)
    : palette.panel2;
  const editorBg = explicit.editorBg ?? (mode === "light"
    ? blendHexColors(palette.panel, "#ffffff", 0.5)
    : palette.panel);
  const border = palette.border ?? withAlpha(palette.text, mode === "light" ? 0.12 : 0.10, base.border ?? "rgba(0, 0, 0, 0.1)");
  const borderMuted = palette.borderMuted ?? withAlpha(palette.text, mode === "light" ? 0.10 : 0.08, base.borderMuted ?? "rgba(0, 0, 0, 0.08)");
  const accentSoft = explicit.accentSoft ?? withAlpha(palette.accent, mode === "light" ? 0.28 : 0.35, base.accentSoft ?? "rgba(0, 0, 0, 0.12)");
  const accentSoftStrong = explicit.accentSoftStrong ?? withAlpha(palette.accent, mode === "light" ? 0.35 : 0.40, base.accentSoftStrong ?? "rgba(0, 0, 0, 0.22)");
  const hasOverride = Object.keys(explicit).length > 0;
  const markerBg = explicit.markerBg ?? withAlpha(palette.accent, mode === "light" ? 0.13 : 0.25, base.markerBg);
  const markerBorder = explicit.markerBorder ?? withAlpha(palette.accent, mode === "light" ? 0.45 : 0.65, base.markerBorder ?? "rgba(0, 0, 0, 0.3)");
  const okBorder = explicit.okBorder ?? withAlpha(palette.ok, mode === "light" ? 0.55 : 0.70, base.okBorder);
  const warnBorder = explicit.warnBorder ?? withAlpha(palette.warn, mode === "light" ? 0.55 : 0.70, base.warnBorder);
  const mdCodeBlock = explicit.mdCodeBlock ?? (hasOverride
    ? blendHexColors(palette.mdCode, palette.text, mode === "light" ? 0.18 : 0.28)
    : palette.mdCodeBlock);
  const mdCodeBlockBorder = explicit.mdCodeBlockBorder ?? (hasOverride
    ? blendHexColors(palette.muted, palette.panel, mode === "light" ? 0.12 : 0.18)
    : palette.mdCodeBlockBorder);
  const mdQuoteBorder = explicit.mdQuoteBorder ?? (hasOverride
    ? blendHexColors(palette.mdQuote, palette.panel, mode === "light" ? 0.05 : 0.10)
    : palette.mdQuoteBorder);
  const mdHr = explicit.mdHr ?? (hasOverride ? mdQuoteBorder : palette.mdHr);
  const syntaxType = explicit.syntaxType ?? (hasOverride
    ? blendHexColors(palette.syntaxFunction, palette.syntaxVariable, 0.45)
    : palette.syntaxType);
  const syntaxPunctuation = explicit.syntaxPunctuation ?? (hasOverride ? palette.syntaxOperator : palette.syntaxPunctuation);
  const accentContrast = explicit.accentContrast ?? defaultContrastColor(palette.accent, "#08101f", "#ffffff");
  const errorContrast = explicit.errorContrast ?? defaultContrastColor(palette.error, "#210908", "#ffffff");
  const panelShadow = explicit.panelShadow ?? (mode === "light"
    ? "0 1px 2px rgba(15, 23, 42, 0.03), 0 4px 14px rgba(15, 23, 42, 0.04)"
    : "0 1px 2px rgba(0, 0, 0, 0.36), 0 6px 18px rgba(0, 0, 0, 0.22)");
  const blockquoteBg = withAlpha(
    mdQuoteBorder,
    mode === "light" ? 0.10 : 0.16,
    mode === "light" ? "rgba(15, 23, 42, 0.04)" : "rgba(255, 255, 255, 0.05)",
  );
  const tableAltBg = withAlpha(
    mdCodeBlockBorder,
    mode === "light" ? 0.10 : 0.14,
    mode === "light" ? "rgba(15, 23, 42, 0.03)" : "rgba(255, 255, 255, 0.04)",
  );

  return {
    "--bg": palette.bg,
    "--panel": palette.panel,
    "--panel-2": panel2,
    "--card": palette.panel,
    "--editor-bg": editorBg,
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
    "--marker-bg": markerBg,
    "--marker-border": markerBorder,
    "--ok-border": okBorder,
    "--warn-border": warnBorder,
    "--panel-shadow": panelShadow,
    "--md-heading": palette.mdHeading,
    "--md-link": palette.mdLink,
    "--md-link-url": palette.mdLinkUrl,
    "--md-code": palette.mdCode,
    "--md-codeblock": mdCodeBlock,
    "--md-codeblock-border": mdCodeBlockBorder,
    "--md-quote": palette.mdQuote,
    "--md-quote-border": mdQuoteBorder,
    "--md-hr": mdHr,
    "--md-list-bullet": palette.mdListBullet,
    "--syntax-comment": palette.syntaxComment,
    "--syntax-keyword": palette.syntaxKeyword,
    "--syntax-function": palette.syntaxFunction,
    "--syntax-variable": palette.syntaxVariable,
    "--syntax-string": palette.syntaxString,
    "--syntax-number": palette.syntaxNumber,
    "--syntax-type": syntaxType,
    "--syntax-operator": palette.syntaxOperator,
    "--syntax-punctuation": syntaxPunctuation,
    "--blockquote-bg": blockquoteBg,
    "--table-alt-bg": tableAltBg,
  };
}

function cssDeclarations(vars: PrototypeThemeRecord): string {
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");
}

export function buildPrototypeThemeDescriptor(
  raw: string | null | undefined,
  source: PrototypeThemeSource = "default",
  modeOverride?: Exclude<PrototypeThemePreference, "system"> | null,
): PrototypeThemeDescriptor {
  const normalizedRaw = typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const inferredPreference = modeOverride ?? inferThemePreference(normalizedRaw);
  const lightVars = buildThemeVars("light", undefined);
  const darkVars = buildThemeVars("dark", undefined);

  return {
    raw: normalizedRaw,
    preference: inferredPreference,
    source,
    family: null,
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

export async function readPrototypeThemeDescriptor(directory?: string): Promise<PrototypeThemeDescriptor> {
  const configured = await readConfiguredTheme();
  const opencodeTheme = await buildOpencodeThemeDescriptor(configured, directory);
  if (opencodeTheme) {
    return opencodeTheme;
  }
  const ghosttyTheme = await buildGhosttyThemeDescriptor(configured);
  if (ghosttyTheme) {
    return ghosttyTheme;
  }
  return buildPrototypeThemeDescriptor(configured.raw, configured.source, configured.mode);
}
