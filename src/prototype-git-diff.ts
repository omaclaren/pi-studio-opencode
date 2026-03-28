import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type PrototypeGitDiffResult =
  | { ok: true; text: string; label: string; repoRoot: string }
  | { ok: false; level: "info" | "warning" | "error"; message: string };

export function splitPrototypeGitPathOutput(output: string): string[] {
  return String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatPrototypeGitSpawnFailure(
  result: { stdout?: string | Buffer | null; stderr?: string | Buffer | null },
  args: string[],
): string {
  const stderr = typeof result.stderr === "string"
    ? result.stderr.trim()
    : (result.stderr ? result.stderr.toString("utf-8").trim() : "");
  const stdout = typeof result.stdout === "string"
    ? result.stdout.trim()
    : (result.stdout ? result.stdout.toString("utf-8").trim() : "");
  return stderr || stdout || `git ${args.join(" ")} failed`;
}

export function readPrototypeTextFileIfPossible(path: string): string | null {
  try {
    const buf = readFileSync(path);
    const sample = buf.subarray(0, 8192);
    let nulCount = 0;
    let controlCount = 0;
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      if (byte === 0x00) nulCount += 1;
      else if (byte < 0x08 || (byte > 0x0d && byte < 0x20 && byte !== 0x1b)) controlCount += 1;
    }
    if (nulCount > 0 || (sample.length > 0 && controlCount / sample.length > 0.1)) {
      return null;
    }
    return buf.toString("utf-8").replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
}

export function buildPrototypeSyntheticNewFileDiff(filePath: string, content: string): string {
  const lines = String(content ?? "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const diffLines = [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
  ];

  if (lines.length > 0) {
    diffLines.push(lines.map((line) => `+${line}`).join("\n"));
  }

  return diffLines.join("\n");
}

export function readPrototypeGitDiff(baseDir: string): PrototypeGitDiffResult {
  const repoRootArgs = ["rev-parse", "--show-toplevel"];
  const repoRootResult = spawnSync("git", repoRootArgs, {
    cwd: baseDir,
    encoding: "utf-8",
  });
  if (repoRootResult.status !== 0) {
    return {
      ok: false,
      level: "warning",
      message: "No git repository found for the current Studio context.",
    };
  }
  const repoRoot = repoRootResult.stdout.trim();

  const hasHead = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf-8",
  }).status === 0;

  const untrackedArgs = ["ls-files", "--others", "--exclude-standard"];
  const untrackedResult = spawnSync("git", untrackedArgs, {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  if (untrackedResult.status !== 0) {
    return {
      ok: false,
      level: "error",
      message: `Failed to list untracked files: ${formatPrototypeGitSpawnFailure(untrackedResult, untrackedArgs)}`,
    };
  }
  const untrackedPaths = splitPrototypeGitPathOutput(untrackedResult.stdout ?? "").sort();

  let diffOutput = "";
  let statSummary = "";
  let currentTreeFileCount = 0;

  if (hasHead) {
    const diffArgs = ["diff", "HEAD", "--unified=3", "--find-renames", "--no-color", "--"];
    const diffResult = spawnSync("git", diffArgs, {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    if (diffResult.status !== 0) {
      return {
        ok: false,
        level: "error",
        message: `Failed to collect git diff: ${formatPrototypeGitSpawnFailure(diffResult, diffArgs)}`,
      };
    }
    diffOutput = diffResult.stdout ?? "";

    const statArgs = ["diff", "HEAD", "--stat", "--find-renames", "--no-color", "--"];
    const statResult = spawnSync("git", statArgs, {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    if (statResult.status === 0) {
      const statLines = splitPrototypeGitPathOutput(statResult.stdout ?? "");
      statSummary = statLines.length > 0 ? (statLines[statLines.length - 1] ?? "") : "";
    }
  } else {
    const trackedArgs = ["ls-files", "--cached"];
    const trackedResult = spawnSync("git", trackedArgs, {
      cwd: repoRoot,
      encoding: "utf-8",
    });
    if (trackedResult.status !== 0) {
      return {
        ok: false,
        level: "error",
        message: `Failed to inspect tracked files: ${formatPrototypeGitSpawnFailure(trackedResult, trackedArgs)}`,
      };
    }

    const trackedPaths = splitPrototypeGitPathOutput(trackedResult.stdout ?? "");
    const currentTreePaths = Array.from(new Set([...trackedPaths, ...untrackedPaths])).sort();
    currentTreeFileCount = currentTreePaths.length;
    diffOutput = currentTreePaths
      .map((filePath) => {
        const content = readPrototypeTextFileIfPossible(join(repoRoot, filePath));
        if (content == null) return "";
        return buildPrototypeSyntheticNewFileDiff(filePath, content);
      })
      .filter((section) => section.length > 0)
      .join("\n\n");
  }

  const untrackedSections = hasHead
    ? untrackedPaths
      .map((filePath) => {
        const content = readPrototypeTextFileIfPossible(join(repoRoot, filePath));
        if (content == null) return "";
        return buildPrototypeSyntheticNewFileDiff(filePath, content);
      })
      .filter((section) => section.length > 0)
    : [];

  const fullDiff = [diffOutput.trimEnd(), ...untrackedSections].filter(Boolean).join("\n\n");
  if (!fullDiff.trim()) {
    return {
      ok: false,
      level: "info",
      message: "No uncommitted git changes to load.",
    };
  }

  const summaryParts: string[] = [];
  if (hasHead && statSummary) {
    summaryParts.push(statSummary);
  }
  if (!hasHead && currentTreeFileCount > 0) {
    summaryParts.push(`${currentTreeFileCount} file${currentTreeFileCount === 1 ? "" : "s"} in current tree`);
  }
  if (untrackedPaths.length > 0) {
    summaryParts.push(`${untrackedPaths.length} untracked file${untrackedPaths.length === 1 ? "" : "s"}`);
  }

  const labelBase = hasHead ? "git diff HEAD" : "git diff (no commits yet)";
  const label = summaryParts.length > 0 ? `${labelBase} (${summaryParts.join(", ")})` : labelBase;
  return { ok: true, text: fullDiff, label, repoRoot };
}
