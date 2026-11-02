// Every account omp is signed into and its limit windows, for the "Hạn mức" tab (docs/hq-quota-keys.md §3).
// Read-only from omp's own agent.db: `auth_credentials` (one row per login; the `data` column holds the secrets
// and is never selected) and `usage_history` (every usage report omp fetched, the same reports the gateway's
// `/v1/usage` serves). Tested in tests/omp-accounts.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type OmpLimit = {
  id: string;
  label: string;
  /** "5 Hour", "Weekly", … as omp names the window. */
  window: string | null;
  /** 0..1; null when the provider gave no fraction. */
  used_fraction: number | null;
  /** omp's status: "ok" | "warning" | "exhausted" | … */
  status: string | null;
  /** Unix ms. */
  resets_at: number | null;
  /** When omp read this number (unix ms). */
  read_at: number;
};

export type OmpAccount = {
  /** omp's credential id. */
  id: number;
  provider: string;
  kind: string;
  /** Masked email and org name, else null (API keys). */
  who: string | null;
  /** Why omp stopped using this login (refresh failed, …), clipped; null when it works. */
  broken: string | null;
  updated_at: number | null;
  limits: OmpLimit[];
};

export type OmpAccounts = { available: boolean; at: number; accounts: OmpAccount[] };

/** omp's agent folder: `PI_CODING_AGENT_DIR` (omp's own override), else `~/.omp/agent`. */
export function ompAgentDir(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  const v = env.PI_CODING_AGENT_DIR?.trim();
  return v && path.isAbsolute(v) ? v : path.join(home, ".omp", "agent");
}

/** `email:a@b|org:x` → { email: "a@b", org: "x" }. */
export function identityParts(s: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (s ?? "").split("|")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/** `abcdef@gmail.com` → `abcd…@gmail.com`: enough for the owner to tell his accounts apart, never a full address. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  const local = at > 0 ? email.slice(0, at) : email;
  return `${local.slice(0, Math.min(4, Math.max(1, local.length - 1)))}…${at > 0 ? email.slice(at) : ""}`;
}

/** Long token-like runs (keys, JWTs, hex hashes) out of free text before it leaves the server. */
export function scrub(text: string): string {
  return text
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [ẩn]")
    .replace(/\b(?:sk-|8sk_|gh[pousr]_|xox[abp]-|AKIA|AIza|eyJ)[A-Za-z0-9_\-.]{8,}/g, "[ẩn]")
    .replace(/[A-Za-z0-9_\-+=]{32,}/g, "[ẩn]");
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** A broken login's cause is shown on one line. */
const CAUSE_MAX = 140;
/** A window last read this long before the account's newest read is one omp no longer reports. */
const RETIRED_MS = 24 * 3600_000;

type CredRow = { id: number; provider: string; credential_type: string; identity_key: string | null; disabled_cause: string | null; updated_at: number | null };
type SeriesRow = {
  provider: string;
  account_key: string;
  email: string | null;
  limit_id: string;
  label: string;
  window_label: string | null;
  used_fraction: number | null;
  status: string | null;
  resets_at: number | null;
  recorded_at: number;
};

/** Seconds (older rows) or ms → ms. */
const ms = (v: number | null) => (v == null ? null : v < 1e12 ? v * 1000 : v);

/**
 * Pure join of credentials and the newest usage row per series (exported for tests). A series belongs to a login
 * when provider + email (+ org when both carry one) match; a login without email (Cursor `account:`, API keys)
 * takes the freshest unclaimed series of its provider and kind when it is the only such login. Several series on
 * one login merge per limit id, newest wins.
 */
export function joinAccounts(creds: CredRow[], rows: SeriesRow[]): OmpAccount[] {
  const series = new Map<string, { provider: string; key: string; parts: Record<string, string>; email: string | null; rows: SeriesRow[]; last: number }>();
  for (const r of rows) {
    const id = `${r.provider}\u0000${r.account_key}`;
    let s = series.get(id);
    if (!s) {
      s = { provider: r.provider, key: r.account_key, parts: identityParts(r.account_key), email: r.email?.toLowerCase() ?? null, rows: [], last: 0 };
      series.set(id, s);
    }
    s.rows.push(r);
    s.last = Math.max(s.last, r.recorded_at);
  }
  const claimed = new Set<string>();
  const owned = new Map<number, string[]>();
  for (const c of creds) {
    const id = identityParts(c.identity_key);
    const email = id.email?.toLowerCase();
    if (!email) continue;
    const mine = [...series.entries()].filter(
      ([, s]) => s.provider === c.provider && (s.email ?? s.parts.email?.toLowerCase()) === email && (!id.org || !s.parts.org || id.org === s.parts.org),
    );
    owned.set(c.id, mine.map(([k]) => k));
    for (const [k] of mine) claimed.add(k);
  }
  for (const c of creds) {
    if (owned.has(c.id)) continue;
    const peers = creds.filter((o) => o.provider === c.provider && o.credential_type === c.credential_type && !owned.has(o.id));
    if (peers.length !== 1) continue;
    const free = [...series.entries()]
      .filter(([k, s]) => !claimed.has(k) && s.provider === c.provider && s.key.startsWith(`${c.credential_type}|`))
      .sort((a, b) => b[1].last - a[1].last);
    if (free[0]) {
      owned.set(c.id, [free[0][0]]);
      claimed.add(free[0][0]);
    }
  }
  return creds.map((c) => {
    const id = identityParts(c.identity_key);
    const email = id.email ?? (owned.get(c.id) ?? []).map((k) => series.get(k)?.email).find((e): e is string => !!e) ?? null;
    const who = [email ? maskEmail(email) : null, id.org && !/^[0-9a-f-]{20,}$/i.test(id.org) ? id.org : null].filter(Boolean).join(" · ") || null;
    const latest = new Map<string, SeriesRow>();
    for (const k of owned.get(c.id) ?? [])
      for (const r of series.get(k)?.rows ?? []) {
        const old = latest.get(r.limit_id);
        if (!old || r.recorded_at > old.recorded_at) latest.set(r.limit_id, r);
      }
    // A window omp stopped reporting (renamed limit id after an omp update) is older than the account's last read
    // by more than a day: drop it. A pool reported under two ids (Antigravity's shared Claude & GPT) shows once.
    const newest = Math.max(0, ...[...latest.values()].map((r) => r.recorded_at));
    const shown = new Set<string>();
    const limits: OmpLimit[] = [...latest.values()]
      .filter((r) => newest - r.recorded_at <= RETIRED_MS)
      .map((r) => ({
        id: r.limit_id,
        label: r.label,
        window: r.window_label,
        used_fraction: num(r.used_fraction),
        status: r.status,
        resets_at: ms(num(r.resets_at)),
        read_at: r.recorded_at,
      }))
      .filter((l) => {
        const same = `${l.label}\u0000${l.window}\u0000${l.used_fraction}\u0000${l.resets_at}`;
        if (shown.has(same)) return false;
        shown.add(same);
        return true;
      })
      .sort((a, b) => a.label.localeCompare(b.label) || (a.resets_at ?? 0) - (b.resets_at ?? 0));
    const cause = c.disabled_cause ? scrub(c.disabled_cause.replace(/\s+/g, " ").trim()) : null;
    return {
      id: c.id,
      provider: c.provider,
      kind: c.credential_type,
      who,
      broken: cause && cause.length > CAUSE_MAX ? `${cause.slice(0, CAUSE_MAX - 1)}…` : cause,
      updated_at: ms(num(c.updated_at)),
      limits,
    };
  });
}

/** Every login omp holds (not those the owner deleted), with its newest limit windows. Never throws. */
export function readOmpAccounts(dir = ompAgentDir(), now = Date.now()): OmpAccounts {
  const file = path.join(dir, "agent.db");
  if (!fs.existsSync(file)) return { available: false, at: now, accounts: [] };
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 1000");
    const creds = db
      .prepare(
        "SELECT id, provider, credential_type, identity_key, disabled_cause, updated_at FROM auth_credentials WHERE disabled_cause IS NULL OR disabled_cause NOT LIKE 'deleted%' ORDER BY provider, id",
      )
      .all() as CredRow[];
    const hasUsage = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_history'").get();
    const rows = hasUsage
      ? (db
          .prepare(
            "SELECT provider, account_key, email, limit_id, label, window_label, used_fraction, status, resets_at, recorded_at FROM usage_history WHERE id IN (SELECT MAX(id) FROM usage_history GROUP BY provider, account_key, limit_id)",
          )
          .all() as SeriesRow[])
      : [];
    return { available: true, at: now, accounts: joinAccounts(creds, rows) };
  } catch (e) {
    console.error("[hq] omp accounts unreadable", e instanceof Error ? e.message : e);
    return { available: false, at: now, accounts: [] };
  } finally {
    db?.close();
  }
}
