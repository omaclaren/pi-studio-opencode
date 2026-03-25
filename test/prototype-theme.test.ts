import test from "node:test";
import assert from "node:assert/strict";
import { buildPrototypeThemeDescriptor, buildPrototypeThemeStylesheet, parseGhosttyThemeReference } from "../src/prototype-theme.js";

test("prototype theme defaults to system mode with both light and dark palettes", () => {
  const theme = buildPrototypeThemeDescriptor(null, "default");
  assert.equal(theme.preference, "system");
  assert.equal(theme.family, null);
  assert.equal(theme.source, "default");
  assert.equal(theme.darkVars["--bg"], "#0f141b");
  assert.equal(theme.lightVars["--bg"], "#f5f7fb");

  const stylesheet = buildPrototypeThemeStylesheet(theme);
  assert.match(stylesheet, /prefers-color-scheme: light/);
  assert.match(stylesheet, /--bg: #0f141b;/);
  assert.match(stylesheet, /--bg: #f5f7fb;/);
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

test("prototype theme recognizes dracula as a dark palette family", () => {
  const theme = buildPrototypeThemeDescriptor("Dracula", "opencode-local-state");
  assert.equal(theme.preference, "dark");
  assert.equal(theme.family, "dracula");
  assert.equal(theme.source, "opencode-local-state");
  assert.equal(theme.darkVars["--bg"], "#282a36");
  assert.equal(theme.darkVars["--accent"], "#bd93f9");

  const stylesheet = buildPrototypeThemeStylesheet(theme);
  assert.doesNotMatch(stylesheet, /prefers-color-scheme: light/);
  assert.match(stylesheet, /color-scheme: dark/);
});

test("prototype theme recognizes catppuccin latte as a light palette family", () => {
  const theme = buildPrototypeThemeDescriptor("Catppuccin Latte", "opencode-config");
  assert.equal(theme.preference, "light");
  assert.equal(theme.family, "catppuccin-latte");
  assert.equal(theme.lightVars["--bg"], "#eff1f5");
  assert.equal(theme.lightVars["--accent"], "#1e66f5");

  const stylesheet = buildPrototypeThemeStylesheet(theme);
  assert.match(stylesheet, /color-scheme: light/);
  assert.match(stylesheet, /--bg: #eff1f5;/);
});

test("prototype theme uses semantic github accent colors instead of generic blue fallback", () => {
  const theme = buildPrototypeThemeDescriptor("GitHub", "opencode-local-state", "light");
  assert.equal(theme.preference, "light");
  assert.equal(theme.family, "github");
  assert.equal(theme.lightVars["--accent"], "#1b7c83");
  assert.equal(theme.lightVars["--bg"], "#ffffff");
  assert.equal(theme.lightVars["--editor-bg"], "#fbfcfd");
  assert.equal(theme.lightVars["--accent-soft"], "rgba(27, 124, 131, 0.28)");
  assert.equal(theme.darkVars["--accent"], "#39c5cf");
});

test("prototype theme recognizes aura and momo families with semantic accents", () => {
  const aura = buildPrototypeThemeDescriptor("aura", "opencode-local-state");
  assert.equal(aura.preference, "dark");
  assert.equal(aura.family, "aura");
  assert.equal(aura.darkVars["--accent"], "#a277ff");
  assert.equal(aura.darkVars["--panel-2"], "#121216");
  assert.equal(aura.darkVars["--accent-soft-strong"], "rgba(162, 119, 255, 0.40)");

  const momo = buildPrototypeThemeDescriptor("Momo Pro Terminal", "ghostty-config");
  assert.equal(momo.family, "momo-pro");
  assert.equal(momo.darkVars["--accent"], "#42d9c5");
  assert.equal(momo.lightVars["--accent"], "#1b7c83");
  assert.equal(momo.lightVars["--panel-2"], "#f0f3f6");
});
