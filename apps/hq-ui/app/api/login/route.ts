import { LINK_MS, PUB_COOKIE, readPublic, safeEqual, SESSION_MS, sessionCookie } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * The one route outside `open()`: the login link `8sync hq ui --public` prints
 * (`https://<host>/api/login?k=<key>`, contract C6). Right host + key within 10 minutes of the link's
 * `since` -> the signed 12 h `hq_pub` cookie (never the key itself) and a redirect to the app;
 * anything else -> 401 with no detail.
 */
export async function GET(req: Request) {
  const pub = readPublic();
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  const k = new URL(req.url).searchParams.get("k") ?? "";
  const now = Date.now();
  if (!pub || host !== pub.host || !safeEqual(k, pub.key) || now - pub.since > LINK_MS) {
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": `${PUB_COOKIE}=${sessionCookie(pub.key, now)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`,
    },
  });
}
