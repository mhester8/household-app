"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { type Note, matchesSearch, upsertNote } from "@/lib/notes";
import { persistNote } from "@/lib/notePersistence";
import { NoteRow } from "@/components/NoteRow";
import { LeafIcon } from "@/components/LeafIcon";
import { Toast, type ToastState } from "@/components/Toast";
import { REALTIME_UNAVAILABLE_MESSAGE, useRealtimeSubscription } from "@/lib/useRealtimeSubscription";
import { usePullToRefreshHandler } from "@/lib/PullToRefreshContext";

const NOTE_COLUMNS = "id, title, body, pinned, archived_at, created_at, updated_at";

const DELETE_UNDO_MS = 5000;
const ARCHIVE_TOAST_MS = 5000;
const ERROR_TOAST_MS = 6000;
const AUTOSAVE_DEBOUNCE_MS = 650;

type ComposerSaveStatus = "idle" | "saving" | "saved" | "error";

export default function NotesPage() {
  const [userId, setUserId] = useState<string | null>(null);

  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<"notes" | "archived">("notes");
  const [toast, setToast] = useState<ToastState | null>(null);

  // Deletes are optimistic immediately but the actual Supabase delete is
  // held until the undo window elapses — same pattern as groceries, so
  // "Undo" never races a delete that's already in flight.
  const pendingDeletesRef = useRef<Map<string, { note: Note; timer: ReturnType<typeof setTimeout> }>>(
    new Map()
  );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline new-note composer. It's kept mounted at all times (never
  // conditionally rendered away) specifically so its textarea already
  // exists in the DOM before the first tap on "+ New note" — iOS only
  // raises the software keyboard for a focus() call made synchronously
  // inside the original trusted tap, so navigating to a new route (where
  // the field wouldn't exist yet) or mounting it later in an effect both
  // miss that window. Only its visibility toggles; see the sr-only class
  // below.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerId, setComposerId] = useState<string | null>(null);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [composerSaveStatus, setComposerSaveStatus] = useState<ComposerSaveStatus>("idle");
  const composerBodyFieldRef = useRef<HTMLTextAreaElement>(null);
  const composerLastSavedRef = useRef({ title: "", body: "" });
  const composerLatestRef = useRef({ id: composerId, title: composerTitle, body: composerBody });
  useEffect(() => {
    composerLatestRef.current = { id: composerId, title: composerTitle, body: composerBody };
  });
  // Bumped every time the composer is closed/reset, so a save that was
  // still in flight at that moment can recognize its result is stale (for
  // a note the user has already moved on from) and discard it instead of
  // resurrecting composerId after a reset.
  const composerSessionRef = useRef(0);
  // Serializes every composer save (debounce timer, "Done", beforeunload,
  // unmount) through performComposerSave below. Without this, two of those
  // triggers could both see composerId still null at the same time and each
  // independently insert a new row for the same note.
  const composerSaveInFlightRef = useRef(false);
  const composerSaveQueuedRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user.id ?? null);
    });
  }, []);

  // Loads active and archived notes together in one query — search needs to
  // cover both, so there's no separate "load the archive" round trip. Only
  // ever calls setNotes — never touches composer state (composerTitle/
  // composerBody/composerId), so re-running it (mount, or pull-to-refresh
  // below) can't clear or overwrite an open draft.
  async function loadNotes() {
    setIsLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("notes")
      .select(NOTE_COLUMNS)
      .order("updated_at", { ascending: false });

    if (error) {
      setErrorMessage(`Could not load notes: ${error.message}`);
    } else {
      setNotes(data ?? []);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    if (!userId) {
      return;
    }
    function runInitialLoad() {
      loadNotes();
    }
    runInitialLoad();
  }, [userId]);

  // Pull-to-refresh (global gesture in app/(app)/layout.tsx) re-runs the
  // exact same load as the initial mount above.
  usePullToRefreshHandler(loadNotes);

  // Subscribe to Realtime changes so the other household member's adds,
  // edits, pins, archives, and deletes show up here without a refresh.
  useRealtimeSubscription({
    channelName: "notes_changes",
    enabled: !!userId,
    deps: [userId],
    build: (channel) =>
      channel
        .on<Note>(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notes" },
          (payload) => {
            setNotes((current) => upsertNote(current, payload.new as Note));
          }
        )
        .on<Note>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notes" },
          (payload) => {
            setNotes((current) => upsertNote(current, payload.new as Note));
          }
        )
        .on<Note>(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "notes" },
          (payload) => {
            const deletedId = (payload.old as { id: string }).id;
            setNotes((current) => current.filter((note) => note.id !== deletedId));
          }
        ),
    onUnavailable: () => setErrorMessage(REALTIME_UNAVAILABLE_MESSAGE),
    onRecovered: () =>
      setErrorMessage((current) => (current === REALTIME_UNAVAILABLE_MESSAGE ? null : current)),
  });

  function showToast(next: ToastState, durationMs: number) {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast(next);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }

  function dismissToast() {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }

  async function togglePin(note: Note) {
    const nextPinned = !note.pinned;

    setNotes((current) =>
      current.map((existing) => (existing.id === note.id ? { ...existing, pinned: nextPinned } : existing))
    );

    const { error } = await supabase.from("notes").update({ pinned: nextPinned }).eq("id", note.id);

    if (error) {
      setNotes((current) =>
        current.map((existing) => (existing.id === note.id ? { ...existing, pinned: note.pinned } : existing))
      );
      showToast(
        {
          message: `Couldn't update pin`,
          actionLabel: "Retry",
          onAction: () => togglePin(note),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  // Handles both Archive and Restore — same shape as groceries' setCompleted:
  // apply locally, show an undo-capable toast, persist, and roll back with a
  // retry toast if the persist fails. Pinning/archiving intentionally never
  // touch updated_at, so archiving never bumps a note to the top as if it
  // had just been edited.
  async function setArchived(note: Note, archive: boolean) {
    const previousArchivedAt = note.archived_at;
    const nextArchivedAt = archive ? new Date().toISOString() : null;
    const label = note.title?.trim() || "Note";

    setNotes((current) =>
      current.map((existing) =>
        existing.id === note.id ? { ...existing, archived_at: nextArchivedAt } : existing
      )
    );

    showToast(
      {
        message: archive ? `${label} archived` : `${label} restored`,
        actionLabel: "Undo",
        onAction: () => setArchived(note, !archive),
      },
      ARCHIVE_TOAST_MS
    );

    const { error } = await supabase
      .from("notes")
      .update({ archived_at: nextArchivedAt })
      .eq("id", note.id);

    if (error) {
      setNotes((current) =>
        current.map((existing) =>
          existing.id === note.id ? { ...existing, archived_at: previousArchivedAt } : existing
        )
      );
      showToast(
        {
          message: `Couldn't ${archive ? "archive" : "restore"} ${label}`,
          actionLabel: "Retry",
          onAction: () => setArchived(note, archive),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  function handleDeleteNote(note: Note) {
    setNotes((current) => current.filter((existing) => existing.id !== note.id));

    const existingPending = pendingDeletesRef.current.get(note.id);
    if (existingPending) {
      clearTimeout(existingPending.timer);
    }

    const timer = setTimeout(() => {
      pendingDeletesRef.current.delete(note.id);
      commitDelete(note);
    }, DELETE_UNDO_MS);
    pendingDeletesRef.current.set(note.id, { note, timer });

    const label = note.title?.trim() || "Note";
    showToast(
      {
        message: `${label} deleted`,
        actionLabel: "Undo",
        onAction: () => undoDelete(note.id),
      },
      DELETE_UNDO_MS
    );
  }

  function undoDelete(id: string) {
    const pending = pendingDeletesRef.current.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingDeletesRef.current.delete(id);
    setNotes((current) => upsertNote(current, pending.note));
  }

  async function commitDelete(note: Note) {
    const { error } = await supabase.from("notes").delete().eq("id", note.id);

    if (error) {
      setNotes((current) => upsertNote(current, note));
      const label = note.title?.trim() || "Note";
      showToast(
        {
          message: `Couldn't delete ${label}`,
          actionLabel: "Retry",
          onAction: () => handleDeleteNote(note),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  // Does exactly one save attempt, reading the *current* composer values
  // from composerLatestRef rather than the closure — needed because this
  // can run after a retry loop (see performComposerSave) where newer
  // keystrokes may have landed since this whole call chain started.
  async function attemptComposerSaveOnce() {
    const { id: currentId, title: currentTitle, body: currentBody } = composerLatestRef.current;
    const trimmedTitle = currentTitle.trim();
    const trimmedBody = currentBody.trim();

    // Never persist a totally empty note — opening the composer and leaving
    // it untouched must not create a row.
    if (trimmedTitle === "" && trimmedBody === "") {
      return;
    }
    if (currentTitle === composerLastSavedRef.current.title && currentBody === composerLastSavedRef.current.body) {
      return;
    }

    const session = composerSessionRef.current;
    setComposerSaveStatus("saving");
    const result = await persistNote(currentId, currentTitle, currentBody);

    // The composer was closed/reset (or reopened fresh) while this save was
    // in flight — its result no longer belongs to what's being composed now.
    if (composerSessionRef.current !== session) {
      return;
    }

    if ("error" in result) {
      setComposerSaveStatus("error");
      showToast(
        {
          message: `Couldn't save note: ${result.error}`,
          actionLabel: "Retry",
          onAction: () => performComposerSave(),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
      return;
    }

    composerLastSavedRef.current = { title: trimmedTitle, body: trimmedBody };
    setComposerSaveStatus("saved");
    // The list's own Realtime subscription (below) picks up this INSERT and
    // adds the row to `notes` on its own — composerId is only tracked here
    // so the row can be hidden from the list while it's still open in the
    // composer (see the activeNotes/searchResults filters below).
    if (currentId === null) {
      setComposerId(result.id);
    }
  }

  // The single entry point for every composer save trigger (debounce timer,
  // "Done", beforeunload, unmount). Serialized so two triggers can never
  // both see composerId as null at the same time and each insert their own
  // row for the same note — a caller that arrives while a save is already
  // in flight just marks that another pass is needed once the current one
  // finishes, rather than starting a second, concurrent one.
  async function performComposerSave() {
    if (composerSaveInFlightRef.current) {
      composerSaveQueuedRef.current = true;
      return;
    }

    composerSaveInFlightRef.current = true;
    try {
      do {
        composerSaveQueuedRef.current = false;
        await attemptComposerSaveOnce();
      } while (composerSaveQueuedRef.current);
    } finally {
      composerSaveInFlightRef.current = false;
    }
  }

  // Debounced autosave for the composer — same shape as NoteEditor's.
  useEffect(() => {
    if (
      composerTitle === composerLastSavedRef.current.title &&
      composerBody === composerLastSavedRef.current.body
    ) {
      return;
    }
    const timer = setTimeout(() => {
      performComposerSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerTitle, composerBody]);

  // Same navigation-safety net as NoteEditor: a pending debounced save
  // shouldn't be silently lost if the user leaves /notes (in-app nav still
  // lets a fire-and-forget save complete; beforeunload is best-effort).
  // performComposerSave already no-ops when there's nothing dirty to save,
  // and its in-flight guard means this can never race a save already
  // triggered by the debounce timer.
  useEffect(() => {
    function flush() {
      performComposerSave();
    }
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronous focus is the whole point: composerBodyFieldRef's textarea
  // is already mounted (see the render below), so calling .focus() here,
  // inside the tap's own click handler, stays within iOS's trusted-gesture
  // window and reliably raises the keyboard.
  function handleOpenComposer() {
    setComposerOpen(true);
    composerBodyFieldRef.current?.focus();
  }

  // Awaits the final save before resetting — otherwise resetting
  // composerId/title/body immediately would race the flush's own read of
  // composerLatestRef, and bumping the session immediately would make the
  // flush's own result look stale to itself. A brief wait before the
  // composer visually collapses is a small price for never losing or
  // duplicating the last few keystrokes.
  async function handleCloseComposer() {
    await performComposerSave();
    composerSessionRef.current += 1;
    setComposerOpen(false);
    setComposerId(null);
    setComposerTitle("");
    setComposerBody("");
    composerLastSavedRef.current = { title: "", body: "" };
    setComposerSaveStatus("idle");
  }

  const composerSaveStatusLabel =
    composerSaveStatus === "saving" ? "Saving…" : composerSaveStatus === "saved" ? "Saved" : null;

  const normalizedQuery = searchQuery.trim();
  const isSearching = normalizedQuery !== "";
  // The note currently open in the composer is excluded from the ordinary
  // rows below — it's already fully represented by the composer itself
  // while open, so showing it a second time as a plain row (which Realtime
  // would otherwise add the instant its first autosave lands) would just
  // be a confusing duplicate.
  const searchResults = isSearching
    ? notes.filter((note) => note.id !== composerId && matchesSearch(note, normalizedQuery))
    : [];

  const activeNotes = notes.filter((note) => note.archived_at === null && note.id !== composerId);
  const archivedNotes = notes.filter((note) => note.archived_at !== null);
  const pinnedNotes = activeNotes.filter((note) => note.pinned);
  const recentNotes = activeNotes.filter((note) => !note.pinned);

  function renderNoteRow(note: Note, showArchivedBadge: boolean) {
    return (
      <NoteRow
        key={note.id}
        note={note}
        showArchivedBadge={showArchivedBadge}
        onTogglePin={() => togglePin(note)}
        onArchiveToggle={() => setArchived(note, note.archived_at === null)}
        onDelete={() => handleDeleteNote(note)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Home
        </Link>
        <h1 className="flex items-center gap-1.5 text-xl font-bold tracking-tight text-primary">
          <LeafIcon className="h-4 w-4 shrink-0" />
          Notes
        </h1>
        {tab === "notes" && archivedNotes.length > 0 && (
          <button
            type="button"
            onClick={() => setTab("archived")}
            className="ml-auto shrink-0 rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-border"
          >
            Archived ({archivedNotes.length})
          </button>
        )}
        {tab === "archived" && (
          <button
            type="button"
            onClick={() => setTab("notes")}
            className="ml-auto shrink-0 rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-border"
          >
            Notes
          </button>
        )}
      </div>

      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading notes...</p>
      ) : (
        <>
          {tab === "notes" && (
            <>
              {!composerOpen && (
                <button
                  type="button"
                  onClick={handleOpenComposer}
                  className="min-h-11 flex items-center justify-center rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
                >
                  + New note
                </button>
              )}

              <div
                className={
                  composerOpen
                    ? "flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
                    : "sr-only"
                }
              >
                <div className="flex items-center gap-2">
                  {composerSaveStatusLabel && (
                    <span aria-live="polite" className="text-xs text-muted-foreground">
                      {composerSaveStatusLabel}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleCloseComposer}
                    className="ml-auto shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                  >
                    Done
                  </button>
                </div>

                <input
                  type="text"
                  value={composerTitle}
                  onChange={(event) => setComposerTitle(event.target.value)}
                  placeholder="Title (optional)"
                  aria-label="Title"
                  autoComplete="off"
                  className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />

                <textarea
                  ref={composerBodyFieldRef}
                  value={composerBody}
                  onChange={(event) => setComposerBody(event.target.value)}
                  placeholder="Write a note..."
                  aria-label="Note"
                  rows={6}
                  className="min-h-32 rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </>
          )}

          {notes.length > 0 && (
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search notes..."
              aria-label="Search notes"
              autoComplete="off"
              className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}

          {isSearching ? (
            <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
              {searchResults.map((note) => renderNoteRow(note, note.archived_at !== null))}
              {searchResults.length === 0 && (
                <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No notes match &ldquo;{normalizedQuery}&rdquo;.
                </li>
              )}
            </ul>
          ) : tab === "notes" ? (
            <>
              {pinnedNotes.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <h2 className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Pinned
                  </h2>
                  <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
                    {pinnedNotes.map((note) => renderNoteRow(note, false))}
                  </ul>
                </div>
              )}

              <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
                {recentNotes.map((note) => renderNoteRow(note, false))}
                {activeNotes.length === 0 && (
                  <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                    No notes yet. Add one to get started.
                  </li>
                )}
              </ul>
            </>
          ) : (
            <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
              {archivedNotes.map((note) => renderNoteRow(note, false))}
              {archivedNotes.length === 0 && (
                <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No archived notes.
                </li>
              )}
            </ul>
          )}
        </>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}
