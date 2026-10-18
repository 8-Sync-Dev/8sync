import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isLocalHost } from "../hosts";
import { publicPath, tokenPath } from "./paths";

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

/** The tunnel host and login key `8sync hq ui --public` wrote (contract C6). */
export type PublicLink = { host: string; key: string };

export const PUB_COOKIE = "hq_pub";
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const KEY_RE = /^[0-9a-f]{64}$/;

let pubCache: { file: string; mtimeMs: number; size: number; link: PublicLink | null } | null = null;

/** `~/.config/8sync/hq/public.json`, re-read only when its mtime/size change; null when absent or malformed. */
export function readPublic(): PublicLink | null {
  const file = publicPath();
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    pubCache = null;
    return null;
  }
  if (pubCache?.file === file && pubCache.mtimeMs === st.mtimeMs && pubCache.size === st.size) return pubCache.link;
  let link: PublicLink | null = null;
  try {
    const v = st.size <= 4096 ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const host = typeof v?.host === "string" ? v.host.trim().toLowerCase() : "";
    if (v?.v === 1 && HOST_RE.test(host) && !isLocalHost(host) && typeof v.key === "string" && KEY_RE.test(v.key)) link = { host, key: v.key };
  } catch {
    /* half-written or junk: local only */
  }
  pubCache = { file, mtimeMs: st.mtimeMs, size: st.size, link };
  return link;
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
export function sideOf(req: Pick<AuthInput, "host" | "cookie" | "tunnel">, pub: PublicLink | null): "local" | "remote" | null {
  if (isLocalHost(req.host) && !req.tunnel) return "local";
  if (!pub || req.host?.toLowerCase() !== pub.host) return null;
  return req.cookie && safeEqual(req.cookie, pub.key) ? "remote" : null;
}

export type AuthInput = {
  method: string;
  host: string | null;
  origin: string | null;
  token: string | null;
  /** `hq_pub` cookie value (remote link only). */
  cookie?: string | null;
  /** Arrived through the tunnel (Cloudflare edge headers present). */
  tunnel?: boolean;
};

export type AuthOptions = {
  /** Channel endpoints are called by a local Node process that sends no Origin. */
  allowMissingOrigin?: boolean;
};

/** Pure check so it can be unit tested. Returns null when allowed. */
export function checkAuth(
  req: AuthInput,
  expectedToken: string,
  opts: AuthOptions = {},
  pub: PublicLink | null = null,
): { status: number; error: string } | null {
  const side = sideOf(req, pub);
  if (!side) return { status: 403, error: "forbidden host" };
  if (!req.token || !safeEqual(req.token, expectedToken)) {
    return { status: 401, error: "missing or invalid x-hq-token" };
  }
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
  if (mutating) {
    const uiOrigin = side === "remote" ? `https://${pub!.host}` : `http://${req.host}`;
    if (req.origin === null) {
      // Only a local Node process (channel) may omit Origin; a browser through the tunnel always sends it.
      if (side === "remote" || !opts.allowMissingOrigin) return { status: 403, error: "missing Origin" };
    } else if (req.origin !== uiOrigin) {
      return { status: 403, error: "bad Origin" };
    }
  }
  return null;
}
