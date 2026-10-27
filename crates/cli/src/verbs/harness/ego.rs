//! `8sync harness browser ego [install|status]` — install the official ego lite
//! browser (citrolabs, https://lite.ego.app) so agents drive the owner's real,
//! logged-in browser through its `ego-browser` command instead of a bridge to a
//! separate Chromium.
//!
//! Facts this follows (citrolabs/ego-lite, read 2026-10-27):
//! - Windows ships one x64 `.exe` installer on `cdn.ego.app`, linked from the
//!   README; there is no install script and no winget package for Windows
//!   (`skills/ego-browser/references/install.md`).
//! - The `ego-browser` command and the `ego-browser` skill come from the app:
//!   onboarding (a GUI step) registers the command on PATH and the app copies
//!   the skill into the agents' skill directories. 8sync therefore installs only
//!   the app and never writes its own copy of the skill.
//! - Linux is on the roadmap, not shipped.
//!
//! Only the official CDN is accepted. The installer is downloaded to a fresh
//! directory under the temp dir and its Authenticode signature is checked before
//! it runs: a valid signature from CITRO LABS runs, an unsigned build needs
//! `EIGHTSYNC_EGO_ALLOW_UNSIGNED=1`, anything else (another signer, a broken
//! signature) never runs.
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::ui;

const README_URL: &str = "https://raw.githubusercontent.com/citrolabs/ego-lite/main/README.md";
const WIN_PREFIX: &str = "https://cdn.ego.app/setup/windows/x64/egoliteSetup-";
/// README link on 2026-10-27; used only when the README cannot be fetched.
const WIN_FALLBACK: &str = "https://cdn.ego.app/setup/windows/x64/egoliteSetup-Y7MbxKIuhzFB.exe";
const MAC_PREFIX_ARM: &str = "https://cdn.ego.app/setup/macos/arm64/egolite-";
const MAC_PREFIX_X64: &str = "https://cdn.ego.app/setup/macos/x64/egolite-";
const SITE: &str = "https://lite.ego.app/";
/// Publisher on the Authenticode certificate (Certum-issued, checked 2026-10-27).
const PUBLISHER: &str = "CN=CITRO LABS PTE. LIMITED";
/// Smaller than this is an error page, not a browser installer.
const MIN_INSTALLER_BYTES: u64 = 1024 * 1024;

pub(crate) fn harness_ego(args: &[String]) -> Result<()> {
    match args.first().map(String::as_str) {
        Some("status") | None => {
            status();
            Ok(())
        }
        Some("install") => install(),
        Some(other) => bail!("unknown `harness browser ego {other}` — use install | status"),
    }
}

/// First official download link with `prefix` in the README, e.g.
/// `https://cdn.ego.app/setup/windows/x64/egoliteSetup-<id>.exe`. The id must be
/// plain `[A-Za-z0-9_-]`, so a crafted README cannot point elsewhere.
fn installer_url(readme: &str, prefix: &str, ext: &str) -> Option<String> {
    let mut rest = readme;
    while let Some(i) = rest.find(prefix) {
        let tail = &rest[i + prefix.len()..];
        let id: String = tail.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
        if !id.is_empty() && tail[id.len()..].starts_with(ext) {
            return Some(format!("{prefix}{id}{ext}"));
        }
        rest = tail;
    }
    None
}

fn fetch_readme() -> Option<String> {
    let out = Command::new("curl")
        .args(["-fsSL", "--proto", "=https", "--tlsv1.2", "--max-time", "20", README_URL])
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `ego-browser` on this process's PATH, else (Windows) on the user/machine
/// PATH that onboarding wrote after this terminal started.
fn find_ego_browser() -> Option<PathBuf> {
    if let Ok(p) = which::which("ego-browser") {
        return Some(p);
    }
    #[cfg(windows)]
    {
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')",
            ])
            .output()
            .ok()?;
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let cwd = std::env::current_dir().ok()?;
        return which::which_in("ego-browser", Some(path), cwd).ok();
    }
    #[allow(unreachable_code)]
    None
}

fn status() {
    ui::header("8sync harness browser ego — status");
    match find_ego_browser() {
        Some(p) => {
            ui::ok(&format!("ego-browser: {}", p.display()));
            if which::which("ego-browser").is_err() {
                ui::info("not on THIS terminal's PATH yet — open a new terminal");
            }
        }
        None => ui::warn("ego-browser not found — run `8sync harness browser ego install`, then finish onboarding in the app"),
    }
    if let Some(home) = dirs::home_dir() {
        for d in [".agents/skills/ego-browser", ".claude/skills/ego-browser"] {
            let p = home.join(d);
            if p.join("SKILL.md").exists() {
                ui::ok(&format!("skill: {}", p.display()));
            } else {
                ui::info(&format!("skill not at {} (the ego lite app writes it on launch)", p.display()));
            }
        }
    }
    ui::info("check the runtime: ego-browser nodejs -e \"console.log('ego-browser ready')\"");
}

fn install() -> Result<()> {
    ui::header("8sync harness browser ego install — official ego lite (lite.ego.app)");
    if let Some(p) = find_ego_browser() {
        ui::skip("ego lite", &format!("installed → {} (it updates itself; `ego-browser upgrade` for an old one)", p.display()));
        return Ok(());
    }
    let readme = fetch_readme();
    if readme.is_none() {
        ui::warn("could not read the ego-lite README — using the link pinned in 8sync");
    }
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => {
            let url = readme
                .as_deref()
                .and_then(|r| installer_url(r, WIN_PREFIX, ".exe"))
                .unwrap_or_else(|| WIN_FALLBACK.to_string());
            install_windows(&url)
        }
        ("windows", _) => {
            ui::warn("ego lite ships an x64 Windows installer only; on ARM64 it is untested (x64 emulation)");
            ui::info(&format!("download it yourself from {SITE} if you want to try"));
            Ok(())
        }
        ("macos", arch) => {
            let prefix = if arch == "aarch64" { MAC_PREFIX_ARM } else { MAC_PREFIX_X64 };
            let url = readme.as_deref().and_then(|r| installer_url(r, prefix, ".dmg"));
            ui::info(&format!("macOS: open {} , drag ego lite to Applications, then finish onboarding", url.as_deref().unwrap_or(SITE)));
            Ok(())
        }
        _ => {
            ui::warn("ego lite has no Linux build yet (roadmap: https://lite.ego.app/roadmap)");
            ui::info("keep using `8sync harness browser` (system Chromium) here");
            Ok(())
        }
    }
}

fn install_windows(url: &str) -> Result<()> {
    if !url.starts_with(WIN_PREFIX) {
        bail!("refusing a non-official installer URL: {url}");
    }
    let dir = std::env::temp_dir().join("8sync-ego");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(url.rsplit('/').next().unwrap_or("egoliteSetup.exe"));
    ui::step(&format!("download {url}"));
    crate::verbs::forge::download(url, &file)?;
    let size = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
    if size < MIN_INSTALLER_BYTES {
        let _ = std::fs::remove_file(&file);
        bail!("download is {size} bytes — not an installer; get it from {SITE}");
    }
    let (sig, signer) = authenticode(&file);
    match signature_verdict(&sig, &signer, std::env::var("EIGHTSYNC_EGO_ALLOW_UNSIGNED").as_deref() == Ok("1")) {
        Verdict::Run => ui::ok(&format!("signature {sig}{}", if signer.is_empty() { String::new() } else { format!(" — {signer}") })),
        Verdict::RunUnsigned => ui::warn(&format!("signature {sig}; running because EIGHTSYNC_EGO_ALLOW_UNSIGNED=1")),
        Verdict::Refuse => {
            let _ = std::fs::remove_file(&file);
            bail!(
                "installer signature is `{sig}` ({signer}) — not run. Download it in your browser from {SITE} \
                 (or set EIGHTSYNC_EGO_ALLOW_UNSIGNED=1 when the status is NotSigned and you trust the CDN)"
            );
        }
    }
    ui::step("run the installer (follow its window; SmartScreen: More info → Run anyway)");
    let ok = Command::new(&file).status().map(|s| s.success()).unwrap_or(false);
    if !ok {
        ui::warn(&format!("installer exited with an error — the file is kept at {}", file.display()));
        return Ok(());
    }
    let _ = std::fs::remove_dir_all(&dir);
    ui::ok("ego lite installed");
    ui::info("next: open ego lite and finish onboarding (it adds `ego-browser` to PATH and the skill to your agents)");
    ui::info("then open a NEW terminal and run: 8sync harness browser ego status");
    Ok(())
}

#[derive(Debug, PartialEq)]
enum Verdict {
    Run,
    RunUnsigned,
    Refuse,
}

/// `Valid` from the ego lite publisher runs; `NotSigned` runs only with the
/// owner's opt-in; anything else (another signer, HashMismatch, NotTrusted, an
/// unreadable status) never runs.
fn signature_verdict(status: &str, signer: &str, allow_unsigned: bool) -> Verdict {
    match status {
        "Valid" if signer.split(", ").next() == Some(PUBLISHER) => Verdict::Run,
        "NotSigned" if allow_unsigned => Verdict::RunUnsigned,
        _ => Verdict::Refuse,
    }
}

/// (status, signer subject) from `Get-AuthenticodeSignature`.
fn authenticode(file: &Path) -> (String, String) {
    let p = file.display().to_string().replace('\'', "''");
    let script = format!(
        "$s = Get-AuthenticodeSignature -LiteralPath '{p}'; \"$($s.Status)|$($s.SignerCertificate.Subject)\""
    );
    let out = Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &script]).output();
    let text = out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    match text.split_once('|') {
        Some((s, who)) if !s.is_empty() => (s.to_string(), who.to_string()),
        _ => ("Unknown".into(), String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installer_url_takes_the_official_link_from_the_readme() {
        let readme = r#"<a href="https://cdn.ego.app/setup/macos/arm64/egolite-Y7MbxKIuhzFB.dmg">
<a href="https://cdn.ego.app/setup/windows/x64/egoliteSetup-Y7MbxKIuhzFB.exe"><img"#;
        assert_eq!(installer_url(readme, WIN_PREFIX, ".exe").as_deref(), Some(WIN_FALLBACK));
        assert_eq!(
            installer_url(readme, MAC_PREFIX_ARM, ".dmg").as_deref(),
            Some("https://cdn.ego.app/setup/macos/arm64/egolite-Y7MbxKIuhzFB.dmg")
        );
        assert_eq!(installer_url(readme, MAC_PREFIX_X64, ".dmg"), None);
    }

    #[test]
    fn installer_url_rejects_ids_that_escape_the_cdn_path() {
        let readme = "https://cdn.ego.app/setup/windows/x64/egoliteSetup-../../evil.exe \
                      https://cdn.ego.app/setup/windows/x64/egoliteSetup-a.exe.evil.com/x.exe";
        // The first has no id; the second id is `a` followed by `.exe`, so it is
        // accepted only as the exact CDN file name.
        assert_eq!(
            installer_url(readme, WIN_PREFIX, ".exe").as_deref(),
            Some("https://cdn.ego.app/setup/windows/x64/egoliteSetup-a.exe")
        );
        assert_eq!(installer_url("no links here", WIN_PREFIX, ".exe"), None);
    }

    #[test]
    fn only_a_valid_signature_runs_without_opt_in() {
        let citro = "CN=CITRO LABS PTE. LIMITED, O=CITRO LABS PTE. LIMITED, L=Singapore, C=SG";
        assert_eq!(signature_verdict("Valid", citro, false), Verdict::Run);
        assert_eq!(signature_verdict("Valid", "CN=Someone Else, C=US", true), Verdict::Refuse);
        assert_eq!(signature_verdict("Valid", "CN=CITRO LABS PTE. LIMITEDX", false), Verdict::Refuse);
        assert_eq!(signature_verdict("NotSigned", "", false), Verdict::Refuse);
        assert_eq!(signature_verdict("NotSigned", "", true), Verdict::RunUnsigned);
        assert_eq!(signature_verdict("HashMismatch", citro, true), Verdict::Refuse);
        assert_eq!(signature_verdict("Unknown", "", true), Verdict::Refuse);
    }
}
