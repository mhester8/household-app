// Device-local persistence for an in-progress Shopping Mode session, so
// closing/backgrounding the PWA or refreshing doesn't force a restart and a
// second AI grouping call. Deliberately client-only (localStorage) and
// per-device — this is a resume aid for whoever's phone started shopping,
// not shared/synced session state (see docs/decisions.md).
//
// parseShoppingModeState is separated out as a pure function (no storage
// access) so it's unit-testable under the plain `node --test` runner, same
// split as lib/notes.ts vs lib/notePersistence.ts.

const STORAGE_KEY = "hesterhouse.shoppingMode.v1";

export type PersistedShoppingModeState = {
  isActive: boolean;
  categoryByItemId: Record<string, string>;
};

function isPersistedShoppingModeState(value: unknown): value is PersistedShoppingModeState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.isActive !== "boolean") {
    return false;
  }
  if (typeof candidate.categoryByItemId !== "object" || candidate.categoryByItemId === null) {
    return false;
  }
  return Object.values(candidate.categoryByItemId).every((name) => typeof name === "string");
}

// Parses and validates a raw storage value. Never throws — any missing,
// malformed, or wrong-shaped input is treated as "no session," which callers
// should handle the same as a brand-new visit.
export function parseShoppingModeState(raw: string | null): PersistedShoppingModeState | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPersistedShoppingModeState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Reads the persisted Shopping Mode session for this device, if any.
// Storage access itself is guarded too — private browsing, quota, or a
// disabled storage API must never break the caller.
export function loadShoppingModeState(): PersistedShoppingModeState | null {
  try {
    return parseShoppingModeState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveShoppingModeState(state: PersistedShoppingModeState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort — Shopping Mode still works for this tab's lifetime; it
    // just won't survive a reload if storage is unavailable.
  }
}

export function clearShoppingModeState() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort, same as above.
  }
}
