//! `8sync ccc awake [--while-rooms] [--hours N]` (also `8sync awake …`): keep the machine from
//! sleeping while rooms work; the screen may still turn off. Owner (2026-10-19): rooms died
//! overnight with the machine ("tắt máy … mở máy lên hiển thị đang làm nhưng mà lại không có
//! làm"); room `core` researched the options and proposed `awake --while-rooms`.
//!
//! - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` (kernel32, no crate);
//!   Linux: `systemd-inhibit --what=sleep:idle … tail --pid=<8sync> -f /dev/null`; macOS:
//!   `caffeinate -i -w <8sync>`. Both end with this process even when it is killed; the hold ends
//!   with Ctrl+C, `--hours`, or no room left.
//! - `--while-rooms`: checks `claude agents --json` every minute and lets go after two checks in a
//!   row with no live Claude Code session.
//! - Never starts a room and never renews the auto lease; capped at 24 h. A closed laptop lid
//!   still sleeps, and a shutdown still kills the rooms (`auto revive` brings them back).
//! - `awake status [--json]`: what the OS says right now (held awake?, screen on/off, idle since
//!   the last mouse/keyboard input, time asleep since boot). HQ polls the JSON every ~30 s.
use std::time::{Duration, Instant};

use anyhow::{bail, Result};

pub(super) const USAGE: &str = "usage: 8sync ccc awake [--while-rooms] [--hours N]   (mặc định 8 giờ, tối đa 24)\n       8sync ccc awake status [--json]   (máy có đang thức, màn hình, lần cuối đụng chuột/phím)";

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

/// The command that holds the machine awake on this OS while process `pid` (8sync itself) lives:
/// the tool exits with it, even on a kill. None on Windows (an API call instead) and where no tool
/// exists.
pub(super) fn hold_argv(os: &str, pid: u32) -> Option<Vec<String>> {
    let v: Vec<String> = match os {
        "linux" => vec![
            "systemd-inhibit".into(),
            "--what=sleep:idle".into(),
            "--who=8sync".into(),
            "--why=8sync rooms running".into(),
            "--mode=block".into(),
            "tail".into(),
            format!("--pid={pid}"),
            "-f".into(),
            "/dev/null".into(),
        ],
        "macos" => vec!["caffeinate".into(), "-i".into(), "-w".into(), pid.to_string()],
        _ => return None,
    };
    Some(v)
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
            let Some(argv) = hold_argv(std::env::consts::OS, std::process::id()) else { bail!("chưa hỗ trợ giữ máy thức trên {}", std::env::consts::OS) };
            let mut child = std::process::Command::new(&argv[0])
                .args(&argv[1..])
                .stdin(std::process::Stdio::null())
                .spawn()
                .map_err(|e| anyhow::anyhow!("không chạy được `{}`: {e}", argv[0]))?;
            // A tool that refuses (no logind, bad flag) exits at once: say so instead of a fake hold.
            std::thread::sleep(Duration::from_millis(300));
            if child.try_wait()?.is_some() {
                bail!("không giữ được máy thức: {} thoát ngay", argv[0]);
            }
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

/// `claude` is only needed (and only resolved by the caller) with `--while-rooms`.
pub(super) fn run(o: &Opts, claude: Option<&dyn super::team::Claude>, subscription: bool) -> Result<()> {
    let watch = match (o.while_rooms, claude) {
        (true, Some(c)) => Some(c),
        (true, None) => bail!("--while-rooms cần `claude` để xem phòng nào đang chạy"),
        (false, _) => None,
    };
    if let Some(c) = watch {
        if live_rooms(c)? == 0 {
            println!("không có phòng Claude Code nào đang chạy — không giữ máy thức.");
            return Ok(());
        }
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
        if let Some(c) = watch {
            // A failed `claude agents` call counts as "still running": never let go on a glitch.
            empty = if live_rooms(c).unwrap_or(1) == 0 { empty + 1 } else { 0 };
            if empty >= 2 {
                println!("không còn phòng nào chạy — nhả, máy được ngủ lại.");
                return Ok(());
            }
        }
    }
}

/// What the OS says right now; None = unknown on this OS. Serialized as-is: the HQ contract.
#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub(super) struct Status {
    pub schema: u8,
    /// Something keeps the system from idle-sleeping (system-wide aggregate, not this process).
    pub held: Option<bool>,
    pub display_required: Option<bool>,
    /// "on" | "off" | "dim".
    pub display: Option<&'static str>,
    /// Seconds since the last keyboard/mouse input.
    pub idle_s: Option<u64>,
    /// Seconds since boot, sleep included.
    pub boot_s: Option<u64>,
    /// Seconds asleep since boot.
    pub slept_s: Option<u64>,
    pub modern_standby: Option<bool>,
}

/// `8sync ccc awake status [--json]`. Exit 0 whenever it ran, even with unknown fields.
pub(super) fn status(rest: &[String]) -> Result<()> {
    let json = match rest {
        [] => false,
        [j] if j == "--json" => true,
        _ => bail!("{USAGE}"),
    };
    let s = probe();
    if json {
        println!("{}", status_json(&s));
    } else {
        let t = status_text(&s);
        println!("{}", if t.is_empty() { format!("không đọc được trạng thái máy trên {}", std::env::consts::OS) } else { t });
    }
    Ok(())
}

pub(super) fn status_json(s: &Status) -> String {
    serde_json::to_string(s).unwrap_or_default()
}

/// "6 giờ 9 phút", "2 ngày 3 giờ", "45 phút" (under a minute is "0 phút").
pub(super) fn dur_vi(secs: u64) -> String {
    let (d, h, m) = (secs / 86_400, secs % 86_400 / 3600, secs % 3600 / 60);
    match (d, h, m) {
        (0, 0, m) => format!("{m} phút"),
        (0, h, 0) => format!("{h} giờ"),
        (0, h, m) => format!("{h} giờ {m} phút"),
        (d, 0, _) => format!("{d} ngày"),
        (d, h, _) => format!("{d} ngày {h} giờ"),
    }
}

/// ≤ 2 short lines for a human; unknown fields are left out, "" when nothing is known.
pub(super) fn status_text(s: &Status) -> String {
    let mut l1 = Vec::new();
    match s.held {
        Some(true) => l1.push("máy thức: có (có tiến trình giữ không cho ngủ)".to_string()),
        Some(false) => l1.push("máy thức: không ai giữ — rảnh lâu là máy tự ngủ".to_string()),
        None => {}
    }
    if let Some(d) = s.display {
        let d = match d {
            "on" => "bật",
            "off" => "tắt",
            _ => "mờ",
        };
        let keep = if s.display_required == Some(true) { " (có app giữ màn hình sáng)" } else { "" };
        l1.push(format!("màn hình: {d}{keep}"));
    }
    if let Some(i) = s.idle_s {
        l1.push(format!("không ai đụng chuột/phím {}", dur_vi(i)));
    }
    let mut l2 = Vec::new();
    if let Some(b) = s.boot_s {
        l2.push(format!("bật máy {} trước", dur_vi(b)));
    }
    if let Some(z) = s.slept_s {
        l2.push(format!("ngủ {} từ lúc bật", dur_vi(z)));
    }
    match s.modern_standby {
        Some(false) => l2.push("không có Modern Standby: tắt màn hình không làm máy ngủ".to_string()),
        Some(true) => l2.push("có Modern Standby: tắt màn hình có thể kéo máy vào ngủ nhẹ".to_string()),
        None => {}
    }
    [l1, l2].into_iter().filter(|l| !l.is_empty()).map(|l| l.join(" · ")).collect::<Vec<_>>().join("\n")
}

#[cfg(windows)]
fn probe() -> Status {
    let es = probe::execution_state();
    Status {
        schema: 1,
        held: es.map(|e| e & probe::ES_SYSTEM_REQUIRED != 0),
        display_required: es.map(|e| e & probe::ES_DISPLAY_REQUIRED != 0),
        display: probe::display(),
        idle_s: probe::idle_s(),
        boot_s: Some(probe::boot_s()),
        slept_s: probe::slept_s(),
        modern_standby: probe::modern_standby(),
    }
}

#[cfg(not(windows))]
fn probe() -> Status {
    #[cfg(target_os = "linux")]
    let (boot_s, slept_s) = match (clock_s(7), clock_s(1)) {
        // CLOCK_BOOTTIME counts suspend, CLOCK_MONOTONIC does not.
        (Some(b), Some(m)) => (Some(b), Some(b.saturating_sub(m))),
        (b, _) => (b, None),
    };
    #[cfg(not(target_os = "linux"))]
    let (boot_s, slept_s) = (None, None);
    Status { schema: 1, held: inhibited(), boot_s, slept_s, ..Status::default() }
}

/// Whole seconds on clock `id` (Linux; every target is 64-bit, so timespec is two i64).
#[cfg(target_os = "linux")]
fn clock_s(id: i32) -> Option<u64> {
    extern "C" {
        fn clock_gettime(clk: i32, ts: *mut [i64; 2]) -> i32;
    }
    let mut ts = [0i64; 2];
    // SAFETY: `ts` is a valid, writable timespec-sized buffer for the duration of the call.
    (unsafe { clock_gettime(id, &mut ts) } == 0).then(|| ts[0].max(0) as u64)
}

/// Linux: an `8sync` sleep inhibitor in `systemd-inhibit --list`; None where it can't run.
#[cfg(not(windows))]
fn inhibited() -> Option<bool> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let o = std::process::Command::new("systemd-inhibit").args(["--list", "--no-legend", "--no-pager"]).output().ok().filter(|o| o.status.success())?;
    Some(String::from_utf8_lossy(&o.stdout).lines().any(|l| l.contains("8sync") && l.contains("sleep")))
}

#[cfg(windows)]
mod probe {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::time::{Duration, Instant};

    #[repr(C)]
    struct Guid(u32, u16, u16, [u8; 8]);
    #[repr(C)]
    struct Subscribe {
        callback: extern "system" fn(*mut c_void, u32, *mut c_void) -> u32,
        context: *mut c_void,
    }
    #[repr(C)]
    struct LastInput {
        size: u32,
        time: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetTickCount() -> u32;
        fn GetTickCount64() -> u64;
        fn QueryUnbiasedInterruptTime(t: *mut u64) -> i32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetLastInputInfo(info: *mut LastInput) -> i32;
    }
    #[link(name = "powrprof")]
    extern "system" {
        fn CallNtPowerInformation(level: i32, inp: *const c_void, inp_len: u32, out: *mut c_void, out_len: u32) -> i32;
        fn PowerSettingRegisterNotification(setting: *const Guid, flags: u32, recipient: *const Subscribe, handle: *mut *mut c_void) -> u32;
        fn PowerSettingUnregisterNotification(handle: *mut c_void) -> u32;
    }

    pub const ES_SYSTEM_REQUIRED: u32 = 0x1;
    pub const ES_DISPLAY_REQUIRED: u32 = 0x2;
    const SYSTEM_POWER_CAPABILITIES: i32 = 4;
    const SYSTEM_EXECUTION_STATE: i32 = 16;
    const DEVICE_NOTIFY_CALLBACK: u32 = 2;
    const PBT_POWERSETTINGCHANGE: u32 = 0x8013;
    /// GUID_CONSOLE_DISPLAY_STATE {6FE69556-704A-47A0-8F24-C28D936FDA47}.
    const CONSOLE_DISPLAY_STATE: Guid = Guid(0x6FE6_9556, 0x704A, 0x47A0, [0x8F, 0x24, 0xC2, 0x8D, 0x93, 0x6F, 0xDA, 0x47]);

    /// The system-wide execution state (all processes' requests, not this thread's).
    pub fn execution_state() -> Option<u32> {
        let mut es = 0u32;
        // SAFETY: `es` is a writable ULONG and its size is passed; no input buffer.
        let st = unsafe { CallNtPowerInformation(SYSTEM_EXECUTION_STATE, std::ptr::null(), 0, (&mut es as *mut u32).cast(), 4) };
        (st == 0).then_some(es)
    }

    /// SYSTEM_POWER_CAPABILITIES.AoAc (byte 20): S0 low-power idle, a.k.a. Modern Standby.
    pub fn modern_standby() -> Option<bool> {
        let mut caps = [0u8; 128];
        // SAFETY: `caps` is a zeroed, writable buffer larger than SYSTEM_POWER_CAPABILITIES (76 bytes).
        let st = unsafe { CallNtPowerInformation(SYSTEM_POWER_CAPABILITIES, std::ptr::null(), 0, caps.as_mut_ptr().cast(), caps.len() as u32) };
        (st == 0).then(|| caps[20] != 0)
    }

    pub fn idle_s() -> Option<u64> {
        let mut li = LastInput { size: std::mem::size_of::<LastInput>() as u32, time: 0 };
        // SAFETY: `li` is a valid LASTINPUTINFO with cbSize set.
        if unsafe { GetLastInputInfo(&mut li) } == 0 {
            return None;
        }
        // SAFETY: no arguments.
        Some(u64::from(unsafe { GetTickCount() }.wrapping_sub(li.time)) / 1000)
    }

    pub fn boot_s() -> u64 {
        // SAFETY: no arguments.
        (unsafe { GetTickCount64() }) / 1000
    }

    /// Tick count includes sleep, the unbiased interrupt time does not (both 100 ns once scaled).
    pub fn slept_s() -> Option<u64> {
        let mut awake = 0u64;
        // SAFETY: `awake` is a writable ULONGLONG.
        if unsafe { QueryUnbiasedInterruptTime(&mut awake) } == 0 {
            return None;
        }
        // SAFETY: no arguments.
        let total = unsafe { GetTickCount64() }.saturating_mul(10_000);
        Some(total.saturating_sub(awake) / 10_000_000)
    }

    /// Written by `on_setting`; static, so a callback that lands after unregistering never writes
    /// into a returned stack frame (Windows doesn't document that unregister waits for it).
    static DISPLAY_STATE: AtomicI32 = AtomicI32::new(-1);

    /// The subscribe params, static for the same reason; no context, the callback uses DISPLAY_STATE.
    struct Sub(Subscribe);
    // SAFETY: the only pointer field is a null context that nothing dereferences.
    unsafe impl Sync for Sub {}
    static SUB: Sub = Sub(Subscribe { callback: on_setting, context: std::ptr::null_mut() });

    extern "system" fn on_setting(_ctx: *mut c_void, kind: u32, setting: *mut c_void) -> u32 {
        if kind == PBT_POWERSETTINGCHANGE && !setting.is_null() {
            // SAFETY: for PBT_POWERSETTINGCHANGE `setting` is a POWERBROADCAST_SETTING {GUID(16),
            // DataLength u32 @16, Data @20}; the display state is one DWORD.
            unsafe {
                let p = setting.cast::<u8>();
                if p.add(16).cast::<u32>().read_unaligned() >= 4 {
                    DISPLAY_STATE.store(p.add(20).cast::<i32>().read_unaligned(), Ordering::SeqCst);
                }
            }
        }
        0
    }

    /// The console display state: Windows calls back with the current value right after
    /// registering (0 off, 1 on, 2 dimmed). None if it doesn't within a second.
    pub fn display() -> Option<&'static str> {
        DISPLAY_STATE.store(-1, Ordering::SeqCst);
        let mut handle = std::ptr::null_mut();
        // SAFETY: valid GUID, static subscribe params, writable out-handle.
        if unsafe { PowerSettingRegisterNotification(&CONSOLE_DISPLAY_STATE, DEVICE_NOTIFY_CALLBACK, &SUB.0, &mut handle) } != 0 {
            return None;
        }
        let end = Instant::now() + Duration::from_secs(1);
        while DISPLAY_STATE.load(Ordering::SeqCst) < 0 && Instant::now() < end {
            std::thread::sleep(Duration::from_millis(10));
        }
        // SAFETY: `handle` came from the successful registration above.
        unsafe { PowerSettingUnregisterNotification(handle) };
        match DISPLAY_STATE.load(Ordering::SeqCst) {
            0 => Some("off"),
            1 => Some("on"),
            2 => Some("dim"),
            _ => None,
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
        let linux = hold_argv("linux", 4242).unwrap();
        assert_eq!(linux[0], "systemd-inhibit");
        assert!(linux.iter().any(|a| a == "--what=sleep:idle") && !linux.iter().any(|a| a.contains("handle-lid")), "sleep only; the lid is the owner's call");
        assert_eq!(&linux[5..], ["tail", "--pid=4242", "-f", "/dev/null"], "dies with 8sync, even on a kill");
        assert_eq!(hold_argv("macos", 4242).unwrap(), ["caffeinate", "-i", "-w", "4242"], "idle sleep only, the display may sleep; ends with 8sync");
        assert!(hold_argv("windows", 1).is_none() && hold_argv("freebsd", 1).is_none());
    }

    #[test]
    fn says_durations_in_vietnamese() {
        assert_eq!(dur_vi(0), "0 phút");
        assert_eq!(dur_vi(59), "0 phút");
        assert_eq!(dur_vi(45 * 60), "45 phút");
        assert_eq!(dur_vi(8 * 3600 + 30), "8 giờ");
        assert_eq!(dur_vi(22_140), "6 giờ 9 phút");
        assert_eq!(dur_vi(86_400), "1 ngày");
        assert_eq!(dur_vi(2 * 86_400 + 3 * 3600 + 59 * 60), "2 ngày 3 giờ");
    }

    #[test]
    fn status_json_is_the_hq_contract() {
        let s = Status { schema: 1, held: Some(true), display_required: Some(false), display: Some("off"), idle_s: Some(22_140), boot_s: Some(28_800), slept_s: Some(0), modern_standby: Some(false) };
        assert_eq!(status_json(&s), r#"{"schema":1,"held":true,"display_required":false,"display":"off","idle_s":22140,"boot_s":28800,"slept_s":0,"modern_standby":false}"#);
        let unknown = Status { schema: 1, ..Status::default() };
        assert_eq!(status_json(&unknown), r#"{"schema":1,"held":null,"display_required":null,"display":null,"idle_s":null,"boot_s":null,"slept_s":null,"modern_standby":null}"#);
    }

    #[test]
    fn status_text_drops_unknowns() {
        let s = Status { schema: 1, held: Some(true), display_required: Some(false), display: Some("off"), idle_s: Some(22_140), boot_s: Some(28_800), slept_s: Some(0), modern_standby: Some(false) };
        assert_eq!(
            status_text(&s),
            "máy thức: có (có tiến trình giữ không cho ngủ) · màn hình: tắt · không ai đụng chuột/phím 6 giờ 9 phút\nbật máy 8 giờ trước · ngủ 0 phút từ lúc bật · không có Modern Standby: tắt màn hình không làm máy ngủ"
        );
        let linux = Status { schema: 1, held: Some(false), boot_s: Some(600), slept_s: Some(0), ..Status::default() };
        assert_eq!(status_text(&linux), "máy thức: không ai giữ — rảnh lâu là máy tự ngủ\nbật máy 10 phút trước · ngủ 0 phút từ lúc bật");
        assert_eq!(status_text(&Status::default()), "");
        assert!(status(&["--bogus".to_string()]).is_err());
    }
}
