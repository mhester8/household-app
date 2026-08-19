import type { RecipeOriginal } from "@/lib/recipes";
import { detailTimeSegments } from "@/lib/recipeTime";

const SOURCE_TYPE_LABEL: Record<RecipeOriginal["source_type"], string> = {
  url: "Imported from a website",
  photo: "Imported from a photo",
  pinterest: "Imported from Pinterest",
};

// Read-only display of a recipe_originals row — what was accepted at the
// first import-review save, before any later household editing. Never
// offers an edit affordance; there is nothing here to save back.
export function RecipeOriginalView({ original }: { original: RecipeOriginal }) {
  const timeSegments = detailTimeSegments({
    prepTimeMinutes: original.prep_time_minutes,
    cookTimeMinutes: original.cook_time_minutes,
    totalTimeMinutes: original.total_time_minutes,
  });

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-surface-muted p-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Original import &middot; read-only
        </span>
        <h3 className="break-words text-base font-bold text-foreground">{original.title}</h3>
      </div>

      <p className="text-xs text-muted-foreground">{SOURCE_TYPE_LABEL[original.source_type]}</p>

      {original.source_url && (
        <a
          href={original.source_url}
          target="_blank"
          rel="noreferrer noopener"
          className="break-words text-sm text-primary underline underline-offset-2"
        >
          {original.source_url}
        </a>
      )}

      {original.pinterest_pin_url && (
        <a
          href={original.pinterest_pin_url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-xs text-muted-foreground underline underline-offset-2"
        >
          Found via Pinterest
        </a>
      )}

      {original.servings && (
        <p className="text-sm text-muted-foreground">Servings: {original.servings}</p>
      )}

      {timeSegments.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {timeSegments.map((segment) => (
            <span key={segment.label}>
              {segment.label}: {segment.text}
            </span>
          ))}
        </p>
      )}

      {original.ingredients.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold text-foreground">Ingredients</h4>
          <ul className="flex flex-col gap-1 rounded-xl border border-border bg-surface px-3.5 py-2.5">
            {original.ingredients.map((text, index) => (
              <li key={index} className="break-words text-[15px] text-foreground">
                {text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {original.steps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold text-foreground">Steps</h4>
          <ol className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5">
            {original.steps.map((text, index) => (
              <li key={index} className="flex gap-2 break-words text-[15px] text-foreground">
                <span className="shrink-0 font-semibold text-muted-foreground">{index + 1}.</span>
                <span className="whitespace-pre-wrap">{text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
