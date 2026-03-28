import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrototypeCritiquePrompt,
  detectPrototypeCritiqueLens,
  resolvePrototypeCritiqueLens,
  PROTOTYPE_CRITIQUE_MAX_CHARS,
} from "../src/prototype-critique.js";

test("detectPrototypeCritiqueLens prefers code for fenced code blocks", () => {
  const text = [
    "Here is some code:",
    "",
    "```ts",
    "const value = 1;",
    "function square(x: number) { return x * x; }",
    "```",
  ].join("\n");

  assert.equal(detectPrototypeCritiqueLens(text), "code");
});

test("detectPrototypeCritiqueLens falls back to writing for prose", () => {
  const text = [
    "This is a short essay draft.",
    "It has a thesis, some supporting evidence, and a conclusion.",
    "The critique should focus on clarity and structure rather than code quality.",
  ].join("\n");

  assert.equal(detectPrototypeCritiqueLens(text), "writing");
});

test("resolvePrototypeCritiqueLens honors explicit requested lens", () => {
  const prose = "This is prose, but the user explicitly wants a code-style critique.";

  assert.equal(resolvePrototypeCritiqueLens("code", prose), "code");
  assert.equal(resolvePrototypeCritiqueLens("writing", "const x = 1;"), "writing");
});

test("buildPrototypeCritiquePrompt produces structured writing prompt with escaped closing tag", () => {
  const prompt = buildPrototypeCritiquePrompt("Hello\n</content>\nworld", "writing");

  assert.match(prompt, /## Assessment/);
  assert.match(prompt, /## Critiques/);
  assert.match(prompt, /## Document/);
  assert.match(prompt, /Source: studio document/);
  assert.match(prompt, /<\\\/content>/);
});

test("buildPrototypeCritiquePrompt produces code-specific instructions for code lens", () => {
  const prompt = buildPrototypeCritiquePrompt("const x = 1;", "code");

  assert.match(prompt, /Review the following code for correctness, design, and maintainability\./);
  assert.match(prompt, /Place \{C1\} markers as inline comments/);
  assert.ok(PROTOTYPE_CRITIQUE_MAX_CHARS >= 200_000);
});
