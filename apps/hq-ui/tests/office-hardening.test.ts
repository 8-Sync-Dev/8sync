import { EventEmitter } from "node:events";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// LibreOffice never really runs: spawn is a fake child the test drives (writes the PDF, exits, or hangs).
type Call = { cmd: string; args: string[]; opts: { cwd?: string; env?: Record<string, string>; detached?: boolean; shell?: boolean } };
const proc = vi.hoisted(() => ({ calls: [] as Call[], onSpawn: null as null | ((c: Call, child: EventEmitter) => void) }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  spawn: (cmd: string, args: string[], opts: Call["opts"]) => {
    const call = { cmd, args, opts };
    proc.calls.push(call);
    const child = Object.assign(new EventEmitter(), { pid: 4242, unref: () => {} });
    if (proc.onSpawn) proc.onSpawn(call, child);
    return child;
  },
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { artifactDelivery, ARTIFACT_CSP } from "@/lib/artifact-headers";
import { safeImageSrc } from "@/lib/artifacts";
import { ODF_NEST_MAX, odfBlocks } from "@/lib/office-preview";
import {
  CONVERT_TIMEOUT_MS,
  OFFICE_FILTERS,
  STALE_JOB_MS,
  killTreeCommand,
  officeCacheDir,
  officePdf,
  profileXcu,
  pruneOfficeCache,
  sofficeCandidates,
  sofficeEnv,
} from "@/lib/server/office-pdf";
import nextConfig from "@/next.config";
import { tempHome } from "./helpers";

let tmp = "";
beforeAll(() => {
  tempHome();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-office-")));
  // findSoffice must find *a* binary on any machine; spawn is mocked, so an empty file will do.
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  for (const n of ["soffice", "soffice.exe"]) fs.writeFileSync(path.join(bin, n), "");
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ""}`;
});
afterEach(() => {
  proc.calls.length = 0;
  proc.onSpawn = null;
  vi.useRealTimers();
});

describe("artifact delivery", () => {
  it("hands an SVG or HTML file out inline only to HQ's own <img> or fetch; a page, frame or unknown gets a download", () => {
    expect(artifactDelivery("image/svg+xml", "image", false)).toEqual({ type: "image/svg+xml", attachment: false });
    expect(artifactDelivery("image/svg+xml", "empty", false)).toEqual({ type: "image/svg+xml", attachment: false });
    expect(artifactDelivery("text/html; charset=utf-8", "empty", false)).toEqual({ type: "text/html; charset=utf-8", attachment: false });
    const refused = { type: "application/octet-stream", attachment: true };
    for (const dest of ["document", "iframe", "frame", "object", "embed", null]) {
      expect(artifactDelivery("image/svg+xml", dest, false)).toEqual(refused);
      expect(artifactDelivery("text/html; charset=utf-8", dest, false)).toEqual(refused);
    }
    // An HTML page as <img> is no use and would still be a document if navigated: refused too.
    expect(artifactDelivery("text/html; charset=utf-8", "image", false)).toEqual(refused);
    expect(artifactDelivery("image/svg+xml", "empty", true)).toEqual(refused);
    // Passive types keep their type; only the download flag decides the disposition.
    expect(artifactDelivery("video/mp4", "document", false)).toEqual({ type: "video/mp4", attachment: false });
    expect(artifactDelivery("video/mp4", "video", true)).toEqual({ type: "video/mp4", attachment: true });
  });

  it("next.config puts the full sandbox CSP on the artifact routes after the global rule (a config header wins on the wire)", async () => {
    const rules = await nextConfig.headers!();
    const at = (src: string) => rules.findIndex((r) => r.source === src);
    for (const src of ["/api/artifacts/:id/file", "/api/artifacts/:id/pdf"]) {
      expect(at(src)).toBeGreaterThan(at("/:path*"));
      const csp = rules[at(src)].headers.find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
      expect(csp).toBe(ARTIFACT_CSP);
    }
    expect(ARTIFACT_CSP).toMatch(/^sandbox;/);
    expect(ARTIFACT_CSP).toContain("default-src 'none'");
    expect(ARTIFACT_CSP).toContain("frame-ancestors 'none'");
  });
});

describe("markdown images", () => {
  const origin = "http://127.0.0.1:8740";
  it("load from data: or HQ's own origin only", () => {
    expect(safeImageSrc("data:image/png;base64,iVBOR", origin)).toBe("data:image/png;base64,iVBOR");
    expect(safeImageSrc("/api/artifacts/x/file?e=1&sig=2", origin)).toBe(`${origin}/api/artifacts/x/file?e=1&sig=2`);
    expect(safeImageSrc("shot.png", origin)).toBe(`${origin}/shot.png`);
    for (const bad of [
      "https://tracker.example/p.gif",
      "http://127.0.0.1:9999/x.png",
      "//tracker.example/p.gif",
      "data:text/html,<script>1</script>",
      "javascript:alert(1)",
      "file:///C:/x.png",
      "",
      undefined,
    ])
      expect(safeImageSrc(bad, origin)).toBeNull();
  });
});

describe("LibreOffice hardening", () => {
  it("seeds the profile with macros off, untrusted links blocked, link updates and recalc-on-load never", () => {
    const x = profileXcu();
    const prop = (p: string, name: string) => new RegExp(`<item oor:path="${p}"><prop oor:name="${name}" oor:op="fuse"><value>([^<]*)</value>`).exec(x)?.[1];
    const sec = "/org.openoffice.Office.Common/Security/Scripting";
    expect(prop(sec, "MacroSecurityLevel")).toBe("3");
    expect(prop(sec, "DisableMacrosExecution")).toBe("true");
    expect(prop(sec, "BlockUntrustedRefererLinks")).toBe("true");
    expect(prop("/org.openoffice.Office.Writer/Content/Update", "Link")).toBe("0");
    expect(prop("/org.openoffice.Office.Calc/Content/Update", "Link")).toBe("1");
    expect(prop("/org.openoffice.Office.Calc/Formula/Load", "OOXMLRecalcMode")).toBe("1");
    expect(prop("/org.openoffice.Office.Calc/Formula/Load", "ODFRecalcMode")).toBe("1");
  });

  it("gives the child only PATH, SystemRoot, temp and home (in the job dir): no HQ secret, no owner profile", () => {
    const env = { PATH: "C:\\bin", SystemRoot: "C:\\Windows", HQ_TOKEN: "secret", APPDATA: "C:\\Users\\x\\AppData", GH_TOKEN: "t" };
    expect(sofficeEnv("W", env, "win32")).toEqual({ PATH: "C:\\bin", SystemRoot: "C:\\Windows", TEMP: "W", TMP: "W", HOME: "W", USERPROFILE: "W" });
    expect(sofficeEnv("/w", { PATH: "/usr/bin", AWS_SECRET_ACCESS_KEY: "k" }, "linux")).toEqual({ PATH: "/usr/bin", TEMP: "/w", TMP: "/w", TMPDIR: "/w", HOME: "/w", USERPROFILE: "/w" });
  });

  it("looks for soffice in absolute PATH entries only", () => {
    const win = sofficeCandidates("win32", { PATH: ".;bin;\\rooted;\\\\host\\share;C:\\Tools;d:/lo", ProgramFiles: "relative" });
    expect(win.filter((p) => !/^[A-Za-z]:\\/.test(p))).toEqual([]);
    expect(win).toContain("C:\\Tools\\soffice.exe");
    expect(win).toContain("d:\\lo\\soffice.exe");
    const nix = sofficeCandidates("linux", { PATH: ".:bin::/opt/lo/bin" });
    expect(nix.filter((p) => !p.startsWith("/"))).toEqual([]);
    expect(nix).toContain("/opt/lo/bin/soffice");
  });

  it("kills the whole tree: taskkill /T /F as argv on Windows, the process group elsewhere", () => {
    expect(killTreeCommand("win32", 77, { SystemRoot: "C:\\Windows" })).toEqual({ cmd: "C:\\Windows\\System32\\taskkill.exe", args: ["/PID", "77", "/T", "/F"] });
    expect(killTreeCommand("linux", 77)).toBeNull();
  });

  it("converts with the pinned import filter, the seeded profile and the minimal env", async () => {
    const src = path.join(tmp, "report.docx");
    fs.writeFileSync(src, "PK-docx");
    let seeded = "";
    proc.onSpawn = (c, child) => {
      seeded = fs.readFileSync(path.join(c.opts.cwd!, "profile", "user", "registrymodifications.xcu"), "utf8");
      fs.writeFileSync(path.join(c.opts.cwd!, "in.pdf"), "%PDF-1.7");
      setImmediate(() => child.emit("exit", 0));
    };
    const out = await officePdf(src, 7, 1);
    expect(out && fs.readFileSync(out, "utf8")).toBe("%PDF-1.7");
    const c = proc.calls[0];
    expect(c.args).toContain(`--infilter=${OFFICE_FILTERS[".docx"]}`);
    expect(c.args.indexOf("--infilter=MS Word 2007 XML")).toBeLessThan(c.args.indexOf("--convert-to"));
    expect(c.opts.shell).toBe(false);
    expect(Object.keys(c.opts.env!).sort()).toEqual(Object.keys(sofficeEnv(c.opts.cwd!)).sort());
    expect(c.opts.env!.HOME).toBe(c.opts.cwd);
    expect(seeded).toBe(profileXcu());
    // The job dir is gone afterwards.
    expect(fs.existsSync(c.opts.cwd!)).toBe(false);
  });

  it("does not convert an extension without a known import filter", async () => {
    const src = path.join(tmp, "notes.rtf");
    fs.writeFileSync(src, "{\\rtf1}");
    expect(await officePdf(src, 6, 1)).toBeNull();
    expect(proc.calls).toEqual([]);
  });

  it("on timeout kills the process tree and fails, leaving no work dir", async () => {
    const src = path.join(tmp, "hang.xlsx");
    fs.writeFileSync(src, "PK-xlsx");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const killed = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const job = officePdf(src, 7, 2);
      await vi.waitFor(() => expect(proc.calls.length).toBe(1));
      const work = proc.calls[0].opts.cwd!;
      await vi.advanceTimersByTimeAsync(CONVERT_TIMEOUT_MS);
      expect(await job).toBeNull();
      if (process.platform === "win32") {
        expect(proc.calls[1]).toMatchObject({ args: ["/PID", "4242", "/T", "/F"], opts: { shell: false } });
        expect(proc.calls[1].cmd).toMatch(/taskkill\.exe$/i);
      } else {
        expect(proc.calls[0].opts.detached).toBe(true);
        expect(killed).toHaveBeenCalledWith(-4242, "SIGKILL");
      }
      expect(fs.existsSync(work)).toBe(false);
    } finally {
      killed.mockRestore();
    }
  });

  it("prunes leftover job dirs once stale, never a fresh one", () => {
    const dir = officeCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, "job-old");
    const fresh = path.join(dir, "job-new");
    for (const d of [old, fresh]) fs.mkdirSync(path.join(d, "profile"), { recursive: true });
    const t = new Date(Date.now() - STALE_JOB_MS - 60_000);
    fs.utimesSync(old, t, t);
    pruneOfficeCache(dir);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });
});

describe("OpenDocument walk", () => {
  // A minimal DOM: what odfBlocks reads (localName, children, childNodes, nodeType, getAttribute).
  type El = { nodeType: 1; localName: string; children: El[]; childNodes: (El | { nodeType: 3; nodeValue: string })[]; getAttribute: () => null };
  const el = (localName: string, kids: El[] = [], text?: string): El => ({
    nodeType: 1,
    localName,
    children: kids,
    childNodes: text === undefined ? kids : [{ nodeType: 3, nodeValue: text }, ...kids],
    getAttribute: () => null,
  });
  beforeAll(() => {
    (globalThis as Record<string, unknown>).Node ??= { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_POSITION_FOLLOWING: 4 };
  });

  it("stops at ODF_NEST_MAX nested lists and survives a crafted deep file without a stack overflow", () => {
    let inner = el("p", [], "deepest");
    for (let i = 0; i < 20_000; i++) inner = el("list", [el("list-item", [el("p", [], `level ${20_000 - i}`), inner])]);
    const { blocks } = odfBlocks(el("text", [inner]) as unknown as Element);
    const items = blocks.filter((b) => b.t === "li");
    expect(items).toHaveLength(ODF_NEST_MAX);
    expect(Math.max(...items.map((b) => (b.t === "li" ? b.depth : -1)))).toBe(ODF_NEST_MAX - 1);

    let span = el("span", [], "x");
    for (let i = 0; i < 20_000; i++) span = el("span", [span]);
    expect(odfBlocks(el("text", [el("p", [span], "top ")]) as unknown as Element).blocks).toEqual([{ t: "p", text: "top" }]);
  });
});
