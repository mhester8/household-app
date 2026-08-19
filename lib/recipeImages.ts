import type { SupabaseClient } from "@supabase/supabase-js";
// Relative import, not the "@/..." alias — this file is covered by
// recipeImages.test.ts, run via plain `node --test`, which can't resolve
// that alias (same reason lib/recipes.ts has no test file).
import { createId } from "./id.ts";

// Phase 2: user-uploaded recipe photos. Covers everything except the
// <input type="file"> UI itself (see RecipeImageField). The two Storage-
// calling functions below take an already-created Supabase client as a
// parameter rather than importing one at module scope, so the pure
// validation/path/URL-recognition functions stay testable with plain
// `node --test` — same reasoning as recipeCardMeta.ts's "no Supabase/
// Next.js imports" comment.

export const RECIPE_IMAGES_BUCKET = "recipe-images";

const MAX_RECIPE_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_RECIPE_IMAGE_MB = MAX_RECIPE_IMAGE_BYTES / (1024 * 1024);
const ACCEPTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);

// The path segment common to every public URL Supabase Storage generates
// for an object in this bucket, regardless of project ref — used to both
// recognize and extract paths from a recipe's image_url below.
const PUBLIC_URL_MARKER = `/storage/v1/object/public/${RECIPE_IMAGES_BUCKET}/`;

function getFileExtension(fileName: string): string | null {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  return match ? match[1].toLowerCase() : null;
}

// Rejects anything too large or that doesn't look like a photo. MIME type
// is checked first, but some mobile browsers report a blank `type` for
// HEIC/HEIF camera photos, so a recognized file extension is accepted as a
// fallback rather than rejecting a real photo straight off someone's phone.
// (No resizing/conversion here — this is validation only.)
export function validateRecipeImageFile(file: File): string | null {
  if (file.size > MAX_RECIPE_IMAGE_BYTES) {
    return `That photo is too large (max ${MAX_RECIPE_IMAGE_MB} MB). Try a smaller one.`;
  }

  const extension = getFileExtension(file.name);
  const looksLikeImage =
    file.type.startsWith("image/") || (extension !== null && ACCEPTED_EXTENSIONS.has(extension));

  if (!looksLikeImage) {
    return "Please choose a JPEG, PNG, WEBP, or HEIC photo.";
  }

  return null;
}

// Object path convention: {recipe_id}/{unique-filename}. Keying by
// recipe_id keeps "everything belonging to this recipe" a simple prefix; a
// fresh filename on every call (rather than one fixed name) means a
// replace always creates a new object instead of overwriting the old one,
// so a stale cached copy of the old image is never served from the new
// image_url.
export function buildRecipeImagePath(recipeId: string, file: File): string {
  const extension = getFileExtension(file.name) ?? "jpg";
  return `${recipeId}/${createId()}.${extension}`;
}

// True when `url` is a public URL for an object in our own recipe-images
// bucket (i.e. a previous upload through this app) rather than an external
// recipe-site image captured during URL import — only the former is ever
// safe to delete from Storage.
export function isRecipeImageUrl(url: string | null): boolean {
  return url !== null && url.includes(PUBLIC_URL_MARKER);
}

// Extracts the Storage object path (the part after the bucket name) from
// one of our public URLs, for passing to storage.remove(). Returns null for
// anything that isn't one of ours.
export function getRecipeImagePathFromUrl(url: string): string | null {
  const markerIndex = url.indexOf(PUBLIC_URL_MARKER);
  if (markerIndex === -1) {
    return null;
  }
  return decodeURIComponent(url.slice(markerIndex + PUBLIC_URL_MARKER.length));
}

// Uploads under a fresh path (see buildRecipeImagePath) and returns its
// public URL. Never overwrites an existing object — replacement is always
// a new object plus, afterward, the caller best-effort deleting the old one
// via deleteRecipeImageIfOwned.
export async function uploadRecipeImage(
  client: SupabaseClient,
  recipeId: string,
  file: File
): Promise<{ publicUrl: string; error: null } | { publicUrl: null; error: string }> {
  const path = buildRecipeImagePath(recipeId, file);
  const { error: uploadError } = await client.storage.from(RECIPE_IMAGES_BUCKET).upload(path, file);

  if (uploadError) {
    return { publicUrl: null, error: `Couldn't upload photo: ${uploadError.message}` };
  }

  const { data } = client.storage.from(RECIPE_IMAGES_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, error: null };
}

// Best-effort cleanup: silently does nothing for a null or external URL,
// and logs (rather than throws) on a Storage failure, since losing track of
// one orphaned object is an acceptable tradeoff for never blocking a
// recipe save/delete on cleanup succeeding.
export async function deleteRecipeImageIfOwned(client: SupabaseClient, url: string | null): Promise<void> {
  if (url === null) {
    return;
  }

  const path = getRecipeImagePathFromUrl(url);
  if (path === null) {
    return;
  }

  const { error } = await client.storage.from(RECIPE_IMAGES_BUCKET).remove([path]);
  if (error) {
    console.error("Couldn't delete old recipe image from Storage:", error.message);
  }
}
