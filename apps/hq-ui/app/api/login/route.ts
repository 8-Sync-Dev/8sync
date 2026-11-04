import { hostSide, LINK_MS, PUB_COOKIE, readPublic, safeEqual, SESSION_MS, sessionCookie, sessionSecret, viaTunnel } from "@/lib/server/auth";
import { GUEST_MAX_MS, guestCookie, guestSetCookie, inviteByToken } from "@/lib/server/invites";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };
const refused = () => new Response(null, { status: 401, headers: NO_STORE });
const home = (cookie: string) => new Response(null, { status: 303, headers: { location: "/", ...NO_STORE, "set-cookie": cookie } });

/**
 * The routes outside `open()`: the login links.
 * - `?k=<key>`: the link `8sync hq ui --public` prints (`https://<host>/api/login?k=<key>`, contract
 *   C6). Right host + key within 10 minutes of the link's `since` -> the signed 12 h `hq_pub` cookie
 *   (never the key itself) and a redirect to the app.
 * - `?invite=<token>`: a "Chia sẻ" link (lib/server/invites.ts), on the tunnel host or loopback. An
 *   active invite -> the signed `hq_guest` cookie `{id, role, issued}`, good for min(invite expiry,
 *   7 days); an invite bound to a GitHub login also needs that account's device-flow sign-in.
 * - `?out=1`: drops the guest cookie (leave the shared view on this browser).
 * Anything else -> 401 with no detail.
 */
export async function GET(req: Request) {
  const pub = readPublic();
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  const q = new URL(req.url).searchParams;
  const now = Date.now();
  const invite = q.get("invite");
  if (invite !== null || q.get("out") === "1") {
    const side = hostSide({ host, tunnel: viaTunnel(req.headers) }, pub);
    if (!side) return refused();
    if (invite === null) return home(guestSetCookie("", 0, side === "remote"));
    const inv = inviteByToken(invite, now);
    if (!inv) return refused();
    const maxMs = Math.min(inv.expires - now, GUEST_MAX_MS);
    return home(guestSetCookie(guestCookie({ id: inv.id, role: inv.role, issued: now }, sessionSecret()), maxMs, side === "remote"));
  }
  const k = q.get("k") ?? "";
  if (!pub || host !== pub.host || !safeEqual(k, pub.key) || now - pub.since > LINK_MS) return refused();
  return home(`${PUB_COOKIE}=${sessionCookie(sessionSecret(), now)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
}
