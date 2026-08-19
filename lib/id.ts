// crypto.randomUUID() requires a secure context. Desktop browsers treat
// http://localhost as trustworthy, but that exception doesn't extend to a
// LAN IP (http://<LAN-IP>:3000), so it's unavailable there on mobile even
// though `crypto` itself exists — production HTTPS and desktop localhost
// are both unaffected.
//
// Some callers only need a locally-unique id (React keys, Storage
// filenames), but others — grocery_items.id, chosen client-side so
// optimistic-UI/Realtime-dedup can register it before the insert
// round-trips (see lib/groceryItems.ts) — persist this straight into a
// Postgres `uuid` column, so the fallback has to be a real UUID, not just
// a unique-looking string. crypto.getRandomValues(), unlike randomUUID(),
// is not gated behind secure contexts, so it's used to assemble a valid
// RFC 4122 v4 UUID by hand whenever randomUUID() itself isn't available.
export function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant (10xx)
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last resort for an environment with no crypto object at all — not a
  // valid UUID, so anything persisting this id into a uuid-typed column
  // still depends on crypto.getRandomValues() being present.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
