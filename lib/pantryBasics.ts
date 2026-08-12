import { supabase } from "@/lib/supabase/client";

// Shared household vocabulary of ingredients we normally keep around, so
// they default to unchecked when reviewing recipe ingredients for the
// shopping list. Not an inventory system — no quantity, category, or stock
// state, same shared/no-ownership convention as recipes and grocery items.
export type PantryBasic = {
  id: string;
  name: string;
  created_at: string;
};

// No Realtime here on purpose: the list is small, low-frequency, and only
// read once per review-panel open — fetch-on-open is simple and sufficient,
// and a household member editing it while another has the panel open at the
// exact same moment is a rare, low-stakes edge case that resolves itself the
// next time the panel is opened.
export async function fetchPantryBasics(): Promise<{ basics: PantryBasic[]; error: string | null }> {
  const { data, error } = await supabase
    .from("pantry_basics")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });

  return {
    basics: error || !data ? [] : data,
    error: error?.message ?? null,
  };
}

export async function addPantryBasic(
  name: string
): Promise<{ basic: PantryBasic; error: null } | { basic: null; error: string }> {
  const trimmed = name.trim().toLowerCase();
  if (trimmed === "") {
    return { basic: null, error: "Enter a pantry basic to add." };
  }

  const { data, error } = await supabase
    .from("pantry_basics")
    .insert({ name: trimmed })
    .select("id, name, created_at")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { basic: null, error: "That's already in the pantry basics list." };
    }
    return { basic: null, error: error?.message ?? "Couldn't add that pantry basic." };
  }

  return { basic: data, error: null };
}

export async function removePantryBasic(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from("pantry_basics").delete().eq("id", id);
  return { error: error?.message ?? null };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Deterministic, non-AI matching: a recipe ingredient line is a pantry basic
// if any configured term appears in it as a whole word/phrase — word
// boundaries so "salt" matches "kosher salt" but not e.g. "assault", and a
// multi-word term like "vanilla extract" matches as a phrase. Intentionally
// simple substring-with-boundaries matching, not a general ingredient
// classifier — false positives (e.g. a bare "pepper" term also matching
// "bell pepper") are an accepted tradeoff for this small, editable list.
export function matchesPantryBasic(ingredientText: string, pantryBasics: PantryBasic[]): boolean {
  const normalized = ingredientText.toLowerCase();
  return pantryBasics.some((basic) => {
    const term = basic.name.trim().toLowerCase();
    if (term === "") {
      return false;
    }
    return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(normalized);
  });
}
