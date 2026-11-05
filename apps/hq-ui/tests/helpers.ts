import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UI_HEADER, UI_VALUE } from "@/lib/sender";

/**
 * Points the home dir at a fresh temp dir; every path helper resolves per call.
 * Windows `os.homedir()` reads USERPROFILE, not HOME: set both, or tests write
 * into the owner's real ~/.local/state/8sync/hq (it happened: tests/setup.ts).
 */
export function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hq-ui-test-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

export const ORIGIN = "http://127.0.0.1:8740";

/** `ui`: sent the way HQ's own page sends (lib/sender.ts marker + a browser's same-origin fetch); without it, the way hq.mjs does. */
export function req(
  pathAndQuery: string,
  init: { method?: string; token?: string | null; origin?: string | null; body?: unknown; host?: string; signal?: AbortSignal; ui?: boolean } = {},
): Request {
  const headers = new Headers({ host: init.host ?? "127.0.0.1:8740" });
  if (init.token) headers.set("x-hq-token", init.token);
  if (init.origin) headers.set("origin", init.origin);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.ui) {
    headers.set(UI_HEADER, UI_VALUE);
    headers.set("sec-fetch-site", "same-origin");
  }
  return new Request(ORIGIN + pathAndQuery, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
}
