import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Points HOME at a fresh temp dir; every path helper resolves per call. */
export function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hq-ui-test-"));
  process.env.HOME = home;
  return home;
}

export const ORIGIN = "http://127.0.0.1:8740";

export function req(
  pathAndQuery: string,
  init: { method?: string; token?: string | null; origin?: string | null; body?: unknown; host?: string; signal?: AbortSignal } = {},
): Request {
  const headers = new Headers({ host: init.host ?? "127.0.0.1:8740" });
  if (init.token) headers.set("x-hq-token", init.token);
  if (init.origin) headers.set("origin", init.origin);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new Request(ORIGIN + pathAndQuery, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
}
