import test from "node:test";
import assert from "node:assert/strict";
import {
  mergePiStudioOpencodeIntoConfig,
  mergePiStudioOpencodeIntoTuiConfig,
  normalizePluginIdentity,
  parseOpencodeConfigText,
} from "../src/install-config.js";

test("parseOpencodeConfigText accepts JSONC-style comments", () => {
  const config = parseOpencodeConfigText(`{
    // comment
    "plugin": ["existing-plugin@latest"],
    /* block comment */
    "command": {}
  }`);

  assert.deepEqual(config.plugin, ["existing-plugin@latest"]);
  assert.deepEqual(config.command, {});
});

test("normalizePluginIdentity treats package specs and local paths consistently", () => {
  assert.equal(normalizePluginIdentity("pi-studio-opencode@latest"), "pi-studio-opencode");
  assert.equal(normalizePluginIdentity("@scope/pkg@1.2.3"), "@scope/pkg");
  assert.equal(normalizePluginIdentity("/tmp/plugins/pi-studio-opencode"), "pi-studio-opencode");
  assert.equal(normalizePluginIdentity("file:///tmp/plugins/pi-studio-opencode"), "pi-studio-opencode");
});

test("mergePiStudioOpencodeIntoConfig adds plugin and schema when missing", () => {
  const result = mergePiStudioOpencodeIntoConfig({}, {
    pluginSpec: "pi-studio-opencode@latest",
    packageName: "pi-studio-opencode",
    commandName: "studio",
  });

  assert.equal(result.changed, true);
  assert.equal(result.addedPlugin, true);
  assert.equal(result.addedCommand, false);
  assert.equal(result.removedCommand, false);
  assert.equal(result.setSchema, true);
  assert.deepEqual(result.config.plugin, ["pi-studio-opencode@latest"]);
  assert.equal(result.config.command, undefined);
});

test("mergePiStudioOpencodeIntoConfig preserves existing command and avoids duplicate plugin entries", () => {
  const result = mergePiStudioOpencodeIntoConfig({
    $schema: "https://opencode.ai/config.json",
    plugin: ["/Users/example/dev/pi-studio-opencode"],
    command: {
      studio: {
        template: "Keep existing template",
        description: "Keep existing description",
      },
    },
  }, {
    pluginSpec: "pi-studio-opencode@latest",
    packageName: "pi-studio-opencode",
    commandName: "studio",
  });

  assert.equal(result.changed, false);
  assert.equal(result.addedPlugin, false);
  assert.equal(result.addedCommand, false);
  assert.equal(result.removedCommand, false);
  assert.equal(result.setSchema, false);
  assert.deepEqual(result.config.plugin, ["/Users/example/dev/pi-studio-opencode"]);
  assert.equal(result.config.command?.studio?.template, "Keep existing template");
});

test("mergePiStudioOpencodeIntoConfig removes the legacy generated studio command", () => {
  const result = mergePiStudioOpencodeIntoConfig({
    command: {
      studio: {
        template: "Open π Studio for this active opencode session.",
        description: "Open π Studio attached to the current opencode session",
      },
    },
  }, {
    pluginSpec: "pi-studio-opencode@latest",
    packageName: "pi-studio-opencode",
    commandName: "studio",
  });

  assert.equal(result.changed, true);
  assert.equal(result.removedCommand, true);
  assert.equal(result.config.command, undefined);
});

test("mergePiStudioOpencodeIntoTuiConfig adds plugin and tui schema when missing", () => {
  const result = mergePiStudioOpencodeIntoTuiConfig({}, {
    pluginSpec: "pi-studio-opencode@latest",
    packageName: "pi-studio-opencode",
  });

  assert.equal(result.changed, true);
  assert.equal(result.addedPlugin, true);
  assert.equal(result.setSchema, true);
  assert.deepEqual(result.config.plugin, ["pi-studio-opencode@latest"]);
  assert.equal(result.config.$schema, "https://opencode.ai/tui.json");
});

test("mergePiStudioOpencodeIntoTuiConfig preserves tuple plugin entries", () => {
  const result = mergePiStudioOpencodeIntoTuiConfig({
    plugin: [["pi-studio-opencode@latest", { compact: true }]],
  }, {
    pluginSpec: "pi-studio-opencode@latest",
    packageName: "pi-studio-opencode",
  });

  assert.equal(result.changed, true);
  assert.equal(result.addedPlugin, false);
  assert.equal(result.config.plugin?.length, 1);
  assert.deepEqual(result.config.plugin?.[0], ["pi-studio-opencode@latest", { compact: true }]);
});
