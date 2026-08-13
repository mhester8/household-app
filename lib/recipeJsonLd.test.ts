import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonLdBlocks,
  findRecipeNode,
  normalizeRecipeNode,
  flattenInstructions,
  hasUsableContent,
  parseIsoDurationToMinutes,
} from "./recipeJsonLd.ts";

const NO_TIME = { prepTimeMinutes: null, cookTimeMinutes: null, totalTimeMinutes: null };

function scriptTag(json: string): string {
  return `<script type="application/ld+json">${json}</script>`;
}

test("extractJsonLdBlocks parses a single JSON-LD script block", () => {
  const html = `<html><head>${scriptTag('{"@type":"Recipe","name":"Soup"}')}</head></html>`;
  const blocks = extractJsonLdBlocks(html);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { "@type": "Recipe", name: "Soup" });
});

test("extractJsonLdBlocks skips a malformed block but keeps a valid one on the same page", () => {
  const html = `
    <html><head>
      ${scriptTag("{ this is not valid json ")}
      ${scriptTag('{"@type":"Recipe","name":"Soup"}')}
    </head></html>
  `;
  const blocks = extractJsonLdBlocks(html);
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], { "@type": "Recipe", name: "Soup" });
});

test("extractJsonLdBlocks returns nothing for a page with no JSON-LD", () => {
  const html = "<html><head><title>No structured data here</title></head></html>";
  assert.deepEqual(extractJsonLdBlocks(html), []);
});

test("findRecipeNode matches a direct Recipe object", () => {
  const node = findRecipeNode([{ "@type": "Recipe", name: "Soup" }]);
  assert.deepEqual(node, { "@type": "Recipe", name: "Soup" });
});

test("findRecipeNode matches inside an array of JSON-LD objects", () => {
  const blocks = [[{ "@type": "WebSite", name: "Some Blog" }, { "@type": "Recipe", name: "Soup" }]];
  const node = findRecipeNode(blocks);
  assert.equal(node?.name, "Soup");
});

test("findRecipeNode matches a Recipe nested inside @graph", () => {
  const blocks = [
    {
      "@context": "https://schema.org",
      "@graph": [{ "@type": "WebSite", name: "Some Blog" }, { "@type": "Recipe", name: "Soup" }],
    },
  ];
  const node = findRecipeNode(blocks);
  assert.equal(node?.name, "Soup");
});

test("findRecipeNode matches when @type is an array containing Recipe", () => {
  const node = findRecipeNode([{ "@type": ["Recipe", "NewsArticle"], name: "Soup" }]);
  assert.equal(node?.name, "Soup");
});

test("findRecipeNode returns null when JSON-LD exists but no node is a Recipe", () => {
  const blocks = [{ "@type": "Organization", name: "Some Site" }, { "@type": "WebSite", name: "Some Blog" }];
  assert.equal(findRecipeNode(blocks), null);
});

test("findRecipeNode still finds a Recipe when it's mixed among several blocks", () => {
  const blocks = [
    { "@type": "Organization", name: "Some Site" },
    { "@type": "Recipe", name: "Soup" },
  ];
  const node = findRecipeNode(blocks);
  assert.equal(node?.name, "Soup");
});

test("normalizeRecipeNode reads title and recipeIngredient", () => {
  const draft = normalizeRecipeNode({
    "@type": "Recipe",
    name: "  Tomato Soup  ",
    recipeIngredient: ["2 cups tomatoes", "  ", "1 tsp salt"],
  });
  assert.equal(draft.title, "Tomato Soup");
  assert.deepEqual(draft.ingredients, ["2 cups tomatoes", "1 tsp salt"]);
});

test("normalizeRecipeNode handles a missing title and missing ingredients", () => {
  const draft = normalizeRecipeNode({ "@type": "Recipe" });
  assert.equal(draft.title, null);
  assert.deepEqual(draft.ingredients, []);
  assert.deepEqual(draft.steps, []);
});

test("flattenInstructions handles a single instructions string", () => {
  assert.deepEqual(flattenInstructions("Boil water. Add pasta."), ["Boil water. Add pasta."]);
});

test("flattenInstructions splits a newline-separated instructions string", () => {
  assert.deepEqual(flattenInstructions("Boil water.\nAdd pasta.\n\nDrain."), [
    "Boil water.",
    "Add pasta.",
    "Drain.",
  ]);
});

test("flattenInstructions handles an array of plain strings", () => {
  assert.deepEqual(flattenInstructions(["Boil water.", "Add pasta."]), ["Boil water.", "Add pasta."]);
});

test("flattenInstructions handles an array of HowToStep objects", () => {
  const raw = [
    { "@type": "HowToStep", text: "Boil water." },
    { "@type": "HowToStep", text: "Add pasta." },
  ];
  assert.deepEqual(flattenInstructions(raw), ["Boil water.", "Add pasta."]);
});

test("flattenInstructions preserves HowToSection names as their own lines before their steps", () => {
  const raw = [
    {
      "@type": "HowToSection",
      name: "Make the sauce",
      itemListElement: [
        { "@type": "HowToStep", text: "Mix ingredients." },
        { "@type": "HowToStep", text: "Simmer for 10 minutes." },
      ],
    },
    {
      "@type": "HowToSection",
      name: "Assemble",
      itemListElement: [{ "@type": "HowToStep", text: "Add sauce to pasta." }],
    },
  ];
  assert.deepEqual(flattenInstructions(raw), [
    "Make the sauce",
    "Mix ingredients.",
    "Simmer for 10 minutes.",
    "Assemble",
    "Add sauce to pasta.",
  ]);
});

test("flattenInstructions returns [] for missing/unrecognized instructions", () => {
  assert.deepEqual(flattenInstructions(undefined), []);
  assert.deepEqual(flattenInstructions(42), []);
});

test("hasUsableContent requires a title, an ingredient, or a step", () => {
  assert.equal(hasUsableContent({ title: null, ingredients: [], steps: [], servings: null, ...NO_TIME }), false);
  assert.equal(hasUsableContent({ title: "Soup", ingredients: [], steps: [], servings: null, ...NO_TIME }), true);
  assert.equal(hasUsableContent({ title: null, ingredients: ["salt"], steps: [], servings: null, ...NO_TIME }), true);
  assert.equal(hasUsableContent({ title: null, ingredients: [], steps: ["boil"], servings: null, ...NO_TIME }), true);
  // Servings alone doesn't make an otherwise-empty draft usable.
  assert.equal(hasUsableContent({ title: null, ingredients: [], steps: [], servings: "Serves 4", ...NO_TIME }), false);
  // Nor does time alone.
  assert.equal(
    hasUsableContent({ title: null, ingredients: [], steps: [], servings: null, prepTimeMinutes: 20, cookTimeMinutes: null, totalTimeMinutes: null }),
    false
  );
});

test("parseIsoDurationToMinutes handles common recipe duration forms", () => {
  assert.equal(parseIsoDurationToMinutes("PT20M"), 20);
  assert.equal(parseIsoDurationToMinutes("PT1H"), 60);
  assert.equal(parseIsoDurationToMinutes("PT1H30M"), 90);
});

test("parseIsoDurationToMinutes returns null for a missing value", () => {
  assert.equal(parseIsoDurationToMinutes(undefined), null);
  assert.equal(parseIsoDurationToMinutes(null), null);
});

test("parseIsoDurationToMinutes returns null for malformed/unsupported durations", () => {
  assert.equal(parseIsoDurationToMinutes("20 minutes"), null);
  assert.equal(parseIsoDurationToMinutes("P1D"), null);
  assert.equal(parseIsoDurationToMinutes("PT1H30M15S"), null);
  assert.equal(parseIsoDurationToMinutes("PT"), null);
  assert.equal(parseIsoDurationToMinutes(90), null);
});

test("normalizeRecipeNode reads prepTime/cookTime/totalTime as minutes", () => {
  const draft = normalizeRecipeNode({
    "@type": "Recipe",
    name: "Soup",
    prepTime: "PT20M",
    cookTime: "PT40M",
    totalTime: "PT1H",
  });
  assert.equal(draft.prepTimeMinutes, 20);
  assert.equal(draft.cookTimeMinutes, 40);
  assert.equal(draft.totalTimeMinutes, 60);
});

test("normalizeRecipeNode leaves time fields null when absent or unsupported", () => {
  const draft = normalizeRecipeNode({ "@type": "Recipe", name: "Soup", totalTime: "P1D" });
  assert.equal(draft.prepTimeMinutes, null);
  assert.equal(draft.cookTimeMinutes, null);
  assert.equal(draft.totalTimeMinutes, null);
});

test("normalizeRecipeNode reads a string recipeYield", () => {
  const draft = normalizeRecipeNode({ "@type": "Recipe", name: "Soup", recipeYield: "4 servings" });
  assert.equal(draft.servings, "4 servings");
});

test("normalizeRecipeNode reads a numeric recipeYield", () => {
  const draft = normalizeRecipeNode({ "@type": "Recipe", name: "Soup", recipeYield: 4 });
  assert.equal(draft.servings, "4");
});

test("normalizeRecipeNode defaults servings to null when recipeYield is absent", () => {
  const draft = normalizeRecipeNode({ "@type": "Recipe", name: "Soup" });
  assert.equal(draft.servings, null);
});

test("normalizeRecipeNode takes the first usable value from an array recipeYield", () => {
  const draft = normalizeRecipeNode({ "@type": "Recipe", name: "Soup", recipeYield: ["6", "6 servings"] });
  assert.equal(draft.servings, "6");
});

test("normalizeRecipeNode skips blank/unusable array entries to find the first real value", () => {
  const draft = normalizeRecipeNode({ "@type": "Recipe", name: "Soup", recipeYield: ["", "8 slices"] });
  assert.equal(draft.servings, "8 slices");
});

test("end-to-end: a full Recipe JSON-LD page normalizes into a usable draft", () => {
  const html = `
    <html><head>
      ${scriptTag('{"@type":"Organization","name":"Some Site"}')}
      ${scriptTag(
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Recipe",
          name: "Tomato Soup",
          recipeYield: "4 servings",
          prepTime: "PT20M",
          cookTime: "PT40M",
          totalTime: "PT1H",
          recipeIngredient: ["2 cups tomatoes", "1 tsp salt"],
          recipeInstructions: [
            { "@type": "HowToStep", text: "Boil water." },
            { "@type": "HowToStep", text: "Add tomatoes." },
          ],
        })
      )}
    </head></html>
  `;
  const blocks = extractJsonLdBlocks(html);
  const node = findRecipeNode(blocks);
  assert.ok(node);
  const draft = normalizeRecipeNode(node!);
  assert.equal(draft.title, "Tomato Soup");
  assert.deepEqual(draft.ingredients, ["2 cups tomatoes", "1 tsp salt"]);
  assert.deepEqual(draft.steps, ["Boil water.", "Add tomatoes."]);
  assert.equal(draft.servings, "4 servings");
  assert.equal(draft.prepTimeMinutes, 20);
  assert.equal(draft.cookTimeMinutes, 40);
  assert.equal(draft.totalTimeMinutes, 60);
  assert.equal(hasUsableContent(draft), true);
});

test("end-to-end: a Recipe with only totalTime normalizes prep/cook as null", () => {
  const html = `
    <html><head>
      ${scriptTag(
        JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Recipe",
          name: "Tomato Soup",
          totalTime: "PT2H",
          recipeIngredient: ["2 cups tomatoes"],
        })
      )}
    </head></html>
  `;
  const blocks = extractJsonLdBlocks(html);
  const node = findRecipeNode(blocks);
  assert.ok(node);
  const draft = normalizeRecipeNode(node!);
  assert.equal(draft.prepTimeMinutes, null);
  assert.equal(draft.cookTimeMinutes, null);
  assert.equal(draft.totalTimeMinutes, 120);
});
