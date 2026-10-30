import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coreCall } from "@/lib/server/core";

let server: http.Server;
let base = "";
const seen: { path: string; token: string | undefined; body: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", token: req.headers["x-core-token"] as string | undefined, body });
      if (req.headers["x-core-token"] !== "t0k") return void res.writeHead(401).end('{"error":"token"}');
      if (req.url === "/v1/disk?root=x") return void res.writeHead(422).end('{"error":"no root"}');
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ path: req.url, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("core client", () => {
  it("is off without HQ_CORE: callers fall back to their own probe", async () => {
    expect(await coreCall("/v1/agents", {}, {})).toBeNull();
    expect(await coreCall("/v1/agents", {}, { HQ_CORE: base })).toBeNull();
  });

  it("sends the token, GETs without a body and POSTs JSON", async () => {
    const env = { HQ_CORE: base, HQ_CORE_TOKEN: "t0k" };
    expect(await coreCall("/v1/ls", {}, env)).toEqual({ status: 200, body: { path: "/v1/ls", body: null } });
    expect(await coreCall("/v1/usage", { body: { roots: ["/r"] } }, env)).toEqual({ status: 200, body: { path: "/v1/usage", body: { roots: ["/r"] } } });
    expect(seen.at(-1)?.token).toBe("t0k");
    expect(await coreCall("/v1/disk?root=x", {}, env)).toEqual({ status: 422, body: { error: "no root" } });
    expect((await coreCall("/v1/ls", {}, { ...env, HQ_CORE_TOKEN: "bad" }))?.status).toBe(401);
  });

  it("answers null when the core is gone", async () => {
    expect(await coreCall("/v1/ls", { timeoutMs: 500 }, { HQ_CORE: "http://127.0.0.1:1", HQ_CORE_TOKEN: "t0k" })).toBeNull();
  });
});
