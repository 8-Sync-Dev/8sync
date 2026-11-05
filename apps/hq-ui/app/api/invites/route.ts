import { readPublic } from "@/lib/server/auth";
import { bad, json, open, readBody } from "@/lib/server/http";
import { createInvite, InviteError, readInvites, revokeInvite, viewOf } from "@/lib/server/invites";

export const runtime = "nodejs";

/** "Chia sẻ" (Máy → Chia sẻ), owner only (no guest route: lib/access.ts). `public` = whether links go out on the tunnel host. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const now = Date.now();
  const invites = readInvites()
    .sort((a, b) => b.created - a.created)
    .map((x) => viewOf(x, now));
  return json({ invites, public: readPublic() !== null });
}

/**
 * New invite `{label, role: "viewer"|"editor", days: 1|7|30, github?}` → `{invite, link}`. The link
 * carries the token and is shown this once (only its sha256 is kept): on the `--public` tunnel host
 * when HQ has one, else this HQ's own address (opens on this machine only). HQ sends no mail.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  try {
    const { invite, token } = createInvite(body);
    const pub = readPublic();
    const base = pub ? `https://${pub.host}` : `http://${req.headers.get("host")}`;
    return json({ invite, link: `${base}/api/login?invite=${token}`, public: pub !== null }, 201);
  } catch (e) {
    if (e instanceof InviteError) return bad(e.message, 422);
    throw e;
  }
}

/** `?id=`: revoke. The guest's next request answers 401. */
export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return revokeInvite(id) ? json({ ok: true }) : bad("không có lời mời này", 404);
}
