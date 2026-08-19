import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileGroceryItemsWithSnapshot } from "./groceryReconciliation.ts";
import type { GroceryItem } from "./groceryItems.ts";

const noProtection = { pendingDeleteIds: new Set<string>(), pendingAddIds: new Set<string>() };

function makeItem(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: "1",
    name: "Milk",
    completed: false,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("a server row missing locally (a missed INSERT) becomes visible", () => {
  const current = [makeItem({ id: "1", name: "Milk" })];
  const snapshot = [
    makeItem({ id: "1", name: "Milk" }),
    makeItem({ id: "2", name: "Eggs", created_at: "2026-01-01T00:01:00.000Z" }),
  ];

  const result = reconcileGroceryItemsWithSnapshot(current, snapshot, noProtection);

  assert.deepEqual(
    result.map((item) => item.id),
    ["1", "2"]
  );
});

test("a server rename/update replaces a stale local value", () => {
  const current = [makeItem({ id: "1", name: "Milk" })];
  const snapshot = [makeItem({ id: "1", name: "Oat Milk" })];

  const result = reconcileGroceryItemsWithSnapshot(current, snapshot, noProtection);

  assert.equal(result[0].name, "Oat Milk");
});

test("a server DELETE removes a stale local row", () => {
  const current = [makeItem({ id: "1", name: "Milk" }), makeItem({ id: "2", name: "Eggs" })];
  const snapshot = [makeItem({ id: "1", name: "Milk" })];

  const result = reconcileGroceryItemsWithSnapshot(current, snapshot, noProtection);

  assert.deepEqual(
    result.map((item) => item.id),
    ["1"]
  );
});

test("an optimistic local add survives while absent from the snapshot", () => {
  const current = [makeItem({ id: "1", name: "Milk" }), makeItem({ id: "temp-2", name: "Bread" })];
  const snapshot = [makeItem({ id: "1", name: "Milk" })];

  const result = reconcileGroceryItemsWithSnapshot(current, snapshot, {
    pendingDeleteIds: new Set(),
    pendingAddIds: new Set(["temp-2"]),
  });

  assert.deepEqual(
    result.map((item) => item.id).sort(),
    ["1", "temp-2"]
  );
});

test("a pending local delete is not resurrected by the snapshot", () => {
  // handleDeleteItem already spliced id "1" out of currentItems locally;
  // the server hasn't committed the delete yet, so it's still in the
  // snapshot.
  const current = [makeItem({ id: "2", name: "Eggs" })];
  const snapshot = [makeItem({ id: "1", name: "Milk" }), makeItem({ id: "2", name: "Eggs" })];

  const result = reconcileGroceryItemsWithSnapshot(current, snapshot, {
    pendingDeleteIds: new Set(["1"]),
    pendingAddIds: new Set(),
  });

  assert.deepEqual(
    result.map((item) => item.id),
    ["2"]
  );
});

test("result stays sorted by created_at regardless of input order", () => {
  const current = [makeItem({ id: "2", name: "Eggs", created_at: "2026-01-02T00:00:00.000Z" })];
  const snapshot = [
    makeItem({ id: "2", name: "Eggs", created_at: "2026-01-02T00:00:00.000Z" }),
    makeItem({ id: "1", name: "Milk", created_at: "2026-01-01T00:00:00.000Z" }),
  ];

  const result = reconcileGroceryItemsWithSnapshot(current, snapshot, noProtection);

  assert.deepEqual(
    result.map((item) => item.id),
    ["1", "2"]
  );
});
