//! `8sync trail` — STEP 0 of the harness: the code map for agents (Trail-code, CLI `trail`).
//!
//! `trail ask|grep|skeleton|callers|map` answer structure questions from a tree-sitter graph (no
//! model call). This module only does the plumbing: find/install the binary, keep telemetry off,
//! wire a repo for Claude Code (`trail init`, repo scope only) and keep the graph dir out of git.
//! Nothing here overwrites a file the owner wrote: `trail init` merges, and a repo whose
//! `.claude/settings.json` has uncommitted changes is left alone.
use anyhow::{bail, Context, Result};
use clap::Args as ClapArgs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::{env_detect, ui};

pub(crate) const NPM_PKG: &str = "@trailhq/trail-code";
/// Printed with the install: why a plain `npm i -g` is not used.
const IGNORE_SCRIPTS_WHY: &str =
    "--ignore-scripts: the tree-sitter-kotlin grammar fails to compile via node-gyp on Node 26, and a plain install aborts on it";
/// The repo marker `trail init` leaves; its presence means "already wired".
const HOOK_SHIM: &str = ".trail/hook.cjs";
const SETTINGS: &str = ".claude/settings.json";
/// Folders `--all` never descends into.
const SKIP_DIRS: [&str; 6] = ["node_modules", "target", "vendor", "dist", "build", "worktrees"];
/// `--all` looks this many levels below ROOT (ROOT itself is level 0).
const MAX_DEPTH: usize = 3;

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync trail                       install trail if missing, telemetry off, wire THIS repo for Claude Code
      8sync trail <dir>                 same for another repo
      8sync trail status                trail version, telemetry, is this repo wired
      8sync trail off [dir]             unwire the repo (trail uninstall; keeps ~/ files)
      8sync trail --all ROOT            wire every git repo under ROOT (depth <= 3), prints a table
      8sync trail --all ROOT --dry-run  same table, writes nothing (asks `trail init --dry-run`)

    WHAT IT RUNS
      npm install -g @trailhq/trail-code --ignore-scripts      (only when `trail` is missing)
      trail telemetry disable                                  (once; DO_NOT_TRACK=1 on every child)
      trail init --agents claude --no-global --no-statusline --plain --yes <repo>
                                        (only when <repo>/.trail/hook.cjs is missing and
                                         <repo>/.claude/settings.json has no uncommitted change)
"})]
pub struct Args {
    /// A repo dir (default: the current repo) | `status` | `off [dir]`
    pub target: Vec<String>,
    /// Wire every git repo under ROOT (default: the current dir), depth <= 3
    #[arg(long, value_name = "ROOT", num_args = 0..=1, default_missing_value = ".")]
    pub all: Option<String>,
    /// Write nothing: pass `--dry-run` to `trail init`, never install
    #[arg(long)]
    pub dry_run: bool,
}

pub fn run(a: Args) -> Result<()> {
    let env = env_detect::Env::detect()?;
    if let Some(root) = a.all.as_deref() {
        return run_all(&env, Path::new(root), a.dry_run);
    }
    match a.target.first().map(String::as_str) {
        Some("status") => status(&env),
        Some("off") => off(a.target.get(1).map(String::as_str), a.dry_run),
        other => run_one(&env, other, a.dry_run),
    }
}

// ── binary + env ───────────────────────────────────────────────────────────────────────────

/// `trail` on PATH (resolves `trail.cmd` on Windows).
pub(crate) fn found() -> Option<PathBuf> {
    which::which("trail").ok()
}

/// A `trail` child: no stdin, telemetry off (`DO_NOT_TRACK=1`) whatever the caller's env says.
fn trail_cmd(bin: &Path) -> Command {
    let mut c = Command::new(bin);
    c.env("DO_NOT_TRACK", "1").stdin(Stdio::null());
    c
}

/// `npm` arguments of the install. Pure so a test pins the flags.
pub(crate) fn install_args() -> [&'static str; 4] {
    ["install", "-g", NPM_PKG, "--ignore-scripts"]
}

/// `trail init` arguments for repo `dir`: Claude Code only, nothing outside the repo, no
/// statusline (8sync keeps its own), no model call for the look-back (`--plain`).
pub(crate) fn init_args(dir: &Path, dry_run: bool) -> Vec<String> {
    let mut v: Vec<String> = ["init", "--agents", "claude", "--no-global", "--no-statusline", "--plain", "--yes"].map(String::from).to_vec();
    if dry_run {
        v.push("--dry-run".into());
    }
    v.push(dir.display().to_string());
    v
}

/// Install `trail` when missing. Returns its path.
pub(crate) fn ensure_installed() -> Result<PathBuf> {
    if let Some(p) = found() {
        return Ok(p);
    }
    let npm = which::which("npm").context("`trail` is missing and `npm` is not on PATH — install Node.js, then run `8sync trail`")?;
    ui::step(&format!("trail (missing) → npm {}", install_args().join(" ")));
    ui::info(IGNORE_SCRIPTS_WHY);
    let st = Command::new(npm).args(install_args()).stdin(Stdio::null()).status().context("run npm")?;
    if !st.success() {
        bail!("`npm {}` exited {st}", install_args().join(" "));
    }
    let p = found().context("npm reported success but `trail` is still not on PATH (open a new shell or add npm's global bin dir to PATH)")?;
    ui::ok(&format!("trail installed → {}", p.display()));
    Ok(p)
}

/// `trail telemetry disable`, once per machine (marker in the 8sync config dir).
pub(crate) fn ensure_telemetry_off(home: &Path, bin: &Path) {
    let marker = crate::brand::config_dir(home).join("trail-telemetry-off");
    if marker.exists() {
        return;
    }
    match trail_cmd(bin).args(["telemetry", "disable"]).output() {
        Ok(o) if o.status.success() => {
            if let Some(d) = marker.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(&marker, "trail telemetry disable ran\n");
            ui::ok("trail telemetry disabled");
        }
        Ok(o) => ui::warn(&format!("`trail telemetry disable` exited {} — DO_NOT_TRACK=1 is still set on every trail call 8sync makes", o.status)),
        Err(e) => ui::warn(&format!("could not run `trail telemetry disable`: {e}")),
    }
}

// ── one repo ───────────────────────────────────────────────────────────────────────────────

/// What happened to one repo.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    /// `trail init` ran.
    Wired,
    /// `.trail/hook.cjs` was already there.
    Already,
    /// `.claude/settings.json` has uncommitted changes: not touched.
    DirtySettings,
    /// `--dry-run`: `trail init --dry-run` accepted the repo, nothing written.
    Preview,
    Failed(String),
}

impl Outcome {
    fn label(&self) -> String {
        match self {
            Outcome::Wired => "wired".into(),
            Outcome::Already => "already wired".into(),
            Outcome::DirtySettings => "skipped: .claude/settings.json has uncommitted changes".into(),
            Outcome::Preview => "would wire (dry-run)".into(),
            Outcome::Failed(e) => format!("FAILED: {e}"),
        }
    }
}

fn is_wired(dir: &Path) -> bool {
    dir.join(HOOK_SHIM).is_file()
}

/// `git status --porcelain` lines for the repo's `.claude/settings.json`.
fn settings_status(dir: &Path) -> String {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["status", "--porcelain", "--", SETTINGS])
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

/// True when git reports any change (modified or untracked) to the repo's `.claude/settings.json`:
/// a file the owner may have written, so `init` must not merge into it.
fn settings_dirty(dir: &Path) -> bool {
    !settings_status(dir).trim().is_empty()
}

/// True when a TRACKED `.claude/settings.json` has uncommitted edits. `off` only needs this: a
/// still-untracked file in a wired repo is the one `trail init` wrote.
fn settings_edited(dir: &Path) -> bool {
    settings_status(dir).lines().any(|l| !l.trim().is_empty() && !l.starts_with("??"))
}

/// Pure: `existing` with a `graft/` line appended, or None when it already ignores it. Keeps the
/// file's own line ending and never rewrites a line.
pub(crate) fn gitignore_with_graft(existing: &str) -> Option<String> {
    if existing.lines().any(|l| matches!(l.trim(), "graft" | "graft/" | "/graft" | "/graft/")) {
        return None;
    }
    let nl = if existing.contains("\r\n") { "\r\n" } else { "\n" };
    let mut s = existing.to_string();
    if !s.is_empty() && !s.ends_with('\n') {
        s.push_str(nl);
    }
    s.push_str("graft/");
    s.push_str(nl);
    Some(s)
}

/// Add `graft/` (trail's graph dir in older layouts; 0.25 keeps its cache in the self-ignoring
/// `.trail/cache/`) to `<dir>/.gitignore`. Appends only; creates the file only when a `graft/`
/// dir exists, so a repo without a `.gitignore` is not given one for nothing.
fn ensure_gitignore(dir: &Path) -> Result<bool> {
    let path = dir.join(".gitignore");
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) if dir.join("graft").is_dir() => String::new(),
        Err(_) => return Ok(false),
    };
    let Some(new) = gitignore_with_graft(&existing) else { return Ok(false) };
    std::fs::write(&path, new).with_context(|| format!("write {}", path.display()))?;
    Ok(true)
}

/// Wire `dir` for Claude Code through `trail init` unless it is already wired. Never overwrites:
/// a repo with uncommitted changes in `.claude/settings.json` is skipped.
pub(crate) fn ensure_repo(bin: &Path, dir: &Path, dry_run: bool) -> Outcome {
    if is_wired(dir) {
        if !dry_run {
            let _ = ensure_gitignore(dir);
        }
        return Outcome::Already;
    }
    if settings_dirty(dir) {
        return Outcome::DirtySettings;
    }
    let out = match trail_cmd(bin).args(init_args(dir, dry_run)).output() {
        Ok(o) => o,
        Err(e) => return Outcome::Failed(format!("run trail: {e}")),
    };
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let msg = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("trail init failed");
        return Outcome::Failed(format!("trail init exited {}: {}", out.status, msg.trim()));
    }
    if dry_run {
        return Outcome::Preview;
    }
    match ensure_gitignore(dir) {
        Ok(true) => ui::ok(&format!("{}: added graft/ to .gitignore", dir.display())),
        Ok(false) => {}
        Err(e) => ui::warn(&format!("{}: .gitignore not updated: {e:#}", dir.display())),
    }
    Outcome::Wired
}

/// Best-effort STEP-0 setup used by `8sync harness` / `up`: never fails the caller.
pub(crate) fn ensure_for_harness(env: &env_detect::Env, root: &Path) {
    let bin = match ensure_installed() {
        Ok(b) => b,
        Err(e) => {
            ui::warn(&format!("trail not available: {e:#} — STEP 0 falls back to grep/read"));
            return;
        }
    };
    ensure_telemetry_off(&env.home, &bin);
    ui::step(&format!("trail init {}", root.display()));
    let o = ensure_repo(&bin, root, false);
    match &o {
        Outcome::Wired => ui::ok("repo wired for trail (Claude Code hook, no global hooks)"),
        Outcome::Already => ui::skip("trail", "repo already wired"),
        Outcome::Failed(_) | Outcome::DirtySettings | Outcome::Preview => ui::warn(&format!("trail: {}", o.label())),
    }
}

/// `trail build` for an already wired repo (`harness up`): re-reads only what changed.
pub(crate) fn refresh(root: &Path) {
    let Some(bin) = found() else { return };
    if !is_wired(root) {
        return;
    }
    ui::step("trail build (refresh the code map)");
    match trail_cmd(&bin).arg("build").arg(root).output() {
        Ok(o) if o.status.success() => {}
        Ok(o) => ui::warn(&format!("`trail build` exited {}", o.status)),
        Err(e) => ui::warn(&format!("could not run `trail build`: {e}")),
    }
}

/// Repo root of `dir` (or `dir` itself outside git).
fn repo_root(dir: &Path) -> PathBuf {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", "--show-toplevel"])
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()))
        .unwrap_or_else(|| dir.to_path_buf())
}

fn target_dir(arg: Option<&str>) -> Result<PathBuf> {
    let dir = match arg {
        Some(d) => PathBuf::from(d),
        None => std::env::current_dir().context("current dir")?,
    };
    if !dir.is_dir() {
        bail!("{} is not a directory", dir.display());
    }
    Ok(repo_root(&dir))
}

fn run_one(env: &env_detect::Env, dir: Option<&str>, dry_run: bool) -> Result<()> {
    let dir = target_dir(dir)?;
    ui::header(&format!("8sync trail — {}", dir.display()));
    let bin = match (found(), dry_run) {
        (Some(b), _) => b,
        (None, true) => {
            ui::info(&format!("dry-run: trail is not installed; would run: npm {}", install_args().join(" ")));
            ui::info(IGNORE_SCRIPTS_WHY);
            return Ok(());
        }
        (None, false) => ensure_installed()?,
    };
    if !dry_run {
        ensure_telemetry_off(&env.home, &bin);
    }
    let o = ensure_repo(&bin, &dir, dry_run);
    match o {
        Outcome::Wired => {
            ui::ok("repo wired: .claude/settings.json (SessionStart hook) + .trail/ — commit both once");
            ui::info("ask the map: trail ask \"<question>\" · trail grep <pat> · trail skeleton <file> · trail callers <symbol> · trail map");
        }
        Outcome::Already => ui::skip("trail", "repo already wired (refresh the map: `trail build`)"),
        Outcome::Preview => ui::info("dry-run: `trail init` would wire this repo; nothing written"),
        Outcome::DirtySettings | Outcome::Failed(_) => bail!("{}", o.label()),
    }
    Ok(())
}

fn status(env: &env_detect::Env) -> Result<()> {
    ui::header("8sync trail — status");
    let Some(bin) = found() else {
        ui::warn(&format!("trail NOT installed — run `8sync trail` (npm {})", install_args().join(" ")));
        return Ok(());
    };
    let ver = trail_cmd(&bin).arg("--version").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    ui::ok(&format!("trail {} → {}", if ver.is_empty() { "?" } else { &ver }, bin.display()));
    let marker = crate::brand::config_dir(&env.home).join("trail-telemetry-off");
    ui::info(&format!("telemetry: DO_NOT_TRACK=1 on every call from 8sync; `trail telemetry disable` {}", if marker.exists() { "done" } else { "not run yet (8sync trail does it)" }));
    let dir = target_dir(None)?;
    if is_wired(&dir) {
        ui::ok(&format!("{} is wired", dir.display()));
        if let Ok(o) = trail_cmd(&bin).arg("status").arg(&dir).output() {
            print!("{}", String::from_utf8_lossy(&o.stdout));
        }
    } else {
        ui::info(&format!("{} is not wired — `8sync trail`", dir.display()));
    }
    Ok(())
}

fn off(dir: Option<&str>, dry_run: bool) -> Result<()> {
    let dir = target_dir(dir)?;
    ui::header(&format!("8sync trail off — {}", dir.display()));
    let Some(bin) = found() else {
        ui::skip("trail", "not installed — nothing to unwire");
        return Ok(());
    };
    if !is_wired(&dir) {
        ui::skip("trail", "repo is not wired");
        return Ok(());
    }
    if settings_edited(&dir) {
        bail!("{}", Outcome::DirtySettings.label());
    }
    let mut c = trail_cmd(&bin);
    c.args(["uninstall", "--no-global"]);
    if !dry_run {
        c.arg("--yes");
    }
    let st = c.arg(&dir).status().context("run trail uninstall")?;
    if !st.success() {
        bail!("`trail uninstall` exited {st}");
    }
    Ok(())
}

// ── --all ──────────────────────────────────────────────────────────────────────────────────

/// Git repos under `root`, at most `max_depth` levels down (root = 0). A folder with a `.git`
/// DIRECTORY is a repo and is not searched further; one with a `.git` FILE is a worktree or
/// submodule of a repo found elsewhere and is skipped. Hidden folders and [`SKIP_DIRS`] are
/// never entered.
pub(crate) fn find_repos(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, max: usize, out: &mut Vec<PathBuf>) {
        match std::fs::symlink_metadata(dir.join(".git")) {
            Ok(m) if m.is_dir() => {
                out.push(dir.to_path_buf());
                return;
            }
            Ok(_) => return,
            Err(_) => {}
        }
        if depth >= max {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut subs: Vec<PathBuf> = rd
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter(|e| {
                let n = e.file_name();
                let n = n.to_string_lossy();
                !n.starts_with('.') && !SKIP_DIRS.contains(&n.as_ref())
            })
            .map(|e| e.path())
            .collect();
        subs.sort();
        for s in subs {
            walk(&s, depth + 1, max, out);
        }
    }
    let mut out = Vec::new();
    walk(root, 0, max_depth, &mut out);
    out
}

fn run_all(env: &env_detect::Env, root: &Path, dry_run: bool) -> Result<()> {
    if !root.is_dir() {
        bail!("{} is not a directory", root.display());
    }
    let repos = find_repos(root, MAX_DEPTH);
    ui::header(&format!("8sync trail --all {}{}", root.display(), if dry_run { " (dry-run)" } else { "" }));
    if repos.is_empty() {
        ui::info(&format!("no git repo within {MAX_DEPTH} levels of {}", root.display()));
        return Ok(());
    }
    let bin = match (found(), dry_run) {
        (Some(b), _) => Some(b),
        (None, true) => {
            ui::info(&format!("trail is not installed; a real run would first: npm {}", install_args().join(" ")));
            None
        }
        (None, false) => Some(ensure_installed()?),
    };
    if let (Some(b), false) = (&bin, dry_run) {
        ensure_telemetry_off(&env.home, b);
    }
    let mut rows: Vec<(PathBuf, String)> = Vec::new();
    for r in &repos {
        let label = match &bin {
            Some(b) => ensure_repo(b, r, dry_run).label(),
            // no trail to ask: report only what the filesystem says
            None if is_wired(r) => Outcome::Already.label(),
            None if settings_dirty(r) => Outcome::DirtySettings.label(),
            None => "would wire (needs trail installed first)".into(),
        };
        rows.push((r.clone(), label));
    }
    let shown = |p: &Path| p.display().to_string().replace('\\', "/");
    let w = rows.iter().map(|(p, _)| shown(p).chars().count()).max().unwrap_or(0);
    println!("{:<w$}  STATE", "REPO");
    for (p, l) in &rows {
        println!("{:<w$}  {l}", shown(p));
    }
    let failed = rows.iter().filter(|(_, l)| l.starts_with("FAILED")).count();
    ui::info(&format!("{} repo(s): {} failed", rows.len(), failed));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-trail-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn install_skips_scripts_and_is_global() {
        let a = install_args();
        assert_eq!(a, ["install", "-g", "@trailhq/trail-code", "--ignore-scripts"]);
        assert!(IGNORE_SCRIPTS_WHY.contains("Node 26") && IGNORE_SCRIPTS_WHY.contains("kotlin"));
    }

    #[test]
    fn init_is_repo_scoped_and_model_free() {
        let v = init_args(Path::new("/r"), false);
        for f in ["--agents", "claude", "--no-global", "--no-statusline", "--plain", "--yes"] {
            assert!(v.iter().any(|x| x == f), "{f} missing: {v:?}");
        }
        assert!(!v.iter().any(|x| x == "--dry-run" || x == "--connect" || x == "--pair" || x == "--all-agents"));
        assert_eq!(v.last().map(String::as_str), Some("/r"), "dir is the last arg");
        assert!(init_args(Path::new("/r"), true).iter().any(|x| x == "--dry-run"));
    }

    #[test]
    fn every_trail_child_runs_with_telemetry_off() {
        let c = trail_cmd(Path::new("trail"));
        let v: Vec<_> = c.get_envs().collect();
        assert!(v.iter().any(|(k, val)| *k == "DO_NOT_TRACK" && *val == Some(std::ffi::OsStr::new("1"))));
    }

    #[test]
    fn gitignore_append_is_idempotent_and_keeps_line_endings() {
        assert_eq!(gitignore_with_graft("target/\n").as_deref(), Some("target/\ngraft/\n"));
        assert_eq!(gitignore_with_graft("target/").as_deref(), Some("target/\ngraft/\n"), "no trailing newline");
        assert_eq!(gitignore_with_graft("a\r\nb\r\n").as_deref(), Some("a\r\nb\r\ngraft/\r\n"));
        assert_eq!(gitignore_with_graft("").as_deref(), Some("graft/\n"));
        for done in ["graft/\n", "x\n/graft\n", "x\n graft \n"] {
            assert_eq!(gitignore_with_graft(done), None, "{done:?}");
        }
        let once = gitignore_with_graft("x\n").unwrap();
        assert_eq!(gitignore_with_graft(&once), None);
    }

    #[test]
    fn gitignore_is_created_only_when_a_graft_dir_exists() {
        let d = tmp("gi");
        assert!(!ensure_gitignore(&d).unwrap());
        assert!(!d.join(".gitignore").exists(), "no .gitignore invented for nothing");
        std::fs::write(d.join(".gitignore"), "target/\n").unwrap();
        assert!(ensure_gitignore(&d).unwrap());
        assert!(!ensure_gitignore(&d).unwrap(), "second run changes nothing");
        assert_eq!(std::fs::read_to_string(d.join(".gitignore")).unwrap(), "target/\ngraft/\n");
        let g = tmp("gi2");
        std::fs::create_dir_all(g.join("graft")).unwrap();
        assert!(ensure_gitignore(&g).unwrap());
        assert_eq!(std::fs::read_to_string(g.join(".gitignore")).unwrap(), "graft/\n");
        let _ = std::fs::remove_dir_all(&d);
        let _ = std::fs::remove_dir_all(&g);
    }

    #[test]
    fn repos_are_found_to_depth_three_skipping_worktrees_and_vendored_dirs() {
        let root = tmp("repos");
        let mk = |p: &str| std::fs::create_dir_all(root.join(p)).unwrap();
        mk("a/.git");
        mk("g/h/i/.git"); // depth 3: found
        mk("d/e/f/g/.git"); // depth 4: not searched
        mk("b");
        std::fs::write(root.join("b/.git"), "gitdir: ../a/.git/worktrees/b").unwrap(); // worktree file
        mk("c/node_modules/x/.git");
        mk("a/sub/.git"); // inside a repo: not descended into
        mk(".hidden/.git");
        mk("w/worktrees/r/.git");
        let found: Vec<String> = find_repos(&root, 3).iter().map(|p| p.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(found, ["a", "g/h/i"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_wired_repo_is_never_re_initialised() {
        let d = tmp("wired");
        std::fs::create_dir_all(d.join(".trail")).unwrap();
        std::fs::write(d.join(HOOK_SHIM), "x").unwrap();
        // the binary is never invoked for a wired repo
        assert_eq!(ensure_repo(Path::new("/no/such/trail"), &d, true), Outcome::Already);
        let _ = std::fs::remove_dir_all(&d);
    }
}
