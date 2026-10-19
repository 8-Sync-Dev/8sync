use anyhow::{Context, Result};
use clap::Args as ClapArgs;
use std::path::{Path, PathBuf};
#[cfg(feature = "web")]
use std::process::Command;

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
    if a.list && verb.is_empty() {
        return session::cmd_ls(&env, &root, a.json);
    }
    match verb {
        "ls" | "list" => return session::cmd_ls(&env, &root, a.json),
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

/// The git repo a path belongs to, for `ccc auto` teams: a Claude Code worktree
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
