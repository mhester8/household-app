"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import {
  type GroceryItem,
  findActiveDuplicate,
  getGrocerySuggestions,
  normalizeItemName,
  upsertItem,
} from "@/lib/groceryItems";
import { LeafIcon } from "@/components/LeafIcon";
import { Toast, type ToastState } from "@/components/Toast";

// How long an undo/error toast stays up before it auto-dismisses. Delete's
// undo window and its toast share this duration on purpose: once the toast
// is gone, the delete has already been (or is about to be) sent.
const DELETE_UNDO_MS = 5000;
const COMPLETE_TOAST_MS = 5000;
const ERROR_TOAST_MS = 6000;
const INFO_TOAST_MS = 2500;
// Brief fade before a just-completed row actually leaves the active list —
// long enough to read as intentional, short enough to never feel like a wait.
const COMPLETE_ANIM_MS = 180;
const HIGHLIGHT_MS = 2000;

export default function GroceriesPage() {
  const [userId, setUserId] = useState<string | null>(null);

  const [items, setItems] = useState<GroceryItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [isAddFocused, setIsAddFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [groupedSections, setGroupedSections] = useState<
    { name: string; itemIds: string[] }[] | null
  >(null);
  const [isGrouping, setIsGrouping] = useState(false);

  const [isCompletedExpanded, setIsCompletedExpanded] = useState(false);
  const [animatingOutIds, setAnimatingOutIds] = useState<Set<string>>(new Set());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  // Ids this browser tab created itself, so the realtime INSERT echo of our
  // own optimistic add is never mistaken for another household member's item.
  const localItemIdsRef = useRef<Set<string>>(new Set());
  // Deletes are optimistic immediately but the actual Supabase delete is
  // held until the undo window elapses, so "Undo" never races a delete
  // that's already in flight — it just cancels a timer.
  const pendingDeletesRef = useRef<Map<string, { item: GroceryItem; timer: ReturnType<typeof setTimeout> }>>(
    new Map()
  );
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Committing/cancelling an edit unmounts its input, which can synthesize a
  // trailing blur event — this flag stops that blur from re-committing.
  const skipNextEditBlurRef = useRef(false);

  // The authenticated layout already guarantees a session exists before this
  // page renders; read it locally so the data effects below can keep their
  // existing userId guard.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user.id ?? null);
    });
  }, []);

  // Load the grocery list from Supabase once a signed-in user is known.
  useEffect(() => {
    if (!userId) {
      return;
    }

    async function loadItems() {
      setIsLoading(true);
      setErrorMessage(null);

      const { data, error } = await supabase
        .from("grocery_items")
        .select("id, name, completed, created_at")
        .order("created_at", { ascending: true });

      if (error) {
        setErrorMessage(`Could not load grocery items: ${error.message}`);
      } else {
        setItems(data ?? []);
      }
      setIsLoading(false);
    }

    loadItems();
  }, [userId]);

  // Subscribe to Realtime changes so other browsers' writes show up without a refresh.
  useEffect(() => {
    if (!userId) {
      return;
    }

    const channel = supabase
      .channel("grocery_items_changes")
      .on<GroceryItem>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "grocery_items" },
        (payload) => {
          const newItem = payload.new as GroceryItem;
          const isOwnItem = localItemIdsRef.current.has(newItem.id);

          setItems((currentItems) => upsertItem(currentItems, newItem));

          if (!isOwnItem) {
            setHighlightedIds((current) => new Set(current).add(newItem.id));
            setTimeout(() => {
              setHighlightedIds((current) => {
                if (!current.has(newItem.id)) return current;
                const next = new Set(current);
                next.delete(newItem.id);
                return next;
              });
            }, HIGHLIGHT_MS);
          }
        }
      )
      .on<GroceryItem>(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "grocery_items" },
        (payload) => {
          setItems((currentItems) => upsertItem(currentItems, payload.new as GroceryItem));
        }
      )
      .on<GroceryItem>(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "grocery_items" },
        (payload) => {
          const deletedId = (payload.old as { id: string }).id;
          setItems((currentItems) => currentItems.filter((item) => item.id !== deletedId));
        }
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Supabase Realtime subscription issue:", status, err);
          setErrorMessage(
            `Realtime updates are unavailable (${status}). Other people's changes won't appear until you refresh.`
          );
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

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

  async function addItem(rawName: string) {
    const trimmed = rawName.trim();
    if (trimmed === "") {
      return;
    }

    const duplicate = findActiveDuplicate(items, trimmed);
    if (duplicate) {
      setNewItemName("");
      showToast({ message: `${duplicate.name} is already on the list` }, INFO_TOAST_MS);
      return;
    }

    const id = crypto.randomUUID();
    const optimisticItem: GroceryItem = {
      id,
      name: trimmed,
      completed: false,
      created_at: new Date().toISOString(),
    };

    localItemIdsRef.current.add(id);
    setItems((currentItems) => upsertItem(currentItems, optimisticItem));
    setNewItemName("");

    const { data, error } = await supabase
      .from("grocery_items")
      .insert({ id, name: trimmed })
      .select("id, name, completed, created_at")
      .single();

    if (error || !data) {
      localItemIdsRef.current.delete(id);
      setItems((currentItems) => currentItems.filter((item) => item.id !== id));
      showToast(
        {
          message: `Couldn't add ${trimmed}`,
          actionLabel: "Retry",
          onAction: () => addItem(trimmed),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
      return;
    }

    setItems((currentItems) => upsertItem(currentItems, data));
  }

  function handleAddItemSubmit(event: React.FormEvent) {
    event.preventDefault();
    addItem(newItemName);
  }

  async function setCompleted(item: GroceryItem, nextCompleted: boolean) {
    const previousCompleted = item.completed;

    if (nextCompleted) {
      setAnimatingOutIds((current) => new Set(current).add(item.id));
      setTimeout(() => {
        setAnimatingOutIds((current) => {
          if (!current.has(item.id)) return current;
          const next = new Set(current);
          next.delete(item.id);
          return next;
        });
      }, COMPLETE_ANIM_MS);
    }

    setItems((currentItems) =>
      currentItems.map((existing) =>
        existing.id === item.id ? { ...existing, completed: nextCompleted } : existing
      )
    );

    if (nextCompleted) {
      showToast(
        {
          message: `${item.name} completed`,
          actionLabel: "Undo",
          onAction: () => setCompleted(item, false),
        },
        COMPLETE_TOAST_MS
      );
    }

    const { error } = await supabase
      .from("grocery_items")
      .update({ completed: nextCompleted })
      .eq("id", item.id);

    if (error) {
      setItems((currentItems) =>
        currentItems.map((existing) =>
          existing.id === item.id ? { ...existing, completed: previousCompleted } : existing
        )
      );
      showToast(
        {
          message: `Couldn't update ${item.name}`,
          actionLabel: "Retry",
          onAction: () => setCompleted(item, nextCompleted),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  function handleToggleComplete(item: GroceryItem) {
    setCompleted(item, !item.completed);
  }

  function startEdit(item: GroceryItem) {
    setEditingId(item.id);
    setEditingName(item.name);
  }

  function cancelEdit() {
    skipNextEditBlurRef.current = true;
    setEditingId(null);
    setEditingName("");
  }

  async function renameItem(id: string, previousName: string, nextName: string) {
    setItems((currentItems) =>
      currentItems.map((existing) => (existing.id === id ? { ...existing, name: nextName } : existing))
    );

    const { error } = await supabase.from("grocery_items").update({ name: nextName }).eq("id", id);

    if (error) {
      setItems((currentItems) =>
        currentItems.map((existing) => (existing.id === id ? { ...existing, name: previousName } : existing))
      );
      showToast(
        {
          message: `Couldn't rename ${previousName}`,
          actionLabel: "Retry",
          onAction: () => renameItem(id, previousName, nextName),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  function commitEdit(item: GroceryItem) {
    skipNextEditBlurRef.current = true;
    const trimmed = editingName.trim();
    const isStillEditing = editingId === item.id;
    setEditingId(null);
    setEditingName("");

    if (!isStillEditing || trimmed === "" || trimmed === item.name) {
      return;
    }

    const duplicate = findActiveDuplicate(items, trimmed, item.id);
    if (duplicate) {
      showToast({ message: `${duplicate.name} is already on the list` }, INFO_TOAST_MS);
      return;
    }

    renameItem(item.id, item.name, trimmed);
  }

  function handleDeleteItem(item: GroceryItem) {
    setItems((currentItems) => currentItems.filter((existing) => existing.id !== item.id));

    const existingPending = pendingDeletesRef.current.get(item.id);
    if (existingPending) {
      clearTimeout(existingPending.timer);
    }

    const timer = setTimeout(() => {
      pendingDeletesRef.current.delete(item.id);
      commitDelete(item);
    }, DELETE_UNDO_MS);
    pendingDeletesRef.current.set(item.id, { item, timer });

    showToast(
      {
        message: `${item.name} deleted`,
        actionLabel: "Undo",
        onAction: () => undoDelete(item.id),
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
    setItems((currentItems) => upsertItem(currentItems, pending.item));
  }

  async function commitDelete(item: GroceryItem) {
    const { error } = await supabase.from("grocery_items").delete().eq("id", item.id);

    if (error) {
      // The undo window already closed but the delete itself failed — put
      // the item back so local state matches the database, rather than
      // silently losing it from view while it's still there on the server.
      setItems((currentItems) => upsertItem(currentItems, item));
      showToast(
        {
          message: `Couldn't delete ${item.name}`,
          actionLabel: "Retry",
          onAction: () => handleDeleteItem(item),
          tone: "danger",
        },
        ERROR_TOAST_MS
      );
    }
  }

  async function handleClearCompleted() {
    setErrorMessage(null);
    const completedSnapshot = items.filter((item) => item.completed);
    setItems((currentItems) => currentItems.filter((item) => !item.completed));

    const { error } = await supabase.from("grocery_items").delete().eq("completed", true);

    if (error) {
      setItems((currentItems) => {
        const missing = completedSnapshot.filter(
          (item) => !currentItems.some((existing) => existing.id === item.id)
        );
        return missing.reduce((acc, item) => upsertItem(acc, item), currentItems);
      });
      setErrorMessage(`Could not clear completed items: ${error.message}`);
    }
  }

  async function handleGroupForShopping() {
    setErrorMessage(null);
    setIsGrouping(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setErrorMessage("Could not group items: you're signed out.");
        return;
      }

      const incompleteItems = items.filter((item) => !item.completed);

      const response = await fetch("/api/group-groceries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          items: incompleteItems.map((item) => ({ id: item.id, name: item.name })),
        }),
      });

      const body = await response.json();

      if (!response.ok) {
        setErrorMessage(`Could not group items: ${body.error ?? "Unknown error"}`);
        return;
      }

      setGroupedSections(body.sections);
    } catch {
      setErrorMessage("Could not group items: network error.");
    } finally {
      setIsGrouping(false);
    }
  }

  function handleBackToList() {
    setGroupedSections(null);
  }

  const itemsById = new Map(items.map((item) => [item.id, item]));
  const displaySections =
    groupedSections
      ?.map((section) => ({
        name: section.name,
        items: section.itemIds
          .map((id) => itemsById.get(id))
          .filter((item): item is GroceryItem => item !== undefined),
      }))
      .filter((section) => section.items.length > 0) ?? [];

  const activeItems = items.filter((item) => !item.completed || animatingOutIds.has(item.id));
  const completedItems = items.filter((item) => item.completed && !animatingOutIds.has(item.id));
  const activeNames = new Set(
    items.filter((item) => !item.completed).map((item) => normalizeItemName(item.name))
  );
  const suggestions =
    isAddFocused && newItemName.trim() !== ""
      ? getGrocerySuggestions(items, newItemName, activeNames)
      : [];

  function renderItemRow(item: GroceryItem) {
    const isAnimatingOut = item.completed && animatingOutIds.has(item.id);
    const isHighlighted = highlightedIds.has(item.id);
    const isEditing = editingId === item.id;

    return (
      <li
        key={item.id}
        className={`flex items-center gap-1 py-0.5 transition-all duration-200 ${
          isAnimatingOut ? "scale-[0.98] opacity-0" : "opacity-100"
        } ${isHighlighted ? "bg-primary/10" : ""}`}
      >
        {isEditing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitEdit(item);
            }}
            className="flex flex-1 items-center gap-1.5 py-1"
          >
            <input
              autoFocus
              type="text"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  cancelEdit();
                }
              }}
              onBlur={() => {
                if (skipNextEditBlurRef.current) {
                  skipNextEditBlurRef.current = false;
                  return;
                }
                commitEdit(item);
              }}
              aria-label={`Edit ${item.name}`}
              className="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface-muted px-2.5 text-[15px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </form>
        ) : (
          <>
            <button
              type="button"
              role="checkbox"
              aria-checked={item.completed}
              onClick={() => handleToggleComplete(item)}
              className="flex min-h-11 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition active:bg-surface-muted"
            >
              <span
                aria-hidden
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition ${
                  item.completed ? "border-primary bg-primary" : "border-border"
                }`}
              >
                {item.completed && (
                  <svg
                    viewBox="0 0 12 12"
                    className="h-2.5 w-2.5 fill-none stroke-primary-foreground"
                    strokeWidth={2}
                  >
                    <path d="M2 6l2.5 2.5L10 3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span
                className={`min-w-0 flex-1 break-words text-[15px] leading-snug ${
                  item.completed ? "text-muted-foreground line-through" : "text-foreground"
                }`}
              >
                {item.name}
              </span>
            </button>
            <button
              type="button"
              onClick={() => startEdit(item)}
              aria-label={`Edit ${item.name}`}
              className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => handleDeleteItem(item)}
              aria-label={`Delete ${item.name}`}
              className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-danger/10 hover:text-danger focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Delete
            </button>
          </>
        )}
      </li>
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
          Grocery List
        </h1>
      </div>

      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {groupedSections ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-primary">
              Grouped for shopping
            </span>
            <button
              type="button"
              onClick={handleBackToList}
              className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
            >
              Back to list
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {displaySections.map((section, index) => (
              <div key={`${section.name}-${index}`}>
                <h2 className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.name}
                </h2>
                <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
                  {section.items.map((item) => (
                    <li
                      key={item.id}
                      className="px-2 py-1.5 text-[15px] leading-snug text-foreground"
                    >
                      {item.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {displaySections.length === 0 && (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                Nothing to show.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <form onSubmit={handleAddItemSubmit} className="flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              onFocus={() => setIsAddFocused(true)}
              onBlur={() => setIsAddFocused(false)}
              placeholder="Add an item..."
              aria-label="New grocery item"
              autoComplete="off"
              className="min-h-11 flex-1 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="min-h-11 shrink-0 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
            >
              Add
            </button>
          </form>

          {suggestions.length > 0 && (
            <div className="-mt-1 flex flex-wrap gap-1.5 px-0.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.name}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addItem(suggestion.name)}
                  className="rounded-full border border-border bg-surface-muted px-3 py-1.5 text-sm text-foreground transition hover:bg-border active:bg-border"
                >
                  {suggestion.name}
                </button>
              ))}
            </div>
          )}

          {!isLoading && items.some((item) => !item.completed) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleGroupForShopping}
                disabled={isGrouping}
                className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
              >
                {isGrouping ? "Grouping…" : "Group for shopping"}
              </button>
            </div>
          )}

          {isLoading ? (
            <p className="p-1 text-sm text-muted-foreground">
              Loading grocery list...
            </p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
                {activeItems.map(renderItemRow)}
                {activeItems.length === 0 && (
                  <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                    {items.length === 0 ? "No items yet." : "Nothing left to buy."}
                  </li>
                )}
              </ul>

              {(completedItems.length > 0 || isCompletedExpanded) && (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsCompletedExpanded((expanded) => !expanded)}
                    aria-expanded={isCompletedExpanded}
                    className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-2 text-left transition hover:bg-surface-muted"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Completed ({completedItems.length})
                    </span>
                    <span aria-hidden className="text-xs text-muted-foreground">
                      {isCompletedExpanded ? "Hide" : "Show"}
                    </span>
                  </button>

                  {isCompletedExpanded && (
                    <>
                      <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
                        {completedItems.map(renderItemRow)}
                        {completedItems.length === 0 && (
                          <li className="px-1 py-4 text-center text-sm text-muted-foreground">
                            Nothing completed yet.
                          </li>
                        )}
                      </ul>
                      {completedItems.length > 0 && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={handleClearCompleted}
                            className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                          >
                            Clear completed
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
    </div>
  );
}
