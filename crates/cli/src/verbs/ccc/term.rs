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

const USAGE: &str = "usage: 8sync ccc term (<session-id> | <omp-room-id> [--takeover] | --shell) [--cols 120] [--rows 34]   (cho HQ web: stdin JSON {\"i\":…}|{\"r\":[c,r]}, stdout = terminal; --shell = shell trên máy, cwd hiện tại; --takeover = đóng omp đang mở phiên này ở terminal khác rồi mở tiếp ở đây)";

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
    /// Internal (`--host <omp-room-id> [--restore]`): run the room's omp for [`Target::Omp`] clients.
    Host { id: String, restore: bool },
}

/// `<session-id> | <omp-room-id> [--takeover] | --shell`, `--cols N`, `--rows N` — checked before anything starts.
pub(super) fn parse(args: &[String]) -> Result<(Target, u16, u16)> {
    let (mut id, mut shell, mut cols, mut rows) = (None, false, 120u64, 34u64);
    let (mut takeover, mut host, mut restore) = (false, false, false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut num = |what: &str| -> Result<u64> { it.next().and_then(|v| v.parse().ok()).with_context(|| format!("{what} cần một số\n{USAGE}")) };
        match a.as_str() {
            "--cols" => cols = num("--cols")?,
            "--rows" => rows = num("--rows")?,
            "--shell" => shell = true,
            "--takeover" => takeover = true,
            "--host" => host = true,
            "--restore" => restore = true,
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
    let target = match (id, shell) {
        (Some(_), true) => bail!("--shell và session id không đi cùng nhau\n{USAGE}"),
        (Some(id), false) if host => Target::Host { id, restore },
        (Some(id), false) if omp => Target::Omp { id, takeover },
        (Some(id), false) => Target::Attach(id),
        (None, true) => Target::Shell,
        (None, false) => bail!("cần session id hoặc --shell\n{USAGE}"),
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
        Target::Omp { id, takeover } => {
            // HQ shows only stdout: the reason goes into the terminal too.
            let r = super::omp_term::client(env, id, cols, rows, *takeover);
            if let Err(e) = &r {
                print!("\r\nKhông mở được phiên omp: {e:#}\r\n");
                let _ = std::io::stdout().flush();
            }
            return r;
        }
        Target::Host { id, restore } => return super::omp_term::host_logged(env, id, *restore, cols, rows),
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
}
