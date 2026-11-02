//! `8sync ccc term <session-id> [--cols N] [--rows N]`: the room's terminal for the HQ web UI.
//!
//! Owner (2026-10-18): "mở terminal ở web luôn được không". Claude Code documents no way to send
//! input to a background session from outside (https://code.claude.com/docs/en/agent-view: a
//! permission dialog is answered by attaching), so this runs `claude attach <id>` inside a
//! pseudo-terminal (ConPTY on Windows) and relays it:
//! - stdout: the terminal's raw bytes, for xterm.js;
//! - stdin: one JSON object per line, `{"i":"<keys>"}` typed into the terminal or `{"r":[cols,rows]}`.
//!
//! When stdin closes (HQ dropped the terminal) only the `claude attach` client is stopped: the room
//! keeps running in the background, as when its terminal window is closed.
//!
//! `--shell` (owner 2026-10-19, "terminal như Orca") runs a plain interactive shell on this PC
//! instead, in the current dir: 8sync's zsh (its prompt + autosuggestions) when already installed,
//! else PowerShell on Windows / `$SHELL` elsewhere. Nothing is installed or downloaded here.
//!
//! An omp room id (`omp-<16 hex>`, owner 2026-10-21 "omp vẫn sài được chứ"): omp has no attach, so
//! the room's omp runs in a detachable host and this relays it with the same protocol (omp_term.rs).
use crate::env_detect::Env;
use crate::verbs::forge;
use anyhow::{bail, Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{BufRead, Read, Write};

const USAGE: &str = "usage: 8sync ccc term (<session-id> | <omp-room-id> [--takeover] | --omp-new <name> [--model <m>] | --shell) [--cols 120] [--rows 34]   (cho HQ web: stdin JSON {\"i\":…}|{\"r\":[c,r]}, stdout = terminal; --shell = shell trên máy, cwd hiện tại; --takeover = đóng omp đang mở phiên này ở terminal khác rồi mở tiếp ở đây; --omp-new = tạo hoặc mở lại phiên omp <name> của thư mục hiện tại, như `8sync . <name>`)";

/// A session id as `claude agents --json` prints it: it goes back to `claude attach` as an argument.
pub(super) fn valid_id(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[derive(Debug, PartialEq)]
pub(super) enum Ctl {
    Input(String),
    Resize(u16, u16),
}

pub(super) fn size_ok(cols: u64, rows: u64) -> Option<(u16, u16)> {
    ((2..=500).contains(&cols) && (2..=300).contains(&rows)).then_some((cols as u16, rows as u16))
}

/// One control line from HQ; anything else is ignored.
pub(super) fn parse_line(l: &str) -> Option<Ctl> {
    let v: serde_json::Value = serde_json::from_str(l).ok()?;
    if let Some(s) = v["i"].as_str() {
        return Some(Ctl::Input(s.to_string()));
    }
    let r = v["r"].as_array()?;
    let (c, w) = size_ok(r.first()?.as_u64()?, r.get(1)?.as_u64()?)?;
    Some(Ctl::Resize(c, w))
}

#[derive(Debug, PartialEq)]
pub(super) enum Target {
    Attach(String),
    Shell,
    /// An omp room: relay its host, starting it (or taking the session over) first.
    Omp { id: String, takeover: bool },
    /// `--omp-new <name> [--model m]` (HQ "Phiên mới"): `8sync . <name>` of the current dir — the
    /// session created when new, its context seeded — then relayed like [`Target::Omp`].
    OmpNew { name: String, model: Option<String> },
    /// Internal (`--host <omp-room-id> [--restore] [--model m]`): run the room's omp for [`Target::Omp`] clients.
    Host { id: String, restore: bool, model: Option<String> },
}

/// A session name `8sync . <name>` creates rather than reads as one of its verbs.
pub(super) fn valid_session_name(s: &str) -> bool {
    crate::verbs::session::valid_name(s) && !matches!(s, "ls" | "list" | "rm" | "mv" | "merge" | "new")
}

/// An omp `--model` value (`provider/model[:thinking]`): it becomes an argument, never a flag.
pub(super) fn valid_model(s: &str) -> bool {
    (1..=128).contains(&s.len())
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'.' | b'_' | b'-' | b':' | b'@'))
}

/// `<session-id> | <omp-room-id> [--takeover] | --omp-new <name> [--model m] | --shell`, `--cols N`,
/// `--rows N` — checked before anything starts.
pub(super) fn parse(args: &[String]) -> Result<(Target, u16, u16)> {
    let (mut id, mut shell, mut cols, mut rows) = (None, false, 120u64, 34u64);
    let (mut takeover, mut host, mut restore) = (false, false, false);
    let (mut new, mut model) = (None::<String>, None::<String>);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--cols" | "--rows" => {
                let n = it.next().and_then(|v| v.parse().ok()).with_context(|| format!("{a} cần một số\n{USAGE}"))?;
                if a == "--cols" { cols = n } else { rows = n }
            }
            "--shell" => shell = true,
            "--takeover" => takeover = true,
            "--host" => host = true,
            "--restore" => restore = true,
            "--omp-new" => {
                let n = it.next().filter(|n| valid_session_name(n)).with_context(|| format!("--omp-new cần tên phiên (chữ, số, '-', '_', '.'; ≤64 ký tự)\n{USAGE}"))?;
                new = Some(n.clone());
            }
            "--model" => {
                let m = it.next().filter(|m| valid_model(m)).with_context(|| format!("--model cần tên model (vd zai/glm-5.3)\n{USAGE}"))?;
                model = Some(m.clone());
            }
            x if id.is_none() && (valid_id(x) || super::omp_term::valid_room_id(x)) => id = Some(x.to_string()),
            x => bail!("không rõ `{x}`\n{USAGE}"),
        }
    }
    let omp = id.as_deref().is_some_and(super::omp_term::valid_room_id);
    if (takeover || host || restore) && !omp {
        bail!("--takeover/--host/--restore chỉ dùng với id phòng omp\n{USAGE}");
    }
    if host && takeover || restore && !host {
        bail!("--restore chỉ đi với --host, --takeover không đi với --host\n{USAGE}");
    }
    if model.is_some() && new.is_none() && !host {
        bail!("--model chỉ đi với --omp-new\n{USAGE}");
    }
    let target = match (id, shell, new) {
        (Some(_), _, Some(_)) | (None, true, Some(_)) => bail!("--omp-new không đi cùng session id hay --shell\n{USAGE}"),
        (None, false, Some(name)) => Target::OmpNew { name, model },
        (Some(_), true, None) => bail!("--shell và session id không đi cùng nhau\n{USAGE}"),
        (Some(id), false, None) if host => Target::Host { id, restore, model },
        (Some(id), false, None) if omp => Target::Omp { id, takeover },
        (Some(id), false, None) => Target::Attach(id),
        (None, true, None) => Target::Shell,
        (None, false, None) => bail!("cần session id, --omp-new hoặc --shell\n{USAGE}"),
    };
    let (cols, rows) = size_ok(cols, rows).context("--cols 2..500, --rows 2..300")?;
    Ok((target, cols, rows))
}

/// The shell for `--shell`, from what is already installed (see the module doc).
fn shell_command(env: &Env) -> Result<CommandBuilder> {
    if let Some(zsh) = forge::installed_zsh() {
        let zdot = forge::write_shell_zdotdir(env)?;
        let mut cmd = CommandBuilder::new(&zsh.exe);
        cmd.arg("-i");
        cmd.env("PATH", zsh.path_env()?);
        cmd.env("ZDOTDIR", forge::shell_path(&zdot));
        if let Some(dir) = forge::zsh_plugins_if_present() {
            cmd.env("EIGHTSYNC_ZSH_PLUGINS", forge::shell_path(&dir));
        }
        return Ok(cmd);
    }
    if cfg!(windows) {
        let exe = which::which("pwsh").or_else(|_| which::which("powershell.exe")).context("không thấy zsh, pwsh hay powershell.exe")?;
        let mut cmd = CommandBuilder::new(exe);
        cmd.arg("-NoLogo");
        return Ok(cmd);
    }
    let sh = std::env::var_os("SHELL").filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/sh".into());
    let mut cmd = CommandBuilder::new(sh);
    cmd.arg("-i");
    Ok(cmd)
}

/// A child in a pseudo-terminal (ConPTY on Windows): its output, its input, and the size knob.
pub(super) struct Pty {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
}

impl Pty {
    /// Runs `cmd` (in the current dir unless it has its own) in a `cols`×`rows` terminal.
    pub(super) fn spawn(mut cmd: CommandBuilder, cols: u16, rows: u16) -> Result<Pty> {
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| anyhow::anyhow!("không mở được pseudo-terminal: {e}"))?;
        if cmd.get_cwd().is_none() {
            if let Ok(cwd) = std::env::current_dir() {
                cmd.cwd(cwd);
            }
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        let child = pair.slave.spawn_command(cmd).map_err(|e| anyhow::anyhow!("không chạy được terminal: {e}"))?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|e| anyhow::anyhow!("{e}"))?;
        let writer = pair.master.take_writer().map_err(|e| anyhow::anyhow!("{e}"))?;
        Ok(Pty { master: pair.master, child, reader, writer })
    }
}

/// An omp client's result, its error also written into the terminal (HQ shows only stdout).
fn shown(r: Result<()>) -> Result<()> {
    if let Err(e) = &r {
        print!("\r\nKhông mở được phiên omp: {e:#}\r\n");
        let _ = std::io::stdout().flush();
    }
    r
}

pub(super) fn run(args: &[String], env: &Env) -> Result<()> {
    let (target, cols, rows) = parse(args)?;
    let cmd = match &target {
        Target::Attach(id) => {
            let mut cmd = CommandBuilder::new(which::which("claude").context("không thấy `claude` trong PATH")?);
            // `claude attach` matches the job's short id (first 8 hex); the full session uuid says "No job matching" (UAT 2026-10-18).
            cmd.args(["attach", &id[..8]]);
            cmd
        }
        Target::Shell => shell_command(env)?,
        Target::Omp { id, takeover } => return shown(super::omp_term::client(env, id, cols, rows, *takeover, None)),
        Target::OmpNew { name, model } => return shown(super::omp_term::new_session(env, name, model.as_deref(), cols, rows)),
        Target::Host { id, restore, model } => return super::omp_term::host_logged(env, id, *restore, model.as_deref(), cols, rows),
    };

    let Pty { master, mut child, mut reader, mut writer } = Pty::spawn(cmd, cols, rows)?;
    let mut killer = child.clone_killer();
    // The terminal's output to HQ; when the child ends (the owner detached / typed `exit`), so does this process.
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut out = std::io::stdout().lock();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 || out.write_all(&buf[..n]).and_then(|_| out.flush()).is_err() {
                break;
            }
        }
        std::process::exit(0);
    });
    // ConPTY keeps the output pipe open after the child exits, so the reader alone may never see
    // EOF: when the child ends, let its last bytes drain, then exit.
    std::thread::spawn(move || {
        let code = child.wait().map_or(1, |s| s.exit_code() as i32);
        std::thread::sleep(std::time::Duration::from_millis(300));
        std::process::exit(code);
    });

    for line in std::io::stdin().lock().lines() {
        let Ok(l) = line else { break };
        match parse_line(&l) {
            Some(Ctl::Input(s)) => {
                if writer.write_all(s.as_bytes()).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
            Some(Ctl::Resize(c, r)) => {
                let _ = master.resize(PtySize { rows: r, cols: c, pixel_width: 0, pixel_height: 0 });
            }
            None => {}
        }
    }
    // HQ closed the terminal: stop the client only (an attached room keeps running in the background).
    let _ = killer.kill();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_control_lines_are_strict() {
        assert!(valid_id("3698e3a6-9b73-4b37-ab3a-368b169d0508"));
        assert!(!valid_id("../etc") && !valid_id("abc") && !valid_id("3698e3a6 --x"));
        assert_eq!(parse_line(r#"{"i":"1\r"}"#), Some(Ctl::Input("1\r".into())));
        assert_eq!(parse_line(r#"{"r":[100,30]}"#), Some(Ctl::Resize(100, 30)));
        for bad in [r#"{"r":[0,30]}"#, r#"{"r":[9000,30]}"#, r#"{"r":"x"}"#, "not json", "{}"] {
            assert_eq!(parse_line(bad), None, "{bad}");
        }
    }

    #[test]
    fn bad_arguments_are_refused_before_anything_runs() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let id = "3698e3a6-9b73-4b37-ab3a-368b169d0508";
        assert!(parse(&a(&[])).is_err());
        assert!(parse(&a(&["not-an-id!"])).is_err());
        assert!(parse(&a(&[id, "--cols", "0"])).is_err());
        assert!(parse(&a(&[id, "--rows"])).is_err());
        assert!(parse(&a(&[id, "--shell"])).is_err() && parse(&a(&["--shell", id])).is_err());
        assert!(parse(&a(&["--shell", "--rows", "900"])).is_err());
        assert!(parse(&a(&["--shell", "--cols", "70000"])).is_err(), "no u16 wrap-around");
        assert_eq!(parse(&a(&["--shell"])).unwrap(), (Target::Shell, 120, 34));
        assert_eq!(parse(&a(&["--shell", "--cols", "80", "--rows", "24"])).unwrap(), (Target::Shell, 80, 24));
        assert_eq!(parse(&a(&[id])).unwrap(), (Target::Attach(id.into()), 120, 34));
    }

    #[test]
    fn omp_new_takes_a_safe_name_and_model_only() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let new = |n: &str, m: Option<&str>| Target::OmpNew { name: n.into(), model: m.map(String::from) };
        assert_eq!(parse(&a(&["--omp-new", "fix-login"])).unwrap(), (new("fix-login", None), 120, 34));
        assert_eq!(parse(&a(&["--omp-new", "ui.v2", "--model", "zai/glm-5.3", "--cols", "90", "--rows", "30"])).unwrap(), (new("ui.v2", Some("zai/glm-5.3")), 90, 30));
        assert_eq!(parse(&a(&["--model", "anthropic/claude-opus:high", "--omp-new", "a"])).unwrap().0, new("a", Some("anthropic/claude-opus:high")));
        for bad in [
            &["--omp-new"][..],
            &["--omp-new", "../x"],
            &["--omp-new", "a b"],
            &["--omp-new", ".."],
            &["--omp-new", "ls"],
            &["--omp-new", "new"],
            &["--omp-new", &"x".repeat(65)],
            &["--omp-new", "a", "--model"],
            &["--omp-new", "a", "--model", "--continue"],
            &["--omp-new", "a", "--model", "m;rm"],
            &["--omp-new", "a", "--shell"],
            &["--omp-new", "a", "omp-0123456789abcdef"],
            &["--omp-new", "a", "--takeover"],
            &["--shell", "--model", "zai/glm-5.3"],
            &["omp-0123456789abcdef", "--model", "zai/glm-5.3"],
        ] {
            assert!(parse(&a(bad)).is_err(), "{bad:?}");
        }
    }
}
