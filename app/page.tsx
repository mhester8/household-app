"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { type GroceryItem, upsertItem } from "@/lib/groceryItems";
import SignInForm from "@/components/SignInForm";

function LeafIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M4 15c0-6 4.5-11 15-11 0 10.5-5 15-11 15-2.5 0-4-1-4-4Z" />
      <path d="M5 19c3-3 6-6 12-11" />
    </svg>
  );
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  const [items, setItems] = useState<GroceryItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const userId = session?.user.id ?? null;

  // Check for an existing session on load, then keep it in sync (sign-in,
  // sign-out, and silent token refresh) via Supabase's auth state listener.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setIsAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      subscription.unsubscribe();
    };
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

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

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

  return (
    <div className="flex flex-1 flex-col items-center bg-page px-3 py-3 sm:px-6 sm:py-8">
      <main className="flex w-full max-w-md flex-col gap-1.5 sm:gap-3">
        <div className="flex items-center justify-center gap-1 text-muted-foreground">
          <LeafIcon className="h-3 w-3" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em]">
            Hester House
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-xl bg-surface p-2 sm:gap-4 sm:rounded-3xl sm:border sm:border-border sm:p-6 sm:shadow-sm">
          {isAuthLoading ? (
            <p className="p-1 text-sm text-muted-foreground">Checking session...</p>
          ) : !session ? (
            <SignInForm />
          ) : (
            <div className="flex flex-col gap-2 sm:gap-4">
              <div className="flex items-center justify-between gap-2">
                <h1 className="flex items-center gap-1.5 text-xl font-bold tracking-tight text-primary">
                  <LeafIcon className="h-4 w-4 shrink-0" />
                  Grocery List
                </h1>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                >
                  Sign Out
                </button>
              </div>

              {errorMessage && (
                <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {errorMessage}
                </p>
              )}

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
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
