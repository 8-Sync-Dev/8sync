// The models omp can run (`omp models --json`: only providers with a key or login) and what one omp
// room runs now (written by the 8sync-inbox extension). See lib/room-model.ts.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isOmpRoomId } from "../labels";
import { SELECTOR_RE, type ModelChoice, type RoomModel } from "../room-model";
import { childEnv } from "./child-env";
import { stateDir } from "./paths";

const TTL_MS = 10 * 60_000;
let cache: { at: number; list: ModelChoice[] } | null = null;
let inflight: Promise<ModelChoice[]> | null = null;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** `omp models --json` → chat models, in omp's order. Anything malformed is skipped. */
export function parseOmpModels(stdout: string): ModelChoice[] {
  let v: unknown;
  try {
    v = JSON.parse(stdout);
  } catch {
    return [];
  }
  const rows = v !== null && typeof v === "object" && "models" in v && Array.isArray(v.models) ? v.models : [];
  return rows.flatMap((r: unknown): ModelChoice[] => {
    if (r === null || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const selector = str(o.selector);
    const provider = str(o.provider);
    if (!selector || !provider || !SELECTOR_RE.test(selector) || (o.kind != null && o.kind !== "chat")) return [];
    const thinking = Array.isArray(o.thinking) ? o.thinking.filter((t): t is string => typeof t === "string") : [];
    return [{ selector, provider, name: str(o.name) ?? selector, thinking }];
  });
}

/** 10 min cache; one `omp models` at a time. A failed run keeps the last list (or none). */
export function ompModels(now = Date.now()): Promise<ModelChoice[]> {
  if (cache && now - cache.at < TTL_MS) return Promise.resolve(cache.list);
  inflight ??= new Promise<ModelChoice[]>((resolve) => {
    execFile("omp", ["models", "--json"], { timeout: 30_000, windowsHide: true, maxBuffer: 16 << 20, env: childEnv() }, (err, stdout) => {
      const list = err ? [] : parseOmpModels(String(stdout));
      if (list.length > 0) cache = { at: Date.now(), list };
      resolve(list.length > 0 ? list : (cache?.list ?? []));
    });
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

export const modelStateFile = (id: string, dir = stateDir()) => path.join(dir, "omp-model", `${id}.json`);

/** What the room's extension last wrote; null when it never did (older extension) or the file is not that. */
export function readRoomModel(id: string, dir = stateDir()): RoomModel | null {
  if (!isOmpRoomId(id)) return null;
  let v: unknown;
  try {
    v = JSON.parse(fs.readFileSync(modelStateFile(id, dir), "utf8"));
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return { model: str(o.model), thinking: str(o.thinking), error: str(o.error), at: typeof o.at === "number" ? o.at : 0 };
}
