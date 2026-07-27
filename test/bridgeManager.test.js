"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MAX_INFLIGHT,
  normalizedEndpoint,
  versionAtLeast
} = require("../src/main/bridgeManager");

test("endpoint normalization strips query, fragment, and trailing slash", () => {
  assert.equal(
    normalizedEndpoint("https://example.test/macros/s/id/exec/?x=1#part"),
    "https://example.test/macros/s/id/exec"
  );
});

test("semantic bridge version comparison is strict and numeric", () => {
  assert.equal(versionAtLeast("2.3.0", "2.3.0"), true);
  assert.equal(versionAtLeast("2.10.0", "2.3.0"), true);
  assert.equal(versionAtLeast("2.2.99", "2.3.0"), false);
  assert.equal(versionAtLeast("unknown", "2.3.0"), false);
  assert.equal(MAX_INFLIGHT, 6);
});
