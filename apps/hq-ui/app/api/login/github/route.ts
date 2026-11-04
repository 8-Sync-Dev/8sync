import { cookieValue, hostSide, PUB_COOKIE, readPublic, SESSION_MS, sessionCookie, sessionSecret, viaTunnel } from "@/lib/server/auth";
import { allowedRole, pollFlow, readGithubConfig, startFlow } from "@/lib/server/github-login";
import { GUEST_COOKIE, GUEST_GH_MS, GUEST_MAX_MS, guestAccess, guestCookie, guestSetCookie } from "@/lib/server/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const out = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...NO_STORE, ...extra } });

/**
 * On the public tunnel host when the owner turned GitHub sign-in on (an `allow` entry); also on
 * loopback for a "Chia sẻ" link bound to a GitHub login (the browser holds that invite's cookie, not
 * yet signed in). `bound` = the GitHub login that pending invite waits for.
 */
function gate(req: Request) {
  const pub = readPublic();
  const cfg = readGithubConfig();
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  const side = hostSide({ host, tunnel: viaTunnel(req.headers) }, pub);
  if (!side || !cfg) return null;
  const pending = guestAccess(cookieValue(req.headers.get("cookie"), GUEST_COOKIE), sessionSecret());
  const bound = "github" in pending ? pending.github : null;
  if (!bound && (side !== "remote" || cfg.allow.length === 0)) return null;
  return { origin: side === "remote" ? `https://${pub!.host}` : `http://${host}`, secure: side === "remote", cfg, bound };
}

/** Start: `{id, userCode, verificationUri, interval}`. A browser call always carries our Origin. */
export async function POST(req: Request) {
  const g = gate(req);
  if (!g) return out({ error: "GitHub sign-in is off" }, 404);
  if (req.headers.get("origin") !== g.origin) return out({ error: "bad Origin" }, 403);
  const r = await startFlow(g.cfg).catch(() => ({ error: "Không gọi được GitHub, thử lại." }) as const);
  return "error" in r ? out({ error: r.error }, 502) : out(r);
}

/**
 * Poll `?f=<id>`: pending → 202. Signed in → 200 + a cookie: an `allow` owner gets the same signed
 * 12 h `hq_pub` as the key link; the login a pending invite is bound to gets that invite's `hq_guest`;
 * an `allow` entry with a guest role gets a 12 h `hq_guest` of its own.
 */
export async function GET(req: Request) {
  const g = gate(req);
  if (!g) return out({ error: "GitHub sign-in is off" }, 404);
  const id = new URL(req.url).searchParams.get("f") ?? "";
  if (!/^[0-9a-f]{32}$/.test(id)) return out({ error: "bad flow" }, 400);
  const fitsInvite = (login: string) => !!g.bound?.github && g.bound.github.toLowerCase() === login.toLowerCase();
  const r = await pollFlow(g.cfg, id, fetch, Date.now(), (login) => allowedRole(g.cfg, login) !== null || fitsInvite(login)).catch(() => ({ state: "pending" }) as const);
  if (r.state === "pending") return out({ state: "pending" }, 202);
  if (r.state === "gone") return out({ state: "gone", error: r.error }, 410);
  if (r.state === "denied") {
    console.warn(`[hq] GitHub sign-in refused for ${r.login} (not in github.json allow, no invite bound to it)`);
    return out({ state: "denied", error: `Tài khoản GitHub ${r.login} không được phép vào HQ này.` }, 403);
  }
  const now = Date.now();
  const role = allowedRole(g.cfg, r.login);
  console.info(`[hq] GitHub sign-in: ${r.login}`);
  if (role === "owner") {
    return out({ state: "ok", login: r.login }, 200, {
      "set-cookie": `${PUB_COOKIE}=${sessionCookie(sessionSecret(), now)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
    });
  }
  const inv = fitsInvite(r.login) ? g.bound! : null;
  if (!inv && !role) return out({ state: "denied", error: `Tài khoản GitHub ${r.login} không được phép vào HQ này.` }, 403);
  const cookie = inv
    ? guestSetCookie(guestCookie({ id: inv.id, role: inv.role, issued: now, gh: r.login }, sessionSecret()), Math.min(inv.expires - now, GUEST_MAX_MS), g.secure)
    : guestSetCookie(guestCookie({ id: `gh:${r.login}`, role: role!, issued: now, gh: r.login }, sessionSecret()), GUEST_GH_MS, g.secure);
  return out({ state: "ok", login: r.login }, 200, { "set-cookie": cookie });
}
