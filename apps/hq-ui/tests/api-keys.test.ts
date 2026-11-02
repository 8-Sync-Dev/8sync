import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE } from "@/app/api/omp/keys/[id]/route";
import { GET as listModels } from "@/app/api/omp/keys/models/route";
import { GET as listKeysRoute, POST as createKeyRoute } from "@/app/api/omp/keys/route";
import { GET as proxyGet, POST as proxyPost } from "@/app/api/omp/v1/[...path]/route";
import { callSource, summarize } from "@/lib/server/api-keys";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { resetGateway } from "@/lib/server/omp-gateway";
import { ORIGIN, req, tempHome } from "./helpers";

/** A stand-in omp gateway: its own bearer, a catalog with Claude in it, chat completions with usage (stream or not). */
const seen: { auth: string | null; body: Record<string, unknown> }[] = [];
const upstream = http.createServer((rq, rs) => {
  let raw = "";
  rq.on("data", (c) => (raw += c));
  rq.on("end", () => {
    if (rq.headers.authorization !== "Bearer gw-test") {
      rs.writeHead(401).end();
      return;
    }
    if (rq.url === "/v1/models") {
      rs.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          object: "list",
          data: [
            { id: "openai-codex/gpt-5.4", owned_by: "openai-codex" },
            { id: "gpt-5.4-mini", owned_by: "openai-codex" },
            { id: "anthropic/claude-opus-4-6", owned_by: "anthropic" },
            { id: "google-antigravity/claude-sonnet-4-6", owned_by: "google-antigravity" },
          ],
        }),
      );
      return;
    }
    const body = JSON.parse(raw) as Record<string, unknown>;
    seen.push({ auth: rq.headers.authorization ?? null, body });
    if (body.stream) {
      rs.writeHead(200, { "content-type": "text/event-stream" });
      rs.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "chào" } }] })}\n\n`);
      rs.end(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 30, completion_tokens: 7 } })}\n\ndata: [DONE]\n\n`);
      return;
    }
    rs.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 12, completion_tokens: 5 } }));
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  process.env.OMP_GATEWAY_URL = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  process.env.OMP_GATEWAY_TOKEN = "gw-test";
});
afterAll(() => {
  upstream.close();
  delete process.env.OMP_GATEWAY_URL;
  delete process.env.OMP_GATEWAY_TOKEN;
});
beforeEach(() => {
  tempHome();
  resetGateway();
  seen.length = 0;
});

const owner = (path: string, method = "GET", body?: unknown) => req(path, { method, token: getToken(), origin: method === "GET" ? null : ORIGIN, body });

async function newKey(models = ["openai-codex/gpt-5.4"]): Promise<{ id: string; token: string }> {
  const res = await createKeyRoute(owner("/api/omp/keys", "POST", { label: "Minh", models }));
  expect(res.status).toBe(201);
  const r = (await res.json()) as { key: { id: string }; token: string };
  return { id: r.key.id, token: r.token };
}

/** A call to the member door: `from: "member"` comes through the Cloudflare tunnel, "owner" is a plain local call. */
function call(sub: string[], init: { token?: string; root?: string; from?: "member" | "owner"; body?: unknown; host?: string }) {
  const headers = new Headers({ host: init.host ?? "127.0.0.1:8740" });
  if (init.token) headers.set("authorization", `Bearer ${init.token}`);
  if (init.root) headers.set("x-8sync-root", init.root);
  if (init.from !== "owner") headers.set("cf-connecting-ip", "203.0.113.7");
  const r = new Request(`${ORIGIN}/api/omp/v1/${sub.join("/")}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const ctx = { params: Promise.resolve({ path: sub }) };
  return init.body === undefined ? proxyGet(r, ctx) : proxyPost(r, ctx);
}

const callRows = () => getDb().prepare("SELECT * FROM api_key_calls ORDER BY id").all() as Record<string, unknown>[];
const chat = (model: string, text: string, extra: Record<string, unknown> = {}) => ({ model, messages: [{ role: "system", content: "be brief" }, { role: "user", content: text }], ...extra });

describe("member API keys", () => {
  it("grants only gateway models that are not Claude", async () => {
    const res = await listModels(owner("/api/omp/keys/models"));
    expect(((await res.json()) as { models: string[] }).models).toEqual(["openai-codex/gpt-5.4", "openai-codex/gpt-5.4-mini"]);
    const claude = await createKeyRoute(owner("/api/omp/keys", "POST", { label: "x", models: ["google-antigravity/claude-sonnet-4-6"] }));
    expect(claude.status).toBe(422);
  });

  it("stores only a hash and prefix; the key is shown once", async () => {
    const { token } = await newKey();
    expect(token).toMatch(/^8sk_[A-Za-z0-9_-]{43}$/);
    const list = (await (await listKeysRoute(owner("/api/omp/keys"))).json()) as { keys: { prefix: string }[] };
    expect(list.keys).toEqual([expect.objectContaining({ label: "Minh", prefix: token.slice(0, 12), models: ["openai-codex/gpt-5.4"] })]);
    expect(JSON.stringify(list)).not.toContain(token);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM api_keys").all())).not.toContain(token);
  });

  it("creates and revokes keys only from this machine, not through the public link", async () => {
    const viaTunnel = req("/api/omp/keys", { method: "POST", token: getToken(), origin: ORIGIN, body: { label: "x", models: ["openai-codex/gpt-5.4"] } });
    viaTunnel.headers.set("cf-ray", "abc");
    expect((await createKeyRoute(viaTunnel)).status).toBe(403);
  });

  it("logs a member call with its project root, a short summary and tokens, and forwards with the gateway's own bearer", async () => {
    const { id, token } = await newKey();
    const res = await call(["chat", "completions"], { token, root: "D:/work/shop", body: chat("openai-codex/gpt-5.4", "Sửa lỗi giỏ hàng   khi\nthanh toán") });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].auth).toBe("Bearer gw-test");
    const [row] = callRows();
    expect(row).toMatchObject({ key_id: id, root: "D:/work/shop", route: "chat/completions", model: "openai-codex/gpt-5.4", summary: "Sửa lỗi giỏ hàng khi thanh toán", status: 200, input_tokens: 12, output_tokens: 5, source: "tunnel" });

    const view = (await (await listKeysRoute(owner("/api/omp/keys"))).json()) as { calls: { project: string; label: string }[]; stats: { calls: number }[]; keys: { last_used_at: number | null }[] };
    expect(view.calls[0]).toMatchObject({ project: "shop", label: "Minh" });
    expect(view.stats[0]).toMatchObject({ key_id: id, calls: 1, ok: 1, input_tokens: 12, output_tokens: 5, projects: 1 });
    expect(view.keys[0].last_used_at).not.toBeNull();
  });

  it("reads token usage from a streamed answer", async () => {
    const { token } = await newKey();
    const res = await call(["chat", "completions"], { token, root: "/home/an/blog", body: chat("openai-codex/gpt-5.4", "viết bài", { stream: true }) });
    expect(await res.text()).toContain("[DONE]");
    expect(callRows()[0]).toMatchObject({ root: "/home/an/blog", input_tokens: 30, output_tokens: 7 });
  });

  it("does not log calls from the owner's own machine", async () => {
    const { token } = await newKey();
    const res = await call(["chat", "completions"], { token, from: "owner", body: chat("openai-codex/gpt-5.4", "test local") });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(callRows()).toHaveLength(0);
    expect((getDb().prepare("SELECT last_used_at FROM api_keys").get() as { last_used_at: number | null }).last_used_at).toBeNull();
  });

  it("refuses a member call without X-8sync-Root, a model outside the key, and a revoked key", async () => {
    const { id, token } = await newKey();
    expect((await call(["chat", "completions"], { token, body: chat("openai-codex/gpt-5.4", "x") })).status).toBe(400);
    const denied = await call(["chat", "completions"], { token, root: "D:/w/a", body: chat("openai-codex/gpt-5.4-mini", "x") });
    expect(denied.status).toBe(403);
    expect(callRows()).toEqual([expect.objectContaining({ status: 403, model: "openai-codex/gpt-5.4-mini" })]);
    expect(seen).toHaveLength(0);

    expect((await DELETE(owner(`/api/omp/keys/${id}`, "DELETE"), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await call(["chat", "completions"], { token, root: "D:/w/a", body: chat("openai-codex/gpt-5.4", "x") })).status).toBe(401);
    expect((await call(["chat", "completions"], { token: "8sk_wrong", root: "D:/w/a", body: chat("openai-codex/gpt-5.4", "x") })).status).toBe(401);
    expect(callRows()).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it("lists to a key only its own models and never proxies other routes", async () => {
    const { token } = await newKey(["openai-codex/gpt-5.4-mini"]);
    const res = await call(["models"], { token, root: "D:/w/a" });
    expect(((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id)).toEqual(["gpt-5.4-mini"]);
    expect((await call(["usage"], { token, root: "D:/w/a" })).status).toBe(404);
    expect((await call(["models"], { token, root: "D:/w/a", host: "evil.example" })).status).toBe(403);
  });
});

describe("call source and summary", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("treats only a bare loopback call as the owner's", () => {
    expect(callSource(h({ host: "127.0.0.1:8740" }), null)).toBe("owner");
    // Next.js sets x-forwarded-for to the socket address itself: loopback there is still this machine.
    expect(callSource(h({ host: "127.0.0.1:8740", "x-forwarded-for": "::1", "x-forwarded-host": "127.0.0.1:8740" }), null)).toBe("owner");
    expect(callSource(h({ host: "127.0.0.1:8740", "x-forwarded-for": "::ffff:127.0.0.1" }), null)).toBe("owner");
    expect(callSource(h({ host: "localhost:8740", "x-forwarded-for": "10.0.0.2, 127.0.0.1" }), null)).toBe("proxy");
    expect(callSource(h({ host: "localhost:8740", forwarded: 'for="[2001:db8::7]";proto=https' }), null)).toBe("proxy");
    expect(callSource(h({ host: "abc.trycloudflare.com", "cf-connecting-ip": "1.2.3.4" }), "abc.trycloudflare.com")).toBe("tunnel");
    expect(callSource(h({ host: "abc.trycloudflare.com" }), "abc.trycloudflare.com")).toBe("proxy");
    expect(callSource(h({ host: "evil.example" }), "abc.trycloudflare.com")).toBeNull();
  });

  it("keeps the last user message, short and without secrets", () => {
    expect(summarize({ messages: [{ role: "user", content: "first" }, { role: "assistant", content: "a" }, { role: "user", content: [{ type: "text", text: "second" }] }] })).toBe("second");
    expect(summarize({ input: "dùng key sk-abcdefghijklmnopqrstuvwxyz0123" })).toBe("dùng key [ẩn]");
    expect(summarize({ input: [{ role: "user", content: [{ type: "input_text", text: "x".repeat(10) + " y".repeat(300) }] }] })).toHaveLength(200);
    expect(summarize({ messages: [] })).toBeNull();
  });
});
