"use client";

import { useEffect, useState } from "react";
import type { Brief } from "@/lib/server/brief";
import type { Room } from "@/lib/server/office";
import type { Hq } from "../use-hq";

/**
 * GET /api/brief?room=<id> for one bot. No loop of its own: it rides the office poll (use-office), and
 * reads again only when the room's office row moves (status, step, open question, last activity).
 */
export function useBotBrief(api: Hq["api"], r: Pick<Room, "name" | "session_id" | "status" | "doing" | "waiting" | "last_active">): Brief | null {
  const id = r.session_id ?? r.name;
  const [brief, setBrief] = useState<{ id: string; brief: Brief } | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    api<{ brief: Brief }>(`/api/brief?room=${encodeURIComponent(id)}`, { signal: ac.signal })
      .then((d) => setBrief({ id, brief: d.brief }))
      .catch(() => {});
    return () => ac.abort();
  }, [api, id, r.status, r.doing, r.waiting, r.last_active]);
  return brief?.id === id ? brief.brief : null;
}
