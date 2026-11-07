// `8sync up` — update the 8sync binary from a GitHub Release.
//
// Default: pull the latest tag. With `--to <tag>` pin a specific release
// for reproducibility / downgrade (e.g. `8sync up --to v0.6.10` to roll
// every machine to the known-stable HyDE-only baseline).
//
// Decoupled from omp on purpose: omp self-updates via `omp update`. System
// pkgs (pacman/AUR) untouched — user runs `paru -Syu` on their own schedule.

use anyhow::Result;
use clap::Args as ClapArgs;

use crate::{ui, verbs::{selfup, skill::deploy}};

#[derive(ClapArgs, Debug)]
#[command(
    after_help = indoc::indoc! {"
        EXAMPLES
          8sync up                       update to the latest GitHub Release
          8sync up --to v0.6.10          pin/downgrade to a specific tag
    "}
)]
pub struct Args {
    /// Pin to a specific release tag (e.g. `v0.6.10`). Default: latest.
    #[arg(long, value_name = "TAG")]
    pub to: Option<String>,
    /// Re-download and reinstall even when already on the latest release.
    #[arg(long)]
    pub force: bool,
    /// Internal (run by `up` on the binary it just installed): refresh the bundled skills.
    #[arg(long, hide = true)]
    pub refresh_skills: bool,
}

pub fn run(a: Args) -> Result<()> {
    if a.refresh_skills {
        return refresh_skills_here();
    }
    ui::header("8sync up");
    // Resolve the install path BEFORE the update: once the file is replaced, Linux reports the
    // running exe as "…/8sync (deleted)" and the kit refresh below could not start it.
    let installed = selfup::installed_path().ok();
    let updated = match a.to {
        Some(tag) => selfup::install_tag(&tag)?,
        None      => selfup::run_self_update(a.force)?,
    };
    if updated {
        ui::info("done — re-run any 8sync command to pick up the new binary");
        // Skills before the kit: the kit links the ~/.omp/skills copies, new ones included.
        refresh_skills(installed.clone());
        refresh_kit(installed.clone());
        refresh_hq_ui(installed);
    }
    ui::info("note: `8sync up` only updates 8sync. For omp run `8sync omp update`; for system pkgs run `paru -Syu`.");
    Ok(())
}

/// A command on the binary just installed (no auto-update of its own), run from the home dir so no
/// step resolves the project `up` was typed in.
fn new_binary(installed: Option<std::path::PathBuf>) -> Option<std::process::Command> {
    let exe = installed.or_else(|| selfup::installed_path().ok())?;
    let mut cmd = std::process::Command::new(exe);
    cmd.env("SUSYNC_NO_AUTO_UPDATE", "1").stdin(std::process::Stdio::null());
    if let Ok(env) = crate::env_detect::Env::detect() {
        cmd.current_dir(env.home);
    }
    Some(cmd)
}

/// After an update, the bundled skills in ~/.omp/skills come from the NEW binary (this one embeds
/// the old ones). Its lines (synced / kept your edited …) go straight to the owner.
fn refresh_skills(installed: Option<std::path::PathBuf>) {
    let Some(mut cmd) = new_binary(installed) else { return };
    if !cmd.args(["up", "--refresh-skills"]).status().is_ok_and(|s| s.success()) {
        ui::warn("bundled skills not refreshed — `8sync harness global` refreshes them");
    }
}

/// `up --refresh-skills`: this binary's bundled skills into ~/.omp/skills (a copy the owner edited is
/// kept, see skill::deploy::refresh_bundled), then linked into Claude Code's skills dir when there is
/// one. Machine-wide only, never a project; no network. Nothing to refresh before the first install.
fn refresh_skills_here() -> Result<()> {
    let env = crate::env_detect::Env::detect()?;
    if !env.home.join(".omp/skills").is_dir() {
        return Ok(());
    }
    deploy::install_bundled_global(&env)?;
    let claude = super::ccc::claude_dir(&env).join("skills");
    if claude.is_dir() {
        deploy::link_bundled_skills(&env.home, &claude)?;
    }
    Ok(())
}

/// After an update, pre-install the HQ UI asset that matches the new binary (only when the owner
/// has used `8sync hq ui` before) and say what a running HQ does: from v0.102.0 a local
/// `8sync hq ui` restarts itself on the new binary; older ones (and `--public`) need a Ctrl-C.
fn refresh_hq_ui(installed: Option<std::path::PathBuf>) {
    if !super::hq::hq_ui_installed_any() {
        return;
    }
    let Some(mut cmd) = new_binary(installed) else { return };
    let out = cmd.args(["hq", "ui", "--install", "--no-open"]).output();
    let ok = out.as_ref().is_ok_and(|o| o.status.success());
    ui::info(if ok { "HQ UI for the new binary downloaded (next `8sync hq ui` starts it)" } else { "HQ UI download failed — `8sync hq ui` fetches it on its next start" });
    if super::hq::ui_port_busy(8740) {
        ui::warn(&super::hq::up_restart_hint(8740));
    }
}

/// After an update, bring an installed kit (agents, skills, statusline) up to the new binary by
/// running its `ccc kit`. `EIGHTSYNC_OFFLINE` is inherited, so the kit skips its network steps.
fn refresh_kit(installed: Option<std::path::PathBuf>) {
    if !super::ccc::kit_installed() {
        return;
    }
    let Some(mut cmd) = new_binary(installed) else { return };
    let out = cmd.args(["ccc", "kit"]).output();
    let ok = out.as_ref().is_ok_and(|o| o.status.success());
    ui::info(if ok { "kit refreshed with the new binary (statusline included)" } else { "kit refresh failed — run `8sync ccc kit`" });
    // The kit's output stays quiet except its one line that needs the owner: a rewritten mod
    // reaches an open session only after `/reload-plugins`.
    if let Ok(o) = out {
        for line in String::from_utf8_lossy(&o.stdout).lines().filter(|l| l.contains(super::ccc::RELOAD_HINT)) {
            ui::info(line.trim_start_matches(|c: char| !c.is_alphanumeric()));
        }
    }
}
