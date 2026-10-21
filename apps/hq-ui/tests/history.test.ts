import { beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/machine/route";
import { getToken } from "@/lib/server/auth";
import { HISTORY_EVERY_MS, HISTORY_KEEP, history, push, recent, sampleOnce, type Sample } from "@/lib/server/history";
import { req, tempHome } from "./helpers";

const NOW = 1_800_000_000_000;
const s = (at: number, ram = 50): Sample => ({ at, ram, cpu: 20, w: 100 });

describe("Tải máy history (owner 2026-10-21: no chart)", () => {
  it("push keeps the newest HISTORY_KEEP samples, oldest first", () => {
    let all: Sample[] = [];
    for (let i = 0; i < HISTORY_KEEP + 5; i++) all = push(all, s(NOW + i * HISTORY_EVERY_MS));
    expect(all).toHaveLength(HISTORY_KEEP);
    expect(all[0].at).toBe(NOW + 5 * HISTORY_EVERY_MS);
    expect(all[all.length - 1].at).toBe(NOW + (HISTORY_KEEP + 4) * HISTORY_EVERY_MS);
  });

  it("a sample inside half a period of the last replaces it: a poll and the timer never double up", () => {
    const two = push(push([], s(NOW, 40)), s(NOW + HISTORY_EVERY_MS / 2 - 1, 60));
    expect(two).toEqual([s(NOW + HISTORY_EVERY_MS / 2 - 1, 60)]);
    expect(push(two, s(NOW + HISTORY_EVERY_MS, 70))).toHaveLength(2);
  });

  it("recent: the last 30 minutes only, nothing from the future", () => {
    const all = [s(NOW - 31 * 60_000), s(NOW - 29 * 60_000), s(NOW), s(NOW + 1)];
    expect(recent(all, NOW).map((x) => x.at)).toEqual([NOW - 29 * 60_000, NOW]);
  });

  it("sampleOnce records RAM and CPU of this machine; /api/machine returns the history", async () => {
    tempHome();
    await sampleOnce(NOW);
    const h = history(NOW);
    expect(h).toHaveLength(1);
    expect(h[0].ram).toBeGreaterThan(0);
    expect(h[0].ram).toBeLessThanOrEqual(100);
    const r = await GET(req("/api/machine", { token: getToken() }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { history: Sample[] };
    expect(Array.isArray(body.history)).toBe(true);
  });
});
