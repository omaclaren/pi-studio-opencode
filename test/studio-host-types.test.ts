import test from "node:test";
import assert from "node:assert/strict";
import { describeStudioHostCapabilities } from "../src/studio-host-types.js";

test("describeStudioHostCapabilities summarizes steering mode and stop support", () => {
  assert.equal(
    describeStudioHostCapabilities({ steeringMode: "adapter-queue", stopSupported: true }),
    "adapter-queue, native stop/abort",
  );
  assert.equal(
    describeStudioHostCapabilities({ steeringMode: "native-queue", stopSupported: false }),
    "native-queue, no stop",
  );
});
