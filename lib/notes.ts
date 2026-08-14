export type Note = {
  id: string;
  title: string | null;
  body: string;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export function sortByUpdatedAt(notes: Note[]) {
  return [...notes].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

// Inserts a new row or replaces an existing one with the same id, then
// re-sorts. Shared by local optimistic mutations and incoming Realtime
// events so a write and the Realtime echo of that same write never produce
// a duplicate row — same pattern as groceries' upsertItem.
export function upsertNote(currentNotes: Note[], note: Note) {
  const exists = currentNotes.some((existing) => existing.id === note.id);
  const nextNotes = exists
    ? currentNotes.map((existing) => (existing.id === note.id ? note : existing))
    : [...currentNotes, note];
  return sortByUpdatedAt(nextNotes);
}

// The heading shown for a note in lists: the title if one was given,
// otherwise the first non-empty line of the body (so untitled notes stay
// identifiable without forcing anyone to type a title), otherwise a plain
// fallback for a genuinely empty note.
export function noteDisplayTitle(note: Pick<Note, "title" | "body">): string {
  const trimmedTitle = note.title?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  const firstLine = note.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  if (firstLine) {
    return firstLine;
  }

  return "Untitled note";
}

// A one-line preview of the body for list rows. Skips the line already used
// as the display title (when it came from the body, not an explicit title)
// so the row doesn't show the same text twice.
export function noteSnippet(note: Pick<Note, "title" | "body">, maxLength = 120): string {
  const lines = note.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  const hasExplicitTitle = Boolean(note.title?.trim());
  const snippetLines = hasExplicitTitle ? lines : lines.slice(1);
  const snippet = snippetLines.join(" ");

  return snippet.length > maxLength ? `${snippet.slice(0, maxLength).trimEnd()}…` : snippet;
}

// Case-insensitive substring match across title and body — used for the
// main search, which deliberately includes archived notes so nobody has to
// remember whether something was archived before searching for it.
export function matchesSearch(note: Note, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") {
    return true;
  }
  return (
    (note.title?.toLowerCase().includes(normalized) ?? false) ||
    note.body.toLowerCase().includes(normalized)
  );
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// A restrained "Created Aug 14 · Edited 3:51 PM" line for the note editor.
// "Edited" shows a bare time when the edit happened today (the common
// case) and falls back to a date otherwise, so a week-old edit never reads
// as something that just happened.
export function formatNoteTimestamps(createdAt: string, updatedAt: string, now: Date = new Date()): string {
  const created = new Date(createdAt);
  const updated = new Date(updatedAt);
  const createdLabel = created.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const updatedLabel = isSameCalendarDay(updated, now)
    ? updated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : updated.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `Created ${createdLabel} · Edited ${updatedLabel}`;
}
