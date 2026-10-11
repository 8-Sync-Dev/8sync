use anyhow::{bail, Context, Result};
use clap::Args as ClapArgs;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

use crate::{assets, env_detect, pkg, platform, ui, verbs::profile};

/// The one core package Stage A installs from the native package manager.
/// The id differs per manager: `github-cli` on pacman, `gh` everywhere else.
const GH: platform::CorePkg = platform::CorePkg {
    arch: "github-cli",
    fedora: "gh",
    brew: "gh",
    winget: "GitHub.cli",
};

/// gh on Linux distros without a native gh route (Debian, Ubuntu, …): the
/// official release tarball into `~/.local/bin`, so no sudo and no apt repo.
/// Verified against the release's own checksums file before it is installed.
fn install_gh_release() -> Result<()> {
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        a => bail!("no gh release for linux/{a} — install gh manually"),
    };
    let tag = crate::verbs::selfup::latest_release_tag("cli/cli").context("could not resolve the latest gh release")?;
    let ver = tag.trim_start_matches('v');
    let tarball = format!("gh_{ver}_linux_{arch}.tar.gz");
    let base = format!("https://github.com/cli/cli/releases/download/{tag}");
    let work = std::env::temp_dir().join(format!("8sync-gh.{}", std::process::id()));
    let installed = (|| {
        let tgz = work.join(&tarball);
        let sums = work.join("checksums.txt");
        ui::step(&format!("Installing gh {tag} ({tarball})"));
        crate::verbs::forge::download(&format!("{base}/{tarball}"), &tgz)?;
        crate::verbs::forge::download(&format!("{base}/gh_{ver}_checksums.txt"), &sums)?;
        let want = std::fs::read_to_string(&sums)?
            .lines()
            .find_map(|l| l.strip_suffix(tarball.as_str()).map(|h| h.trim().to_string()))
            .context("gh checksums file has no entry for the tarball")?;
        let got = crate::verbs::selfup::sha256_file(&tgz).context("no working sha256 hasher")?;
        if !got.eq_ignore_ascii_case(&want) {
            bail!("gh checksum mismatch — refusing to install\n  expected {want}\n  actual   {got}");
        }
        let (tgz_s, work_s) = (tgz.to_str().context("non-UTF-8 temp path")?, work.to_str().context("non-UTF-8 temp path")?);
        pkg::run_loud("tar", &["-xzf", tgz_s, "-C", work_s])?;
        let dest = dirs::home_dir().context("no home dir")?.join(".local/bin/gh");
        std::fs::create_dir_all(dest.parent().context("bad gh path")?)?;
        let staged = dest.with_file_name(format!(".gh.new.{}", std::process::id()));
        std::fs::copy(work.join(tarball.trim_end_matches(".tar.gz")).join("bin/gh"), &staged)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
        }
        std::fs::rename(&staged, &dest)?;
        ui::ok(&format!("gh {tag} → {} (sha256 ok)", dest.display()));
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&work);
    installed
}

#[derive(ClapArgs, Debug)]
#[command(
    after_help = indoc::indoc! {"
        EXAMPLES — quick start (community)
          8sync setup                          harness + curated y/N menu (community profiles)
          8sync setup --community              unattended: dev-stack + bluetooth
          8sync setup --profile dev-stack      just dev-stack (Docker + Node/Bun + Encore)
          8sync setup --no-profile             harness only (skip profile stage)
          8sync setup --profile terminal       helix + Nerd font + pro zsh, any OS (opt-in)
          8sync setup --dry-run                print the full plan, change nothing

        STAGE A — HARNESS (always run, idempotent)
          · github-cli (gh)                     (native pkg manager; Debian/Ubuntu/other Linux: GitHub release → ~/.local/bin)
          · omp AI CLI                          (official installer: install.sh / install.ps1)
          · paru                                (AUR helper — Arch family only)
          · codegraph                           (semantic code index)
          · forge + zsh                         (`8sync forge <name>`; Windows: MSYS2 zsh; Linux without sudo: static zsh)
          · PATH bootstrap                      (~/.local/bin, ~/.cargo/bin, ~/.bun/bin,
                                                 ~/.encore/bin — zsh/bash + fish conf.d)
          · configs + skills under ~/.config/8sync/ and ~/.omp/skills/
          · harness global                      (every bundled skill, APPEND_SYSTEM, MCP, hooks)

        STAGE B — PROFILES (community-visible)
          dev-stack    Docker + Node/npm/bun/pnpm + Encore + TS LSP + build chain
          nvidia       Auto-detect GPU family → open-dkms / dkms (skipped if chwd active)
          warp         Cloudflare WARP VPN + DoH + MASQUE  (toggle via `8sync sec`)
          bluetooth    bluez + bluez-utils + service enable  (control via `8sync bt`)
          terminal     helix + JetBrains Nerd font + pro zsh (prompt · menu completion ·
                       suggestions · highlighting); Windows Terminal font; kitty glass on Arch/Fedora

        PROFILE MANAGEMENT
          8sync setup profile list             every profile (community + personal tag)
          8sync setup profile show <name>      resolved packages + services + post-install
          8sync setup profile apply <name>     (re-)apply one profile idempotently

        UNATTENDED MODE (auto-on with --community / --full / --profile / --no-profile)
          1. Preflight: print OS, display manager, sessions, GPU, tool presence
          2. Log every step to ~/.cache/8sync/setup-<unix_ts>.log
          3. On any step failure: log + track + CONTINUE (re-run to retry)
          4. Auto-yes (--noconfirm / -y) for every native package install

        SAFETY
          · Every install is transactional: a failed package batch is rolled back.
          · Re-running setup is idempotent.
          · `--dry-run` is always safe.
    "}
)]
pub struct Args {
    /// Sub-command: `profile [list|show|apply <name>]`
    pub action: Option<String>,
    /// Arguments for the sub-command.
    pub rest: Vec<String>,

    /// Unattended: accept every COMMUNITY profile (what the y/N prompt offers).
    /// Personal profiles are NOT included — ask for them: `--profile alexdev`.
    /// Aliases: `--yall`, `--yes`, `-y`. Implies preflight + log + skip-on-error.
    #[arg(long = "full", alias = "yall", alias = "yes", short = 'y')]
    pub full: bool,

    /// Community bundle: dev-stack + bluetooth (unattended).
    /// Does NOT include `warp` — opt-in via `--profile warp`.
    #[arg(long)]
    pub community: bool,

    /// Skip Stage B entirely (harness only — no profile prompts).
    #[arg(long)]
    pub no_profile: bool,

    /// Apply a specific profile non-interactively (use after Stage A).
    #[arg(long)]
    pub profile: Option<String>,

    /// Auto-reboot after install completes (10s countdown — Ctrl-C cancels).
    /// Needed when a new kernel module landed (NVIDIA driver upgrade, etc.).
    /// Otherwise a logout is enough for new sessions to pick up the change.
    #[arg(long)]
    pub reboot: bool,

    /// Print the plan without making any changes.
    #[arg(long)]
    pub dry_run: bool,
}

pub fn run(a: Args) -> Result<()> {
    // Sub-command: `8sync setup profile <action>`
    if a.action.as_deref() == Some("profile") {
        return profile_sub(a.rest, a.full, a.dry_run);
    }

    ui::header("8sync setup");
    let env = env_detect::Env::detect()?;
    crate::verbs::skill::deploy::migrate_namespace(&env.home);
    // Stage A is cross-platform. Stage B needs a native backend, so warn only
    // when this Linux box is in NEITHER supported family — Fedora is first-class.
    match platform::os() {
        platform::Os::Linux if env.family() == env_detect::Family::Other => ui::warn(&format!(
            "OS `{}` is neither Arch- nor Fedora-family — native package steps will be skipped.",
            env.os_id
        )),
        platform::Os::Macos | platform::Os::Windows => ui::info(&format!(
            "{} — installing the cross-platform AI-harness core (Stage A); Linux-only profiles are skipped.",
            platform::os_name()
        )),
        _ => {}
    }

    // ── YOLO mode setup: auto-on for any unattended path ─────────
    // Triggers when user requests an unambiguous install path:
    //   --full          → every community profile
    //   --profile <n>   → just one profile
    //   --no-profile    → harness only (what install.sh / install.ps1 run): one
    //                     failed tool must not stop the rest of the harness
    // Strict mode (default `8sync setup` with no flags) keeps existing
    // behaviour: interactive prompts, errors bail, no log file.
    let yolo = a.full || a.profile.is_some() || a.community || a.no_profile;
    let log_path = if yolo && !a.dry_run {
        init_yolo_log().ok()
    } else {
        None
    };
    if yolo {
        preflight(&env);
    }
    let mut failures: Vec<String> = Vec::new();

    // ── Stage A: Harness (always run) ────────────────────────────
    ui::step("Stage A — coding harness");
    if a.dry_run {
        // Route through the SAME decision the real install takes, so the plan
        // names the backend and package id that would actually be used — an
        // Arch-shaped literal here is a lie on Fedora (and proves nothing).
        match platform::core_route(platform::os(), env.family(), GH) {
            platform::CoreRoute::Native(p) => {
                let mgr = pkg::backend().map(|b| b.name()).unwrap_or("native");
                ui::info(&format!("would install {p} via {mgr}"));
            }
            platform::CoreRoute::Brew => ui::info(&format!("would install {} via brew", GH.brew)),
            platform::CoreRoute::Winget => {
                ui::info(&format!("would install {} via winget", GH.winget))
            }
            platform::CoreRoute::Manual if platform::os() == platform::Os::Linux => {
                ui::info("would install gh from github.com/cli/cli releases into ~/.local/bin (sha256-checked)")
            }
            platform::CoreRoute::Manual => platform::no_pkg_manager_notice("gh"),
        }
        ui::info("would install omp (official installer) if missing");
        if env.family() == env_detect::Family::Arch {
            ui::info("would install paru (AUR helper) if missing");
        } else {
            ui::info(&format!(
                "would skip paru: AUR helper is Arch-only ({})",
                env.os_id
            ));
        }
        ui::info("would install codegraph (official installer) if missing");
        ui::info("would install forge (GitHub release) + zsh (Windows: MSYS2 zsh) if missing");
        ui::info("would write: configs + skills");
        ui::info("would patch PATH in zsh/bash + ~/.config/fish/conf.d/8sync-path.fish");
        ui::info("would register codegraph as a global+local skill");
        ui::info("would run `8sync harness global` (skills, APPEND_SYSTEM, MCP, hooks)");
    } else {
        try_step("gh cli", yolo, &mut failures, || {
            // winget/brew exit non-zero for an already-installed package, which
            // would report a failure on every re-run.
            if which::which("gh").is_ok() || dirs::home_dir().is_some_and(|h| h.join(".local/bin/gh").exists()) {
                ui::skip("gh", "present");
                return Ok(());
            }
            let manual = platform::core_route(platform::os(), env.family(), GH) == platform::CoreRoute::Manual;
            if manual && platform::os() == platform::Os::Linux {
                return install_gh_release();
            }
            platform::install_core_pkg("gh", GH)
        })?;
        try_step("omp",        yolo, &mut failures, install_omp)?;
        // The AUR helper is an Arch-family concept. Gating this on `Os::Linux`
        // made it run on Fedora/Debian too, where `pacman` does not exist: the
        // step failed, and in strict (non-yolo) mode `try_step` propagates, so
        // the `?` aborted Stage A before codegraph/configs/skills ever ran.
        if env.is_cachyos_or_arch() {
            try_step("paru",   yolo, &mut failures, install_aur_helper)?;
        } else if platform::os() == platform::Os::Linux {
            ui::info(&format!("AUR helper is Arch-only — skipping on {}", env.os_id));
        }
        try_step("codegraph",  yolo, &mut failures, install_codegraph)?;
        try_step("forge",      yolo, &mut failures, || {
            ui::step("Forge + zsh (`8sync forge <name>`)");
            let forge = crate::verbs::forge::ensure_forge()?;
            let zsh = crate::verbs::forge::ensure_zsh()?;
            crate::verbs::forge::ensure_zsh_plugins();
            ui::ok(&format!("forge {} · zsh {}", forge.display(), zsh.exe.display()));
            Ok(())
        })?;
        try_step("path-bootstrap", yolo, &mut failures, || { ensure_path_in_shells(); Ok(()) })?;
        try_step("configs",    yolo, &mut failures, || install_configs(&env))?;
        try_step("skills",     yolo, &mut failures, || install_skills(&env))?;
        try_step("codegraph-skill", yolo, &mut failures, || register_codegraph_skill(&env))?;
        try_step("harness-global", yolo, &mut failures, || {
            crate::verbs::harness::global::harness_global(&env, None, false, false)
        })?;
    }
    // `terminal` is cross-platform (winget / brew / release downloads), so it is
    // dispatched before the native-package gate below.
    if a.profile.as_deref() == Some("terminal") {
        ui::step("Stage B — terminal (helix · Nerd font · pro zsh; kitty glass on Arch/Fedora)");
        try_step("terminal", yolo, &mut failures, || install_terminal(&env, a.dry_run))?;
        finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
        return Ok(());
    }
    // Stage B profiles install NATIVE packages (pacman on Arch, dnf on Fedora).
    // Gate on the distro FAMILY, not on `Os::Linux`: a Linux host with neither
    // backend has nothing to install from, exactly like macOS/Windows.
    if env.family() == env_detect::Family::Other {
        ui::info(&format!(
            "Stage B profiles need pacman (Arch family) or dnf (Fedora family) — skipping on {}",
            if platform::os() == platform::Os::Linux { env.os_id.as_str() } else { platform::os_name() }
        ));
        finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
        return Ok(());
    }

    // ── Stage B: Profiles (optional) ─────────────────────────────
    if a.no_profile {
        ui::info("--no-profile → skipping personal profiles");
        finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
        return Ok(());
    }

    let all = profile::load_all()?;

    // explicit --profile <name>
    if let Some(name) = a.profile.as_ref() {
        ui::step(&format!("Stage B — applying profile `{}`", name));
        try_step(&format!("profile:{}", name), yolo, &mut failures, || {
            let resolved = profile::resolve_with(name, &all, true)?;
            let did = profile::apply(&resolved, true, a.dry_run)?;
            if did && !a.dry_run {
                profile::mark_applied(name)?;
            }
            Ok(())
        })?;
        finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
        return Ok(());
    }

    // --full: say yes to everything the interactive prompt would have offered.
    //
    // This used to apply the `alexdev` bundle, i.e. one maintainer's personal
    // machine — so a teammate running `8sync setup --yall` got Lian Li chassis
    // drivers, a Vietnamese IME and a DisplayLink DKMS module on hardware that
    // has none of them. "Full" now means the full COMMUNITY set, the exact list
    // `offered_profiles()` puts in the prompt. Personal profiles stay reachable
    // only by asking for them: `--profile alexdev` restores the old behaviour in
    // one flag.
    if a.full {
        // `warp` is offered at the prompt but never taken unattended: it is a VPN
        // that rewrites the machine's DNS and routing. `--community` already
        // documents that opt-out, and a flag meaning "don't ask me" is the worst
        // possible way to acquire one. `--profile warp` remains the way in.
        let names: Vec<String> = offered_profiles(&all)
            .into_iter()
            .filter(|n| n != "warp")
            .collect();
        ui::step("Stage B — --full: every community profile (except the warp VPN)");
        for n in &names {
            try_step(&format!("profile:{}", n), yolo, &mut failures, || {
                let resolved = profile::resolve_with(n, &all, true)?;
                let did = profile::apply(&resolved, true, a.dry_run)?;
                if did && !a.dry_run {
                    profile::mark_applied(n)?;
                }
                Ok(())
            })?;
        }
        try_step("terminal", yolo, &mut failures, || {
            install_terminal(&env, a.dry_run)
        })?;
        finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
        return Ok(());
    }

    // --community: dev-stack + bluetooth (NOT warp)
    if a.community {
        let bundle = ["dev-stack", "bluetooth"];
        ui::step("Stage B — --community: dev-stack + bluetooth");
        for n in &bundle {
            if !all.contains_key(*n) {
                ui::warn(&format!("profile `{}` not found — skipping", n));
                continue;
            }
            try_step(&format!("profile:{}", n), yolo, &mut failures, || {
                let resolved = profile::resolve_with(n, &all, true)?;
                let did = profile::apply(&resolved, true, a.dry_run)?;
                if did && !a.dry_run { profile::mark_applied(n)?; }
                Ok(())
            })?;
        }
        finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
        return Ok(());
    }

    // Interactive y/N per profile (skip bundle profiles)
    if !env_detect::has_tty() {
        ui::info("no TTY — skipping interactive profile prompt (use --full / --profile <name>)");
        finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
        return Ok(());
    }


    ui::step("Stage B — community profiles (y/N each)");
    let names = offered_profiles(&all);
    for name in &names {
        let p = match all.get(name.as_str()) {
            Some(p) => p,
            None => continue,
        };
        let desc = if p.description.is_empty() {
            name.as_str()
        } else {
            p.description.as_str()
        };
        let q = format!("Apply `{}` — {}", name, desc);
        if ui::prompt_yes_no(&q, false) {
            let resolved = profile::resolve_with(name, &all, true)?;
            if let Err(e) = profile::apply(&resolved, false, a.dry_run) {
                ui::err(&format!("profile {} failed: {}", name, e));
            } else if !a.dry_run {
                let _ = profile::mark_applied(name);
            }
        }
    }
    if ui::prompt_yes_no("Apply `terminal` — kitty glass + helix + Nerd font (3-pane vibe loop)", false) {
        if let Err(e) = install_terminal(&env, a.dry_run) {
            ui::err(&format!("terminal failed: {}", e));
        }
    }

    finish_summary(&failures, log_path.as_ref(), a.reboot, a.dry_run);
    Ok(())
}

fn finish_msg() {
    ui::header("Done — next steps");
    println!("  · 8sync doctor               — verify");
    println!("  · cd <project> && 8sync .    — seed su-code/ + start omp --continue");
}

/// The profiles a machine that is not the maintainer's may be offered: community
/// visibility, non-bundle, in a stable presentation order.
///
/// SINGLE SOURCE OF TRUTH for "what does a teammate get". Both the interactive
/// y/N prompt and `--full` read it, so the unattended path can never drift from
/// the interactive one and quietly install a personal profile. Anything marked
/// `visibility = "personal"` is reachable only through an explicit
/// `--profile <name>` / `setup profile apply <name>`.
pub(crate) fn offered_profiles(all: &HashMap<String, profile::Profile>) -> Vec<String> {
    const ORDER: [&str; 4] = ["dev-stack", "nvidia", "bluetooth", "warp"];
    let mut names: Vec<String> = all
        .iter()
        .filter(|(_, p)| p.extends.is_empty() && p.visibility == profile::Visibility::Community)
        .map(|(k, _)| k.clone())
        .collect();
    // Listed names first in ORDER; anything new a user drops in follows, sorted.
    names.sort_by(|a, b| {
        let rank = |n: &str| ORDER.iter().position(|o| *o == n).unwrap_or(ORDER.len());
        rank(a).cmp(&rank(b)).then_with(|| a.cmp(b))
    });
    names
}

/// Print final summary: log path (if any) + list of failures (if any).
/// Always prints `finish_msg` next-steps at the end.
/// If `reboot=true` and no failures, triggers a 10s-cancellable reboot.
fn finish_summary(failures: &[String], log_path: Option<&PathBuf>, reboot: bool, dry_run: bool) {
    if let Some(p) = log_path {
        ui::info(&format!("full log: {}", p.display()));
    }
    if failures.is_empty() {
        ui::ok("all steps succeeded (no failures recorded)");
    } else {
        ui::warn(&format!(
            "{} step(s) failed but were skipped (unattended mode): {}",
            failures.len(),
            failures.join(", ")
        ));
        ui::info("re-run the same command to retry — every step is idempotent");
    }
    ui::close_log_file();
    finish_msg();

    if reboot && !dry_run {
        if !failures.is_empty() {
            ui::warn("--reboot requested but some steps failed — aborting reboot. Fix or re-run, then reboot manually.");
            return;
        }
        do_reboot_with_countdown(10);
    }
}

/// Print a `secs`-second countdown then `systemctl reboot`. Ctrl-C cancels.
fn do_reboot_with_countdown(secs: u32) {
    use std::io::Write;
    println!();
    ui::warn(&format!("rebooting in {}s — press Ctrl-C to cancel", secs));
    for i in (1..=secs).rev() {
        print!("\r  ⏱  {}s remaining... ", i);
        std::io::stdout().flush().ok();
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    println!("\r  ⏱  rebooting now              ");
    let _ = Command::new("systemctl").arg("reboot").status();
}

// ─────────────────────────────────────────────────────────────────
// Stage A helpers
// ─────────────────────────────────────────────────────────────────

/// Run an upstream one-line installer with the platform's own shell:
/// `curl -fsSL <sh_url> | sh` on Unix, `irm <ps1_url> | iex` on Windows (a
/// stock Windows box has no `sh`).
fn run_installer(sh_url: &str, ps1_url: &str) -> Result<()> {
    if platform::os() == platform::Os::Windows {
        pkg::run_loud(
            "powershell",
            &[
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &format!("$ProgressPreference='SilentlyContinue'; irm {ps1_url} | iex"),
            ],
        )
    } else {
        pkg::run_loud("sh", &["-c", &format!("curl -fsSL {sh_url} | sh")])
    }
}

/// A tool counts as present when it is on PATH or at its installer's default
/// location (a fresh Windows install updates the user PATH, not ours).
fn tool_present(bin: &str, win_default: &[&str]) -> Option<String> {
    if which::which(bin).is_ok() {
        return Some(env_detect::cmd_version(bin, &["--version"]).unwrap_or_default());
    }
    let local = dirs::data_local_dir()?;
    let p = win_default.iter().fold(local, |p, seg| p.join(seg));
    (platform::os() == platform::Os::Windows && p.exists()).then(|| p.display().to_string())
}

fn install_omp() -> Result<()> {
    ui::step("omp AI CLI");
    if let Some(v) = tool_present("omp", &["omp", "omp.exe"]) {
        ui::skip("omp", &format!("present ({})", v));
        return Ok(());
    }
    if platform::os() != platform::Os::Windows {
        return run_installer("https://omp.sh/install", "https://omp.sh/install.ps1");
    }
    // Without a flag the Windows installer prefers `bun install -g` (and throws
    // on an older bun); `-Binary` installs the self-contained omp.exe. It also
    // records the FIRST bash on PATH as omp's shell — usually the WSL launcher
    // System32\bash.exe — unless shellPath is already set, so seed Git Bash.
    #[cfg(windows)]
    seed_omp_shell_path();
    pkg::run_loud(
        "powershell",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$ProgressPreference='SilentlyContinue'; & ([scriptblock]::Create((irm https://omp.sh/install.ps1))) -Binary",
        ],
    )
}

/// Set `shellPath` in `~/.omp/agent/settings.json` to Git Bash when unset.
#[cfg(windows)]
fn seed_omp_shell_path() {
    let (Some(bash), Some(home)) = (crate::verbs::forge::git_bash(), dirs::home_dir()) else {
        return;
    };
    let file = home.join(".omp").join("agent").join("settings.json");
    let mut v: serde_json::Value = std::fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    let Some(obj) = v.as_object_mut() else { return };
    if obj.contains_key("shellPath") {
        return;
    }
    obj.insert("shellPath".into(), bash.display().to_string().into());
    let _ = std::fs::create_dir_all(file.parent().unwrap_or(&home));
    if std::fs::write(&file, serde_json::to_string_pretty(&v).unwrap_or_default()).is_ok() {
        ui::ok(&format!("omp shellPath → {}", bash.display()));
    }
}

fn install_aur_helper() -> Result<()> {
    ui::step("AUR helper (paru)");
    if let Some(h) = env_detect::aur_helper() {
        ui::skip(h, "present");
        return Ok(());
    }
    pkg::install("paru build deps", &["git", "base-devel"], true)?;
    let cmd = "cd /tmp && rm -rf paru-bootstrap && \
        git clone https://aur.archlinux.org/paru.git paru-bootstrap && \
        cd paru-bootstrap && makepkg -si --noconfirm && \
        cd .. && rm -rf paru-bootstrap";
    pkg::run_loud("sh", &["-c", cmd])?;
    ui::ok("paru installed");
    Ok(())
}

fn install_codegraph() -> Result<()> {
    ui::step("codegraph (semantic code index for omp / claude / cursor)");
    if let Some(v) = tool_present("codegraph", &["codegraph", "current", "bin", "codegraph.cmd"]) {
        ui::skip("codegraph", &format!("present ({})", v));
        return Ok(());
    }
    run_installer(
        "https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh",
        "https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1",
    )?;
    ensure_path_in_shells();
    Ok(())
}

/// Ensure user-local bin dirs are on PATH in zsh/bash, and drop a fish
/// `conf.d/` snippet that does the same via `fish_add_path`. Idempotent.
///
/// Paths covered (any that exist or will exist after setup):
///   ~/.local/bin   — codegraph, 8sync, encore (most installers)
///   ~/.cargo/bin   — rustup-installed binaries (cargo, rust-analyzer)
///   ~/.bun/bin     — bun runtime / `bun install -g` shims
///   ~/.encore/bin  — encore CLI
fn ensure_path_in_shells() {
    let Some(home) = dirs::home_dir() else {
        return;
    };
    let dirs = [".local/bin", ".cargo/bin", ".bun/bin", ".encore/bin"];

    // ── zsh / bash ────────────────────────────────────────────────
    // `$HOME/…`, not the expanded path: on Windows the expansion is `C:\Users\…`,
    // whose `:` splits PATH in Git Bash / MSYS zsh into junk entries.
    let marker = "# 8sync: PATH bootstrap (user-local bins for codegraph/bun/encore/cargo)";
    let lines: Vec<String> = dirs
        .iter()
        .map(|d| format!("case \":$PATH:\" in *\":$HOME/{d}:\"*) ;; *) export PATH=\"$HOME/{d}:$PATH\" ;; esac"))
        .collect();
    for rc in [home.join(".zshrc"), home.join(".bashrc")] {
        if !rc.exists() {
            continue;
        }
        let existing = std::fs::read_to_string(&rc).unwrap_or_default();
        let Some(updated) = upsert_marked_block(&existing, marker, &lines, |l| l.starts_with("case \":$PATH:\"")) else {
            continue;
        };
        if let Err(e) = std::fs::write(&rc, updated) {
            ui::warn(&format!("could not patch {}: {}", rc.display(), e));
            continue;
        }
        ui::ok(&format!("patched {} (PATH bootstrap)", rc.display()));
    }

    // ── fish (conf.d snippet — sourced on every interactive session) ─
    let fish_dir = home.join(".config/fish/conf.d");
    if let Err(e) = std::fs::create_dir_all(&fish_dir) {
        ui::warn(&format!("could not create {}: {}", fish_dir.display(), e));
        return;
    }
    let fish_file = fish_dir.join("8sync-path.fish");
    let mut fish_body = String::new();
    fish_body.push_str("# 8sync: PATH bootstrap — regenerated by `8sync setup`. Do not edit.\n");
    fish_body.push_str("if status is-interactive\n");
    fish_body.push_str("    fish_add_path --path \\\n");
    let entries: Vec<String> = dirs
        .iter()
        .map(|d| format!("        $HOME/{}", d))
        .collect();
    fish_body.push_str(&entries.join(" \\\n"));
    fish_body.push('\n');
    fish_body.push_str("end\n");
    let existing = std::fs::read_to_string(&fish_file).unwrap_or_default();
    if existing == fish_body {
        ui::skip(&fish_file.display().to_string(), "unchanged");
        return;
    }
    if let Err(e) = std::fs::write(&fish_file, &fish_body) {
        ui::warn(&format!("could not write {}: {}", fish_file.display(), e));
        return;
    }
    ui::ok(&format!("wrote {} (fish PATH bootstrap)", fish_file.display()));
}

/// `existing` with a managed block (marker line + `lines`) appended, or rewritten
/// in place when the old one differs (e.g. the absolute Windows paths earlier
/// releases wrote). Old block lines are the ones right after the marker that
/// `is_block` recognizes. `None` when it is already current.
fn upsert_marked_block(existing: &str, marker: &str, lines: &[String], is_block: fn(&str) -> bool) -> Option<String> {
    let mut out: Vec<&str> = existing.lines().collect();
    match out.iter().position(|l| *l == marker) {
        Some(at) => {
            let end = at + 1 + out[at + 1..].iter().take_while(|l| is_block(l)).count();
            if out[at + 1..end].iter().copied().eq(lines.iter().map(String::as_str)) {
                return None;
            }
            out.splice(at + 1..end, lines.iter().map(String::as_str));
        }
        None => {
            out.push("");
            out.push(marker);
            out.extend(lines.iter().map(String::as_str));
        }
    }
    Some(out.join("\n") + "\n")
}

fn register_codegraph_skill(env: &env_detect::Env) -> Result<()> {
    ui::step("Register codegraph skill (bundled)");
    // SKILL.md tree is shipped from embedded assets via `install_skills`
    // (no upstream README synthesis). Here we just append a registry entry to
    // skills.toml so `8sync skill list` shows codegraph as an always-on skill.
    let toml_path = env.xdg_config.join("8sync/skills.toml");
    if let Some(parent) = toml_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let existing = std::fs::read_to_string(&toml_path).unwrap_or_default();
    if existing.contains("[codegraph]") {
        ui::skip(&toml_path.display().to_string(), "codegraph already registered");
        return Ok(());
    }
    let mut s = existing;
    if !s.ends_with('\n') && !s.is_empty() {
        s.push('\n');
    }
    s.push_str("\n[codegraph]\nsrc  = \"builtin:codegraph\"\nwhen = \"always\"\n");
    std::fs::write(&toml_path, s)?;
    ui::ok(&format!("registered 'codegraph' → {}", toml_path.display()));
    Ok(())
}

fn install_configs(env: &env_detect::Env) -> Result<()> {
    ui::step("Configs (8sync/{global,skills}.toml)");
    let pairs = [
        ("configs/global.toml", env.xdg_config.join("8sync/global.toml")),
        ("configs/skills.toml", env.xdg_config.join("8sync/skills.toml")),
        ("configs/models.toml", env.xdg_config.join("8sync/models.toml")),
    ];
    for (asset, target) in &pairs {
        let changed = assets::install(asset, target, false)?;
        if changed {
            ui::ok(&format!("wrote {}", target.display()));
        } else {
            ui::skip(&target.display().to_string(), "unchanged");
        }
    }
    Ok(())
}

/// Opt-in terminal/editor nicety (Stage B, NOT the AI core): kitty (terminal),
/// helix (`hx`), and a Nerd font for the glass theme. Docker lives in `dev-stack`.
fn install_terminal_pkgs(env: &env_detect::Env) -> Result<()> {
    // Same three tools, different ids: Arch ships the patched Nerd font as
    // `ttf-jetbrains-mono-nerd`; on Fedora JetBrains Mono is `jetbrains-mono-fonts`.
    let font = match env.family() {
        env_detect::Family::Fedora => "jetbrains-mono-fonts",
        _ => "ttf-jetbrains-mono-nerd",
    };
    pkg::install("terminal stack", &["kitty", "helix", font], true)
}

/// Deploy the kitty glass theme (transparency + wallpaper + splits) without
/// clobbering the user's kitty.conf, plus a transparent helix config if absent.
fn install_terminal_config(env: &env_detect::Env) -> Result<()> {
    ui::step("Terminal (kitty glass + wallpaper + helix)");
    let kitty_dir = env.xdg_config.join("kitty");
    std::fs::create_dir_all(&kitty_dir)?;

    // Wallpaper → ~/.config/8sync/wallpaper.png (bundled asset preferred, else URL).
    let wp = env.xdg_config.join("8sync/wallpaper.png");
    let wp_ready = deploy_wallpaper(env, &wp);

    // Glass conf → ~/.config/kitty/8sync.conf. Honor a `8sync bg set` choice
    // (recorded in ~/.config/8sync/wallpaper) when it still exists; else bake the
    // deployed wallpaper.png so a fresh setup is never a silent no-op.
    let conf_path = kitty_dir.join("8sync.conf");
    let bg_choice = std::fs::read_to_string(env.xdg_config.join("8sync/wallpaper"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && std::path::Path::new(s).exists());
    let wp_for_conf: Option<&std::path::Path> = bg_choice
        .as_deref()
        .map(std::path::Path::new)
 .or_else(|| wp_ready.then_some(wp.as_path()));
    std::fs::write(&conf_path, render_kitty_conf(wp_for_conf, env_detect::is_tiling_wm()))?;
    ui::ok(&format!("wrote {}", conf_path.display()));

    // Palette → ~/.config/kitty/8sync-theme.conf (swappable via `8sync theme set`).
    match crate::verbs::theme::deploy(env) {
        Ok(name) => ui::ok(&format!("kitty palette → {name} (8sync-theme.conf)")),
        Err(e) => ui::warn(&format!("theme deploy skipped: {e}")),
    }

    // Make the user's kitty.conf include ours (managed line, idempotent, no clobber).
    ensure_kitty_include(&kitty_dir)?;

    deploy_helix_config(env)
}

/// Helix: the bundled config if the user has none yet (never overwrite).
fn deploy_helix_config(env: &env_detect::Env) -> Result<()> {
    let hx_cfg = env.xdg_config.join("helix/config.toml");
    if !hx_cfg.exists() && assets::read("configs/helix/config.toml").is_some() {
        assets::install("configs/helix/config.toml", &hx_cfg, false)?;
        ui::ok(&format!("wrote {}", hx_cfg.display()));
    } else {
        ui::skip("helix config", "exists — left as-is");
    }
    Ok(())
}

/// Opt-in terminal stack. Used by the Stage B menu, `--profile terminal`, and
/// `--full` — never in the default AI-core Stage A. Every OS gets helix, a Nerd
/// font where the OS owns fonts, and 8sync's pro zsh; kitty glass is Arch/Fedora.
fn install_terminal(env: &env_detect::Env, dry_run: bool) -> Result<()> {
    let os = platform::os();
    let native = matches!(env.family(), env_detect::Family::Arch | env_detect::Family::Fedora);
    if dry_run {
        match os {
            platform::Os::Windows => ui::info(
                "would install helix + JetBrainsMono Nerd Font via winget, set it as the Windows Terminal default font (if unset)",
            ),
            platform::Os::Macos => ui::info("would install helix + font-jetbrains-mono-nerd-font via brew"),
            _ if native => ui::info("would install kitty + helix + JetBrains Mono natively + kitty glass config"),
            _ => ui::info(&format!("would install helix {HELIX_VERSION} (GitHub release) into ~/.local/bin")),
        }
        ui::info("would deploy helix config (if absent) + 8sync pro zsh (prompt, completion, suggestions, highlighting)");
        return Ok(());
    }
    match os {
        platform::Os::Windows => install_terminal_windows()?,
        platform::Os::Macos => {
            if which::which("brew").is_err() {
                bail!("Homebrew is required on macOS for helix + Nerd font — https://brew.sh");
            }
            if which::which("hx").is_err() {
                pkg::run_loud("brew", &["install", "helix"])?;
            }
            let _ = pkg::run_loud("brew", &["install", "--cask", "font-jetbrains-mono-nerd-font"]);
        }
        _ if native => {
            install_terminal_pkgs(env)?;
            install_terminal_config(env)?;
        }
        _ => install_helix_release()?,
    }
    deploy_helix_config(env)?;
    install_pro_zsh(env)
}

#[cfg(not(windows))]
const HELIX_VERSION: &str = "25.07.1";
#[cfg(windows)]
const HELIX_VERSION: &str = "";

/// helix on Linux without a native package (Debian, Ubuntu, …): the pinned
/// release tarball (`hx` + `runtime/`) into `~/.local/share/8sync/helix`, `hx`
/// linked into `~/.local/bin` — helix finds `runtime/` next to the real binary.
#[cfg(not(windows))]
fn install_helix_release() -> Result<()> {
    if which::which("hx").is_ok() {
        ui::skip("helix", "present");
        return Ok(());
    }
    let (arch, sha) = match std::env::consts::ARCH {
        "x86_64" => ("x86_64", "3f08e63ecd388fff657ad39722f88bb03dcf326f1f2da2700d99e1dc40ab2e8b"),
        "aarch64" => ("aarch64", "ce23fa8d395e633e3e54c052012f11965d91d8d5c2bfa659685f50430b4f8175"),
        a => bail!("no helix release for linux/{a} — install helix manually"),
    };
    let stem = format!("helix-{HELIX_VERSION}-{arch}-linux");
    let share = dirs::data_local_dir().context("no data dir")?.join("8sync");
    let tarball = share.join(format!("{stem}.tar.xz"));
    ui::step(&format!("Installing helix {HELIX_VERSION} ({stem})"));
    crate::verbs::forge::download(
        &format!("https://github.com/helix-editor/helix/releases/download/{HELIX_VERSION}/{stem}.tar.xz"),
        &tarball,
    )?;
    let got = crate::verbs::selfup::sha256_file(&tarball).context("no working sha256 hasher")?;
    if !got.eq_ignore_ascii_case(sha) {
        let _ = std::fs::remove_file(&tarball);
        bail!("helix checksum mismatch — refusing to install\n  expected {sha}\n  actual   {got}");
    }
    let unpacked = pkg::run_loud("tar", &["-xJf", &tarball.to_string_lossy(), "-C", &share.to_string_lossy()]);
    let _ = std::fs::remove_file(&tarball);
    unpacked.context("unpacking helix needs xz (apt install xz-utils)")?;
    let dir = share.join("helix");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::rename(share.join(&stem), &dir)?;
    let bin = dirs::home_dir().context("no home dir")?.join(".local/bin");
    std::fs::create_dir_all(&bin)?;
    let link = bin.join("hx");
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(dir.join("hx"), &link)?;
    ui::ok(&format!("helix {HELIX_VERSION} → {} (sha256 ok)", link.display()));
    Ok(())
}

#[cfg(windows)]
fn install_helix_release() -> Result<()> {
    Ok(())
}

/// 8sync's pro zsh as the user's everyday shell config (Linux/macOS): pinned
/// plugins, `<config>/8sync/zsh/8sync.zsh`, and one managed block in `~/.zshrc`
/// (skipped inside `8sync forge`, which loads it itself after Forge's plugin).
fn install_pro_zsh(env: &env_detect::Env) -> Result<()> {
    ui::step("zsh — prompt · completion menu · suggestions · syntax highlighting");
    let zsh = crate::verbs::forge::ensure_zsh()?;
    let plugins = crate::verbs::forge::ensure_zsh_plugins().context("no data dir for zsh plugins")?;
    let config = crate::verbs::forge::write_zsh_config(env)?;
    if platform::os() == platform::Os::Windows {
        ui::ok(&format!("pro zsh ready inside `8sync forge <name>` ({})", config.display()));
        return Ok(());
    }
    let rc = dirs::home_dir().context("no home dir")?.join(".zshrc");
    let marker = "# 8sync: pro zsh — `8sync setup --profile terminal` (delete this block to opt out)";
    let lines = vec![
        format!("export EIGHTSYNC_ZSH_PLUGINS=\"{}\"", plugins.display()),
        format!("[[ -z $EIGHTSYNC_FORGE_SESSION && -r \"{0}\" ]] && source \"{0}\"", config.display()),
    ];
    let existing = std::fs::read_to_string(&rc).unwrap_or_default();
    match upsert_marked_block(&existing, marker, &lines, |l| l.contains("EIGHTSYNC_")) {
        Some(updated) => {
            std::fs::write(&rc, updated)?;
            ui::ok(&format!("patched {} (sources {})", rc.display(), config.display()));
        }
        None => ui::skip(&rc.display().to_string(), "pro zsh already wired"),
    }
    let login = std::env::var("SHELL").unwrap_or_default();
    if !login.ends_with("zsh") {
        ui::info(&format!("make zsh your login shell: chsh -s {}", zsh.exe.display()));
    }
    Ok(())
}

/// Windows: helix + JetBrainsMono Nerd Font via winget, and that font as the
/// Windows Terminal default when the user has not chosen one (Forge's prompt
/// segment and helix's statusline use Nerd Font glyphs).
fn install_terminal_windows() -> Result<()> {
    if which::which("winget").is_err() {
        bail!("winget (App Installer) is required — install it from the Microsoft Store");
    }
    let winget = |id: &str| {
        pkg::run_loud(
            "winget",
            &["install", "--silent", "--accept-package-agreements", "--accept-source-agreements", "-e", "--id", id],
        )
    };
    if which::which("hx").is_ok() {
        ui::skip("helix", "present");
    } else {
        winget("Helix.Helix")?;
    }
    let face = match installed_nerd_face() {
        Some(face) => {
            ui::skip(face, "present");
            face
        }
        None => {
            winget("DEVCOM.JetBrainsMonoNerdFont")?;
            "JetBrainsMono Nerd Font"
        }
    };
    set_windows_terminal_font(face);
    Ok(())
}

/// The installed JetBrainsMono Nerd Font family (the `NL` no-ligature variant
/// counts), from the per-user or system font directory.
fn installed_nerd_face() -> Option<&'static str> {
    let dirs = [
        dirs::data_local_dir().map(|d| d.join("Microsoft/Windows/Fonts")),
        std::env::var_os("WINDIR").map(|w| PathBuf::from(w).join("Fonts")),
    ];
    let mut nl = false;
    for entry in dirs.into_iter().flatten().filter_map(|d| std::fs::read_dir(d).ok()).flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("JetBrainsMonoNerdFont") {
            return Some("JetBrainsMono Nerd Font");
        }
        nl |= name.starts_with("JetBrainsMonoNLNerdFont");
    }
    nl.then_some("JetBrainsMonoNL Nerd Font")
}

/// Set `profiles.defaults.font.face` in Windows Terminal's settings.json only
/// when no font is configured there. A targeted insert, not a re-serialization,
/// so the user's formatting and key order survive; the result is re-parsed
/// before it is written.
fn set_windows_terminal_font(face: &str) {
    let Some(path) = dirs::data_local_dir()
        .map(|d| d.join("Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState/settings.json"))
        .filter(|p| p.exists())
    else {
        ui::info(&format!("Windows Terminal settings not found — set its font to \"{face}\" for icons"));
        return;
    };
    let Ok(text) = std::fs::read_to_string(&path) else { return };
    match wt_with_default_font(&text, face) {
        Ok(Some(updated)) => match std::fs::write(&path, updated) {
            Ok(()) => ui::ok(&format!("Windows Terminal default font → {face}")),
            Err(e) => ui::warn(&format!("could not write {}: {e}", path.display())),
        },
        Ok(None) => ui::skip("Windows Terminal font", "already set — left as-is"),
        Err(why) => ui::info(&format!("Windows Terminal font not changed ({why}) — set it to \"{face}\" in Settings › Defaults › Appearance")),
    }
}

/// `text` with `"font": {"face": face}` inserted into `profiles.defaults`, or
/// `None` when a font is already set there.
fn wt_with_default_font(text: &str, face: &str) -> std::result::Result<Option<String>, &'static str> {
    let v: serde_json::Value = serde_json::from_str(text).map_err(|_| "settings.json has comments or is not plain JSON")?;
    let defaults = v.pointer("/profiles/defaults").ok_or("no profiles.defaults object")?;
    let obj = defaults.as_object().ok_or("profiles.defaults is not an object")?;
    if obj.contains_key("font") || obj.contains_key("fontFace") {
        return Ok(None);
    }
    let mut hits = text.match_indices("\"defaults\"");
    let (at, _) = hits.next().ok_or("no \"defaults\" key")?;
    if hits.next().is_some() {
        return Err("ambiguous \"defaults\" keys");
    }
    let brace = at + text[at..].find('{').ok_or("malformed defaults")?;
    let entry = format!("\"font\": {{ \"face\": {} }}{}", serde_json::Value::from(face), if obj.is_empty() { "" } else { "," });
    let updated = format!("{}{}{}", &text[..=brace], entry, &text[brace + 1..]);
    let check: serde_json::Value = serde_json::from_str(&updated).map_err(|_| "insert would break settings.json")?;
    if check.pointer("/profiles/defaults/font/face").and_then(|f| f.as_str()) != Some(face) {
        return Err("insert landed outside profiles.defaults");
    }
    Ok(Some(updated))
}

/// Put a wallpaper at `target`. Bundled `assets/wallpapers/default.png` wins; else
/// download `[ui].wallpaper_url` from global.toml with curl. True if present after.
fn deploy_wallpaper(env: &env_detect::Env, target: &std::path::Path) -> bool {
    if is_valid_image(target) {
        return true;
    }
    if let Some(p) = target.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    if let Some(bytes) = assets::read_bytes("wallpapers/default.png") {
        if std::fs::write(target, bytes).is_ok() {
            ui::ok(&format!("wallpaper → {}", target.display()));
            return true;
        }
    }
    if let Some(url) = wallpaper_url(env) {
        let ok = Command::new("curl")
            .args(["-fsSL", "--retry", "2", "-A", "Mozilla/5.0", "-o"])
            .arg(target)
            .arg(&url)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        // exists() is not enough — a blocked/empty response leaves a 0-byte PNG
        // that kitty can't render ("Could not render image to RGB: EOF"). Require
        // valid image magic, else purge the leftover so a re-run can retry.
        if ok && is_valid_image(target) {
            ui::ok(&format!("wallpaper ↓ {}", target.display()));
            return true;
        }
        let _ = std::fs::remove_file(target);
        ui::skip("wallpaper", "download failed or not a valid image");
    }
    false
}

/// A wallpaper file is usable only if it is non-empty and its magic bytes are a
/// known raster format — guards the 0-byte / HTML-error downloads that make kitty
/// fail with "Could not render image to RGB: EOF" and leave a blank background.
fn is_valid_image(p: &std::path::Path) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(p) else { return false };
    let mut head = [0u8; 4];
    if f.read_exact(&mut head).is_err() {
        return false; // < 4 bytes ⇒ empty or truncated
    }
    head == [0x89, 0x50, 0x4E, 0x47] // PNG
        || head[..2] == [0xFF, 0xD8] // JPEG
        || head == [0x52, 0x49, 0x46, 0x46] // WEBP "RIFF"
}

/// `[ui].wallpaper_url` from the deployed global.toml, else the embedded default.
fn wallpaper_url(env: &env_detect::Env) -> Option<String> {
    let s = std::fs::read_to_string(env.xdg_config.join("8sync/global.toml"))
        .ok()
        .or_else(|| assets::read("configs/global.toml"))?;
    let v: toml::Value = s.parse().ok()?;
    v.get("ui")?.get("wallpaper_url")?.as_str().map(str::to_string)
}

/// The glass kitty STRUCTURE: transparency + blur + font + layouts + splits.
/// The color palette is swappable and lives in `8sync-theme.conf` (deployed by
/// `verbs::theme::deploy` / `8sync theme set`), included first so its
/// `background` is the tint target. `wallpaper`, if present, is baked in.
fn render_kitty_conf(wallpaper: Option<&std::path::Path>, tiling_wm: bool) -> String {
    let bg_image = match wallpaper {
        Some(p) => format!(
            "background_image {}\nbackground_image_layout cscaled\nbackground_image_linear yes\nbackground_tint 0.86\nbackground_tint_gaps 0.0\n",
            p.display()
        ),
        None => String::new(),
    };
    let header = indoc::indoc! {"
        # 8sync — glass dark terminal (managed by `8sync setup`; included from kitty.conf)
        # Palette: `8sync theme set <name>` (default tokyo-night). Included first so its
        # `background` is the tint target. Structure (opacity/blur/font/splits) below.
        include 8sync-theme.conf
        background_opacity 0.90
        dynamic_background_opacity yes
        background_blur 28
        # Remote control so `8sync theme` / `8sync .` can live-drive kitty.
        allow_remote_control yes
    "};
    // Only hide kitty's own title bar/traffic-lights on a tiling compositor
    // (Hyprland/sway/…) that draws no chrome of its own. On a stacking desktop
    // (KDE/kwin, GNOME/mutter, …) the compositor ALSO won't decorate an
    // undecorated client window — hiding kitty's decorations there leaves the
    // window with no title bar, no min/max/close, and no resize border.
    let decorations = if tiling_wm { "hide_window_decorations yes\n        " } else { "" };
    let rest = indoc::formatdoc! {"
        # Font (JetBrains Mono Nerd Font installed by setup)
        font_family JetBrainsMono Nerd Font
        bold_font auto
        italic_font auto
        font_size 12.0
        # Window + layouts
        enabled_layouts splits:split_axis=horizontal,stack,tall,grid
        window_padding_width 8
        {decorations}confirm_os_window_close 0
        # Tabs (structure only — colors come from the palette)
        tab_bar_edge bottom
        tab_bar_style powerline
        tab_powerline_style slanted
        # 3-pane splits (gsd-style) — kept off ctrl+shift+equal/minus/backspace
        # so kitty's built-in zoom (change_font_size) stays intact
        map ctrl+shift+enter launch --location=hsplit --cwd=current
        map ctrl+shift+backslash launch --location=vsplit --cwd=current
        map ctrl+shift+] next_window
        map ctrl+shift+[ previous_window
    "};
    format!("{header}{bg_image}{rest}")
}

/// Ensure `~/.config/kitty/kitty.conf` includes our managed 8sync.conf. Creates
/// the file if missing; appends the include once (idempotent, never clobbers).
fn ensure_kitty_include(kitty_dir: &std::path::Path) -> Result<()> {
    let main = kitty_dir.join("kitty.conf");
    let mut body = std::fs::read_to_string(&main).unwrap_or_default();
    if body.contains("include 8sync.conf") {
        ui::skip("kitty.conf", "already includes 8sync.conf");
        return Ok(());
    }
    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    body.push_str("\n# 8sync glass theme (managed by `8sync setup`)\ninclude 8sync.conf\n");
    std::fs::write(&main, body)?;
    ui::ok("kitty.conf now includes 8sync.conf");
    Ok(())
}

fn install_skills(env: &env_detect::Env) -> Result<()> {
    ui::step("Skills (~/.omp/skills/)");
    let skills_dir = env.home.join(".omp/skills");
    std::fs::create_dir_all(&skills_dir)?;
    // Bundled skills: deploy entire tree (SKILL.md + scripts/ + references/).
    let bundled: [(&str, &str); 4] = [
        ("skills/karpathy-guidelines",      "karpathy-guidelines"),
        ("skills/image-routing", "image-routing"),
        ("skills/8sync-cli",     "8sync-cli"),
        ("skills/codegraph",     "codegraph"),
    ];
    for (prefix, name) in &bundled {
        let target = skills_dir.join(name);
        std::fs::create_dir_all(&target)?;
        let (written, _unchanged) = assets::install_tree(prefix, &target)?;
        if written > 0 {
            ui::ok(&format!("synced {} ({} file(s)) → {}", name, written, target.display()));
        } else {
            ui::skip(&target.display().to_string(), "unchanged");
        }
        // Ensure 3-folder layout even if the bundled tree didn't ship a
        // `scripts/` or `references/` subdir (karpathy/image-routing/8sync-cli).
        for sub in ["scripts", "references"] {
            let _ = std::fs::create_dir_all(target.join(sub));
        }
    }
    let master = skills_dir.join("00-force-load.md");
    if let Some(c) = assets::read("skills/00-force-load.md") {
        std::fs::write(&master, crate::brand::render(&c).as_ref())?;
    }
    ui::ok(&format!("wrote {}", master.display()));
    Ok(())
}

// ─── systemd helper (used by preflight) ─────────────────────────

fn systemctl_is_enabled(unit: &str) -> bool {
    Command::new("systemctl")
        .args(["is-enabled", &format!("{}.service", unit)])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ─── `8sync setup profile <sub>` ────────────────────────────────

fn profile_sub(rest: Vec<String>, yes_to_all: bool, dry_run: bool) -> Result<()> {
    let action = rest.first().map(|s| s.as_str()).unwrap_or("list");
    let all = profile::load_all()?;
    let state = profile::load_state();

    match action {
        "list" => {
            ui::header("Profiles");
            let mut names: Vec<&String> = all.keys().collect();
            names.sort();
            for n in names {
                let p = &all[n];
                let marker = if state.applied.iter().any(|x| x == n) {
                    "✓"
                } else {
                    " "
                };
                let kind = if !p.extends.is_empty() { "(bundle)" } else { "" };
                let vis = match p.visibility {
                    profile::Visibility::Community => "community",
                    profile::Visibility::Personal => "personal ",
                };
                println!("  {} {:20} [{}] {} {}", marker, n, vis, kind, p.description);
            }
            Ok(())
        }
        "show" => {
            let name = rest
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: 8sync setup profile show <name>"))?;
            let r = profile::resolve(name, &all)?;
            println!("name         = {}", r.name);
            println!("description  = {}", r.description);
            println!("visibility   = {:?}", r.visibility);
            println!("needs AUR    = {}", r.requires.aur_helper);
            println!("pacman       = {:?}", r.packages.pacman);
            println!("aur          = {:?}", r.packages.aur);
            println!("aur (yay)    = {:?}", r.packages.aur_yay);
            match &r.packages.fedora {
                Some(f) => {
                    println!("dnf          = {:?}", f.dnf);
                    if !f.copr.is_empty() {
                        println!("copr         = {:?}", f.copr);
                    }
                    if f.rpmfusion {
                        println!("rpmfusion    = true");
                    }
                    if !f.swap.is_empty() {
                        println!("dnf swap     = {:?}", f.swap);
                    }
                }
                None => println!("dnf          = (none — profile not ported to Fedora)"),
            }
            println!("sys services = {:?}", r.services.system_enable);
            println!("user services= {:?}", r.services.user_enable);
            println!("commands     = {:?}", r.post_install.commands);
            if !r.post_install.hint.is_empty() {
                println!("\nhints:\n{}", r.post_install.hint);
            }
            Ok(())
        }
        "apply" => {
            let name = rest
                .get(1)
                .ok_or_else(|| anyhow::anyhow!("usage: 8sync setup profile apply <name>"))?;
            let resolved = profile::resolve_with(name, &all, true)?;
            let did = profile::apply(&resolved, yes_to_all, dry_run)?;
            if did && !dry_run {
                profile::mark_applied(name)?;
            }
            Ok(())
        }
        other => {
            ui::warn(&format!(
                "unknown sub-action `{}` — try list | show | apply",
                other
            ));
            Ok(())
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// YOLO mode helpers (auto-on for --full / --community / --profile)
// ─────────────────────────────────────────────────────────────────

/// Open `~/.cache/8sync/setup-<unix_ts>.log` and wire `ui::*` to tee into it.
/// Idempotent across runs (timestamped filename).
fn init_yolo_log() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("no HOME"))?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = home.join(format!(".cache/8sync/setup-{}.log", ts));
    let final_path = ui::set_log_file(path)?;
    ui::ok(&format!("logging to {}", final_path.display()));
    Ok(final_path)
}

/// Quick read-only probe of system state. Prints what's already installed so
/// the install plan below is predictable. No side effects.
fn preflight(env: &env_detect::Env) {
    ui::step("Preflight — detecting current system state");

    // OS + DM
    ui::info(&format!(
        "OS: {} ({})",
        env.os_id,
        match env.family() {
            env_detect::Family::Arch => "Arch family — pacman",
            env_detect::Family::Fedora => "Fedora family — dnf",
            env_detect::Family::Other => "no native backend — best-effort",
        }
    ));
    let dm = ["display-manager", "sddm", "plasmalogin", "gdm", "lightdm", "greetd"]
        .iter()
        .find(|d| systemctl_is_enabled(d));
    match dm {
        Some(d) => ui::info(&format!("display manager: {}.service enabled", d)),
        None => ui::info("display manager: none enabled (fresh install path)"),
    }

    // Wayland / X sessions
    let sessions = enumerate_sessions();
    if sessions.is_empty() {
        ui::info("desktop sessions: none registered");
    } else {
        ui::info(&format!("desktop sessions: {}", sessions.join(", ")));
    }

    // Core tools. The AUR helpers are an Arch-family concept: probing for them
    // on Fedora prints two guaranteed "missing — will be installed" lies.
    let arch = env.family() == env_detect::Family::Arch;
    for (label, bin) in [
        ("omp", "omp"),
        ("paru", "paru"),
        ("yay", "yay"),
        ("codegraph", "codegraph"),
        ("gh", "gh"),
        ("encore", "encore"),
    ]
    .into_iter()
    .filter(|(l, _)| arch || !matches!(*l, "paru" | "yay"))
    {
        let present = which::which(bin).is_ok();
        if present {
            let v = env_detect::cmd_version(bin, &["--version"]).unwrap_or_default();
            ui::skip(label, if v.is_empty() { "present" } else { &v });
        } else {
            ui::info(&format!("{}: missing — will be installed", label));
        }
    }

    // GPU
    if let Ok(out) = std::process::Command::new("sh")
        .arg("-c")
        .arg("lspci -nn 2>/dev/null | grep -iE 'vga|3d' | head -3")
        .output()
    {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !s.is_empty() {
            for line in s.lines() {
                ui::info(&format!("gpu: {}", line.trim()));
            }
        }
    }
}

fn enumerate_sessions() -> Vec<String> {
    let mut out = Vec::new();
    for dir in ["/usr/share/wayland-sessions", "/usr/share/xsessions"] {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for e in entries.flatten() {
                if let Some(n) = e.file_name().to_str() {
                    if let Some(stripped) = n.strip_suffix(".desktop") {
                        out.push(stripped.to_string());
                    }
                }
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// In YOLO mode: log the error and continue. In strict mode: propagate.
/// `failures` tracks step labels that errored, surfaced in the summary.
fn try_step<F>(label: &str, yolo: bool, failures: &mut Vec<String>, f: F) -> Result<()>
where
    F: FnOnce() -> Result<()>,
{
    match f() {
        Ok(()) => Ok(()),
        Err(e) if yolo => {
            ui::err(&format!("[{}] failed: {} — continuing (unattended mode)", label, e));
            failures.push(label.to_string());
            Ok(())
        }
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod offered_tests {
    use super::*;

    #[test]
    fn path_bootstrap_heals_old_windows_paths_and_is_idempotent() {
        let marker = "# 8sync: PATH bootstrap";
        let lines = vec!["case \":$PATH:\" in *\":$HOME/.local/bin:\"*) ;; *) export PATH=\"$HOME/.local/bin:$PATH\" ;; esac".to_string()];
        let old = "export A=1\n# 8sync: PATH bootstrap\ncase \":$PATH:\" in *\":C:\\Users\\a\\.local/bin:\"*) ;; *) export PATH=\"C:\\Users\\a\\.local/bin:$PATH\" ;; esac\nalias x=y\n";
        let is_path = |l: &str| l.starts_with("case \":$PATH:\"");
        let healed = upsert_marked_block(old, marker, &lines, is_path).expect("stale block must be rewritten");
        assert_eq!(healed, format!("export A=1\n{marker}\n{}\nalias x=y\n", lines[0]));
        assert_eq!(upsert_marked_block(&healed, marker, &lines, is_path), None);
        // no block yet: appended after the user's content, user lines untouched
        let fresh = upsert_marked_block("export A=1\n", marker, &lines, is_path).unwrap();
        assert_eq!(fresh, format!("export A=1\n\n{marker}\n{}\n", lines[0]));
    }

    #[test]
    fn windows_terminal_font_is_inserted_only_when_unset() {
        let face = "JetBrainsMono Nerd Font";
        let empty = "{\n  \"profiles\": {\n    \"defaults\": {},\n    \"list\": []\n  }\n}\n";
        let set = wt_with_default_font(empty, face).unwrap().unwrap();
        let v: serde_json::Value = serde_json::from_str(&set).unwrap();
        assert_eq!(v.pointer("/profiles/defaults/font/face").unwrap(), face);
        // the user's other defaults survive, and a chosen font is never replaced
        let other = "{\"profiles\":{\"defaults\":{\"opacity\":80},\"list\":[]}}";
        let v: serde_json::Value = serde_json::from_str(&wt_with_default_font(other, face).unwrap().unwrap()).unwrap();
        assert_eq!(v.pointer("/profiles/defaults/opacity").unwrap(), 80);
        assert_eq!(wt_with_default_font(&set, face), Ok(None));
        assert!(wt_with_default_font("// comment\n{}", face).is_err());
    }

    /// Every bundled profile, parsed from the embedded assets only — deliberately
    /// NOT `profile::load_all()`, which also reads the developer's own
    /// `~/.config/8sync/profiles/` and would make this test machine-dependent.
    fn bundled() -> HashMap<String, profile::Profile> {
        let mut map = HashMap::new();
        for f in assets::Assets::iter() {
            let path = f.as_ref();
            let Some(rel) = path.strip_prefix("profiles/") else {
                continue;
            };
            if !rel.ends_with(".toml") {
                continue;
            }
            let s = assets::read(path).expect("embedded profile readable");
            let p: profile::Profile =
                toml::from_str(&s).unwrap_or_else(|e| panic!("parse {}: {}", path, e));
            map.insert(p.name.clone(), p);
        }
        map
    }

    /// THE release invariant. A teammate must never receive a maintainer's
    /// personal profile from an unattended run. `--full` and the y/N prompt both
    /// read `offered_profiles`, so covering it covers both.
    ///
    /// Regression: `--full` used to apply the `alexdev` bundle outright, which put
    /// Lian Li chassis drivers, a Vietnamese IME and DisplayLink DKMS on machines
    /// that had none of that hardware.
    #[test]
    fn offered_profiles_never_include_a_personal_one() {
        let all = bundled();
        assert!(
            all.values()
                .any(|p| p.visibility == profile::Visibility::Personal),
            "fixture is meaningless if no bundled profile is marked personal"
        );

        for name in offered_profiles(&all) {
            let p = &all[&name];
            assert_eq!(
                p.visibility,
                profile::Visibility::Community,
                "`{name}` is offered unattended but is not community-visible"
            );
            assert!(
                p.extends.is_empty(),
                "`{name}` is a bundle; bundles are never offered directly"
            );
        }
    }

    /// Pins the exact set a teammate may be offered. A new bundled profile that
    /// forgets `visibility` now defaults to Personal and simply will not appear
    /// here; one that is wrongly marked community WILL, and fails this test.
    #[test]
    fn the_offered_set_is_exactly_the_reviewed_community_profiles() {
        let mut got = offered_profiles(&bundled());
        got.sort();
        assert_eq!(
            got,
            vec!["bluetooth", "dev-stack", "nvidia", "warp"],
            "the set of profiles offered to non-maintainers changed — this is a \
             deliberate, reviewed decision, not something to update reflexively"
        );
    }

    /// Fail-closed default: an unmarked profile must NOT be offered.
    #[test]
    fn a_profile_that_forgets_visibility_is_not_offered() {
        let p: profile::Profile =
            toml::from_str("name = \"forgot\"\ndescription = \"no visibility line\"")
                .expect("parses");
        assert_eq!(p.visibility, profile::Visibility::Personal);
        let all = HashMap::from([("forgot".to_string(), p)]);
        assert!(offered_profiles(&all).is_empty());
    }

    /// A personal profile stays reachable on purpose — the fix must not have
    /// made the maintainer's own one-command setup impossible.
    #[test]
    fn personal_profiles_still_resolve_when_asked_for_by_name() {
        let all = bundled();
        let resolved = profile::resolve("alexdev", &all).expect("alexdev resolves");
        assert!(
            !resolved.packages.pacman.is_empty() || resolved.packages.fedora.is_some(),
            "explicitly requesting the personal bundle must still install something"
        );
    }
}
