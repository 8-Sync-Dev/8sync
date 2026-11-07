// A new omp session, as both `POST /api/omp/sessions` (the workspace's "Phiên mới") and `POST /api/sessions`
// with `engine: "omp"` (the Bots tab's "Bot mới") create it. Each route checks `model` its own way first.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isOmpSessionName } from "../omp-workspace";
import type { Access } from "./auth";
import { bad, json } from "./http";
import { queueInbox } from "./inbox";
import { existingDir, forgetOmpSessions, ompIdFor, projectRoot, rememberNew } from "./omp-sessions";
import { run } from "./proc";
import { ownerMessage } from "./queries";
import { senderOf } from "./sender";
import { clampText } from "./validate";
import { withSenderHeader } from "../sender";
import { FILES_PER_TASK, isUploadId, placeUploads, withFiles } from "./uploads";

/**
 * `{cwd, name, worktree?, prompt?, files?}` with `model` already checked by the caller: a new (or existing) omp
 * session `name` of folder `cwd`. Nothing runs yet: the answer's `id` is the session's room id, and opening its
 * terminal (`/api/sessions/<id>/term`) creates it with `8sync ccc term --omp-new` in `cwd`, like `8sync . <name>`.
 * `worktree: true`: the session gets its own git worktree `<repo>/.claude/worktrees/<name>` (branch `<name>`,
 * made here; an existing one is reused) and runs there. `prompt` (+ upload `files`): the first message, queued
 * in the session's inbox; omp takes it as soon as it is up and idle.
 */
export async function createOmpSession(req: Request, o: { db: DatabaseSync; access: Access }, body: Record<string, unknown>, model: string | null): Promise<Response> {
  let cwd = existingDir(body.cwd);
  if (!cwd) return bad("cwd phải là một thư mục có thật", 422);
  if (!isOmpSessionName(body.name)) return bad("tên phiên: chữ thường, số, '.', '_', '-' (tối đa 48), không trùng ls/rm/mv/merge/new", 422);
  const name: string = body.name;
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
