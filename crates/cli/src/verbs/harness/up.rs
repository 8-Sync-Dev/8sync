//! `8sync harness up` — refresh the harness to the project's CURRENT state:
//! re-inject the AGENTS.md block + sub-folder pointers, refresh the KNOWLEDGE
//! breadcrumb and the ECC rule packs, and rebuild the trail map so the agent
//! keeps learning as the project grows.
//! `--loop <dur>` runs it in the foreground; `--timer <dur|off>` installs a
//! systemd user timer (the recommended background option — memory-bounded to its
//! own cgroup so a heavy refresh can't OOM the machine). Per tick the harness
//! refreshes context (re-inject + trail build + consolidate); the agent then drives
//! the L1→L3 loop off STATE.md (read STATE → Next → verify-gate → update spine →
//! `--commit`), per the loop-engineering rules in 00-force-load.md.
use std::process::Command;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};

use super::memory::{consolidate_learnings, seed_gitleaks_hook, seed_harness_memory};
use crate::verbs::skill::{discover, inject_agents_md, inject_subfolder_indexes};
use crate::{env_detect, platform, ui};

pub(crate) fn harness_up(
    env: &env_detect::Env,
    loop_every: Option<&str>,
    timer: Option<&str>,
    pull: bool,
    commit: bool,
) -> Result<()> {
    if let Some(spec) = timer {
        return manage_timer(spec);
    }
    if let Some(dur) = loop_every {
        let secs = platform::parse_dur_secs(dur).max(60);
        ui::header(&format!("8sync harness up --loop ({}s interval)", secs));
        ui::info("Ctrl-C to stop. Each pass re-injects rules + refreshes memory + rebuilds the trail map.");
        loop {
            let _ = refresh_once(env, pull, commit);
            ui::step(&format!("sleeping {}s …", secs));
            std::thread::sleep(Duration::from_secs(secs));
        }
    }
    ui::header("8sync harness up");
    refresh_once(env, pull, commit)
}

fn refresh_once(env: &env_detect::Env, pull: bool, commit: bool) -> Result<()> {
    let Some(root) = discover::detect_current_project_root() else {
        ui::warn("not inside a project — nothing to refresh");
        return Ok(());
    };
    if pull {
        ui::step("re-pull registered skills (--pull)");
        let registry = env.xdg_config.join("8sync/skills.toml");
        let _ = crate::verbs::skill::update::update_skills(env, &registry, None);
    }
    inject_agents_md(&env.home, &root)?;
    inject_subfolder_indexes(&root)?;
    let _ = crate::verbs::skill::deploy::ensure_append_system(&env.home);
    let _ = crate::verbs::skill::deploy::ensure_mcp_spec(&env.home);
    let _ = crate::verbs::skill::deploy::ensure_recall_hook(&env.home);
    let _ = crate::verbs::skill::deploy::ensure_engine(&env.home, Some(&root));
    let _ = crate::verbs::skill::deploy::ensure_rules(&env.home, Some(&root));
    let _ = crate::verbs::skill::deploy::cleanup_legacy_gs(&env.home, Some(&root));
    super::ecc::project_layer(&env.home, &root, true);
    seed_harness_memory(&root)?;
    let _ = consolidate_learnings(&root);
    seed_gitleaks_hook(&root);
    super::trail::refresh(&root);
    if commit {
        commit_memory(&root);
    }
    ui::ok(&format!("harness up to date → {}", root.display()));
    Ok(())
}

/// `up --commit`: stage ONLY 8sync-managed memory artifacts (never the user's
/// code) and commit them, so learnings persist to git in the same pass. No-op
/// when nothing changed; best-effort — warns, never bails.
fn commit_memory(root: &Path) {
    let candidates = ["su-code", "agents", "AGENTS.md", "CLAUDE.md", "CHANGELOG.md", ".gitignore"];
    let present: Vec<&str> = candidates
        .into_iter()
        .filter(|p| root.join(p).exists())
        .collect();
    if present.is_empty() {
        return;
    }
    let added = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["add", "--"])
        .args(&present)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if !added {
        ui::warn("git add failed — skipping memory commit (not a git repo?)");
        return;
    }
    // Commit only when memory is actually staged (avoids empty-commit spam on timers).
    let nothing_staged = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["diff", "--cached", "--quiet", "--"])
        .args(&present)
        .status()
        .map(|s| s.success())
        .unwrap_or(true);
    if nothing_staged {
        ui::skip("git commit", "no agent-memory changes");
        return;
    }
    // Secret scan before committing (GitGuardian 2026: AI-assisted commits leak
    // ~2× baseline). Abort only on a positive detection; tolerate tool/version
    // errors so a quirky gitleaks build can't wedge every commit.
    if which::which("gitleaks").is_ok() {
        let code = Command::new("gitleaks")
            .args(["protect", "--staged", "--no-banner"])
            .current_dir(root)
            .status()
            .ok()
            .and_then(|s| s.code());
        match code {
            Some(0) => {}
            Some(1) => {
                ui::err("gitleaks detected a secret in staged memory — commit ABORTED. Remove it, then retry.");
                return;
            }
            other => ui::warn(&format!(
                "gitleaks scan inconclusive (exit {:?}) — committing without scan; verify manually",
                other
            )),
        }
    } else {
        ui::warn("gitleaks not installed — committing memory WITHOUT secret scan (install gitleaks to harden)");
    }
    let committed = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["commit", "-m", "chore(8sync): refresh agent memory + harness"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if committed {
        ui::ok("committed agent memory (portable)");
    } else {
        ui::warn("git commit failed — memory left staged");
    }
}

/// Install/remove the periodic `8sync harness up` background job (systemd user
/// timer on Linux, launchd LaunchAgent on macOS, Scheduled Task on Windows).
/// Bounded to its own cgroup on Linux so a heavy `trail build` tick can't
/// OOM the machine.
fn manage_timer(spec: &str) -> Result<()> {
    if spec.eq_ignore_ascii_case("off") {
        ui::header("8sync harness up --timer off");
        return platform::remove_timer("harness-up");
    }
    ui::header(&format!("8sync harness up --timer {}", spec));
    let root = discover::detect_current_project_root()
        .context("`harness up --timer` must run inside a project (it sets WorkingDirectory)")?;
    let proj = root.file_name().and_then(|s| s.to_str()).unwrap_or("project").to_string();
    let desc = format!("8sync harness up ({proj})");
    platform::install_timer(&platform::TimerSpec {
        name: "harness-up",
        description: &desc,
        exec_args: &["harness", "up"],
        workdir: Some(&root),
        every: spec,
        memory_bounded: true,
        timeout_secs: 900,
    })
}
