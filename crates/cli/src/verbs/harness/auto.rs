//! `8sync harness` (bare, no subcommand) — the ONE command that makes a project
//! fully agent-ready and current, in a single idempotent pass:
//!   global layer (bundled skills under ~/.omp, trail, MCPs) → update registered
//!   skills → trail + memory + gitleaks hook → the 8sync block in AGENTS.md/CLAUDE.md
//!   → ECC rule packs (`.claude/rules/ecc/`) → consolidate learnings.
//! Nothing is vendored into the repo: skills/agents/commands come from the global
//! ECC plugin `ecc@ecc`. Re-run anytime; safe + cheap. `harness init` = explicit
//! full bootstrap with progress UI; `harness up` = light refresh.
use anyhow::Result;

use super::memory::{consolidate_learnings, seed_gitleaks_hook, seed_harness_memory};
use crate::verbs::skill::{deploy, discover, inject, inject_agents_md, inject_subfolder_indexes, update};
use crate::{env_detect, ui};

pub(crate) fn harness_auto(env: &env_detect::Env) -> Result<()> {
    ui::header("8sync harness");

    // 1. Global skill library + rule layer — idempotent, shared with
    //    `8sync harness global` (re-deploys bundled skills new in this binary
    //    after `8sync up`, the master force-load file, APPEND_SYSTEM, MCPs).
    super::global::global_pass(env)?;

    let Some(root) = discover::detect_current_project_root() else {
        ui::ok("global skills ready — `cd` into a project and re-run `8sync harness`");
        let _ = deploy::ensure_engine(&env.home, None);
        let _ = deploy::cleanup_legacy_gs(&env.home, None);
        return Ok(());
    };

    // 2. Update registered skills from their sources (global library only).
    let _ = update::update_skills(env, &env.xdg_config.join("8sync/skills.toml"), None);

    // 3. The self-learning loop, one pass: trail + memory + safety + inject + ECC rules.
    super::trail::ensure_for_harness(env, &root);
    seed_harness_memory(&root)?;
    seed_gitleaks_hook(&root);
    inject_agents_md(&env.home, &root)?;
    inject_subfolder_indexes(&root)?;
    let _ = inject::inject_cursor_rule(&root);
    super::ecc::project_layer(&env.home, &root, true);
    let _ = deploy::ensure_engine(&env.home, Some(&root));
    let _ = deploy::ensure_rules(&env.home, Some(&root));
    let _ = deploy::cleanup_legacy_gs(&env.home, Some(&root));
    let _ = consolidate_learnings(&root);

    ui::ok(&format!("harness ready → {}", root.display()));
    ui::info("background loop: `8sync harness up --timer 30m` · full rebuild: `8sync harness init`");
    Ok(())
}
