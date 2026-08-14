"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Note } from "@/lib/notes";
import { noteDisplayTitle, noteSnippet } from "@/lib/notes";

function PinIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M14.5 3.5 20.5 9.5 17 13l-1 6-3.5-3.5L7 21l-1.5-1.5 6.5-6.5L8.5 9.5 14.5 3.5Z" />
    </svg>
  );
}

// Notes-specific "..." menu offering Archive/Delete (active notes) or
// Restore/Delete (archived notes). Deliberately a separate, small
// implementation rather than a generalized version of ItemActionsMenu —
// see the Notes proposal decision to leave that shared component untouched.
function NoteActionsMenu({
  noteLabel,
  isArchived,
  onArchiveToggle,
  onDelete,
}: {
  noteLabel: string;
  isArchived: boolean;
  onArchiveToggle: () => void;
  onDelete: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const secondItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      firstItemRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function focusOther(current: "first" | "second") {
    (current === "first" ? secondItemRef : firstItemRef).current?.focus();
  }

  function handleItemKeyDown(event: React.KeyboardEvent, current: "first" | "second") {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOther(current);
    }
  }

  // Deferred close on blur so a touch tap on a menu item survives the
  // touch-driven blur that can fire before the tap's click event on mobile
  // — same reasoning as ItemActionsMenu's handleBlur.
  function handleBlur() {
    window.setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setIsOpen(false);
      }
    }, 0);
  }

  return (
    <div ref={containerRef} className="relative shrink-0" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
        onTouchStart={() => {}}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Actions for ${noteLabel}`}
        className="flex min-h-11 min-w-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-muted hover:text-foreground active:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <svg aria-hidden="true" viewBox="0 0 20 4" className="h-1 w-5 fill-current">
          <circle cx="2" cy="2" r="2" />
          <circle cx="10" cy="2" r="2" />
          <circle cx="18" cy="2" r="2" />
        </svg>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={`Actions for ${noteLabel}`}
          className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setIsOpen(false);
              onArchiveToggle();
            }}
            onKeyDown={(event) => handleItemKeyDown(event, "first")}
            className="flex w-full items-center px-3.5 py-2.5 text-left text-sm text-foreground transition hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
          >
            {isArchived ? "Restore" : "Archive"}
          </button>
          <button
            ref={secondItemRef}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setIsOpen(false);
              onDelete();
            }}
            onKeyDown={(event) => handleItemKeyDown(event, "second")}
            className="flex w-full items-center px-3.5 py-2.5 text-left text-sm text-danger transition hover:bg-danger/10 focus:bg-danger/10 focus:outline-none"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function NoteRow({
  note,
  showArchivedBadge,
  onTogglePin,
  onArchiveToggle,
  onDelete,
}: {
  note: Note;
  showArchivedBadge: boolean;
  onTogglePin: () => void;
  onArchiveToggle: () => void;
  onDelete: () => void;
}) {
  const displayTitle = noteDisplayTitle(note);
  const snippet = noteSnippet(note);
  const isArchived = note.archived_at !== null;

  return (
    <li className="flex items-center gap-1 py-0.5">
      <Link
        href={`/notes/${note.id}`}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-lg px-1.5 py-1.5 transition hover:bg-surface-muted"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[15px] font-medium text-foreground">{displayTitle}</span>
          {showArchivedBadge && (
            <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Archived
            </span>
          )}
        </span>
        {snippet && <span className="truncate text-sm text-muted-foreground">{snippet}</span>}
      </Link>

      {!isArchived && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          onTouchStart={() => {}}
          aria-pressed={note.pinned}
          aria-label={note.pinned ? `Unpin ${displayTitle}` : `Pin ${displayTitle}`}
          className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition focus:outline-none focus:ring-2 focus:ring-ring ${
            note.pinned
              ? "bg-primary/15 text-primary hover:bg-primary/20 active:bg-primary/25"
              : "text-muted-foreground hover:bg-surface-muted hover:text-foreground active:bg-surface-muted"
          }`}
        >
          <PinIcon filled={note.pinned} className="h-4 w-4" />
        </button>
      )}

      <NoteActionsMenu
        noteLabel={displayTitle}
        isArchived={isArchived}
        onArchiveToggle={onArchiveToggle}
        onDelete={onDelete}
      />
    </li>
  );
}
