import { PUB_COOKIE, readPublic, SESSION_MS, sessionCookie } from "@/lib/server/auth";
import { pollFlow, readGithubConfig, startFlow } from "@/lib/server/github-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const out = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...NO_STORE, ...extra } });

/** Only on the public tunnel host (like `/api/login`), and only when the owner turned GitHub sign-in on. */
function gate(req: Request) {
  const pub = readPublic();
  const cfg = readGithubConfig();
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  if (!pub || host !== pub.host || !cfg) return null;
  return { pub, cfg };
}

/** Start: `{id, userCode, verificationUri, interval}`. A browser call always carries our Origin. */
export async function POST(req: Request) {
  const g = gate(req);
  if (!g) return out({ error: "GitHub sign-in is off" }, 404);
  if (req.headers.get("origin") !== `https://${g.pub.host}`) return out({ error: "bad Origin" }, 403);
  const r = await startFlow(g.cfg).catch(() => ({ error: "Không gọi được GitHub, thử lại." }) as const);
  return "error" in r ? out({ error: r.error }, 502) : out(r);
}

/** Poll `?f=<id>`: pending → 202; allowed login → 200 + the same signed 12 h cookie as the key link. */
export async function GET(req: Request) {
  const g = gate(req);
  if (!g) return out({ error: "GitHub sign-in is off" }, 404);
  const id = new URL(req.url).searchParams.get("f") ?? "";
  if (!/^[0-9a-f]{32}$/.test(id)) return out({ error: "bad flow" }, 400);
  const r = await pollFlow(g.cfg, id).catch(() => ({ state: "pending" }) as const);
  if (r.state === "pending") return out({ state: "pending" }, 202);
  if (r.state === "gone") return out({ state: "gone", error: r.error }, 410);
  if (r.state === "denied") {
    console.warn(`[hq] GitHub sign-in refused for ${r.login} (not in github.json allow)`);
    return out({ state: "denied", error: `Tài khoản GitHub ${r.login} không được phép vào HQ này.` }, 403);
  }
  console.info(`[hq] GitHub sign-in: ${r.login}`);
  return out({ state: "ok", login: r.login }, 200, {
    "set-cookie": `${PUB_COOKIE}=${sessionCookie(g.pub.key, Date.now())}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
  });
}
