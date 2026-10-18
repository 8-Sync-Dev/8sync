import { PUB_COOKIE, readPublic, safeEqual } from "@/lib/server/auth";

export const runtime = "nodejs";

/** 12 h: a lost phone stops working by itself; `8sync hq ui --public` prints a fresh link. */
const MAX_AGE_S = 43_200;

/**
 * The one route outside `open()`: the login link `8sync hq ui --public` prints
 * (`https://<host>/api/login?k=<key>`, contract C6). Right host + key -> the `hq_pub` cookie
 * and a redirect to the app; anything else -> 401 with no detail.
 */
export async function GET(req: Request) {
  const pub = readPublic();
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  const k = new URL(req.url).searchParams.get("k") ?? "";
  if (!pub || host !== pub.host || !safeEqual(k, pub.key)) {
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": `${PUB_COOKIE}=${pub.key}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_S}`,
    },
  });
}
