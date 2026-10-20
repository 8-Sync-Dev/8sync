"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Card } from "@/lib/lanes";
import { cardMoves, type Move } from "@/lib/now";
import type { ProjectBoard } from "@/lib/server/board";
import type { Hq } from "./use-hq";

/** Each poll spawns `8sync ccc auto board --json` once per live project (a few ms each): same pace as the office, so a card move shows within seconds. */
const POLL_MS = 4_000;

/**
 * One board poll for the whole HQ (Văn phòng and Board share it). `moves` holds the cards whose lane
 * changed in the latest poll, keyed "<root>#<id>", so a view can mark exactly what moved, once.
 */
export function useBoards(api: Hq["api"]) {
  const [boards, setBoards] = useState<ProjectBoard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moves, setMoves] = useState<Map<string, Move>>(() => new Map());
  const [nonce, setNonce] = useState(0);
  /** When the latest poll answered (ms): the clock relative times are measured against. */
  const [at, setAt] = useState(0);
  const prev = useRef<Map<string, ProjectBoard>>(new Map());

  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try {
          const r = await api<{ boards: ProjectBoard[] }>("/api/board", { signal: ac.signal });
          const next = new Map<string, Move>();
          for (const b of r.boards) {
            for (const [id, m] of cardMoves(prev.current.get(b.root)?.board ?? null, b.board)) next.set(`${b.root}#${id}`, m);
          }
          prev.current = new Map(r.boards.map((b) => [b.root, b]));
          setBoards(r.boards);
          setMoves(next);
          setAt(Date.now());
          setError(null);
        } catch (e) {
          if (!ac.signal.aborted) setError((e as Error).message);
        }
      }
      if (!ac.signal.aborted) timer = setTimeout(poll, POLL_MS);
    };
    const onShow = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onShow);
    void poll();
    return () => {
      ac.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [api, nonce]);

  /** `auto prio` on one card, then a fresh poll so the lane re-sorts at once. Throws the CLI's error. */
  const setPrio = useCallback(
    async (root: string, id: number, prio: number | null) => {
      await api("/api/board/prio", { method: "POST", body: { root, id, prio } });
      setNonce((n) => n + 1);
    },
    [api],
  );
  /** The card's force button, then a fresh poll. Throws the CLI's error. */
  const force = useCallback(
    async (root: string, c: Pick<Card, "id" | "lane">) => {
      await forceCall(api, root, c);
      setNonce((n) => n + 1);
    },
    [api],
  );

  return { boards, error, moves, at, setPrio, force, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export type BoardsState = ReturnType<typeof useBoards>;

/**
 * The card's force button (card-sheet forceKind) as one API call: a Blocked card is unblocked
 * (POST /api/board/unblock: Backlog + the owner's note, then P0), a waiting one goes to P0.
 */
export function forceCall(api: Hq["api"], root: string, c: Pick<Card, "id" | "lane">): Promise<unknown> {
  return c.lane === "blocked" ? api("/api/board/unblock", { method: "POST", body: { root, id: c.id } }) : api("/api/board/prio", { method: "POST", body: { root, id: c.id, prio: 0 } });
}
