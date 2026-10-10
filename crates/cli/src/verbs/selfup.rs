// Self-update: pull the prebuilt binary from the latest GitHub Release.
// Also exposes a rate-limited auto-check used from main() before dispatch.

use anyhow::{anyhow, bail, Result};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use crate::{platform, ui};

const REPO_OWNER: &str = "8-Sync-Dev";
const REPO_NAME: &str = "su-code";
const ASSET_PREFIX: &str = "8sync-";
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 3600); // 6h

fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| std::env::temp_dir())
        .join("8sync")
}

fn last_check_file() -> PathBuf { cache_dir().join("last_check") }
fn last_seen_tag_file() -> PathBuf { cache_dir().join("last_seen_tag") }

fn build_version() -> &'static str { env!("CARGO_PKG_VERSION") }

fn now_secs() -> u64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The last check time lives in the file's CONTENT (epoch seconds), not its
/// mtime: rewriting an already-empty file with "" leaves the NTFS mtime alone,
/// so on Windows the 6-hour window never started and every command spawned a probe.
/// Empty, garbage, or future stamps (clock moved back) count as due.
fn check_due(stamp: &str, now: u64) -> bool {
    match stamp.trim().parse::<u64>() {
        Ok(t) => now.checked_sub(t).is_none_or(|age| age > CHECK_INTERVAL.as_secs()),
        Err(_) => true,
    }
}

fn should_check() -> bool {
    std::fs::read_to_string(last_check_file()).map_or(true, |s| check_due(&s, now_secs()))
}

fn touch_check() {
    let _ = std::fs::create_dir_all(cache_dir());
    let _ = std::fs::write(last_check_file(), now_secs().to_string());
}

/// Strip leading `v` from a release tag so it can be compared to CARGO_PKG_VERSION.
fn strip_v(s: &str) -> &str { s.strip_prefix('v').unwrap_or(s) }

/// The release-asset OS/arch label, matching the names produced by
/// `.github/workflows/release.yml` (`8sync-<tag>-<os>-<arch>[.exe]`):
/// `linux-x86_64`, `linux-aarch64`, `darwin-x86_64`, `darwin-arm64`,
/// `windows-x86_64`. macOS names its ARM slice `arm64`, not `aarch64`.
fn asset_label() -> String {
    let os = match platform::os() {
        platform::Os::Macos => "darwin",
        platform::Os::Windows => "windows",
        _ => "linux",
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" if os == "darwin" => "arm64",
        other => other,
    };
    format!("{}-{}", os, arch)
}

/// Release asset file name for `tag`, e.g. `8sync-v0.52.0-windows-x86_64.exe`.
fn asset_filename(tag: &str) -> String {
    let ext = if platform::os() == platform::Os::Windows { ".exe" } else { "" };
    format!("{}{}-{}{}", ASSET_PREFIX, tag, asset_label(), ext)
}

/// Install target: the running executable itself, so `8sync up` replaces 8sync
/// wherever it actually lives — the Unix `~/.local/bin/8sync` OR the Windows
/// `%LOCALAPPDATA%\Programs\8sync\8sync.exe`. This is what fixes the Windows
/// bug where a hard-coded extension-less `~/.local/bin/8sync` left an
/// un-runnable file (Windows then popped an "open with" dialog). Falls back to
/// the legacy Unix path only if the current exe cannot be resolved.
fn dest_path() -> Result<PathBuf> {
    if let Ok(p) = std::env::current_exe() {
        return Ok(std::fs::canonicalize(&p).map(strip_verbatim_drive).unwrap_or(p));
    }
    let name = if platform::os() == platform::Os::Windows { "8sync.exe" } else { "8sync" };
    Ok(dirs::home_dir()
        .ok_or_else(|| anyhow!("no home dir"))?
        .join(".local/bin")
        .join(name))
}

/// Best-effort removal of `.8sync.old.*` leftovers from a prior Windows update
/// (a running .exe can't be deleted, so its predecessor is swept on a later run).
fn sweep_old_siblings(dst: &Path) {
    let Some(dir) = dst.parent() else { return };
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if e.file_name().to_string_lossy().starts_with(".8sync.old.") {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Normalise a release asset's `digest` field. GitHub publishes it as
/// `sha256:<hex>`; a bare hex string is accepted too, but an explicit
/// non-sha256 algorithm is not — an unknown algorithm must read as "no digest"
/// rather than as a value we would then compare against a sha256 sum. Anything
/// that is not exactly 64 hex characters is treated as absent, never as a pass,
/// which is the same length check install.sh applies.
fn parse_digest(raw: &str) -> Option<String> {
    let hex = match raw.split_once(':') {
        Some(("sha256", h)) => h,
        Some(_) => return None,
        None => raw,
    };
    let hex = hex.trim();
    is_hex64(hex).then(|| hex.to_ascii_lowercase())
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Pull the hash out of a hasher's stdout. coreutils/shasum print
/// `<hex>  <file>`; certutil prints a header line, the digest (older builds
/// space-separate every byte), then a trailer. Testing the first field and then
/// the whitespace-stripped line covers all three without a per-tool parser.
/// GNU coreutils prefixes the line with `\` when the file name contains a
/// backslash — every Windows path — so that marker is skipped.
fn first_hex64(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        if let Some(tok) = line.split_whitespace().next() {
            let tok = tok.strip_prefix('\\').unwrap_or(tok);
            if is_hex64(tok) {
                return Some(tok.to_ascii_lowercase());
            }
        }
        let joined: String = line.split_whitespace().collect();
        if is_hex64(&joined) {
            return Some(joined.to_ascii_lowercase());
        }
    }
    None
}

/// `canonicalize` on Windows returns `\\?\C:\…`; Git's MSYS `sha256sum` eats
/// the backslashes of that form and fails, so self-update checksums never ran.
/// Only the drive form is unwrapped — `\\?\UNC\…` has no equivalent plain spelling here.
fn strip_verbatim_drive(p: PathBuf) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => p,
    }
}

/// sha256 of `path` using whatever the box already has: coreutils `sha256sum`,
/// the BSD/macOS `shasum`, or Windows `certutil` — the first that WORKS, so one
/// broken hasher does not masquerade as "none installed". Deliberately not a
/// crate — the binary sits near its size ceiling and a hashing dependency is not
/// worth it for one call per update. `None` is reported out loud by the caller
/// instead of pretending the download was checked.
pub(crate) fn sha256_file(path: &Path) -> Option<String> {
    let p = path.to_str()?;
    let hashers: [(&str, Vec<&str>); 3] = [
        ("sha256sum", vec![p]),
        ("shasum", vec!["-a", "256", p]),
        ("certutil", vec!["-hashfile", p, "SHA256"]),
    ];
    hashers.iter().find_map(|(bin, args)| {
        let out = Command::new(bin).args(args).output().ok()?;
        if !out.status.success() {
            return None;
        }
        first_hex64(&String::from_utf8_lossy(&out.stdout))
    })
}

/// Check the freshly downloaded `tmp` against the release's published digest
/// before it can become the live binary. Mirrors `verify_checksum` in
/// install.sh: a digest we DID obtain that does not match is fatal, while a
/// missing digest or missing hasher is a loud warning rather than an abort —
/// refusing to upgrade because GitHub rate-limited the API (60 req/h
/// unauthenticated) or because a minimal image ships no coreutils would be
/// worse than the status quo. What it must never do is look verified when it
/// was not.
fn verify_download(tmp: &Path, expected: Option<&str>, asset_url: &str) -> Result<()> {
    let Some(want) = expected else {
        ui::warn("checksum NOT VERIFIED — no sha256 digest published for this asset");
        return Ok(());
    };
    let Some(got) = sha256_file(tmp) else {
        ui::warn("checksum NOT VERIFIED — no working sha256sum, shasum or certutil");
        return Ok(());
    };
    if !got.eq_ignore_ascii_case(want) {
        bail!(
            "checksum mismatch for {} — refusing to install\n  expected sha256:{}\n  actual   sha256:{}",
            asset_url,
            want,
            got
        );
    }
    ui::info(&format!("checksum ok (sha256:{})", want));
    Ok(())
}

/// Download `asset_url` into a temp sibling of `dst`, verify it against
/// `expected_digest`, and move it into place with platform-correct replace
/// semantics. Unix swaps the inode with a same-dir rename (fine even while
/// running). Windows cannot overwrite a live .exe, but CAN rename it aside, so
/// the live binary is moved to `.8sync.old.<pid>` first and restored if the
/// install fails.
///
/// Verification runs before the temp file is made executable and before the
/// current binary is touched, so a mismatch can never leave a runnable artefact
/// behind or a half-replaced install.
fn download_and_replace(asset_url: &str, dst: &Path, expected_digest: Option<&str>) -> Result<()> {
    let dir = dst
        .parent()
        .ok_or_else(|| anyhow!("bad destination path: {}", dst.display()))?;
    std::fs::create_dir_all(dir)?;
    sweep_old_siblings(dst);

    let tmp = dir.join(format!(".8sync.new.{}", std::process::id()));
    // `--proto =https --tlsv1.2` matches install.sh: never let the transfer be
    // talked down to plaintext or an obsolete TLS version.
    let status = Command::new("curl")
        .args([
            "-fsSL",
            "--proto", "=https",
            "--tlsv1.2",
            "--max-time", "120",
            "-o", tmp.to_str().unwrap(),
            asset_url,
        ])
        .status()?;
    if !status.success() {
        let _ = std::fs::remove_file(&tmp);
        bail!("download failed: {}", asset_url);
    }
    if let Err(e) = verify_download(&tmp, expected_digest, asset_url) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    }

    #[cfg(windows)]
    {
        if dst.exists() {
            let old = dir.join(format!(".8sync.old.{}", std::process::id()));
            std::fs::rename(dst, &old)
                .map_err(|e| anyhow!("could not move current binary aside ({}): {}", dst.display(), e))?;
            if let Err(e) = std::fs::rename(&tmp, dst) {
                let _ = std::fs::rename(&old, dst); // restore, don't leave headless
                let _ = std::fs::remove_file(&tmp);
                bail!("could not install new binary to {}: {}", dst.display(), e);
            }
            return Ok(());
        }
    }

    std::fs::rename(&tmp, dst)
        .map_err(|e| anyhow!("could not install {}: {}", dst.display(), e))?;
    Ok(())
}

/// GET a GitHub release payload (`releases/<path>`). Hardened the same way as
/// install.sh; short timeout so it never blocks a command.
fn github_release_json(path: &str) -> Option<serde_json::Value> {
    if which::which("curl").is_err() {
        return None;
    }
    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/{}",
        REPO_OWNER, REPO_NAME, path
    );
    let out = Command::new("curl")
        .args([
            "-fsSL",
            "--proto", "=https",
            "--tlsv1.2",
            "--max-time", "5",
            "-H", "Accept: application/vnd.github+json",
            "-H", "User-Agent: 8sync-selfup",
            &url,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    serde_json::from_slice(&out.stdout).ok()
}

/// Find `want_name` in a release payload's `assets` array; returns its download
/// URL and published sha256 digest. The digest is optional: GitHub only started
/// emitting `digest` in 2025 and can lag right after a release is cut.
fn find_asset(release: &serde_json::Value, want_name: &str) -> Option<(String, Option<String>)> {
    for a in release.get("assets")?.as_array()? {
        if a.get("name").and_then(|n| n.as_str()) == Some(want_name) {
            let url = a.get("browser_download_url")?.as_str()?.to_string();
            let digest = a.get("digest").and_then(|d| d.as_str()).and_then(parse_digest);
            return Some((url, digest));
        }
    }
    None
}

/// Query GitHub for the latest release. Returns
/// `(tag_name, asset_browser_download_url, sha256_digest)`.
/// Short timeout so it never blocks. Silent on offline / no-curl.
///
/// The API is rate-limited to 60 unauthenticated requests per hour per IP, so a
/// throttled API falls back to the `releases/latest` web redirect — the same
/// source install.sh/install.ps1 trust. That path has no digest; the download
/// then reports "checksum NOT VERIFIED" instead of failing.
fn fetch_latest_release() -> Option<(String, String, Option<String>)> {
    if let Some(v) = github_release_json("latest") {
        if let Some(tag) = v.get("tag_name").and_then(|t| t.as_str()) {
            if let Some((url, digest)) = find_asset(&v, &asset_filename(tag)) {
                return Some((tag.to_string(), url, digest));
            }
        }
    }
    let tag = latest_tag_from_redirect()?;
    let url = format!(
        "https://github.com/{}/{}/releases/download/{}/{}",
        REPO_OWNER, REPO_NAME, tag, asset_filename(&tag)
    );
    Some((tag, url, None))
}

/// Resolve the latest tag from `github.com/<repo>/releases/latest`, which
/// redirects to `.../releases/tag/<tag>` and is not API rate-limited.
///
/// Reads the `Location:` header of the unfollowed response instead of
/// `-w %{url_effective}`: the curl 8.8.0 that ships with Windows fails every
/// `--write-out` with error 43.
fn latest_tag_from_redirect() -> Option<String> {
    let url = format!("https://github.com/{}/{}/releases/latest", REPO_OWNER, REPO_NAME);
    let out = Command::new("curl")
        .args(["-fsSI", "--proto", "=https", "--tlsv1.2", "--max-time", "5", &url])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("location")).map(|(_, v)| v.trim().to_string()))
        .and_then(|loc| tag_from_release_url(&loc))
}

/// `https://github.com/o/r/releases/tag/v1.2.3` → `v1.2.3`.
fn tag_from_release_url(url: &str) -> Option<String> {
    let tag = url.trim().rsplit_once("/releases/tag/")?.1.trim_end_matches('/');
    (tag.starts_with('v') && tag[1..].starts_with(|c: char| c.is_ascii_digit()))
        .then(|| tag.to_string())
}

/// Digest for a pinned tag's asset, read from `releases/tags/<tag>` — the same
/// endpoint install.sh consults when SUSYNC_VERSION is set. `None` (API down or
/// throttled) downgrades to an explicit "not verified" warning, not a failure.
fn fetch_tag_digest(tag: &str) -> Option<String> {
    let v = github_release_json(&format!("tags/{}", tag))?;
    find_asset(&v, &asset_filename(tag))?.1
}

/// Is `remote` strictly newer than `local`? Compares dotted numeric components
/// left to right, so `0.54.0 > 0.53.9` and a LOCAL build ahead of the published
/// release (a dev build) never reports an update. String equality — the previous
/// test — called every non-identical string an upgrade, including downgrades.
/// Non-numeric suffixes are ignored rather than pulling in a semver crate.
fn is_newer(remote: &str, local: &str) -> bool {
    let part = |s: &str| -> Vec<u64> {
        s.split(['.', '-', '+'])
            .map(|c| {
                let digits: String = c.chars().take_while(|c| c.is_ascii_digit()).collect();
                digits.parse().unwrap_or(0)
            })
            .collect()
    };
    let (r, l) = (part(remote), part(local));
    for i in 0..r.len().max(l.len()) {
        let (a, b) = (r.get(i).copied().unwrap_or(0), l.get(i).copied().unwrap_or(0));
        if a != b {
            return a > b;
        }
    }
    false
}

/// Auto-check called from main(). Runs the network probe on a DETACHED thread and
/// never joins it, so the user's command is not delayed — previously this blocked
/// dispatch for up to 5s against a rate-limited api.github.com, on every command
/// including a bare `8sync`.
///
/// Silent unless stderr is a TTY and this is not CI: a notice in piped output or a
/// CI log is noise nobody asked for. `last_seen_tag` suppresses re-notifying about
/// a version the user has already been told about (it was written and never read).
pub fn auto_check_notice() {
    if std::env::var("SUSYNC_NO_AUTO_CHECK").is_ok() {
        return;
    }
    if std::env::var("CI").is_ok() {
        return;
    }
    if !std::io::IsTerminal::is_terminal(&std::io::stderr()) {
        return;
    }

    // Print from CACHE — instant, no network on the command's critical path.
    //
    // The probe deliberately does not run inline. A previous revision spawned a
    // detached `std::thread`, which the runtime kills the moment `main` returns:
    // a `curl --max-time 5` never outlived an `8sync doctor`, and `touch_check()`
    // had already burned the 6-hour window, so the notice could never appear.
    // Refreshing a cache in a child process and reading it on the NEXT run gets a
    // reliable notice with zero added latency.
    if let Ok(tag) = std::fs::read_to_string(latest_tag_file()) {
        let tag = tag.trim();
        let local = build_version();
        if !tag.is_empty()
            && is_newer(strip_v(tag), local)
            && !std::fs::read_to_string(last_seen_tag_file()).is_ok_and(|s| s.trim() == tag)
        {
            let _ = std::fs::write(last_seen_tag_file(), tag);
            let msg =
                format!("! 8sync update available: v{local} → {tag} — run `8sync up` to install");
            if std::env::var("NO_COLOR").is_ok() {
                eprintln!("{msg}");
            } else {
                eprintln!("\x1b[33m{msg}\x1b[0m");
            }
        }
    }

    if !should_check() {
        return;
    }
    touch_check();
    spawn_detached_probe();
}

fn latest_tag_file() -> PathBuf {
    cache_dir().join("latest_tag")
}

/// Re-exec ourselves as a fire-and-forget child that refreshes the cache.
/// Detached on purpose: it must survive this process exiting, which is exactly
/// what a thread could not do.
fn spawn_detached_probe() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let _ = std::process::Command::new(exe)
        .arg(PROBE_ARG)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

/// Hidden argv marker for the refresh child. Matched in `main` before clap runs,
/// so it never appears in help and can never collide with a real verb.
pub const PROBE_ARG: &str = "__update-probe";

/// Child-process entry point: fetch the latest tag and cache it. Never prints.
pub fn run_probe() {
    let Some((tag, _url, _digest)) = fetch_latest_release() else {
        return;
    };
    let _ = std::fs::create_dir_all(cache_dir());
    let _ = std::fs::write(latest_tag_file(), tag);
}

/// Force self-update: download the latest release asset and install it.
/// Returns Ok(true) when a new binary was written, Ok(false) when already up-to-date.
pub fn run_self_update(force: bool) -> Result<bool> {
    ui::step("Self-update — GitHub Releases");
    let local = build_version();

    let (tag, asset_url, digest) = fetch_latest_release()
        .ok_or_else(|| anyhow!("could not query latest release from github.com/{}/{}", REPO_OWNER, REPO_NAME))?;
    let remote = strip_v(&tag);
    // Skip unless the release is strictly newer. `up.rs` used to pass force=true
    // unconditionally, making this branch unreachable and re-downloading ~5 MB on
    // every single `8sync up`.
    if !force && !is_newer(&remote, &local) {
        ui::skip("8sync", &format!("up to date (v{local}) — `8sync up --force` to reinstall"));
        return Ok(false);
    }

    let dst = dest_path()?;
    ui::info(&format!("local v{} → {} ({})", local, tag, asset_url));
    download_and_replace(&asset_url, &dst, digest.as_deref())?;

    let _ = std::fs::write(last_seen_tag_file(), &tag);
    ui::ok(&format!("installed {} → {}", tag, dst.display()));
    Ok(true)
}

/// Install a specific tag (e.g. `v0.6.10`). Used by `8sync up --to <tag>`
/// for reproducibility / explicit downgrade.
pub fn install_tag(tag: &str) -> Result<bool> {
    ui::step(&format!("Self-update → pinned tag {}", tag));
    let tag = tag.strip_prefix('v').map(|t| format!("v{}", t)).unwrap_or_else(|| format!("v{}", tag));
    let asset_url = format!(
        "https://github.com/{}/{}/releases/download/{}/{}",
        REPO_OWNER, REPO_NAME, tag, asset_filename(&tag)
    );
    let dst = dest_path()?;
    ui::info(&format!("local v{} → {} ({})", build_version(), tag, asset_url));
    // A pinned tag skips the /latest payload, so its digest comes from the
    // per-tag endpoint — the same one install.sh uses under SUSYNC_VERSION.
    let digest = fetch_tag_digest(&tag);
    download_and_replace(&asset_url, &dst, digest.as_deref())?;

    let _ = std::fs::write(last_seen_tag_file(), &tag);
    ui::ok(&format!("installed {} → {}", tag, dst.display()));
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{check_due, find_asset, first_hex64, is_newer, parse_digest, strip_verbatim_drive, tag_from_release_url};
    use std::path::PathBuf;

    #[test]
    fn verbatim_drive_paths_are_unwrapped_for_external_hashers() {
        let unwrap = |s: &str| strip_verbatim_drive(PathBuf::from(s));
        assert_eq!(unwrap(r"\\?\C:\Users\a\8sync.exe"), PathBuf::from(r"C:\Users\a\8sync.exe"));
        // UNC verbatim has no drive form to fall back to; plain paths pass through.
        assert_eq!(unwrap(r"\\?\UNC\srv\share\8sync.exe"), PathBuf::from(r"\\?\UNC\srv\share\8sync.exe"));
        assert_eq!(unwrap("/home/a/.local/bin/8sync"), PathBuf::from("/home/a/.local/bin/8sync"));
    }

    #[test]
    fn update_probe_is_throttled_by_the_stamp_it_writes() {
        let now = 1_791_700_000;
        // What touch_check writes must close the window (the mtime-based gate never did on NTFS).
        assert!(!check_due(&now.to_string(), now));
        assert!(!check_due(&format!("{}\n", now - 6 * 3600), now));
        assert!(check_due(&(now - 6 * 3600 - 1).to_string(), now));
        // Legacy empty marker, garbage, or a stamp from the future (clock moved back): probe.
        assert!(check_due("", now));
        assert!(check_due("x", now));
        assert!(check_due(&(now + 60).to_string(), now));
    }

    #[test]
    fn redirect_fallback_only_accepts_a_resolved_release_tag() {
        let base = "https://github.com/8-Sync-Dev/su-code/releases";
        assert_eq!(tag_from_release_url(&format!("{base}/tag/v0.61.0")), Some("v0.61.0".into()));
        assert_eq!(tag_from_release_url(&format!("{base}/tag/v0.61.0/\n")), Some("v0.61.0".into()));
        // No redirect happened (no releases yet, or an error page): never a tag.
        assert_eq!(tag_from_release_url(&format!("{base}/latest")), None);
        assert_eq!(tag_from_release_url(&format!("{base}/tag/")), None);
        assert_eq!(tag_from_release_url(&format!("{base}/tag/nightly")), None);
    }

    #[test]
    fn only_strictly_newer_releases_notify() {
        // upgrade
        assert!(is_newer("0.54.0", "0.53.0"));
        assert!(is_newer("0.53.10", "0.53.9")); // numeric, not lexicographic
        assert!(is_newer("1.0.0", "0.99.99"));
        // equal -> never
        assert!(!is_newer("0.53.0", "0.53.0"));
        // downgrade -> never (string equality used to call this an "update")
        assert!(!is_newer("0.52.0", "0.53.0"));
        // a local dev build ahead of the published release must stay quiet
        assert!(!is_newer("0.53.0", "0.54.0-dev"));
        // missing components are zero, not an error
        assert!(is_newer("0.53.1", "0.53"));
        assert!(!is_newer("0.53", "0.53.0"));
    }

    #[test]
    fn digest_parsing_accepts_only_a_real_sha256() {
        let hex = "a".repeat(64);
        // GitHub's published form, and the bare hex some tooling emits.
        assert_eq!(parse_digest(&format!("sha256:{hex}")), Some(hex.clone()));
        assert_eq!(parse_digest(&hex), Some(hex.clone()));
        // Another algorithm must read as "absent", never as a sha256 to compare.
        assert_eq!(parse_digest(&format!("sha512:{hex}")), None);
        assert_eq!(parse_digest(&format!("md5:{}", "a".repeat(32))), None);
        // Malformed / wrong length / non-hex -> absent, never a pass.
        assert_eq!(parse_digest(""), None);
        assert_eq!(parse_digest("sha256:"), None);
        assert_eq!(parse_digest("sha256:deadbeef"), None);
        assert_eq!(parse_digest(&"a".repeat(63)), None);
        assert_eq!(parse_digest(&"a".repeat(65)), None);
        assert_eq!(parse_digest(&format!("sha256:{}z", "a".repeat(63))), None);
    }

    #[test]
    fn digest_comparison_ignores_case() {
        let upper = "AB".repeat(32);
        let lower = upper.to_ascii_lowercase();
        // Both sides normalise, so an uppercase API digest still matches a
        // hasher that printed lowercase (and vice versa).
        assert_eq!(parse_digest(&format!("sha256:{upper}")), Some(lower.clone()));
        assert_eq!(first_hex64(&format!("{upper}  8sync-v1.0.0-linux-x86_64")), Some(lower.clone()));
        assert!(parse_digest(&upper).unwrap().eq_ignore_ascii_case(&lower));
    }

    #[test]
    fn hasher_output_parses_for_every_supported_tool() {
        let hex = "b".repeat(64);
        // coreutils sha256sum / shasum -a 256
        assert_eq!(first_hex64(&format!("{hex}  /tmp/.8sync.new.1\n")), Some(hex.clone()));
        // GNU sha256sum (Git for Windows) on a backslash path escapes the line
        assert_eq!(first_hex64(&format!("\\{hex}  C:\\\\Users\\\\x\\\\.8sync.new.1\n")), Some(hex.clone()));
        // certutil: header, digest, trailer — including the space-separated form
        let spaced = hex
            .as_bytes()
            .chunks(2)
            .map(|c| std::str::from_utf8(c).unwrap())
            .collect::<Vec<_>>()
            .join(" ");
        let certutil = format!(
            "SHA256 hash of 8sync.exe:\n{spaced}\nCertUtil: -hashfile command completed successfully.\n"
        );
        assert_eq!(first_hex64(&certutil), Some(hex.clone()));
        // No digest anywhere -> None, so the caller warns instead of comparing junk.
        assert_eq!(first_hex64("sha256sum: /tmp/x: No such file or directory\n"), None);
        assert_eq!(first_hex64(""), None);
    }

    #[test]
    fn asset_lookup_reports_a_missing_digest_rather_than_faking_one() {
        let hex = "c".repeat(64);
        let release = serde_json::json!({
            "assets": [
                { "name": "8sync-v1.0.0-darwin-arm64", "browser_download_url": "https://x/darwin", "digest": format!("sha256:{hex}") },
                { "name": "8sync-v1.0.0-linux-x86_64", "browser_download_url": "https://x/linux" }
            ]
        });
        assert_eq!(
            find_asset(&release, "8sync-v1.0.0-darwin-arm64"),
            Some(("https://x/darwin".to_string(), Some(hex)))
        );
        // Asset published before GitHub computed a digest: URL yes, digest no.
        assert_eq!(
            find_asset(&release, "8sync-v1.0.0-linux-x86_64"),
            Some(("https://x/linux".to_string(), None))
        );
        assert_eq!(find_asset(&release, "8sync-v1.0.0-windows-x86_64"), None);
    }
}
