import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPrototypeSyntheticNewFileDiff,
  readPrototypeGitDiff,
} from "../src/prototype-git-diff.js";

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout ?? "";
}

test("buildPrototypeSyntheticNewFileDiff creates a new-file unified diff", () => {
  const diff = buildPrototypeSyntheticNewFileDiff("notes/example.md", "hello\nworld\n");
  assert.match(diff, /^diff --git a\/notes\/example\.md b\/notes\/example\.md/m);
  assert.match(diff, /^new file mode 100644$/m);
  assert.match(diff, /^@@ -0,0 \+1,2 @@$/m);
  assert.match(diff, /^\+hello$/m);
  assert.match(diff, /^\+world$/m);
});

test("readPrototypeGitDiff returns warning when no repo is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-opencode-no-repo-"));
  try {
    const result = readPrototypeGitDiff(dir);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.level, "warning");
    assert.match(result.message, /No git repository found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readPrototypeGitDiff includes tracked and untracked text changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-opencode-git-diff-"));
  try {
    git(dir, ["init"]);
    git(dir, ["config", "user.name", "Pi Studio Test"]);
    git(dir, ["config", "user.email", "pi-studio-test@example.com"]);

    await writeFile(join(dir, "tracked.txt"), "old\n", "utf8");
    git(dir, ["add", "tracked.txt"]);
    git(dir, ["commit", "-m", "Initial commit"]);

    await writeFile(join(dir, "tracked.txt"), "new\n", "utf8");
    await writeFile(join(dir, "untracked.md"), "fresh\n", "utf8");

    const result = readPrototypeGitDiff(dir);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.match(result.repoRoot, /pi-studio-opencode-git-diff-/);
    assert.match(result.label, /^git diff HEAD/);
    assert.match(result.label, /untracked file/);
    assert.match(result.text, /^diff --git a\/tracked\.txt b\/tracked\.txt/m);
    assert.match(result.text, /^-old$/m);
    assert.match(result.text, /^\+new$/m);
    assert.match(result.text, /^diff --git a\/untracked\.md b\/untracked\.md/m);
    assert.match(result.text, /^\+fresh$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readPrototypeGitDiff handles repositories without commits yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-studio-opencode-git-empty-"));
  try {
    git(dir, ["init"]);
    await writeFile(join(dir, "draft.txt"), "draft\n", "utf8");

    const result = readPrototypeGitDiff(dir);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.match(result.repoRoot, /pi-studio-opencode-git-empty-/);
    assert.match(result.label, /^git diff \(no commits yet\)/);
    assert.match(result.text, /^diff --git a\/draft\.txt b\/draft\.txt/m);
    assert.match(result.text, /^\+draft$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
