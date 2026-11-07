import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAmbiguous, parseExplain, parseGraphify, parsePath, parseWhere, relationVi } from "@/lib/graphify-answer";

// Real output of graphify 0.x on this repo (su-code), captured 2026-11-08: `graphify explain|path …` in the repo root.
const sample = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", "graphify", name), "utf8");

describe("parseWhere", () => {
  it("reads both spellings graphify prints, keeps a bare file, null for nothing", () => {
    expect(parseWhere("apps/hq-ui/lib/server/http.ts:L17")).toEqual({ file: "apps/hq-ui/lib/server/http.ts", line: 17 });
    expect(parseWhere("apps/hq-ui/lib/server/auth.ts L164")).toEqual({ file: "apps/hq-ui/lib/server/auth.ts", line: 164 });
    expect(parseWhere("app/api/sessions/[name]/term/route.ts:L4")).toEqual({ file: "app/api/sessions/[name]/term/route.ts", line: 4 });
    expect(parseWhere("post")).toEqual({ file: "post", line: null });
    expect(parseWhere("  ")).toBeNull();
    expect(parseWhere(undefined)).toBeNull();
  });
});

describe("parseExplain", () => {
  it("checkAuth(): node fields, callers, callees and the rest", () => {
    const x = parseExplain(sample("explain-checkauth.txt"))!;
    expect(x).toMatchObject({ kind: "explain", name: "checkAuth()", id: "apps_hq_ui_lib_server_auth_checkauth", type: "code", degree: 6, more: 0 });
    expect(x.where).toEqual({ file: "apps/hq-ui/lib/server/auth.ts", line: 164 });
    expect(x.callers).toEqual([{ dir: "in", name: "open()", relation: "calls", confidence: "EXTRACTED", where: { file: "apps/hq-ui/lib/server/http.ts", line: 17 } }]);
    expect(x.callees.map((l) => [l.name, l.where?.line])).toEqual([
      ["sideOf()", 170],
      ["safeEqual()", 172],
    ]);
    expect(x.related.map((l) => [l.dir, l.name, l.relation])).toEqual([
      ["in", "auth.ts", "contains"],
      ["in", "http.ts", "imports"],
      ["in", "auth.test.ts", "imports"],
    ]);
  });

  it("safeEqual(): many callers across files", () => {
    const x = parseExplain(sample("explain-safeequal.txt"))!;
    expect(x.degree).toBe(8);
    expect(x.callers.map((l) => l.name)).toEqual(["readPublic()", "checkAuth()", "playSigValid()", "sessionValid()", "GET()"]);
    expect(x.callees).toEqual([]);
    expect(x.callers.find((l) => l.name === "GET()")?.where).toEqual({ file: "apps/hq-ui/app/api/login/route.ts", line: 16 });
  });

  it("a route handler by id: callees only", () => {
    const x = parseExplain(sample("explain-projects-post.txt"))!;
    expect(x.name).toBe("POST()");
    expect(x.callees.map((l) => l.name)).toEqual(["open()", "json()", "bad()", "run()", "readBody()", "projectIdFor()", "validateProjectPath()", "validateNewProjectPath()"]);
    expect(x.callers).toEqual([]);
  });

  it("a busy node: the 20 listed, `... and 84 more`, the per-file summary not read as links", () => {
    const x = parseExplain(sample("explain-open-truncated.txt"))!;
    expect(x.degree).toBe(104);
    expect(x.callers.length + x.callees.length + x.related.length).toBe(20);
    expect(x.more).toBe(84);
    // Paths with brackets survive.
    expect(x.related.some((l) => l.where?.file === "apps/hq-ui/app/api/sessions/[name]/term/route.ts")).toBe(true);
    expect(x.related.every((l) => !l.name.includes("connections"))).toBe(true);
  });

  it("not an explain", () => {
    expect(parseExplain("hello")).toBeNull();
    expect(parseExplain("")).toBeNull();
  });
});

describe("parsePath", () => {
  it("one hop", () => {
    expect(parsePath(sample("path-checkauth-safeequal.txt"))).toEqual({
      kind: "path",
      hops: 1,
      confidence: "EXTRACTED",
      steps: [
        { name: "checkAuth()", via: null },
        { name: "safeEqual()", via: { relation: "calls", confidence: "EXTRACTED", back: false } },
      ],
    });
  });

  it("three hops, in order", () => {
    const p = parsePath(sample("path-post-safeequal.txt"))!;
    expect(p.hops).toBe(3);
    expect(p.steps.map((s) => s.name)).toEqual(["POST()", "open()", "checkAuth()", "safeEqual()"]);
    expect(p.steps.slice(1).every((s) => s.via?.relation === "calls")).toBe(true);
  });

  it("names with spaces and other relations; a reversed edge", () => {
    const p = parsePath("Shortest path (2 hops):\n  my file.ts --contains [EXTRACTED]--> run() <--imports [INFERRED]-- x.ts\nPath confidence: INFERRED")!;
    expect(p.steps).toEqual([
      { name: "my file.ts", via: null },
      { name: "run()", via: { relation: "contains", confidence: "EXTRACTED", back: false } },
      { name: "x.ts", via: { relation: "imports", confidence: "INFERRED", back: true } },
    ]);
    expect(p.confidence).toBe("INFERRED");
  });

  it("not a path", () => {
    expect(parsePath(sample("path-none.txt"))).toBeNull();
    expect(parsePath("Shortest path (1 hops):\n")).toBeNull();
  });
});

describe("parseGraphify", () => {
  it("ambiguous (exit 3, on stderr): every candidate with its file and id", () => {
    const a = parseGraphify("path", sample("path-ambiguous.txt"));
    expect(a.kind).toBe("ambiguous");
    if (a.kind !== "ambiguous") return;
    expect(a.query).toBe("open()");
    expect(a.candidates).toHaveLength(6);
    expect(a.candidates[1]).toEqual({ file: "apps/hq-ui/lib/server/http.ts", id: "apps_hq_ui_lib_server_http_open" });
    expect(parseAmbiguous("Ambiguous: 'x' matches 2 nodes\nRetry with …")).toBeNull();
  });

  it("missing (exit 4), no path, explain, path, anything else as text", () => {
    expect(parseGraphify("explain", sample("explain-missing.txt"))).toEqual({ kind: "missing", query: "nonexistent_zzz" });
    expect(parseGraphify("path", sample("path-none.txt"))).toEqual({ kind: "nopath", from: "safeEqual()", to: "validateProjectPath()" });
    expect(parseGraphify("explain", sample("explain-checkauth.txt")).kind).toBe("explain");
    expect(parseGraphify("path", sample("path-post-safeequal.txt")).kind).toBe("path");
    expect(parseGraphify("explain", "something new\n")).toEqual({ kind: "text", text: "something new" });
    // An explain's text asked as a path is not misread.
    expect(parseGraphify("path", sample("explain-checkauth.txt")).kind).toBe("text");
  });

  it("relation words", () => {
    expect(relationVi("calls")).toBe("gọi");
    expect(relationVi("some_new")).toBe("some new");
    expect(relationVi("constructor")).toBe("constructor");
  });
});
