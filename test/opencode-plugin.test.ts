import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PiStudioOpencodePlugin from "../src/opencode-plugin.js";

type MinimalPluginContext = {
  directory: string;
  client: Record<string, unknown>;
};

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(REPO_ROOT, "src");

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(fullPath);
    }
    if (entry.isFile() && extname(entry.name) === ".ts") {
      return [fullPath];
    }
    return [];
  }));
  return files.flat().sort();
}

test("PiStudioOpencodePlugin loads and injects the studio command", async () => {
  const plugin = await PiStudioOpencodePlugin({
    directory: "/tmp/pi-studio-opencode-test",
    client: {},
  } as MinimalPluginContext as never);

  assert.equal(typeof plugin.config, "function");
  assert.equal(typeof plugin.event, "function");
  assert.equal(typeof plugin["command.execute.before"], "function");

  const config: { command?: Record<string, { template: string; description: string }> } = {};
  await plugin.config?.(config as never);

  assert.deepEqual(config.command?.studio, {
    template: "Open π Studio for this active opencode session.",
    description: "Open π Studio attached to the current opencode session",
  });
});

test("PiStudioOpencodePlugin preserves an existing studio command entry", async () => {
  const plugin = await PiStudioOpencodePlugin({
    directory: "/tmp/pi-studio-opencode-test",
    client: {},
  } as MinimalPluginContext as never);

  const config = {
    command: {
      studio: {
        template: "existing template",
        description: "existing description",
      },
    },
  };

  await plugin.config?.(config as never);

  assert.deepEqual(config.command.studio, {
    template: "existing template",
    description: "existing description",
  });
});

test("source TypeScript files do not contain NUL bytes that break plugin loading", async () => {
  const sourceFiles = await collectSourceFiles(SRC_DIR);
  assert.ok(sourceFiles.length > 0);

  for (const filePath of sourceFiles) {
    const content = await readFile(filePath);
    const nulIndex = content.indexOf(0);
    assert.equal(
      nulIndex,
      -1,
      `Unexpected NUL byte in ${filePath} at byte offset ${nulIndex}`,
    );
  }
});
