// Who may do what in HQ (owner, editor, viewer). Pure: the server's route gate (lib/server/auth.ts
// `checkAuth`, run by lib/server/http.ts `open`) and the client's role-aware UI read the same ranks and words.

export const ACCESS_ROLES = ["viewer", "editor", "owner"] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];
/** The roles an invite or a GitHub allow entry can hand out besides owner. */
export const GUEST_ROLES = ["viewer", "editor"] as const;
export type GuestRole = (typeof GUEST_ROLES)[number];

export const isAccessRole = (v: unknown): v is AccessRole => typeof v === "string" && (ACCESS_ROLES as readonly string[]).includes(v);
export const isGuestRole = (v: unknown): v is GuestRole => typeof v === "string" && (GUEST_ROLES as readonly string[]).includes(v);

/** True when `role` grants at least what `need` asks. */
export const atLeast = (role: AccessRole, need: AccessRole) => ACCESS_ROLES.indexOf(role) >= ACCESS_ROLES.indexOf(need);

export const ACCESS_LABEL: Record<AccessRole, string> = { owner: "Chủ HQ", editor: "Sửa nội dung", viewer: "Chỉ xem" };

/**
 * The few routes a guest may call, with the least role each needs. Everything else (terminals, shell,
 * sessions, messages, Nhật ký, uploads, keys, omp accounts, machine, invites, the room "Thư mục" file
 * panel `/api/files`, `/api/files/file`, `/api/files/raw`, any route added later) is owner only: deny by
 * default. Editors change items (PATCH); creating and deleting stay the owner's.
 */
export const GUEST_ROUTES: Readonly<Record<string, Readonly<Partial<Record<string, GuestRole>>>>> = {
  "/api/content": { GET: "viewer", HEAD: "viewer", PATCH: "editor" },
  "/api/content/media": { GET: "viewer", HEAD: "viewer" },
};

/** The least role `method pathname` needs (exact path, one trailing slash tolerated; own keys only: the path comes from the request). */
export function requiredRole(method: string, pathname: string): AccessRole {
  const p = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const m = method.toUpperCase();
  const route = Object.hasOwn(GUEST_ROUTES, p) ? GUEST_ROUTES[p] : undefined;
  return (route && Object.hasOwn(route, m) ? route[m] : undefined) ?? "owner";
}

/** The 403 a guest gets for a route above its role. */
export const deniedText = (role: AccessRole) => `Quyền "${ACCESS_LABEL[role]}" không dùng được chức năng này: chỉ chủ HQ hoặc người được giao quyền cao hơn.`;

/**
 * Content fields only the owner sets: a file path on the owner's machine, the agent who holds the
 * item, `send` (approve + hand the posting task to an agent session), the AI disclosure (`ai_label`)
 * and `retry_channel` (requeues a failed or blocked post).
 */
export const OWNER_CONTENT_FIELDS = ["media_path", "assignee_session", "assignee_base", "send", "ai_label", "retry_channel"] as const;

/**
 * Statuses only the owner sets: approving (which schedules the channels and is what the worker
 * posts) and marking published. A guest editor moves an item between the earlier steps, or rejects
 * it; the owner approves what goes out (owner 2026-11-05).
 */
export const OWNER_CONTENT_STATUSES: readonly string[] = ["approved", "published"];
export const GUEST_STATUS_DENIED = "Chỉ chủ HQ duyệt hoặc đánh dấu đã đăng. Khách chuyển được giữa Đặt, Nháp, Đã check và Bỏ; bài sửa xong chờ chủ HQ duyệt.";
/** What a guest sees where "Duyệt" would be. */
export const GUEST_AWAITS_APPROVAL = "Chờ chủ HQ duyệt";
