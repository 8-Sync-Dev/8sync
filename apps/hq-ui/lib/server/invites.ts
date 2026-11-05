import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isGuestRole, type GuestRole } from "../access";
import { allowedRole, LOGIN_RE, readGithubConfig } from "./github-login";
import { invitesPath } from "./paths";

/**
 * "Chia sẻ": the owner hands HQ's Nội dung tab to someone outside, read only (viewer) or able to edit
 * items (editor). `~/.config/8sync/hq/invites.json` (0600) keeps label, role, expiry and the sha256 of
 * each link token, never the token: the link (`/api/login?invite=<token>`) is shown once, at creation.
 * The link sets the `hq_guest` cookie (signed with the session-secret, carries `{id, role, issued}`);
 * every request re-reads this file, so a revoke or an expiry shuts the door at the next request.
 */
export type Invite = {
  id: string;
  label: string;
  role: GuestRole;
  created: number;
  expires: number;
  /** When the owner revoked it (unix ms), or null. */
  revoked: number | null;
  /** The GitHub login the link is bound to: it works only after that account signs in (device flow). */
  github?: string;
  /** sha256 hex of the link token. */
  hash: string;
};
/** What the owner's list shows: never the hash. */
export type InviteView = Omit<Invite, "hash"> & { state: InviteState };
export type InviteState = "active" | "expired" | "revoked";

export const INVITE_DAYS = [1, 7, 30] as const;
export const GUEST_COOKIE = "hq_guest";
/** A guest cookie lives at most this long, and never past its invite's expiry. */
export const GUEST_MAX_MS = 7 * 86_400_000;
/** A guest who came in through a GitHub `allow` entry (no invite) gets the owner's 12 h, like `hq_pub`. */
export const GUEST_GH_MS = 12 * 3600_000;
/** Invites that ended this long ago are dropped at the next write, so the file does not grow forever. */
const KEEP_ENDED_MS = 30 * 86_400_000;
const MAX_INVITES = 200;
export const LABEL_MAX = 120;

const ID_RE = /^[0-9a-f]{16}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const sameHex = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const inviteState = (inv: Pick<Invite, "expires" | "revoked">, now = Date.now()): InviteState => (inv.revoked != null ? "revoked" : now >= inv.expires ? "expired" : "active");

function parse(v: unknown): Invite | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const { id, label, role, created, expires, revoked, github, hash } = o;
  if (typeof id !== "string" || !ID_RE.test(id) || typeof hash !== "string" || !HEX64_RE.test(hash) || !isGuestRole(role)) return null;
  if (typeof label !== "string" || typeof created !== "number" || typeof expires !== "number" || !(revoked === null || typeof revoked === "number")) return null;
  if (github !== undefined && (typeof github !== "string" || !LOGIN_RE.test(github))) return null;
  return { id, label, role, created, expires, revoked, ...(github ? { github } : {}), hash };
}

/** Every well-formed invite in the file; [] when absent or unreadable (no invite then works). */
export function readInvites(): Invite[] {
  try {
    const v = JSON.parse(fs.readFileSync(invitesPath(), "utf8"));
    return Array.isArray(v?.invites) ? v.invites.map(parse).filter((x: Invite | null): x is Invite => x !== null) : [];
  } catch {
    return [];
  }
}

/** Write-then-rename (0600, dir 0700); a Windows scanner holding the old file gets a few short retries. */
function writeInvites(list: Invite[]): void {
  const f = invitesPath();
  const tmp = `${f}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, invites: list }, null, 2) + "\n", { mode: 0o600 });
  try {
    for (let i = 1; ; i++) {
      try {
        fs.renameSync(tmp, f);
        break;
      } catch (e) {
        if (i >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * i);
      }
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  try {
    fs.chmodSync(f, 0o600);
  } catch {
    /* Windows: no POSIX bits, the profile ACL guards it */
  }
}

export const viewOf = (inv: Invite, now = Date.now()): InviteView => ({
  id: inv.id,
  label: inv.label,
  role: inv.role,
  created: inv.created,
  expires: inv.expires,
  revoked: inv.revoked,
  ...(inv.github ? { github: inv.github } : {}),
  state: inviteState(inv, now),
});

export class InviteError extends Error {}

/**
 * New invite: `label` (who it is for, e.g. an email: HQ sends no mail, the owner copies the link),
 * `role`, `days` (1, 7 or 30), optional `github` login it is bound to. Returns the link token once.
 */
export function createInvite(body: Record<string, unknown>, now = Date.now()): { invite: InviteView; token: string } {
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > LABEL_MAX || /[\u0000-\u001f\u007f]/.test(label)) throw new InviteError(`label: cần 1–${LABEL_MAX} ký tự, không xuống dòng`);
  if (!isGuestRole(body.role)) throw new InviteError('role: "viewer" hoặc "editor"');
  if (!(INVITE_DAYS as readonly unknown[]).includes(body.days)) throw new InviteError("days: 1, 7 hoặc 30");
  const github = typeof body.github === "string" ? body.github.trim().replace(/^@/, "") : "";
  if (body.github != null && body.github !== "" && !LOGIN_RE.test(github)) throw new InviteError("github: tên đăng nhập GitHub không hợp lệ");
  const token = crypto.randomBytes(32).toString("hex");
  const inv: Invite = {
    id: crypto.randomBytes(8).toString("hex"),
    label,
    role: body.role,
    created: now,
    expires: now + (body.days as number) * 86_400_000,
    revoked: null,
    ...(github ? { github } : {}),
    hash: sha256(token),
  };
  const kept = readInvites().filter((x) => inviteState(x, now) === "active" || now - (x.revoked ?? x.expires) < KEEP_ENDED_MS);
  if (kept.length >= MAX_INVITES) throw new InviteError(`đã có ${MAX_INVITES} lời mời: thu hồi bớt trước`);
  writeInvites([...kept, inv]);
  return { invite: viewOf(inv, now), token };
}

/** Revokes `id`: false when there is no such invite. Already revoked stays as it was. */
export function revokeInvite(id: string, now = Date.now()): boolean {
  const list = readInvites();
  const inv = list.find((x) => x.id === id);
  if (!inv) return false;
  if (inv.revoked == null) {
    inv.revoked = now;
    writeInvites(list);
  }
  return true;
}

/** The active invite a link token opens, or null. */
export function inviteByToken(token: string, now = Date.now()): Invite | null {
  if (!HEX64_RE.test(token)) return null;
  const h = sha256(token);
  const inv = readInvites().find((x) => sameHex(x.hash, h));
  return inv && inviteState(inv, now) === "active" ? inv : null;
}

/** `hq_guest` claims. `id` = an invite id, or `gh:<login>` for a GitHub `allow` entry with a guest role. `gh` = the GitHub login verified by the device flow. */
export type GuestClaims = { id: string; role: GuestRole; issued: number; gh?: string };

const mac = (key: string, payload: string) => crypto.createHmac("sha256", key).update(`hq_guest.${payload}`).digest("hex");

/** Cookie value `<base64url(json claims)>.<hmac_sha256_hex(session-secret, "hq_guest." + payload)>`. */
export function guestCookie(claims: GuestClaims, key: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${mac(key, payload)}`;
}

/** The claims of a cookie signed with `key`, or null (bad shape, bad signature, issued in the future). */
export function readGuestCookie(value: string | null | undefined, key: string, now = Date.now()): GuestClaims | null {
  const m = /^([A-Za-z0-9_-]{1,600})\.([0-9a-f]{64})$/.exec(value ?? "");
  if (!m || !sameHex(m[2], mac(key, m[1]))) return null;
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { id, role, issued, gh } = v ?? {};
  if (typeof id !== "string" || !isGuestRole(role) || typeof issued !== "number" || !Number.isSafeInteger(issued) || issued > now) return null;
  if (gh !== undefined && (typeof gh !== "string" || !LOGIN_RE.test(gh))) return null;
  return { id, role, issued, ...(gh ? { gh } : {}) };
}

/** A guest let in: who (invite label or GitHub login), the role, and when its access ends. */
export type Guest = { id: string; role: GuestRole; label: string; until: number; github: string | null };

export type GuestCheck = { ok: Guest } | { github: Invite } | { error: string };

const sameLogin = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Re-checks an `hq_guest` cookie against today's invites.json / github.json: the invite must still be
 * active with the same role, and the cookie inside min(invite expiry, 7 days). `{github}` = right link,
 * but the invite is bound to a GitHub login that has not signed in yet.
 */
export function guestAccess(value: string | null | undefined, key: string, now = Date.now()): GuestCheck {
  const gone = { error: "Link chia sẻ đã bị thu hồi hoặc hết hạn: xin chủ HQ link mới." };
  const c = readGuestCookie(value, key, now);
  if (!c) return gone;
  if (c.id.startsWith("gh:")) {
    const login = c.id.slice(3);
    const cfg = readGithubConfig();
    const until = c.issued + GUEST_GH_MS;
    if (!cfg || !sameLogin(c.gh, login) || allowedRole(cfg, login) !== c.role || now >= until) return gone;
    return { ok: { id: c.id, role: c.role, label: login, until, github: login } };
  }
  const inv = readInvites().find((x) => x.id === c.id);
  if (!inv || inviteState(inv, now) !== "active" || inv.role !== c.role) return gone;
  const until = Math.min(inv.expires, c.issued + GUEST_MAX_MS);
  if (now >= until) return gone;
  if (inv.github && !sameLogin(c.gh, inv.github)) return { github: inv };
  return { ok: { id: inv.id, role: inv.role, label: inv.label, until, github: c.gh ?? null } };
}

/** `Set-Cookie` for a guest: HttpOnly, SameSite=Strict, Secure on the https tunnel; `maxMs` <= 0 clears it. */
export function guestSetCookie(value: string, maxMs: number, secure: boolean): string {
  return `${GUEST_COOKIE}=${value}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor(maxMs / 1000))}`;
}
