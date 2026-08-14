import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateRecipeImageFile,
  buildRecipeImagePath,
  isRecipeImageUrl,
  getRecipeImagePathFromUrl,
  RECIPE_IMAGES_BUCKET,
} from "./recipeImages.ts";

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

test("validateRecipeImageFile accepts a normal JPEG", () => {
  const file = makeFile("dinner.jpg", "image/jpeg", 2 * 1024 * 1024);
  assert.equal(validateRecipeImageFile(file), null);
});

test("validateRecipeImageFile rejects a file over the size limit", () => {
  const file = makeFile("huge.jpg", "image/jpeg", 11 * 1024 * 1024);
  assert.match(validateRecipeImageFile(file) ?? "", /too large/);
});

test("validateRecipeImageFile rejects a non-image file", () => {
  const file = makeFile("recipe.pdf", "application/pdf", 1024);
  assert.match(validateRecipeImageFile(file) ?? "", /JPEG, PNG, WEBP, or HEIC/);
});

test("validateRecipeImageFile accepts HEIC photos even with a blank MIME type", () => {
  // Some mobile browsers report an empty `type` for HEIC/HEIF camera
  // photos — the file extension fallback should still accept these.
  const file = makeFile("IMG_1234.HEIC", "", 3 * 1024 * 1024);
  assert.equal(validateRecipeImageFile(file), null);
});

test("validateRecipeImageFile accepts a normal-size file at exactly the limit boundary", () => {
  const file = makeFile("dinner.jpg", "image/jpeg", 10 * 1024 * 1024);
  assert.equal(validateRecipeImageFile(file), null);
});

test("buildRecipeImagePath is scoped under the recipe id and keeps the extension", () => {
  const file = makeFile("photo.png", "image/png", 1024);
  const path = buildRecipeImagePath("recipe-123", file);
  assert.match(path, /^recipe-123\/[^/]+\.png$/);
});

test("buildRecipeImagePath produces a different path on each call, so a replace never overwrites", () => {
  const file = makeFile("photo.png", "image/png", 1024);
  const first = buildRecipeImagePath("recipe-123", file);
  const second = buildRecipeImagePath("recipe-123", file);
  assert.notEqual(first, second);
});

test("buildRecipeImagePath falls back to a jpg extension when the filename has none", () => {
  const file = makeFile("photo", "image/jpeg", 1024);
  const path = buildRecipeImagePath("recipe-123", file);
  assert.match(path, /\.jpg$/);
});

test("isRecipeImageUrl recognizes our own Storage public URLs", () => {
  const url = `https://abcabc.supabase.co/storage/v1/object/public/${RECIPE_IMAGES_BUCKET}/recipe-123/abc.jpg`;
  assert.equal(isRecipeImageUrl(url), true);
});

test("isRecipeImageUrl rejects external recipe-site URLs", () => {
  assert.equal(isRecipeImageUrl("https://example.com/recipe.jpg"), false);
});

test("isRecipeImageUrl rejects a URL from a different Storage bucket", () => {
  assert.equal(
    isRecipeImageUrl("https://abcabc.supabase.co/storage/v1/object/public/some-other-bucket/x.jpg"),
    false
  );
});

test("isRecipeImageUrl rejects null", () => {
  assert.equal(isRecipeImageUrl(null), false);
});

test("getRecipeImagePathFromUrl extracts the object path from one of our URLs", () => {
  const url = `https://abcabc.supabase.co/storage/v1/object/public/${RECIPE_IMAGES_BUCKET}/recipe-123/abc%20def.jpg`;
  assert.equal(getRecipeImagePathFromUrl(url), "recipe-123/abc def.jpg");
});

test("getRecipeImagePathFromUrl returns null for an external URL", () => {
  assert.equal(getRecipeImagePathFromUrl("https://example.com/recipe.jpg"), null);
});
