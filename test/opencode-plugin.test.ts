import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PiStudioOpencodePluginModule, { PiStudioOpencodePlugin, PiStudioOpencodeTuiPlugin } from "../src/opencode-plugin.js";
import PiStudioOpencodeTuiPluginModule from "../src/opencode-plugin-tui.js";

type MinimalPluginContext = {
  directory: string;
  client: Record<string, unknown>;
};

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(REPO_ROOT, "src");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");

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

test("PiStudioOpencodePluginModule exposes only the server entrypoint", () => {
  assert.equal(PiStudioOpencodePluginModule.id, "pi-studio-opencode");
  assert.equal(typeof PiStudioOpencodePluginModule.server, "function");
  assert.equal("tui" in PiStudioOpencodePluginModule, false);
});

test("PiStudioOpencodeTuiPluginModule exposes only the tui entrypoint", () => {
  assert.equal(PiStudioOpencodeTuiPluginModule.id, "pi-studio-opencode");
  assert.equal(typeof PiStudioOpencodeTuiPluginModule.tui, "function");
  assert.equal("server" in PiStudioOpencodeTuiPluginModule, false);
});

test("package exports separate server and tui entrypoints", async () => {
  const pkg = JSON.parse(await readFile(PACKAGE_JSON, "utf8")) as {
    exports?: Record<string, { import?: string }>;
  };

  assert.equal(pkg.exports?.["./server"]?.import, "./dist/opencode-plugin.js");
  assert.equal(pkg.exports?.["./tui"]?.import, "./dist/opencode-plugin-tui.js");
});

test("PiStudioOpencodePlugin removes the legacy generated studio command entry", async () => {
  const plugin = await PiStudioOpencodePlugin({
    directory: "/tmp/pi-studio-opencode-test",
    client: {},
  } as MinimalPluginContext as never);

  assert.equal(typeof plugin.config, "function");

  const config: { command?: Record<string, { template: string; description: string }> } = {};
  config.command = {
    studio: {
      template: "Open π Studio for this active opencode session.",
      description: "Open π Studio attached to the current opencode session",
    },
  };
  await plugin.config?.(config as never);

  assert.deepEqual(config.command, undefined);
});

test("PiStudioOpencodePlugin preserves non-legacy studio command entries", async () => {
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

test("PiStudioOpencodeTuiPlugin registers /studio on home", async () => {
  const commands: Array<ReturnType<() => unknown[]>> = [];

  await PiStudioOpencodeTuiPlugin({
    command: {
      register: (cb: () => unknown[]) => {
        commands.push(cb());
      },
    },
    route: {
      current: { name: "home" },
      navigate: () => {},
    },
    ui: {
      toast: () => {},
    },
    state: {
      path: {
        directory: "/tmp/pi-studio-opencode-test",
      },
    },
    client: {
      session: {
        create: async () => ({ data: { id: "session-created" } }),
      },
      client: {
        getConfig: () => ({
          baseUrl: "http://127.0.0.1:4113",
        }),
      },
    },
    lifecycle: {
      onDispose: () => () => {},
    },
  } as never);

  const studioCommand = commands.flat().find((command) => {
    if (!command || typeof command !== "object") return false;
    const slash = (command as { slash?: { name?: string } }).slash;
    return slash?.name === "studio";
  }) as { enabled?: boolean } | undefined;

  assert.ok(studioCommand);
  assert.notEqual(studioCommand.enabled, false);
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
