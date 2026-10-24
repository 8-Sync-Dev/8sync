//! Cross-platform OS abstraction.
//!
//! `8sync` began as a CachyOS/Arch-only harness; this module is the seam that
//! lets the AI-harness core run on other Linux distros, macOS and Windows too.
//! It answers three questions the rest of the CLI needs:
//!   1. **Which OS are we on?** (`os()` — compile-time constant per target).
//!   2. **How do I install one core package?** (`core_route` + `install_core_pkg`
//!      with a `CorePkg` naming it in each manager's namespace). On Linux the
//!      backend comes from `pkg::backend()` (`pacman` on the Arch family, `dnf`
//!      on the Fedora family), so distro dispatch lives in exactly one place;
//!      macOS uses `brew` and Windows `winget`.
//!   3. **How do I run a command periodically?** (`install_timer` /
//!      `remove_timer` — systemd user timer on Linux, launchd LaunchAgent on
//!      macOS, Scheduled Task on Windows).
//!
//! Everything here compiles on every target (no `std::os::unix`); the per-OS
//! branches dispatch at runtime via `os()`, so one binary body is correct
//! everywhere and the wrong-OS branch simply never executes.
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};

use crate::env_detect::Family;
use crate::ui;

/// Only one variant is ever constructed per compiled target (via `os()`'s
/// cfg-selection), so the others read as dead code on any given build.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    Macos,
    Windows,
    Other,
}

/// The OS this binary was compiled for (compile-time constant).
pub const fn os() -> Os {
    #[cfg(target_os = "linux")]
    {
        Os::Linux
    }
    #[cfg(target_os = "macos")]
    {
        Os::Macos
    }
    #[cfg(target_os = "windows")]
    {
        Os::Windows
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        Os::Other
    }
}

/// Human name for messages.
pub fn os_name() -> &'static str {
    match os() {
        Os::Linux => "Linux",
        Os::Macos => "macOS",
        Os::Windows => "Windows",
        Os::Other => "this OS",
    }
}

/// Guard for Linux-only verbs (`sec`, `bt`, `clean`): on a non-Linux target,
/// print a clear one-liner and return `false` so the caller can bail cleanly
/// instead of shelling out to tools that don't exist there.
pub fn require_linux(verb: &str, why: &str) -> bool {
    if os() == Os::Linux {
        return true;
    }
    ui::warn(&format!("`8sync {verb}` is Linux-only — {why}"));
    ui::info(&format!("(no-op on {})", os_name()));
    false
}

// ─── package manager ─────────────────────────────────────────────────

/// One package's id in each package manager's namespace. They genuinely differ
/// (`github-cli` on pacman vs `gh` on dnf/brew, `GitHub.cli` on winget), so the
/// call site names all four rather than passing positional strings nobody can
/// tell apart at a glance.
#[derive(Debug, Clone, Copy)]
pub struct CorePkg {
    pub arch: &'static str,
    pub fedora: &'static str,
    pub brew: &'static str,
    pub winget: &'static str,
}

/// Which install route [`install_core_pkg`] takes. Split out from the spawn so
/// the routing decision — including the manual-install fallback on a distro
/// with no native backend — is testable without a package manager present.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreRoute {
    /// A native Linux backend handles it; carries the package id to install.
    Native(&'static str),
    Brew,
    Winget,
    /// Nothing can install this — print the manual-install notice.
    Manual,
}

pub fn core_route(target: Os, family: Family, names: CorePkg) -> CoreRoute {
    match target {
        Os::Linux => match family {
            Family::Arch => CoreRoute::Native(names.arch),
            Family::Fedora => CoreRoute::Native(names.fedora),
            Family::Other => CoreRoute::Manual,
        },
        Os::Macos => CoreRoute::Brew,
        Os::Windows => CoreRoute::Winget,
        Os::Other => CoreRoute::Manual,
    }
}

/// Install a package by its per-manager name via the native package manager.
/// No-op with a note when the manager is unavailable.
pub fn install_core_pkg(label: &str, names: CorePkg) -> Result<()> {
    match core_route(os(), crate::env_detect::distro_family(), names) {
        CoreRoute::Native(pkg) => crate::pkg::install(label, &[pkg], true),
        CoreRoute::Brew if which::which("brew").is_ok() => {
            crate::pkg::run_loud("brew", &["install", names.brew])
        }
        CoreRoute::Winget if which::which("winget").is_ok() => crate::pkg::run_loud(
            "winget",
            &[
                "install",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "-e",
                "--id",
                names.winget,
            ],
        ),
        _ => {
            no_pkg_manager_notice(label);
            Ok(())
        }
    }
}

/// The single manual-install notice, shared by every no-backend path so the
/// wording cannot drift between `platform` and `pkg`.
pub(crate) fn no_pkg_manager_notice(label: &str) {
    ui::warn(&format!(
        "no native package manager on {} — install `{label}` manually",
        os_name()
    ));
}

// ─── periodic timer ──────────────────────────────────────────────────

/// A periodic background job: run `exec_args` (relative to the current exe)
/// every `every` (`10m`/`1h`/`30s`/bare-seconds). Backed by systemd (Linux),
/// launchd (macOS), or Scheduled Tasks (Windows).
pub struct TimerSpec<'a> {
    /// Bare identifier, e.g. `harness-up` → unit `8sync-harness-up`.
    pub name: &'a str,
    pub description: &'a str,
    /// Args passed to the current `8sync` exe, e.g. `["harness", "up"]`.
    pub exec_args: &'a [&'a str],
    /// Working directory for the run (project root for `harness up`).
    pub workdir: Option<&'a Path>,
    pub every: &'a str,
    /// Linux only: bound the unit to its own cgroup so a heavy tick can't OOM
    /// the machine (the `harness up` trail rebuild can use a lot of RAM).
    pub memory_bounded: bool,
    pub timeout_secs: u64,
}

/// Parse a human duration (`10m`, `1h`, `30s`, or bare seconds) into seconds.
pub fn parse_dur_secs(s: &str) -> u64 {
    let s = s.trim();
    let (num, mult) = if let Some(v) = s.strip_suffix('h') {
        (v, 3600)
    } else if let Some(v) = s.strip_suffix('m') {
        (v, 60)
    } else if let Some(v) = s.strip_suffix("min") {
        (v, 60)
    } else if let Some(v) = s.strip_suffix('s') {
        (v, 1)
    } else {
        (s, 1)
    };
    num.trim().parse::<u64>().unwrap_or(0).saturating_mul(mult).max(1)
}

/// Install (or, when `spec.every` is unused, refresh) the periodic timer.
pub fn install_timer(spec: &TimerSpec) -> Result<()> {
    let exe = std::env::current_exe().context("current_exe")?;
    match os() {
        Os::Linux => install_timer_systemd(spec, &exe),
        Os::Macos => install_timer_launchd(spec, &exe),
        Os::Windows => install_timer_schtasks(spec, &exe),
        Os::Other => {
            ui::warn(&format!("periodic timers unsupported on {}", os_name()));
            Ok(())
        }
    }
}

/// Remove the periodic timer named `name` (idempotent, best-effort).
pub fn remove_timer(name: &str) -> Result<()> {
    match os() {
        Os::Linux => {
            let unit = format!("8sync-{name}.timer");
            let dir = home()?.join(".config/systemd/user");
            let _ = Command::new("systemctl")
                .args(["--user", "disable", "--now", &unit])
                .status();
            let _ = std::fs::remove_file(dir.join(format!("8sync-{name}.service")));
            let _ = std::fs::remove_file(dir.join(format!("8sync-{name}.timer")));
            let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).status();
        }
        Os::Macos => {
            let label = format!("dev.8sync.{name}");
            let plist = launch_agents_dir()?.join(format!("{label}.plist"));
            let _ = Command::new("launchctl").args(["unload", "-w"]).arg(&plist).status();
            let _ = std::fs::remove_file(&plist);
        }
        Os::Windows => {
            let _ = Command::new("schtasks")
                .args(["/Delete", "/TN", &format!("8sync\\{name}"), "/F"])
                .status();
        }
        Os::Other => {}
    }
    ui::ok("timer removed");
    Ok(())
}

fn home() -> Result<PathBuf> {
    dirs::home_dir().context("no HOME")
}

fn launch_agents_dir() -> Result<PathBuf> {
    Ok(home()?.join("Library/LaunchAgents"))
}

fn install_timer_systemd(spec: &TimerSpec, exe: &Path) -> Result<()> {
    let unit_dir = home()?.join(".config/systemd/user");
    std::fs::create_dir_all(&unit_dir)?;
    let svc = unit_dir.join(format!("8sync-{}.service", spec.name));
    let timer = unit_dir.join(format!("8sync-{}.timer", spec.name));
    let unit = format!("8sync-{}.timer", spec.name);

    let exec = format!("{} {}", exe.display(), spec.exec_args.join(" "));
    let wd_line = match spec.workdir {
        Some(w) => format!("WorkingDirectory={}\n", w.display()),
        None => String::new(),
    };
    let bounds = if spec.memory_bounded {
        "Nice=15\nCPUWeight=10\nIOWeight=10\nMemoryHigh=2G\nMemoryMax=4G\nMemorySwapMax=512M\nOOMPolicy=stop\n"
    } else {
        ""
    };
    let svc_body = format!(
        "[Unit]\nDescription={desc}\n\n\
         [Service]\nType=oneshot\nTimeoutStartSec={to}\n\
         {wd}ExecStart={exec}\n{bounds}",
        desc = spec.description,
        to = spec.timeout_secs,
        wd = wd_line,
        exec = exec,
        bounds = bounds,
    );
    let timer_body = format!(
        "[Unit]\nDescription={desc} timer (every {dur})\n\n\
         [Timer]\nOnBootSec=5min\nOnUnitActiveSec={dur}\nPersistent=true\n\n\
         [Install]\nWantedBy=timers.target\n",
        desc = spec.description,
        dur = spec.every,
    );
    std::fs::write(&svc, svc_body)?;
    std::fs::write(&timer, timer_body)?;
    ui::ok(&format!("wrote {} + .timer", svc.display()));

    let _ = Command::new("systemctl").args(["--user", "daemon-reload"]).status();
    let st = Command::new("systemctl")
        .args(["--user", "enable", "--now", &unit])
        .status();
    match st {
        Ok(s) if s.success() => {
            ui::ok(&format!("timer enabled — every {}", spec.every));
            ui::info(&format!("status: systemctl --user list-timers {unit}"));
            ui::info("note: boot-time runs need `loginctl enable-linger $USER`");
        }
        _ => ui::warn("could not enable timer (is `systemctl --user` available?)"),
    }
    Ok(())
}

fn install_timer_launchd(spec: &TimerSpec, exe: &Path) -> Result<()> {
    let dir = launch_agents_dir()?;
    std::fs::create_dir_all(&dir)?;
    let label = format!("dev.8sync.{}", spec.name);
    let plist = dir.join(format!("{label}.plist"));
    let secs = parse_dur_secs(spec.every);

    let mut args_xml = format!("<string>{}</string>", xml_escape(&exe.display().to_string()));
    for a in spec.exec_args {
        args_xml.push_str(&format!("<string>{}</string>", xml_escape(a)));
    }
    let wd_xml = match spec.workdir {
        Some(w) => format!(
            "  <key>WorkingDirectory</key><string>{}</string>\n",
            xml_escape(&w.display().to_string())
        ),
        None => String::new(),
    };
    let body = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
         <plist version=\"1.0\"><dict>\n\
         \x20 <key>Label</key><string>{label}</string>\n\
         \x20 <key>ProgramArguments</key><array>{args}</array>\n\
         {wd}\
         \x20 <key>StartInterval</key><integer>{secs}</integer>\n\
         \x20 <key>Nice</key><integer>15</integer>\n\
         \x20 <key>LowPriorityIO</key><true/>\n\
         \x20 <key>RunAtLoad</key><false/>\n\
         </dict></plist>\n",
        label = label,
        args = args_xml,
        wd = wd_xml,
        secs = secs,
    );
    std::fs::write(&plist, body)?;
    ui::ok(&format!("wrote {}", plist.display()));

    // Reload: unload any stale copy, then load the fresh one.
    let _ = Command::new("launchctl").args(["unload", "-w"]).arg(&plist).status();
    let st = Command::new("launchctl").args(["load", "-w"]).arg(&plist).status();
    match st {
        Ok(s) if s.success() => {
            ui::ok(&format!("LaunchAgent loaded — every {} ({}s)", spec.every, secs));
            ui::info(&format!("status: launchctl list | grep {label}"));
        }
        _ => ui::warn("could not load LaunchAgent (is `launchctl` available?)"),
    }
    Ok(())
}

fn install_timer_schtasks(spec: &TimerSpec, exe: &Path) -> Result<()> {
    let task = format!("8sync\\{}", spec.name);
    let mins = (parse_dur_secs(spec.every) / 60).max(1);
    let args = spec.exec_args.join(" ");
    // schtasks has no per-task working directory; wrap in `cmd /c cd … && exe`.
    let tr = match spec.workdir {
        Some(w) => format!("cmd /c cd /d \"{}\" && \"{}\" {}", w.display(), exe.display(), args),
        None => format!("\"{}\" {}", exe.display(), args),
    };
    let st = Command::new("schtasks")
        .args(["/Create", "/TN", &task, "/TR", &tr, "/SC", "MINUTE", "/MO", &mins.to_string(), "/F"])
        .status();
    match st {
        Ok(s) if s.success() => {
            ui::ok(&format!("Scheduled Task `{task}` created — every {mins} min"));
            ui::info(&format!("status: schtasks /Query /TN \"{task}\""));
        }
        _ => ui::warn("could not create Scheduled Task (is `schtasks` available?)"),
    }
    Ok(())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const GH: CorePkg =
        CorePkg { arch: "github-cli", fedora: "gh", brew: "gh", winget: "GitHub.cli" };

    /// AC-12: a Linux distro in neither family has no native backend, so
    /// `install_core_pkg` must fall through to the manual-install notice
    /// instead of shelling out to a package manager that isn't there.
    #[test]
    fn other_family_routes_to_manual_notice() {
        assert_eq!(core_route(Os::Linux, Family::Other, GH), CoreRoute::Manual);
        assert_eq!(core_route(Os::Other, Family::Other, GH), CoreRoute::Manual);
        // And `pkg` agrees there is nothing to dispatch to.
        assert!(crate::pkg::backend_for(Family::Other).is_none());
    }

    /// Each Linux family picks its own package id — they genuinely differ.
    #[test]
    fn linux_families_pick_their_own_package_id() {
        assert_eq!(core_route(Os::Linux, Family::Arch, GH), CoreRoute::Native("github-cli"));
        assert_eq!(core_route(Os::Linux, Family::Fedora, GH), CoreRoute::Native("gh"));
    }

    /// macOS/Windows are unaffected by the distro family (there isn't one).
    #[test]
    fn mac_and_windows_routes_are_family_independent() {
        for f in [Family::Arch, Family::Fedora, Family::Other] {
            assert_eq!(core_route(Os::Macos, f, GH), CoreRoute::Brew);
            assert_eq!(core_route(Os::Windows, f, GH), CoreRoute::Winget);
        }
    }
}
