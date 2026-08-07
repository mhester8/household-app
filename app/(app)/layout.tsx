"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import SignInForm from "@/components/SignInForm";
import { LeafIcon } from "@/components/LeafIcon";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

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

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-page px-3 py-3 sm:px-6 sm:py-8">
      <main className="flex w-full max-w-md flex-col gap-1.5 sm:gap-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <LeafIcon className="h-3 w-3" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em]">
              Hester House
            </p>
          </div>
          {session && (
            <button
              type="button"
              onClick={handleSignOut}
              className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
            >
              Sign Out
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-xl bg-surface p-2 sm:gap-4 sm:rounded-3xl sm:border sm:border-border sm:p-6 sm:shadow-sm">
          {isAuthLoading ? (
            <p className="p-1 text-sm text-muted-foreground">Checking session...</p>
          ) : !session ? (
            <SignInForm />
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}
