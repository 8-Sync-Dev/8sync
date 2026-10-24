//! `8sync harness init` — one command to stand up a maximal agent harness:
//! deploy every bundled skill (+ trail binary + external skill packs),
//! pull registered skills (su-code/skills.toml), mirror them into the project,
//! wire trail, seed agent memory + CHANGELOG,
//! and inject force-load rules into the root AGENTS.md/CLAUDE.md plus a compact
//! index into every significant sub-folder. Progress is tracked step by step.
use std::time::Instant;

use anyhow::Result;

use super::external::install_external_skill_packs;
use super::memory::{seed_gitleaks_hook, seed_harness_memory};
use crate::verbs::skill::{deploy, discover, inject_agents_md, inject_subfolder_indexes, update};
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

pub(crate) fn harness_init(env: &env_detect::Env, force: bool) -> Result<()> {
    ui::header("8sync harness init");
    deploy::migrate_namespace(&env.home);
    let in_project = discover::detect_current_project_root().is_some();
    let total = if in_project { 10 } else { 4 };
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
        // Pull every skill registered in su-code/skills.toml from its source
        // (git collections like feynman, builtin:, path:) — mirrors bare
        // `8sync harness` so init is a true superset, not a smaller bootstrap.
        p.step("pull registered skills (su-code/skills.toml: feynman, …)");
        let _ = update::update_skills(env, &env.xdg_config.join("8sync/skills.toml"), None);
        p.step("mirror skills → su-code/skills/");
        let count = deploy::mirror_global_to_local(&env.home, &root, force)?;
        if count > 0 {
            ui::ok(&format!("mirrored {} skill(s) into {}", count, root.join("su-code/skills").display()));
        }
        let local_dir = root.join("su-code/skills");
        for d in discover::list_installed_skill_dirs(&local_dir).unwrap_or_default() {
            deploy::ensure_skill_layout(&d);
        }

        p.step("trail init + seed memory/CHANGELOG");
        super::trail::ensure_for_harness(env, &root);
        seed_harness_memory(&root)?;
        seed_gitleaks_hook(&root);

        p.step("inject force-load → AGENTS.md / CLAUDE.md");
        inject_agents_md(&env.home, &root)?;

        p.step("inject sub-folder skill indexes");
        let n = inject_subfolder_indexes(&root)?;
        if n > 0 {
            ui::ok(&format!("dropped skill-index AGENTS.md into {} sub-folder(s)", n));
        }
        p.step("host adapters → .cursor/ + .zcode/ (Cursor + Z.ai Code)");
        let _ = deploy::ensure_host_adapters(&env.home, &root, force);
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

/// `8sync harness create` — full multi-host bootstrap: omp + su-code/skills +
/// `.cursor/` (Cursor Agent Skills + alwaysApply rule) + `.zcode/skills`.
/// Current project always; `--sweep [DIR]` also stamps every omp project
/// (has `su-code/` or AGENTS.md) under DIR (default ~/Projects).
pub(crate) fn harness_create(
    env: &env_detect::Env,
    force: bool,
    sweep: Option<&str>,
) -> Result<()> {
    ui::header("8sync harness create");
    ui::info("full host bootstrap: omp · su-code/skills · .cursor · .zcode");
    harness_init(env, force)?;
    if let Some(dir) = sweep {
        super::global::harness_global(env, Some(dir), false, force)?;
    }
    Ok(())
}

