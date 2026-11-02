import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/omp/accounts/route";
import { getToken } from "@/lib/server/auth";
import { maskEmail, ompAgentDir, readOmpAccounts, scrub } from "@/lib/server/omp-accounts";
import { req, tempHome } from "./helpers";

const SECRET = "refresh-SECRET-do-not-leak";

/** An omp agent.db with the two tables HQ reads, shaped like omp 18's. */
function fakeAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-agent-"));
  const db = new DatabaseSync(path.join(dir, "agent.db"));
  db.exec(`
    CREATE TABLE auth_credentials (id INTEGER PRIMARY KEY, provider TEXT, credential_type TEXT, data TEXT, disabled_cause TEXT, identity_key TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE usage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT, account_key TEXT, email TEXT, account_id TEXT, limit_id TEXT, label TEXT, window_label TEXT, used_fraction REAL, status TEXT, resets_at INTEGER, recorded_at INTEGER);
  `);
  const cred = db.prepare("INSERT INTO auth_credentials VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  cred.run(1, "openai-codex", "oauth", JSON.stringify({ refresh: SECRET }), null, "email:alice.wong@example.com", 1, 1_786_000_000);
  cred.run(2, "openai-codex", "oauth", JSON.stringify({ refresh: SECRET }), "deleted by user", "email:gone@example.com", 1, 1);
  cred.run(3, "anthropic", "oauth", JSON.stringify({ refresh: SECRET }), `oauth refresh failed: Bearer ${SECRET}`, "email:bob@example.com|org:Acme", 1, 1);
  cred.run(4, "zai", "api_key", JSON.stringify({ key: SECRET }), null, null, 1, 1);
  const use = db.prepare(
    "INSERT INTO usage_history (provider, account_key, email, account_id, limit_id, label, window_label, used_fraction, status, resets_at, recorded_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)",
  );
  use.run("openai-codex", "oauth|email:alice.wong@example.com", "alice.wong@example.com", "7d", "7 days", "7 Day", 0.1, "ok", 1_900_000_000_000, 1_000);
  use.run("openai-codex", "oauth|email:alice.wong@example.com", "alice.wong@example.com", "7d", "7 days", "7 Day", 0.42, "ok", 1_900_000_000_000, 2_000);
  use.run("openai-codex", "oauth|email:gone@example.com", "gone@example.com", "7d", "7 days", "7 Day", 0.9, "ok", null, 2_000);
  use.run("anthropic", "oauth|email:bob@example.com|org:Acme", "bob@example.com", "5h", "Claude 5 Hour", "5 Hour", 0.8, "warning", 1_900_000_000, 3_000);
  use.run("openai-codex", "oauth|email:alice.wong@example.com", "alice.wong@example.com", "legacy", "Old window", null, 0.5, "ok", null, 2_000 - 2 * 86_400_000);
  use.run("zai", "api_key|zai-key", null, "tok", "ZAI 5 Hours Token Quota", null, 0.05, "ok", null, 4_000);
  use.run("zai", "api_key|zai-key", null, "tok-same-pool", "ZAI 5 Hours Token Quota", null, 0.05, "ok", null, 4_000);
  db.close();
  return dir;
}

describe("omp accounts (Hạn mức)", () => {
  it("lists every live login with its newest window per limit, emails masked; deleted logins, retired windows and secrets left out", () => {
    const r = readOmpAccounts(fakeAgentDir(), 5_000);
    expect(r.available).toBe(true);
    expect(r.accounts.map((a) => a.id)).toEqual([3, 1, 4]);
    const alice = r.accounts.find((a) => a.id === 1)!;
    expect(alice.who).toBe("alic…@example.com");
    expect(alice.limits).toEqual([expect.objectContaining({ id: "7d", used_fraction: 0.42, read_at: 2_000, resets_at: 1_900_000_000_000 })]);
    const bob = r.accounts.find((a) => a.id === 3)!;
    expect(bob.who).toBe("bo…@example.com · Acme");
    expect(bob.broken).toContain("oauth refresh failed");
    expect(bob.limits[0]).toMatchObject({ label: "Claude 5 Hour", resets_at: 1_900_000_000_000 }); // seconds → ms
    const zai = r.accounts.find((a) => a.id === 4)!;
    expect(zai.who).toBeNull();
    expect(zai.limits.map((l) => l.id)).toEqual(["tok"]); // the provider's only series; one pool reported twice shows once
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain("gone@");
  });

  it("is unavailable, not an error, when omp is not on the machine", () => {
    expect(readOmpAccounts(path.join(os.tmpdir(), "no-omp-here"), 1)).toEqual({ available: false, at: 1, accounts: [] });
  });

  it("finds omp's folder like omp does and masks short addresses too", () => {
    expect(ompAgentDir({ PI_CODING_AGENT_DIR: path.resolve("/x/agent") }, "/h")).toBe(path.resolve("/x/agent"));
    expect(ompAgentDir({}, path.resolve("/h"))).toBe(path.join(path.resolve("/h"), ".omp", "agent"));
    expect(maskEmail("atus@8syncdev.com")).toBe("atu…@8syncdev.com");
    expect(scrub(`token sk-${"a".repeat(30)} in D:/work/shop/src/app.tsx`)).toBe("token [ẩn] in D:/work/shop/src/app.tsx");
  });

  it("serves the list to the HQ owner only", async () => {
    tempHome();
    process.env.PI_CODING_AGENT_DIR = fakeAgentDir();
    try {
      expect((await GET(req("/api/omp/accounts"))).status).toBe(401);
      const res = await GET(req("/api/omp/accounts", { token: getToken() }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { accounts: unknown[] };
      expect(body.accounts).toHaveLength(3);
    } finally {
      delete process.env.PI_CODING_AGENT_DIR;
    }
  });
});
