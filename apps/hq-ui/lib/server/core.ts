// The native core (crates/cli/src/verbs/hq_core): `8sync hq ui` serves warm data on a loopback port
// and passes its URL + token as HQ_CORE / HQ_CORE_TOKEN (HQ_* never reaches a room: child-env.ts).
// Unset (a `next dev` server, an older 8sync) or unreachable: callers run their own probe as before.

export type CoreReply = { status: number; body: unknown };

const DEFAULT_TIMEOUT_MS = 5_000;

/** One core call; null when there is no core or it did not answer (the caller falls back). */
export async function coreCall(
  path: string,
  init: { body?: unknown; timeoutMs?: number } = {},
  env: Record<string, string | undefined> = process.env,
): Promise<CoreReply | null> {
  const base = env.HQ_CORE;
  const token = env.HQ_CORE_TOKEN;
  if (!base || !token) return null;
  try {
    const res = await fetch(base + path, {
      method: init.body === undefined ? "GET" : "POST",
      headers: { "x-core-token": token, ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: "no-store",
    });
    return { status: res.status, body: await res.json() };
  } catch {
    return null;
  }
}

/** The body of a 200 answer, else null (no core, an error, or a route this core doesn't have). */
export async function coreGet(path: string, init: { body?: unknown; timeoutMs?: number } = {}): Promise<{ v: unknown } | null> {
  const r = await coreCall(path, init);
  return r && r.status === 200 ? { v: r.body } : null;
}
