// Office artifacts (docx/xlsx/pptx, the old doc/xls/ppt, OpenDocument) shown as PDF: when LibreOffice is
// installed, `soffice --headless --convert-to pdf` makes one, cached under HQ's state dir by the file's
// real path, size and mtime, so a re-open is instant and a rewrite converts again. Without LibreOffice the
// view reads the zip-based formats itself (lib/office-preview.ts).
//
// argv only (no shell), a minimal env, its own throwaway profile seeded with macros off, untrusted
// links blocked, links and formulas never refreshed on load (a LibreOffice the owner has open does not
// swallow the job either), the import filter pinned to the extension, one conversion at a time, a hard
// timeout that kills the whole process tree, and a size cap. Not done: cutting the child off the network.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stateDir } from "./paths";

export const CONVERT_TIMEOUT_MS = 120_000;
export const PDF_MAX_BYTES = 200 * 1024 * 1024;
/** Converted PDFs kept; the oldest go first. */
const CACHE_KEEP = 40;
/** A `job-*` work dir this old is a leftover (HQ died mid-conversion, a locked file), not a running job. */
export const STALE_JOB_MS = 3 * CONVERT_TIMEOUT_MS;

/**
 * LibreOffice's import filter per extension: the file is read as what its name says, never sniffed into
 * another format (a `.docx` that is really RTF/HTML stays a failed docx).
 */
export const OFFICE_FILTERS: Record<string, string> = {
  ".docx": "MS Word 2007 XML",
  ".doc": "MS Word 97",
  ".xlsx": "Calc MS Excel 2007 XML",
  ".xls": "MS Excel 97",
  ".pptx": "Impress MS PowerPoint 2007 XML",
  ".ppt": "MS PowerPoint 97",
  ".odt": "writer8",
  ".ods": "calc8",
  ".odp": "impress8",
};

/**
 * `user/registrymodifications.xcu` of the throwaway profile: macro security "very high" and macros off,
 * untrusted referer links blocked, Writer (0) and Calc (1) links never updated on load, Calc formulas never
 * recalculated on load (a stored formula cannot call WEBSERVICE() during conversion).
 */
export function profileXcu(): string {
  const item = (p: string, name: string, value: string) => `<item oor:path="${p}"><prop oor:name="${name}" oor:op="fuse"><value>${value}</value></prop></item>`;
  const sec = "/org.openoffice.Office.Common/Security/Scripting";
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    item(sec, "MacroSecurityLevel", "3"),
    item(sec, "DisableMacrosExecution", "true"),
    item(sec, "BlockUntrustedRefererLinks", "true"),
    item("/org.openoffice.Office.Writer/Content/Update", "Link", "0"),
    item("/org.openoffice.Office.Calc/Content/Update", "Link", "1"),
    item("/org.openoffice.Office.Calc/Formula/Load", "OOXMLRecalcMode", "1"),
    item("/org.openoffice.Office.Calc/Formula/Load", "ODFRecalcMode", "1"),
    "</oor:items>",
    "",
  ].join("\n");
}

/** The child's whole env: PATH and SystemRoot to start at all, temp and home pointed into the job dir. Nothing else of HQ's. */
export function sofficeEnv(work: string, env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): Record<string, string> {
  const out: Record<string, string> = { TEMP: work, TMP: work, HOME: work, USERPROFILE: work };
  const pathVar = env.PATH ?? env.Path;
  if (pathVar) out.PATH = pathVar;
  if (platform === "win32") {
    const root = env.SystemRoot ?? env.SYSTEMROOT;
    if (root) out.SystemRoot = root;
  } else out.TMPDIR = work;
  return out;
}

/** How to end `pid` and everything it started: Windows `taskkill /T /F` (argv); elsewhere null, the caller kills the process group. */
export function killTreeCommand(platform: NodeJS.Platform, pid: number, env: Record<string, string | undefined> = process.env): { cmd: string; args: string[] } | null {
  if (platform !== "win32") return null;
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return { cmd: path.win32.join(root, "System32", "taskkill.exe"), args: ["/PID", String(pid), "/T", "/F"] };
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  const c = killTreeCommand(process.platform, pid);
  try {
    if (c) spawn(c.cmd, c.args, { shell: false, windowsHide: true, stdio: "ignore" }).once("error", () => {});
    else process.kill(-pid, "SIGKILL"); // the child leads its own process group (spawned detached)
  } catch {
    /* already gone */
  }
}

export const officeCacheDir = () => path.join(stateDir(), "office-pdf");

/**
 * Where LibreOffice usually lives on this platform, beside whatever PATH holds. Only fully absolute PATH
 * entries count: a relative one (`.`, `bin`) resolves against HQ's cwd, a drive-less `\x` against the
 * current drive, a `\\host\share` reaches over the network.
 */
export function sofficeCandidates(platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env): string[] {
  const p = platform === "win32" ? path.win32 : path.posix;
  const absolute = (d: string) => (platform === "win32" ? /^[A-Za-z]:[\\/]/.test(d) : d.startsWith("/"));
  const names = platform === "win32" ? ["soffice.exe", "soffice.com"] : ["soffice", "libreoffice"];
  const fromPath = (env.PATH ?? env.Path ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter((d) => d && absolute(d))
    .flatMap((d) => names.map((n) => p.join(d, n)));
  if (platform === "win32") {
    const pf = [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files", "C:\\Program Files (x86)"].filter((x): x is string => !!x && absolute(x));
    return [...pf.map((d) => p.join(d, "LibreOffice", "program", "soffice.exe")), ...fromPath];
  }
  if (platform === "darwin") return ["/Applications/LibreOffice.app/Contents/MacOS/soffice", ...fromPath];
  return ["/usr/bin/soffice", "/usr/bin/libreoffice", "/usr/lib/libreoffice/program/soffice", "/opt/libreoffice/program/soffice", "/snap/bin/libreoffice", ...fromPath];
}

let found: { at: number; bin: string | null } | null = null;

/** The LibreOffice binary, or null; looked up again at most once a minute (an install shows up without a restart). */
export function findSoffice(now = Date.now()): string | null {
  if (found && now - found.at < 60_000) return found.bin;
  const bin =
    sofficeCandidates().find((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    }) ?? null;
  found = { at: now, bin };
  return bin;
}

let queue: Promise<unknown> = Promise.resolve();
const running = new Map<string, Promise<string | null>>();

/** `file`'s PDF (a path in the cache), converting it first when needed; null when LibreOffice is missing or the conversion failed. */
export function officePdf(file: string, size: number, mtimeMs: number): Promise<string | null> {
  const bin = findSoffice();
  if (!bin) return Promise.resolve(null);
  const key = crypto.createHash("sha256").update(JSON.stringify([file, size, mtimeMs])).digest("hex").slice(0, 40);
  const out = path.join(officeCacheDir(), `${key}.pdf`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  const inFlight = running.get(key);
  if (inFlight) return inFlight;
  const job = queue.then(() => convert(bin, file, out)).finally(() => running.delete(key));
  queue = job.catch(() => null);
  running.set(key, job);
  return job;
}

async function convert(bin: string, file: string, out: string): Promise<string | null> {
  const ext = path.extname(file).toLowerCase();
  const filter = OFFICE_FILTERS[ext];
  if (!filter) return null;
  const cache = officeCacheDir();
  let work: string | null = null;
  try {
    fs.mkdirSync(cache, { recursive: true });
    pruneOfficeCache(cache);
    work = fs.mkdtempSync(path.join(cache, "job-"));
    // The input goes in under a fixed name: the output name is then known, whatever the original was.
    const src = path.join(work, `in${ext}`);
    fs.copyFileSync(file, src);
    const profile = path.join(work, "profile");
    fs.mkdirSync(path.join(profile, "user"), { recursive: true });
    fs.writeFileSync(path.join(profile, "user", "registrymodifications.xcu"), profileXcu());
    const args = [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--invisible",
      "--norestore",
      "--nolockcheck",
      "--nodefault",
      "--nologo",
      `--infilter=${filter}`,
      "--convert-to",
      "pdf",
      "--outdir",
      work,
      src,
    ];
    const { promise: done, resolve } = Promise.withResolvers<boolean>();
    // NodeJS.ProcessEnv (Next's types require NODE_ENV): the child gets exactly sofficeEnv's keys, nothing more.
    const env = sofficeEnv(work) as NodeJS.ProcessEnv;
    const child = spawn(bin, args, { cwd: work, env, shell: false, windowsHide: true, stdio: "ignore", detached: process.platform !== "win32" });
    const timer = setTimeout(() => {
      killTree(child.pid);
      resolve(false);
    }, CONVERT_TIMEOUT_MS);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    const ok = await done;
    const pdf = path.join(work, "in.pdf");
    if (!ok || !fs.existsSync(pdf)) return null;
    const st = fs.statSync(pdf);
    if (!st.isFile() || st.size === 0 || st.size > PDF_MAX_BYTES) return null;
    fs.renameSync(pdf, out);
    return out;
  } catch {
    return null;
  } finally {
    if (work) {
      try {
        fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* still locked by a dying soffice: pruneOfficeCache takes it once stale */
      }
    }
  }
}

/** Keeps the newest CACHE_KEEP PDFs and removes `job-*` work dirs older than STALE_JOB_MS. */
export function pruneOfficeCache(dir: string, now = Date.now()) {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const pdfs: { p: string; t: number }[] = [];
  for (const n of names) {
    const p = path.join(dir, n);
    try {
      const st = fs.lstatSync(p);
      if (n.startsWith("job-") && st.isDirectory() && now - st.mtimeMs > STALE_JOB_MS) fs.rmSync(p, { recursive: true, force: true });
      else if (n.endsWith(".pdf") && st.isFile()) pdfs.push({ p, t: st.mtimeMs });
    } catch {
      /* a racing prune or a locked file: next time */
    }
  }
  pdfs.sort((a, b) => b.t - a.t);
  for (const old of pdfs.slice(CACHE_KEEP)) {
    try {
      fs.rmSync(old.p, { force: true });
    } catch {
      /* locked: next time */
    }
  }
}
