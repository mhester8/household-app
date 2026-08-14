import { supabase } from "@/lib/supabase/client";

// Inserts (a brand-new note) or updates (every save after that), with no
// React state side effects — so it's safe to call from both interactive
// autosave paths and fire-and-forget "flush before leaving" paths that
// can't rely on any particular component still being mounted. Shared by
// NoteEditor (existing notes) and the inline composer on the Notes list
// (new notes), so there is exactly one place that knows how to write a note.
//
// Kept out of lib/notes.ts deliberately: that file's pure helpers are
// covered by lib/notes.test.ts, which runs under plain `node --test` and
// can't resolve the "@/..." path alias this Supabase import needs — same
// reason lib/groceryItems.ts and lib/recipes.ts (which also import the
// Supabase client) have no test files of their own.
export async function persistNote(
  id: string | null,
  title: string,
  body: string
): Promise<{ id: string } | { error: string }> {
  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();

  if (id === null) {
    const { data, error } = await supabase
      .from("notes")
      .insert({ title: trimmedTitle === "" ? null : trimmedTitle, body: trimmedBody })
      .select("id")
      .single();
    if (error || !data) {
      return { error: error?.message ?? "Failed to create note" };
    }
    return { id: data.id };
  }

  const { error } = await supabase
    .from("notes")
    .update({
      title: trimmedTitle === "" ? null : trimmedTitle,
      body: trimmedBody,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }
  return { id };
}
