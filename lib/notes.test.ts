import { test } from "node:test";
import assert from "node:assert/strict";
import {
  noteDisplayTitle,
  noteSnippet,
  matchesSearch,
  sortByUpdatedAt,
  upsertNote,
  formatNoteTimestamps,
  type Note,
} from "./notes.ts";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "1",
    title: null,
    body: "",
    pinned: false,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("noteDisplayTitle uses the explicit title when present", () => {
  assert.equal(
    noteDisplayTitle({ title: "Church people", body: "Jane\nBob" }),
    "Church people"
  );
});

test("noteDisplayTitle falls back to the first non-empty body line", () => {
  assert.equal(noteDisplayTitle({ title: null, body: "\n  Meal ideas\nTacos" }), "Meal ideas");
});

test("noteDisplayTitle falls back to a plain label for an empty note", () => {
  assert.equal(noteDisplayTitle({ title: null, body: "" }), "Untitled note");
  assert.equal(noteDisplayTitle({ title: "  ", body: "\n  \n" }), "Untitled note");
});

test("noteSnippet skips the body line already used as the title", () => {
  assert.equal(noteSnippet({ title: null, body: "Meal ideas\nTacos\nSoup" }), "Tacos Soup");
});

test("noteSnippet keeps the first line when the title was explicit", () => {
  assert.equal(noteSnippet({ title: "Dinner", body: "Tacos\nSoup" }), "Tacos Soup");
});

test("noteSnippet truncates long bodies", () => {
  const long = "a".repeat(200);
  const snippet = noteSnippet({ title: "T", body: long }, 10);
  assert.equal(snippet, `${"a".repeat(10)}…`);
});

test("matchesSearch matches title and body case-insensitively", () => {
  const note = makeNote({ title: "Church People", body: "Met the Smiths" });
  assert.equal(matchesSearch(note, "church"), true);
  assert.equal(matchesSearch(note, "smiths"), true);
  assert.equal(matchesSearch(note, "nope"), false);
});

test("matchesSearch treats an empty query as matching everything", () => {
  assert.equal(matchesSearch(makeNote(), "   "), true);
});

test("sortByUpdatedAt orders most-recently-updated first", () => {
  const older = makeNote({ id: "a", updated_at: "2026-01-01T00:00:00.000Z" });
  const newer = makeNote({ id: "b", updated_at: "2026-01-02T00:00:00.000Z" });
  assert.deepEqual(sortByUpdatedAt([older, newer]).map((n) => n.id), ["b", "a"]);
});

test("upsertNote inserts a new note and re-sorts", () => {
  const existing = makeNote({ id: "a", updated_at: "2026-01-01T00:00:00.000Z" });
  const inserted = makeNote({ id: "b", updated_at: "2026-01-02T00:00:00.000Z" });
  const result = upsertNote([existing], inserted);
  assert.deepEqual(result.map((n) => n.id), ["b", "a"]);
});

test("upsertNote replaces an existing note by id instead of duplicating it", () => {
  const original = makeNote({ id: "a", body: "old" });
  const updated = makeNote({ id: "a", body: "new" });
  const result = upsertNote([original], updated);
  assert.equal(result.length, 1);
  assert.equal(result[0].body, "new");
});

test("formatNoteTimestamps shows a time for an edit made today", () => {
  // Built from local-time components (not a fixed UTC instant) so the
  // expected label doesn't depend on the machine's timezone offset.
  const now = new Date(2026, 7, 14, 20, 0, 0);
  const updatedAt = new Date(2026, 7, 14, 15, 51, 0);
  const createdAt = new Date(2026, 7, 10, 12, 0, 0);
  const label = formatNoteTimestamps(createdAt.toISOString(), updatedAt.toISOString(), now);
  const expectedTime = updatedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  assert.equal(label, `Created Aug 10 · Edited ${expectedTime}`);
});

test("formatNoteTimestamps shows a date for an edit made on an earlier day", () => {
  const now = new Date("2026-08-14T20:00:00.000Z");
  const label = formatNoteTimestamps(
    "2026-08-10T12:00:00.000Z",
    "2026-08-10T12:00:00.000Z",
    now
  );
  assert.equal(label, "Created Aug 10 · Edited Aug 10");
});
