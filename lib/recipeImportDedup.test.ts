import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeAdjacentLines } from "./recipeImportDedup.ts";

test("dedupeAdjacentLines removes an exact adjacent duplicate", () => {
  assert.deepEqual(
    dedupeAdjacentLines(["Preheat oven to 350F.", "Preheat oven to 350F.", "Mix dry ingredients."]),
    ["Preheat oven to 350F.", "Mix dry ingredients."]
  );
});

test("dedupeAdjacentLines is case- and whitespace-insensitive", () => {
  assert.deepEqual(
    dedupeAdjacentLines(["2 cups  flour", "2 CUPS FLOUR", "1 cup sugar"]),
    ["2 cups  flour", "1 cup sugar"]
  );
});

test("dedupeAdjacentLines keeps identical lines that are not adjacent", () => {
  assert.deepEqual(
    dedupeAdjacentLines(["1 tsp salt", "1 cup flour", "1 tsp salt"]),
    ["1 tsp salt", "1 cup flour", "1 tsp salt"]
  );
});

test("dedupeAdjacentLines leaves a list with no duplicates unchanged", () => {
  const lines = ["Step one.", "Step two.", "Step three."];
  assert.deepEqual(dedupeAdjacentLines(lines), lines);
});

test("dedupeAdjacentLines handles an empty array", () => {
  assert.deepEqual(dedupeAdjacentLines([]), []);
});
