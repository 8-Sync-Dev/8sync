import type { DatabaseSync } from "node:sqlite";
import { checkAuth, cookieValue, getToken, PUB_COOKIE, readPublic, viaTunnel, type AuthOptions } from "./auth";
import { getDb } from "./db";
import { ingest } from "./ingest";
import { touchLease } from "./lease-touch";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export const bad = (error: string, status = 400) => json({ error }, status);

/**
 * Auth gate + journal ingest, run at the top of every API handler.
 * Returns either a ready error Response or the DB handle.
 */
export function open(req: Request, opts?: AuthOptions): { db: DatabaseSync } | { res: Response } {
  const denied = checkAuth(
    {
      method: req.method,
      host: req.headers.get("host"),
      origin: req.headers.get("origin"),
      token: req.headers.get("x-hq-token"),
      cookie: cookieValue(req.headers.get("cookie"), PUB_COOKIE),
      tunnel: viaTunnel(req.headers),
    },
    getToken(),
    opts,
    readPublic(),
  );
  if (denied) return { res: bad(denied.error, denied.status) };
  // The owner acted in HQ: renew a "Lease liên tục" lease (≤ 1 per 5 min; lib/server/lease-touch.ts).
  touchLease({ method: req.method, origin: req.headers.get("origin") });
  const db = getDb();
  try {
    ingest(db);
  } catch (e) {
    console.error("[hq] ingest failed", e);
  }
  return { db };
}

const MAX_BODY = 64 * 1024;

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function afterParam(url: URL, key = "after"): number {
  const n = Number(url.searchParams.get(key) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `limit` query: absent -> `def`; a non-negative integer is clamped to 1..max; anything else is null (caller answers 400). */
export function limitParam(url: URL, def = 500, max = 500): number | null {
  const raw = url.searchParams.get("limit");
  if (raw === null) return def;
  if (!/^\d{1,9}$/.test(raw)) return null;
  return Math.min(Math.max(Number(raw), 1), max);
}
