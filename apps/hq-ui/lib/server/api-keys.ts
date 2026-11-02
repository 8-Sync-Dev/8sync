// API keys members use to call models through HQ (docs/hq-quota-keys.md §3). Minting and storage follow
// content-post-agency's omp-keys (apps/content-ai/src/services/omp-keys/keys.ts): `8sk_` + 32 random bytes,
// only the sha256 and the first 12 characters are stored, the key is shown once, Claude is never granted. Unlike
// there, HQ writes no omp `--clients` file: HQ itself checks the key on /api/omp/v1 so every member call passes
// through it and is logged. Tested in tests/api-keys.test.ts.
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isLocalHost } from "../hosts";
import { tx } from "./db";
import { scrub } from "./omp-accounts";

/** Claude under any owner (anthropic, or a reseller such as google-antigravity/claude-*): subscription tokens are for Claude Code / claude.ai only. */
export const DENY_RE = /claude|anthropic|opus|sonnet|haiku|fable/i;
/** `<owner>/<model>`; the model may contain "/" (`nvidia/z-ai/glm-5.1`). Safe characters only. */
const GRANT_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:+@/-]*$/i;
const TOKEN_RE = /^8sk_[A-Za-z0-9_-]{43}$/;
export const KEY_ID_RE = /^k[0-9a-f]{10}$/;
/** Enough for a team, stops a runaway loop of key creation. */
export const MAX_ACTIVE_KEYS = 50;
/** Member calls older than this are deleted. */
export const RETENTION_MS = 90 * 24 * 3600_000;
export const ROOT_MAX = 200;
export const SUMMARY_MAX = 200;

export const isGrantable = (id: string): boolean => GRANT_RE.test(id) && !DENY_RE.test(id);

/** A label or a root is one line of text: no control characters at all (not even tab or newline). */
export const isOneLine = (s: string): boolean => !/[\x00-\x1f\x7f-\x9f]/.test(s);

export type ApiKey = {
  id: string;
  label: string;
  /** First 12 characters: enough to recognise, not to use. */
  prefix: string;
  models: string[];
  created_at: number;
  last_used_at: number | null;
};

type KeyRow = { id: string; label: string; token_prefix: string; token_sha256: string; models_json: string; created_at: number; revoked_at: number | null; last_used_at: number | null };

function modelsOf(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

const toKey = (r: KeyRow): ApiKey => ({ id: r.id, label: r.label, prefix: r.token_prefix, models: modelsOf(r.models_json), created_at: r.created_at, last_used_at: r.last_used_at });
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function listKeys(db: DatabaseSync): ApiKey[] {
  return (db.prepare("SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at, id").all() as KeyRow[]).map(toKey);
}

/** A new key; `token` is returned only here. Models must already be checked against the catalog. */
export function createKey(db: DatabaseSync, label: string, models: string[], now = Date.now()): { key: ApiKey; token: string } {
  const token = `8sk_${randomBytes(32).toString("base64url")}`;
  const row: KeyRow = {
    id: `k${randomBytes(5).toString("hex")}`,
    label,
    token_prefix: token.slice(0, 12),
    token_sha256: sha256(token),
    models_json: JSON.stringify(models.filter(isGrantable)),
    created_at: now,
    revoked_at: null,
    last_used_at: null,
  };
  db.prepare(
    "INSERT INTO api_keys (id, label, token_prefix, token_sha256, models_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.label, row.token_prefix, row.token_sha256, row.models_json, row.created_at);
  return { key: toKey(row), token };
}

/** false when the id is unknown or already revoked. */
export function revokeKey(db: DatabaseSync, id: string, now = Date.now()): boolean {
  return Number(db.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, id).changes) > 0;
}

/** The active key behind `Authorization: Bearer 8sk_…`, or null. Looked up by hash: no comparison on the raw key. */
export function keyForBearer(db: DatabaseSync, authorization: string | null): ApiKey | null {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  if (!m || !TOKEN_RE.test(m[1])) return null;
  const row = db.prepare("SELECT * FROM api_keys WHERE token_sha256 = ? AND revoked_at IS NULL").get(sha256(m[1])) as KeyRow | undefined;
  return row ? toKey(row) : null;
}

const LOOPBACK_IP = /^(?:127(?:\.\d{1,3}){3}|::1|::ffff:127(?:\.\d{1,3}){3})$/i;

/** Client addresses forwarding headers name (`x-forwarded-for`, `x-real-ip`, `forwarded: for=`), as sent. */
function forwardedAddrs(h: { get(name: string): string | null }): string[] {
  const out = [h.get("x-forwarded-for"), h.get("x-real-ip")].flatMap((v) => (v ? v.split(",") : []));
  for (const m of (h.get("forwarded") ?? "").matchAll(/for="?\[?([^\]";,\s]+)/gi)) out.push(m[1]);
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * Where a proxy call comes from. "owner": loopback Host, no Cloudflare edge header, and every forwarded address
 * is loopback (Next.js itself sets `x-forwarded-for` to the socket's address) — a process on this machine; not
 * logged. "tunnel" (the `--public` quick tunnel) and "proxy" (VPS gate or any forwarder naming another address)
 * are member calls. null: a Host HQ does not serve (DNS rebinding, lookalike).
 */
export function callSource(h: { get(name: string): string | null }, publicHost: string | null): "owner" | "tunnel" | "proxy" | null {
  const host = h.get("host")?.toLowerCase() ?? null;
  if (!isLocalHost(host) && !(publicHost && host === publicHost)) return null;
  if (h.get("cf-connecting-ip") !== null || h.get("cf-ray") !== null) return "tunnel";
  if (forwardedAddrs(h).some((a) => !LOOPBACK_IP.test(a))) return "proxy";
  return isLocalHost(host) ? "owner" : "proxy";
}

type Part = { type?: unknown; text?: unknown; content?: unknown };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((p: Part) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : typeof p?.content === "string" ? p.content : ""))
      .filter(Boolean)
      .join(" ");
  return "";
}

/**
 * What the member asked, short: the last user message of a chat completion, or the `input` of a responses call;
 * whitespace collapsed, token-like strings hidden, ≤ SUMMARY_MAX characters. Never the whole prompt.
 */
export function summarize(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  let text = "";
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: unknown; content?: unknown }[]) : null;
  const input = body.input;
  if (messages) {
    const last = [...messages].reverse().find((m) => m?.role === "user");
    text = textOf(last?.content);
  } else if (typeof input === "string") text = input;
  else if (Array.isArray(input)) {
    const last = [...(input as { role?: unknown; content?: unknown }[])].reverse().find((m) => m?.role === "user" || typeof m === "string");
    text = typeof last === "string" ? last : textOf(last?.content);
  }
  const s = scrub(text.replace(/\s+/g, " ").trim());
  if (!s) return null;
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

export type CallRecord = {
  key_id: string;
  at: number;
  root: string;
  route: string;
  model: string | null;
  summary: string | null;
  status: number;
  ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  source: "tunnel" | "proxy";
};

/** Log one member call, touch the key's last use, drop calls past retention. */
export function recordCall(db: DatabaseSync, c: CallRecord): void {
  tx(db, () => {
    db.prepare(
      "INSERT INTO api_key_calls (key_id, at, root, route, model, summary, status, ms, input_tokens, output_tokens, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(c.key_id, c.at, c.root, c.route, c.model, c.summary, c.status, c.ms, c.input_tokens, c.output_tokens, c.source);
    db.prepare("UPDATE api_keys SET last_used_at = MAX(COALESCE(last_used_at, 0), ?) WHERE id = ?").run(c.at, c.key_id);
    db.prepare("DELETE FROM api_key_calls WHERE at < ?").run(c.at - RETENTION_MS);
  });
}

export type CallView = CallRecord & { id: number; label: string; project: string };
export type KeyStats = { key_id: string; calls: number; ok: number; input_tokens: number; output_tokens: number; projects: number; last_at: number | null };

/** Last segment of a root as the member sent it (`C:\work\shop` or `/home/a/shop` → `shop`). */
export function projectName(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

/** The newest member calls (any key, revoked ones too) and per-key totals since `since`. */
export function callLog(db: DatabaseSync, since: number, limit = 100): { calls: CallView[]; stats: KeyStats[] } {
  const calls = (
    db
      .prepare(
        "SELECT c.*, COALESCE(k.label, c.key_id) AS label FROM api_key_calls c LEFT JOIN api_keys k ON k.id = c.key_id ORDER BY c.at DESC, c.id DESC LIMIT ?",
      )
      .all(limit) as (Omit<CallView, "project">)[]
  ).map((c) => ({ ...c, project: projectName(c.root) }));
  const stats = db
    .prepare(
      `SELECT key_id, COUNT(*) AS calls, SUM(status BETWEEN 200 AND 299) AS ok, COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens, COUNT(DISTINCT root) AS projects, MAX(at) AS last_at
       FROM api_key_calls WHERE at >= ? GROUP BY key_id`,
    )
    .all(since) as KeyStats[];
  return { calls, stats };
}
