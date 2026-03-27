import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrototypeThemeDescriptor,
  buildPrototypeThemeStylesheet,
  buildPrototypeThemeVarsFromGhosttyTheme,
  buildPrototypeThemeVarsFromOpencodeTheme,
  parseGhosttyThemeReference,
} from "../src/prototype-theme.js";

test("prototype theme defaults to system mode with both light and dark palettes", () => {
  const theme = buildPrototypeThemeDescriptor(null, "default");
  assert.equal(theme.preference, "system");
  assert.equal(theme.family, null);
  assert.equal(theme.source, "default");
  assert.equal(theme.darkVars["--bg"], "#0f1117");
  assert.equal(theme.lightVars["--bg"], "#f5f7fb");
  assert.equal(theme.darkVars["--md-codeblock"], "#b5bd68");
  assert.equal(theme.darkVars["--md-codeblock-border"], "#808080");
  assert.equal(theme.darkVars["--syntax-type"], "#4EC9B0");
  assert.equal(theme.darkVars["--syntax-punctuation"], "#D4D4D4");

  const stylesheet = buildPrototypeThemeStylesheet(theme);
  assert.match(stylesheet, /prefers-color-scheme: light/);
  assert.match(stylesheet, /--bg: #0f1117;/);
  assert.match(stylesheet, /--bg: #f5f7fb;/);
  assert.match(stylesheet, /--md-codeblock: #b5bd68;/);
});

test("parseGhosttyThemeReference supports split dark/light assignments", () => {
  assert.deepEqual(
    parseGhosttyThemeReference("dark:Momo Pro Terminal,light:GitHub Light High Contrast"),
    {
      single: null,
      dark: "Momo Pro Terminal",
      light: "GitHub Light High Contrast",
    },
  );

  assert.deepEqual(
    parseGhosttyThemeReference("Catppuccin Mocha"),
    {
      single: "Catppuccin Mocha",
      dark: "Catppuccin Mocha",
      light: "Catppuccin Mocha",
    },
  );
});

test("prototype theme infers light or dark preference from the configured theme name", () => {
  const darkTheme = buildPrototypeThemeDescriptor("Dracula", "opencode-local-state");
  assert.equal(darkTheme.preference, "dark");
  assert.equal(darkTheme.family, null);
  assert.equal(darkTheme.source, "opencode-local-state");

  const lightTheme = buildPrototypeThemeDescriptor("Catppuccin Latte", "opencode-config");
  assert.equal(lightTheme.preference, "light");
  assert.equal(lightTheme.family, null);
  assert.equal(lightTheme.source, "opencode-config");

  const stylesheet = buildPrototypeThemeStylesheet(lightTheme);
  assert.match(stylesheet, /color-scheme: light/);
});

test("ghostty theme mapping follows generic semantic rules for a light palette", () => {
  const vars = buildPrototypeThemeVarsFromGhosttyTheme({
    background: "#ffffff",
    foreground: "#0e1116",
    cursorColor: "#0349b4",
    selectionBackground: "#0e1116",
    selectionForeground: "#ffffff",
    palette: new Map([
      [1, "#a0111f"],
      [2, "#024c1a"],
      [3, "#3f2200"],
      [4, "#0349b4"],
      [5, "#622cbc"],
      [6, "#1b7c83"],
      [8, "#4b535d"],
      [11, "#4e2c00"],
      [13, "#844ae7"],
      [14, "#3192aa"],
    ]),
  }, "light");

  assert.equal(vars["--bg"], "#ffffff");
  assert.equal(vars["--accent"], "#0349b4");
  assert.equal(vars["--panel-2"], "#f1f1f1");
  assert.equal(vars["--md-heading"], "#622cbc");
  assert.equal(vars["--md-link"], "#0349b4");
  assert.equal(vars["--md-code"], "#024c1a");
  assert.equal(vars["--md-codeblock"], "#024c1a");
  assert.equal(vars["--md-quote"], "#4b535d");
  assert.equal(vars["--syntax-keyword"], "#622cbc");
  assert.equal(vars["--syntax-function"], "#0349b4");
  assert.equal(vars["--syntax-string"], "#024c1a");
  assert.equal(vars["--syntax-number"], "#4e2c00");
  assert.equal(vars["--syntax-variable"], "#0e1116");
});

test("ghostty theme mapping follows generic semantic rules for a dark palette", () => {
  const vars = buildPrototypeThemeVarsFromGhosttyTheme({
    background: "#1f1f1f",
    foreground: "#d5d0c9",
    cursorColor: "#efc4cd",
    selectionBackground: "#363636",
    selectionForeground: "#d5d0c9",
    palette: new Map([
      [1, "#f56e7f"],
      [2, "#bec975"],
      [4, "#42d9c5"],
      [5, "#d286b7"],
      [6, "#37cb8a"],
      [8, "#88847f"],
      [11, "#f1bb79"],
      [13, "#b294bb"],
      [14, "#9dccbb"],
    ]),
  }, "dark");

  assert.equal(vars["--bg"], "#1f1f1f");
  assert.equal(vars["--accent"], "#42d9c5");
  assert.equal(vars["--md-heading"], "#d286b7");
  assert.equal(vars["--md-codeblock"], "#bec975");
  assert.equal(vars["--md-quote-border"], "#42d9c5");
  assert.equal(vars["--syntax-keyword"], "#d286b7");
  assert.equal(vars["--syntax-string"], "#bec975");
  assert.equal(vars["--syntax-number"], "#f1bb79");
  assert.equal(vars["--syntax-operator"], "#d5d0c9");
  assert.equal(vars["--syntax-punctuation"], "#d5d0c9");
});

test("opencode semantic theme mapping uses resolved semantic colors for opaque palettes", () => {
  const vars = buildPrototypeThemeVarsFromOpencodeTheme({
    defs: {
      darkStep1: "#0a0a0a",
      darkStep2: "#141414",
      darkStep3: "#1e1e1e",
      darkStep6: "#3c3c3c",
      darkStep11: "#808080",
      darkStep12: "#eeeeee",
      darkOrange: "#ec5b2b",
      darkBlue: "#6ba1e6",
      darkCyan: "#56b6c2",
      darkYellow: "#e5c07b",
      darkRed: "#e06c75",
    },
    theme: {
      primary: { dark: "darkOrange", light: "#ec5b2b" },
      secondary: { dark: "darkOrange", light: "#ee7948" },
      success: { dark: "darkBlue", light: "#0062d1" },
      error: { dark: "darkRed", light: "#d1383d" },
      warning: { dark: "darkOrange", light: "#ec5b2b" },
      info: { dark: "darkCyan", light: "#318795" },
      text: { dark: "darkStep12", light: "#1a1a1a" },
      textMuted: { dark: "darkStep11", light: "#8a8a8a" },
      background: { dark: "darkStep1", light: "#ffffff" },
      backgroundPanel: { dark: "darkStep2", light: "#fff7f1" },
      backgroundElement: { dark: "darkStep3", light: "#f5f0eb" },
      border: { dark: "darkOrange", light: "#ec5b2b" },
      borderSubtle: { dark: "darkStep6", light: "#d4d4d4" },
      borderActive: { dark: "darkOrange", light: "#c94d24" },
      markdownHeading: { dark: "darkOrange", light: "#ec5b2b" },
      markdownLink: { dark: "darkOrange", light: "#ec5b2b" },
      markdownLinkText: { dark: "darkCyan", light: "#318795" },
      markdownCode: { dark: "darkBlue", light: "#0062d1" },
      markdownCodeBlock: { dark: "darkStep12", light: "#1a1a1a" },
      markdownBlockQuote: { dark: "#fff7f1", light: "#b0851f" },
      markdownHorizontalRule: { dark: "darkStep11", light: "#8a8a8a" },
      markdownListItem: { dark: "darkOrange", light: "#ec5b2b" },
      syntaxComment: { dark: "darkStep11", light: "#8a8a8a" },
      syntaxKeyword: { dark: "darkOrange", light: "#ec5b2b" },
      syntaxFunction: { dark: "darkOrange", light: "#c94d24" },
      syntaxVariable: { dark: "darkRed", light: "#d1383d" },
      syntaxString: { dark: "darkBlue", light: "#0062d1" },
      syntaxNumber: { dark: "#fff7f1", light: "#ec5b2b" },
      syntaxType: { dark: "darkYellow", light: "#b0851f" },
      syntaxOperator: { dark: "darkCyan", light: "#318795" },
      syntaxPunctuation: { dark: "darkStep12", light: "#1a1a1a" },
    },
  }, "dark");

  assert.equal(vars["--bg"], "#0a0a0a");
  assert.equal(vars["--panel"], "#141414");
  assert.equal(vars["--panel-2"], "#1e1e1e");
  assert.equal(vars["--accent"], "#ec5b2b");
  assert.equal(vars["--border"], "#ec5b2b");
  assert.equal(vars["--md-code"], "#6ba1e6");
  assert.equal(vars["--syntax-string"], "#6ba1e6");
  assert.equal(vars["--syntax-number"], "#fff7f1");
});

test("opencode semantic theme mapping falls back to Studio surfaces for transparent palettes", () => {
  const vars = buildPrototypeThemeVarsFromOpencodeTheme({
    defs: {
      lightStep11: "#8a8a8a",
      lightStep12: "#1a1a1a",
      lightOrange: "#ec5b2b",
      lightBlue: "#0062d1",
      lightCyan: "#318795",
      lightYellow: "#b0851f",
      lightRed: "#d1383d",
    },
    theme: {
      primary: { dark: "#ec5b2b", light: "lightOrange" },
      secondary: { dark: "#ee7948", light: "#ee7948" },
      accent: { dark: "#fff7f1", light: "#c94d24" },
      success: { dark: "#6ba1e6", light: "lightBlue" },
      error: { dark: "#e06c75", light: "lightRed" },
      warning: { dark: "#ec5b2b", light: "lightOrange" },
      info: { dark: "#56b6c2", light: "lightCyan" },
      text: { dark: "#eeeeee", light: "lightStep12" },
      textMuted: { dark: "#808080", light: "lightStep11" },
      background: { dark: "transparent", light: "transparent" },
      backgroundPanel: { dark: "transparent", light: "transparent" },
      backgroundElement: { dark: "transparent", light: "transparent" },
      border: { dark: "#ec5b2b", light: "lightOrange" },
      borderSubtle: { dark: "#3c3c3c", light: "#d4d4d4" },
      borderActive: { dark: "#ee7948", light: "#c94d24" },
      markdownHeading: { dark: "#ec5b2b", light: "lightOrange" },
      markdownLink: { dark: "#ec5b2b", light: "lightOrange" },
      markdownLinkText: { dark: "#56b6c2", light: "lightCyan" },
      markdownCode: { dark: "#6ba1e6", light: "lightBlue" },
      markdownBlockQuote: { dark: "#fff7f1", light: "lightYellow" },
      markdownHorizontalRule: { dark: "#808080", light: "lightStep11" },
      markdownListItem: { dark: "#ec5b2b", light: "lightOrange" },
      syntaxComment: { dark: "#808080", light: "lightStep11" },
      syntaxKeyword: { dark: "#ec5b2b", light: "lightOrange" },
      syntaxFunction: { dark: "#ee7948", light: "#c94d24" },
      syntaxVariable: { dark: "#e06c75", light: "lightRed" },
      syntaxString: { dark: "#6ba1e6", light: "lightBlue" },
      syntaxNumber: { dark: "#fff7f1", light: "lightOrange" },
      syntaxType: { dark: "#e5c07b", light: "lightYellow" },
      syntaxOperator: { dark: "#56b6c2", light: "lightCyan" },
      syntaxPunctuation: { dark: "#eeeeee", light: "lightStep12" },
    },
  }, "light");

  assert.equal(vars["--bg"], "#f5f7fb");
  assert.equal(vars["--panel"], "#eef0f4");
  assert.equal(vars["--accent"], "#ec5b2b");
  assert.equal(vars["--border"], "#ec5b2b");
  assert.equal(vars["--md-heading"], "#ec5b2b");
  assert.equal(vars["--syntax-string"], "#0062d1");
  assert.equal(vars["--syntax-operator"], "#318795");
});
