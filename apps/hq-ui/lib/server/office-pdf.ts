// Office artifacts (docx/xlsx/pptx, the old doc/xls/ppt, OpenDocument) shown as PDF: when LibreOffice is
// installed, `soffice --headless --convert-to pdf` makes one, cached under HQ's state dir by the file's
// real path, size and mtime, so a re-open is instant and a rewrite converts again. Without LibreOffice the
// view reads the zip-based formats itself (lib/office-preview.ts).
//
// argv only (no shell), the child env without HQ's secrets, its own throwaway profile (a LibreOffice the
// owner has open does not swallow the job), one conversion at a time, a hard timeout and a size cap.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { childEnv } from "./child-env";
import { stateDir } from "./paths";

export const CONVERT_TIMEOUT_MS = 120_000;
export const PDF_MAX_BYTES = 200 * 1024 * 1024;
/** Converted PDFs kept; the oldest go first. */
const CACHE_KEEP = 40;

export const officeCacheDir = () => path.join(stateDir(), "office-pdf");

/** Where LibreOffice usually lives on this platform, beside whatever PATH holds. */
export function sofficeCandidates(platform: NodeJS.Platform = process.platform, env: Record<string, string | undefined> = process.env): string[] {
  const names = platform === "win32" ? ["soffice.exe", "soffice.com"] : ["soffice", "libreoffice"];
  const fromPath = (env.PATH ?? env.Path ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((d) => names.map((n) => path.join(d, n)));
  if (platform === "win32") {
    const pf = [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files", "C:\\Program Files (x86)"].filter((x): x is string => !!x);
    return [...pf.map((d) => path.join(d, "LibreOffice", "program", "soffice.exe")), ...fromPath];
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
  const cache = officeCacheDir();
  fs.mkdirSync(cache, { recursive: true });
  const work = fs.mkdtempSync(path.join(cache, "job-"));
  try {
    // The input goes in under a fixed name: the output name is then known, whatever the original was.
    const ext = path.extname(file).toLowerCase();
    const src = path.join(work, `in${ext}`);
    fs.copyFileSync(file, src);
    const args = [
      `-env:UserInstallation=${pathToFileURL(path.join(work, "profile")).href}`,
      "--headless",
      "--invisible",
      "--norestore",
      "--nolockcheck",
      "--nodefault",
      "--nologo",
      "--convert-to",
      "pdf",
      "--outdir",
      work,
      src,
    ];
    const { promise: done, resolve } = Promise.withResolvers<boolean>();
    const child = spawn(bin, args, { cwd: work, env: childEnv(), shell: false, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), CONVERT_TIMEOUT_MS);
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
    prune(cache);
    return out;
  } catch {
    return null;
  } finally {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 3 });
  }
}

function prune(dir: string) {
  try {
    const pdfs = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".pdf"))
      .map((n) => ({ p: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of pdfs.slice(CACHE_KEEP)) fs.rmSync(old.p, { force: true });
  } catch {
    /* a racing prune or a locked file: next time */
  }
}
