import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDuration,
  detailTimeSegments,
  cardTimeSummary,
  totalMinutesToHoursMinutesStrings,
  hoursMinutesToTotalMinutes,
} from "./recipeTime.ts";

test("formatDuration handles under an hour", () => {
  assert.equal(formatDuration(15), "15 min");
});

test("formatDuration handles exactly one hour", () => {
  assert.equal(formatDuration(60), "1 hr");
});

test("formatDuration handles hours plus minutes", () => {
  assert.equal(formatDuration(75), "1 hr 15 min");
});

test("formatDuration handles multiple hours", () => {
  assert.equal(formatDuration(120), "2 hr");
  assert.equal(formatDuration(150), "2 hr 30 min");
});

test("formatDuration returns null for missing or non-positive values", () => {
  assert.equal(formatDuration(null), null);
  assert.equal(formatDuration(0), null);
  assert.equal(formatDuration(-5), null);
});

test("detailTimeSegments includes only known values, in Prep/Cook/Total order", () => {
  assert.deepEqual(detailTimeSegments({ prepTimeMinutes: 20, cookTimeMinutes: 40, totalTimeMinutes: 60 }), [
    { label: "Prep", text: "20 min" },
    { label: "Cook", text: "40 min" },
    { label: "Total", text: "1 hr" },
  ]);
});

test("detailTimeSegments omits missing values instead of showing placeholders", () => {
  assert.deepEqual(detailTimeSegments({ prepTimeMinutes: null, cookTimeMinutes: null, totalTimeMinutes: 120 }), [
    { label: "Total", text: "2 hr" },
  ]);
});

test("detailTimeSegments returns [] when nothing is known", () => {
  assert.deepEqual(detailTimeSegments({ prepTimeMinutes: null, cookTimeMinutes: null, totalTimeMinutes: null }), []);
});

test("cardTimeSummary prefers Total when known", () => {
  assert.equal(cardTimeSummary({ prepTimeMinutes: 20, cookTimeMinutes: 40, totalTimeMinutes: 60 }), "Total 1 hr");
});

test("cardTimeSummary falls back to Prep/Cook when Total is unknown", () => {
  assert.equal(cardTimeSummary({ prepTimeMinutes: 20, cookTimeMinutes: 40, totalTimeMinutes: null }), "Prep 20 min · Cook 40 min");
  assert.equal(cardTimeSummary({ prepTimeMinutes: 20, cookTimeMinutes: null, totalTimeMinutes: null }), "Prep 20 min");
});

test("cardTimeSummary returns null when nothing is known", () => {
  assert.equal(cardTimeSummary({ prepTimeMinutes: null, cookTimeMinutes: null, totalTimeMinutes: null }), null);
});

test("totalMinutesToHoursMinutesStrings splits minutes into hour/minute parts", () => {
  assert.deepEqual(totalMinutesToHoursMinutesStrings(90), { hours: "1", minutes: "30" });
  assert.deepEqual(totalMinutesToHoursMinutesStrings(60), { hours: "1", minutes: "" });
  assert.deepEqual(totalMinutesToHoursMinutesStrings(45), { hours: "", minutes: "45" });
  assert.deepEqual(totalMinutesToHoursMinutesStrings(null), { hours: "", minutes: "" });
});

test("hoursMinutesToTotalMinutes combines hour/minute text into total minutes", () => {
  assert.deepEqual(hoursMinutesToTotalMinutes("1", "30"), { minutes: 90, error: null });
  assert.deepEqual(hoursMinutesToTotalMinutes("2", ""), { minutes: 120, error: null });
  assert.deepEqual(hoursMinutesToTotalMinutes("", "45"), { minutes: 45, error: null });
});

test("hoursMinutesToTotalMinutes treats both fields blank as unknown, not zero", () => {
  assert.deepEqual(hoursMinutesToTotalMinutes("", ""), { minutes: null, error: null });
});

test("hoursMinutesToTotalMinutes rejects negative values", () => {
  const result = hoursMinutesToTotalMinutes("-1", "0");
  assert.equal(result.minutes, null);
  assert.ok(result.error);
});
