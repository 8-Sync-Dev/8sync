import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tokenPath } from "./paths";

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

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Host header must be a loopback name (blocks DNS-rebinding). */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(host.toLowerCase());
  return !!m && LOCAL_HOSTS.has(m[1]);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export type AuthInput = {
  method: string;
  host: string | null;
  origin: string | null;
  token: string | null;
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
): { status: number; error: string } | null {
  if (!isLocalHost(req.host)) return { status: 403, error: "forbidden host" };
  if (!req.token || !safeEqual(req.token, expectedToken)) {
    return { status: 401, error: "missing or invalid x-hq-token" };
  }
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
  if (mutating) {
    const uiOrigin = `http://${req.host}`;
    if (req.origin === null) {
      if (!opts.allowMissingOrigin) return { status: 403, error: "missing Origin" };
    } else if (req.origin !== uiOrigin) {
      return { status: 403, error: "bad Origin" };
    }
  }
  return null;
}
