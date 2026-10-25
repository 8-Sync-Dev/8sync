//! `8sync ccc awake [--while-rooms] [--hours N] [--screen-off N]` (also `8sync awake …`): keep the
//! machine from sleeping while rooms work. Owner (2026-10-19): rooms died
//! overnight with the machine ("tắt máy … mở máy lên hiển thị đang làm nhưng mà lại không có
//! làm"); room `core` researched the options and proposed `awake --while-rooms`.
//!
//! - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` (kernel32, no crate);
//!   Linux: `systemd-inhibit --what=sleep:idle … tail --pid=<8sync> -f /dev/null`; macOS:
//!   `caffeinate -i -w <8sync>`. Both end with this process even when it is killed; the hold ends
//!   with Ctrl+C / `awake off`, `--hours` when given, or no room left with `--while-rooms`.
//! - No deadline by default (owner, 2026-10-25: "tắt mãi cho tới khi tôi bấm … chứ không phải
//!   chỉ 8h"): on stays on until the switch turns it off; the screen still goes off when idle.
//! - `--while-rooms`: checks `claude agents --json` every minute and lets go after two checks in a
//!   row with no live Claude Code session.
//! - Never starts a room and never renews the auto lease. A closed laptop lid
//!   still sleeps, and a shutdown still kills the rooms (`auto revive` brings them back).
//! - Windows: also turns the screen off after `--screen-off N` minutes (default 10, 0 = leave it
//!   to the power plan) without mouse/keyboard input, unless an app holds the display (video) or
//!   the machine has Modern Standby (screen off can pull it into standby there). Owner
//!   (2026-10-19): with the plan's 180 min and apps resetting the display timer, the screen stayed
//!   on all day while rooms worked; a touch brings it back.
//! - `awake status [--json]`: what the OS says right now (held awake?, screen on/off, idle since
//!   the last mouse/keyboard input, time asleep since boot) plus `ours`, this 8sync's own hold.
//!   HQ polls the JSON every ~30 s.
//! - `awake on [--while-rooms] [--hours N] [--screen-off N]` / `awake off`: the HQ switch (owner,
//!   2026-10-19: "awake on/off … có nút"). `on` starts `8sync awake` detached (no console, null stdio,
//!   out of the caller's job) and returns; `off` stops only the hold named in our pidfile
//!   (`~/.local/state/8sync/ccc/awake.json`, written by the hold itself, removed when it ends).
//!   `held` can't drive a switch: on Windows it is the system-wide aggregate (omp.exe holds SYSTEM too).
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{bail, Result};

pub(super) const USAGE: &str = "usage: 8sync ccc awake [--while-rooms] [--hours N] [--screen-off PHÚT]   (mặc định giữ tới khi tắt; tắt màn hình sau 10 phút không ai đụng, 0 = để Windows lo)\n       8sync ccc awake on [--while-rooms] [--hours N] [--screen-off PHÚT] | off   (bật/tắt giữ thức chạy nền, giữ tới khi `off`; --while-rooms = nhả khi hết phòng)\n       8sync ccc awake status [--json]   (máy có đang thức, màn hình, lần cuối đụng chuột/phím)";

const EVERY: Duration = Duration::from_secs(60);
const SCREEN_OFF_MIN: u64 = 10;
/// `on` waits this long for the detached hold to write its pidfile (`claude agents` can be slow).
const ON_WAIT: Duration = Duration::from_secs(20);

#[derive(Debug, PartialEq)]
pub(super) struct Opts {
    pub while_rooms: bool,
    /// None = until `off` (no deadline).
    pub hours: Option<f64>,
    /// Minutes without input before the screen goes off; 0 = the OS power plan decides.
    pub screen_off: u64,
}

pub(super) fn parse(rest: &[String]) -> Result<Opts> {
    let mut o = Opts { while_rooms: false, hours: None, screen_off: SCREEN_OFF_MIN };
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--while-rooms" => o.while_rooms = true,
            "--hours" => {
                let v = it.next().and_then(|v| v.parse::<f64>().ok()).filter(|h| h.is_finite() && *h > 0.0);
                let Some(h) = v else { bail!("--hours cần một số > 0\n{USAGE}") };
                o.hours = Some(h);
            }
            "--screen-off" => {
                let Some(m) = it.next().and_then(|v| v.parse::<u64>().ok()).filter(|m| *m <= 24 * 60) else {
                    bail!("--screen-off cần số phút từ 0 tới 1440\n{USAGE}")
                };
                o.screen_off = m;
            }
            "-h" | "--help" => bail!("{USAGE}"),
            x => bail!("không rõ `{x}`\n{USAGE}"),
        }
    }
    Ok(o)
}

/// Turn the screen off now: nobody has touched the machine for `after_s`, no app holds the display,
/// and no Modern Standby (unknown fields never blank).
pub(super) fn should_blank(s: &Status, after_s: u64) -> bool {
    after_s > 0
        && s.modern_standby == Some(false)
        && s.display_required == Some(false)
        && matches!(s.display, Some("on" | "dim"))
        && s.idle_s.is_some_and(|i| i >= after_s)
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

    #[link(name = "user32")]
    extern "system" {
        fn PostMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> i32;
    }
    const HWND_BROADCAST: isize = 0xFFFF;
    const WM_SYSCOMMAND: u32 = 0x0112;
    const SC_MONITORPOWER: usize = 0xF170;

    #[link(name = "user32")]
    extern "system" {
        fn LockWorkStation() -> i32;
    }

    /// Lock the session (the Win+L screen); apps and background work keep running.
    pub fn lock() -> bool {
        // SAFETY: no arguments; returns non-zero when the lock was started.
        unsafe { LockWorkStation() != 0 }
    }

    /// Screen off until the next input (or an app that forces it on). Posted, so a hung window
    /// can't block the loop.
    pub fn screen_off() {
        // SAFETY: constant message to the broadcast handle; no pointers.
        unsafe {
            PostMessageW(HWND_BROADCAST, WM_SYSCOMMAND, SC_MONITORPOWER, 2);
        }
    }

    type Handle = *mut std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn GetExitCodeProcess(h: Handle, code: *mut u32) -> i32;
        fn GetProcessTimes(h: Handle, created: *mut u64, exited: *mut u64, kernel: *mut u64, user: *mut u64) -> i32;
        fn QueryFullProcessImageNameW(h: Handle, flags: u32, name: *mut u16, len: *mut u32) -> i32;
        fn TerminateProcess(h: Handle, code: u32) -> i32;
        fn SetConsoleCtrlHandler(handler: Option<extern "system" fn(u32) -> i32>, add: i32) -> i32;
    }
    const PROCESS_TERMINATE: u32 = 0x0001;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;

    /// "<image stem>@<creation FILETIME>" of a running process: the creation time tells this
    /// process from a later one that got the same pid.
    pub fn ident(pid: u32) -> Option<String> {
        // SAFETY: plain call; a null handle is checked before use.
        let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if h.is_null() {
            return None;
        }
        let (mut code, mut created, mut x) = (0u32, 0u64, 0u64);
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        // SAFETY: `h` is a live process handle; every out-pointer is a writable local of the right
        // size (FILETIME is two DWORDs, read as one u64), `len` holds the buffer length.
        let ok = unsafe {
            GetExitCodeProcess(h, &mut code) != 0
                && code == STILL_ACTIVE
                && GetProcessTimes(h, &mut created, &mut x, &mut x, &mut x) != 0
                && QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0
        };
        // SAFETY: closes the handle opened above, once.
        unsafe { CloseHandle(h) };
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let stem = std::path::Path::new(&path).file_stem()?.to_string_lossy().to_lowercase();
        Some(format!("{stem}@{created}"))
    }

    pub fn kill(pid: u32) -> bool {
        // SAFETY: plain call; a null handle is checked before use and closed once.
        unsafe {
            let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if h.is_null() {
                return false;
            }
            let ok = TerminateProcess(h, 1) != 0;
            CloseHandle(h);
            ok
        }
    }

    static PIDFILE: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

    extern "system" fn on_ctrl(_kind: u32) -> i32 {
        if let Some(p) = PIDFILE.get() {
            super::remove_if_mine(p, std::process::id());
        }
        0 // not handled: Windows goes on and ends the process
    }

    /// Ctrl+C / Ctrl+Break / closing the console of a hold started by hand: drop the pidfile first.
    pub fn clean_on_ctrl(pidfile: std::path::PathBuf) {
        if PIDFILE.set(pidfile).is_ok() {
            // SAFETY: registers a static `extern "system"` handler that lives for the process.
            unsafe { SetConsoleCtrlHandler(Some(on_ctrl), 1) };
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

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// `claude` for the hold loop: [`super::team::Bin`] without a console window, or a detached hold
/// flashes one every minute on Windows.
pub(super) struct Quiet {
    pub exe: PathBuf,
    pub root: PathBuf,
}

impl super::team::Claude for Quiet {
    fn run(&self, args: &[String]) -> Result<String> {
        let mut c = std::process::Command::new(&self.exe);
        c.args(args).current_dir(&self.root).stdin(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(CREATE_NO_WINDOW);
        }
        let out = c.output()?;
        Ok(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    }
}

/// This 8sync's own hold, written by the hold itself. `ident` says who the pid is ("<image
/// stem>@<creation time>" on Windows, `ps -o lstart=,args=` elsewhere): a pid reused by another
/// program, or a hold that was killed without cleaning up, no longer matches and is ignored.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct Pidfile {
    pub pid: u32,
    pub ident: String,
    /// Epoch seconds when `--hours` runs out; 0 = until `off`.
    pub until: u64,
    pub while_rooms: bool,
}

/// `ours` in `status --json` (the HQ switch).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub(crate) struct Ours {
    pub pid: u32,
    pub until: u64,
    pub while_rooms: bool,
}

pub(super) fn pid_path(home: &Path) -> PathBuf {
    home.join(".local/state").join(crate::brand::NS).join("ccc").join("awake.json")
}

pub(super) fn read_pidfile(p: &Path) -> Option<Pidfile> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

/// Write-then-rename: a reader never sees half a file.
pub(super) fn write_pidfile(p: &Path, f: &Pidfile) -> Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string(f)?)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

/// The pidfile's hold when that very process still runs (its `ident` now is the recorded one).
pub(super) fn live_hold(f: Option<Pidfile>, ident: impl Fn(u32) -> Option<String>) -> Option<Pidfile> {
    f.filter(|f| !f.ident.is_empty() && ident(f.pid).as_deref() == Some(f.ident.as_str()))
}

fn remove_if_mine(p: &Path, pid: u32) {
    if read_pidfile(p).is_some_and(|f| f.pid == pid) {
        let _ = std::fs::remove_file(p);
    }
}

/// Removes the pidfile when the hold ends (deadline, no room left, an error); Ctrl+C / closing the
/// console on Windows goes through `win::clean_on_ctrl`, a kill through `off`.
struct PidGuard(PathBuf, u32);

impl Drop for PidGuard {
    fn drop(&mut self) {
        remove_if_mine(&self.0, self.1);
    }
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

#[cfg(not(windows))]
fn ident(pid: u32) -> Option<String> {
    let o = std::process::Command::new("ps").args(["-o", "lstart=,args=", "-p", &pid.to_string()]).output().ok().filter(|o| o.status.success())?;
    let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

#[cfg(not(windows))]
fn kill(pid: u32) -> bool {
    std::process::Command::new("kill").arg(pid.to_string()).status().is_ok_and(|s| s.success())
}

#[cfg(windows)]
use win::{ident, kill};

/// The argv `on` starts: the same options, held until `off` unless `--while-rooms` / `--hours`.
pub(super) fn on_argv(o: &Opts) -> Vec<String> {
    let mut v = vec!["awake".to_string()];
    if o.while_rooms {
        v.push("--while-rooms".into());
    }
    if let Some(h) = o.hours {
        v.extend(["--hours".into(), h.to_string()]);
    }
    v.extend(["--screen-off".into(), o.screen_off.to_string()]);
    v
}

/// "tới khi tắt" / "còn tối đa 6 giờ 9 phút" for a hold that ends at `until` (0 = no deadline).
fn left_vi(until: u64) -> String {
    if until == 0 {
        "tới khi tắt".to_string()
    } else {
        format!("còn tối đa {}", dur_vi(until.saturating_sub(now_s())))
    }
}

/// When a hold with these options lets go, for the owner.
fn ends_vi(o: &Opts) -> String {
    match (o.while_rooms, o.hours) {
        (false, None) => "giữ tới khi anh tắt (`8sync awake off` hoặc công tắc HQ)".to_string(),
        (false, Some(h)) => format!("giữ tới khi anh tắt hoặc sau {h} giờ"),
        (true, None) => "tự nhả khi không còn phòng nào chạy".to_string(),
        (true, Some(h)) => format!("tự nhả khi không còn phòng nào chạy hoặc sau {h} giờ"),
    }
}

/// Null stdio (or Node's execFile waits on the inherited pipe), no console, its own process group,
/// and out of the caller's job when the job allows it (a kill-on-close job would end the hold
/// with HQ); a job that forbids breakaway gets a plain detached spawn.
pub(super) fn spawn_detached(exe: &Path, args: &[String]) -> Result<std::process::Child> {
    use std::process::{Command, Stdio};
    let mk = || {
        let mut c = Command::new(exe);
        c.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let flags = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP;
        if let Ok(c) = mk().creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB).spawn() {
            return Ok(c);
        }
        Ok(mk().creation_flags(flags).spawn()?)
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        Ok(mk().process_group(0).spawn()?)
    }
}

/// Held by `on` from before the spawn until the hold's pidfile shows up (or `on` gives up): a second
/// `on` meanwhile does not start a twin. A lock older than this was left by an `on` that died.
const LOCK_STALE: Duration = Duration::from_secs(ON_WAIT.as_secs() + 10);

pub(super) fn lock_path(home: &Path) -> PathBuf {
    pid_path(home).with_extension("lock")
}

/// Removes the lock when `on` returns, whichever way.
pub(super) struct OnLock(PathBuf);

impl Drop for OnLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// `create_new` the lock; None while another `on` holds a lock younger than `stale`.
pub(super) fn take_lock(p: &Path, stale: Duration) -> Result<Option<OnLock>> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    for _ in 0..2 {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(p) {
            Ok(_) => return Ok(Some(OnLock(p.to_path_buf()))),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                let age = std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok());
                if age.is_some_and(|a| a < stale) {
                    return Ok(None);
                }
                let _ = std::fs::remove_file(p); // left by a dead `on` (or gone already): take it over
            }
            Err(e) => return Err(e.into()),
        }
    }
    Ok(None)
}

/// `8sync ccc awake on [--while-rooms] [--hours N] [--screen-off N]`: our hold alive → say so; else start one
/// detached and return once it has written its pidfile.
pub(super) fn on(rest: &[String], home: &Path) -> Result<()> {
    let o = parse(rest)?;
    let pf = pid_path(home);
    let running = |h: Pidfile| println!("đã đang giữ máy thức (pid {}, {}).", h.pid, left_vi(h.until));
    if let Some(h) = live_hold(read_pidfile(&pf), ident) {
        running(h);
        return Ok(());
    }
    let Some(_lock) = take_lock(&lock_path(home), LOCK_STALE)? else {
        println!("một lệnh `8sync awake on` khác đang bật giữ thức; vài giây nữa xem `8sync awake status`.");
        return Ok(());
    };
    // The `on` that held the lock just before may have finished in between.
    if let Some(h) = live_hold(read_pidfile(&pf), ident) {
        running(h);
        return Ok(());
    }
    let mut child = spawn_detached(&std::env::current_exe()?, &on_argv(&o))?;
    let end = Instant::now() + ON_WAIT;
    loop {
        if read_pidfile(&pf).is_some_and(|f| f.pid == child.id()) {
            println!("đã bật giữ máy thức (pid {}): {}; màn hình tắt sau {} phút không ai đụng, chạm chuột/phím là sáng lại.", child.id(), ends_vi(&o), o.screen_off);
            return Ok(());
        }
        if let Some(st) = child.try_wait()? {
            if st.success() {
                bail!("không có phòng Claude Code nào đang chạy nên chưa cần giữ máy thức");
            }
            bail!("không giữ được máy thức: `8sync awake --while-rooms` thoát ({st})");
        }
        if Instant::now() >= end {
            bail!("giữ thức (pid {}) chưa báo đã chạy sau {} giây", child.id(), ON_WAIT.as_secs());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// `8sync ccc awake off`: stop only the hold in our pidfile, after checking it is that process.
/// Idempotent.
pub(super) fn off(home: &Path) -> Result<()> {
    let pf = pid_path(home);
    let Some(h) = live_hold(read_pidfile(&pf), ident) else {
        let _ = std::fs::remove_file(&pf);
        println!("không có giữ thức nào của 8sync đang chạy.");
        return Ok(());
    };
    if !kill(h.pid) {
        bail!("không tắt được giữ thức (pid {})", h.pid);
    }
    let _ = std::fs::remove_file(&pf);
    println!("đã tắt giữ máy thức (pid {}): máy ngủ lại theo cài đặt nguồn.", h.pid);
    Ok(())
}

// ── `8sync sleep work`: screen off + lock now, machine and Claude keep working ─────────────────

pub(super) const SLEEP_USAGE: &str = "usage: 8sync sleep work [--hours N] [--screen-off PHÚT] [--no-lock] [--force]   (tắt màn hình + khoá máy ngay, máy vẫn thức cho Claude Desktop / Claude Code làm tiếp; chạm chuột/phím là sáng lại; giữ tới khi `8sync sleep off`, màn hình tự tắt lại sau 2 phút không ai đụng)\n       8sync sleep off   (nhả giữ thức: máy ngủ lại theo cài đặt nguồn)\n       8sync sleep status [--json]";

/// After a glance at the screen, how soon it goes dark again (minutes).
const SLEEP_SCREEN_OFF_MIN: u64 = 2;
/// The key that ran the command is still going up: a screen turned off before that comes back on.
const KEY_RELEASE: Duration = Duration::from_millis(1500);

#[derive(Debug, PartialEq)]
pub(super) struct SleepOpts {
    /// None = until `sleep off` (owner 2026-10-25: "chứ không phải chỉ 8h").
    pub hours: Option<f64>,
    pub screen_off: u64,
    pub lock: bool,
    /// Turn the screen off even on a Modern Standby machine.
    pub force: bool,
}

pub(super) fn parse_sleep(rest: &[String]) -> Result<SleepOpts> {
    let mut o = SleepOpts { hours: None, screen_off: SLEEP_SCREEN_OFF_MIN, lock: true, force: false };
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--hours" => {
                let Some(h) = it.next().and_then(|v| v.parse::<f64>().ok()).filter(|h| h.is_finite() && *h > 0.0) else { bail!("--hours cần một số > 0\n{SLEEP_USAGE}") };
                o.hours = Some(h);
            }
            "--screen-off" => {
                let Some(m) = it.next().and_then(|v| v.parse::<u64>().ok()).filter(|m| *m <= 24 * 60) else { bail!("--screen-off cần số phút từ 0 tới 1440\n{SLEEP_USAGE}") };
                o.screen_off = m;
            }
            "--no-lock" => o.lock = false,
            "--force" => o.force = true,
            x => bail!("không rõ `{x}`\n{SLEEP_USAGE}"),
        }
    }
    Ok(o)
}

/// The hold `sleep work` starts: no `--while-rooms` (Claude Desktop's own work is not a room that
/// `claude agents` lists, so a room watch would let the machine sleep under it).
pub(super) fn work_argv(o: &SleepOpts) -> Vec<String> {
    on_argv(&Opts { while_rooms: false, hours: o.hours, screen_off: o.screen_off })
}

/// What locks the session on `os` (Windows: `LockWorkStation`, an API call: None here).
#[cfg_attr(windows, allow(dead_code))] // Windows uses the API calls instead
pub(super) fn lock_argv(os: &str) -> Option<Vec<&'static str>> {
    match os {
        "linux" => Some(vec!["loginctl", "lock-session"]),
        // Display sleep locks when "require password after sleep" is on (the macOS default).
        "macos" => Some(vec!["pmset", "displaysleepnow"]),
        _ => None,
    }
}

/// What turns the screen off on `os` (Windows: `SC_MONITORPOWER`, an API call: None here).
#[cfg_attr(windows, allow(dead_code))] // Windows uses the API calls instead
pub(super) fn screen_argv(os: &str) -> Option<Vec<&'static str>> {
    match os {
        "linux" => Some(vec!["xset", "dpms", "force", "off"]),
        "macos" => Some(vec!["pmset", "displaysleepnow"]),
        _ => None,
    }
}

#[cfg_attr(windows, allow(dead_code))] // Windows uses the API calls instead
fn run_quiet(argv: &[&str]) -> bool {
    std::process::Command::new(argv[0]).args(&argv[1..]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

/// A hold for `sleep work`: an existing one that does not watch rooms is kept; one that does
/// (`awake on`) is replaced, since it would let go while Claude Desktop still works.
fn ensure_work_hold(o: &SleepOpts, home: &Path) -> Result<Pidfile> {
    let pf = pid_path(home);
    if let Some(h) = live_hold(read_pidfile(&pf), ident) {
        if !h.while_rooms {
            return Ok(h);
        }
        if !kill(h.pid) {
            bail!("không thay được giữ thức đang theo phòng (pid {})", h.pid);
        }
        let _ = std::fs::remove_file(&pf);
    }
    let Some(_lock) = take_lock(&lock_path(home), LOCK_STALE)? else { bail!("một lệnh giữ thức khác đang khởi động; thử lại sau vài giây") };
    let mut child = spawn_detached(&std::env::current_exe()?, &work_argv(o))?;
    let end = Instant::now() + ON_WAIT;
    loop {
        if let Some(f) = read_pidfile(&pf).filter(|f| f.pid == child.id()) {
            return Ok(f);
        }
        if let Some(st) = child.try_wait()? {
            bail!("không giữ được máy thức: `8sync awake` thoát ({st})");
        }
        if Instant::now() >= end {
            bail!("giữ thức (pid {}) chưa báo đã chạy sau {} giây", child.id(), ON_WAIT.as_secs());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// `8sync sleep …` (= `8sync ccc sleep …`).
pub(super) fn sleep(rest: &[String], home: &Path) -> Result<()> {
    match rest.first().map(String::as_str) {
        Some("off") => return off(home),
        Some("status") => return status(&rest[1..]),
        Some("work") => {}
        _ => bail!("{SLEEP_USAGE}"),
    }
    let o = parse_sleep(&rest[1..])?;
    let h = ensure_work_hold(&o, home)?;
    let os = std::env::consts::OS;
    let ms = probe().modern_standby == Some(true);
    println!("máy giữ thức (pid {}, {}): Claude Desktop / Claude Code làm tiếp khi màn hình tắt.", h.pid, left_vi(h.until));
    std::thread::sleep(KEY_RELEASE);
    if o.lock {
        #[cfg(windows)]
        let locked = win::lock();
        #[cfg(not(windows))]
        let locked = lock_argv(os).is_some_and(|a| run_quiet(&a));
        if !locked {
            println!("không khoá được phiên trên {os}: màn hình vẫn tắt, nhưng ai chạm vào là thấy desktop.");
        }
    }
    if ms && !o.force {
        println!("máy có Modern Standby: 8sync không tự tắt màn hình (có thể kéo máy vào ngủ nhẹ, app bị bóp); thêm --force nếu đã thử thấy ổn.");
    } else {
        #[cfg(windows)]
        win::screen_off();
        #[cfg(not(windows))]
        if !(os == "macos" && o.lock) && !screen_argv(os).is_some_and(|a| run_quiet(&a)) {
            println!("không tắt được màn hình trên {os} (cần xset trên X11, hoặc để cài đặt nguồn lo).");
        }
    }
    println!("chạm chuột/phím để sáng lại{}; màn hình tự tắt lại sau {} phút không ai đụng. Tắt hẳn: `8sync sleep off`. Gập nắp laptop thì máy vẫn ngủ.", if o.lock { " (nhập mật khẩu để mở khoá)" } else { "" }, o.screen_off);
    let installed = home.join(".config/8sync/eco-installed").exists();
    if !installed {
        println!("gợi ý: `8sync eco install` để giữ RAM/CPU/điện nhẹ trong lúc chạy lâu.");
    }
    Ok(())
}

/// This hold's pidfile, or why there can't be one: without an ident `off`, `status` and the HQ
/// switch would never recognise it, a hold nobody can stop.
pub(super) fn own_pidfile(pid: u32, ident: Option<String>, until: u64, while_rooms: bool) -> Result<Pidfile> {
    match ident.filter(|i| !i.is_empty()) {
        Some(ident) => Ok(Pidfile { pid, ident, until, while_rooms }),
        None => bail!("không đọc được tiến trình của chính 8sync (pid {pid}) nên không giữ máy thức: `8sync awake off` và công tắc HQ sẽ không tìm thấy nó"),
    }
}

/// `claude` is only needed (and only resolved by the caller) with `--while-rooms`.
pub(super) fn run(o: &Opts, claude: Option<&dyn super::team::Claude>, subscription: bool, home: &Path) -> Result<()> {
    let watch = match (o.while_rooms, claude) {
        (true, Some(c)) => Some(c),
        (true, None) => bail!("--while-rooms cần `claude` để xem phòng nào đang chạy"),
        (false, _) => None,
    };
    let pf = pid_path(home);
    let me = std::process::id();
    if let Some(h) = live_hold(read_pidfile(&pf), ident).filter(|h| h.pid != me) {
        bail!("đã có giữ thức của 8sync đang chạy (pid {}); `8sync awake off` để tắt", h.pid);
    }
    if let Some(c) = watch {
        if live_rooms(c)? == 0 {
            println!("không có phòng Claude Code nào đang chạy — không giữ máy thức.");
            return Ok(());
        }
    }
    let until = o.hours.map_or(0, |h| now_s() + (h * 3600.0) as u64);
    let own = own_pidfile(me, ident(me), until, o.while_rooms)?;
    let _hold = Hold::take()?;
    write_pidfile(&pf, &own)?;
    // Dropped before `_hold`: the pidfile goes first, then the OS hold.
    let _pid = PidGuard(pf.clone(), me);
    #[cfg(windows)]
    win::clean_on_ctrl(pf);
    let screen = match (o.screen_off, probe().modern_standby) {
        (m, Some(false)) if m > 0 => format!("màn hình tự tắt sau {m} phút không ai đụng chuột/phím, chạm là sáng lại"),
        (m, Some(true)) if m > 0 => "máy có Modern Standby nên 8sync không tự tắt màn hình (tắt có thể kéo máy vào ngủ nhẹ)".to_string(),
        _ => "màn hình tắt theo cài đặt nguồn của máy".to_string(),
    };
    println!("giữ máy thức: {}; {screen}. Gập nắp laptop / tắt máy thì phòng vẫn dừng (`8sync ccc auto revive` mở lại).", ends_vi(o));
    if subscription {
        println!("gói subscription: auto vẫn theo lease ≤ 4 giờ khi anh có mặt; chạy không người trông nhiều giờ thì dùng Routines (`/schedule`) hoặc Console API key.");
    }
    let deadline = o.hours.map(|h| Instant::now() + Duration::from_secs_f64(h * 3600.0));
    let mut empty = 0;
    loop {
        std::thread::sleep(EVERY);
        if deadline.is_some_and(|d| Instant::now() >= d) {
            println!("hết {} giờ — nhả, máy được ngủ lại.", o.hours.unwrap_or_default());
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
        #[cfg(windows)]
        {
            if should_blank(&probe(), o.screen_off * 60) {
                win::screen_off();
            }
        }
    }
}

/// What the OS says right now; None = unknown on this OS. Serialized as-is: the HQ contract.
#[derive(Debug, Default, PartialEq, serde::Serialize)]
pub(crate) struct Status {
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
    /// This 8sync's own hold (the pidfile's, still alive); what the HQ switch shows.
    pub ours: Option<Ours>,
}

/// What the OS says right now plus our own hold: the `status --json` object, for in-process callers too.
pub(crate) fn status_now() -> Status {
    let mut s = probe();
    s.ours = dirs::home_dir().and_then(|h| live_hold(read_pidfile(&pid_path(&h)), ident)).map(|f| Ours { pid: f.pid, until: f.until, while_rooms: f.while_rooms });
    s
}

/// `8sync ccc awake status [--json]`. Exit 0 whenever it ran, even with unknown fields.
pub(super) fn status(rest: &[String]) -> Result<()> {
    let json = match rest {
        [] => false,
        [j] if j == "--json" => true,
        _ => bail!("{USAGE}"),
    };
    let s = status_now();
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
    if let Some(o) = s.ours {
        l1.push(format!("8sync đang giữ (pid {}, {})", o.pid, left_vi(o.until)));
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
        ours: None,
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

    #[test]
    fn sleep_work_parses_and_holds_without_a_room_watch() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(parse_sleep(&[]).unwrap(), SleepOpts { hours: None, screen_off: SLEEP_SCREEN_OFF_MIN, lock: true, force: false }, "until `sleep off`");
        assert_eq!(work_argv(&parse_sleep(&[]).unwrap()), v(&["awake", "--screen-off", "2"]), "no deadline by default");
        let o = parse_sleep(&v(&["--hours", "30", "--screen-off", "5", "--no-lock", "--force"])).unwrap();
        assert_eq!(o, SleepOpts { hours: Some(30.0), screen_off: 5, lock: false, force: true }, "no 24 h cap");
        assert!(parse_sleep(&v(&["--hours", "-1"])).is_err());
        assert!(parse_sleep(&v(&["--wat"])).is_err());
        let a = work_argv(&o);
        assert_eq!(a, v(&["awake", "--hours", "30", "--screen-off", "5"]));
        assert!(!a.iter().any(|x| x == "--while-rooms"), "Claude Desktop is not a room: no room watch");
        // The hold argv parses back with the awake parser.
        assert_eq!(parse(&a[1..]).unwrap(), Opts { while_rooms: false, hours: Some(30.0), screen_off: 5 });
        assert_eq!(lock_argv("linux"), Some(vec!["loginctl", "lock-session"]));
        assert_eq!(screen_argv("macos"), Some(vec!["pmset", "displaysleepnow"]));
        assert_eq!(lock_argv("windows"), None);
    }

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_flags_and_holds_until_off_by_default() {
        assert_eq!(parse(&[]).unwrap(), Opts { while_rooms: false, hours: None, screen_off: 10 }, "no deadline, rooms or not");
        assert_eq!(
            parse(&args(&["--while-rooms", "--hours", "2.5", "--screen-off", "0"])).unwrap(),
            Opts { while_rooms: true, hours: Some(2.5), screen_off: 0 },
            "0 leaves the screen to the power plan"
        );
        assert_eq!(parse(&args(&["--hours", "100"])).unwrap().hours, Some(100.0), "the owner's number, no 24 h cap");
        assert_eq!(parse(&args(&["--screen-off", "1440"])).unwrap().screen_off, 1440);
        for bad in [&["--hours"][..], &["--hours", "0"], &["--hours", "x"], &["--hours", "NaN"], &["--forever"], &["--screen-off"], &["--screen-off", "-1"], &["--screen-off", "1441"], &["--screen-off", "5.5"]] {
            assert!(parse(&args(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn blanks_only_an_idle_screen_nobody_needs() {
        let idle = Status { schema: 1, held: Some(true), display_required: Some(false), display: Some("on"), idle_s: Some(600), boot_s: Some(9_000), slept_s: Some(0), modern_standby: Some(false), ours: None };
        assert!(should_blank(&idle, 600), "10 min without input, nothing holds the display");
        assert!(should_blank(&Status { display: Some("dim"), ..idle }, 600));
        assert!(!should_blank(&Status { idle_s: Some(599), ..idle }, 600), "someone touched it within the window");
        assert!(!should_blank(&idle, 0), "0 = the power plan decides");
        assert!(!should_blank(&Status { display: Some("off"), ..idle }, 600), "already off: no repeat");
        assert!(!should_blank(&Status { display_required: Some(true), ..idle }, 600), "an app holds the screen (video)");
        assert!(!should_blank(&Status { modern_standby: Some(true), ..idle }, 600), "screen off can pull Modern Standby into sleep");
        for unknown in [Status { display: None, ..idle }, Status { idle_s: None, ..idle }, Status { display_required: None, ..idle }, Status { modern_standby: None, ..idle }] {
            assert!(!should_blank(&unknown, 600), "{unknown:?}");
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
        let s = Status { schema: 1, held: Some(true), display_required: Some(false), display: Some("off"), idle_s: Some(22_140), boot_s: Some(28_800), slept_s: Some(0), modern_standby: Some(false), ours: None };
        assert_eq!(status_json(&s), r#"{"schema":1,"held":true,"display_required":false,"display":"off","idle_s":22140,"boot_s":28800,"slept_s":0,"modern_standby":false,"ours":null}"#);
        let unknown = Status { schema: 1, ..Status::default() };
        assert_eq!(status_json(&unknown), r#"{"schema":1,"held":null,"display_required":null,"display":null,"idle_s":null,"boot_s":null,"slept_s":null,"modern_standby":null,"ours":null}"#);
        let ours = Status { schema: 1, held: Some(true), ours: Some(Ours { pid: 4242, until: 1_760_900_000, while_rooms: true }), ..Status::default() };
        assert!(status_json(&ours).ends_with(r#""ours":{"pid":4242,"until":1760900000,"while_rooms":true}}"#), "{}", status_json(&ours));
    }

    #[test]
    fn on_holds_until_off_unless_asked_otherwise() {
        assert_eq!(on_argv(&parse(&[]).unwrap()), ["awake", "--screen-off", "10"], "defaults: until off, screen off after 10 min");
        let o = parse(&args(&["--while-rooms", "--hours", "2.5", "--screen-off", "0"])).unwrap();
        assert_eq!(on_argv(&o), ["awake", "--while-rooms", "--hours", "2.5", "--screen-off", "0"]);
        assert_eq!(parse(&on_argv(&o)[1..]).unwrap(), o, "the detached hold parses what on passed");
        assert_eq!(left_vi(0), "tới khi tắt");
        assert!(left_vi(now_s() + 2 * 3600 + 30).starts_with("còn tối đa "));
        assert!(ends_vi(&parse(&[]).unwrap()).starts_with("giữ tới khi anh tắt"));
        assert!(ends_vi(&o).contains("không còn phòng") && ends_vi(&o).contains("2.5 giờ"));
    }

    #[test]
    fn pidfile_round_trips_and_only_a_matching_live_process_counts() {
        let dir = std::env::temp_dir().join(format!("8sync-awake-test-{}-{}", std::process::id(), now_s()));
        let home = dir.join("home");
        let p = pid_path(&home);
        assert!(p.to_string_lossy().replace('\\', "/").ends_with(&format!("/.local/state/{}/ccc/awake.json", crate::brand::NS)), "{p:?}");
        assert_eq!(read_pidfile(&p), None, "no file yet");
        let f = Pidfile { pid: 4242, ident: "8sync@133000000000000000".into(), until: 1_760_900_000, while_rooms: true };
        write_pidfile(&p, &f).unwrap();
        assert_eq!(read_pidfile(&p), Some(f.clone()));
        assert!(!p.with_extension("json.tmp").exists(), "renamed into place");
        let same = |pid: u32| (pid == 4242).then(|| "8sync@133000000000000000".to_string());
        assert_eq!(live_hold(read_pidfile(&p), same), Some(f.clone()), "the very process that wrote it");
        assert_eq!(live_hold(read_pidfile(&p), |_| None), None, "dead: never killed, never shown");
        assert_eq!(live_hold(read_pidfile(&p), |_| Some("chrome@1".into())), None, "pid reused by another program");
        assert_eq!(live_hold(read_pidfile(&p), |_| Some("8sync@99".into())), None, "a later 8sync on the same pid");
        let blank = Pidfile { ident: String::new(), ..f.clone() };
        assert_eq!(live_hold(Some(blank), |_| Some(String::new())), None, "an unknown ident never matches");
        remove_if_mine(&p, 1);
        assert!(p.exists(), "another pid's file stays");
        remove_if_mine(&p, 4242);
        assert!(!p.exists());
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(read_pidfile(&p), None, "garbage is no hold");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_hold_without_an_ident_is_refused_not_untracked() {
        assert!(own_pidfile(7, None, 9, true).is_err(), "unknown process: nobody could stop it");
        assert!(own_pidfile(7, Some(String::new()), 9, true).is_err());
        assert_eq!(own_pidfile(7, Some("8sync@1".into()), 9, false).unwrap(), Pidfile { pid: 7, ident: "8sync@1".into(), until: 9, while_rooms: false });
    }

    #[test]
    fn one_on_at_a_time() {
        let home = std::env::temp_dir().join(format!("8sync-awake-lock-{}-{}", std::process::id(), now_s()));
        let p = lock_path(&home);
        assert!(p.to_string_lossy().ends_with("awake.lock"), "{p:?}");
        let first = take_lock(&p, LOCK_STALE).unwrap();
        assert!(first.is_some() && p.exists());
        assert!(take_lock(&p, LOCK_STALE).unwrap().is_none(), "a second `on` while the first waits for its hold");
        drop(first);
        assert!(!p.exists(), "released when `on` returns");
        let again = take_lock(&p, LOCK_STALE).unwrap();
        assert!(again.is_some());
        std::mem::forget(again); // an `on` that died holding it
        assert!(take_lock(&p, Duration::ZERO).unwrap().is_some(), "a stale lock is taken over");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn this_process_has_an_ident_and_off_without_a_hold_is_a_no_op() {
        let me = std::process::id();
        let id = ident(me).expect("own ident");
        assert_eq!(ident(me).as_deref(), Some(id.as_str()), "stable for one process");
        let home = std::env::temp_dir().join(format!("8sync-awake-off-{me}-{}", now_s()));
        off(&home).unwrap();
        off(&home).unwrap();
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn status_text_drops_unknowns() {
        let s = Status { schema: 1, held: Some(true), display_required: Some(false), display: Some("off"), idle_s: Some(22_140), boot_s: Some(28_800), slept_s: Some(0), modern_standby: Some(false), ours: None };
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
