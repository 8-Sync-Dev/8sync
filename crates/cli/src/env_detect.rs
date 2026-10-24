// Environment & system detection
use anyhow::{Context, Result};
use std::path::PathBuf;
use std::process::Command;

pub struct Env {
    pub home: PathBuf,
    pub xdg_config: PathBuf,
    pub os_id: String,
    /// Raw `ID_LIKE=` value from `/etc/os-release` (empty when the line is
    /// absent — Fedora 44 ships no `ID_LIKE` at all, so `os_id` alone must be
    /// enough to classify).
    pub os_id_like: String,
}

/// Coarse distro family. The installer only ever needs to answer "pacman or
/// dnf or neither", so three variants are the whole taxonomy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Arch,
    Fedora,
    Other,
}

/// Classify a distro from the *content* of `/etc/os-release`.
///
/// Pure and unit-testable: no filesystem, no process spawn.
/// * `Arch`   — `ID` in {arch, cachyos, manjaro, endeavouros} or `ID_LIKE` mentions `arch`
/// * `Fedora` — `ID` in {fedora, rhel, centos, almalinux, rocky} or `ID_LIKE` mentions `fedora`/`rhel`
/// * `Other`  — everything else
pub fn parse_family(os_release: &str) -> Family {
    let field = |key: &str| -> String {
        os_release
            .lines()
            .find_map(|l| l.trim().strip_prefix(key).map(|v| v.trim_matches('"').to_lowercase()))
            .unwrap_or_default()
    };
    classify(&field("ID="), &field("ID_LIKE="))
}

/// Shared classifier for `parse_family` (file content) and `Env::family`
/// (already-split fields).
fn classify(id: &str, id_like: &str) -> Family {
    const ARCH_IDS: [&str; 4] = ["arch", "cachyos", "manjaro", "endeavouros"];
    const FEDORA_IDS: [&str; 5] = ["fedora", "rhel", "centos", "almalinux", "rocky"];

    let id = id.trim().to_lowercase();
    let id_like = id_like.trim().to_lowercase();

    if ARCH_IDS.contains(&id.as_str()) {
        return Family::Arch;
    }
    if FEDORA_IDS.contains(&id.as_str()) {
        return Family::Fedora;
    }
    // `ID_LIKE` is a space-separated list ("fedora", "rhel centos fedora").
    let likes: Vec<&str> = id_like.split_whitespace().collect();
    if likes.contains(&"arch") {
        return Family::Arch;
    }
    if likes.contains(&"fedora") || likes.contains(&"rhel") {
        return Family::Fedora;
    }
    Family::Other
}

/// Read + classify `/etc/os-release`. `Family::Other` when unreadable
/// (non-Linux targets included).
pub fn distro_family() -> Family {
    std::fs::read_to_string("/etc/os-release")
        .map(|s| parse_family(&s))
        .unwrap_or(Family::Other)
}

impl Env {
    pub fn detect() -> Result<Self> {
        let home = dirs::home_dir().context("no HOME")?;
        let xdg_config = dirs::config_dir().unwrap_or_else(|| home.join(".config"));

        let os_release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
        let field = |key: &str| -> Option<String> {
            os_release
                .lines()
                .find_map(|l| l.trim().strip_prefix(key).map(|v| v.trim_matches('"').to_string()))
        };
        let os_id = field("ID=").unwrap_or_else(|| "unknown".to_string());
        let os_id_like = field("ID_LIKE=").unwrap_or_default();

        Ok(Self { home, xdg_config, os_id, os_id_like })
    }

    /// Distro family for the detected environment.
    pub fn family(&self) -> Family {
        classify(&self.os_id, &self.os_id_like)
    }

    pub fn is_cachyos_or_arch(&self) -> bool {
        self.family() == Family::Arch
    }
}


pub fn cmd_version(name: &str, args: &[&str]) -> Option<String> {
    // Resolve through PATH/PATHEXT first: on Windows `trail`/`headroom` are `.cmd` shims that a bare
    // `Command::new(name)` cannot start.
    let bin = which::which(name).unwrap_or_else(|_| name.into());
    let out = Command::new(bin).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).to_string();
    let first = s.lines().next()?.trim().to_string();
    Some(first)
}

/// omp's major version (e.g. `17` from `omp/17.0.6`), or None if omp isn't on PATH.
/// omp ≥17 mounts MCP tools as `xd://` device URLs (`tools.xdev`, default on) and
/// dropped the pre-17 bm25 discovery hop + `mcp.discoveryDefaultServers` key.
pub fn omp_major() -> Option<u32> {
    let v = cmd_version("omp", &["--version"])?; // "omp/17.0.6" (or "omp 17.0.6")
    let digits: String = v
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Detect HyDE-Project setup (hyprland + wallbash theme engine).
pub fn is_hyde() -> bool {
    let home = match dirs::home_dir() { Some(h) => h, None => return false };
    home.join(".config/hyde/wallbash").exists()
        || home.join(".config/hyde").exists() && which::which("hydectl").is_ok()
}

/// True on a tiling Wayland compositor (Hyprland, sway, river, wayfire) that
/// manages its own borders/gaps and expects clients to hide their own chrome.
/// False on a stacking desktop (KDE/kwin, GNOME/mutter, Xfce) where the
/// compositor does NOT draw decorations for kitty either — hiding kitty's own
/// title bar there leaves the window with no title bar, no min/max/close
/// buttons, and no drag-to-resize border at all.
pub fn is_tiling_wm() -> bool {
    if is_hyde() {
        return true;
    }
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
    let session = std::env::var("DESKTOP_SESSION").unwrap_or_default().to_lowercase();
    let hay = format!("{desktop} {session}");
    ["hyprland", "sway", "river", "wayfire", "qtile", "i3", "bspwm", "awesome"]
        .iter()
        .any(|wm| hay.contains(wm))
}

/// True when stdin/stdout is a real TTY (so we can prompt y/N).
pub fn has_tty() -> bool {
    // Use the simple `isatty(0)` trick via /proc.
    // unistd::isatty would need a new dep — keep it tiny.
    std::io::IsTerminal::is_terminal(&std::io::stdin())
        && std::io::IsTerminal::is_terminal(&std::io::stdout())
}

/// Return preferred AUR helper on PATH (`paru` > `yay`), or None.
pub fn aur_helper() -> Option<&'static str> {
    if which::which("paru").is_ok() { return Some("paru"); }
    if which::which("yay").is_ok()  { return Some("yay"); }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fedora 44 ships `ID=fedora` and NO `ID_LIKE` line at all — the `ID`
    /// alone has to be enough.
    #[test]
    fn fedora_without_id_like() {
        let os_release = "NAME=\"Fedora Linux\"\nVERSION=\"44 (Workstation Edition)\"\nID=fedora\nVERSION_ID=44\n";
        assert_eq!(parse_family(os_release), Family::Fedora);
    }

    #[test]
    fn cachyos_with_arch_id_like() {
        let os_release = "NAME=\"CachyOS Linux\"\nID=cachyos\nID_LIKE=arch\n";
        assert_eq!(parse_family(os_release), Family::Arch);
    }

    #[test]
    fn debian_is_other() {
        let os_release = "NAME=\"Debian GNU/Linux\"\nID=debian\nVERSION_ID=\"12\"\n";
        assert_eq!(parse_family(os_release), Family::Other);
    }

    /// An unknown derivative is classified purely by `ID_LIKE`.
    #[test]
    fn id_like_only_fallback() {
        assert_eq!(parse_family("ID=nobara\nID_LIKE=\"fedora\"\n"), Family::Fedora);
        assert_eq!(parse_family("ID=garuda\nID_LIKE=arch\n"), Family::Arch);
        assert_eq!(parse_family("ID=ubuntu\nID_LIKE=debian\n"), Family::Other);
    }

    /// RHEL clones carry a multi-token `ID_LIKE`; `ID` still wins first.
    #[test]
    fn rhel_clone_family() {
        assert_eq!(parse_family("ID=\"rocky\"\nID_LIKE=\"rhel centos fedora\"\n"), Family::Fedora);
    }

    #[test]
    fn empty_os_release_is_other() {
        assert_eq!(parse_family(""), Family::Other);
    }
}
