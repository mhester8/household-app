"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

// Keeps "This Week" reachable in one tap from every recipes screen (library,
// detail, create, import, edit) instead of only the library page. Omitted on
// /recipes/this-week itself since you're already there. Owns the count +
// Realtime subscription that used to live only on the library page.
export default function RecipesLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [thisWeekCount, setThisWeekCount] = useState(0);
  const showLink = pathname !== "/recipes/this-week";

  useEffect(() => {
    async function loadThisWeekCount() {
      const { count } = await supabase
        .from("this_week_recipes")
        .select("id", { count: "exact", head: true });
      setThisWeekCount(count ?? 0);
    }

    loadThisWeekCount();

    const channel = supabase
      .channel("recipes_layout_this_week_count")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "this_week_recipes" },
        () => {
          setThisWeekCount((current) => current + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "this_week_recipes" },
        () => {
          setThisWeekCount((current) => Math.max(0, current - 1));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      {showLink && (
        <div className="flex justify-end">
          <Link
            href="/recipes/this-week"
            className="shrink-0 rounded-full bg-surface-muted px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-border"
          >
            This Week ({thisWeekCount})
          </Link>
        </div>
      )}
      {children}
    </div>
  );
}
