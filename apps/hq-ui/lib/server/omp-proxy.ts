// `/api/omp/v1/*`: the OpenAI-compatible door members use with an HQ API key (docs/hq-quota-keys.md §3).
// HQ checks the key, keeps it to its models (never Claude), forwards to the local omp gateway with the gateway's
// own bearer, and logs every member call: key, project root (`X-8sync-Root`), a short summary of the request,
// model, status, duration, tokens when the answer reports them. Calls from this machine are forwarded but not
// logged. Tested in tests/api-keys.test.ts.
import type { DatabaseSync } from "node:sqlite";
import { DENY_RE, ROOT_MAX, callSource, isOneLine, keyForBearer, recordCall, summarize, type ApiKey, type CallRecord } from "./api-keys";
import { readPublic } from "./auth";
import { getDb } from "./db";
import { gatewayFetch } from "./omp-gateway";

/** The routes a key opens, and their method. `/usage` (the owner's accounts) is never proxied. */
const ROUTES: Record<string, "GET" | "POST"> = { models: "GET", "chat/completions": "POST", responses: "POST" };
/** Room for a few images in a chat request. */
export const MAX_BODY = 16 * 1024 * 1024;

const fail = (status: number, message: string, type = "invalid_request_error") =>
  Response.json({ error: { message, type } }, { status, headers: { "cache-control": "no-store" } });

type Usage = { input: number | null; output: number | null };

/** Token counts of a chat completion, a responses answer, or a stream frame carrying either. */
export function usageOf(v: unknown): Usage | null {
  const o = v as { usage?: Record<string, unknown>; response?: { usage?: Record<string, unknown> } } | null;
  const u = o?.usage ?? o?.response?.usage;
  if (!u || typeof u !== "object") return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : null);
  const input = n(u.prompt_tokens) ?? n(u.input_tokens);
  const output = n(u.completion_tokens) ?? n(u.output_tokens);
  return input == null && output == null ? null : { input, output };
}

/** Passes an SSE body through untouched and reports the last usage frame it saw when the stream ends or is cancelled. */
function sniffStream(body: ReadableStream<Uint8Array>, done: (u: Usage | null) => void): ReadableStream<Uint8Array> {
  const dec = new TextDecoder();
  let tail = "";
  let usage: Usage | null = null;
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    done(usage);
  };
  const scan = (text: string) => {
    for (const line of text.split("\n")) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]" || !data.includes("usage")) continue;
      try {
        usage = usageOf(JSON.parse(data)) ?? usage;
      } catch {
        /* not JSON */
      }
    }
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await reader.read();
      } catch (e) {
        end();
        ctl.error(e);
        return;
      }
      if (next.done) {
        scan(tail + dec.decode());
        end();
        ctl.close();
        return;
      }
      ctl.enqueue(next.value);
      const text = tail + dec.decode(next.value, { stream: true });
      const cut = text.lastIndexOf("\n");
      tail = cut < 0 ? text : text.slice(cut + 1);
      if (cut >= 0) scan(text.slice(0, cut));
    },
    cancel(reason) {
      // The member closed the stream early: the call still counts.
      end();
      return reader.cancel(reason);
    },
  });
}

/** One proxied call. `sub` = the path after `/api/omp/v1/`. */
export async function proxyOmp(req: Request, sub: string, db: DatabaseSync = getDb()): Promise<Response> {
  const source = callSource(req.headers, readPublic()?.host ?? null);
  if (!source) return fail(403, "Host không hợp lệ.", "permission_error");
  const method = ROUTES[sub];
  if (!method) return fail(404, `HQ không mở route /v1/${sub}. Dùng: ${Object.keys(ROUTES).join(", ")}.`);
  if (req.method !== method) return fail(405, `/v1/${sub} chỉ nhận ${method}.`);
  const key: ApiKey | null = keyForBearer(db, req.headers.get("authorization"));
  if (!key) return fail(401, "API key sai hoặc đã bị thu hồi.", "authentication_error");

  // Header values are bytes: a root with non-ASCII characters (Vietnamese folder names) arrives percent-encoded.
  let root = req.headers.get("x-8sync-root")?.trim() ?? "";
  if (/%[0-9a-f]{2}/i.test(root)) {
    try {
      root = decodeURIComponent(root);
    } catch {
      /* not valid encoding: keep it as sent */
    }
  }
  if (root.length > ROOT_MAX || !isOneLine(root)) return fail(400, `X-8sync-Root phải là một đường dẫn ≤ ${ROOT_MAX} ký tự.`);
  if (source !== "owner" && !root) return fail(400, "Thiếu header X-8sync-Root: gửi thư mục gốc của dự án đang làm (vd X-8sync-Root: D:/work/shop).");

  const t0 = Date.now();
  const log = (status: number, model: string | null, summary: string | null, u: Usage | null) => {
    if (source === "owner") return;
    const c: CallRecord = {
      key_id: key.id,
      at: t0,
      root,
      route: sub,
      model,
      summary,
      status,
      ms: Date.now() - t0,
      input_tokens: u?.input ?? null,
      output_tokens: u?.output ?? null,
      source,
    };
    try {
      recordCall(db, c);
    } catch (e) {
      console.error("[hq] api key call not logged", e instanceof Error ? e.message : e);
    }
  };

  if (sub === "models") {
    let res: Response;
    try {
      res = await gatewayFetch("models", { signal: AbortSignal.timeout(10_000) });
    } catch {
      log(502, null, "liệt kê model", null);
      return fail(502, "Gateway omp trên máy chủ chưa chạy.", "api_error");
    }
    const body = (await res.json().catch(() => null)) as { data?: { id?: unknown; owned_by?: unknown }[] } | null;
    log(res.status, null, "liệt kê model", null);
    if (!res.ok || !body) return fail(res.ok ? 502 : res.status, "Gateway omp không trả được danh sách model.", "api_error");
    const allowed = new Set(key.models);
    const data = (body.data ?? []).filter((m) => {
      const id = typeof m.id === "string" ? m.id : "";
      const full = id.includes("/") ? id : `${typeof m.owned_by === "string" ? m.owned_by : ""}/${id}`;
      return allowed.has(full) || allowed.has(id);
    });
    return Response.json({ object: "list", data }, { headers: { "cache-control": "no-store" } });
  }

  const text = await req.text();
  if (text.length > MAX_BODY) {
    log(413, null, null, null);
    return fail(413, "Request quá lớn (tối đa 16 MB).");
  }
  let body: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) body = v as Record<string, unknown>;
  } catch {
    /* answered below */
  }
  if (!body) {
    log(400, null, null, null);
    return fail(400, "Body phải là JSON object.");
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const summary = summarize(body);
  if (!model || DENY_RE.test(model) || !key.models.includes(model)) {
    log(403, model || null, summary, null);
    return fail(403, `Key "${key.label}" không được gọi model ${model || "(trống)"}. Được phép: ${key.models.join(", ")}.`, "permission_error");
  }

  let res: Response;
  try {
    res = await gatewayFetch(sub, { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: req.signal });
  } catch {
    log(502, model, summary, null);
    return fail(502, "Gateway omp trên máy chủ chưa chạy.", "api_error");
  }
  const type = res.headers.get("content-type") ?? "application/json";
  if (type.includes("text/event-stream") && res.body) {
    const stream = sniffStream(res.body, (u) => log(res.status, model, summary, u));
    return new Response(stream, { status: res.status, headers: { "content-type": type, "cache-control": "no-store" } });
  }
  const out = await res.text();
  let u: Usage | null = null;
  try {
    u = usageOf(JSON.parse(out));
  } catch {
    /* not JSON: no usage */
  }
  log(res.status, model, summary, u);
  return new Response(out, { status: res.status, headers: { "content-type": type, "cache-control": "no-store" } });
}
