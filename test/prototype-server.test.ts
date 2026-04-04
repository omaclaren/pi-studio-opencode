import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPrototypeAccessUrl,
  buildPrototypeBaseUrl,
  normalizePrototypeAccessHost,
} from "../src/prototype-server.js";

test("normalizePrototypeAccessHost prefers loopback over wildcard binds", () => {
  assert.equal(normalizePrototypeAccessHost("0.0.0.0"), "127.0.0.1");
  assert.equal(normalizePrototypeAccessHost("::"), "127.0.0.1");
});

test("normalizePrototypeAccessHost formats IPv6 browser hosts safely", () => {
  assert.equal(normalizePrototypeAccessHost("::1"), "[::1]");
  assert.equal(normalizePrototypeAccessHost("::ffff:127.0.0.1"), "127.0.0.1");
});

test("buildPrototypeAccessUrl uses a browser-safe host", () => {
  assert.equal(buildPrototypeBaseUrl("::1", 4312), "http://[::1]:4312");
  assert.equal(
    buildPrototypeAccessUrl("0.0.0.0", 4312, "abc 123"),
    "http://127.0.0.1:4312/?token=abc%20123",
  );
});
