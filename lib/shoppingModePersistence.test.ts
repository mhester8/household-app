import { test } from "node:test";
import assert from "node:assert/strict";
import { parseShoppingModeState } from "./shoppingModePersistence.ts";

test("parseShoppingModeState returns null for missing input", () => {
  assert.equal(parseShoppingModeState(null), null);
  assert.equal(parseShoppingModeState(""), null);
});

test("parseShoppingModeState returns null for invalid JSON", () => {
  assert.equal(parseShoppingModeState("{not json"), null);
});

test("parseShoppingModeState returns null for wrong-shaped data", () => {
  assert.equal(parseShoppingModeState("null"), null);
  assert.equal(parseShoppingModeState("42"), null);
  assert.equal(parseShoppingModeState(JSON.stringify({ isActive: "yes", categoryByItemId: {} })), null);
  assert.equal(parseShoppingModeState(JSON.stringify({ isActive: true })), null);
  assert.equal(
    parseShoppingModeState(JSON.stringify({ isActive: true, categoryByItemId: { a: 1 } })),
    null
  );
});

test("parseShoppingModeState accepts a valid persisted session", () => {
  const raw = JSON.stringify({
    isActive: true,
    categoryByItemId: { "item-1": "Produce", "item-2": "Dairy" },
  });
  assert.deepEqual(parseShoppingModeState(raw), {
    isActive: true,
    categoryByItemId: { "item-1": "Produce", "item-2": "Dairy" },
  });
});

test("parseShoppingModeState accepts an empty category map", () => {
  const raw = JSON.stringify({ isActive: true, categoryByItemId: {} });
  assert.deepEqual(parseShoppingModeState(raw), { isActive: true, categoryByItemId: {} });
});
