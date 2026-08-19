"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import SignInForm from "@/components/SignInForm";
import { LeafIcon } from "@/components/LeafIcon";
import { PullToRefreshProvider } from "@/lib/PullToRefreshContext";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authCheckError, setAuthCheckError] = useState<string | null>(null);

  // Only calls setState from the async callbacks below, never synchronously
  // in the caller — so this is safe to invoke directly from the mount effect
  // without triggering a redundant render (isAuthLoading/authCheckError
  // already start at their "checking" values on mount; handleRetry resets
  // them itself before calling this again).
  function checkSession() {
    supabase.auth
      .getSession()
      .then(({ data: { session: currentSession } }) => {
        setSession(currentSession);
      })
      .catch((err) => {
        console.error("Failed to check auth session:", err);
        setAuthCheckError("Couldn't check your sign-in status. Check your connection and try again.");
      })
      .finally(() => {
        setIsAuthLoading(false);
      });
  }

  function handleRetry() {
    setIsAuthLoading(true);
    setAuthCheckError(null);
    checkSession();
  }

  // Check for an existing session on load, then keep it in sync (sign-in,
  // sign-out, and silent token refresh) via Supabase's auth state listener.
  useEffect(() => {
    checkSession();

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
          <Link href="/" className="flex items-center gap-1 text-muted-foreground">
            <LeafIcon className="h-3 w-3" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em]">
              Hester House
            </p>
          </Link>
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
          ) : authCheckError ? (
            <div className="flex flex-col gap-3">
              <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                {authCheckError}
              </p>
              <button
                type="button"
                onClick={handleRetry}
                className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
              >
                Try Again
              </button>
            </div>
          ) : !session ? (
            <SignInForm />
          ) : (
            <PullToRefreshProvider>{children}</PullToRefreshProvider>
          )}
        </div>
      </main>
    </div>
  );
}
