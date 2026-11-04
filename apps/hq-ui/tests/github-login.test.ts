import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetFlows, allowedRole, MAX_FLOWS, pollFlow, readGithubConfig, startFlow, type Fetch } from "@/lib/server/github-login";

const cfg = {
  clientId: "Iv1.abcdef123456",
  allow: [
    { login: "8syncdev", role: "owner" as const },
    { login: "Quin19FD", role: "owner" as const },
  ],
};

/** A fake GitHub: device code, then token answers in order, then `/user`. */
function github(tokenAnswers: object[], login = "quin19fd") {
  const calls: string[] = [];
  const f: Fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/login/device/code")) return Response.json({ device_code: "dc", user_code: "ABCD-1234", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 });
    if (u.endsWith("/login/oauth/access_token")) return Response.json(tokenAnswers.shift() ?? { error: "expired_token" });
    if (u.endsWith("/user")) return Response.json({ login });
    return new Response(null, { status: 404 });
  };
  return { f, calls };
}

beforeEach(() => __resetFlows());

describe("github sign-in", () => {
  it("lets an allowed login in whatever its case, after GitHub stops saying pending", async () => {
    const gh = github([{ error: "authorization_pending" }, { access_token: "gho_x" }]);
    const s = await startFlow(cfg, gh.f, 0);
    if ("error" in s) throw new Error(s.error);
    expect(s.userCode).toBe("ABCD-1234");
    expect(await pollFlow(cfg, s.id, gh.f, 1000)).toEqual({ state: "pending" });
    expect(gh.calls.filter((c) => c.endsWith("access_token"))).toHaveLength(0);
    expect(await pollFlow(cfg, s.id, gh.f, 5000)).toEqual({ state: "pending" });
    expect(await pollFlow(cfg, s.id, gh.f, 10_000)).toEqual({ state: "ok", login: "quin19fd" });
    expect((await pollFlow(cfg, s.id, gh.f, 20_000)).state).toBe("gone");
  });

  it("refuses a GitHub account that is not on the allow list", async () => {
    const gh = github([{ access_token: "gho_x" }], "someone-else");
    const s = await startFlow(cfg, gh.f, 0);
    if ("error" in s) throw new Error(s.error);
    expect(await pollFlow(cfg, s.id, gh.f, 5000)).toEqual({ state: "denied", login: "someone-else" });
  });

  it("backs off on slow_down and drops an expired or unknown flow", async () => {
    const gh = github([{ error: "slow_down" }]);
    const s = await startFlow(cfg, gh.f, 0);
    if ("error" in s) throw new Error(s.error);
    expect(await pollFlow(cfg, s.id, gh.f, 5000)).toEqual({ state: "pending" });
    await pollFlow(cfg, s.id, gh.f, 14_000);
    expect(gh.calls.filter((c) => c.endsWith("access_token"))).toHaveLength(1);
    expect((await pollFlow(cfg, s.id, gh.f, 901_000)).state).toBe("gone");
    expect((await pollFlow(cfg, "0".repeat(32), gh.f, 0)).state).toBe("gone");
  });

  it("caps pending sign-ins", async () => {
    const gh = github([]);
    for (let i = 0; i < MAX_FLOWS; i++) expect("id" in (await startFlow(cfg, gh.f, 0))).toBe(true);
    expect("error" in (await startFlow(cfg, gh.f, 0))).toBe(true);
  });

  it("is off without a client id; an empty allow keeps it for invites bound to a GitHub login", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-gh-"));
    const file = path.join(dir, "github.json");
    expect(readGithubConfig(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ client_id: "nope", allow: ["8syncdev"] }));
    expect(readGithubConfig(file)).toBeNull();
    fs.writeFileSync(file, JSON.stringify({ client_id: "Iv1.abcdef123456", allow: [] }));
    expect(readGithubConfig(file)).toEqual({ clientId: "Iv1.abcdef123456", allow: [] });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads plain logins as the owner (back-compat) and {login, role} as a guest role; drops bad entries", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-gh-"));
    const file = path.join(dir, "github.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        client_id: "Iv1.abcdef123456",
        allow: ["8syncdev", "bad login!", { login: "Editor-1", role: "editor" }, { login: "viewer1", role: "viewer" }, { login: "x", role: "admin" }, { login: "bad login", role: "viewer" }, 42],
      }),
    );
    const c = readGithubConfig(file)!;
    expect(c.allow).toEqual([
      { login: "8syncdev", role: "owner" },
      { login: "Editor-1", role: "editor" },
      { login: "viewer1", role: "viewer" },
    ]);
    expect(allowedRole(c, "8SyncDev")).toBe("owner");
    expect(allowedRole(c, "editor-1")).toBe("editor");
    expect(allowedRole(c, "VIEWER1")).toBe("viewer");
    expect(allowedRole(c, "x")).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
