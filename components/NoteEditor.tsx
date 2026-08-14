"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { type Note, formatNoteTimestamps } from "@/lib/notes";
import { persistNote } from "@/lib/notePersistence";
import { Toast, type ToastState } from "@/components/Toast";

const AUTOSAVE_DEBOUNCE_MS = 650;
const ERROR_TOAST_MS = 6000;
const REMOTE_UPDATE_TOAST_MS = 4000;

type SaveStatus = "idle" | "saving" | "saved" | "error";

// The editor for an existing note, reached only via /notes/[id] — new notes
// are created inline on the Notes list (see NotesPage) so that the very
// first keystroke can happen inside the tap that opened them, which iOS
// requires for the keyboard to open automatically. By the time this
// component mounts, the note already has a real id.
export function NoteEditor({ noteId }: { noteId: string }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [toast, setToast] = useState<ToastState | null>(null);

  const bodyFieldRef = useRef<HTMLTextAreaElement>(null);
  // The last title/body known to be persisted. The autosave effect only
  // schedules a save when the current fields differ from this, so loading
  // the note never triggers a spurious save.
  const lastSavedRef = useRef({ title: "", body: "" });
  // Mirrors title/body on every render so the unmount/unload flush (set up
  // once, not on every keystroke) always reads the latest typed content.
  const latestRef = useRef({ title, body });
  latestRef.current = { title, body };
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadNote() {
      setIsLoading(true);
      setLoadError(null);

      const { data, error } = await supabase
        .from("notes")
        .select("id, title, body, created_at, updated_at")
        .eq("id", noteId)
        .maybeSingle();

      if (cancelled) {
        return;
      }
      if (error || !data) {
        setLoadError(error ? error.message : "Note not found.");
        setIsLoading(false);
        return;
      }

      const loadedTitle = data.title ?? "";
      setTitle(loadedTitle);
      setBody(data.body);
      setCreatedAt(data.created_at);
      setUpdatedAt(data.updated_at);
      lastSavedRef.current = { title: loadedTitle, body: data.body };
      setIsLoading(false);
    }

    loadNote();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  // Puts the cursor in the body right after its content has loaded.
  // Deliberately the body, not the optional title, since reading/continuing
  // a thought is the primary action.
  useEffect(() => {
    if (isLoading) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      bodyFieldRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isLoading]);

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

  async function performSave() {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    // Never persist a totally empty note — this covers clearing an existing
    // note's text out entirely; the last good content is left in place.
    if (trimmedTitle === "" && trimmedBody === "") {
      return;
    }

    setSaveStatus("saving");
    const currentTitle = title;
    const currentBody = body;
    const result = await persistNote(noteId, currentTitle, currentBody);

    if ("error" in result) {
      setSaveStatus("error");
      showToast(
        {
          message: `Couldn't save note: ${result.error}`,
          actionLabel: "Retry",
          onAction: () => performSave(),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
      return;
    }

    lastSavedRef.current = { title: currentTitle.trim(), body: currentBody.trim() };
    setSaveStatus("saved");
    setUpdatedAt(new Date().toISOString());
  }

  // Debounced autosave: any change to title/body (re)starts a short timer,
  // so rapid typing never fires a save per keystroke — only once things go
  // quiet for AUTOSAVE_DEBOUNCE_MS.
  useEffect(() => {
    if (isLoading) {
      return;
    }
    if (title === lastSavedRef.current.title && body === lastSavedRef.current.body) {
      return;
    }
    const timer = setTimeout(() => {
      performSave();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, isLoading]);

  // Keeps this editor from going stale when the same note is open on
  // another device. Scoped to just this note's id (not the whole table),
  // and only ever reacts to UPDATE — archive/delete/other notes are out of
  // scope here, same as the rest of Notes' Realtime usage.
  useEffect(() => {
    const channel = supabase
      .channel(`note_${noteId}_changes`)
      .on<Note>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notes", filter: `id=eq.${noteId}` },
        (payload) => {
          const incoming = payload.new as Note;
          const incomingTitle = incoming.title ?? "";
          const incomingBody = incoming.body;

          // The echo of our own save landing back over the channel — local
          // state already reflects this, so there's nothing to do.
          if (incomingTitle === lastSavedRef.current.title && incomingBody === lastSavedRef.current.body) {
            return;
          }

          const { title: currentTitle, body: currentBody } = latestRef.current;
          const isLocalDirty =
            currentTitle !== lastSavedRef.current.title || currentBody !== lastSavedRef.current.body;

          if (isLocalDirty) {
            // The user has unsaved (typed or pending-autosave) local
            // changes — never clobber them. The pending/next autosave will
            // still fire normally and become the last write, per V1's
            // last-save-wins rule; this is just making the collision
            // visible instead of silently discarding either side.
            showToast(
              { message: "Updated on another device — your changes will still be saved" },
              REMOTE_UPDATE_TOAST_MS
            );
            return;
          }

          setTitle(incomingTitle);
          setBody(incomingBody);
          setUpdatedAt(incoming.updated_at);
          lastSavedRef.current = { title: incomingTitle, body: incomingBody };
          showToast({ message: "Updated on another device" }, REMOTE_UPDATE_TOAST_MS);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [noteId]);

  // Navigation safety net: a debounced save that's still pending when the
  // user leaves shouldn't be silently lost. In-app navigation unmounts this
  // component — the App Router keeps the JS runtime alive, so a
  // fire-and-forget save kicked off here reliably completes. A real tab
  // close/refresh instead only has beforeunload, which is best-effort (the
  // browser can still cut the request off) — but the debounce window is
  // short enough that this is a rare edge case, not a routine one.
  useEffect(() => {
    function flushIfUnsaved() {
      const current = latestRef.current;
      if (current.title === lastSavedRef.current.title && current.body === lastSavedRef.current.body) {
        return;
      }
      if (current.title.trim() === "" && current.body.trim() === "") {
        return;
      }
      persistNote(noteId, current.title, current.body);
    }

    window.addEventListener("beforeunload", flushIfUnsaved);
    return () => {
      window.removeEventListener("beforeunload", flushIfUnsaved);
      flushIfUnsaved();
    };
  }, [noteId]);

  const saveStatusLabel =
    saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : null;

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/notes"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Notes
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Edit Note</h1>
        {saveStatusLabel && (
          <span aria-live="polite" className="ml-auto shrink-0 text-xs text-muted-foreground">
            {saveStatusLabel}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="p-1 text-sm text-muted-foreground">Loading note...</p>
      ) : loadError ? (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {loadError}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="px-1 text-xs text-muted-foreground">
            {formatNoteTimestamps(createdAt, updatedAt)}
          </p>

          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Title (optional)"
            aria-label="Title"
            autoComplete="off"
            className="min-h-11 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <textarea
            ref={bodyFieldRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write a note..."
            aria-label="Note"
            rows={10}
            className="min-h-40 flex-1 rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}
