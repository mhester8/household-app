import type OpenAI from "openai";
import type { RecipeImportDraft } from "@/lib/recipes";
import { dedupeAdjacentLines } from "@/lib/recipeImportDedup";

// Kept as a single constant so it's a one-line swap after evaluating quality
// vs. cost. gpt-5.6-terra is in the current GPT-5.6 line (confirmed as a
// valid model identifier in the installed openai SDK's type definitions),
// chosen over the -sol/-luna siblings and the plain flagship as the
// starting point for strong image understanding on a recurring household
// task without defaulting to the highest-cost model in the line.
export const RECIPE_IMPORT_MODEL = "gpt-5.6-terra";

// Shared by every vision-based recipe importer (photo upload, Pinterest Pin
// image) — one schema/sanitizer/model so they can never drift apart.
export const RECIPE_IMPORT_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: ["string", "null"] },
    ingredients: { type: "array", items: { type: "string" } },
    steps: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    servings: { type: ["string", "null"] },
    prepTimeMinutes: { type: ["integer", "null"] },
    cookTimeMinutes: { type: ["integer", "null"] },
    totalTimeMinutes: { type: ["integer", "null"] },
  },
  required: [
    "title",
    "ingredients",
    "steps",
    "warnings",
    "servings",
    "prepTimeMinutes",
    "cookTimeMinutes",
    "totalTimeMinutes",
  ],
  additionalProperties: false,
} as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// Coerces a model-provided time field to a non-negative integer number of
// minutes, or null. Never trust the raw value blindly — a negative number,
// a fraction, or a non-number all collapse to null rather than being
// rejected outright, matching the leniency already used for title/servings.
function sanitizeMinutes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

// Never trust the model's output shape blindly, even under strict mode —
// coerce/trim/drop-empty so downstream code always sees clean data.
// `imageUrl` is threaded in by the caller rather than read from the model's
// output: only the caller knows whether there's a sensible cover image for
// this draft (a Pinterest Pin's own image, or null for a plain photo import
// where there's no separate "source" image to point to).
export function sanitizeRecipeImportDraft(value: unknown, imageUrl: string | null): RecipeImportDraft | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawTitle = record.title;
  const title = typeof rawTitle === "string" && rawTitle.trim() !== "" ? rawTitle.trim() : null;
  const rawServings = record.servings;
  const servings = typeof rawServings === "string" && rawServings.trim() !== "" ? rawServings.trim() : null;

  if (!isStringArray(record.ingredients) || !isStringArray(record.steps) || !isStringArray(record.warnings)) {
    return null;
  }

  return {
    title,
    ingredients: dedupeAdjacentLines(record.ingredients.map((line) => line.trim()).filter((line) => line !== "")),
    steps: dedupeAdjacentLines(record.steps.map((line) => line.trim()).filter((line) => line !== "")),
    warnings: record.warnings.map((line) => line.trim()).filter((line) => line !== ""),
    servings,
    prepTimeMinutes: sanitizeMinutes(record.prepTimeMinutes),
    cookTimeMinutes: sanitizeMinutes(record.cookTimeMinutes),
    totalTimeMinutes: sanitizeMinutes(record.totalTimeMinutes),
    imageUrl,
  };
}

type RecipeImportInput = Parameters<OpenAI["responses"]["create"]>[0]["input"];

// Runs the shared structured-output call and returns a sanitized draft, or
// throws if the model's output didn't parse/sanitize into a usable shape —
// callers already wrap their own catch around this (same as the inline
// version this was extracted from) to turn that into a user-facing error.
export async function runRecipeImportExtraction(
  openai: OpenAI,
  input: RecipeImportInput,
  imageUrl: string | null
): Promise<RecipeImportDraft> {
  const response = await openai.responses.create({
    model: RECIPE_IMPORT_MODEL,
    input,
    text: {
      format: {
        type: "json_schema",
        name: "recipe_import_draft",
        strict: true,
        schema: RECIPE_IMPORT_JSON_SCHEMA,
      },
    },
  });

  const parsed = sanitizeRecipeImportDraft(JSON.parse(response.output_text), imageUrl);
  if (!parsed) {
    throw new Error("Malformed structured output from recipe import");
  }
  return parsed;
}
