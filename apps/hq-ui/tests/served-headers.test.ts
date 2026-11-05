// The headers a browser really gets for an artifact: the BUILT server (`next build` first; skipped
// without .next/BUILD_ID), started on a free port 8752-8759 against this file's temp HOME. Route-level
// tests cannot show this: next.config.ts headers are applied first and a route's header of the same name
// is then dropped, so only the wire tells whether the sandbox CSP is the one in force.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getToken } from "@/lib/server/auth";

const ROOT = path.resolve(import.meta.dirname, "..");
const built = fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));

const free = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

type Got = { status: number; headers: http.IncomingHttpHeaders; body: string };
function call(port: number, p: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<Got> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const r = http.request(
      { host: "127.0.0.1", port, path: p, method: opts.method ?? "GET", headers: { ...(body ? { "content-type": "application/json" } : {}), ...opts.headers } },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    r.once("error", reject);
    r.end(body);
  });
}

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawn(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
}

describe.skipIf(!built)("built server: artifact headers on the wire", () => {
  let server: ChildProcess | null = null;
  let port = 0;
  let token = "";
  const src: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (let p = 8752; p <= 8759 && !port; p++) if (await free(p)) port = p;
    if (!port) throw new Error("no free port in 8752-8759");
    token = getToken(); // written under this file's temp HOME; the server below reads the same file
    const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "production", PORT: undefined, EIGHTSYNC_BIN: undefined };
    server = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: ROOT,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    // Ready = next's own "Ready in" line; an exit before it fails with the server's output.
    await new Promise<void>((resolve, reject) => {
      let log = "";
      const onData = (c: Buffer) => {
        log += c;
        if (/Ready in/.test(log)) resolve();
      };
      server!.stdout?.on("data", onData);
      server!.stderr?.on("data", onData);
      server!.once("exit", (code) => reject(new Error(`next start exited (${code}): ${log}`)));
    });

    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-wire-")));
    fs.mkdirSync(path.join(repo, ".git"));
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    const files = {
      svg: ["logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(document.cookie)</script></svg>"],
      html: ["page.html", "<script>fetch('/api/artifacts')</script>"],
      md: ["notes.md", "# x"],
    } as const;
    const auth = { "x-hq-token": token, origin: `http://127.0.0.1:${port}` };
    const proj = await call(port, "/api/projects", { method: "POST", headers: auth, body: { path: repo } });
    expect(proj.status, proj.body).toBeLessThan(300);
    for (const [k, [name, data]] of Object.entries(files)) {
      const f = path.join(repo, name);
      fs.writeFileSync(f, data);
      const r = await call(port, "/api/artifacts", { method: "POST", headers: auth, body: { path: f } });
      expect(r.status, r.body).toBe(201);
      ids[k] = (JSON.parse(r.body) as { artifact: { id: string } }).artifact.id;
    }
    const list = JSON.parse((await call(port, "/api/artifacts", { headers: { "x-hq-token": token } })).body) as { artifacts: { id: string; src: string }[] };
    for (const [k, id] of Object.entries(ids)) src[k] = list.artifacts.find((a) => a.id === id)!.src;
  }, 90_000);

  afterAll(async () => {
    if (server) {
      killTree(server);
      const s = server;
      await new Promise<void>((r) => (s.exitCode !== null || s.signalCode !== null ? r() : s.once("exit", () => r())));
    }
    if (port) expect(await free(port)).toBe(true);
  }, 30_000);

  const sandboxed = (h: http.IncomingHttpHeaders) => {
    const csp = String(h["content-security-policy"] ?? "");
    expect(csp.startsWith("sandbox;")).toBe(true);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
  };

  it("an SVG or HTML signed URL opened as a page is a sandboxed octet-stream download", async () => {
    for (const k of ["svg", "html"])
      for (const dest of ["document", "iframe", null]) {
        const r = await call(port, src[k], { headers: dest ? { "sec-fetch-dest": dest } : {} });
        expect(r.status).toBe(200);
        sandboxed(r.headers);
        expect(r.headers["content-type"]).toBe("application/octet-stream");
        expect(r.headers["content-disposition"]).toMatch(/^attachment; filename="/);
      }
  });

  it("the same SVG as HQ's <img> stays an inline image, still under the sandbox CSP", async () => {
    const r = await call(port, src.svg, { headers: { "sec-fetch-dest": "image" } });
    expect(r.status).toBe(200);
    sandboxed(r.headers);
    expect(r.headers["content-type"]).toBe("image/svg+xml");
    expect(r.headers["content-disposition"]).toMatch(/^inline/);
  });

  it("the HTML token fetch (HQ's srcdoc frame) gets the text inline, sandboxed", async () => {
    const r = await call(port, `/api/artifacts/${ids.html}/file`, { headers: { "x-hq-token": token, "sec-fetch-dest": "empty" } });
    expect(r.status).toBe(200);
    sandboxed(r.headers);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.body).toContain("<script>");
  });

  it("the PDF route is sandboxed too, while HQ's own pages keep the plain frame-ancestors policy", async () => {
    const pdf = await call(port, `/api/artifacts/${ids.md}/pdf`, { headers: { "x-hq-token": token } });
    expect(pdf.status).toBe(422);
    sandboxed(pdf.headers);
    const page = await call(port, "/api/artifacts", { headers: { "x-hq-token": token } });
    expect(page.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  });
});
