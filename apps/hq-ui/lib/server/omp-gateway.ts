// The local `omp auth-gateway` (OpenAI-compatible, fronts every login omp holds) as HQ's member proxy and key
// dialog use it. Same contract as content-post-agency's apps/content-ai/src/services/omp-gateway.ts: base URL
// `OMP_GATEWAY_URL` (default http://127.0.0.1:4310/v1), bearer `OMP_GATEWAY_TOKEN` or what `omp auth-gateway
// token` prints, re-read once on a 401. The bearer is never logged or sent to a browser.
import { DENY_RE, isGrantable } from "./api-keys";
import { run } from "./proc";

const CATALOG_TIMEOUT_MS = 4_000;
const CATALOG_TTL_MS = 60_000;
/** A failed `omp auth-gateway token` is not retried for this long: a missing omp would cost a shell per 401. */
const TOKEN_RETRY_MS = 30_000;

export const gatewayUrl = (env: Record<string, string | undefined> = process.env) => (env.OMP_GATEWAY_URL?.trim() || "http://127.0.0.1:4310/v1").replace(/\/+$/, "");

type State = { bearer: string; reading: Promise<string> | null; failedAt: number; catalog: { at: number; url: string; ids: string[] } | null };
const g = globalThis as unknown as { __hqGateway?: State };
const state = (): State => (g.__hqGateway ??= { bearer: "", reading: null, failedAt: 0, catalog: null });

/** Test hook: forget the cached bearer and catalog. */
export function resetGateway(): void {
  g.__hqGateway = undefined;
}

/** The gateway bearer `omp auth-gateway token` prints (last line), "" when omp is missing or fails. */
const readToken = () => run("omp", ["auth-gateway", "token"], 5_000).then((r) => (r.ok ? (r.stdout.trim().split(/\r?\n/).pop()?.trim() ?? "") : ""));

/**
 * `fetch(<gateway>/<pathname>)` with the gateway bearer. On a 401 (gateway restarted, token rotated, or not read
 * yet) the token is read again once. `OMP_GATEWAY_TOKEN`, when set, is used as is.
 */
export async function gatewayFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  const s = state();
  const fixed = process.env.OMP_GATEWAY_TOKEN?.trim() ?? "";
  const send = (bearer: string) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${bearer || "omp-local"}`);
    return fetch(`${gatewayUrl()}/${pathname.replace(/^\/+/, "")}`, { ...init, headers });
  };
  const used = fixed || s.bearer;
  const res = await send(used);
  if (res.status !== 401 || fixed) return res;
  if (s.bearer === used) {
    if (Date.now() - s.failedAt < TOKEN_RETRY_MS) return res;
    const fresh = await (s.reading ??= readToken().finally(() => (s.reading = null)));
    if (!fresh || fresh === used) {
      s.failedAt = Date.now();
      return res;
    }
    s.bearer = fresh;
  }
  await res.body?.cancel().catch(() => {});
  return send(s.bearer);
}

export type GatewayState = { state: "up" | "down"; url: string };

/** Up when anything answers `<gateway>/models`. */
export async function probeGateway(): Promise<GatewayState> {
  const url = gatewayUrl();
  try {
    const res = await fetch(`${url}/models`, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => {});
    return { state: "up", url };
  } catch {
    return { state: "down", url };
  }
}

/** `<owner>/<model>` of one catalog row, the id a key grants and the member sends (owned_by first, else the id prefix). */
export function grantId(row: { id?: unknown; owned_by?: unknown }): string | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  const slash = id.indexOf("/");
  const owner = (typeof row.owned_by === "string" && row.owned_by.trim()) || (slash > 0 ? id.slice(0, slash) : "");
  const model = slash > 0 && id.slice(0, slash) === owner ? id.slice(slash + 1) : id;
  return owner && model ? `${owner}/${model}` : null;
}

/** Grantable model ids the gateway lists (Claude removed), cached a minute; [] when the gateway is down. */
export async function grantableModels(): Promise<string[]> {
  const s = state();
  const url = gatewayUrl();
  if (s.catalog && s.catalog.url === url && Date.now() - s.catalog.at < CATALOG_TTL_MS) return s.catalog.ids;
  let ids: string[] = [];
  try {
    const res = await gatewayFetch("models", { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
    if (res.ok) {
      const body = (await res.json()) as { data?: { id?: unknown; owned_by?: unknown }[] };
      ids = [...new Set((body.data ?? []).map(grantId).filter((m): m is string => !!m && isGrantable(m) && !DENY_RE.test(m)))].sort();
    }
  } catch {
    /* down: no catalog */
  }
  s.catalog = { at: Date.now(), url, ids };
  return ids;
}
