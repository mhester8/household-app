import { test } from "node:test";
import assert from "node:assert/strict";
import { PULL_THRESHOLD_PX, classifyPullDelta } from "./pullToRefreshGesture.ts";

test("no movement stays idle", () => {
  assert.equal(classifyPullDelta(0, 0), "idle");
});

test("upward movement (deltaY <= 0) is idle, not abandoned", () => {
  assert.equal(classifyPullDelta(0, -20), "idle");
  assert.equal(classifyPullDelta(5, 0), "idle");
});

test("small movement below the noise floor stays idle regardless of direction", () => {
  assert.equal(classifyPullDelta(3, 3), "idle");
});

test("a modest downward pull below threshold is 'pulling'", () => {
  assert.equal(classifyPullDelta(0, 10), "pulling");
  assert.equal(classifyPullDelta(0, PULL_THRESHOLD_PX - 1), "pulling");
});

test("a downward pull at or past threshold is 'ready'", () => {
  assert.equal(classifyPullDelta(0, PULL_THRESHOLD_PX), "ready");
  assert.equal(classifyPullDelta(0, PULL_THRESHOLD_PX + 40), "ready");
});

test("a small vertical lead over horizontal is still treated as a pull", () => {
  assert.equal(classifyPullDelta(10, 15), "pulling");
});

test("a predominantly horizontal drag is abandoned, not treated as a pull", () => {
  assert.equal(classifyPullDelta(30, 10), "abandon");
  assert.equal(classifyPullDelta(-40, 5), "abandon");
});

test("a perfectly diagonal drag (equal axes) still counts as vertical-led", () => {
  assert.equal(classifyPullDelta(20, 20), "pulling");
});

test("horizontal only barely exceeding vertical is abandoned", () => {
  assert.equal(classifyPullDelta(21, 20), "abandon");
});
