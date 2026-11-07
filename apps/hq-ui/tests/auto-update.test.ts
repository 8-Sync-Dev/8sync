import { beforeEach, describe, expect, it } from "vitest";
import { blockedWhy, newer, tagOf, updateNow, updateReset, type UpdateDeps } from "@/lib/server/auto-update";

describe("auto-update", () => {
  beforeEach(() => updateReset());

  it("orders versions like semver and never calls junk newer", () => {
    expect(newer("0.135.0", "0.134.0")).toBe(true);
    expect(newer("v0.134.10", "0.134.9")).toBe(true);
    expect(newer("0.134.0", "0.134.0")).toBe(false);
    expect(newer("0.133.9", "0.134.0")).toBe(false);
    expect(newer("1.0.0", "0.999.999")).toBe(true);
    expect(newer("0.135.0", "0.135.0-rc.1")).toBe(true);
    expect(newer("0.135.0-rc.1", "0.135.0")).toBe(false);
    expect(newer("0.135.0", null)).toBe(true);
    expect(newer(null, "0.1.0")).toBe(false);
    expect(newer("latest", "0.1.0")).toBe(false);
  });

  it("reads the tag from the releases/latest redirect only", () => {
    expect(tagOf("https://github.com/8-Sync-Dev/8sync/releases/tag/v0.135.0")).toBe("0.135.0");
    expect(tagOf("https://github.com/8-Sync-Dev/8sync/releases/tag/v0.135.0-rc.2")).toBe("0.135.0-rc.2");
    expect(tagOf("https://github.com/8-Sync-Dev/8sync/releases")).toBeNull();
    expect(tagOf("https://github.com/8-Sync-Dev/8sync/releases/tag/nightly")).toBeNull();
    expect(tagOf(null)).toBeNull();
  });

  it("never updates a dev checkout or an opted-out machine", () => {
    expect(blockedWhy({}, null)).toMatch(/dev/);
    expect(blockedWhy({ SUSYNC_NO_AUTO_UPDATE: "1" }, "0.134.0")).toMatch(/SUSYNC_NO_AUTO_UPDATE/);
    expect(blockedWhy({ EIGHTSYNC_OFFLINE: "true" }, "0.134.0")).toMatch(/OFFLINE/);
    expect(blockedWhy({ EIGHTSYNC_OFFLINE: "0" }, "0.134.0")).toBeNull();
  });

  function fake(o: { latest: string | null; bin: string; upTo?: string; upOk?: boolean; on?: boolean; blocked?: string | null }) {
    let bin = o.bin;
    const ups: string[][] = [];
    const saved: unknown[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const deps: UpdateDeps = {
      latest: async () => o.latest,
      binary: async () => bin,
      run: async (args) => {
        ups.push(args);
        await gate;
        if (o.upOk !== false) bin = o.upTo ?? o.latest ?? bin;
        return { ok: o.upOk !== false, stdout: "✓ installed", stderr: "" };
      },
      saveLastUp: (u) => saved.push(u),
      blocked: () => o.blocked ?? null,
      on: () => o.on ?? true,
    };
    return { deps, ups, saved, release };
  }

  it("runs 8sync up once when a newer release is out, even when asked twice at once", async () => {
    const f = fake({ latest: "0.135.0", bin: "0.134.0" });
    const a = updateNow(false, f.deps, () => 1000);
    const b = updateNow(false, f.deps, () => 1000);
    f.release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(f.ups).toEqual([["up"]]);
    expect(ra).toBe(rb);
    expect(ra).toMatchObject({ latest: "0.135.0", binary: "0.135.0", error: null, lastUp: { from: "0.134.0", to: "0.135.0", ok: true } });
    // Written down, since the update restarts this very server.
    expect(f.saved).toEqual([ra.lastUp]);
  });

  it("does nothing on the latest release, while off, or when blocked; the button checks while off", async () => {
    const same = fake({ latest: "0.134.0", bin: "0.134.0" });
    expect(await updateNow(false, same.deps)).toMatchObject({ latest: "0.134.0", lastUp: null });
    expect(same.ups).toEqual([]);
    updateReset();
    const off = fake({ latest: "0.135.0", bin: "0.134.0", on: false });
    expect((await updateNow(false, off.deps)).checkedAt).toBeNull();
    const blocked = fake({ latest: "0.135.0", bin: "0.134.0", blocked: "dev" });
    await updateNow(true, blocked.deps);
    expect(off.ups.length + blocked.ups.length).toBe(0);
    off.release();
    expect(await updateNow(true, off.deps)).toMatchObject({ binary: "0.135.0", lastUp: { ok: true } });
  });

  it("reports a failed or short update and an unreachable GitHub instead of claiming success", async () => {
    const bad = fake({ latest: "0.135.0", bin: "0.134.0", upOk: false });
    bad.release();
    expect(await updateNow(false, bad.deps)).toMatchObject({ binary: "0.134.0", lastUp: { ok: false }, error: expect.stringContaining("chưa lên được v0.135.0") });
    const short = fake({ latest: "0.135.0", bin: "0.134.0", upTo: "0.134.5" });
    short.release();
    expect((await updateNow(false, short.deps)).lastUp).toMatchObject({ ok: false, to: "0.135.0" });
    const offline = fake({ latest: null, bin: "0.134.0" });
    expect(await updateNow(false, offline.deps)).toMatchObject({ error: expect.stringContaining("GitHub") });
    expect(offline.ups).toEqual([]);
  });
});
