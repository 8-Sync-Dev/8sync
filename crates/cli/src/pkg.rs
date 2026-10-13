// Idempotent package management.
//
// Two native backends live behind one trait: `Pacman` (Arch family, the
// original implementation) and `Dnf` (Fedora family). Everything outside this
// module goes through `pkg::install`, which picks the backend from
// `env_detect::distro_family()` and degrades to a printed notice when neither
// applies.
//
// The argv for every privileged spawn is built by a *pure* `plan_*` function so
// the exact command line is unit-testable without a package manager on the box.
// The pacman fixtures in the test module at the bottom are the Arch regression
// guard: they pin today's argv byte-for-byte so the Fedora port cannot silently
// change what Arch users get.
use anyhow::{anyhow, Result};
use std::process::{Command, Stdio};

use crate::env_detect::{distro_family, Family};
use crate::ui;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallState {
    Missing,
    UpToDate,
    Outdated,
}

/// A completed package transaction, and the handle needed to reverse it.
///
/// `id` is the backend's native transaction handle — `None` for pacman (which
/// has no transaction log we can address, so rollback is expressed as the
/// explicit `pkgs` list) and `Some(history_id)` for dnf. A *failed* dnf install
/// records no history entry at all, which is why `id` stays `None` there and
/// `Dnf::undo` must be a no-op in that case rather than guessing an id.
#[derive(Debug, Default, Clone)]
pub struct Txn {
    pub id: Option<String>,
    pub pkgs: Vec<String>,
}

// ─── pure argv planning ──────────────────────────────────────────────

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

/// Select the packages a `--needed`-style install would actually act on.
fn pick(pkgs: &[&str], states: &[InstallState], want: InstallState) -> Vec<String> {
    pkgs.iter()
        .zip(states.iter())
        .filter(|(_, s)| **s == want)
        .map(|(p, _)| p.to_string())
        .collect()
}

/// Reject package names a package manager would read as OPTIONS.
///
/// Profile TOMLs are user-authored and meant to be shared, and their package
/// lists are spliced straight into an argv that runs under `sudo`. Without this
/// a single entry beginning with `-` stops being a package and becomes a flag:
/// `--hookdir=<dir>` points alpm at attacker-written hooks whose `Exec=` runs as
/// root, and `--setopt=reposdir=<dir>` redirects dnf at an attacker's repo. The
/// planners below also emit a `--` end-of-options separator, but this is the
/// guarantee — it does not depend on any particular tool's argument parser.
///
/// A leading `-` is never a legitimate package name on any of these managers,
/// so refusing outright costs nothing and keeps the failure loud.
pub fn reject_option_like(pkgs: &[&str]) -> Result<()> {
    if let Some(bad) = pkgs.iter().find(|p| p.starts_with('-')) {
        anyhow::bail!(
            "refusing to run a package manager with `{bad}` as a package name: \
             a leading `-` would be parsed as an option, not a package"
        );
    }
    Ok(())
}

/// The exact pacman install argv for `pkgs` given their pre-install `states`.
///
/// Returns zero commands when nothing is `Missing` (today's behaviour: already
/// installed packages are skipped, never reinstalled). Kept pure so the Arch
/// command line is pinned by tests.
pub fn plan_argv(pkgs: &[&str], states: &[InstallState], noconfirm: bool) -> Vec<Vec<String>> {
    let new_pkgs = pick(pkgs, states, InstallState::Missing);
    if new_pkgs.is_empty() {
        return Vec::new();
    }
    let mut cmd = argv(&["sudo", "pacman", "-S", "--needed"]);
    if noconfirm {
        cmd.push("--noconfirm".to_string());
    }
    // `--`: everything after this is a package, never a flag. Defence in depth
    // behind `reject_option_like`. pacman only — dnf5 rejects `--` outright.
    cmd.push("--".to_string());
    cmd.extend(new_pkgs);
    vec![cmd]
}

/// The exact pacman rollback argv (`-Rns`) for packages this batch installed.
pub fn plan_rollback_argv(pkgs: &[&str], noconfirm: bool) -> Vec<Vec<String>> {
    if pkgs.is_empty() {
        return Vec::new();
    }
    let mut cmd = argv(&["sudo", "pacman", "-Rns"]);
    if noconfirm {
        cmd.push("--noconfirm".to_string());
    }
    cmd.push("--".to_string());
    cmd.extend(pkgs.iter().map(|p| p.to_string()));
    vec![cmd]
}

/// The exact AUR-helper install argv. `paru` and `yay` need *different*
/// prompt-suppression flags — passing the wrong family aborts the run, so the
/// per-helper flag set is pinned by tests too.
pub fn plan_aur_argv(
    helper: &str,
    pkgs: &[&str],
    states: &[InstallState],
    noconfirm: bool,
) -> Vec<Vec<String>> {
    let new_pkgs = pick(pkgs, states, InstallState::Missing);
    if new_pkgs.is_empty() {
        return Vec::new();
    }
    let mut cmd = argv(&[helper, "-S", "--needed"]);
    if noconfirm {
        cmd.push("--noconfirm".to_string());
        match helper {
            "paru" => cmd.push("--skipreview".to_string()),
            "yay" => {
                cmd.push("--answerdiff=None".to_string());
                cmd.push("--answeredit=None".to_string());
                cmd.push("--answerclean=None".to_string());
            }
            _ => {}
        }
        cmd.push("--mflags=--noconfirm".to_string());
    }
    cmd.extend(new_pkgs);
    vec![cmd]
}

/// The dnf command sequence: `install` for what is missing, `upgrade` for what
/// is installed-but-outdated. Up-to-date packages produce no command at all,
/// mirroring pacman's `--needed`.
pub fn plan_dnf_argv(pkgs: &[&str], states: &[InstallState], noconfirm: bool) -> Vec<Vec<String>> {
    let missing = pick(pkgs, states, InstallState::Missing);
    let outdated = pick(pkgs, states, InstallState::Outdated);
    let mut out = Vec::new();
    for (verb, set) in [("install", missing), ("upgrade", outdated)] {
        if set.is_empty() {
            continue;
        }
        let mut cmd = argv(&["sudo", "dnf", verb]);
        if noconfirm {
            cmd.push("-y".to_string());
        }
        // No `--`: dnf5 (5.4) fails with `Unknown argument "--"`. The
        // `reject_option_like` guard in `Dnf::install` is the defence here.
        cmd.extend(set);
        out.push(cmd);
    }
    out
}

// ─── backend trait ───────────────────────────────────────────────────

pub trait PkgBackend {
    /// Stable identifier used in user-facing output (`"pacman"` / `"dnf"`).
    fn name(&self) -> &'static str;
    fn state(&self, pkg: &str) -> InstallState;
    fn install(&self, pkgs: &[&str], noconfirm: bool) -> Result<Txn>;
    fn undo(&self, txn: &Txn) -> Result<()>;
}

pub struct Pacman;
pub struct Dnf;

/// Run a planned argv (`[program, args…]`) and return its exit status.
fn spawn_planned(cmd: &[String]) -> Result<std::process::ExitStatus> {
    let status = Command::new(&cmd[0]).args(&cmd[1..]).status()?;
    Ok(status)
}

impl PkgBackend for Pacman {
    fn name(&self) -> &'static str {
        "pacman"
    }

    fn state(&self, pkg: &str) -> InstallState {
        let installed = Command::new("pacman")
            .args(["-Q", pkg])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if !installed {
            return InstallState::Missing;
        }

        // Compare against repo version
        let local = run_capture(&["pacman", "-Q", pkg]).unwrap_or_default();
        let remote = run_capture(&["pacman", "-Si", pkg]).unwrap_or_default();
        let local_ver = local.split_whitespace().nth(1).unwrap_or("").to_string();
        let remote_ver = remote
            .lines()
            .find_map(|l| {
                l.strip_prefix("Version").map(|s| s.trim_start_matches(" :").trim().to_string())
            })
            .unwrap_or_default();

        if local_ver.is_empty() || remote_ver.is_empty() {
            return InstallState::UpToDate; // be conservative
        }
        if local_ver == remote_ver {
            InstallState::UpToDate
        } else {
            InstallState::Outdated
        }
    }

    /// Transactional install: snapshot which pkgs are NEW, install with
    /// `--needed`, on failure roll back any package that was successfully
    /// installed in this batch.
    ///
    /// `noconfirm` controls whether we pass `--noconfirm` (auto-yes for
    /// unattended runs).
    fn install(&self, pkgs: &[&str], noconfirm: bool) -> Result<Txn> {
        if pkgs.is_empty() {
            return Ok(Txn::default());
        }
        reject_option_like(pkgs)?;

        // 1. Snapshot pre-install state
        let states: Vec<InstallState> = pkgs.iter().map(|p| self.state(p)).collect();
        let new_pkgs: Vec<&str> = pkgs
            .iter()
            .copied()
            .zip(states.iter())
            .filter(|(_, s)| matches!(s, InstallState::Missing))
            .map(|(p, _)| p)
            .collect();
        let already: Vec<&str> = pkgs
            .iter()
            .copied()
            .zip(states.iter())
            .filter(|(_, s)| !matches!(s, InstallState::Missing))
            .map(|(p, _)| p)
            .collect();

        for p in &already {
            ui::skip(p, "already installed");
        }
        let plan = plan_argv(pkgs, &states, noconfirm);
        let Some(cmd) = plan.first() else {
            return Ok(Txn::default());
        };

        ui::step(&format!("pacman install: {}", new_pkgs.join(" ")));
        let status = spawn_planned(cmd)?;

        if !status.success() {
            // Rollback any that DID get installed in this batch
            let installed_now: Vec<&str> = new_pkgs
                .iter()
                .copied()
                .filter(|p| !matches!(self.state(p), InstallState::Missing))
                .collect();
            self.rollback(&installed_now, noconfirm);
            return Err(anyhow!("pacman install failed (rolled back)"));
        }
        Ok(Txn { id: None, pkgs: new_pkgs.iter().map(|p| p.to_string()).collect() })
    }

    /// pacman has no addressable transaction log, so undo is the explicit
    /// `-Rns` of everything the transaction recorded.
    fn undo(&self, txn: &Txn) -> Result<()> {
        let pkgs: Vec<&str> = txn.pkgs.iter().map(|s| s.as_str()).collect();
        if pkgs.is_empty() {
            ui::skip("pacman undo", "transaction installed nothing");
            return Ok(());
        }
        self.rollback(&pkgs, true);
        Ok(())
    }
}

impl Pacman {
    /// Best-effort `-Rns` of `pkgs`. Failure here is reported, never fatal —
    /// the caller is already on an error path.
    fn rollback(&self, pkgs: &[&str], noconfirm: bool) {
        if pkgs.is_empty() {
            return;
        }
        ui::warn(&format!("install failed — rolling back: {}", pkgs.join(" ")));
        for cmd in plan_rollback_argv(pkgs, noconfirm) {
            let _ = spawn_planned(&cmd);
        }
    }
}

impl PkgBackend for Dnf {
    fn name(&self) -> &'static str {
        "dnf"
    }

    /// Presence via `rpm -q` (cheap, no metadata). When present, probe the
    /// *cached* metadata for a pending upgrade — `-C` keeps this offline, and
    /// an empty/absent cache conservatively reports `UpToDate`, matching
    /// `Pacman::state`'s behaviour when the repo version is unknown.
    fn state(&self, pkg: &str) -> InstallState {
        if !rpm_installed(pkg) {
            return InstallState::Missing;
        }

        let upgrades = run_capture(&["dnf", "-q", "-C", "list", "--upgrades", pkg])
            .unwrap_or_default();
        // dnf prints `name.arch  version  repo`; match on the `name.` prefix so
        // a substring like `git-core` never counts as `git`.
        let pending = upgrades
            .lines()
            .any(|l| l.trim_start().starts_with(&format!("{pkg}.")));
        if pending {
            InstallState::Outdated
        } else {
            InstallState::UpToDate
        }
    }

    /// `dnf install` the missing packages, `dnf upgrade` the outdated ones.
    ///
    /// On success the dnf history id of the LAST transaction is recorded in
    /// `Txn.id` so `undo` can reverse it. On failure dnf writes **no** history
    /// entry, so `Txn.id` stays `None` and there is nothing to undo — dnf's own
    /// transaction is already atomic, unlike pacman's.
    fn install(&self, pkgs: &[&str], noconfirm: bool) -> Result<Txn> {
        if pkgs.is_empty() {
            return Ok(Txn::default());
        }
        reject_option_like(pkgs)?;

        let states: Vec<InstallState> = pkgs.iter().map(|p| self.state(p)).collect();
        let touched: Vec<String> = pkgs
            .iter()
            .zip(states.iter())
            .filter(|(_, s)| !matches!(s, InstallState::UpToDate))
            .map(|(p, _)| p.to_string())
            .collect();

        for (p, s) in pkgs.iter().zip(states.iter()) {
            if matches!(s, InstallState::UpToDate) {
                ui::skip(p, "already installed");
            }
        }

        let plan = plan_dnf_argv(pkgs, &states, noconfirm);
        if plan.is_empty() {
            return Ok(Txn::default());
        }

        // `plan` may hold TWO transactions (install missing, then upgrade
        // outdated). Each dnf transaction is atomic on its own, but the PLAN is
        // not: if the upgrade fails after the install committed, the install is
        // already in the history and must be reverted, or the caller is left
        // with a half-applied batch and an Err.
        let mut committed: Option<String> = None;
        for cmd in &plan {
            // argv is ["sudo", "dnf", <verb>, ("-y")?, pkgs…] — report the verb
            // and the packages, not the assume-yes flag.
            let names: Vec<&str> = cmd[3..].iter().map(|s| s.as_str()).filter(|s| *s != "-y").collect();
            ui::step(&format!("dnf {}: {}", cmd[2], names.join(" ")));
            let status = spawn_planned(cmd)?;
            if !status.success() {
                // The failing transaction itself changed nothing. Anything an
                // EARLIER step in this plan committed must be rolled back.
                if committed.is_some() {
                    let partial = Txn { id: committed, pkgs: touched };
                    if let Err(e) = self.undo(&partial) {
                        ui::err(&format!("rollback failed: {e}"));
                    }
                }
                return Err(anyhow!("dnf {} failed", cmd[2]));
            }
            committed = last_history_id();
        }

        Ok(Txn { id: committed, pkgs: touched })
    }

    fn undo(&self, txn: &Txn) -> Result<()> {
        let Some(id) = txn.id.as_deref() else {
            ui::skip(
                "dnf undo",
                "no transaction id recorded — a failed dnf install writes no history entry",
            );
            return Ok(());
        };
        ui::warn(&format!("reverting dnf transaction {id}"));
        run_loud("sudo", &["dnf", "history", "undo", "-y", id])
    }
}

/// Extract the newest transaction id from `dnf history list` output.
///
/// dnf5 prints a bare column header (`ID Command line …`) followed by rows in
/// newest-first order, with no separator rule — so the first row whose leading
/// token is a number is the transaction we just created. Kept pure because
/// this format is the one thing most likely to shift under us.
fn parse_history_id(out: &str) -> Option<String> {
    out.lines()
        .map(str::trim)
        .find_map(|l| l.split_whitespace().next().filter(|t| t.parse::<u64>().is_ok()))
        .map(|s| s.to_string())
}

/// The id of the most recent dnf transaction. `None` when dnf is absent or the
/// history log is empty.
fn last_history_id() -> Option<String> {
    parse_history_id(&run_capture(&["dnf", "history", "list"])?)
}

/// `rpm -q <pkg>` — is this rpm installed? Cheap, offline, no metadata read.
pub fn rpm_installed(pkg: &str) -> bool {
    Command::new("rpm")
        .args(["-q", pkg])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// `VERSION_ID` from `/etc/os-release` (`"44"` on Fedora 44). Needed to name
/// the release-specific rpmfusion packages.
fn os_version_id() -> Option<String> {
    let s = std::fs::read_to_string("/etc/os-release").ok()?;
    s.lines().find_map(|l| {
        l.trim().strip_prefix("VERSION_ID=").map(|v| v.trim_matches('"').to_string())
    })
}

/// Enable the RPM Fusion free + nonfree repos (idempotent).
///
/// Fedora legally cannot ship patent-encumbered codecs and several drivers;
/// RPM Fusion is the long-standing community overlay that does. Unlike a COPR
/// this is not user-namespaced, so it needs no allowlist — but it IS a
/// third-party root-level package source, so each half is `rpm -q`-guarded and
/// installed by its official release rpm rather than a hand-written .repo file.
pub fn ensure_rpmfusion() -> Result<()> {
    let ver = os_version_id()
        .ok_or_else(|| anyhow!("no VERSION_ID in /etc/os-release — cannot pick rpmfusion release"))?;

    let mut urls: Vec<String> = Vec::new();
    for kind in ["free", "nonfree"] {
        let rel = format!("rpmfusion-{kind}-release");
        if rpm_installed(&rel) {
            ui::skip(&rel, "present");
            continue;
        }
        urls.push(format!(
            "https://mirrors.rpmfusion.org/{kind}/fedora/rpmfusion-{kind}-release-{ver}.noarch.rpm"
        ));
    }
    if urls.is_empty() {
        return Ok(());
    }

    ui::step(&format!("rpmfusion release packages (Fedora {ver})"));
    let mut args: Vec<&str> = vec!["dnf", "install", "-y"];
    args.extend(urls.iter().map(|s| s.as_str()));
    run_loud("sudo", &args)
}

// ─── COPR (third-party repos) ────────────────────────────────────────

/// COPR repos this harness is allowed to enable without an explicit override.
///
/// A COPR is an *unreviewed* third-party build service: enabling one grants
/// its owner root-equivalent package delivery onto the machine. Profiles are
/// data, and data must not be able to name an arbitrary repo — so the set is
/// pinned here, in code, and anything else is refused (D-M0-8).
pub const COPR_ALLOWLIST: &[&str] =
    &["codifryed/CoolerControl", "sgtaziz/lian-li-linux", "crashdummy/Displaylink"];

/// Whether `spec` may be enabled. Pure; the allowlist compare is
/// case-insensitive because COPR itself is.
pub fn copr_allowed(spec: &str, allow_unlisted: bool) -> bool {
    allow_unlisted || COPR_ALLOWLIST.iter().any(|a| a.eq_ignore_ascii_case(spec.trim()))
}

/// Whether this dnf build can manage COPR repos. On Fedora 44 the `copr`
/// subcommand ships in `dnf5-plugins`, *not* `dnf-plugins-core`, so presence
/// must be probed rather than assumed from the dnf version.
pub fn copr_supported() -> bool {
    Command::new("dnf")
        .args(["copr", "--help"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Enable COPR repo `spec` (`owner/project`).
///
/// Refuses anything outside [`COPR_ALLOWLIST`] unless `allow_unlisted`.
/// Degrades to a printed skip (not an error) when the `copr` subcommand is
/// unavailable, so a profile that merely *prefers* a COPR still applies.
pub fn copr_enable(spec: &str, allow_unlisted: bool) -> Result<()> {
    let spec = spec.trim();
    if !copr_allowed(spec, allow_unlisted) {
        return Err(anyhow!(
            "refusing COPR `{spec}`: not in the allowlist ({}) — pass allow_unlisted to override",
            COPR_ALLOWLIST.join(", ")
        ));
    }
    if !copr_supported() {
        ui::skip(spec, "`dnf copr` unavailable (install dnf5-plugins) — skipping COPR");
        return Ok(());
    }
    ui::step(&format!("copr enable {spec}"));
    run_loud("sudo", &["dnf", "-y", "copr", "enable", spec])
}

/// Replace installed package `from` with `to`, allowing dependent packages to
/// be erased (rpmfusion's `ffmpeg` conflicts with Fedora's `ffmpeg-free`, so
/// there is no non-erasing path).
///
/// Prints the erase set — `from` plus every installed package that requires it
/// — before running, because `--allowerasing` is the one dnf flag that can
/// remove software the user never named.
pub fn swap(from: &str, to: &str) -> Result<()> {
    ui::warn(&format!("dnf swap will ERASE `{from}` and install `{to}` (--allowerasing)"));
    match run_capture(&["rpm", "-q", "--whatrequires", from]) {
        Some(deps) => {
            let deps: Vec<&str> = deps.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
            if deps.is_empty() {
                ui::info(&format!("erase set: {from} (nothing installed requires it)"));
            } else {
                ui::warn(&format!("erase set: {from} + dependents: {}", deps.join(" ")));
            }
        }
        // `rpm -q --whatrequires` exits non-zero when nothing requires `from`.
        None => ui::info(&format!("erase set: {from}")),
    }
    run_loud("sudo", &["dnf", "swap", "-y", "--allowerasing", from, to])
}

// ─── dispatch ────────────────────────────────────────────────────────

/// The backend for an explicitly given family. Pure dispatch, no I/O — this is
/// the seam `backend()` and the tests both go through.
pub fn backend_for(family: Family) -> Option<Box<dyn PkgBackend>> {
    match family {
        Family::Arch => Some(Box::new(Pacman)),
        Family::Fedora => Some(Box::new(Dnf)),
        Family::Other => None,
    }
}

/// The native backend for this machine, or `None` on a distro we have no
/// package manager for. Side-effect free: one `/etc/os-release` read, no spawn.
pub fn backend() -> Option<Box<dyn PkgBackend>> {
    backend_for(distro_family())
}

/// Install `pkgs` through whichever native backend this machine has.
///
/// This is the migration target for every caller outside this module. On a
/// distro with no backend it prints the same manual-install notice the old
/// `platform::install_core_pkg` fallback printed and returns `Ok(())` — the
/// harness core installs via curl/cargo there.
pub fn install(label: &str, pkgs: &[&str], noconfirm: bool) -> Result<()> {
    match backend() {
        Some(b) => b.install(pkgs, noconfirm).map(|_| ()),
        None => {
            crate::platform::no_pkg_manager_notice(label);
            Ok(())
        }
    }
}

// ─── reclaim (used by `8sync clean`) ─────────────────────────────────

/// Run `args`, or just print it when `dry`. Best-effort: these are reclaim
/// steps, so a failure is reported by the tool itself and never fatal.
fn maybe_run(dry: bool, args: &[&str]) {
    if dry {
        ui::info(&format!("would: {}", args.join(" ")));
        return;
    }
    ui::info(&format!("$ {}", args.join(" ")));
    let _ = Command::new(args[0]).args(&args[1..]).status();
}

/// Reclaim the native package manager's on-disk caches (downloaded packages,
/// AUR build trees, stale repo metadata).
///
/// Every tool involved is family-specific — `paccache` ships in
/// `pacman-contrib`, `paru -Sc`/`yay -Sc` only exist on Arch, `dnf clean all`
/// only on Fedora — so the whole step is gated on the distro family rather
/// than probed tool-by-tool.
pub fn clean_cache(dry: bool) {
    match distro_family() {
        Family::Arch => {
            ui::step("pacman package cache");
            if which::which("paccache").is_ok() {
                maybe_run(dry, &["sudo", "paccache", "-rk2"]); // keep 2 newest of installed pkgs
                maybe_run(dry, &["sudo", "paccache", "-ruk0"]); // drop ALL cached uninstalled pkgs
            } else {
                ui::skip("paccache", "pacman-contrib not installed");
            }
            // AUR helper build/clone cache
            if which::which("paru").is_ok() {
                ui::step("paru cache");
                maybe_run(dry, &["paru", "-Sc", "--noconfirm"]);
            } else if which::which("yay").is_ok() {
                ui::step("yay cache");
                maybe_run(dry, &["yay", "-Sc", "--noconfirm"]);
            }
        }
        Family::Fedora => {
            // dnf keeps downloaded rpms + repo metadata under /var/cache/libdnf5;
            // `clean all` drops both and they are re-fetched on demand.
            ui::step("dnf package cache");
            maybe_run(dry, &["sudo", "dnf", "clean", "all"]);
        }
        Family::Other => {
            ui::skip("package cache", "no native package manager on this distro")
        }
    }
}

/// Remove packages that were pulled in as dependencies and are no longer
/// required by anything.
///
/// Arch has to compute the set itself (`pacman -Qtdq`) and hand it to `-Rns`;
/// dnf tracks the "user installed?" bit in its own db, so `autoremove` is the
/// direct equivalent.
pub fn remove_orphans(dry: bool) {
    match distro_family() {
        Family::Arch => {
            let orphans: Vec<String> = run_capture(&["pacman", "-Qtdq"])
                .unwrap_or_default()
                .lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if orphans.is_empty() {
                ui::skip("orphans", "none");
                return;
            }
            ui::info(&format!("orphans ({}): {}", orphans.len(), orphans.join(" ")));
            if dry {
                ui::info("would: sudo pacman -Rns <orphans>");
                return;
            }
            // Interactive confirm — `-Rns` is removal; let pacman prompt.
            let mut args = vec!["sudo", "pacman", "-Rns"];
            args.extend(orphans.iter().map(|o| o.as_str()));
            match Command::new(args[0]).args(&args[1..]).status() {
                Ok(s) if s.success() => ui::ok(&format!("removed {} orphan(s)", orphans.len())),
                _ => ui::warn("orphan removal skipped/failed"),
            }
        }
        Family::Fedora => {
            if dry {
                ui::info("would: sudo dnf autoremove -y");
                return;
            }
            match Command::new("sudo").args(["dnf", "autoremove", "-y"]).status() {
                Ok(s) if s.success() => ui::ok("dnf autoremove complete"),
                _ => ui::warn("orphan removal skipped/failed"),
            }
        }
        Family::Other => ui::skip("orphans", "no native package manager on this distro"),
    }
}

// ─── legacy free functions (thin wrappers) ───────────────────────────

/// Check pacman state for a single package
pub fn pacman_state(pkg: &str) -> InstallState {
    Pacman.state(pkg)
}

/// Transactional pacman install with rollback. Prefer [`install`] in new code.
pub fn pacman_install_safe(pkgs: &[&str], noconfirm: bool) -> Result<()> {
    Pacman.install(pkgs, noconfirm).map(|_| ())
}

/// Transactional AUR install via `helper` (paru/yay) with rollback on failure.
///
/// Not part of [`PkgBackend`]: the AUR is an Arch-only concept with no Fedora
/// counterpart, so it stays a free function rather than a trait method that
/// `Dnf` would have to stub out.
pub fn aur_install_safe(helper: &str, pkgs: &[&str], noconfirm: bool) -> Result<()> {
    if pkgs.is_empty() {
        return Ok(());
    }
    reject_option_like(pkgs)?;

    let states: Vec<InstallState> = pkgs.iter().map(|p| pacman_state(p)).collect();
    let new_pkgs: Vec<&str> = pkgs
        .iter()
        .copied()
        .zip(states.iter())
        .filter(|(_, s)| matches!(s, InstallState::Missing))
        .map(|(p, _)| p)
        .collect();
    let already: Vec<&str> = pkgs
        .iter()
        .copied()
        .zip(states.iter())
        .filter(|(_, s)| !matches!(s, InstallState::Missing))
        .map(|(p, _)| p)
        .collect();

    for p in &already {
        ui::skip(p, "already installed");
    }
    let plan = plan_aur_argv(helper, pkgs, &states, noconfirm);
    let Some(planned) = plan.first() else {
        return Ok(());
    };

    ui::step(&format!("{} install: {}", helper, new_pkgs.join(" ")));
    let mut cmd = Command::new(&planned[0]);
    cmd.args(&planned[1..]);

    if noconfirm {
        // paru/yay still prompt for provider choice (e.g. "foo vs foo-git")
        // and for PKGBUILD review; the flags above suppress both. Pipe a stream
        // of newlines to stdin so any remaining provider-choice prompt accepts
        // its default (1) without blocking. `yes ""` runs forever; paru only
        // reads what it needs.
        cmd.stdin(Stdio::piped());
        let mut child = cmd.spawn()?;
        if let Some(stdin) = child.stdin.as_mut() {
            use std::io::Write;
            let _ = stdin.write_all(b"\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n");
        }
        let status = child.wait()?;
        return aur_install_finish(helper, &new_pkgs, status, noconfirm);
    }
    let status = cmd.status()?;
    aur_install_finish(helper, &new_pkgs, status, noconfirm)
}

fn aur_install_finish(
    helper: &str,
    new_pkgs: &[&str],
    status: std::process::ExitStatus,
    noconfirm: bool,
) -> Result<()> {
    if !status.success() {
        let installed_now: Vec<&str> = new_pkgs
            .iter()
            .copied()
            .filter(|p| !matches!(pacman_state(p), InstallState::Missing))
            .collect();
        Pacman.rollback(&installed_now, noconfirm);
        return Err(anyhow!("{} install failed (rolled back)", helper));
    }
    Ok(())
}

fn run_capture(cmd: &[&str]) -> Option<String> {
    let out = Command::new(cmd[0]).args(&cmd[1..]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Run a shell command, printing it first
pub fn run_loud(cmd: &str, args: &[&str]) -> Result<()> {
    ui::info(&format!("$ {} {}", cmd, args.join(" ")));
    let mut c = Command::new(cmd);
    // Started from PowerShell 7, Windows PowerShell 5.1 inherits pwsh's module
    // path and loses built-ins like Get-FileHash, which official installers
    // (claude.ai/install.ps1) need. Without the variable it rebuilds its own.
    if cmd == "powershell" {
        c.env_remove("PSModulePath");
    }
    let status = c.args(args).status()?;
    if !status.success() {
        return Err(anyhow!("command failed: {}", cmd));
    }
    Ok(())
}

/// Ensure `yay` is installed (idempotent). Bootstraps from AUR via makepkg if
/// missing. Distinct from the general `aur_helper()` discovery in env_detect:
/// some profiles need yay *specifically*, even if paru is already present.
pub fn ensure_yay() -> Result<()> {
    if which::which("yay").is_ok() {
        ui::skip("yay", "present");
        return Ok(());
    }
    ui::step("yay (AUR helper required for this profile)");
    pacman_install_safe(&["git", "base-devel"], true)?;
    let cmd = "cd /tmp && rm -rf yay-bootstrap && \
        git clone https://aur.archlinux.org/yay-bin.git yay-bootstrap && \
        cd yay-bootstrap && makepkg -si --noconfirm && \
        cd .. && rm -rf yay-bootstrap";
    run_loud("sh", &["-c", cmd])?;
    if which::which("yay").is_err() {
        return Err(anyhow!("yay bootstrap finished but `yay` is not on PATH"));
    }
    ui::ok("yay installed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::InstallState::{Missing, Outdated, UpToDate};
    use super::*;

    fn v(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    // ── Arch regression fixture (AC-10) ──
    // These pin the pacman/AUR command lines exactly as they were before the
    // Fedora port, plus the `--` end-of-options separator added in v0.54.0.
    // Any other change here is an Arch behaviour change.

    #[test]
    fn pacman_install_argv_skips_installed() {
        let pkgs = ["git", "ripgrep", "fd"];
        let states = [Missing, UpToDate, Missing];
        assert_eq!(
            plan_argv(&pkgs, &states, true),
            vec![v(&[
                "sudo",
                "pacman",
                "-S",
                "--needed",
                "--noconfirm",
                "--",
                "git",
                "fd"
            ])]
        );
    }

    #[test]
    fn pacman_install_argv_without_noconfirm() {
        assert_eq!(
            plan_argv(&["git"], &[Missing], false),
            vec![v(&["sudo", "pacman", "-S", "--needed", "--", "git"])]
        );
    }

    /// `Outdated` is NOT reinstalled by the pacman path today — only `Missing`
    /// is. Nothing to do means no spawn at all.
    #[test]
    fn pacman_install_argv_nothing_to_do() {
        assert!(plan_argv(&["git", "fd"], &[UpToDate, Outdated], true).is_empty());
        assert!(plan_argv(&[], &[], true).is_empty());
    }

    #[test]
    fn pacman_rollback_argv() {
        assert_eq!(
            plan_rollback_argv(&["git", "fd"], true),
            vec![v(&["sudo", "pacman", "-Rns", "--noconfirm", "--", "git", "fd"])]
        );
        assert_eq!(
            plan_rollback_argv(&["git"], false),
            vec![v(&["sudo", "pacman", "-Rns", "--", "git"])]
        );
        assert!(plan_rollback_argv(&[], true).is_empty());
    }

    #[test]
    fn aur_argv_paru_uses_skipreview() {
        assert_eq!(
            plan_aur_argv("paru", &["foo"], &[Missing], true),
            vec![v(&[
                "paru",
                "-S",
                "--needed",
                "--noconfirm",
                "--skipreview",
                "--mflags=--noconfirm",
                "foo"
            ])]
        );
    }

    #[test]
    fn aur_argv_yay_uses_answer_family() {
        assert_eq!(
            plan_aur_argv("yay", &["foo"], &[Missing], true),
            vec![v(&[
                "yay",
                "-S",
                "--needed",
                "--noconfirm",
                "--answerdiff=None",
                "--answeredit=None",
                "--answerclean=None",
                "--mflags=--noconfirm",
                "foo"
            ])]
        );
    }

    #[test]
    fn aur_argv_interactive_has_no_suppression_flags() {
        assert_eq!(
            plan_aur_argv("paru", &["foo"], &[Missing], false),
            vec![v(&["paru", "-S", "--needed", "foo"])]
        );
    }

    // ── dnf ──

    #[test]
    fn dnf_argv_splits_install_and_upgrade() {
        let pkgs = ["gcc", "git", "fd"];
        let states = [Missing, Outdated, UpToDate];
        assert_eq!(
            plan_dnf_argv(&pkgs, &states, true),
            vec![
                v(&["sudo", "dnf", "install", "-y", "gcc"]),
                v(&["sudo", "dnf", "upgrade", "-y", "git"]),
            ]
        );
    }

    // ── argument-injection guard (SEC-003) ──

    /// A package list is profile data, and profiles are shareable. A name that
    /// starts with `-` becomes a package-manager FLAG under sudo: `--hookdir=`
    /// gives alpm attacker-written root hooks, `--setopt=reposdir=` repoints dnf.
    #[test]
    fn option_like_package_names_are_refused() {
        for bad in [
            "--hookdir=/tmp/evil",
            "-Rns",
            "--setopt=reposdir=/tmp/evil",
            "-",
        ] {
            assert!(
                reject_option_like(&["git", bad]).is_err(),
                "`{bad}` must be refused as a package name"
            );
        }
    }

    #[test]
    fn ordinary_package_names_are_accepted() {
        // Interior and trailing dashes are legitimate and must keep working.
        assert!(reject_option_like(&["git", "xorg-x11-drv-nvidia", "c++"]).is_ok());
        assert!(reject_option_like(&[]).is_ok());
    }

    /// Even if a name slipped past the guard, `--` stops pacman reading it as
    /// an option. (dnf5 rejects `--`, so dnf relies on the guard alone.)
    #[test]
    fn every_pacman_planner_emits_end_of_options() {
        let plans = [
            plan_argv(&["git"], &[Missing], true),
            plan_rollback_argv(&["git"], true),
        ];
        for plan in plans {
            let cmd = plan.first().expect("planner produced a command");
            let sep = cmd.iter().position(|a| a == "--").expect("`--` present");
            let pkg = cmd.iter().position(|a| a == "git").expect("package present");
            assert!(sep < pkg, "`--` must precede the package list in {cmd:?}");
        }
    }

    #[test]
    fn dnf_argv_nothing_to_do() {
        assert!(plan_dnf_argv(&["git"], &[UpToDate], true).is_empty());
    }

    /// Verbatim dnf5 5.4.1.0 output: a bare column header, then newest-first
    /// rows with no separator rule.
    #[test]
    fn history_id_is_the_first_numeric_row() {
        let out = "ID Command line                          Date and time       Action(s) Altered\n\
                   18 dnf install -y gcc                    2026-08-08 15:56:20                 7\n\
                   17 dnf install -y lian-li-linux          2026-08-08 13:07:27                 1\n";
        assert_eq!(parse_history_id(out).as_deref(), Some("18"));
    }

    /// An empty log (or a dnf that failed) must not yield a bogus id — undo
    /// depends on `None` meaning "nothing to revert".
    #[test]
    fn history_id_none_without_data_rows() {
        assert_eq!(parse_history_id("ID Command line Date and time Action(s) Altered\n"), None);
        assert_eq!(parse_history_id(""), None);
    }

    // ── COPR allowlist (D-M0-8) ──

    #[test]
    fn copr_refuses_unlisted_spec() {
        let err = copr_enable("attacker/backdoor", false).unwrap_err().to_string();
        assert!(err.contains("refusing COPR"), "unexpected error: {err}");
        assert!(!copr_allowed("attacker/backdoor", false));
    }

    #[test]
    fn copr_allows_listed_spec_and_explicit_override() {
        assert!(copr_allowed("codifryed/CoolerControl", false));
        assert!(copr_allowed("sgtaziz/lian-li-linux", false));
        // COPR names are case-insensitive.
        assert!(copr_allowed("codifryed/coolercontrol", false));
        // Escape hatch, but only when the caller asks for it explicitly.
        assert!(copr_allowed("attacker/backdoor", true));
    }

    #[test]
    fn dnf_undo_without_txn_id_is_a_noop() {
        // A failed dnf install records no history entry; undo must not guess.
        assert!(Dnf.undo(&Txn::default()).is_ok());
    }
}
