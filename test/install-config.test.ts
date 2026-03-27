import test from "node:test";
import assert from "node:assert/strict";
import {
  mergePiStudioOpencodeIntoConfig,
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

test("mergePiStudioOpencodeIntoConfig adds plugin, command, and schema when missing", () => {
  const result = mergePiStudioOpencodeIntoConfig({}, {
    pluginSpec: "pi-studio-opencode@latest",
    packageName: "pi-studio-opencode",
    commandName: "studio",
  });

  assert.equal(result.changed, true);
  assert.equal(result.addedPlugin, true);
  assert.equal(result.addedCommand, true);
  assert.equal(result.setSchema, true);
  assert.deepEqual(result.config.plugin, ["pi-studio-opencode@latest"]);
  assert.equal(result.config.command?.studio?.template, "Open π Studio for this active opencode session.");
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
  assert.equal(result.setSchema, false);
  assert.deepEqual(result.config.plugin, ["/Users/example/dev/pi-studio-opencode"]);
  assert.equal(result.config.command?.studio?.template, "Keep existing template");
});
