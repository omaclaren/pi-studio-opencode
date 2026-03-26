import test from "node:test";
import assert from "node:assert/strict";
import { inferPrototypePdfLanguage, sanitizePrototypePdfFilename } from "../src/prototype-pdf.js";

test("sanitizePrototypePdfFilename normalizes unsafe names", () => {
  assert.equal(sanitizePrototypePdfFilename("../notes:week*1"), "notes-week-1.pdf");
  assert.equal(sanitizePrototypePdfFilename("report.pdf"), "report.pdf");
  assert.equal(sanitizePrototypePdfFilename(""), "studio-preview.pdf");
});

test("inferPrototypePdfLanguage respects editor language and raw diff detection", () => {
  assert.equal(inferPrototypePdfLanguage("hello", "typescript"), "typescript");
  assert.equal(
    inferPrototypePdfLanguage("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n"),
    "diff",
  );
  assert.equal(inferPrototypePdfLanguage("```python\nprint('hi')\n```"), "python");
  assert.equal(inferPrototypePdfLanguage("plain markdown text"), undefined);
});
