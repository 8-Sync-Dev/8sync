//! Session fence (Linux + systemd --user): `8sync ccc .` starts claude inside
//! `8sync-ccc.slice`, shared by every ccc session, with a soft memory cap and a
//! lower CPU/IO weight than the desktop. Under pressure the kernel reclaims and
//! slows the sessions (MemoryHigh throttles, it never kills) instead of freezing
//! the machine; when it is idle they run at full speed (weights only matter under
//! contention). Off: `EIGHTSYNC_FENCE=0` or `session_fence = false` in features.toml.
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub(super) const SLICE: &str = "8sync-ccc.slice";

/// The slice unit. Percentages are of physical RAM (systemd.resource-control(5)).
pub(super) fn slice_text() -> &'static str {
    "[Unit]\n\
     Description=8sync: Claude Code sessions (soft RAM cap, lower CPU/IO weight than the desktop)\n\
     \n\
     [Slice]\n\
     MemoryHigh=70%\n\
     CPUWeight=50\n\
     IOWeight=50\n"
}

/// Pure: env override (`0/off/false/no` → off, `1/on/true/yes` → on) beats the file; default on.
pub(super) fn resolve(env: Option<&str>, file: Option<bool>) -> bool {
    match env.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("0" | "off" | "false" | "no") => false,
        Some("1" | "on" | "true" | "yes") => true,
        _ => file.unwrap_or(true),
    }
}

/// Pure: the `systemd-run` argv that runs `program args` in the slice.
pub(super) fn fence_argv(program: &Path, args: &[OsString]) -> Vec<OsString> {
    let mut v: Vec<OsString> = ["--user", "--scope", "--quiet", "--collect", &format!("--slice={SLICE}"), "--"].iter().map(OsString::from).collect();
    v.push(program.as_os_str().to_owned());
    v.extend(args.iter().cloned());
    v
}

fn unit_dir(home: &Path) -> PathBuf {
    home.join(".config/systemd/user")
}

/// systemd --user is reachable (its private socket exists) and `systemd-run` is on PATH.
fn available() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let rt = std::env::var_os("XDG_RUNTIME_DIR")?;
    if !Path::new(&rt).join("systemd/private").exists() {
        return None;
    }
    which::which("systemd-run").ok()
}

/// Writes the slice unit when missing or changed (then `daemon-reload`).
fn ensure_slice(home: &Path) -> bool {
    let dir = unit_dir(home);
    let p = dir.join(SLICE);
    if std::fs::read_to_string(&p).is_ok_and(|s| s == slice_text()) {
        return true;
    }
    // tmp + rename: two sessions starting at once never see a half-written unit
    let tmp = dir.join(format!(".{SLICE}.{}", std::process::id()));
    if std::fs::create_dir_all(&dir).is_err() || std::fs::write(&tmp, slice_text()).is_err() || std::fs::rename(&tmp, &p).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    Command::new("systemctl").args(["--user", "daemon-reload"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

/// `cmd` wrapped in the fence, or `None` to run it as is (off, not Linux, no systemd --user).
pub(super) fn wrap(cmd: &Command, home: &Path) -> Option<Command> {
    let file = crate::verbs::harness::features::read_flag_key(home, "session_fence");
    if !resolve(std::env::var("EIGHTSYNC_FENCE").ok().as_deref(), file) {
        return None;
    }
    let run = available()?;
    if !ensure_slice(home) {
        return None;
    }
    // A scope that cannot start (no cgroup delegation, dbus error) would exit before claude
    // and look like claude failing: try a no-op scope first, else run unfenced.
    let ok = Command::new(&run)
        .args(fence_argv(Path::new("true"), &[]))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        return None;
    }
    Some(mirror(cmd, &run))
}

/// `cmd` re-targeted at `systemd-run`: same args after `--`, same env changes, same cwd.
pub(super) fn mirror(cmd: &Command, run: &Path) -> Command {
    let args: Vec<OsString> = cmd.get_args().map(|a| a.to_owned()).collect();
    let mut w = Command::new(run);
    w.args(fence_argv(Path::new(cmd.get_program()), &args));
    for (k, v) in cmd.get_envs() {
        match v {
            Some(v) => w.env(k, v),
            None => w.env_remove(k),
        };
    }
    if let Some(d) = cmd.get_current_dir() {
        w.current_dir(d);
    }
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fence_defaults_on_and_env_wins() {
        assert!(resolve(None, None));
        assert!(!resolve(Some("0"), Some(true)) && !resolve(None, Some(false)) && resolve(Some("on"), Some(false)));
    }

    #[test]
    fn argv_keeps_claude_args_after_the_separator() {
        let a: Vec<OsString> = ["--resume", "abc", "--settings", "{\"x\":1}"].iter().map(OsString::from).collect();
        let v = fence_argv(Path::new("/home/u/.local/bin/claude"), &a);
        let s: Vec<String> = v.iter().map(|x| x.to_string_lossy().into_owned()).collect();
        assert_eq!(&s[..6], ["--user", "--scope", "--quiet", "--collect", "--slice=8sync-ccc.slice", "--"]);
        assert_eq!(&s[6..], ["/home/u/.local/bin/claude", "--resume", "abc", "--settings", "{\"x\":1}"]);
    }

    #[test]
    fn slice_is_soft_never_a_hard_kill() {
        let t = slice_text();
        assert!(t.contains("MemoryHigh=70%") && t.contains("CPUWeight=50") && t.contains("IOWeight=50"));
        assert!(!t.contains("MemoryMax"), "MemoryMax would OOM-kill a session mid-task");
    }

    #[test]
    fn mirror_carries_args_env_and_cwd() {
        let mut c = Command::new("/bin/claude");
        c.args(["--resume", "x"]).env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1").env_remove("CLAUDECODE").current_dir("/tmp");
        let m = mirror(&c, Path::new("/usr/bin/systemd-run"));
        assert_eq!(m.get_program(), "/usr/bin/systemd-run");
        let args: Vec<String> = m.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(&args[5..], ["--", "/bin/claude", "--resume", "x"]);
        let envs: Vec<_> = m.get_envs().map(|(k, v)| (k.to_owned(), v.map(|v| v.to_owned()))).collect();
        assert!(envs.contains(&("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS".into(), Some("1".into()))));
        assert!(envs.contains(&("CLAUDECODE".into(), None)), "a removed var stays removed");
        assert_eq!(m.get_current_dir(), Some(Path::new("/tmp")));
    }
}
