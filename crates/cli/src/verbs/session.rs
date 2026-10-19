//! Named, per-project work sessions on top of omp's session store.
//!
//! A named session = one omp conversation isolated via `omp --session-dir`,
//! tracked in a machine-local per-project registry
//! (`~/.config/8sync/sessions/<project-key>/index.json`). `8sync .` resumes the
//! last-used session in the repo (omp's default store when none was ever named);
//! `8sync . <name>` create-or-resumes a named one.
//!
//! Registry is machine-local on purpose: it points at machine-local omp session
//! dirs (and, from M1, git worktree paths), so committing it would break on
//! another box — this mirrors omp's own `~/.omp` scoping.
//!
//! M1 adds the `worktree` field (git worktree + branch `8sync/<name>`); M2 adds
//! the `git`-shell-out merge engine. This module owns the registry + CRUD; the
//! `8sync .` verb (`here.rs`) dispatches to it.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{env_detect::Env, ui};

#[derive(Serialize, Deserialize, Default)]
pub struct Registry {
    /// Name of the session most recently resumed/created; `None` = omp's default
    /// (unnamed) store, i.e. legacy `8sync .` behavior.
    #[serde(default)]
    pub last_used: Option<String>,
    #[serde(default)]
    pub sessions: Vec<Session>,
    /// Project root this registry belongs to (written by [`save`]): `8sync ls --all` only knows
    /// the sanitized key, and a room's inbox id ([`ccc_core::room_id`]) needs the root itself.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<PathBuf>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Session {
    pub name: String,
    /// omp `--session-dir` for this session (isolated conversation store).
    pub session_dir: PathBuf,
    /// git worktree binding — populated in M1 (`--worktree`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<Worktree>,
    pub created: u64,
    pub last_active: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
    pub base_branch: String,
}

impl Registry {
    pub fn get(&self, name: &str) -> Option<&Session> {
        self.sessions.iter().find(|s| s.name == name)
    }
    pub fn get_mut(&mut self, name: &str) -> Option<&mut Session> {
        self.sessions.iter_mut().find(|s| s.name == name)
    }
}

// ── paths ────────────────────────────────────────────────────────────────

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Sanitized, collision-safe key for a repo path. Readable like omp's own
/// (`-Projects-tools-su-code`); very long paths fall back to a hash.
pub(crate) fn project_key(root: &Path) -> String {
    let s = root.to_string_lossy();
    let key: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if key.len() <= 120 {
        return key;
    }
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("h{:016x}", h.finish())
}

fn key_dir(env: &Env, root: &Path) -> PathBuf {
    env.xdg_config.join("8sync").join("sessions").join(project_key(root))
}

fn index_path(env: &Env, root: &Path) -> PathBuf {
    key_dir(env, root).join("index.json")
}

/// Names are used as directory + git branch slugs — keep them safe.
fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

// ── registry load/save ─────────────────────────────────────────────────────

pub fn load(env: &Env, root: &Path) -> Registry {
    std::fs::read_to_string(index_path(env, root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(env: &Env, root: &Path, reg: &Registry) -> Result<()> {
    let dir = key_dir(env, root);
    std::fs::create_dir_all(&dir).with_context(|| format!("mkdir {}", dir.display()))?;
    let mut v = serde_json::to_value(reg)?;
    v["root"] = serde_json::json!(root);
    let json = serde_json::to_string_pretty(&v)?;
    std::fs::write(index_path(env, root), json).context("write session index")?;
    Ok(())
}

// ── omp launch ─────────────────────────────────────────────────────────────

/// Launch omp for a named session's `--session-dir`. `fresh=true` starts a new
/// conversation (no `--continue`); otherwise it resumes the latest one there.
/// Reuses `ModelConfig` so STEP-0 tool-routing + advisor survive every launch.
/// `room` = (project root, session name): exported as `EIGHTSYNC_ROOM` / `EIGHTSYNC_ROOM_ID`
/// so the omp extension polls this room's inbox and `ccc msg` knows the sender, plus
/// `EIGHTSYNC_BIN` (this executable) so the extension never resolves `8sync` from PATH/cwd.
/// `model` = `--model <id>` for omp (`8sync . <name> --model <id>`); None = omp's default.
fn launch(cwd: &Path, session_dir: &Path, fresh: bool, room: (&Path, &str), model: Option<&str>) -> Result<()> {
    if which::which("omp").is_err() {
        ui::err("omp not installed. Run `8sync setup` first.");
        return Ok(());
    }
    std::fs::create_dir_all(session_dir)?;
    // A named session lives in its OWN omp store, so a bare `omp --continue`
    // (omp's default per-cwd store) lands somewhere else entirely and the
    // session looks lost. Print the command that reopens THIS one.
    ui::info(&format!("omp --session-dir {} --continue", session_dir.display()));
    let cfg = crate::models::ModelConfig::load();
    let mut cmd = Command::new("omp");
    cmd.current_dir(cwd)
        .env("EIGHTSYNC_ROOM", room.1)
        .env("EIGHTSYNC_ROOM_ID", ccc_core::room_id(room.0, room.1));
    if let Ok(exe) = std::env::current_exe() {
        cmd.env("EIGHTSYNC_BIN", exe);
    }
    cmd.arg("--cwd").arg(cwd).arg("--session-dir").arg(session_dir);
    match model {
        Some(m) => cmd.args(cfg.pinned_flags(m)),
        None => cmd.args(cfg.resume_flags()),
    };
    if !fresh {
        cmd.arg("--continue");
    }
    let status = cmd.status().context("could not exec omp")?;
    if !status.success() {
        ui::warn("omp exited non-zero");
    }
    Ok(())
}

// ── git / worktree ─────────────────────────────────────────────────────────

/// Working dir for a session: its worktree when isolated, else the repo root.
fn session_cwd<'a>(s: &'a Session, root: &'a Path) -> &'a Path {
    s.worktree.as_ref().map(|w| w.path.as_path()).unwrap_or(root)
}

/// Run `git -C <dir> <args>`, returning trimmed stdout; errors on non-zero.
fn git_out(dir: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .context("run git")?;
    if !out.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Run `git -C <dir> <args>`, returning only whether it succeeded.
fn git_ok(dir: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Current branch name, or the HEAD sha when detached.
fn current_branch(root: &Path) -> Result<String> {
    let b = git_out(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if b == "HEAD" {
        git_out(root, &["rev-parse", "HEAD"])
    } else {
        Ok(b)
    }
}

/// True when the working tree at `dir` has uncommitted changes.
pub(crate) fn is_dirty(dir: &Path) -> bool {
    git_out(dir, &["status", "--porcelain"]).map(|s| !s.is_empty()).unwrap_or(false)
}

/// Create a git worktree + branch `8sync/<name>` off the current HEAD.
fn make_worktree(env: &Env, root: &Path, name: &str) -> Result<Worktree> {
    if !root.join(".git").exists() {
        bail!("--worktree needs a git repo (no .git at {})", root.display());
    }
    let base_branch = current_branch(root)?;
    let branch = format!("8sync/{name}");
    let wt_path = key_dir(env, root).join("worktrees").join(name);
    if let Some(parent) = wt_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let wt_str = wt_path.to_string_lossy().to_string();
    let branch_ref = format!("refs/heads/{branch}");
    if git_ok(root, &["show-ref", "--verify", "--quiet", branch_ref.as_str()]) {
        // branch already exists — attach a worktree to it
        git_out(root, &["worktree", "add", wt_str.as_str(), branch.as_str()])?;
    } else {
        git_out(root, &["worktree", "add", "-b", branch.as_str(), wt_str.as_str(), "HEAD"])?;
    }
    ui::ok(&format!("worktree {} → branch {} (base {})", wt_path.display(), branch, base_branch));
    Ok(Worktree { path: wt_path, branch, base_branch })
}

fn touch(env: &Env, root: &Path, reg: &mut Registry, name: &str) -> Result<()> {
    let t = now();
    if let Some(s) = reg.get_mut(name) {
        s.last_active = t;
    }
    reg.last_used = Some(name.to_string());
    save(env, root, reg)
}

// ── commands ───────────────────────────────────────────────────────────────

/// `8sync .` — resume the last-used session (or omp's default store if none).
pub fn resume_latest(env: &Env, root: &Path) -> Result<()> {
    let mut reg = load(env, root);
    if let Some(name) = reg.last_used.clone() {
        if let Some(s) = reg.get(&name) {
            let dir = s.session_dir.clone();
            let cwd = session_cwd(s, root).to_path_buf();
            ui::ok(&format!("→ resume session '{name}' (latest)"));
            touch(env, root, &mut reg, &name)?;
            return launch(&cwd, &dir, false, (root, &name), None);
        }
    }
    // No named session yet — legacy behavior: omp's default path-scoped store.
    resume_default(root)
}

/// omp's default (unnamed) session — exactly the pre-feature `8sync .`.
fn resume_default(root: &Path) -> Result<()> {
    if which::which("omp").is_err() {
        ui::warn("omp not installed — run `8sync setup` first. Falling back to $SHELL.");
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let _ = Command::new(&shell).current_dir(root).status();
        return Ok(());
    }
    ui::ok("→ exec: omp --continue");
    let cfg = crate::models::ModelConfig::load();
    let status = Command::new("omp")
        .arg("--cwd")
        .arg(root)
        .args(cfg.resume_flags())
        .arg("--continue")
        .current_dir(root)
        .status()
        .context("could not exec omp")?;
    if !status.success() {
        ui::warn("omp exited non-zero");
    }
    Ok(())
}

/// `8sync . <name> [--model <id>]` — create-or-resume a named session.
pub fn resume_named(env: &Env, root: &Path, name: &str, model: Option<&str>) -> Result<()> {
    if !valid_name(name) {
        bail!("invalid session name '{name}' (use letters, digits, '-', '_', '.'; ≤64 chars)");
    }
    let mut reg = load(env, root);
    if reg.get(name).is_some() {
        let s = reg.get(name).unwrap();
        let dir = s.session_dir.clone();
        let cwd = session_cwd(s, root).to_path_buf();
        ui::ok(&format!("→ resume session '{name}'"));
        touch(env, root, &mut reg, name)?;
        // A session made without a launch (`8sync ccc auto up --omp` creates its rooms first) has
        // no conversation yet: open a fresh one instead of continuing nothing.
        let fresh = crate::verbs::session_view::omp_transcript(&dir).is_none();
        launch(&cwd, &dir, fresh, (root, name), model)
    } else {
        ui::info(&format!("no session '{name}' yet — creating it"));
        create(env, root, &mut reg, name, false)?;
        let s = reg.get(name).unwrap();
        let dir = s.session_dir.clone();
        let cwd = session_cwd(s, root).to_path_buf();
        touch(env, root, &mut reg, name)?;
        launch(&cwd, &dir, true, (root, name), model)
    }
}

/// `8sync . new <name>` — create a named session (refuses an existing name).
pub fn cmd_new(env: &Env, root: &Path, name: &str, worktree: bool) -> Result<()> {
    if !valid_name(name) {
        bail!("invalid session name '{name}' (use letters, digits, '-', '_', '.'; ≤64 chars)");
    }
    let mut reg = load(env, root);
    if reg.get(name).is_some() {
        bail!("session '{name}' already exists — resume with `8sync . {name}`");
    }
    create(env, root, &mut reg, name, worktree)?;
    let s = reg.get(name).unwrap();
    let dir = s.session_dir.clone();
    let cwd = session_cwd(s, root).to_path_buf();
    ui::ok(&format!("created session '{name}'"));
    touch(env, root, &mut reg, name)?;
    launch(&cwd, &dir, true, (root, name), None)
}

/// The session dir of the named session `name` of this repo, creating the session like
/// `8sync . new <name>` when missing but never launching omp. `last_used` is left alone, so the
/// owner's bare `8sync .` still resumes what it did. Used by `8sync ccc auto up --omp`.
pub(crate) fn ensure(env: &Env, root: &Path, name: &str) -> Result<PathBuf> {
    if !valid_name(name) {
        bail!("invalid session name '{name}' (use letters, digits, '-', '_', '.'; ≤64 chars)");
    }
    let mut reg = load(env, root);
    if let Some(s) = reg.get(name) {
        return Ok(s.session_dir.clone());
    }
    create(env, root, &mut reg, name, false)?;
    reg.get(name).map(|s| s.session_dir.clone()).context("session vừa tạo không có trong registry")
}

fn create(env: &Env, root: &Path, reg: &mut Registry, name: &str, worktree: bool) -> Result<()> {
    let dir = key_dir(env, root).join(name);
    std::fs::create_dir_all(&dir)?;
    let wt = if worktree { Some(make_worktree(env, root, name)?) } else { None };
    let t = now();
    reg.sessions.push(Session {
        name: name.to_string(),
        session_dir: dir,
        worktree: wt,
        created: t,
        last_active: t,
    });
    save(env, root, reg)
}

/// `8sync . ls` / `8sync . --list` — list this repo's omp sessions with what
/// each is doing (rendering in `session_view.rs`). `json=true` emits a
/// machine-readable array (scripting).
pub fn cmd_ls(env: &Env, root: &Path, json: bool) -> Result<()> {
    use super::session_view as view;
    let reg = load(env, root);
    let rows = view::omp_rows(&reg, Some(root), &view::agent_cmdlines(), false, true);
    debug_assert_eq!(rows.len(), reg.sessions.len(), "one row per registry entry (zip below)");
    if json {
        let arr: Vec<serde_json::Value> = rows
            .iter()
            .zip(&reg.sessions)
            .map(|(r, s)| {
                let mut v = view::row_json(r);
                v["worktree"] = serde_json::json!(s.worktree.as_ref().map(|w| w.path.clone()));
                v["session_dir"] = serde_json::json!(s.session_dir);
                v
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&arr)?);
        return Ok(());
    }
    if rows.is_empty() {
        ui::info("no named sessions in this repo — create one: `8sync . new <name>`");
        return Ok(());
    }
    ui::header(&format!("sessions · {}", root.display()));
    let (now, width, color) = (now(), view::term_width(), view::use_color());
    for r in &rows {
        for l in view::render(r, width, now, color) {
            println!("{l}");
        }
    }
    println!("\n  8sync . <name> resume  ·  8sync . new <name> [--worktree]  ·  8sync show <name>  ·  8sync ls --all");
    Ok(())
}

/// Cwd-scoped session health for `8sync doctor`: `(total, worktrees, dirty)`,
/// or `None` when this repo has no sessions.
pub fn health(env: &Env, root: &Path) -> Option<(usize, usize, usize)> {
    let reg = load(env, root);
    if reg.sessions.is_empty() {
        return None;
    }
    let worktrees = reg.sessions.iter().filter(|s| s.worktree.is_some()).count();
    let dirty = reg
        .sessions
        .iter()
        .filter_map(|s| s.worktree.as_ref())
        .filter(|w| is_dirty(&w.path))
        .count();
    Some((reg.sessions.len(), worktrees, dirty))
}

/// `8sync . rm <name>` — remove a session. Deletes the transcript store only
/// with `--force` (default: unregister + keep the store, warn).
pub fn cmd_rm(env: &Env, root: &Path, name: &str, force: bool) -> Result<()> {
    let mut reg = load(env, root);
    let Some(pos) = reg.sessions.iter().position(|s| s.name == name) else {
        bail!("no session '{name}' in this repo");
    };
    let s = reg.sessions[pos].clone();

    // Worktree teardown (guard dirty unless --force).
    if let Some(w) = &s.worktree {
        if is_dirty(&w.path) && !force {
            bail!(
                "session '{name}' worktree has uncommitted changes at {} — commit/merge it first, or `rm --force`",
                w.path.display()
            );
        }
        let wt_str = w.path.to_string_lossy().to_string();
        let mut wt_args = vec!["worktree", "remove", wt_str.as_str()];
        if force {
            wt_args.push("--force");
        }
        if git_ok(root, &wt_args) {
            ui::ok(&format!("removed worktree {}", w.path.display()));
        } else {
            ui::warn(&format!("could not remove worktree {} (unregistering anyway)", w.path.display()));
        }
        let del = if force { "-D" } else { "-d" };
        if git_ok(root, &["branch", del, w.branch.as_str()]) {
            ui::ok(&format!("deleted branch {}", w.branch));
        } else {
            ui::warn(&format!("branch {} kept (unmerged?) — `git branch -D {}` to force", w.branch, w.branch));
        }
    }

    if !force {
        ui::warn(&format!(
            "unregistering '{name}' but KEEPING its transcript at {} — use `--force` to delete it too",
            s.session_dir.display()
        ));
    } else {
        let _ = std::fs::remove_dir_all(&s.session_dir);
        ui::ok(&format!("deleted transcript store {}", s.session_dir.display()));
    }
    reg.sessions.remove(pos);
    if reg.last_used.as_deref() == Some(name) {
        reg.last_used = None;
    }
    save(env, root, &reg)?;
    ui::ok(&format!("removed session '{name}'"));
    Ok(())
}

/// `8sync . mv <old> <new>` — rename a session (registry + session dir).
pub fn cmd_mv(env: &Env, root: &Path, old: &str, new: &str) -> Result<()> {
    if !valid_name(new) {
        bail!("invalid session name '{new}' (use letters, digits, '-', '_', '.'; ≤64 chars)");
    }
    let mut reg = load(env, root);
    if reg.get(new).is_some() {
        bail!("session '{new}' already exists");
    }
    let Some(idx) = reg.sessions.iter().position(|s| s.name == old) else {
        bail!("no session '{old}' in this repo");
    };
    let new_dir = key_dir(env, root).join(new);
    {
        let s = &mut reg.sessions[idx];
        if s.session_dir.exists() {
            std::fs::rename(&s.session_dir, &new_dir).context("rename session dir")?;
        }
        s.name = new.to_string();
        s.session_dir = new_dir;
        // Worktree: move its dir + rename its branch to keep the 8sync/<name> slug.
        if let Some(w) = s.worktree.clone() {
            let new_branch = format!("8sync/{new}");
            let new_wt = key_dir(env, root).join("worktrees").join(new);
            let old_wt = w.path.to_string_lossy().to_string();
            let new_wt_s = new_wt.to_string_lossy().to_string();
            if git_ok(root, &["worktree", "move", old_wt.as_str(), new_wt_s.as_str()]) {
                s.worktree.as_mut().unwrap().path = new_wt;
            } else {
                ui::warn(&format!("could not move worktree {} → {}", w.path.display(), new_wt.display()));
            }
            if git_ok(root, &["branch", "-m", w.branch.as_str(), new_branch.as_str()]) {
                s.worktree.as_mut().unwrap().branch = new_branch;
            } else {
                ui::warn(&format!("could not rename branch {} → 8sync/{}", w.branch, new));
            }
        }
    }
    if reg.last_used.as_deref() == Some(old) {
        reg.last_used = Some(new.to_string());
    }
    save(env, root, &reg)?;
    ui::ok(&format!("renamed session '{old}' → '{new}'"));
    Ok(())
}

/// `8sync . merge <name>...` — land session branches into the repo's current
/// branch, ECC-style: read-only `git merge-tree` conflict preflight → `git merge
/// --no-edit` → rebase-to-unblock a conflicted branch → clean up the merged
/// worktree + branch + session (unless `--keep-worktree`). Sequential: the target
/// advances after each merge, so a later branch is re-checked against the earlier
/// ones (branch-vs-branch conflicts surface naturally). Local only — never pushes.
pub fn cmd_merge(env: &Env, root: &Path, names: &[String], keep_worktree: bool) -> Result<()> {
    if names.is_empty() {
        bail!("usage: 8sync . merge <name> [<name>...]  (lands each session's branch into the current branch)");
    }
    if !root.join(".git").exists() {
        bail!("merge needs a git repo at {}", root.display());
    }
    if is_dirty(root) {
        bail!(
            "main working tree at {} has uncommitted changes — commit or stash them before merging",
            root.display()
        );
    }
    let target = current_branch(root)?;
    ui::header(&format!("merge → {target}"));
    let mut reg = load(env, root);

    for name in names {
        let Some(s) = reg.get(name) else {
            ui::warn(&format!("no session '{name}' — skipped"));
            continue;
        };
        let Some(w) = s.worktree.clone() else {
            ui::warn(&format!("session '{name}' has no worktree/branch — nothing to merge, skipped"));
            continue;
        };
        if w.branch == target {
            ui::warn(&format!("session '{name}' is on the target branch '{target}' — skipped"));
            continue;
        }
        if is_dirty(&w.path) {
            ui::err(&format!("'{name}' has uncommitted changes at {} — commit them first, skipped", w.path.display()));
            continue;
        }

        // 1. Read-only conflict preflight.
        if let Some(files) = merge_conflicts(root, &target, &w.branch)? {
            ui::warn(&format!("'{name}' ({}) conflicts with {target} [{}] — rebasing to unblock", w.branch, files.join(", ")));
            // 2. Rebase the src worktree onto the target to unblock.
            if git_ok(&w.path, &["rebase", target.as_str()]) {
                ui::ok(&format!("rebased {} onto {target}", w.branch));
            } else {
                let _ = git_ok(&w.path, &["rebase", "--abort"]);
                ui::err(&format!("'{name}' still conflicts after rebase — resolve manually in {}, then re-run", w.path.display()));
                continue;
            }
            if let Some(files) = merge_conflicts(root, &target, &w.branch)? {
                ui::err(&format!("'{name}' still conflicts ({}) — skipped", files.join(", ")));
                continue;
            }
        }

        // 3. Merge into the current branch (in the main working tree).
        if git_ok(root, &["merge", "--no-edit", w.branch.as_str()]) {
            ui::ok(&format!("merged '{name}' ({}) → {target}", w.branch));
        } else {
            let _ = git_ok(root, &["merge", "--abort"]);
            ui::err(&format!("merge of '{name}' failed — skipped"));
            continue;
        }

        // 4. Clean up the landed feature (worktree + branch + session).
        if keep_worktree {
            ui::info(&format!("kept worktree {} + branch {} (--keep-worktree)", w.path.display(), w.branch));
        } else {
            let wt_str = w.path.to_string_lossy().to_string();
            let _ = git_ok(root, &["worktree", "remove", "--force", wt_str.as_str()]);
            let _ = git_ok(root, &["branch", "-d", w.branch.as_str()]); // safe: now merged
            if let Some(pos) = reg.sessions.iter().position(|x| &x.name == name) {
                let _ = std::fs::remove_dir_all(&reg.sessions[pos].session_dir);
                reg.sessions.remove(pos);
                if reg.last_used.as_deref() == Some(name.as_str()) {
                    reg.last_used = None;
                }
            }
            ui::ok(&format!("cleaned up session '{name}' (worktree + branch + transcript)"));
        }
        save(env, root, &reg)?;
    }
    ui::ok("merge complete");
    Ok(())
}

/// Read-only conflict preflight via `git merge-tree --write-tree` (never mutates
/// the working tree). `None` = clean; `Some(files)` = conflicted paths.
fn merge_conflicts(root: &Path, target: &str, branch: &str) -> Result<Option<Vec<String>>> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["merge-tree", "--write-tree", "--name-only", target, branch])
        .output()
        .context("git merge-tree")?;
    if out.status.success() {
        return Ok(None);
    }
    // Non-zero exit ⇒ conflicts. Output: <tree-oid>, then a blank line, then the
    // conflicted file names (best-effort parse — exit code is the source of truth).
    let stdout = String::from_utf8_lossy(&out.stdout);
    let files: Vec<String> = stdout
        .lines()
        .skip(1) // tree oid
        .map(str::trim)
        .take_while(|l| !l.is_empty()) // stop at the blank before info messages
        .filter(|l| !l.contains(' ')) // drop "Auto-merging …" / "CONFLICT …" info lines
        .map(String::from)
        .collect();
    Ok(Some(if files.is_empty() { vec!["conflict".to_string()] } else { files }))
}
