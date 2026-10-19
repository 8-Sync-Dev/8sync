import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE, GET, POST } from "@/app/api/shell/route";
import { __setNonceForTest, getToken, PUB_COOKIE, sessionCookie } from "@/lib/server/auth";
import { publicPath } from "@/lib/server/paths";
import { SHELL_KEY, termOpen } from "@/lib/server/term";
import { tempHome } from "./helpers";

const HOST = "calm-river-42.trycloudflare.com";
const KEY = "e".repeat(64);
let token = "";

beforeAll(() => {
  tempHome();
  token = getToken();
  const nonce = "f".repeat(64);
  __setNonceForTest(nonce);
  fs.mkdirSync(path.dirname(publicPath()), { recursive: true });
  fs.writeFileSync(publicPath(), JSON.stringify({ v: 1, host: HOST, key: KEY, since: Date.now(), nonce }));
});
afterAll(() => {
  fs.rmSync(publicPath(), { force: true });
  __setNonceForTest("");
});

/** A request through the `--public` quick tunnel with a valid login cookie and the HQ token. */
function viaQuickTunnel(method: string, body?: unknown): Request {
  const headers = new Headers({
    host: HOST,
    "x-hq-token": token,
    cookie: `${PUB_COOKIE}=${sessionCookie(KEY, Date.now())}`,
    "cf-ray": "8f00000000000000-SIN",
    origin: `https://${HOST}`,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://${HOST}/api/shell`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("/api/shell through the --public quick tunnel", () => {
  it("never opens or types into a shell: the link key alone must not give a shell on the PC", async () => {
    const get = await GET(viaQuickTunnel("GET"));
    expect(get.status).toBe(403);
    expect(termOpen(SHELL_KEY)).toBe(false);
    expect((await POST(viaQuickTunnel("POST", { data: "whoami\r" }))).status).toBe(403);
  });

  it("the same signed-in page still reaches the rest of the API (the refusal is the shell's own)", async () => {
    expect((await DELETE(viaQuickTunnel("DELETE"))).status).toBe(200);
  });
});
