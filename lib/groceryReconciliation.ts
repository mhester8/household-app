// Repairs local grocery state against an authoritative Supabase snapshot,
// taken after a genuine mobile background/resume — Realtime's own recovery
// (lib/useRealtimeSubscription.ts) only restores delivery of *future*
// postgres_changes events; it never replays whatever happened while the
// channel was down. Pure/no I/O so it's unit-testable without the Supabase
// client import that keeps lib/groceryItems.ts out of the plain `node
// --test` runner (see docs/project-state.md section 3).
//
// Mental model: authoritative snapshot + explicitly protected local
// optimistic mutations = reconciled list. "Protected" means exactly two
// concrete, already-tracked local states from app/(app)/groceries/page.tsx:
// an item mid-undo-window (pendingDeleteIds, from pendingDeletesRef) must
// never be resurrected even though the snapshot still has it server-side,
// and an optimistic add whose insert hasn't reached Supabase yet
// (pendingAddIds, from pendingAddIdsRef) must never be dropped just because
// the snapshot predates it.

import type { GroceryItem } from "./groceryItems";

export function reconcileGroceryItemsWithSnapshot(
  currentItems: readonly GroceryItem[],
  snapshotItems: readonly GroceryItem[],
  protectedIds: {
    pendingDeleteIds: ReadonlySet<string>;
    pendingAddIds: ReadonlySet<string>;
  }
): GroceryItem[] {
  const { pendingDeleteIds, pendingAddIds } = protectedIds;
  const remainingSnapshotById = new Map(snapshotItems.map((item) => [item.id, item]));
  const next: GroceryItem[] = [];

  for (const item of currentItems) {
    if (pendingDeleteIds.has(item.id)) {
      // Not expected in practice — a pending delete is already spliced out
      // of currentItems the moment it's initiated — but stay defensive
      // rather than ever letting one re-enter here.
      continue;
    }

    const fromSnapshot = remainingSnapshotById.get(item.id);
    if (fromSnapshot) {
      // Known to both sides — the snapshot's value is authoritative (picks
      // up a missed rename/complete/etc.).
      next.push(fromSnapshot);
      remainingSnapshotById.delete(item.id);
    } else if (pendingAddIds.has(item.id)) {
      // Optimistic add still in flight — the snapshot simply predates it.
      next.push(item);
    }
    // Otherwise: the authoritative snapshot no longer has this row and it
    // isn't a protected in-flight mutation — a deletion (possibly missed
    // while disconnected). Drop it.
  }

  // Anything left in the snapshot is a row this device doesn't know about
  // yet — a missed INSERT — unless it's mid-undo as a pending local delete,
  // in which case the snapshot is just stale (the server hasn't caught up
  // to the delete yet) and must not resurrect it.
  for (const [id, item] of remainingSnapshotById) {
    if (pendingDeleteIds.has(id)) {
      continue;
    }
    next.push(item);
  }

  return next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}
