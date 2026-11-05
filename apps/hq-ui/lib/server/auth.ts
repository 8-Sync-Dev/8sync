import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atLeast, deniedText, requiredRole, type AccessRole, type GuestRole } from "../access";
import { isLocalHost } from "../hosts";
import { guestAccess, type Guest } from "./invites";
import { publicPath, sessionSecretPath, tokenPath } from "./paths";

let cached: { file: string; token: string } | null = null;

/** Reads the UI token, creating it (0600, dir 0700) on first run. */
export function getToken(): string {
  const file = tokenPath();
  if (cached?.file === file) return cached.token;
  let token = "";
  try {
    token = fs.readFileSync(file, "utf8").trim();
  } catch {
    /* created below */
  }
  if (!token) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    token = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, token + "\n", { mode: 0o600 });
  }
  cached = { file, token };
  return token;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * The tunnel host and login key `8sync hq ui --public` wrote (contract C6). `since` = when the link
 * was minted (unix ms); `nonce` ties the file to the HQ process that 8sync started (contract C-C);
 * `tailnet` = `8sync hq ui --tailnet` (`"via": "tailnet"`, a `*.ts.net` host behind `tailscale serve`).
 */
export type PublicLink = { host: string; key: string; since: number; nonce: string; tailnet: boolean };

export const PUB_COOKIE = "hq_pub";
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
/** The login cookie lives 12 h, checked server side (not just Max-Age): a lost phone stops working by itself. */
export const SESSION_MS = 12 * 3600_000;
/** On the tailnet host 30 days: Tailscale already admits only the owner's devices (sign out: remove the device from the tailnet, or delete `session-secret`). */
export const TAILNET_SESSION_MS = 30 * 24 * 3600_000;
/** How long an `hq_pub` login cookie lives on this link's host. */
export const sessionMs = (pub: PublicLink | null) => (pub?.tailnet ? TAILNET_SESSION_MS : SESSION_MS);
/** The printed `/api/login?k=` link is good for 10 minutes after `8sync hq ui --public` minted it. */
export const LINK_MS = 10 * 60_000;

let pubCache: { file: string; mtimeMs: number; size: number; link: PublicLink | null } | null = null;

/**
 * `HQ_PUBLIC_NONCE`, read once at load and then removed from `process.env` so no child process
 * (8sync, claude, tmux) inherits it. Kept on `globalThis` so every bundled copy of this module in the
 * same process sees the value the first copy took.
 */
const NONCE_KEY = Symbol.for("8sync.hq.publicNonce");
const nonceStore = globalThis as { [NONCE_KEY]?: string };
if (nonceStore[NONCE_KEY] === undefined) nonceStore[NONCE_KEY] = process.env.HQ_PUBLIC_NONCE ?? "";
delete process.env.HQ_PUBLIC_NONCE;

/** Test seam: the nonce this process was started with ("" = not started by `--public`). */
export function __setNonceForTest(nonce: string): void {
  nonceStore[NONCE_KEY] = nonce;
}

/** `since` is unix ms; a seconds value (older writers) is scaled up. */
const sinceMs = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? (v < 1e12 ? v * 1000 : v) : null);

/**
 * `~/.config/8sync/hq/public.json`, re-read only when its mtime/size change; null when absent, malformed,
 * or its `nonce` differs from the `HQ_PUBLIC_NONCE` this process started with (unset = this HQ was not
 * started by `--public`: local only).
 */
export function readPublic(): PublicLink | null {
  const file = publicPath();
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    pubCache = null;
    return null;
  }
  if (pubCache?.file !== file || pubCache.mtimeMs !== st.mtimeMs || pubCache.size !== st.size) {
    let link: PublicLink | null = null;
    try {
      const v = st.size <= 4096 ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
      const host = typeof v?.host === "string" ? v.host.trim().toLowerCase() : "";
      const since = sinceMs(v?.since);
      if (
        v?.v === 1 &&
        HOST_RE.test(host) &&
        !isLocalHost(host) &&
        typeof v.key === "string" &&
        HEX64_RE.test(v.key) &&
        typeof v.nonce === "string" &&
        HEX64_RE.test(v.nonce) &&
        since !== null
      ) {
        link = { host, key: v.key, since, nonce: v.nonce, tailnet: v.via === "tailnet" && host.endsWith(".ts.net") };
      }
    } catch {
      /* half-written or junk: local only */
    }
    pubCache = { file, mtimeMs: st.mtimeMs, size: st.size, link };
  }
  const link = pubCache.link;
  const nonce = nonceStore[NONCE_KEY] ?? "";
  return link && nonce && safeEqual(nonce, link.nonce) ? link : null;
}

const SECRET_RE = /^[0-9a-f]{64}$/;
// On globalThis like the job registry: every route bundle signs and checks with the same key.
const SECRETS = Symbol.for("8sync.hq.fileSecrets");
const secretStore = globalThis as { [SECRETS]?: Map<string, { mtimeMs: number; secret: string }> };

/**
 * 32 random hex bytes kept in `file` (0600), created on first use with `wx` (two bundles racing both end
 * up reading the one file that won), re-read when its mtime changes. Deleting the file revokes everything
 * signed with it.
 */
export function fileSecret(file: string): string {
  const cache = (secretStore[SECRETS] ??= new Map());
  const mtimeOf = () => {
    try {
      return fs.statSync(file).mtimeMs;
    } catch {
      return -1;
    }
  };
  const mtimeMs = mtimeOf();
  const c = cache.get(file);
  if (c && c.mtimeMs === mtimeMs && mtimeMs >= 0) return c.secret;
  const read = () => {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      return "";
    }
  };
  let secret = read();
  if (!SECRET_RE.test(secret)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (mtimeMs >= 0) fs.rmSync(file, { force: true }); // junk in the file: start over
    try {
      fs.writeFileSync(file, crypto.randomBytes(32).toString("hex") + "\n", { mode: 0o600, flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    secret = read();
    if (!SECRET_RE.test(secret)) throw new Error(`${path.basename(file)} unreadable`);
  }
  cache.set(file, { mtimeMs: mtimeOf(), secret });
  return secret;
}

/**
 * The key `hq_pub` cookies are signed with: its own file, not the link key in public.json. A new link
 * (`--relink`, an HQ restart) must not sign out the phone that is already in; delete
 * `~/.config/8sync/hq/session-secret` to sign every device out.
 */
export const sessionSecret = () => fileSecret(sessionSecretPath());

const sign = (key: string, issued: number) => crypto.createHmac("sha256", key).update(String(issued)).digest("hex");

/** Login cookie value `<issued_ms>.<hmac_sha256_hex(key, issued_ms)>`: the raw key never leaves the server. */
export function sessionCookie(key: string, issued: number): string {
  return `${issued}.${sign(key, issued)}`;
}

/** True when `value` was signed with `key` and was issued at most `maxMs` (12 h by default) before `now`. */
export function sessionValid(value: string, key: string, now = Date.now(), maxMs = SESSION_MS): boolean {
  const m = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(value);
  if (!m) return false;
  const issued = Number(m[1]);
  return safeEqual(m[2], sign(key, issued)) && issued <= now && now - issued <= maxMs;
}

/** One cookie value from a `Cookie` header, or null. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** cloudflared forwards the edge headers: such a request came through the tunnel, whatever its Host says. */
export const viaTunnel = (h: { get(name: string): string | null }) => h.get("cf-connecting-ip") !== null || h.get("cf-ray") !== null;

/**
 * Which side a request comes from: "local" (loopback Host, not tunnelled), "remote" (the public tunnel
 * host with the login cookie), or null (refused: DNS rebinding, lookalike host, no or wrong cookie).
 */
export function sideOf(req: Pick<AuthInput, "host" | "cookie" | "tunnel">, pub: PublicLink | null, now = Date.now()): "local" | "remote" | null {
  const side = hostSide(req, pub);
  if (side !== "remote") return side;
  return req.cookie && sessionValid(req.cookie, sessionSecret(), now, sessionMs(pub)) ? "remote" : null;
}

/** The host alone: loopback (not tunnelled) or the public tunnel host; null = refused (DNS rebinding, lookalike). */
export function hostSide(req: Pick<AuthInput, "host" | "tunnel">, pub: PublicLink | null): "local" | "remote" | null {
  if (isLocalHost(req.host) && !req.tunnel) return "local";
  return pub && req.host?.toLowerCase() === pub.host ? "remote" : null;
}

export type AuthInput = {
  method: string;
  host: string | null;
  origin: string | null;
  token: string | null;
  /** `hq_pub` cookie value (remote link only). */
  cookie?: string | null;
  /** `hq_guest` cookie value: someone the owner shared HQ with (lib/server/invites.ts). */
  guest?: string | null;
  /** URL pathname: the key of the role table (lib/access.ts requiredRole). Absent = owner only. */
  path?: string;
  /** Arrived through the tunnel (Cloudflare edge headers present). */
  tunnel?: boolean;
};

export type AuthOptions = {
  /** Channel endpoints are called by a local Node process that sends no Origin. */
  allowMissingOrigin?: boolean;
};

/** Who is calling: the owner (token, plus `hq_pub` through the tunnel) or a guest (`hq_guest`, no token). */
export type Access = { role: AccessRole; side: "local" | "remote"; guest: Guest | null };
export type Denied = { status: number; error: string };
export const isDenied = (r: Access | Denied): r is Denied => "status" in r;

/**
 * The one gate of every API route (lib/server/http.ts `open`). The owner proves itself with the UI
 * token (and on the tunnel host with the `hq_pub` cookie too); a guest has no token, only its signed
 * `hq_guest` cookie, re-checked against invites.json on every call (revoked/expired = 401 now). Then the
 * role table: a route not opened to the caller's role answers 403 (deny by default).
 */
export function checkAuth(req: AuthInput, expectedToken: string, opts: AuthOptions = {}, pub: PublicLink | null = null, now = Date.now()): Access | Denied {
  const side = hostSide(req, pub);
  if (!side) return { status: 403, error: "forbidden host" };
  const pubOk = side === "local" || (!!req.cookie && sessionValid(req.cookie, sessionSecret(), now, sessionMs(pub)));
  let access: Access;
  if (pubOk && req.token && safeEqual(req.token, expectedToken)) access = { role: "owner", side, guest: null };
  else if (req.guest) {
    const g = guestAccess(req.guest, sessionSecret(), now);
    if (!("ok" in g)) return { status: 401, error: "github" in g ? "Link chia sẻ này cần đăng nhập GitHub trước." : g.error };
    access = { role: g.ok.role, side, guest: g.ok };
  } else if (!pubOk) return { status: 403, error: "forbidden host" };
  else return { status: 401, error: "missing or invalid x-hq-token" };
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
  if (mutating) {
    const uiOrigin = side === "remote" ? `https://${pub!.host}` : `http://${req.host}`;
    if (req.origin === null) {
      // Only a local Node process (channel, with the token) may omit Origin; a browser always sends it.
      if (side === "remote" || access.guest || !opts.allowMissingOrigin) return { status: 403, error: "missing Origin" };
    } else if (req.origin !== uiOrigin) {
      return { status: 403, error: "bad Origin" };
    }
  }
  if (!atLeast(access.role, requiredRole(req.method, req.path ?? ""))) return { status: 403, error: deniedText(access.role) };
  return access;
}

/** What the page (and a signed media URL) may show, from the cookies alone: no token is involved. */
export type PageAccess = { role: "owner" } | { role: GuestRole; guest: Guest } | { github: string } | { error: string } | null;

/**
 * The owner's `hq_pub` wins; else a guest cookie decides (valid = guest view, revoked/expired = the
 * "link gone" page, even on loopback: a guest browser on this machine never falls back to the owner's
 * view); else loopback is the owner. null = refused host, or the tunnel host with no login.
 */
export function pageAccess(req: Pick<AuthInput, "host" | "cookie" | "guest" | "tunnel">, pub: PublicLink | null, now = Date.now()): PageAccess {
  const side = hostSide(req, pub);
  if (!side) return null;
  if (side === "remote" && req.cookie && sessionValid(req.cookie, sessionSecret(), now, sessionMs(pub))) return { role: "owner" };
  if (req.guest) {
    const g = guestAccess(req.guest, sessionSecret(), now);
    return "ok" in g ? { role: g.ok.role, guest: g.ok } : "github" in g ? { github: g.github.github! } : g;
  }
  return side === "local" ? { role: "owner" } : null;
}
