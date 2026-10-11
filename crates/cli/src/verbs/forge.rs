//! Named ForgeCode sessions — zsh-native by default.
//!
//! `8sync forge <name>` opens an interactive zsh with Forge's own zsh plugin bound
//! to the session's conversation: `: <prompt>` asks Forge, everything else is an
//! ordinary terminal. `--tui` opens Forge's full-screen TUI on the same
//! conversation. Forge only accepts UUID conversation ids, so names map to
//! persistent UUIDs per project in `<config>/8sync/forge-sessions/<key>/index.json`.
//!
//! Forge is installed from its GitHub release when missing. Windows has no native
//! zsh: MSYS2's zsh package is unpacked into a private MSYS root that borrows Git
//! for Windows' runtime DLLs, terminfo and coreutils — no admin rights needed.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};
use clap::Args as ClapArgs;

use crate::env_detect::Env;
use crate::ui;
use crate::verbs::uuid_sessions::{self, Store};

const FORGE_RELEASE: &str = "https://github.com/tailcallhq/forgecode/releases/latest/download";

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync forge core            zsh shell bound to the 'core' Forge session
      8sync forge core --tui      the same session in Forge's full-screen TUI
      8sync forge core -p \"...\"   one-shot prompt in the 'core' session
      8sync forge                 resume the latest session in this repo (zsh)
      8sync forge ls              list Forge sessions in this repo
      8sync forge new <name>      create a session (refuses an existing name)
      8sync forge rm <name>       remove a session and its Forge conversation
      8sync forge key [provider] <key>   store a provider API key for Forge
      8sync forge key             list stored provider keys (masked)
      8sync forge status          Forge binary, zsh runtime and sessions
      8sync forge provider|config|workspace|mcp|info ...   passthrough to forge

    INSIDE THE SHELL
      : <prompt>    ask Forge in this session's conversation
      :<Tab>        list Forge commands (:model, :provider, :agent, :new, ...)
      exit          leave; the conversation stays resumable by name

    WHAT IT DOES
      Maps friendly names to the UUID conversation ids Forge requires, installs
      Forge from its GitHub release when missing, and on Windows provisions MSYS2
      zsh into %LOCALAPPDATA%\\8sync\\zsh using Git for Windows' runtime.
"})]
pub struct Args {
    /// A session name (e.g. `core`) to create-or-resume, or a subcommand:
    /// `ls`, `new <name>`, `rm <name>`, `key`, `status`, or a forge passthrough.
    /// Empty = resume the latest session. Add `--tui` for Forge's TUI.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub rest: Vec<String>,
}

pub fn run(a: Args) -> Result<()> {
    let env = Env::detect()?;
    let cwd = std::env::current_dir().context("no cwd")?;
    let root = crate::verbs::here::detect_project_root(&cwd).unwrap_or(cwd);

    let (verb, rest) = a
        .rest
        .split_first()
        .map(|(v, r)| (v.as_str(), r))
        .unwrap_or(("", &[][..]));

    match verb {
        "status" => status(&env, &root),
        "ls" | "list" => cmd_ls(&env, &root),
        "key" | "set-key" => cmd_key(rest),
        "rm" => {
            let name = rest.first().context("usage: 8sync forge rm <name>")?;
            cmd_rm(&env, &root, name)
        }
        "new" => {
            let name = rest.first().context("usage: 8sync forge new <name>")?;
            open_session(&env, &root, name, true, &rest[1..])
        }
        "provider" | "config" | "workspace" | "mcp" | "vscode" | "banner" | "info" => {
            run_forge(&ensure_forge()?, &root, None, &a.rest)
        }
        "" | "--tui" => match sessions(&env, &root).load().last_used {
            Some(name) => open_session(&env, &root, &name, false, &a.rest),
            None => {
                ui::header("8sync forge");
                ui::info(&format!("project: {}", root.display()));
                ui::info("no Forge session yet in this repo — create one with: 8sync forge <name>");
                Ok(())
            }
        },
        _ if verb.starts_with('-') => run_forge(&ensure_forge()?, &root, None, &a.rest),
        name => open_session(&env, &root, name, false, rest),
    }
}

/// Create-or-resume `name`, then enter it: zsh by default, the TUI with `--tui`,
/// or a direct forge invocation when other arguments (e.g. `-p`) are given.
fn open_session(env: &Env, root: &Path, name: &str, refuse_existing: bool, extra: &[String]) -> Result<()> {
    let session = sessions(env, root).touch(name, refuse_existing)?;
    let forge = ensure_forge()?;

    ui::info(&format!("forge · {} · {}", session.name, root.display()));

    let tui = extra.iter().any(|a| a == "--tui");
    let args: Vec<String> = extra.iter().filter(|a| *a != "--tui").cloned().collect();
    if tui || !args.is_empty() {
        return run_forge(&forge, root, Some(&session.conversation_id), &args);
    }
    let zsh = ensure_zsh()?;
    launch_zsh(&forge, &zsh, env, root, &session)
}

fn run_forge(forge: &Path, root: &Path, conversation_id: Option<&str>, args: &[String]) -> Result<()> {
    let mut cmd = Command::new(forge);
    cmd.arg("-C").arg(root);
    if let Some(id) = conversation_id {
        cmd.arg("--conversation-id").arg(id);
    }
    let status = cmd.args(args).current_dir(root).status().context("could not exec forge")?;
    if !status.success() {
        ui::warn("forge exited non-zero");
    }
    Ok(())
}

// ── zsh-native shell ────────────────────────────────────────────────────────

/// Managed `.zshenv`: keep the user's own, but never let it move ZDOTDIR away
/// from the managed `.zshrc` that loads the Forge plugin.
const ZSHENV: &str = r#"# Managed by `8sync forge` — rewritten on every launch. Personal settings: ~/.zshenv
_8sync_zdot=$ZDOTDIR
[[ -r "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
ZDOTDIR=$_8sync_zdot
"#;

/// Managed `.zshrc`: the user's own rc, Forge's plugin, then 8sync's shared pro
/// zsh (`assets/configs/zsh/8sync.zsh` — prompt, keys, completion, plugins),
/// which picks up the Forge widgets and segment when they exist.
const ZSHRC: &str = r#"# Managed by `8sync forge` — rewritten on every launch. Personal settings: ~/.zshrc
_8s_zdot=$ZDOTDIR
[[ -r "$HOME/.zshrc" ]] && source "$HOME/.zshrc"
ZDOTDIR=$_8s_zdot
: ${HISTFILE:=$ZDOTDIR/.zsh_history}
# Forge's plugin ends with `compdef`, so the completion system must exist first
# (8sync.zsh skips its own compinit when it does).
autoload -Uz compinit
() {
  setopt local_options extended_glob
  local dump=$ZDOTDIR/.zcompdump
  if [[ -f $dump && -z $dump(#qN.mh+20) ]]; then compinit -C -d $dump; else compinit -u -d $dump; fi
}
source "$ZDOTDIR/forge-plugin.zsh"
source "$ZDOTDIR/forge-theme.zsh"
source "${ZDOTDIR:h}/zsh/8sync.zsh"
print -P "%8F: <prompt> asks Forge · :<Tab> commands · @<Tab> files · exit leaves%f"
"#;

/// Write 8sync's shared zsh config to `<config>/8sync/zsh/8sync.zsh`.
pub(crate) fn write_zsh_config(env: &Env) -> Result<PathBuf> {
    let path = env.xdg_config.join("8sync").join("zsh").join("8sync.zsh");
    let body = crate::assets::read("configs/zsh/8sync.zsh").context("bundled zsh config missing")?;
    std::fs::create_dir_all(path.parent().context("bad zsh config path")?)?;
    write_if_changed(&path, body.as_bytes())?;
    Ok(path)
}

pub(crate) struct Zsh {
    pub(crate) exe: PathBuf,
    /// Directories prepended to PATH (Windows: the private MSYS root + Git's coreutils).
    path_prefix: Vec<PathBuf>,
}

/// Start zsh with Forge's plugin and theme (regenerated from the installed forge
/// so they always match its version) and the session's conversation exported as
/// `_FORGE_CONVERSATION_ID`, which the plugin passes to every `: <prompt>`.
fn launch_zsh(forge: &Path, zsh: &Zsh, env: &Env, root: &Path, s: &uuid_sessions::Session) -> Result<()> {
    let zdot = env.xdg_config.join("8sync").join("forge-zsh");
    std::fs::create_dir_all(&zdot).with_context(|| format!("mkdir {}", zdot.display()))?;
    // Regenerate only when the forge binary changed (path · size · mtime): the two
    // `forge zsh` calls are most of the launch time.
    let stamp = std::fs::metadata(forge)
        .map(|m| format!("{}|{}|{:?}", forge.display(), m.len(), m.modified().ok()))
        .unwrap_or_default();
    let stamp_file = zdot.join(".forge-stamp");
    let fresh = ["forge-plugin.zsh", "forge-theme.zsh"].iter().all(|f| zdot.join(f).exists())
        && std::fs::read_to_string(&stamp_file).is_ok_and(|s| s == stamp);
    if !fresh {
        for (kind, file) in [("plugin", "forge-plugin.zsh"), ("theme", "forge-theme.zsh")] {
            let out = Command::new(forge)
                .args(["zsh", kind])
                .stdin(Stdio::null())
                .output()
                .context("could not run forge")?;
            if !out.status.success() || out.stdout.is_empty() {
                bail!("`forge zsh {kind}` failed: {}", String::from_utf8_lossy(&out.stderr).trim());
            }
            write_if_changed(&zdot.join(file), &out.stdout)?;
        }
        std::fs::write(&stamp_file, &stamp)?;
    }
    write_if_changed(&zdot.join(".zshenv"), ZSHENV.as_bytes())?;
    write_if_changed(&zdot.join(".zshrc"), ZSHRC.as_bytes())?;
    write_zsh_config(env)?;
    let plugins = ensure_zsh_plugins();

    let mut path = zsh.path_prefix.clone();
    path.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    let mut cmd = Command::new(&zsh.exe);
    cmd.arg("-i")
        .current_dir(root)
        .env("PATH", std::env::join_paths(path)?)
        .env("ZDOTDIR", shell_path(&zdot))
        .env("FORGE_BIN", shell_path(forge))
        .env("_FORGE_CONVERSATION_ID", &s.conversation_id)
        .env("EIGHTSYNC_FORGE_SESSION", &s.name);
    if let Some(dir) = plugins {
        cmd.env("EIGHTSYNC_ZSH_PLUGINS", shell_path(&dir));
    }
    let status = cmd.status().with_context(|| format!("could not start {}", zsh.exe.display()))?;
    if !status.success() {
        ui::warn("zsh exited non-zero");
    }
    Ok(())
}

/// Leave unchanged files alone so their mtimes (and zsh's caches) stay valid.
fn write_if_changed(path: &Path, bytes: &[u8]) -> Result<()> {
    if std::fs::read(path).is_ok_and(|old| old == bytes) {
        return Ok(());
    }
    std::fs::write(path, bytes).with_context(|| format!("write {}", path.display()))
}

/// Plugins sourced by the managed `.zshrc`: (dir, repo, tag, commit the tag must resolve to).
const ZSH_PLUGINS: [(&str, &str, &str, &str); 2] = [
    (
        "zsh-autosuggestions",
        "https://github.com/zsh-users/zsh-autosuggestions",
        "v0.7.1",
        "e52ee8ca55bcc56a17c828767a3f98f22a68d4eb",
    ),
    (
        "zsh-syntax-highlighting",
        "https://github.com/zsh-users/zsh-syntax-highlighting",
        "0.8.0",
        "db085e4661f6aafd24e5acb5b2e17e4dd5dddf3e",
    ),
];

/// Shallow-clone each pinned plugin once and check it landed on the pinned
/// commit. Best effort: the shell works without them, so offline or no git is
/// a warning, not an error. Returns the plugins directory.
pub(crate) fn ensure_zsh_plugins() -> Option<PathBuf> {
    let dir = dirs::data_local_dir()?.join("8sync").join("zsh-plugins");
    for (name, url, tag, commit) in ZSH_PLUGINS {
        let dst = dir.join(name);
        if std::fs::read_to_string(dst.join(".8sync-commit")).is_ok_and(|c| c.trim() == commit) {
            continue;
        }
        let stage = dir.join(format!(".{name}.{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&stage);
        let cloned = std::fs::create_dir_all(&dir).is_ok()
            && Command::new("git")
                .args(["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", tag, url])
                .arg(&stage)
                .stdin(Stdio::null())
                .stderr(Stdio::null()) // "tag is not a commit" chatter for annotated tags
                .status()
                .is_ok_and(|s| s.success());
        let head = Command::new("git").arg("-C").arg(&stage).args(["rev-parse", "HEAD"]).output();
        let pinned = cloned && head.is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == commit);
        if pinned && std::fs::write(stage.join(".8sync-commit"), commit).is_ok() {
            let _ = std::fs::remove_dir_all(&dst);
            if std::fs::rename(&stage, &dst).is_ok() {
                ui::ok(&format!("zsh plugin {name} {tag}"));
                continue;
            }
        }
        let _ = std::fs::remove_dir_all(&stage);
        ui::warn(&format!("zsh plugin {name} not installed (needs git + network); the shell works without it"));
    }
    Some(dir)
}

/// A path as zsh sees it. MSYS zsh takes POSIX paths: `C:\a\b` → `/c/a/b`.
fn shell_path(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    let b = s.as_bytes();
    if cfg!(windows) && b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        return format!("/{}{}", (b[0] as char).to_ascii_lowercase(), &s[2..]);
    }
    s
}

/// zsh from the system when it is there or installable without a password;
/// otherwise romkatv/zsh-bin's static, relocatable build (sha256-pinned) into
/// `~/.local/share/8sync/zsh` — so an unattended `curl | sh` never needs sudo.
#[cfg(not(windows))]
pub(crate) fn ensure_zsh() -> Result<Zsh> {
    let system = || which::which("zsh").ok().map(|exe| Zsh { exe, path_prefix: Vec::new() });
    if let Some(z) = system() {
        return Ok(z);
    }
    let root = zsh_root()?;
    let private = root.join("bin/zsh");
    if private.exists() {
        return Ok(Zsh { exe: private, path_prefix: Vec::new() });
    }
    if root_without_password() {
        let installed = if which::which("apt-get").is_ok() {
            // Debian/Ubuntu (incl. WSL) sits outside the pacman/dnf/brew core routes.
            let apt = "apt-get update -qq && apt-get install -y zsh";
            if is_root() {
                crate::pkg::run_loud("sh", &["-c", apt])
            } else {
                crate::pkg::run_loud("sudo", &["-n", "sh", "-c", apt])
            }
        } else {
            let names = crate::platform::CorePkg { arch: "zsh", fedora: "zsh", brew: "zsh", winget: "" };
            crate::platform::install_core_pkg("zsh", names)
        };
        if let (Ok(()), Some(z)) = (installed, system()) {
            return Ok(z);
        }
    }
    install_zsh_bin(&root)?;
    Ok(Zsh { exe: private, path_prefix: Vec::new() })
}

#[cfg(not(windows))]
fn is_root() -> bool {
    Command::new("id").arg("-u").output().is_ok_and(|o| o.stdout.starts_with(b"0\n"))
}

#[cfg(not(windows))]
fn root_without_password() -> bool {
    is_root()
        || Command::new("sudo")
            .args(["-n", "true"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

#[cfg(not(windows))]
const ZSH_BIN_RELEASE: &str = "https://github.com/romkatv/zsh-bin/releases/download/v6.1.1";

/// (asset, sha256) of the static zsh 5.8 build for this platform.
#[cfg(not(windows))]
fn zsh_bin_asset() -> Option<(&'static str, &'static str)> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => ("zsh-5.8-linux-x86_64.tar.gz", "6df668fb6e9a12874e0d80518d582f2e99e512d4a4532fa73d938360aaddc838"),
        ("linux", "aarch64") => ("zsh-5.8-linux-aarch64.tar.gz", "5caca77bcdaa218ec12e79f2e65c53c39058e0ed4f4f299991d18a800ca7c06d"),
        ("macos", "x86_64") => ("zsh-5.8-darwin-x86_64.tar.gz", "fba37a2fc286b0d8acfe73659a7ddce802689b8d5e76095d267651a182f7181f"),
        ("macos", "aarch64") => ("zsh-5.8-darwin-arm64.tar.gz", "db777549692029b7c1c0474cdc2affc2dc87a74a2971dfa7be1be1ffcab695e3"),
        _ => return None,
    })
}

/// Download, verify and unpack zsh-bin, then run its `relocate` script so the
/// baked-in function/terminfo paths point at `root`.
#[cfg(not(windows))]
fn install_zsh_bin(root: &Path) -> Result<()> {
    let (asset, sha) = zsh_bin_asset()
        .context("zsh is required for `8sync forge <name>` and there is no portable build for this platform — install zsh, or add `--tui`")?;
    ui::step(&format!("zsh (portable static build, no sudo) → {}", root.display()));
    let base = root.parent().context("bad zsh root")?;
    std::fs::create_dir_all(base)?;
    let tgz = base.join(asset);
    let stage = base.join(format!("zsh.new.{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&stage);
    let built = (|| -> Result<()> {
        download(&format!("{ZSH_BIN_RELEASE}/{asset}"), &tgz)?;
        let got = crate::verbs::selfup::sha256_file(&tgz).context("no sha256 tool to verify the zsh build")?;
        if !got.eq_ignore_ascii_case(sha) {
            bail!("checksum mismatch for {asset}: expected {sha}, got {got}");
        }
        std::fs::create_dir_all(&stage)?;
        crate::pkg::run_loud("tar", &["-xzf", &tgz.to_string_lossy(), "-C", &stage.to_string_lossy()])
    })();
    let _ = std::fs::remove_file(&tgz);
    if let Err(e) = built {
        let _ = std::fs::remove_dir_all(&stage);
        return Err(e);
    }
    let _ = std::fs::remove_dir_all(root);
    std::fs::rename(&stage, root)?;
    crate::pkg::run_loud("sh", &[&root.join("share/zsh/5.8/scripts/relocate").to_string_lossy()])?;
    ui::ok(&format!("zsh ready → {}", root.join("bin/zsh").display()));
    Ok(())
}

#[cfg(windows)]
const MSYS_REPO: &str = "https://repo.msys2.org/msys/x86_64";
#[cfg(windows)]
const ZSH_PKG: &str = "zsh-5.9.2-1-x86_64.pkg.tar.zst";
#[cfg(windows)]
const ZSH_PKG_SHA256: &str = "9a134200a152d90a0f1820d6aa74c3369d8539c068b523852549d74b16739fa8";
/// Runtime DLLs zsh.exe links against; Git for Windows ships the same MSYS2 builds.
#[cfg(windows)]
const MSYS_DLLS: [&str; 6] = [
    "msys-2.0.dll",
    "msys-iconv-2.dll",
    "msys-intl-8.dll",
    "msys-ncursesw6.dll",
    "msys-pcre2-8-0.dll",
    "msys-gcc_s-seh-1.dll",
];

/// The private zsh (Windows: MSYS root; elsewhere: the zsh-bin fallback).
fn zsh_root() -> Result<PathBuf> {
    Ok(dirs::data_local_dir().context("no local data dir")?.join("8sync").join("zsh"))
}

#[cfg(windows)]
pub(crate) fn ensure_zsh() -> Result<Zsh> {
    let git_bin = git_msys_bin()?;
    let root = zsh_root()?;
    let exe = root.join("usr/bin/zsh.exe");
    let current = std::fs::read_to_string(root.join(".8sync-zsh")).is_ok_and(|m| m.trim() == ZSH_PKG);
    if !(exe.exists() && current) {
        provision_zsh(&root, &git_bin)?;
    }
    Ok(Zsh { exe, path_prefix: vec![root.join("usr/bin"), git_bin] })
}

/// `<Git for Windows>/usr/bin`, located from `git --exec-path` rather than a
/// guessed install dir (Program Files, scoop, per-user installs all differ).
#[cfg(windows)]
fn git_msys_bin() -> Result<PathBuf> {
    const NEED_GIT: &str = "Git for Windows is required for the zsh shell (winget install Git.Git) — or add `--tui`";
    let out = Command::new("git").arg("--exec-path").output().context(NEED_GIT)?;
    let exec = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
    exec.ancestors()
        .map(|a| a.join("usr").join("bin"))
        .find(|b| b.join("msys-2.0.dll").exists())
        .context(NEED_GIT)
}

/// Git for Windows' `bin/bash.exe` — the real Git Bash, not the WSL launcher
/// `System32\bash.exe` that usually comes first on PATH.
#[cfg(windows)]
pub(crate) fn git_bash() -> Option<PathBuf> {
    let usr_bin = git_msys_bin().ok()?;
    let bash = usr_bin.parent()?.parent()?.join("bin").join("bash.exe");
    bash.exists().then_some(bash)
}

/// Unpack the pinned MSYS2 zsh package into a staging dir next to `root`, add
/// Git's runtime DLLs, terminfo and mount table, then swap it into place.
#[cfg(windows)]
fn provision_zsh(root: &Path, git_bin: &Path) -> Result<()> {
    ui::step("zsh runtime for Forge (MSYS2 zsh + Git for Windows runtime)");
    let base = root.parent().context("bad zsh root")?;
    std::fs::create_dir_all(base)?;
    let stage = base.join(format!("zsh.new.{}", std::process::id()));
    let pkg = base.join(ZSH_PKG);
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage)?;

    let built = (|| -> Result<()> {
        download(&format!("{MSYS_REPO}/{ZSH_PKG}"), &pkg)?;
        let got = crate::verbs::selfup::sha256_file(&pkg)
            .context("no sha256 tool (certutil) to verify the zsh package")?;
        if !got.eq_ignore_ascii_case(ZSH_PKG_SHA256) {
            bail!("checksum mismatch for {ZSH_PKG}: expected {ZSH_PKG_SHA256}, got {got}");
        }
        // Windows' bsdtar reads .zst natively; Git's GNU tar on PATH cannot.
        let tar = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
            .join("System32")
            .join("tar.exe");
        let ok = Command::new(&tar)
            .arg("-xf")
            .arg(&pkg)
            .arg("-C")
            .arg(&stage)
            .status()
            .with_context(|| format!("could not run {}", tar.display()))?
            .success();
        if !ok {
            bail!("{} could not unpack {ZSH_PKG} (needs Windows 10 1803+ with zstd support)", tar.display());
        }
        let bin = stage.join("usr").join("bin");
        for dll in MSYS_DLLS {
            std::fs::copy(git_bin.join(dll), bin.join(dll))
                .with_context(|| format!("copy {dll} from {}", git_bin.display()))?;
        }
        let git_root = git_bin.parent().and_then(Path::parent).context("bad Git root")?;
        copy_dir(&git_root.join("usr/share/terminfo"), &stage.join("usr/share/terminfo"))?;
        // Git's mount table: `/c/...` drive paths and `/tmp` = %TEMP%, so temp
        // paths agree between zsh and Git's coreutils.
        for f in ["fstab", "nsswitch.conf"] {
            std::fs::copy(git_root.join("etc").join(f), stage.join("etc").join(f))
                .with_context(|| format!("copy etc/{f} from {}", git_root.display()))?;
        }
        std::fs::create_dir_all(stage.join("tmp"))?;
        std::fs::write(stage.join(".8sync-zsh"), ZSH_PKG)?;
        Ok(())
    })();
    let _ = std::fs::remove_file(&pkg);
    if let Err(e) = built {
        let _ = std::fs::remove_dir_all(&stage);
        return Err(e);
    }
    if root.exists() {
        std::fs::remove_dir_all(root)
            .with_context(|| format!("remove old {} (exit running forge shells first)", root.display()))?;
    }
    std::fs::rename(&stage, root)?;
    ui::ok(&format!("zsh ready → {}", root.join("usr/bin/zsh.exe").display()));
    Ok(())
}

#[cfg(windows)]
fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src).with_context(|| format!("read {}", src.display()))? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

// ── Forge binary ────────────────────────────────────────────────────────────

/// The installed forge, or install it from the GitHub release. Same location as
/// Forge's own installer, so either install path finds the other.
pub(crate) fn ensure_forge() -> Result<PathBuf> {
    if let Some(p) = find_forge() {
        return Ok(p);
    }
    let asset = forge_asset().context("no Forge release for this OS/arch — see https://forgecode.dev/docs/")?;
    let dest = forge_install_path()?;
    ui::step(&format!("Installing Forge ({asset})"));
    download(&format!("{FORGE_RELEASE}/{asset}"), &dest)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))?;
    }
    #[cfg(windows)]
    add_user_path(dest.parent().context("bad forge path")?);
    ui::ok(&format!("forge → {}", dest.display()));
    Ok(dest)
}

fn find_forge() -> Option<PathBuf> {
    which::which("forge").ok().or_else(|| forge_install_path().ok().filter(|p| p.exists()))
}

fn forge_install_path() -> Result<PathBuf> {
    if cfg!(windows) {
        Ok(dirs::data_local_dir().context("no %LOCALAPPDATA%")?.join("Programs").join("Forge").join("forge.exe"))
    } else {
        Ok(dirs::home_dir().context("no home dir")?.join(".local").join("bin").join("forge"))
    }
}

fn forge_asset() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "forge-x86_64-pc-windows-msvc.exe",
        ("windows", "aarch64") => "forge-aarch64-pc-windows-msvc.exe",
        ("linux", "x86_64") => "forge-x86_64-unknown-linux-musl",
        ("linux", "aarch64") => "forge-aarch64-unknown-linux-musl",
        ("macos", "x86_64") => "forge-x86_64-apple-darwin",
        ("macos", "aarch64") => "forge-aarch64-apple-darwin",
        _ => return None,
    })
}

/// Download `url` to a temp sibling of `dest`, then rename it into place, so a
/// failed transfer never leaves a truncated file at `dest`.
pub(crate) fn download(url: &str, dest: &Path) -> Result<()> {
    let dir = dest.parent().context("bad download destination")?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(".8sync-dl.{}", std::process::id()));
    let ok = Command::new("curl")
        .args(["-fsSL", "--proto", "=https", "--tlsv1.2", "--retry", "3", "-o"])
        .arg(&tmp)
        .arg(url)
        .status()
        .context("curl not found")?
        .success();
    if !ok || std::fs::metadata(&tmp).map(|m| m.len() == 0).unwrap_or(true) {
        let _ = std::fs::remove_file(&tmp);
        bail!("download failed: {url}");
    }
    std::fs::rename(&tmp, dest).with_context(|| format!("install {}", dest.display()))
}

/// Persist `dir` on the user PATH (new terminals) and this process's PATH.
#[cfg(windows)]
fn add_user_path(dir: &Path) {
    let d = dir.display().to_string().replace('\'', "''");
    let script = format!(
        "$d='{d}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); \
         if (-not (($p -split ';') | Where-Object {{ $_.TrimEnd('\\') -ieq $d.TrimEnd('\\') }})) {{ \
         [Environment]::SetEnvironmentVariable('Path', (($p + ';' + $d).Trim(';')), 'User') }}"
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status();
    let mut path: Vec<PathBuf> = vec![dir.to_path_buf()];
    path.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    if let Ok(joined) = std::env::join_paths(path) {
        std::env::set_var("PATH", joined);
    }
}

// ── subcommands ─────────────────────────────────────────────────────────────

fn status(env: &Env, root: &Path) -> Result<()> {
    ui::header("8sync forge - status");
    match find_forge() {
        Some(forge) => {
            let ver = Command::new(&forge).arg("--version").stdin(Stdio::null()).output().ok();
            let ver = ver.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
            ui::ok(&format!("forge: {} ({ver})", forge.display()));
        }
        None => ui::warn("forge: not installed — `8sync forge <name>` installs it"),
    }
    let private = zsh_root()?.join(if cfg!(windows) { "usr/bin/zsh.exe" } else { "bin/zsh" });
    match which::which("zsh").ok().filter(|_| !cfg!(windows)).or_else(|| private.exists().then_some(private)) {
        Some(p) => ui::ok(&format!("zsh: {}", p.display())),
        None => ui::info("zsh: installed on first `8sync forge <name>` (no admin/sudo needed)"),
    }
    let plugins = dirs::data_local_dir().map(|d| d.join("8sync").join("zsh-plugins")).unwrap_or_default();
    for (name, _, tag, _) in ZSH_PLUGINS {
        if plugins.join(name).join(".8sync-commit").exists() {
            ui::ok(&format!("zsh plugin: {name} {tag}"));
        } else {
            ui::info(&format!("zsh plugin: {name} — installed on first `8sync forge <name>`"));
        }
    }
    let reg = sessions(env, root).load();
    println!();
    if reg.sessions.is_empty() {
        ui::info(&format!("no sessions recorded in {}", root.display()));
    } else {
        ui::info(&format!("sessions in {}:", root.display()));
        uuid_sessions::print(&reg);
    }
    Ok(())
}

fn cmd_ls(env: &Env, root: &Path) -> Result<()> {
    let reg = sessions(env, root).load();
    ui::header("8sync forge sessions");
    ui::info(&format!("project: {}", root.display()));
    if reg.sessions.is_empty() {
        ui::info("no sessions yet — create one with `8sync forge <name>`");
    } else {
        uuid_sessions::print(&reg);
    }
    Ok(())
}

fn cmd_rm(env: &Env, root: &Path, name: &str) -> Result<()> {
    let Some(s) = sessions(env, root).remove(name)? else {
        ui::warn(&format!("no session '{name}' found"));
        return Ok(());
    };
    // A session that never sent a prompt has no stored conversation; ignore that.
    if let Some(forge) = find_forge() {
        let _ = Command::new(forge)
            .args(["conversation", "delete", &s.conversation_id])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    ui::ok(&format!("removed session '{name}' ({})", s.conversation_id));
    Ok(())
}

fn sessions(env: &Env, root: &Path) -> Store {
    Store::new(env, root, "forge-sessions", "forge")
}

fn mask(key: &str) -> String {
    match (key.get(..8), key.len().checked_sub(6).and_then(|i| key.get(i..))) {
        (Some(head), Some(tail)) if key.len() > 14 => format!("{head}...{tail}"),
        _ => "***".to_string(),
    }
}

/// Store a provider API key in Forge's credential file (`~/.forge/.credentials.json`),
/// the same record `forge provider login` writes. Forge no longer reads keys from
/// environment variables, so nothing is written to `~/.env`.
fn cmd_key(rest: &[String]) -> Result<()> {
    let forge_dir = dirs::home_dir().context("cannot resolve home directory")?.join(".forge");
    let cred_file = forge_dir.join(".credentials.json");
    let mut credentials: Vec<serde_json::Value> = std::fs::read_to_string(&cred_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if rest.is_empty() {
        ui::header("8sync forge - keys");
        if credentials.is_empty() {
            ui::info("no provider keys yet — set one with: 8sync forge key <provider> <key>");
        }
        for item in &credentials {
            let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
            let key = item.pointer("/auth_details/api_key").and_then(|k| k.as_str());
            ui::ok(&format!("{id}: {}", key.map(mask).unwrap_or_else(|| "(oauth)".into())));
        }
        return Ok(());
    }

    let (provider, key) = match rest {
        [key] if key.starts_with("sk-ant") => ("anthropic".to_string(), key.clone()),
        [key] if key.starts_with("sk-or-") => ("open_router".to_string(), key.clone()),
        [key] if key.starts_with("sk-") => ("openai".to_string(), key.clone()),
        [_] => bail!("cannot infer the provider from this key — use: 8sync forge key <provider> <key>"),
        [provider, key, ..] => (provider.to_lowercase(), key.clone()),
        [] => unreachable!(),
    };

    let entry = serde_json::json!({ "id": provider, "auth_details": { "api_key": key } });
    match credentials.iter_mut().find(|c| c.get("id").and_then(|v| v.as_str()) == Some(&provider)) {
        Some(existing) => *existing = entry,
        None => credentials.push(entry),
    }
    std::fs::create_dir_all(&forge_dir)?;
    std::fs::write(&cred_file, serde_json::to_string_pretty(&credentials)?).context("write .credentials.json")?;
    ui::ok(&format!("set {provider} API key ({}) → {}", mask(&key), cred_file.display()));
    ui::info("pick the model inside the shell with `:model` (or `8sync forge <name> --tui`)");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{mask, shell_path};

    #[test]
    fn keys_never_print_in_full() {
        assert_eq!(mask("sk-ant-usr-0123456789abcdef"), "sk-ant-u...abcdef");
        assert_eq!(mask("short-key"), "***");
        assert_eq!(mask("sk-ant-é0123456789"), "***"); // non-ASCII boundary: no panic
    }

    #[test]
    fn zsh_paths_use_forward_slashes() {
        let p = shell_path(std::path::Path::new("a\\b/c"));
        assert_eq!(p, "a/b/c");
        if cfg!(windows) {
            assert_eq!(shell_path(std::path::Path::new("C:\\Users\\x")), "/c/Users/x");
        }
    }
}
