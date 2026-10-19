//! `8sync ccc awake [--while-rooms] [--hours N]` (also `8sync awake …`): keep the machine from
//! sleeping while rooms work; the screen may still turn off. Owner (2026-10-19): rooms died
//! overnight with the machine ("tắt máy … mở máy lên hiển thị đang làm nhưng mà lại không có
//! làm"); room `core` researched the options and proposed `awake --while-rooms`.
//!
//! - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` (kernel32, no crate);
//!   Linux: `systemd-inhibit --what=sleep:idle … sleep infinity`; macOS: `caffeinate -i`. The
//!   hold ends with this process (Ctrl+C, `--hours`, or no room left).
//! - `--while-rooms`: checks `claude agents --json` every minute and lets go after two checks in a
//!   row with no live Claude Code session.
//! - Never starts a room and never renews the auto lease; capped at 24 h. A closed laptop lid
//!   still sleeps, and a shutdown still kills the rooms (`auto revive` brings them back).
use std::time::{Duration, Instant};

use anyhow::{bail, Result};

pub(super) const USAGE: &str = "usage: 8sync ccc awake [--while-rooms] [--hours N]   (mặc định 8 giờ, tối đa 24)";

const DEFAULT_HOURS: f64 = 8.0;
const MAX_HOURS: f64 = 24.0;
const EVERY: Duration = Duration::from_secs(60);

#[derive(Debug, PartialEq)]
pub(super) struct Opts {
    pub while_rooms: bool,
    pub hours: f64,
}

pub(super) fn parse(rest: &[String]) -> Result<Opts> {
    let mut o = Opts { while_rooms: false, hours: DEFAULT_HOURS };
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--while-rooms" => o.while_rooms = true,
            "--hours" => {
                let v = it.next().and_then(|v| v.parse::<f64>().ok()).filter(|h| h.is_finite() && *h > 0.0);
                let Some(h) = v else { bail!("--hours cần một số > 0\n{USAGE}") };
                o.hours = h.min(MAX_HOURS);
            }
            "-h" | "--help" => bail!("{USAGE}"),
            x => bail!("không rõ `{x}`\n{USAGE}"),
        }
    }
    Ok(o)
}

/// The command that holds the machine awake on this OS while it runs; None on Windows (an API
/// call instead) and where no tool exists.
pub(super) fn hold_argv(os: &str) -> Option<&'static [&'static str]> {
    match os {
        "linux" => Some(&["systemd-inhibit", "--what=sleep:idle", "--who=8sync", "--why=8sync rooms running", "--mode=block", "sleep", "infinity"]),
        "macos" => Some(&["caffeinate", "-i"]),
        _ => None,
    }
}

#[cfg(windows)]
mod win {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    pub fn hold() -> bool {
        // SAFETY: plain Win32 call with constant flags; no pointers.
        unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) != 0 }
    }

    pub fn release() {
        // SAFETY: as above.
        unsafe {
            SetThreadExecutionState(ES_CONTINUOUS);
        }
    }
}

/// The OS hold; dropping it lets the machine sleep again.
struct Hold(Option<std::process::Child>);

impl Hold {
    fn take() -> Result<Hold> {
        #[cfg(windows)]
        {
            if !win::hold() {
                bail!("Windows từ chối SetThreadExecutionState");
            }
            Ok(Hold(None))
        }
        #[cfg(not(windows))]
        {
            let Some(argv) = hold_argv(std::env::consts::OS) else { bail!("chưa hỗ trợ giữ máy thức trên {}", std::env::consts::OS) };
            let child = std::process::Command::new(argv[0])
                .args(&argv[1..])
                .stdin(std::process::Stdio::null())
                .spawn()
                .map_err(|e| anyhow::anyhow!("không chạy được `{}`: {e}", argv[0]))?;
            Ok(Hold(Some(child)))
        }
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        #[cfg(windows)]
        win::release();
        if let Some(c) = self.0.as_mut() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// Live Claude Code sessions on this machine (background rooms and terminals), from `claude agents`.
fn live_rooms(claude: &dyn super::team::Claude) -> Result<usize> {
    Ok(super::team::live(&claude.run(&["agents".into(), "--json".into()])?)?.len())
}

pub(super) fn run(o: &Opts, claude: &dyn super::team::Claude, subscription: bool) -> Result<()> {
    if o.while_rooms && live_rooms(claude)? == 0 {
        println!("không có phòng Claude Code nào đang chạy — không giữ máy thức.");
        return Ok(());
    }
    let _hold = Hold::take()?;
    let until = if o.while_rooms { "không còn phòng nào chạy" } else { "Ctrl+C" };
    println!("giữ máy thức (màn hình vẫn tắt được) tới khi hết {} giờ hoặc {until}. Gập nắp laptop / tắt máy thì phòng vẫn dừng (`8sync ccc auto revive` mở lại).", o.hours);
    if subscription {
        println!("gói subscription: auto vẫn theo lease ≤ 4 giờ khi anh có mặt; chạy không người trông nhiều giờ thì dùng Routines (`/schedule`) hoặc Console API key.");
    }
    let deadline = Instant::now() + Duration::from_secs_f64(o.hours * 3600.0);
    let mut empty = 0;
    loop {
        std::thread::sleep(EVERY);
        if Instant::now() >= deadline {
            println!("hết {} giờ — nhả, máy được ngủ lại.", o.hours);
            return Ok(());
        }
        if o.while_rooms {
            // A failed `claude agents` call counts as "still running": never let go on a glitch.
            empty = if live_rooms(claude).unwrap_or(1) == 0 { empty + 1 } else { 0 };
            if empty >= 2 {
                println!("không còn phòng nào chạy — nhả, máy được ngủ lại.");
                return Ok(());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_flags_and_caps_the_hours() {
        assert_eq!(parse(&[]).unwrap(), Opts { while_rooms: false, hours: 8.0 });
        assert_eq!(parse(&args(&["--while-rooms", "--hours", "2.5"])).unwrap(), Opts { while_rooms: true, hours: 2.5 });
        assert_eq!(parse(&args(&["--hours", "100"])).unwrap().hours, 24.0, "never more than a day");
        for bad in [&["--hours"][..], &["--hours", "0"], &["--hours", "x"], &["--hours", "NaN"], &["--forever"]] {
            assert!(parse(&args(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn holds_with_the_os_tool_and_blocks_sleep_not_the_screen() {
        let linux = hold_argv("linux").unwrap();
        assert_eq!(linux[0], "systemd-inhibit");
        assert!(linux.contains(&"--what=sleep:idle") && !linux.iter().any(|a| a.contains("handle-lid")), "sleep only; the lid is the owner's call");
        assert_eq!(hold_argv("macos").unwrap(), ["caffeinate", "-i"], "idle sleep only, the display may sleep");
        assert!(hold_argv("windows").is_none() && hold_argv("freebsd").is_none());
    }
}
