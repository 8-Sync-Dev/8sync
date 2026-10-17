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
use anyhow::{bail, Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{BufRead, Read, Write};

const USAGE: &str = "usage: 8sync ccc term <session-id> [--cols 120] [--rows 34]   (cho HQ web: stdin JSON {\"i\":…}|{\"r\":[c,r]}, stdout = terminal)";

/// A session id as `claude agents --json` prints it: it goes back to `claude attach` as an argument.
pub(super) fn valid_id(s: &str) -> bool {
    (8..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

#[derive(Debug, PartialEq)]
pub(super) enum Ctl {
    Input(String),
    Resize(u16, u16),
}

fn size_ok(cols: u64, rows: u64) -> Option<(u16, u16)> {
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

pub(super) fn run(args: &[String]) -> Result<()> {
    let (mut id, mut cols, mut rows) = (None, 120u16, 34u16);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut num = |what: &str| -> Result<u64> { it.next().and_then(|v| v.parse().ok()).with_context(|| format!("{what} cần một số\n{USAGE}")) };
        match a.as_str() {
            "--cols" => cols = num("--cols")? as u16,
            "--rows" => rows = num("--rows")? as u16,
            x if id.is_none() && valid_id(x) => id = Some(x.to_string()),
            x => bail!("không rõ `{x}`\n{USAGE}"),
        }
    }
    let Some(id) = id else { bail!("cần session id\n{USAGE}") };
    let (cols, rows) = size_ok(cols.into(), rows.into()).context("--cols 2..500, --rows 2..300")?;
    let claude = which::which("claude").context("không thấy `claude` trong PATH")?;

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| anyhow::anyhow!("không mở được pseudo-terminal: {e}"))?;
    let mut cmd = CommandBuilder::new(claude);
    // `claude attach` matches the job's short id (first 8 hex); the full session uuid says "No job matching" (UAT 2026-10-18).
    cmd.args(["attach", &id[..8]]);
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }
    cmd.env("TERM", "xterm-256color");
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| anyhow::anyhow!("không chạy được `claude attach`: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| anyhow::anyhow!("{e}"))?;
    let mut writer = pair.master.take_writer().map_err(|e| anyhow::anyhow!("{e}"))?;

    // The terminal's output to HQ; when `claude attach` ends (the owner detached), so does this process.
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

    for line in std::io::stdin().lock().lines() {
        let Ok(l) = line else { break };
        match parse_line(&l) {
            Some(Ctl::Input(s)) => {
                if writer.write_all(s.as_bytes()).and_then(|_| writer.flush()).is_err() {
                    break;
                }
            }
            Some(Ctl::Resize(c, r)) => {
                let _ = pair.master.resize(PtySize { rows: r, cols: c, pixel_width: 0, pixel_height: 0 });
            }
            None => {}
        }
    }
    // HQ closed the terminal: stop the attach client only; the background room keeps running.
    let _ = child.kill();
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
        assert!(run(&a(&[])).is_err());
        assert!(run(&a(&["not-an-id!"])).is_err());
        assert!(run(&a(&["3698e3a6-9b73-4b37-ab3a-368b169d0508", "--cols", "0"])).is_err());
        assert!(run(&a(&["3698e3a6-9b73-4b37-ab3a-368b169d0508", "--rows"])).is_err());
    }
}
