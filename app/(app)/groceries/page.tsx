"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { type GroceryItem, upsertItem } from "@/lib/groceryItems";
import { LeafIcon } from "@/components/LeafIcon";

export default function GroceriesPage() {
  const [userId, setUserId] = useState<string | null>(null);

  const [items, setItems] = useState<GroceryItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [groupedSections, setGroupedSections] = useState<
    { name: string; itemIds: string[] }[] | null
  >(null);
  const [isGrouping, setIsGrouping] = useState(false);

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
          setItems((currentItems) => upsertItem(currentItems, payload.new as GroceryItem));
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

  async function handleAddItem(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = newItemName.trim();
    if (trimmedName === "") {
      return;
    }

    setErrorMessage(null);
    const { data, error } = await supabase
      .from("grocery_items")
      .insert({ name: trimmedName })
      .select("id, name, completed, created_at")
      .single();

    if (error || !data) {
      setErrorMessage(`Could not add item: ${error?.message ?? "Unknown error"}`);
      return;
    }

    setItems((currentItems) => upsertItem(currentItems, data));
    setNewItemName("");
  }

  async function handleToggleComplete(item: GroceryItem) {
    setErrorMessage(null);
    const { data, error } = await supabase
      .from("grocery_items")
      .update({ completed: !item.completed })
      .eq("id", item.id)
      .select("id, name, completed, created_at")
      .single();

    if (error || !data) {
      setErrorMessage(`Could not update item: ${error?.message ?? "Unknown error"}`);
      return;
    }

    setItems((currentItems) => upsertItem(currentItems, data));
  }

  async function handleDeleteItem(id: string) {
    setErrorMessage(null);
    const { error } = await supabase.from("grocery_items").delete().eq("id", id);

    if (error) {
      setErrorMessage(`Could not delete item: ${error.message}`);
      return;
    }

    setItems((currentItems) => currentItems.filter((item) => item.id !== id));
  }

  async function handleClearCompleted() {
    setErrorMessage(null);
    const { error } = await supabase.from("grocery_items").delete().eq("completed", true);

    if (error) {
      setErrorMessage(`Could not clear completed items: ${error.message}`);
      return;
    }

    setItems((currentItems) => currentItems.filter((item) => !item.completed));
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
          <form onSubmit={handleAddItem} className="flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              placeholder="Add an item..."
              aria-label="New grocery item"
              className="min-h-11 flex-1 rounded-xl border border-border bg-surface-muted px-3.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              className="min-h-11 shrink-0 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
            >
              Add
            </button>
          </form>

          {!isLoading && items.length > 0 && (
            <div className="flex items-center justify-between gap-2">
              {items.some((item) => !item.completed) && (
                <button
                  type="button"
                  onClick={handleGroupForShopping}
                  disabled={isGrouping}
                  className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
                >
                  {isGrouping ? "Grouping…" : "Group for shopping"}
                </button>
              )}
              {items.some((item) => item.completed) && (
                <button
                  type="button"
                  onClick={handleClearCompleted}
                  className="rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                >
                  Clear completed
                </button>
              )}
            </div>
          )}

          {isLoading ? (
            <p className="p-1 text-sm text-muted-foreground">
              Loading grocery list...
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border sm:rounded-2xl sm:border sm:border-border">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={`flex items-center gap-2 py-1 ${
                    item.completed ? "bg-surface-muted" : ""
                  }`}
                >
                  <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => handleToggleComplete(item)}
                      aria-label={`Mark ${item.name} as complete`}
                      className="h-[18px] w-[18px] accent-primary"
                    />
                  </label>
                  <span
                    className={`min-w-0 flex-1 break-words text-[15px] leading-snug ${
                      item.completed
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }`}
                  >
                    {item.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteItem(item.id)}
                    aria-label={`Delete ${item.name}`}
                    className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-danger/10 hover:text-danger focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    Delete
                  </button>
                </li>
              ))}
              {items.length === 0 && (
                <li className="px-1 py-6 text-center text-sm text-muted-foreground">
                  No items yet.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
