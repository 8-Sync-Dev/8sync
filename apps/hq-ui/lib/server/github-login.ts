import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isAccessRole, type AccessRole } from "../access";
import { configDir } from "./paths";

/**
 * GitHub sign-in for the `--public` link (device flow: no callback URL, so the trycloudflare host may
 * change; no client secret). `~/.config/8sync/hq/github.json` = `{"client_id": "...", "allow": [...]}`,
 * written by the owner. An `allow` entry is a login (the owner, as before) or `{"login", "role"}` with
 * role `owner` / `editor` / `viewer`. Empty `allow` = only invites bound to a GitHub login
 * (lib/server/invites.ts) sign in with it. The GitHub token is used once to read `/user` and then
 * dropped; only the login is kept.
 */
export type AllowEntry = { login: string; role: AccessRole };
export type GithubConfig = { clientId: string; allow: AllowEntry[] };

export const githubConfigPath = () => path.join(configDir(), "github.json");

const CLIENT_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function allowEntry(x: unknown): AllowEntry | null {
  if (typeof x === "string") return LOGIN_RE.test(x) ? { login: x, role: "owner" } : null;
  const o = x as { login?: unknown; role?: unknown } | null;
  return o && typeof o === "object" && typeof o.login === "string" && LOGIN_RE.test(o.login) && isAccessRole(o.role) ? { login: o.login, role: o.role } : null;
}

/** null without a valid client id; `allow` keeps only well-formed entries (a bad one is dropped, never widened). */
export function readGithubConfig(file = githubConfigPath()): GithubConfig | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    const clientId = typeof v?.client_id === "string" ? v.client_id.trim() : "";
    const allow = Array.isArray(v?.allow) ? v.allow.map(allowEntry).filter((e: AllowEntry | null): e is AllowEntry => e !== null) : [];
    return CLIENT_ID_RE.test(clientId) ? { clientId, allow } : null;
  } catch {
    return null;
  }
}

/** The role `allow` gives this login, or null (GitHub logins are case-insensitive; the first match counts). */
export const allowedRole = (cfg: GithubConfig, login: string): AccessRole | null => cfg.allow.find((a) => a.login.toLowerCase() === login.toLowerCase())?.role ?? null;

type Flow = { deviceCode: string; expires: number; interval: number; next: number };

const FLOWS_KEY = Symbol.for("8sync.hq.githubFlows");
const store = globalThis as { [FLOWS_KEY]?: Map<string, Flow> };
const flows = (store[FLOWS_KEY] ??= new Map());
/** Pending sign-ins at once; a flood of starts from the public link cannot grow memory without bound. */
export const MAX_FLOWS = 20;

export type Fetch = typeof fetch;

function prune(now: number) {
  for (const [id, f] of flows) if (f.expires <= now) flows.delete(id);
}

/** Starts a device flow: the code the person types at github.com/login/device, and our flow id. */
export async function startFlow(cfg: GithubConfig, f: Fetch = fetch, now = Date.now()) {
  prune(now);
  if (flows.size >= MAX_FLOWS) return { error: "Đang có quá nhiều lượt đăng nhập chờ, thử lại sau ít phút." } as const;
  const r = await f("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, scope: "" }),
    signal: AbortSignal.timeout(10_000),
  });
  const v = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!r.ok || typeof v?.device_code !== "string" || typeof v.user_code !== "string") {
    return { error: `GitHub không trả mã đăng nhập (${typeof v?.error === "string" ? v.error : r.status}).` } as const;
  }
  const interval = Math.max(5, Number(v.interval) || 5);
  const id = crypto.randomBytes(16).toString("hex");
  flows.set(id, { deviceCode: v.device_code, expires: now + Math.min(900, Number(v.expires_in) || 900) * 1000, interval, next: now + interval * 1000 });
  return { id, userCode: v.user_code, verificationUri: typeof v.verification_uri === "string" ? v.verification_uri : "https://github.com/login/device", interval } as const;
}

export type PollResult =
  | { state: "pending" }
  | { state: "ok"; login: string }
  | { state: "denied"; login: string }
  | { state: "gone"; error: string };

/**
 * One poll of the token endpoint (never faster than GitHub's interval: an early call just answers
 * pending). A finished flow (ok, denied, expired, refused) is removed. `accept` decides who gets in:
 * an `allow` entry by default; the login route also lets in the login a pending invite is bound to.
 */
export async function pollFlow(cfg: GithubConfig, id: string, f: Fetch = fetch, now = Date.now(), accept = (login: string) => allowedRole(cfg, login) !== null): Promise<PollResult> {
  prune(now);
  const flow = flows.get(id);
  if (!flow) return { state: "gone", error: "Mã đã hết hạn, bấm đăng nhập lại." };
  if (now < flow.next) return { state: "pending" };
  flow.next = now + flow.interval * 1000;
  const r = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, device_code: flow.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  const v = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (v?.error === "authorization_pending") return { state: "pending" };
  if (v?.error === "slow_down") {
    flow.interval += 5;
    flow.next = now + flow.interval * 1000;
    return { state: "pending" };
  }
  if (typeof v?.access_token !== "string") {
    flows.delete(id);
    return { state: "gone", error: v?.error === "access_denied" ? "Anh đã từ chối trên GitHub." : "Mã đã hết hạn, bấm đăng nhập lại." };
  }
  flows.delete(id);
  const u = await f("https://api.github.com/user", {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${v.access_token}`, "user-agent": "8sync-hq" },
    signal: AbortSignal.timeout(10_000),
  });
  const user = (await u.json().catch(() => null)) as Record<string, unknown> | null;
  const login = typeof user?.login === "string" ? user.login : "";
  if (!u.ok || !login) return { state: "gone", error: "Không đọc được tài khoản GitHub, thử lại." };
  return accept(login) ? { state: "ok", login } : { state: "denied", login };
}

/** Test seam. */
export const __resetFlows = () => flows.clear();
