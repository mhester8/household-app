"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { type GroceryItem, upsertItem } from "@/lib/groceryItems";
import SignInForm from "@/components/SignInForm";

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
    <div className="flex flex-col flex-1 items-center bg-zinc-50 dark:bg-black">
      <main className="flex w-full max-w-md flex-col gap-6 px-4 py-10 sm:px-6">
        {isAuthLoading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Checking session...
          </p>
        ) : !session ? (
          <SignInForm />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
                Grocery List
              </h1>
              <button
                type="button"
                onClick={handleSignOut}
                className="text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                Sign Out
              </button>
            </div>

            {errorMessage && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
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
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-black focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-base font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                Add
              </button>
            </form>

            {isLoading ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Loading grocery list...
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      onChange={() => handleToggleComplete(item)}
                      aria-label={`Mark ${item.name} as complete`}
                      className="h-5 w-5 shrink-0"
                    />
                    <span
                      className={`flex-1 text-base ${
                        item.completed
                          ? "text-zinc-400 line-through dark:text-zinc-600"
                          : "text-black dark:text-zinc-50"
                      }`}
                    >
                      {item.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.id)}
                      aria-label={`Delete ${item.name}`}
                      className="rounded-md px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete
                    </button>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="text-center text-sm text-zinc-500 dark:text-zinc-400">
                    No items yet.
                  </li>
                )}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
