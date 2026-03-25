import test from "node:test";
import assert from "node:assert/strict";
import { buildPrototypeThemeDescriptor, buildPrototypeThemeStylesheet } from "../src/prototype-theme.js";

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
