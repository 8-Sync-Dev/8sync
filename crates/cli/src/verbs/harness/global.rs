//! `8sync harness global` — ONE key that applies the omp operating rules
//! MACHINE-WIDE, so every project that runs omp gets them (no per-project run
//! needed for the rule layer):
//!   ~/.omp/skills + 00-force-load.md        → skill library, read every session
//!   ~/.omp/agent/APPEND_SYSTEM.md           → appended to EVERY omp system prompt
//!   MCP servers (headroom · zai-vision) + trail binary + recall hook + capabilities
//! plus the Anthropic token-optimizer defaults:
//!   compaction 50% (only if unset) · headroom compress >50-line outputs ·
//!   byte-stable APPEND_SYSTEM writes (identical ⇒ skip) so the system prefix
//!   stays cache-hot for Anthropic prompt caching.
//! CWD-independent — never touches the current project. `--sweep [DIR]` then
//! stamps the per-project layer (8sync block in AGENTS.md/CLAUDE.md + memory
//! seed + gitleaks hook + ECC rule packs + Cursor rule) into every omp project
//! under DIR (default ~/Projects, then `<home-parent>/Projects` on Windows).
use std::path::{Path, PathBuf};

use anyhow::Result;

use super::compaction;
use super::external::install_external_skill_packs;
use super::memory::{migrate_legacy_layout, seed_gitleaks_hook, seed_harness_memory};
use crate::verbs::skill::{deploy, discover, inject, inject_agents_md, update};
use crate::{assets, env_detect, ui};

/// The global (machine-wide) layer, shared by bare `8sync harness` and
/// `8sync harness global`: master force-load + bundled skills + trail binary
/// + MCP servers + omp memory config/recall hook + APPEND_SYSTEM directives +
/// capabilities snapshot + external packs + layout normalization. Idempotent.
pub(crate) fn global_pass(env: &env_detect::Env) -> Result<()> {
    deploy::migrate_namespace(&env.home);
    let force_load = env.home.join(".omp/skills/00-force-load.md");
    if let Some(p) = force_load.parent() {
        std::fs::create_dir_all(p)?;
    }
    if let Some(c) = assets::read("skills/00-force-load.md") {
        std::fs::write(&force_load, crate::brand::render(&c).as_ref())?;
    }
    deploy::install_bundled_global(env)?;
    // One-time cutover from codegraph / codebase-memory-mcp / serena (idempotent, quiet when done).
    super::legacy::retire_mcp(&env.home);
    deploy::cleanup_legacy_gs(&env.home, None);
    super::legacy::refresh_interceptor_messages(&env.home);
    match super::trail::ensure_installed() {
        Ok(bin) => super::trail::ensure_telemetry_off(&env.home, &bin),
        Err(e) => ui::warn(&format!("trail not available: {e:#} — STEP 0 falls back to grep/read")),
    }
    deploy::ensure_headroom_mcp(env)?;
    let _ = deploy::ensure_omp_memory_config(&env.home);
    let _ = deploy::ensure_bash_interceptor(&env.home);
    let _ = deploy::ensure_rules(&env.home, None);
    let _ = deploy::ensure_mcp_tools_visible(&env.home);
    let _ = deploy::ensure_recall_hook(&env.home);
    let _ = deploy::ensure_append_system(&env.home);
    let _ = deploy::ensure_mcp_spec(&env.home);
    let _ = deploy::ensure_zai_vision_mcp(env);
    let _ = deploy::ensure_omp_capabilities_snapshot(&env.home);
    deploy::ensure_feynman_cli();
    let _ = install_external_skill_packs(env); // best-effort; skips packs already present
    let global_dir = env.home.join(".omp/skills");
    for d in discover::list_installed_skill_dirs(&global_dir).unwrap_or_default() {
        deploy::ensure_skill_layout(&d);
    }
    Ok(())
}

pub(crate) fn harness_global(env: &env_detect::Env, sweep: Option<&str>, pull: bool) -> Result<()> {
    ui::header("8sync harness global");

    // 1. Machine-wide rule layer (~/.omp) — applies to EVERY omp session anywhere.
    ui::step("global rules → ~/.omp (skills · APPEND_SYSTEM · MCP · hooks)");
    global_pass(env)?;
    let _ = deploy::ensure_engine(&env.home, None);
    let _ = deploy::cleanup_legacy_gs(&env.home, None);

    // 2. Anthropic token-optimizer defaults (never override a user setting).
    ui::step("token-optimizer defaults (Anthropic)");
    let _ = compaction::ensure_threshold_default(&env.home, 50);

    // 3. Auto-stamp current project root if inside an omp project (su-code/ or AGENTS.md).
    if let Some(cwd_root) = discover::detect_current_project_root() {
        if is_omp_project(&cwd_root) {
            ui::step(&format!("auto-stamp active project: {}", cwd_root.display()));
            match stamp_project(env, &cwd_root) {
                Ok(()) => ui::ok("active project harness updated"),
                Err(e) => ui::warn(&format!("active project update warning: {}", e)),
            }
        }
    }

    // 4. Optional: re-pull registered skills from their sources (network).
    if pull {
        ui::step("re-pull registered skills (network)");
        let _ = update::update_skills(env, &env.xdg_config.join("8sync/skills.toml"), None);
    }

    // 5. Optional: stamp the per-project layer into every git repo under DIR.
    if let Some(dir) = sweep {
        let root = sweep_root(env, dir);
        ui::step(&format!("sweep projects under {}", root.display()));
        let all = find_git_repos(&root, 4);
        for r in &all {
            let _ = migrate_legacy_layout(r); // legacy agents/ → su-code/ before detection
        }
        let (repos, skipped): (Vec<_>, Vec<_>) =
            all.into_iter().partition(|r| is_omp_project(r));
        if repos.is_empty() {
            ui::warn(&format!("no omp projects (su-code/ or AGENTS.md/CLAUDE.md) found under {}", root.display()));
        }
        let (mut ok, mut failed) = (0usize, 0usize);
        for repo in &repos {
            match stamp_project(env, repo) {
                Ok(()) => {
                    ok += 1;
                    let name = repo.strip_prefix(&root).unwrap_or(repo);
                    ui::ok(&name.display().to_string());
                }
                Err(e) => {
                    failed += 1;
                    ui::warn(&format!("{}: {}", repo.display(), e));
                }
            }
        }
        if !skipped.is_empty() {
            ui::skip(
                &format!("{} repo(s) not using omp", skipped.len()),
                "no su-code/ or AGENTS.md/CLAUDE.md — onboard one with `cd <repo> && 8sync harness`",
            );
        }
        ui::info(&format!(
            "sweep: {} omp project(s) stamped{} — full pass per project: `cd <repo> && 8sync harness` · trail map for all repos: `8sync trail --all <ROOT>`",
            ok,
            if failed > 0 { format!(", {failed} failed") } else { String::new() }
        ));
    }

    // 5. Summary — what now applies to every omp session on this machine.
    ui::ok("omp rules are now GLOBAL — every omp session in every project gets:");
    ui::info("  • ~/.omp/agent/APPEND_SYSTEM.md appended to EVERY system prompt (trail-first, never compacted)");
    ui::info("  • ~/.omp/agent/rules/*.md TTSR rules — omp aborts a grep/glob on code STRUCTURE mid-stream and re-routes it to trail (zero prompt cost, never compacted; auto-withheld when trail is not installed)");
    ui::info("  • skills @ ~/.omp/skills + 00-force-load.md · MCP: headroom · zai-vision");
    ui::info("  • STEP-0 MCP tools always in the tool set (omp ≥17: xd:// devices via tools.xdev) — headroom/zai callable");
    ui::info("  • token optimizer: headroom compress >50-line outputs · compaction 50% · stable prefix → Anthropic prompt-cache hits");
    if sweep.is_none() {
        ui::info("stamp the per-project layer everywhere: `8sync harness global --sweep` (default ~/Projects)");
    }
    Ok(())
}

/// An omp project = a repo already carrying the agent-memory layer: an `su-code/`
/// dir holding real memory, or an `AGENTS.md`/`CLAUDE.md` at the root. The sweep
/// only stamps these — it never injects into repos that don't use omp (onboard
/// those by running `8sync harness` inside them once). Shares the memory-tree
/// test with `discover`, so a directory that merely *shares the name* `su-code`
/// can never make its parent look like a project.
use discover::is_omp_project;

/// Resolve the sweep root: explicit DIR > `~/Projects` (if present) >
/// `<home-parent>/Projects` (Windows layout: C:\Users\Admin + C:\Users\Projects) > cwd.
fn sweep_root(env: &env_detect::Env, dir: &str) -> PathBuf {
    if !dir.is_empty() {
        return PathBuf::from(dir);
    }
    let projects = env.home.join("Projects");
    if projects.is_dir() {
        return projects;
    }
    if let Some(sibling) = env.home.parent().map(|p| p.join("Projects")) {
        if sibling.is_dir() {
            return sibling;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| env.home.clone())
}

/// Iterative scan for git repos (dirs containing `.git`) up to `max_depth`.
/// A found repo is not descended into; hidden and build/dependency dirs are skipped.
fn find_git_repos(root: &Path, max_depth: usize) -> Vec<PathBuf> {
    const SKIP: &[&str] = &[
        "node_modules", "target", "dist", "build", "vendor", "venv", ".venv", "__pycache__",
        "AppData",
    ];
    let mut repos = Vec::new();
    let mut frontier = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = frontier.pop() {
        if dir.join(".git").exists() {
            repos.push(dir);
            continue;
        }
        if depth >= max_depth {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || SKIP.contains(&name.as_ref()) {
                continue;
            }
            frontier.push((p, depth + 1));
        }
    }
    repos.sort();
    repos
}

/// Per-project layer for one repo (the light, additive subset of bare
/// `8sync harness`): the 8sync block in AGENTS.md/CLAUDE.md, su-code/ memory,
/// the gitleaks hook, the /auto engine, the ECC rule packs (retiring the old
/// vendored skill layout) and the Cursor rule.
fn stamp_project(env: &env_detect::Env, root: &Path) -> Result<()> {
    inject_agents_md(&env.home, root)?;
    seed_harness_memory(root)?;
    seed_gitleaks_hook(root);
    // Redeploy the /auto command + engine to the project so a swept repo's
    // `.omp/commands/auto.md` (precedence over global) points at su-code/, not
    // a stale agents/ copy from an older binary.
    deploy::ensure_engine(&env.home, Some(root))?;
    deploy::ensure_rules(&env.home, Some(root))?;
    super::ecc::project_layer(&env.home, root, true);
    inject::inject_cursor_rule(root)
}
