"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

type Status = "checking" | "not-connected" | "connecting" | "finishing" | "connected" | "error";

type Board = { id: string; name: string };
type Pin = { id: string; title: string | null; imageUrl: string | null; link: string | null };
type PinsStatus = "idle" | "loading" | "loaded" | "loading-more" | "insufficient-scope" | "error";

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

  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinsStatus, setPinsStatus] = useState<PinsStatus>("idle");
  const [pinsErrorMessage, setPinsErrorMessage] = useState<string | null>(null);
  const [nextBookmark, setNextBookmark] = useState<string | null>(null);

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

  async function loadPins(board: Board, bookmark: string | null, mode: "loading" | "loading-more") {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      setPinsStatus("error");
      setPinsErrorMessage("Your session has expired. Sign in again and retry.");
      return;
    }

    setPinsStatus(mode);
    setPinsErrorMessage(null);

    try {
      const url = new URL(`/api/pinterest/boards/${board.id}/pins`, window.location.origin);
      if (bookmark) {
        url.searchParams.set("bookmark", bookmark);
      }

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json().catch(() => null);

      if (response.ok && body) {
        setPins((current) => (mode === "loading-more" ? [...current, ...(body.pins ?? [])] : (body.pins ?? [])));
        setNextBookmark(body.nextBookmark ?? null);
        setPinsStatus("loaded");
        return;
      }

      if (body?.reason === "insufficient_scope") {
        setPinsStatus("insufficient-scope");
        return;
      }

      setPinsStatus("error");
      setPinsErrorMessage(typeof body?.error === "string" ? body.error : "Couldn't load this board's Pins.");
    } catch {
      setPinsStatus("error");
      setPinsErrorMessage("Couldn't reach the server. Check your connection and try again.");
    }
  }

  function handleSelectBoard(board: Board) {
    setSelectedBoard(board);
    setPins([]);
    setNextBookmark(null);
    loadPins(board, null, "loading");
  }

  function handleBackToBoards() {
    setSelectedBoard(null);
    setPins([]);
    setNextBookmark(null);
    setPinsStatus("idle");
    setPinsErrorMessage(null);
  }

  function handleLoadMorePins() {
    if (selectedBoard && nextBookmark) {
      loadPins(selectedBoard, nextBookmark, "loading-more");
    }
  }

  // Hands the Pin's destination URL to the existing recipe URL importer —
  // that route does the actual fetch/parsing and still lands the user on the
  // normal draft/review form; nothing here saves a recipe.
  function handleImportPin(pin: Pin) {
    if (!pin.link) {
      return;
    }
    router.push(`/recipes/import-url?url=${encodeURIComponent(pin.link)}`);
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

      {status === "connected" && !selectedBoard && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted-foreground">Connected. {boards.length} board(s):</p>
          {boards.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
              No boards found on this Pinterest account.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {boards.map((board) => (
                <li key={board.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectBoard(board)}
                    className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-left text-sm text-foreground transition hover:border-primary/40"
                  >
                    {board.name}
                    <span aria-hidden="true" className="text-primary">
                      &rsaquo;
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={handleConnectClick}
            className="self-start rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            Reconnect Pinterest
          </button>
        </div>
      )}

      {status === "connected" && selectedBoard && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBackToBoards}
              className="shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
            >
              &lsaquo; Boards
            </button>
            <h2 className="text-sm font-semibold text-foreground">{selectedBoard.name}</h2>
          </div>

          {(pinsStatus === "loading") && (
            <p className="p-1 text-sm text-muted-foreground">Loading Pins...</p>
          )}

          {pinsStatus === "insufficient-scope" && (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted px-3.5 py-2.5">
              <p className="text-sm text-foreground">
                This Pinterest connection was made before Pin access was added. Reconnect to grant access to Pins.
              </p>
              <button
                type="button"
                onClick={handleConnectClick}
                className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
              >
                Reconnect Pinterest
              </button>
            </div>
          )}

          {pinsStatus === "error" && (
            <div className="flex flex-col gap-2">
              <p className="rounded-xl border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                {pinsErrorMessage}
              </p>
              <button
                type="button"
                onClick={() => loadPins(selectedBoard, null, "loading")}
                className="min-h-11 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground transition hover:bg-primary/90 active:bg-primary/80"
              >
                Try Again
              </button>
            </div>
          )}

          {(pinsStatus === "loaded" || pinsStatus === "loading-more") && (
            <>
              {pins.length === 0 ? (
                <p className="rounded-xl border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
                  No Pins found on this board.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {pins.map((pin) => {
                    const thumbnail = pin.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Pinterest's own CDN, same reasoning as RecipeCard's arbitrary third-party images
                      <img src={pin.imageUrl} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center bg-surface text-xs text-muted-foreground">
                        No image
                      </div>
                    );

                    if (!pin.link) {
                      return (
                        <div
                          key={pin.id}
                          className="flex flex-col gap-1 overflow-hidden rounded-xl border border-border bg-surface-muted opacity-60"
                        >
                          {thumbnail}
                          <div className="flex items-center justify-between gap-1 px-2 pb-2">
                            {pin.title && <p className="text-xs text-foreground">{pin.title}</p>}
                            <span className="shrink-0 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              No link
                            </span>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={pin.id}
                        type="button"
                        onClick={() => handleImportPin(pin)}
                        className="flex flex-col gap-1 overflow-hidden rounded-xl border border-border bg-surface-muted text-left transition hover:border-primary/40 active:bg-surface"
                      >
                        {thumbnail}
                        <p className="px-2 pb-2 text-xs text-foreground">{pin.title ?? "Import this Pin"}</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {nextBookmark && (
                <button
                  type="button"
                  onClick={handleLoadMorePins}
                  disabled={pinsStatus === "loading-more"}
                  className="min-h-11 rounded-xl border border-border bg-surface-muted px-4 text-sm font-medium text-foreground transition hover:border-primary/40 disabled:opacity-50"
                >
                  {pinsStatus === "loading-more" ? "Loading..." : "Load more"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
