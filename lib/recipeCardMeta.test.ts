import { test } from "node:test";
import assert from "node:assert/strict";
import { formatServingsLabel, cardMetadataLine, gridCardMetadataLine } from "./recipeCardMeta.ts";

const NO_TIME = { prepTimeMinutes: null, cookTimeMinutes: null, totalTimeMinutes: null };

test("formatServingsLabel labels a bare integer", () => {
  assert.equal(formatServingsLabel("6"), "Serves 6");
});

test("formatServingsLabel passes through text that already reads as a phrase", () => {
  assert.equal(formatServingsLabel("Serves 6"), "Serves 6");
  assert.equal(formatServingsLabel("6 servings"), "6 servings");
  assert.equal(formatServingsLabel("Makes 12 muffins"), "Makes 12 muffins");
});

test("formatServingsLabel trims whitespace before checking the bare-integer shape", () => {
  assert.equal(formatServingsLabel("  6  "), "Serves 6");
});

test("formatServingsLabel returns null for null or blank input", () => {
  assert.equal(formatServingsLabel(null), null);
  assert.equal(formatServingsLabel(""), null);
  assert.equal(formatServingsLabel("   "), null);
});

test("cardMetadataLine prefers total time, unlabeled", () => {
  const line = cardMetadataLine({ prepTimeMinutes: 20, cookTimeMinutes: 25, totalTimeMinutes: 45 }, "6");
  assert.equal(line, "45 min · Serves 6");
});

test("cardMetadataLine formats hours and minutes", () => {
  const line = cardMetadataLine({ ...NO_TIME, totalTimeMinutes: 80 }, "4");
  assert.equal(line, "1 hr 20 min · Serves 4");
});

test("cardMetadataLine shows servings alone when time is unknown", () => {
  const line = cardMetadataLine(NO_TIME, "8");
  assert.equal(line, "Serves 8");
});

test("cardMetadataLine shows time alone when servings is unknown", () => {
  const line = cardMetadataLine({ ...NO_TIME, totalTimeMinutes: 25 }, null);
  assert.equal(line, "25 min");
});

test("cardMetadataLine falls back to labeled Prep + Cook when total is unknown", () => {
  const line = cardMetadataLine({ prepTimeMinutes: 20, cookTimeMinutes: 30, totalTimeMinutes: null }, null);
  assert.equal(line, "Prep 20 min · Cook 30 min");
});

test("cardMetadataLine falls back to labeled Prep alone when only prep is known", () => {
  const line = cardMetadataLine({ prepTimeMinutes: 15, cookTimeMinutes: null, totalTimeMinutes: null }, null);
  assert.equal(line, "Prep 15 min");
});

test("cardMetadataLine falls back to labeled Cook alone when only cook is known", () => {
  const line = cardMetadataLine({ prepTimeMinutes: null, cookTimeMinutes: 30, totalTimeMinutes: null }, null);
  assert.equal(line, "Cook 30 min");
});

test("cardMetadataLine appends servings normally after a labeled Prep/Cook fallback", () => {
  const both = cardMetadataLine({ prepTimeMinutes: 20, cookTimeMinutes: 30, totalTimeMinutes: null }, "6");
  assert.equal(both, "Prep 20 min · Cook 30 min · Serves 6");

  const prepOnly = cardMetadataLine({ prepTimeMinutes: 20, cookTimeMinutes: null, totalTimeMinutes: null }, "4");
  assert.equal(prepOnly, "Prep 20 min · Serves 4");
});

test("cardMetadataLine returns null when neither time nor servings is known", () => {
  assert.equal(cardMetadataLine(NO_TIME, null), null);
  assert.equal(cardMetadataLine(NO_TIME, ""), null);
});

test("cardMetadataLine never leaves a stray separator with only one side present", () => {
  const timeOnly = cardMetadataLine({ ...NO_TIME, totalTimeMinutes: 10 }, "");
  assert.equal(timeOnly, "10 min");
  assert.ok(!timeOnly?.includes("·"));

  const servingsOnly = cardMetadataLine(NO_TIME, "Serves 2");
  assert.equal(servingsOnly, "Serves 2");
  assert.ok(!servingsOnly?.includes("·"));

  const prepOnly = cardMetadataLine({ prepTimeMinutes: 15, cookTimeMinutes: null, totalTimeMinutes: null }, "");
  assert.equal(prepOnly, "Prep 15 min");
  assert.ok(!prepOnly?.includes("·"));
});

test("cardMetadataLine passes non-numeric yield text through unchanged alongside time", () => {
  const line = cardMetadataLine({ ...NO_TIME, totalTimeMinutes: 30 }, "Makes 12 muffins");
  assert.equal(line, "30 min · Makes 12 muffins");
});

test("gridCardMetadataLine prefers total time, unlabeled", () => {
  assert.equal(gridCardMetadataLine({ ...NO_TIME, totalTimeMinutes: 45 }, "6"), "45 min · Serves 6");
  assert.equal(gridCardMetadataLine({ ...NO_TIME, totalTimeMinutes: 80 }, null), "1 hr 20 min");
});

test("gridCardMetadataLine sums prep + cook into one bare duration when total is unknown", () => {
  const line = gridCardMetadataLine({ prepTimeMinutes: 20, cookTimeMinutes: 30, totalTimeMinutes: null }, "6");
  assert.equal(line, "50 min · Serves 6");
});

test("gridCardMetadataLine sums prep + cook across an hour boundary", () => {
  const line = gridCardMetadataLine({ prepTimeMinutes: 45, cookTimeMinutes: 45, totalTimeMinutes: null }, null);
  assert.equal(line, "1 hr 30 min");
});

test("gridCardMetadataLine falls back to labeled Prep alone when only prep is known", () => {
  const line = gridCardMetadataLine({ prepTimeMinutes: 20, cookTimeMinutes: null, totalTimeMinutes: null }, "4");
  assert.equal(line, "Prep 20 min · Serves 4");
});

test("gridCardMetadataLine falls back to labeled Cook alone when only cook is known", () => {
  const line = gridCardMetadataLine({ prepTimeMinutes: null, cookTimeMinutes: 30, totalTimeMinutes: null }, null);
  assert.equal(line, "Cook 30 min");
});

test("gridCardMetadataLine passes non-numeric servings text through unchanged", () => {
  const line = gridCardMetadataLine({ ...NO_TIME, totalTimeMinutes: 25 }, "8 bowls");
  assert.equal(line, "25 min · 8 bowls");
});

test("gridCardMetadataLine returns null when nothing is known", () => {
  assert.equal(gridCardMetadataLine(NO_TIME, null), null);
  assert.equal(gridCardMetadataLine(NO_TIME, ""), null);
});

test("gridCardMetadataLine never leaves a stray separator with only one side present", () => {
  const timeOnly = gridCardMetadataLine({ ...NO_TIME, totalTimeMinutes: 10 }, "");
  assert.equal(timeOnly, "10 min");
  assert.ok(!timeOnly?.includes("·"));

  const servingsOnly = gridCardMetadataLine(NO_TIME, "Serves 2");
  assert.equal(servingsOnly, "Serves 2");
  assert.ok(!servingsOnly?.includes("·"));
});
