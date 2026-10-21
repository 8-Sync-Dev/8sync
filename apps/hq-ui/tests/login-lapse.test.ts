import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, loginLapsed, makeApi, RELOGIN_MS } from "@/components/hq/use-hq";

const store = new Map<string, string>();
const reload = vi.fn();
vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
vi.stubGlobal("location", { reload });

afterEach(() => {
  store.clear();
  reload.mockReset();
});

const lapsed = () => ({ type: "opaqueredirect", ok: false, status: 0 }) as unknown as Response;

describe("login lapse behind the VPS gate", () => {
  it("an opaque redirect reloads into the sign-in once per RELOGIN_MS, not in a loop", () => {
    expect(loginLapsed(lapsed(), 1_000_000)).toBe(true);
    expect(loginLapsed(lapsed(), 1_000_000 + 5_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    loginLapsed(lapsed(), 1_000_000 + RELOGIN_MS + 1);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("text in a box is not thrown away: no reload while something is typed", () => {
    vi.stubGlobal("document", { querySelectorAll: () => [{ value: "đang gõ dở" }] });
    try {
      expect(loginLapsed(lapsed(), 2_000_000)).toBe(true);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.stubGlobal("document", undefined);
    }
  });

  it("the API client asks for redirects by hand, and a lapse is an error, not empty data", async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => lapsed());
    vi.stubGlobal("fetch", fetch);
    await expect(makeApi("t")("/api/sessions")).rejects.toBeInstanceOf(ApiError);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a normal answer never reloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 })));
    await expect(makeApi("t")("/api/sessions")).resolves.toEqual({ ok: 1 });
    expect(reload).not.toHaveBeenCalled();
  });
});
