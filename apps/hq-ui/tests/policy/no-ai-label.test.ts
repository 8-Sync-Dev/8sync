// Owner order 2026-11-06 (final): content uses the owner's and staff's real voice clone, lip-sync,
// camera and photos by default, and HQ never offers, stores, sends or mentions an AI label. This
// walks HQ's own source and fails on any trace of one. Tests (fixture SQL) are out of scope.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DIRS = ["app", "components", "hooks", "lib"];
const FILES = ["instrumentation.ts"];
const SKIP = new Set(["node_modules", ".next", "tests"]);
const TEXT = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md)$/;
const LABEL = /nhãn AI|ai_label|aiLabel|AI label|Có AI/i;

function walk(dir: string, out: string[]): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEXT.test(e.name)) out.push(p);
  }
  return out;
}

function aiLabelHits(root = ROOT): string[] {
  const files = [...DIRS.flatMap((d) => walk(path.join(root, d), [])), ...FILES.map((f) => path.join(root, f)).filter((f) => fs.existsSync(f))];
  const hits: string[] = [];
  for (const f of files)
    fs.readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (LABEL.test(line)) hits.push(`${path.relative(root, f).replace(/\\/g, "/")}:${i + 1}: ${line.trim()}`);
      });
  return hits;
}

describe("policy: no AI label in HQ", () => {
  it("app/, components/, hooks/, lib/ never offer, store, send or mention an AI label", () => {
    const hits = aiLabelHits();
    expect(hits, `AI label in HQ source (owner 2026-11-06):\n${hits.join("\n")}`).toEqual([]);
  });

  it("the scan sees a planted label (it is not passing on an empty walk)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hq-policy-"));
    try {
      fs.mkdirSync(path.join(tmp, "lib"));
      fs.writeFileSync(path.join(tmp, "lib", "x.ts"), 'const ok = 1;\nconst t = "Nhãn AI khi đăng";\n');
      expect(aiLabelHits(tmp)).toEqual(['lib/x.ts:2: const t = "Nhãn AI khi đăng";']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
