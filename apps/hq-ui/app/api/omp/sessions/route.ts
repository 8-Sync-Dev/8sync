import fs from "node:fs";
import path from "node:path";
import { isOmpModel, isOmpSessionName } from "@/lib/omp-workspace";
import { bad, json, open, readBody } from "@/lib/server/http";
import { queueInbox } from "@/lib/server/inbox";
import { existingDir, forgetOmpSessions, listOmpSessions, ompIdFor, projectRoot, rememberNew } from "@/lib/server/omp-sessions";
import { allOmpSessions, forgetOmpTree } from "@/lib/server/omp-tree";
import { ompRoom, resetFloorCache } from "@/lib/server/floor";
import { isOmpRoomId } from "@/lib/labels";
import { run } from "@/lib/server/proc";
import { ownerMessage } from "@/lib/server/queries";
import { clampText } from "@/lib/server/validate";
import { senderOf } from "@/lib/server/sender";
import { withSenderHeader } from "@/lib/sender";
import { FILES_PER_TASK, isUploadId, placeUploads, withFiles } from "@/lib/server/uploads";

export const runtime = "nodejs";

/**
 * ?cwd=<absolute folder>: its omp sessions, rows of `8sync . ls --json` run there.
 * ?all=1: every omp session on the machine for the sidebar tree (folder, state, sub-sessions).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  if (q.get("all") === "1") return json({ sessions: await allOmpSessions(o.db) });
  const cwd = existingDir(q.get("cwd"));
  if (!cwd) return bad("cwd phải là một thư mục có thật", 422);
  return json({ cwd, sessions: await listOmpSessions(cwd) });
}

/**
 * `{cwd, name, model?, worktree?, prompt?, files?}`: a new (or existing) omp session `name` of folder
 * `cwd`. Nothing runs yet: the answer's `id` is the session's room id, and opening its terminal
 * (`/api/sessions/<id>/term`) creates it with `8sync ccc term --omp-new` in `cwd`, like `8sync . <name>`.
 * `worktree: true`: the session gets its own git worktree `<repo>/.claude/worktrees/<name>` (branch
 * `<name>`, made here; an existing one is reused) and runs there. `prompt` (+ upload `files`): the first
 * message, queued in the session's inbox; omp takes it as soon as it is up and idle.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  let cwd = existingDir(body.cwd);
  if (!cwd) return bad("cwd phải là một thư mục có thật", 422);
  if (!isOmpSessionName(body.name)) return bad("tên phiên: chữ thường, số, '.', '_', '-' (tối đa 48), không trùng ls/rm/mv/merge/new", 422);
  const name: string = body.name;
  const model = body.model === undefined || body.model === null || body.model === "" ? null : body.model;
  if (model !== null && !isOmpModel(model)) return bad("model không hợp lệ (vd zai/glm-5.3)", 422);
  const files = body.files ?? [];
  if (!Array.isArray(files) || files.length > FILES_PER_TASK || !files.every(isUploadId)) return bad(`files: at most ${FILES_PER_TASK} upload ids`, 400);
  const prompt = body.prompt === undefined || body.prompt === null || body.prompt === "" ? null : clampText(body.prompt);
  if (prompt && !prompt.ok) return bad(prompt.error, 422);
  if (files.length > 0 && !prompt) return bad("file đính kèm cần đi cùng prompt", 422);
  if (body.worktree === true) {
    const made = await worktreeFor(cwd, name);
    if ("error" in made) return bad(made.error, 409);
    cwd = made.dir;
  }
  const id = ompIdFor(cwd, name);
  rememberNew(id, { cwd, name, model });
  forgetOmpSessions(cwd);
  if (prompt?.ok) {
    let text = prompt.value;
    if (files.length > 0) {
      let paths: string[];
      try {
        paths = placeUploads([...new Set(files as string[])], projectRoot(cwd));
      } catch (e) {
        return bad((e as Error).message, 400);
      }
      text = withFiles(text, paths);
    }
    const sender = senderOf(req, o.access);
    queueInbox(id, text, sender, { engine: "omp", name, cwd });
    ownerMessage(o.db, id, withSenderHeader(text, sender), "inbox");
  }
  return json({ id, name, cwd });
}

/**
 * ?id=<omp room id>: "Xóa phiên" — `8sync . rm <name> --purge` in the session's repo: transcript
 * deleted, a clean worktree removed. Refused (409, the CLI's reason) when its worktree has
 * uncommitted changes or an omp in another terminal has it open; HQ's own host for it is ended.
 * The name and folder come from `8sync ls`, never from the client.
 */
export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !isOmpRoomId(id)) return bad("id phải là id phiên omp", 422);
  const cwd = (await ompRoom(o.db, id))?.cwd;
  if (!cwd) return bad("không thấy phiên này", 404);
  const row = (await listOmpSessions(cwd)).find((r) => r.inbox_id === id);
  if (!row) return bad("không thấy phiên này", 404);
  const r = await run("8sync", [".", "rm", row.name, "--purge"], 30_000, cwd);
  forgetOmpSessions(cwd);
  resetFloorCache();
  forgetOmpTree();
  if (!r.ok) return bad((r.stderr || r.stdout).trim().split("\n").pop()?.replace(/^Error:\s*/, "") || "8sync . rm lỗi", 409);
  return json({ ok: true, name: row.name });
}

/** `<repo>/.claude/worktrees/<name>` on branch `<name>` (made from HEAD; the branch is reused when it exists). */
async function worktreeFor(cwd: string, name: string): Promise<{ dir: string } | { error: string }> {
  const top = await run("git", ["rev-parse", "--show-toplevel"], 8000, cwd);
  if (!top.ok) return { error: "thư mục này không phải git repo, không tạo được worktree" };
  const repo = path.resolve(top.stdout.trim());
  const dir = path.join(repo, ".claude", "worktrees", name);
  if (fs.existsSync(path.join(dir, ".git"))) return { dir };
  const fresh = await run("git", ["worktree", "add", "-b", name, dir], 30_000, repo);
  if (fresh.ok) return { dir };
  const reuse = await run("git", ["worktree", "add", dir, name], 30_000, repo);
  if (reuse.ok) return { dir };
  return { error: `git worktree add: ${(reuse.stderr || fresh.stderr).trim().split("\n").pop() ?? "lỗi"}` };
}
