"use client";

import { useEffect, useRef, useState } from "react";

// Compact "..." menu that replaces permanent Edit/Delete buttons on every
// row. It's a sibling of the row's completion button, not a descendant, so
// none of its clicks can ever bubble into a row-completion toggle — the
// stopPropagation calls below are defense in depth, not the real guard.
export function ItemActionsMenu({
  itemName,
  onEdit,
  onDelete,
}: {
  itemName: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);

  // Focus the first item the moment the menu opens, whether it was opened
  // by mouse or keyboard — a menu that doesn't move focus into itself isn't
  // keyboard-navigable.
  useEffect(() => {
    if (isOpen) {
      editRef.current?.focus();
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

  function focusOther(current: "edit" | "delete") {
    (current === "edit" ? deleteRef : editRef).current?.focus();
  }

  function handleItemKeyDown(event: React.KeyboardEvent, current: "edit" | "delete") {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOther(current);
    }
  }

  // Tabbing out of the menu to unrelated UI should close it, same as a
  // native <select> — no explicit focus trap needed. Deferred (rather than
  // reading event.relatedTarget synchronously) because touch-driven blur on
  // mobile fires before the tapped item's own click event, and its
  // relatedTarget is unreliably null there — closing synchronously would
  // unmount Edit/Delete before the tap ever reached them. By the time this
  // runs, any click from the tap that caused the blur has already fired.
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
        aria-label={`Actions for ${itemName}`}
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
          aria-label={`Actions for ${itemName}`}
          className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-lg"
        >
          <button
            ref={editRef}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setIsOpen(false);
              onEdit();
            }}
            onKeyDown={(event) => handleItemKeyDown(event, "edit")}
            className="flex w-full items-center px-3.5 py-2.5 text-left text-sm text-foreground transition hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
          >
            Edit
          </button>
          <button
            ref={deleteRef}
            type="button"
            role="menuitem"
            onClick={(event) => {
              event.stopPropagation();
              setIsOpen(false);
              onDelete();
            }}
            onKeyDown={(event) => handleItemKeyDown(event, "delete")}
            className="flex w-full items-center px-3.5 py-2.5 text-left text-sm text-danger transition hover:bg-danger/10 focus:bg-danger/10 focus:outline-none"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
