use anyhow::{Context, Result};
use clap::Args as ClapArgs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::{env_detect, ui, verbs::{session, skill}};

#[derive(ClapArgs, Debug)]
#[command(
    after_help = indoc::indoc! {"
        EXAMPLES
          8sync .                       resume the latest session in this repo (seeds su-code/* context)
          8sync . <name>                create-or-resume a named session (run many features at once)
          8sync . new <name> [--worktree]  create a fresh session; --worktree = isolated git worktree + branch
          8sync . ls   (or --list, --json) list this repo's named sessions (★ = latest, + branch/dirty)
          8sync . mv <old> <new>        rename a session
          8sync . rm <name> [--force]   remove a session (--force also deletes its transcript + worktree)
          8sync . merge <a> <b> ...     land session branches into the current branch (safe merge, local-only)

        BEHAVIOR
          · A named session is an isolated omp conversation (its own --session-dir), tracked in a
            machine-local registry at ~/.config/8sync/sessions/<repo>/index.json.
          · `8sync .` (no name) resumes the last-used session, or omp's default store if none was named.
          · Walks up from cwd to the project root; seeds AGENTS.md + su-code/* when missing before launching.
          · --worktree gives a session its own tree/branch so features run in parallel without collision;
            merge lands them back via git merge-tree preflight + rebase-to-unblock (never pushes).
          · Reserved verbs (new/ls/list/mv/rm/merge) can't be used as bare session names.
    "}
)]
pub struct Args {
    /// Session verb + args (`new <name>`, `ls`, `mv <old> <new>`, `rm <name>`),
    /// or a bare `<name>` to create-or-resume. Empty = resume latest.
    pub rest: Vec<String>,

    /// List this repo's sessions (same as `ls`).
    #[arg(long)]
    pub list: bool,

    /// With `rm`: also delete the session's omp transcript store (and force-remove its worktree).
    #[arg(long)]
    pub force: bool,

    /// With `new`: give the session its own git worktree + branch `8sync/<name>`.
    #[arg(long)]
    pub worktree: bool,

    /// With `merge`: keep merged worktrees + branches instead of cleaning them up.
    #[arg(long = "keep-worktree")]
    pub keep_worktree: bool,

    /// With `ls`/`--list`: emit machine-readable JSON.
    #[arg(long)]
    pub json: bool,

    /// With `ls`/`--list`: order — priority (default: running/active first, then newest; omp rooms carry no flag) | time | name | status.
    #[arg(long, value_name = "KEY", value_parser = clap::builder::ValueParser::new(|s: &str| s.parse::<crate::verbs::session_view::SortKey>()))]
    pub sort: Option<crate::verbs::session_view::SortKey>,

    /// With `ls`/`--list`: reverse the order.
    #[arg(short = 'r', long)]
    pub reverse: bool,

    /// With a bare `<name>`: run omp on this model (`--model <provider/model>`, e.g. zai/glm-5.3).
    #[arg(long)]
    pub model: Option<String>,
}

pub fn run(a: Args) -> Result<()> {
    let env = env_detect::Env::detect()?;
    let cwd = std::env::current_dir().context("no cwd")?;
    let root = detect_project_root(&cwd).unwrap_or(cwd.clone());

    let (verb, rest) = a
        .rest
        .split_first()
        .map(|(v, r)| (v.as_str(), r))
        .unwrap_or(("", &[][..]));

    // Registry-only ops — quick, no context seed or omp launch.
    let sort = (a.sort.unwrap_or_default(), a.reverse);
    if a.list && verb.is_empty() {
        return session::cmd_ls(&env, &root, a.json, sort);
    }
    match verb {
        "ls" | "list" => return session::cmd_ls(&env, &root, a.json, sort),
        "rm" => {
            let name = rest.first().context("usage: 8sync . rm <name> [--force]")?;
            return session::cmd_rm(&env, &root, name, a.force);
        }
        "mv" => {
            let old = rest.first().context("usage: 8sync . mv <old> <new>")?;
            let new = rest.get(1).context("usage: 8sync . mv <old> <new>")?;
            return session::cmd_mv(&env, &root, old, new);
        }
        "merge" => {
            return session::cmd_merge(&env, &root, rest, a.keep_worktree);
        }
        _ => {}
    }

    // Launch paths — seed project context first.
    ui::header("8sync .");
    ui::info(&format!("project: {}", root.display()));
    let stack = detect_stack(&root);
    if !stack.is_empty() {
        ui::ok(&format!("stack: {}", stack.join(", ")));
    }
    seed_project_context(&env, &root, &stack)?;

    match verb {
        "new" => {
            let name = rest.first().context("usage: 8sync . new <name> [--worktree]")?;
            session::cmd_new(&env, &root, name, a.worktree)
        }
        "" => session::resume_latest(&env, &root),
        name => session::resume_named(&env, &root, name, a.model.as_deref()),
    }
}

/// Scaffold a brand-new project directory headlessly (no omp exec): create the
/// dir, `git init` (so sweep + project detection recognize it), then seed the
/// full 8sync context (AGENTS.md + su-code memory + injected skills block).
/// Used by the dashboard `POST /api/projects/create`. Idempotent on an existing dir.
#[cfg(feature = "web")]
pub(crate) fn scaffold_project(env: &env_detect::Env, root: &Path) -> Result<()> {
    std::fs::create_dir_all(root).with_context(|| format!("create {}", root.display()))?;
    if !root.join(".git").exists() {
        let _ = Command::new("git").arg("-C").arg(root).arg("init").arg("-q").status();
    }
    let stack = detect_stack(root);
    seed_project_context(env, root, &stack)
}

// ═════════════════════════════════════════════════════════════════
// helpers
// ═════════════════════════════════════════════════════════════════

pub(crate) fn detect_project_root(start: &Path) -> Option<PathBuf> {
    let markers = [".git", "Cargo.toml", "package.json", "pyproject.toml", "deno.json", "go.mod"];
    let mut p = start.to_path_buf();
    loop {
        for m in &markers {
            if p.join(m).exists() {
                return Some(p);
            }
        }
        if !p.pop() {
            return None;
        }
    }
}

/// The git repo a path belongs to: a Claude Code worktree
/// (`<repo>/.claude/worktrees/<name>`) counts as its repo; otherwise the nearest ancestor holding
/// `.git`, so a repo nested inside another (`8sync-startup/game/ai-game-studio`) is its own project.
/// A subfolder with its own `package.json` is not (unlike [`detect_project_root`]).
pub(crate) fn repo_of(start: &Path) -> Option<PathBuf> {
    let parts: Vec<_> = start.components().collect();
    let cut = parts.windows(2).rposition(|w| w[0].as_os_str() == ".claude" && w[1].as_os_str() == "worktrees");
    let mut p: PathBuf = match cut {
        Some(i) => parts[..i].iter().collect(),
        None => start.to_path_buf(),
    };
    loop {
        if p.join(".git").exists() {
            return Some(p);
        }
        if !p.pop() {
            return None;
        }
    }
}

/// Give an untracked folder inside another repo its own git repo, so its sessions file under it.
/// Live 2026-10-20: `8sync-startup/game/3d-game` was a new, empty folder
/// with no `.git`; [`repo_of`] walked up to 8sync-startup and every session of the new project opened
/// in the parent. A new project made inside a cluster repo must not land under the parent.
///
/// Inits (`git init -b main` + one empty commit) and returns `dir` only when `dir` has no `.git`,
/// is not a Claude Code worktree, sits under a repo, and that repo tracks nothing at or under it
/// (`ls-files` lists gitlinks too, so an uninitialised submodule folder is left alone). Otherwise
/// `None`, nothing touched.
pub(crate) fn adopt_untracked(dir: &Path) -> Option<PathBuf> {
    if dir.join(".git").exists() {
        return None;
    }
    // A folder holding repos (8sync-startup/game holds 3d-game) groups projects; it is none itself.
    if std::fs::read_dir(dir).ok()?.flatten().any(|e| e.path().join(".git").exists()) {
        return None;
    }
    let parts: Vec<_> = dir.components().collect();
    if parts.windows(2).any(|w| w[0].as_os_str() == ".claude" && w[1].as_os_str() == "worktrees") {
        return None;
    }
    let parent = repo_of(dir)?;
    let rel = dir.strip_prefix(&parent).ok()?.to_string_lossy().replace('\\', "/");
    let tracked = Command::new("git").arg("-C").arg(&parent).args(["ls-files", "-z", "--"]).arg(&rel).stderr(Stdio::null()).output().ok()?;
    if !tracked.status.success() || !tracked.stdout.is_empty() {
        return None;
    }
    let quiet = |c: &mut Command| c.stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success());
    if !quiet(Command::new("git").args(["init", "-q", "-b", "main"]).arg(dir)) {
        return None;
    }
    let name = dir.file_name().map_or_else(|| rel.clone(), |n| n.to_string_lossy().into_owned());
    // No user.email on this machine → no commit; the repo still stands on its own.
    let _ = quiet(Command::new("git").arg("-C").arg(dir).args(["commit", "-q", "--allow-empty", "-m"]).arg(format!("chore: init {name}")));
    Some(dir.to_path_buf())
}

pub(crate) fn detect_stack(root: &Path) -> Vec<String> {
    let mut s = Vec::new();
    if root.join("Cargo.toml").exists() { s.push("rust".into()); }
    if root.join("package.json").exists() { s.push("node".into()); }
    if root.join("next.config.js").exists()
        || root.join("next.config.ts").exists()
        || root.join("next.config.mjs").exists()
    {
        s.push("nextjs".into());
    }
    if root.join("pyproject.toml").exists() { s.push("python".into()); }
    if root.join("src-tauri").exists() || root.join("tauri.conf.json").exists() {
        s.push("tauri".into());
    }
    if root.join("app.json").exists() && root.join("metro.config.js").exists() {
        s.push("react-native".into());
    }
    if root.join("go.mod").exists() { s.push("go".into()); }
    s
}

pub(crate) fn seed_project_context(env: &env_detect::Env, root: &Path, stack: &[String]) -> Result<()> {
    let _ = crate::verbs::harness::memory::migrate_legacy_layout(root);
    let agents = root.join("AGENTS.md");
    if !agents.exists() {
        let name = root.file_name().and_then(|s| s.to_str()).unwrap_or("project");
        let stack_lines = if stack.is_empty() {
            "- (auto-detect failed, please fill in)".to_string()
        } else {
            stack.iter().map(|s| format!("- {}", s)).collect::<Vec<_>>().join("\n")
        };
        let content = format!(
            r#"# AGENTS.md — guidance for AI working in `{name}`

> Managed by **8sync**. AI tooling (omp, claude-code, cursor, opencode) MUST
> read this file at the start of every session.

<!-- 8sync:skills:begin -->
<!-- 8sync:skills:end -->

## Stack (auto-detected)
{stack_lines}

## Project memory (đọc TRƯỚC khi bắt đầu bất kỳ task)

| File | Mục đích |
|---|---|
| `su-code/PROJECT.md`     | facts cố định (stack, entrypoint, conventions) |
| `su-code/KNOWLEDGE.md`   | append-only: AI học được gì về codebase |
| `su-code/DECISIONS.md`   | append-only: quyết định kiến trúc |
| `su-code/PREFERENCES.md` | append-only: user style preferences |
| `su-code/STATE.md`       | việc đang dở, next-step concrete |
| `su-code/NOTES.md`       | quick notes appended via `8sync note` |

Session memory được omp tự quản (retain/recall/auto-compact). Không cần capture tay.

## Conventions

- Cite code dạng `path/to/file.rs:23-58` hoặc `file.rs:23`.
- Commit + push + PR qua `8sync ship "msg"` (không git push thô).
- Screenshot UI / PDF / diff: ưu tiên `8sync shot|pdf-img|diff-img` thay vì
  dump text (tiết kiệm token 3-10×).
- Tìm symbol/file: `8sync find <kw>` (không gọi `rg`/`fd` thô).
- Ghi nhớ ý tưởng nhanh: `8sync note "..."` (append vào `su-code/NOTES.md`).
"#
        );
        std::fs::write(&agents, crate::brand::render(&content).as_ref())?;
        ui::ok(&format!("seeded {}", agents.display()));
    }

    let agents_dir = root.join("su-code");
    std::fs::create_dir_all(&agents_dir)?;
    let project_md = agents_dir.join("PROJECT.md");
    if !project_md.exists() {
        std::fs::write(
            &project_md,
            format!(
                "# Project facts\n\n- name: {}\n- stack: {}\n- created_by: 8sync .\n",
                root.file_name().and_then(|s| s.to_str()).unwrap_or("project"),
                stack.join(", ")
            ),
        )?;
        ui::ok(&format!("seeded {}", project_md.display()));
    }
    for f in ["KNOWLEDGE.md", "DECISIONS.md", "PREFERENCES.md", "STATE.md", "NOTES.md"] {
        let p = agents_dir.join(f);
        if !p.exists() {
            std::fs::write(
                &p,
                format!("# {} (8sync managed — append-only)\n\n_empty_\n", f.trim_end_matches(".md")),
            )?;
        }
    }

    // Re-inject the dynamic skills block (root) + a compact index into every
    // significant sub-folder, so an agent opening any sub-tree still sees the
    // skill rules (progressive disclosure: nearest AGENTS.md wins).
    if let Err(e) = skill::inject_agents_md(&env.home, root) {
        ui::warn(&format!("could not inject AGENTS.md skills block: {}", e));
    }
    if let Err(e) = skill::inject_subfolder_indexes(root) {
        ui::warn(&format!("could not inject sub-folder skill indexes: {}", e));
    }
    Ok(())
}

#[cfg(test)]
mod tests {

    #[test]
    fn dot_ls_takes_sort_and_reverse() {
        use clap::Parser;
        #[derive(Parser)]
        struct Cli {
            #[command(flatten)]
            a: Args,
        }
        let p = |v: &[&str]| Cli::try_parse_from(std::iter::once(".").chain(v.iter().copied())).map(|c| c.a);
        let a = p(&["ls", "--sort", "name", "-r"]).unwrap();
        assert_eq!((a.rest.as_slice(), a.sort, a.reverse), (["ls".to_string()].as_slice(), Some(crate::verbs::session_view::SortKey::Name), true));
        let a = p(&["ls"]).unwrap();
        assert_eq!((a.sort, a.reverse), (None, false));
        assert!(p(&["ls", "--sort", "nope"]).is_err());
    }
    use super::*;

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git").arg("-C").arg(dir).args(["-c", "user.email=t@t", "-c", "user.name=t", "-c", "core.hooksPath="]).args(args).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
    }

    #[test]
    fn only_an_untracked_folder_under_a_repo_gets_its_own() {
        // Live 2026-10-20: an empty `game/3d-game` in 8sync-startup filed its sessions under the parent.
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let h = std::env::temp_dir().join(format!("8sync-adopt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let root = h.join("parent");
        std::fs::create_dir_all(root.join("apps/x")).unwrap();
        std::fs::write(root.join("apps/x/a.txt"), "a").unwrap();
        // 8sync-startup ignores its project folders (`/game/*`): an ignored folder is still adopted.
        std::fs::write(root.join(".gitignore"), "/game/*\n").unwrap();
        assert!(git(&root, &["init", "-q", "-b", "main"]) && git(&root, &["add", "-A"]) && git(&root, &["commit", "-q", "-m", "init"]));

        let new = root.join("game/new");
        std::fs::create_dir_all(&new).unwrap();
        assert_eq!(adopt_untracked(&new), Some(new.clone()), "an untracked folder is adopted");
        assert!(new.join(".git").exists());
        assert_eq!(repo_of(&new), Some(new.clone()), "and is now its own repo");
        assert_eq!(adopt_untracked(&new), None, "once");

        let tracked = root.join("apps/x");
        assert_eq!(adopt_untracked(&tracked), None, "the parent tracks files under it");
        assert!(!tracked.join(".git").exists());

        let nested = root.join("game/own");
        std::fs::create_dir_all(nested.join(".git")).unwrap();
        assert_eq!(adopt_untracked(&nested), None, "a nested repo stays as it is");
        let group = root.join("game");
        assert_eq!(adopt_untracked(&group), None, "a folder holding repos (game/new, game/own) is never made a repo");
        assert!(!group.join(".git").exists());

        let wt = root.join(".claude/worktrees/w");
        std::fs::create_dir_all(&wt).unwrap();
        assert_eq!(adopt_untracked(&wt), None, "a Claude Code worktree belongs to its repo");
        assert!(!wt.join(".git").exists());

        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(git(&root, &["update-index", "--add", "--cacheinfo", "160000,1111111111111111111111111111111111111111,sub"]));
        assert_eq!(adopt_untracked(&sub), None, "an uninitialised submodule is the parent's");
        assert!(!sub.join(".git").exists());

        let lone = h.join("lone");
        std::fs::create_dir_all(&lone).unwrap();
        if repo_of(&lone).is_none() {
            assert_eq!(adopt_untracked(&lone), None, "no repo above → nothing to split from");
            assert!(!lone.join(".git").exists());
        }
        let _ = std::fs::remove_dir_all(&h);
    }
}
