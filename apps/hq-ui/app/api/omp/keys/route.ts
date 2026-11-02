import { MAX_ACTIVE_KEYS, callLog, createKey, isGrantable, isOneLine, listKeys } from "@/lib/server/api-keys";
import { readPublic } from "@/lib/server/auth";
import { bad, json, localOnly, open, readBody } from "@/lib/server/http";
import { grantableModels, probeGateway } from "@/lib/server/omp-gateway";

export const runtime = "nodejs";

const WEEK = 7 * 24 * 3600_000;
const LABEL_MAX = 40;

/** Active keys, member calls (last 100) and per-key totals over 7 days, the gateway state, the door members use. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const pub = readPublic();
  return json({
    keys: listKeys(o.db),
    ...callLog(o.db, Date.now() - WEEK),
    gateway: await probeGateway(),
    base_path: "/api/omp/v1",
    public_host: pub?.host ?? null,
  });
}

/** `{label, models}` → 201 `{key, token}`; the token is in this answer only. Only from this machine. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = localOnly(req);
  if (no) return no;
  const body = await readBody(req);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label || label.length > LABEL_MAX || !isOneLine(label)) return bad(`Đặt tên key (1–${LABEL_MAX} ký tự, một dòng).`, 422);
  const raw = Array.isArray(body?.models) ? body.models : null;
  if (!raw || raw.length === 0 || raw.length > 200 || !raw.every((m) => typeof m === "string")) return bad("Chọn ít nhất một model.", 422);
  const models = [...new Set(raw as string[])];
  const catalog = new Set(await grantableModels());
  if (catalog.size === 0) return bad("Gateway omp chưa chạy: chưa kiểm được model nào.", 503);
  const rejected = models.filter((m) => !isGrantable(m) || !catalog.has(m));
  if (rejected.length) return json({ error: `Model không cấp được (Claude, hoặc gateway không có): ${rejected.join(", ")}`, rejected }, 422);
  if (listKeys(o.db).length >= MAX_ACTIVE_KEYS) return bad(`Đã có ${MAX_ACTIVE_KEYS} key: thu hồi bớt rồi tạo tiếp.`, 422);
  return json(createKey(o.db, label, models), 201);
}
