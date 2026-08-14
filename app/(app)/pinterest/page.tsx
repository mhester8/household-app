"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

type Status = "checking" | "not-connected" | "connecting" | "finishing" | "connected" | "error";

type Board = { id: string; name: string };

const PINTEREST_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Pinterest connection was cancelled.",
  invalid_state: "That connection attempt couldn't be verified. Try again.",
  exchange_failed: "Pinterest couldn't complete the connection. Try again.",
  misconfigured: "Server is misconfigured.",
};

export default function PinterestPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [boards, setBoards] = useState<Board[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hasRunRef = useRef(false);

  async function loadBoards() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setStatus("error");
      setErrorMessage("Your session has expired. Sign in again and retry.");
      return;
    }

    try {
      const response = await fetch("/api/pinterest/boards", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json().catch(() => null);

      if (response.ok && body) {
        setBoards(body.boards ?? []);
        setStatus("connected");
        return;
      }

      if (body?.reason === "not_connected") {
        setStatus("not-connected");
        return;
      }

      setStatus("error");
      setErrorMessage(typeof body?.error === "string" ? body.error : "Couldn't load your Pinterest boards.");
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  async function finishConnectThenLoadBoards() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setStatus("error");
      setErrorMessage("Your session has expired. Sign in again and retry.");
      return;
    }

    try {
      const response = await fetch("/api/pinterest/finish-connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setStatus("error");
        setErrorMessage(typeof body?.error === "string" ? body.error : "Couldn't finish connecting to Pinterest.");
        return;
      }

      await loadBoards();
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  useEffect(() => {
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;

    // Runs as a separate async function (rather than setting state directly
    // in the effect body) so the initial-load branching doesn't trigger
    // cascading synchronous renders.
    async function initialize() {
      const params = new URLSearchParams(window.location.search);
      const pinterestError = params.get("pinterest_error");
      const connected = params.get("connected");

      if (pinterestError) {
        router.replace("/pinterest");
        setStatus("error");
        setErrorMessage(PINTEREST_ERROR_MESSAGES[pinterestError] ?? "Couldn't connect to Pinterest.");
        return;
      }

      if (connected === "1") {
        router.replace("/pinterest");
        setStatus("finishing");
        await finishConnectThenLoadBoards();
        return;
      }

      await loadBoards();
    }

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnectClick() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setStatus("error");
      setErrorMessage("Your session has expired. Sign in again and retry.");
      return;
    }

    setStatus("connecting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/pinterest/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.url) {
        setStatus("error");
        setErrorMessage(typeof body?.error === "string" ? body.error : "Couldn't start the Pinterest connection.");
        return;
      }

      window.location.href = body.url;
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:gap-4">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
        >
          &lsaquo; Home
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-primary">Pinterest</h1>
      </div>

      {errorMessage && (
        <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {errorMessage}
        </p>
      )}

      {(status === "checking" || status === "finishing") && (
        <p className="p-1 text-sm text-muted-foreground">
          {status === "finishing" ? "Finishing connection..." : "Checking connection..."}
        </p>
      )}

      {status === "not-connected" && (
        <button
          type="button"
          onClick={handleConnectClick}
          className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
        >
          Connect Pinterest
        </button>
      )}

      {status === "connecting" && (
        <p className="p-1 text-sm text-muted-foreground">Redirecting to Pinterest...</p>
      )}

      {status === "error" && (
        <button
          type="button"
          onClick={handleConnectClick}
          className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
        >
          Connect Pinterest
        </button>
      )}

      {status === "connected" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">Connected. {boards.length} board(s):</p>
          {boards.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
              No boards found on this Pinterest account.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {boards.map((board) => (
                <li
                  key={board.id}
                  className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground"
                >
                  {board.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
