"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  async function handleSignIn(event: React.FormEvent) {
    event.preventDefault();
    setAuthError(null);
    setIsSigningIn(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setAuthError(error.message);
    } else {
      setPassword("");
    }
    setIsSigningIn(false);
  }

  return (
    <>
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Sign In
      </h1>

      {authError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-400">
          {authError}
        </p>
      )}

      <form onSubmit={handleSignIn} className="flex flex-col gap-3">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          aria-label="Email"
          autoComplete="email"
          required
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-black focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          aria-label="Password"
          autoComplete="current-password"
          required
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-base text-black focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={isSigningIn}
          className="rounded-md bg-black px-4 py-2 text-base font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {isSigningIn ? "Signing in..." : "Log In"}
        </button>
      </form>
    </>
  );
}
