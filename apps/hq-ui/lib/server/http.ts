import type { DatabaseSync } from "node:sqlite";
import { checkAuth, cookieValue, getToken, isDenied, pageAccess, PUB_COOKIE, readPublic, sideOf, viaTunnel, type Access, type AuthOptions, type PageAccess } from "./auth";
import { getDb } from "./db";
import { ingest } from "./ingest";
import { GUEST_COOKIE } from "./invites";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

export const bad = (error: string, status = 400) => json({ error }, status);

/**
 * Auth gate + journal ingest, run at the top of every API handler. Returns either a ready error
 * Response or the DB handle and who is calling (`access.role`: owner, editor, viewer). The route's
 * pathname picks the least role (lib/access.ts): a route nobody opened to guests is owner only.
 */
export function open(req: Request, opts?: AuthOptions): { db: DatabaseSync; access: Access } | { res: Response } {
  const cookies = req.headers.get("cookie");
  const access = checkAuth(
    {
      method: req.method,
      host: req.headers.get("host"),
      origin: req.headers.get("origin"),
      token: req.headers.get("x-hq-token"),
      cookie: cookieValue(cookies, PUB_COOKIE),
      guest: cookieValue(cookies, GUEST_COOKIE),
      path: new URL(req.url).pathname,
      tunnel: viaTunnel(req.headers),
    },
    getToken(),
    opts,
    readPublic(),
  );
  if (isDenied(access)) return { res: bad(access.error, access.status) };
  const db = getDb();
  try {
    ingest(db);
  } catch (e) {
    console.error("[hq] ingest failed", e);
  }
  return { db, access };
}

/** Who a browser request is from its cookies alone (page render, signed media URLs): see auth.ts pageAccess. */
export function cookieAccess(h: { get(name: string): string | null }): PageAccess {
  const cookies = h.get("cookie");
  return pageAccess({ host: h.get("host"), cookie: cookieValue(cookies, PUB_COOKIE), guest: cookieValue(cookies, GUEST_COOKIE), tunnel: viaTunnel(h) }, readPublic());
}

/** 403 unless the request is from this machine's side (loopback, not the `--public` tunnel); like /api/shell. */
export function localOnly(req: Request, error = "Chỉ tạo / thu hồi key từ HQ trên máy chủ (không qua link --public)."): Response | null {
  const side = sideOf({ host: req.headers.get("host"), cookie: cookieValue(req.headers.get("cookie"), PUB_COOKIE), tunnel: viaTunnel(req.headers) }, readPublic());
  return side === "local" ? null : bad(error, 403);
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
