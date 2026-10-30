//! `8sync harness init` — one command to stand up a maximal agent harness:
//! deploy every bundled skill under ~/.omp (+ trail binary + external skill
//! packs), pull registered skills, wire trail, seed agent memory + CHANGELOG,
//! write the 8sync block into the root AGENTS.md/CLAUDE.md plus a pointer into
//! every significant sub-folder, and seed the ECC rule packs for the repo's
//! stacks. Nothing is vendored into the repo. Progress is tracked step by step.
use std::time::Instant;

use anyhow::Result;

use super::external::install_external_skill_packs;
use super::memory::{seed_gitleaks_hook, seed_harness_memory};
use crate::verbs::skill::{deploy, discover, inject, inject_agents_md, inject_subfolder_indexes, update};
use crate::{assets, env_detect, ui};

/// Lightweight stepped progress indicator (no TUI dep): `▸ [i/N] label`.
struct Progress {
    total: usize,
    cur: usize,
    start: Instant,
}

impl Progress {
    fn new(total: usize) -> Self {
        Progress { total, cur: 0, start: Instant::now() }
    }
    fn step(&mut self, label: &str) {
        self.cur += 1;
        ui::step(&format!("[{}/{}] {}", self.cur, self.total, label));
    }
    fn done(&self) {
        ui::ok(&format!(
            "harness ready in {:.1}s ({} steps)",
            self.start.elapsed().as_secs_f32(),
            self.total
        ));
    }
}

pub(crate) fn harness_init(env: &env_detect::Env) -> Result<()> {
    ui::header("8sync harness init");
    deploy::migrate_namespace(&env.home);
    let in_project = discover::detect_current_project_root().is_some();
    let total = if in_project { 9 } else { 4 };
    let mut p = Progress::new(total);

    // 1. Master force-load file (omp reads this first every session).
    p.step("master skill list → ~/.omp/skills/00-force-load.md");
    let target = env.home.join(".omp/skills/00-force-load.md");
    std::fs::create_dir_all(target.parent().unwrap())?;
    let content = assets::read("skills/00-force-load.md")
        .map(|c| crate::brand::render(&c).into_owned())
        .unwrap_or_default();
    std::fs::write(&target, content)?;

    // 2. Deploy bundled skills (embedded assets → ~/.omp/skills).
    p.step("deploy bundled skills (trail · karpathy · ponytail · assp · impeccable · taste · …)");
    deploy::install_bundled_global(env)?;

    // 3. trail binary (npm install -g --ignore-scripts if missing) + telemetry off.
    p.step("ensure trail binary");
    match super::trail::ensure_installed() {
        Ok(bin) => super::trail::ensure_telemetry_off(&env.home, &bin),
        Err(e) => ui::warn(&format!("trail not available: {e:#} — STEP 0 falls back to grep/read")),
    }
    deploy::ensure_headroom_mcp(env)?;
    let _ = deploy::ensure_omp_memory_config(&env.home);
    let _ = deploy::ensure_bash_interceptor(&env.home);
    let _ = deploy::ensure_rules(&env.home, None);
    let _ = deploy::ensure_recall_hook(&env.home);
    let _ = deploy::ensure_append_system(&env.home);
    let _ = deploy::ensure_mcp_spec(&env.home);
    let _ = deploy::ensure_zai_vision_mcp(env);
    let _ = deploy::ensure_omp_capabilities_snapshot(&env.home);
    deploy::ensure_feynman_cli();
    let _ = deploy::ensure_engine(&env.home, None);
    let _ = deploy::cleanup_legacy_gs(&env.home, None);

    // 4. External skill packs (ponytail full + addyosmani) — best-effort/network.
    p.step("download external skill packs (ponytail · addyosmani)");
    let _ = install_external_skill_packs(env);

    // Normalise every global skill dir to the 3-folder layout.
    let global_dir = env.home.join(".omp/skills");
    for d in discover::list_installed_skill_dirs(&global_dir).unwrap_or_default() {
        deploy::ensure_skill_layout(&d);
    }

    // 5-9. Project-scoped scaffolding.
    if let Some(root) = discover::detect_current_project_root() {
        // Pull every registered skill (skills.toml: feynman, builtin:, path:) into
        // the global library — mirrors bare `8sync harness`.
        p.step("pull registered skills (skills.toml: feynman, …)");
        let _ = update::update_skills(env, &env.xdg_config.join("8sync/skills.toml"), None);

        p.step("trail init + seed memory/CHANGELOG");
        super::trail::ensure_for_harness(env, &root);
        seed_harness_memory(&root)?;
        seed_gitleaks_hook(&root);

        p.step("8sync block → AGENTS.md / CLAUDE.md");
        inject_agents_md(&env.home, &root)?;

        p.step("sub-folder pointers");
        let n = inject_subfolder_indexes(&root)?;
        if n > 0 {
            ui::ok(&format!("dropped sub-folder AGENTS.md pointer into {} sub-folder(s)", n));
        }
        p.step("ECC rules → .claude/rules/ecc/ + Cursor rule");
        let _ = inject::inject_cursor_rule(&root);
        super::ecc::project_layer(&env.home, &root, true);
        let _ = deploy::ensure_engine(&env.home, Some(&root));
        let _ = deploy::cleanup_legacy_gs(&env.home, Some(&root));
        p.done();
        ui::info("start a session: `8sync .` or `omp --continue`");
        ui::info("refresh later: `8sync harness up`  (auto: `8sync harness up --timer 30m`)");
        ui::info("opt-in skill: `8sync skill add builtin:social-growth` (social/branding/leads — không auto-bật)");
    } else {
        p.done();
        ui::warn("not inside a project (no AGENTS.md/.git/Cargo.toml/package.json/... in cwd or ancestors)");
        ui::info("  → `cd` into a project root, then re-run `8sync harness init`");
        let _ = deploy::ensure_engine(&env.home, None);
    }
    Ok(())
}

/// `8sync harness create` — `init` for the current project; `--sweep [DIR]`
/// also stamps every omp project (has `su-code/` or AGENTS.md) under DIR
/// (default ~/Projects).
pub(crate) fn harness_create(env: &env_detect::Env, sweep: Option<&str>) -> Result<()> {
    ui::header("8sync harness create");
    harness_init(env)?;
    if let Some(dir) = sweep {
        super::global::harness_global(env, Some(dir), false)?;
    }
    Ok(())
}

