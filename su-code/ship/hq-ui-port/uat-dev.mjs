// C2 UAT (no model): `pnpm dev` in apps/hq-ui with HQ_UI_PORT=8791 must answer HTTP on 127.0.0.1:8791.
// Run from the repo root: `node su-code/ship/hq-ui-port/uat-dev.mjs`. Exit 0 = pass. Kills the whole
// process tree (pnpm -> scripts/next.mjs -> next) on every OS before it exits.
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";

const PORT = 8791;
const DEADLINE_MS = 120_000;
const dir = path.resolve("apps/hq-ui");

const free = () =>
  new Promise((resolve) => {
    const s = net.createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
    s.listen(PORT, "127.0.0.1");
  });

if (!(await free())) {
  console.log(`FAIL port ${PORT} already in use: a pass would prove nothing`);
  process.exit(1);
}

const win = process.platform === "win32";
const env = { ...process.env, HQ_UI_PORT: String(PORT), PORT: "" };
// pnpm is a .cmd on Windows, which needs a shell to start (one fixed string, nothing interpolated);
// pnpm then runs the dev script itself, which is what this checks.
const child = win
  ? spawn("pnpm dev", { cwd: dir, env, shell: true, stdio: ["ignore", "pipe", "pipe"] })
  : spawn("pnpm", ["dev"], { cwd: dir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

const killTree = () => {
  try {
    if (win) execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, "SIGTERM");
  } catch {}
};

let status = null;
const end = Date.now() + DEADLINE_MS;
while (Date.now() < end && child.exitCode === null) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
    status = r.status;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1_000));
  }
}
killTree();
let freed = false;
for (let i = 0; i < 20 && !freed; i++) {
  await new Promise((r) => setTimeout(r, 500));
  freed = await free();
}

const literal = /\$\{PORT|is not a port|Invalid project directory|EADDRINUSE/.test(log);
if (status !== null && !literal && freed) {
  console.log(`ok   pnpm dev answered HTTP ${status} on 127.0.0.1:${PORT}; process tree stopped, port free again`);
  process.exit(0);
}
// Next 16.4 stops an agent-run `next dev` once to print an upgrade notice (lib/upgrade/nudge.js) and lets a
// re-run within 5 minutes through; that is Next's gate, not the port, so say so instead of a bare FAIL.
if (/stopped to show the upgrade recommendation/.test(log)) {
  console.log("FAIL next stopped for its agent upgrade notice before listening; re-run within 5 minutes");
  process.exit(1);
}
console.log(`FAIL status=${status} exit=${child.exitCode} freed=${freed}\n${log.slice(-2000)}`);
process.exit(1);
