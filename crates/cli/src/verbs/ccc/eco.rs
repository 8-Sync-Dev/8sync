//! `8sync ccc eco` (= `8sync eco`): keeps the machine light while Claude Code / omp sessions work
//! for hours. Owner 2026-10-24: "đảm bảo harness giữ ram, cpu, điện,
//! gpu luôn ổn định nhẹ làm việc lâu dài, in ra tôi xem hiện tại máy tôi dùng bao nhiêu".
//!
//! A session the owner opened (`claude`, `8sync ccc . core`, Claude Desktop's Code tab) and the
//! builds, dev servers, LSPs and MCP servers it spawns. One eco pass ([`tick`]):
//! - every process a session started (never the session itself, Claude Desktop's own app, 8sync, or
//!   anything above this process) that still runs at normal priority goes to below normal — the
//!   owner's apps and the session's own UI keep the CPU first;
//! - on battery, Windows battery saver, or RAM/CPU at the eco thresholds: the same processes run in
//!   Windows Efficiency mode (EcoQoS: low clocks, less power and heat); back on AC and calm, what
//!   eco put there is put back (only that);
//! - RAM at the threshold: the working set of session helpers holding ≥ [`TRIM_MIN_MB`] is handed
//!   back (`K32EmptyWorkingSet`, Windows), at most once per [`TRIM_EVERY_S`].
//!
//! Killed here: only an orphaned helper ([`reap_orphan_helpers`]): a language server / MCP server
//! / trail worker whose host session is gone (no claude/omp/editor/terminal above it). Everything
//! else stays with `8sync watchdog`.
//! Reported, never acted on alone: a Chromium / Electron renderer holding ≥ [`HEAVY_RENDERER_MB`]
//! ([`heavy_renderers`]; `8sync ccc eco heavy`). `eco restart <rootPid>` (the owner's button in
//! HQ) closes and reopens such an app, only one of [`RESTARTABLE`] and only processes of its exe.
//! One exception, done by every pass: an agent-driven browser (launched with
//! `--remote-debugging-port`) with a heavy renderer gets its New tab pages closed over CDP
//! ([`close_new_tabs`]): Edge's MSN feed with background throttling off grew to 5.4 M DOM nodes,
//! 3.9 GB, in a tab nobody used (2026-11-06). Pages with a real URL are never touched.
//! `8sync ccc eco` alone prints what the machine uses now (RAM, CPU, GPU, watts, battery, what
//! Claude Code / node hold); `run` loops every [`EVERY_S`]; `install` starts it at logon
//! (Windows Scheduled Task, systemd --user, launchd). Settings: `~/.config/8sync/eco.json`.
//! `scan` / `kill <pid:start>`: the suspects HQ's "Canh máy" hands a room, and the safe kill ([`super::watch`]).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};

use super::reap::{self, Proc};
use crate::ui;
use crate::verbs::hq_core::sampler::{Sample, Sampler};

/// Seconds between passes of `eco run`.
pub(super) const EVERY_S: u64 = 20;
/// RAM in use (%) from which eco throttles and trims.
pub(super) const DEFAULT_RAM: u32 = 80;
/// Machine CPU busy (%) from which eco throttles.
pub(super) const DEFAULT_CPU: u32 = 75;
/// A helper is trimmed only when it holds at least this much.
const TRIM_MIN_MB: u64 = 200;
/// At most one trim sweep per this many seconds.
const TRIM_EVERY_S: u64 = 600;
/// Pids eco put in Efficiency mode, kept at most this many.
const ECO_KEEP: usize = 400;
const MIB: u64 = 1024 * 1024;

const USAGE: &str = "usage: 8sync ccc eco [status] [--json] | heavy [--json] | restart <rootPid> [--json] | scan [--json] | kill <pid:start>… [--tree] [--json] | tick [--json] | reap [--dry-run] [--json] | run | install | uninstall | set ram <50..95> | set cpu <30..95> | set battery on|off";

// ── battery ──────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Battery {
    /// Charge (%), None when the OS did not say.
    pub pct: Option<u8>,
    /// Plugged in (or unknown: treated as plugged in).
    pub on_ac: bool,
    /// Windows battery saver is on.
    pub saver: bool,
}

/// One `/sys/class/power_supply/<x>` entry.
#[derive(Debug, Clone, Default)]
pub(super) struct Supply {
    pub kind: String,
    pub status: String,
    pub capacity: Option<u8>,
    pub online: Option<bool>,
    /// `Device` for a mouse/keyboard/headset battery (not the machine's).
    pub scope: String,
}

/// `/sys/class/power_supply/*` → the machine's battery, None when it has none. A peripheral's
/// battery (`scope=Device`, e.g. `hidpp_battery_0`) is not the machine's; any `Mains`/`USB` supply
/// online means plugged in.
#[cfg_attr(not(test), allow(dead_code))] // each OS uses one reader
pub(super) fn parse_power_supply(entries: &[Supply]) -> Option<Battery> {
    let bat = entries.iter().find(|e| e.kind.eq_ignore_ascii_case("battery") && !e.scope.eq_ignore_ascii_case("device"))?;
    let plugged = entries.iter().any(|e| (e.kind.eq_ignore_ascii_case("mains") || e.kind.to_ascii_lowercase().starts_with("usb")) && e.online == Some(true));
    let discharging = bat.status.eq_ignore_ascii_case("discharging");
    Some(Battery { pct: bat.capacity.map(|p| p.min(100)), on_ac: plugged || !discharging, saver: false })
}

/// `pmset -g batt` (macOS): `Now drawing from 'Battery Power'` + ` 84%;` → the battery, None when
/// no `InternalBattery` line.
#[cfg_attr(not(test), allow(dead_code))] // each OS uses one reader
pub(super) fn parse_pmset(s: &str) -> Option<Battery> {
    let line = s.lines().find(|l| l.contains("InternalBattery"))?;
    let pct = line.split(['\t', ' ', ';']).find_map(|w| w.strip_suffix('%')?.parse::<u8>().ok());
    Some(Battery { pct, on_ac: !s.contains("'Battery Power'"), saver: false })
}

/// Windows `SYSTEM_POWER_STATUS` fields → the battery (flag 128 = no system battery).
#[cfg_attr(not(test), allow(dead_code))] // each OS uses one reader
pub(super) fn from_power_status(ac_line: u8, flag: u8, pct: u8, saver: u8) -> Option<Battery> {
    // BatteryFlag is a bit mask: 128 = no system battery, 255 = unknown status.
    if flag == 255 || flag & 128 != 0 {
        return None;
    }
    Some(Battery { pct: (pct <= 100).then_some(pct), on_ac: ac_line != 0, saver: saver & 1 == 1 })
}

/// The machine's battery right now, None on a desktop (or when the OS did not say).
pub(super) fn battery() -> Option<Battery> {
    #[cfg(windows)]
    {
        #[repr(C)]
        #[derive(Default)]
        struct PowerStatus {
            ac_line: u8,
            flag: u8,
            pct: u8,
            saver: u8,
            life: u32,
            full: u32,
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetSystemPowerStatus(s: *mut PowerStatus) -> i32;
        }
        let mut s = PowerStatus::default();
        // SAFETY: `s` is a writable SYSTEM_POWER_STATUS.
        if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
            return None;
        }
        from_power_status(s.ac_line, s.flag, s.pct, s.saver)
    }
    #[cfg(target_os = "linux")]
    {
        let rd = |p: &Path, f: &str| std::fs::read_to_string(p.join(f)).map(|s| s.trim().to_string()).ok();
        let entries: Vec<_> = std::fs::read_dir("/sys/class/power_supply")
            .ok()?
            .flatten()
            .map(|e| {
                let p = e.path();
                Supply {
                    kind: rd(&p, "type").unwrap_or_default(),
                    status: rd(&p, "status").unwrap_or_default(),
                    capacity: rd(&p, "capacity").and_then(|c| c.parse().ok()),
                    online: rd(&p, "online").map(|o| o == "1"),
                    scope: rd(&p, "scope").unwrap_or_default(),
                }
            })
            .collect();
        parse_power_supply(&entries)
    }
    #[cfg(target_os = "macos")]
    {
        let o = Command::new("pmset").args(["-g", "batt"]).output().ok()?;
        parse_pmset(&String::from_utf8_lossy(&o.stdout))
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

// ── settings and state ───────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Cfg {
    pub ram: u32,
    pub cpu: u32,
    /// Efficiency mode while on battery.
    pub battery: bool,
}

impl Default for Cfg {
    fn default() -> Cfg {
        Cfg { ram: DEFAULT_RAM, cpu: DEFAULT_CPU, battery: true }
    }
}

fn cfg_path(home: &Path) -> PathBuf {
    home.join(".config/8sync/eco.json")
}

fn state_path(home: &Path) -> PathBuf {
    home.join(".config/8sync/eco-state.json")
}

fn read_json(p: &Path) -> Value {
    std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
}

fn write_json(p: &Path, v: &Value) -> Result<()> {
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(v)?)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

pub(super) fn cfg_from(v: &Value) -> Cfg {
    let d = Cfg::default();
    let pct = |k: &str, lo: u32, def: u32| v[k].as_u64().map(|n| n as u32).filter(|n| (lo..=95).contains(n)).unwrap_or(def);
    Cfg { ram: pct("ram", 50, d.ram), cpu: pct("cpu", 30, d.cpu), battery: v["battery"].as_bool().unwrap_or(d.battery) }
}

pub(super) fn cfg(home: &Path) -> Cfg {
    cfg_from(&read_json(&cfg_path(home)))
}

// ── which processes ──────────────────────────────────────────────────────────────────────────

/// A Claude Code / omp session process (the CLI, not Claude Desktop's Electron app).
pub(super) fn is_session(p: &Proc) -> bool {
    matches!(p.image.as_str(), "claude" | "omp") && !is_desktop_app(p)
}

/// Claude Desktop's own processes (the Electron app and its helpers): never touched. Matched by
/// the install paths (`AnthropicClaude`, the Store package, `Claude.app`) and Electron's
/// `--type=` helpers. Not verified against every installer layout.
pub(super) fn is_desktop_app(p: &Proc) -> bool {
    p.cmd.contains("--type=") || is_desktop_install(&p.cmd)
}

/// A command line run from Claude Desktop's install (`AnthropicClaude`, the Store package,
/// `Claude.app`), not the Claude Code CLI.
fn is_desktop_install(cmd: &str) -> bool {
    let c = cmd.to_ascii_lowercase().replace('\\', "/");
    c.contains("/anthropicclaude/") || c.contains("/windowsapps/claude") || c.contains("/claude.app/contents/macos/claude")
}

/// What eco may touch: every process a session started, minus sessions, Claude Desktop, 8sync
/// itself and `me` with its ancestors.
pub(super) fn targets(procs: &[Proc], me: u32) -> Vec<&Proc> {
    let keep = reap::lineage(procs, me);
    let mut pids: Vec<u32> = Vec::new();
    for root in procs.iter().filter(|p| is_session(p)) {
        for pid in reap::descendants(procs, root.pid, &|q| is_desktop_app(q)) {
            if !pids.contains(&pid) {
                pids.push(pid);
            }
        }
    }
    procs
        .iter()
        .filter(|p| pids.contains(&p.pid) && !is_session(p) && !is_desktop_app(p) && p.image != "8sync" && !keep.contains(&p.pid))
        .collect()
}

// ── heavy renderers ──────────────────────────────────────────────────────────────────────────

/// A Chromium / Electron renderer (`--type=renderer`) holding at least this much is reported
/// (owner 2026-11-02: Claude Desktop's renderer reached 11 GB).
pub(super) const HEAVY_RENDERER_MB: u64 = 4096;
/// Apps whose restart `eco restart` may do: chat apps whose open work lives on their servers.
/// Browsers, editors, terminals and Orca may hold the owner's unsaved work: reported only.
const RESTARTABLE: [&str; 5] = ["claude", "chatgpt", "slack", "discord", "notion"];
/// `eco restart`: how long the app gets to close by itself before what is left is forced.
const CLOSE_WAIT: Duration = Duration::from_secs(10);

/// One heavy renderer: its pid, the app's main process (`root`), the app, its RAM.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Heavy {
    pub pid: u32,
    pub root: u32,
    pub app: String,
    pub image: String,
    pub mb: u64,
    pub restartable: bool,
    /// CDP port of an agent-driven browser (`--remote-debugging-port`), whose New tabs eco closes.
    pub cdp: Option<u16>,
}

/// Browsers whose renderer may carry `--remote-debugging-port` for an agent (never an Electron app).
const CDP_BROWSERS: [&str; 5] = ["msedge", "chrome", "google chrome", "brave", "chromium"];

/// `--remote-debugging-port=N` (N > 0) of a command line.
fn cdp_port(cmd: &str) -> Option<u16> {
    let v = cmd.split_whitespace().find_map(|w| w.trim_matches('"').strip_prefix("--remote-debugging-port="))?;
    v.parse().ok().filter(|p| *p > 0)
}

/// A browser's own New tab page (no work of anyone's in it).
fn is_new_tab(url: &str) -> bool {
    ["edge://newtab", "chrome://newtab", "chrome://new-tab-page", "chrome-search://local-ntp", "https://ntp.msn.com/"].iter().any(|p| url.starts_with(p))
}

/// From CDP `/json/list`: the New tab pages to close, and whether a blank tab must open first
/// because they are all the pages there are (closing the last one would close the browser).
fn new_tab_plan(list: &Value) -> (Vec<String>, bool) {
    let pages: Vec<&Value> = list.as_array().into_iter().flatten().filter(|t| t["type"] == "page").collect();
    let close: Vec<String> = pages
        .iter()
        .filter(|t| is_new_tab(t["url"].as_str().unwrap_or("")))
        .filter_map(|t| t["id"].as_str().filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).map(str::to_string))
        .collect();
    let blank_first = !close.is_empty() && close.len() == pages.len();
    (close, blank_first)
}

/// One request to the DevTools HTTP endpoint on 127.0.0.1: the body of a 200, else None. The
/// endpoint keeps the connection open whatever `Connection:` says, so the body ends at its
/// `Content-Length`, not at EOF.
fn cdp_http(port: u16, method: &str, path: &str) -> Option<String> {
    use std::io::{Read, Write};
    let mut s = std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(2)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    write!(s, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").ok()?;
    let (mut b, mut chunk) = (Vec::new(), [0u8; 16 * 1024]);
    loop {
        if let Some(end) = b.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = std::str::from_utf8(&b[..end]).ok()?;
            let len: usize = head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.trim().eq_ignore_ascii_case("content-length")).and_then(|(_, v)| v.trim().parse().ok()))?;
            if b.len() >= end + 4 + len {
                return head.starts_with("HTTP/1.1 200").then(|| String::from_utf8_lossy(&b[end + 4..end + 4 + len]).into_owned());
            }
        }
        let n = s.read(&mut chunk).ok().filter(|n| *n > 0)?;
        if b.len() + n > 4 * 1024 * 1024 {
            return None;
        }
        b.extend_from_slice(&chunk[..n]);
    }
}

/// Closes the New tab pages of the agent browser on `port` (a blank tab first when they are all
/// it has); how many closed.
fn close_new_tabs(port: u16) -> usize {
    let Some(list) = cdp_http(port, "GET", "/json/list").and_then(|b| serde_json::from_str::<Value>(&b).ok()) else { return 0 };
    let (close, blank_first) = new_tab_plan(&list);
    if close.is_empty() || (blank_first && cdp_http(port, "PUT", "/json/new?about:blank").is_none()) {
        return 0;
    }
    close.iter().filter(|id| cdp_http(port, "GET", &format!("/json/close/{id}")).is_some()).count()
}

fn app_name(image: &str) -> String {
    match image {
        "claude" => "Claude Desktop",
        "chatgpt" => "ChatGPT",
        "slack" => "Slack",
        "discord" => "Discord",
        "notion" => "Notion",
        "msedge" => "Microsoft Edge",
        "chrome" | "google chrome" => "Chrome",
        "brave" => "Brave",
        "orca" => "Orca",
        "code" => "VS Code",
        "cursor" => "Cursor",
        "windsurf" => "Windsurf",
        "ms-teams" => "Microsoft Teams",
        "codex" => "Codex",
        other => return other.to_string(),
    }
    .to_string()
}

/// The executable a command line runs: the quoted first word, an unquoted Windows path up to its
/// `.exe` (spaces allowed), a macOS bundle binary up to its first flag, else the first word.
pub(super) fn exe_of(cmd: &str) -> &str {
    let c = cmd.trim_start();
    if let Some(r) = c.strip_prefix('"') {
        return r.split('"').next().unwrap_or("");
    }
    let l = c.to_ascii_lowercase(); // same byte offsets as `c`
    if let Some(i) = l.find(".exe").filter(|i| l[i + 4..].is_empty() || l[i + 4..].starts_with(' ')) {
        return &c[..i + 4];
    }
    if let Some(i) = l.find(".app/contents/macos/") {
        return c[i..].find(" -").map_or(c.trim_end(), |j| &c[..i + j]);
    }
    c.split_whitespace().next().unwrap_or("")
}

/// Same executable path: case-insensitive for a Windows path.
fn same_exe(p: &Proc, exe: &str) -> bool {
    let e = exe_of(&p.cmd);
    !exe.is_empty() && if reap::windows_path(exe) { e.eq_ignore_ascii_case(exe) } else { e == exe }
}

/// The app's main process above renderer `p`: the topmost ancestor of the same image without
/// `--type=`, following a parent only when it started no later than its child (never a recycled pid).
fn root_of<'a>(procs: &'a [Proc], p: &'a Proc) -> Option<&'a Proc> {
    let (mut cur, mut root) = (p, None);
    for _ in 0..64 {
        let Some(q) = procs.iter().find(|q| cur.ppid != 0 && q.pid == cur.ppid && q.pid != cur.pid && q.image == p.image && q.started <= cur.started) else { break };
        if !q.cmd.contains("--type=") {
            root = Some(q);
        }
        cur = q;
    }
    root
}

/// Renderers holding at least [`HEAVY_RENDERER_MB`], largest first (pure). `restartable` only for
/// an app of [`RESTARTABLE`] whose main process was found (Claude: Claude Desktop's install, never
/// the CLI); a renderer without one keeps its own pid as `root`.
pub(super) fn heavy_renderers(procs: &[Proc]) -> Vec<Heavy> {
    let mut out: Vec<Heavy> = procs
        .iter()
        .filter(|p| p.rss >= HEAVY_RENDERER_MB * MIB && p.cmd.contains("--type=renderer"))
        .map(|p| {
            let root = root_of(procs, p);
            let restartable = root.is_some_and(|r| RESTARTABLE.contains(&p.image.as_str()) && (p.image != "claude" || is_desktop_install(&r.cmd)) && !exe_of(&r.cmd).is_empty());
            let cdp = if CDP_BROWSERS.contains(&p.image.as_str()) { cdp_port(&p.cmd) } else { None };
            Heavy { pid: p.pid, root: root.map_or(p.pid, |r| r.pid), app: app_name(&p.image), image: p.image.clone(), mb: p.rss / MIB, restartable, cdp }
        })
        .collect();
    out.sort_by(|a, b| b.mb.cmp(&a.mb).then(a.pid.cmp(&b.pid)));
    out
}

fn heavy_json(h: &[Heavy]) -> Value {
    json!(h.iter().map(|h| json!({ "pid": h.pid, "rootPid": h.root, "app": h.app, "image": h.image, "mb": h.mb, "restartable": h.restartable, "cdp": h.cdp })).collect::<Vec<_>>())
}

/// What `eco heavy --json` prints (`{"heavy":[…]}`), read now; the HQ core serves the same.
pub(crate) fn heavy_now() -> Value {
    json!({ "heavy": heavy_json(&heavy_renderers(&reap::list(now_s()))) })
}

/// What `eco restart` closes and opens again.
#[derive(Debug, PartialEq)]
pub(super) struct Target {
    pub app: String,
    pub root: u32,
    pub exe: String,
    /// Every process running `exe` now (only these are ever forced).
    pub pids: Vec<u32>,
    pub mb: u64,
}

/// The refusal rule of `eco restart` (pure): `root` must be, right now, the main process of a
/// heavy renderer of a restartable app, and not above `me`.
pub(super) fn restart_target(procs: &[Proc], root: u32, me: u32) -> Result<Target, String> {
    let heavy = heavy_renderers(procs);
    let Some(h) = heavy.iter().find(|h| h.root == root) else {
        return Err(format!("pid {root} không phải tiến trình chính của app nào có renderer ≥ {} GB lúc này", HEAVY_RENDERER_MB / 1024));
    };
    if !h.restartable {
        return Err(format!("{} không được khởi động lại từ 8sync (có thể đang giữ việc của anh): đóng bớt tab/cửa sổ", h.app));
    }
    if reap::lineage(procs, me).contains(&root) {
        return Err(format!("8sync đang chạy bên trong {}: chạy lệnh này từ ngoài app đó", h.app));
    }
    let exe = procs.iter().find(|p| p.pid == root).map(|p| exe_of(&p.cmd).to_string()).unwrap_or_default();
    let app: Vec<&Proc> = procs.iter().filter(|p| same_exe(p, &exe)).collect();
    Ok(Target { app: h.app.clone(), root, pids: app.iter().map(|p| p.pid).collect(), mb: app.iter().map(|p| p.rss).sum::<u64>() / MIB, exe })
}

/// Body of a PowerShell single-quoted string. PowerShell also reads the curly quotes U+2018–U+201B as `'`,
/// so every one of them is doubled, not just the ASCII quote.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn ps_single_quoted(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        out.push(c);
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            out.push(c);
        }
    }
    out
}

/// Windows: ask every window of `exe` to close, wait up to [`CLOSE_WAIT`], then force only what
/// still runs from that very path (`Get-Process` `Path -eq`, never by name).
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) fn ps_close(exe: &str) -> String {
    let q = ps_single_quoted(exe);
    let ticks = CLOSE_WAIT.as_millis() / 500;
    format!(
        "$ErrorActionPreference = 'SilentlyContinue'; $exe = '{q}'; \
         function app {{ @(Get-Process | Where-Object {{ $_.Path -eq $exe }}) }}; \
         foreach ($p in app) {{ if ($p.MainWindowHandle -ne 0) {{ [void]$p.CloseMainWindow() }} }}; \
         for ($i = 0; $i -lt {ticks} -and (app).Count -gt 0; $i++) {{ Start-Sleep -Milliseconds 500 }}; \
         app | Stop-Process -Force"
    )
}

/// Windows: open `exe` again through Explorer (out of any job of the caller, as the owner would):
/// a Store package (`\WindowsApps\<PackageFullName>\`) by `shell:AppsFolder\<family>!<AppId>`.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
pub(super) fn ps_relaunch(exe: &str) -> String {
    let q = ps_single_quoted(exe);
    format!(
        "$ErrorActionPreference = 'Stop'; $exe = '{q}'; $pkg = $null; \
         if ($exe -match '\\\\WindowsApps\\\\([^\\\\]+)\\\\') {{ $full = $Matches[1]; $pkg = Get-AppxPackage | Where-Object {{ $_.PackageFullName -eq $full }} | Select-Object -First 1 }}; \
         if ($pkg) {{ $id = @((Get-AppxPackageManifest $pkg).Package.Applications.Application)[0].Id; Start-Process explorer.exe -ArgumentList ('shell:AppsFolder\\' + $pkg.PackageFamilyName + '!' + $id) }} \
         else {{ Start-Process explorer.exe -ArgumentList ('\"' + $exe + '\"') }}"
    )
}

/// `/Applications/Claude.app/Contents/MacOS/Claude` → `/Applications/Claude.app`.
#[cfg_attr(windows, allow(dead_code))]
fn app_bundle(exe: &str) -> Option<&str> {
    exe.find(".app/Contents/MacOS/").map(|i| &exe[..i + 4])
}

#[cfg(windows)]
fn powershell(script: &str) -> bool {
    use std::os::windows::process::CommandExt;
    quiet(Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).creation_flags(0x0800_0000)) // CREATE_NO_WINDOW
}

/// Closes the app (see [`ps_close`]; elsewhere SIGTERM to its main process, then SIGKILL to what
/// is left of its tree and of `exe`, each matched by pid + start time).
fn close_app(t: &Target, procs: &[Proc]) {
    #[cfg(windows)]
    {
        let _ = procs;
        powershell(&ps_close(&t.exe));
    }
    #[cfg(unix)]
    {
        let sig = |s: &str, pid: u32| quiet(Command::new("kill").args([s, &pid.to_string()]));
        let mut tree = reap::descendants(procs, t.root, &|_| false);
        tree.extend(t.pids.iter().filter(|p| !tree.contains(p)).copied().collect::<Vec<_>>());
        let tree: Vec<(u32, u64)> = tree.into_iter().filter_map(|pid| procs.iter().find(|p| p.pid == pid).map(|p| (pid, p.started))).collect();
        sig("-TERM", t.root);
        let step = Duration::from_millis(500);
        for _ in 0..CLOSE_WAIT.as_millis() / 500 {
            if !sig("-0", t.root) {
                break;
            }
            std::thread::sleep(step);
        }
        let now = reap::list(now_s());
        for (pid, started) in tree {
            if now.iter().any(|p| p.pid == pid && p.started == started) {
                sig("-KILL", pid);
            }
        }
    }
}

/// Opens the app again, detached from 8sync (macOS: `open -a` its bundle).
fn relaunch(exe: &str) -> bool {
    #[cfg(windows)]
    {
        powershell(&ps_relaunch(exe))
    }
    #[cfg(not(windows))]
    {
        if let Some(b) = app_bundle(exe).filter(|_| cfg!(target_os = "macos")) {
            return quiet(Command::new("open").args(["-a", b]));
        }
        super::awake::spawn_detached(Path::new(exe), &[]).is_ok()
    }
}

/// `8sync ccc eco restart <rootPid>`: closes the app whose renderer is heavy and opens it again.
fn restart(root: u32, json_out: bool) -> Result<()> {
    let procs = reap::list(now_s());
    let t = restart_target(&procs, root, std::process::id()).map_err(anyhow::Error::msg)?;
    if !json_out {
        ui::info(&format!("đóng {} ({} tiến trình, {} GB), chờ tối đa {} s rồi mở lại", t.app, t.pids.len(), gb(t.mb), CLOSE_WAIT.as_secs()));
    }
    close_app(&t, &procs);
    let left: u64 = reap::list(now_s()).iter().filter(|p| same_exe(p, &t.exe)).map(|p| p.rss).sum::<u64>() / MIB;
    let freed = t.mb.saturating_sub(left);
    let relaunched = relaunch(&t.exe);
    if json_out {
        println!("{}", serde_json::to_string_pretty(&json!({ "ok": true, "app": t.app, "freedMb": freed, "relaunched": relaunched }))?);
    } else if relaunched {
        ui::ok(&format!("{}: trả lại {} GB RAM, đã mở lại", t.app, gb(freed)));
    } else {
        ui::warn(&format!("{}: trả lại {} GB RAM nhưng chưa mở lại được, mở tay giúp em", t.app, gb(freed)));
    }
    Ok(())
}

// ── orphaned helpers ─────────────────────────────────────────────────────────────────────────

/// An orphaned helper goes only from this age (one just started may not be handed over yet).
const REAP_AGE_S: u64 = 120;
/// A trail-code worker goes only from this age.
const TRAIL_AGE_S: u64 = 600;
/// At most this many helpers (each with its tree) killed per pass.
pub(super) const REAP_MAX: usize = 20;

/// What keeps a helper in use while it sits anywhere above it: a coding session or editor/terminal
/// (claude incl. Claude Desktop, omp, VS Code, Cursor, Codex desktop, Windows Terminal), 8sync, a
/// headless `conhost` (scheduled tasks), HQ's app and the OKX trader.
fn is_host(p: &Proc) -> bool {
    let c = p.cmd.to_lowercase();
    matches!(p.image.as_str(), "claude" | "omp" | "code" | "code - insiders" | "cursor" | "windsurf" | "codex" | "chatgpt" | "windowsterminal" | "wt" | "8sync")
        || (p.image == "conhost" && c.contains("--headless"))
        || reap::is_hq(&c)
        || c.contains("okx-click-trader")
}

/// The helper `p` runs, junk only once orphaned. Never a shell, 8sync or a host; an MCP only from
/// this list (an MCP a bot runs, like okx-trade-mcp, is that bot's).
pub(super) fn helper_kind(p: &Proc) -> Option<&'static str> {
    if p.shell || is_host(p) {
        return None;
    }
    let c = p.cmd.to_lowercase().replace('\\', "/");
    let has = |s: &str| c.contains(s);
    Some(if has("@trailhq/trail-code") && has("_trail-") {
        "trail worker"
    } else if has("bash-language-server") {
        "bash-language-server"
    } else if has("typescript-language-server") {
        "typescript-language-server"
    } else if has("tsserver") {
        "tsserver"
    } else if has("pyright") || has("langserver") || has("language-server") {
        "language server"
    } else if has("@z_ai/mcp-server") || has("zai-mcp-server") {
        "MCP zai"
    } else if has("headroom") && has("mcp") {
        "MCP headroom"
    } else if has("unreal-mcp") {
        "MCP unreal"
    } else if has("codebase-memory-mcp") {
        "MCP codebase-memory"
    } else if has("serena") && has("mcp") {
        "MCP serena"
    } else {
        return None;
    })
}

/// A live host ([`is_host`]) above `p`, walking up only to a parent that started no later than its
/// child (a recycled pid is never followed). A parent of unknown start counts as a host: kept
/// rather than guessed.
fn hosted(procs: &[Proc], p: &Proc) -> bool {
    let mut cur = p;
    for _ in 0..64 {
        let Some(q) = procs.iter().find(|q| cur.ppid != 0 && q.pid == cur.ppid && q.pid != cur.pid && q.started <= cur.started) else { return false };
        if q.started == 0 || is_host(q) {
            return true;
        }
        cur = q;
    }
    true
}

/// One orphaned helper: its pid, kind, tree (itself first, then what it started) and the tree's RAM.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Orphan {
    pub pid: u32,
    pub kind: &'static str,
    pub tree: Vec<u32>,
    pub rss: u64,
}

/// What [`reap_orphan_helpers`] kills (pure): helpers ([`helper_kind`]) of known start, at least
/// [`REAP_AGE_S`] old ([`TRAIL_AGE_S`] for a trail worker), with no host above them, never `me` or
/// its ancestors; one inside another's tree goes with that one; at most [`REAP_MAX`].
pub(super) fn orphans(procs: &[Proc], now: u64, me: u32) -> Vec<Orphan> {
    let keep = reap::lineage(procs, me);
    let mut out: Vec<Orphan> = Vec::new();
    for p in procs {
        let Some(kind) = helper_kind(p) else { continue };
        let min = if kind == "trail worker" { TRAIL_AGE_S } else { REAP_AGE_S };
        if p.started == 0 || now.saturating_sub(p.started) < min || keep.contains(&p.pid) || hosted(procs, p) {
            continue;
        }
        let tree = reap::descendants(procs, p.pid, &|q| is_host(q) || keep.contains(&q.pid));
        let rss = procs.iter().filter(|q| tree.contains(&q.pid)).map(|q| q.rss).sum();
        out.push(Orphan { pid: p.pid, kind, tree, rss });
    }
    let all = out.clone();
    out.retain(|o| !all.iter().any(|x| x.pid != o.pid && x.tree.contains(&o.pid)));
    out.truncate(REAP_MAX);
    out
}

fn reap_log(home: &Path) -> PathBuf {
    home.join(".config/8sync/eco-reap.log")
}

/// Kills (with `dry_run` only lists) the [`orphans`] of `procs`, each pid of a tree alone
/// ([`reap::kill`]: no `taskkill /T`, which follows stale parent links); every kill is appended to
/// `~/.config/8sync/eco-reap.log` (started over past 512 KB). One row per helper.
pub(super) fn reap_orphan_helpers(home: &Path, procs: &[Proc], now: u64, dry_run: bool) -> Vec<Value> {
    let mut rows = Vec::new();
    let mut log = String::new();
    for o in orphans(procs, now, std::process::id()) {
        let p = procs.iter().find(|q| q.pid == o.pid);
        let name = p.map_or("", |p| p.name.as_str());
        let killed = !dry_run && reap::kill(&o.tree).first().copied().unwrap_or(false);
        let (mb, age_m) = (o.rss / MIB, p.map_or(0, |p| now.saturating_sub(p.started) / 60));
        if killed {
            log.push_str(&format!("{now} killed {} {name} pid {} ({} pids, {age_m}m, {mb} MB)\n", o.kind, o.pid, o.tree.len()));
        }
        let cmd: String = p.map_or(String::new(), |p| p.cmd.chars().take(140).collect());
        rows.push(json!({ "pid": o.pid, "kind": o.kind, "name": name, "pids": o.tree.len(), "mb": mb, "ageMin": age_m, "killed": killed, "cmd": cmd }));
    }
    if !log.is_empty() {
        use std::io::Write;
        let path = reap_log(home);
        let fresh = std::fs::metadata(&path).is_ok_and(|m| m.len() > 512 * 1024);
        let _ = path.parent().map(std::fs::create_dir_all);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).write(true).append(!fresh).truncate(fresh).open(&path) {
            let _ = f.write_all(log.as_bytes());
        }
    }
    rows
}

// ── one pass ─────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Mode {
    Calm,
    /// RAM or CPU at the eco threshold.
    Hot,
    /// On battery (or Windows battery saver) with `battery` on.
    Battery,
}

impl Mode {
    fn key(self) -> &'static str {
        match self {
            Mode::Calm => "calm",
            Mode::Hot => "hot",
            Mode::Battery => "battery",
        }
    }
}

/// Points under a threshold RAM and CPU must both fall before Hot ends (no flapping: a build at
/// 100% CPU in Efficiency mode drops under the threshold, and must not be let out next tick).
pub(super) const HYSTERESIS: u32 = 10;

/// `was_hot`: the previous pass was Hot.
pub(super) fn mode(ram: Option<u32>, cpu: Option<u32>, bat: Option<Battery>, c: Cfg, was_hot: bool) -> Mode {
    let over = |v: Option<u32>, t: u32| v.is_some_and(|v| v >= if was_hot { t.saturating_sub(HYSTERESIS) } else { t });
    if c.battery && bat.is_some_and(|b| !b.on_ac || b.saver) {
        Mode::Battery
    } else if over(ram, c.ram) || over(cpu, c.cpu) {
        Mode::Hot
    } else {
        Mode::Calm
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Plan {
    /// To below-normal priority.
    pub lower: Vec<u32>,
    /// Into Efficiency mode.
    pub eco_on: Vec<u32>,
    /// `(pid, started)` eco put in Efficiency mode earlier, back to the default.
    pub eco_off: Vec<(u32, u64)>,
    /// Working sets to hand back.
    pub trim: Vec<u32>,
}

/// What one pass does (pure). `ecoed`: `(pid, started)` eco put in Efficiency mode before;
/// `trimmed_at`: last trim sweep (unix s).
pub(super) fn plan(t: &[&Proc], m: Mode, ram: Option<u32>, c: Cfg, ecoed: &[(u32, u64)], trimmed_at: u64, now: u64) -> Plan {
    let mut p = Plan { lower: t.iter().filter(|q| q.normal).map(|q| q.pid).collect(), ..Plan::default() };
    if m == Mode::Calm {
        p.eco_off = ecoed.to_vec();
    } else {
        p.eco_on = t.iter().map(|q| q.pid).collect();
    }
    if ram.is_some_and(|r| r >= c.ram) && now.saturating_sub(trimmed_at) >= TRIM_EVERY_S {
        p.trim = t.iter().filter(|q| q.rss >= TRIM_MIN_MB * MIB).map(|q| q.pid).collect();
    }
    p
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

fn ecoed_of(st: &Value) -> Vec<(u32, u64)> {
    st["ecoed"].as_array().into_iter().flatten().filter_map(|e| Some((e[0].as_u64()? as u32, e[1].as_u64()?))).collect()
}

/// One pass: returns what it did (also kept in the state file for `status`).
pub(super) fn tick(home: &Path, sampler: Option<&Sampler>) -> Value {
    let now = now_s();
    let c = cfg(home);
    let s = sampler.map(|x| x.get(Duration::from_secs(5))).unwrap_or_default();
    let ram = reap::ram_pct(s.mem);
    let bat = battery();
    let st = read_json(&state_path(home));
    let m = mode(ram, s.cpu_pct, bat, c, st["last"]["mode"] == "hot");
    let procs = reap::list(now);
    let reaped = reap_orphan_helpers(home, &procs, now, false).iter().filter(|r| r["killed"] == true).count();
    let mut ports: Vec<u16> = heavy_renderers(&procs).iter().filter_map(|h| h.cdp).collect();
    ports.sort_unstable();
    ports.dedup();
    let tabs_closed: usize = ports.into_iter().map(close_new_tabs).sum();
    let t = targets(&procs, std::process::id());
    let ecoed = ecoed_of(&st);
    let p = plan(&t, m, ram, c, &ecoed, st["trimmedAt"].as_u64().unwrap_or(0), now);

    let lowered = super::pressure::lower(&p.lower, false);
    let eco_on = super::pressure::eco(&p.eco_on, true);
    let alive = |pid: u32, started: u64| procs.iter().any(|q| q.pid == pid && q.started == started);
    let off: Vec<u32> = p.eco_off.iter().filter(|(pid, st)| alive(*pid, *st)).map(|(pid, _)| *pid).collect();
    let eco_off = super::pressure::eco(&off, false);
    let (trimmed, trimmed_bytes) = if p.trim.is_empty() { (0, 0) } else { super::pressure::trim(&procs, &p.trim) };

    let mut next: Vec<(u32, u64)> = if m == Mode::Calm { Vec::new() } else { ecoed.into_iter().filter(|(pid, st)| alive(*pid, *st)).collect() };
    if m != Mode::Calm {
        for q in &t {
            if !next.iter().any(|(pid, _)| *pid == q.pid) {
                next.push((q.pid, q.started));
            }
        }
    }
    next.truncate(ECO_KEEP);
    let last = json!({
        "at": now, "mode": m.key(), "ram": ram, "cpu": s.cpu_pct, "targets": t.len(),
        "lowered": lowered, "ecoOn": eco_on, "ecoOff": eco_off, "trimmed": trimmed, "trimmedMb": trimmed_bytes / MIB, "reaped": reaped, "tabsClosed": tabs_closed,
    });
    let state = json!({
        "ecoed": next.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>(),
        "trimmedAt": if trimmed > 0 { now } else { st["trimmedAt"].as_u64().unwrap_or(0) },
        "last": last,
    });
    let _ = write_json(&state_path(home), &state);
    last
}

// ── what the machine uses ────────────────────────────────────────────────────────────────────

fn gb(mb: u64) -> String {
    format!("{:.1}", mb as f64 / 1024.0)
}

/// Machine usage as JSON (also the MCP `machine` tool): RAM, CPU, GPUs, watts, battery, what
/// Claude Code / node hold, renderers holding ≥ [`HEAVY_RENDERER_MB`], the eco thresholds and its
/// last pass.
pub(crate) fn snapshot_json(home: &Path, s: &Sample) -> Value {
    let c = cfg(home);
    let bat = battery();
    let ram = reap::ram_pct(s.mem);
    let st = read_json(&state_path(home));
    let gpu_w: Option<f64> = s.gpus.as_ref().and_then(|g| {
        let w: Vec<f64> = g.iter().filter_map(|g| g.watts).collect();
        (!w.is_empty()).then(|| w.iter().sum())
    });
    json!({
        "at": s.at,
        "ram": s.mem.map(|(t, u)| json!({ "totalMb": t, "usedMb": u, "pct": ram })),
        "cpu": { "pct": s.cpu_pct, "cores": s.cores, "watts": s.cpu_w.map(|w| (w * 10.0).round() / 10.0) },
        "gpus": s.gpus.as_ref().map(|g| g.iter().map(|g| json!({
            "name": g.name, "util": g.util, "memUsedMb": g.mem_used, "memTotalMb": g.mem_total, "temp": g.temp, "watts": g.watts,
        })).collect::<Vec<_>>()),
        "gpuWatts": gpu_w,
        "heavy": heavy_json(&heavy_renderers(&reap::list(now_s()))),
        "battery": bat.map(|b| json!({ "pct": b.pct, "onAc": b.on_ac, "saver": b.saver })),
        "procs": s.procs.map(|(c, n)| json!({
            "claude": { "n": c.n, "mb": c.bytes / MIB },
            "node": { "n": n.n, "mb": n.bytes / MIB },
        })),
        "eco": {
            "mode": mode(ram, s.cpu_pct, bat, c, st["last"]["mode"] == "hot").key(),
            "ramPct": c.ram, "cpuPct": c.cpu, "battery": c.battery,
            "installed": installed(home),
            "last": st["last"].clone(),
        },
    })
}

/// One Vietnamese line per heavy renderer of [`heavy_json`].
fn heavy_lines(heavy: &Value) -> Vec<String> {
    heavy
        .as_array()
        .into_iter()
        .flatten()
        .map(|h| {
            let what = if h["restartable"] == true {
                format!("có thể khởi động lại (`8sync eco restart {}`)", h["rootPid"])
            } else if let Some(port) = h["cdp"].as_u64() {
                format!("trình duyệt agent (CDP :{port}): eco tự đóng tab New tab, còn nặng là trang agent đang dùng")
            } else {
                "đóng bớt tab/cửa sổ".to_string()
            };
            format!("Renderer nặng: {} {} GB (pid {}) — {what}", h["app"].as_str().unwrap_or("?"), gb(h["mb"].as_u64().unwrap_or(0)), h["pid"])
        })
        .collect()
}

/// The human view of [`snapshot_json`] (Vietnamese, one line per part).
pub(super) fn snapshot_text(v: &Value) -> String {
    let mut out = Vec::new();
    let mut m = Vec::new();
    if let Some(r) = v["ram"].as_object() {
        let (t, u) = (r["totalMb"].as_u64().unwrap_or(0), r["usedMb"].as_u64().unwrap_or(0));
        m.push(format!("RAM {}/{} GB ({}%)", gb(u), gb(t), r["pct"].as_u64().unwrap_or(0)));
    }
    if let Some(c) = v["cpu"]["pct"].as_u64() {
        m.push(format!("CPU {c}% ({} luồng)", v["cpu"]["cores"].as_u64().unwrap_or(0)));
    }
    out.push(format!("Máy: {}", if m.is_empty() { "không đọc được".into() } else { m.join(" · ") }));
    for g in v["gpus"].as_array().into_iter().flatten() {
        let mut l = format!("GPU {}: {}% · VRAM {}/{} GB", g["name"].as_str().unwrap_or("?"), g["util"].as_u64().unwrap_or(0), gb(g["memUsedMb"].as_u64().unwrap_or(0)), gb(g["memTotalMb"].as_u64().unwrap_or(0)));
        if let Some(t) = g["temp"].as_u64() {
            l.push_str(&format!(" · {t}°C"));
        }
        if let Some(w) = g["watts"].as_f64() {
            l.push_str(&format!(" · {w:.0} W"));
        }
        out.push(l);
    }
    if v["gpus"].is_null() {
        out.push("GPU: không đọc được (không có NVIDIA/driver NVML)".into());
    }
    let mut p = Vec::new();
    if let Some(w) = v["cpu"]["watts"].as_f64() {
        p.push(format!("CPU {w:.0} W"));
    }
    if let Some(w) = v["gpuWatts"].as_f64() {
        p.push(format!("GPU {w:.0} W"));
    }
    match v["battery"].as_object() {
        Some(b) => {
            let pct = b["pct"].as_u64().map_or("?".into(), |x| format!("{x}%"));
            let src = if b["onAc"].as_bool().unwrap_or(true) { "đang cắm sạc" } else { "đang chạy pin" };
            let saver = if b["saver"].as_bool().unwrap_or(false) { " · tiết kiệm pin bật" } else { "" };
            p.push(format!("pin {pct} ({src}{saver})"));
        }
        None => p.push("không có pin (máy bàn)".into()),
    }
    out.push(format!("Điện: {}", p.join(" · ")));
    if let Some(pr) = v["procs"].as_object() {
        out.push(format!(
            "Claude Code: {} tiến trình, {} GB · node: {} tiến trình, {} GB",
            pr["claude"]["n"].as_u64().unwrap_or(0),
            gb(pr["claude"]["mb"].as_u64().unwrap_or(0)),
            pr["node"]["n"].as_u64().unwrap_or(0),
            gb(pr["node"]["mb"].as_u64().unwrap_or(0))
        ));
    }
    out.extend(heavy_lines(&v["heavy"]));
    let e = &v["eco"];
    let mode = match e["mode"].as_str() {
        Some("battery") => "tiết kiệm (đang chạy pin)",
        Some("hot") => "giảm tải (RAM/CPU chạm ngưỡng)",
        _ => "bình thường",
    };
    let svc = if e["installed"].as_bool().unwrap_or(false) { "chạy nền khi đăng nhập" } else { "chưa cài chạy nền (`8sync eco install`)" };
    out.push(format!("Eco: {mode} · ngưỡng RAM {}% / CPU {}% · {svc}", e["ramPct"].as_u64().unwrap_or(0), e["cpuPct"].as_u64().unwrap_or(0)));
    if let Some(l) = e["last"].as_object() {
        out.push(format!(
            "Lần chạy gần nhất: {} tiến trình của phiên · hạ ưu tiên {} · Efficiency mode +{}/-{} · trả RAM {} ({} MB) · dọn helper mồ côi {}",
            l["targets"].as_u64().unwrap_or(0),
            l["lowered"].as_u64().unwrap_or(0),
            l["ecoOn"].as_u64().unwrap_or(0),
            l["ecoOff"].as_u64().unwrap_or(0),
            l["trimmed"].as_u64().unwrap_or(0),
            l["trimmedMb"].as_u64().unwrap_or(0),
            l.get("reaped").and_then(Value::as_u64).unwrap_or(0) // absent in a state written before reaping
        ));
    }
    out.join("\n")
}

// ── run at logon ─────────────────────────────────────────────────────────────────────────────

const TASK: &str = "8sync\\eco";
const UNIT: &str = "8sync-eco.service";

fn marker(home: &Path) -> PathBuf {
    home.join(".config/8sync/eco-installed")
}

fn installed(home: &Path) -> bool {
    marker(home).exists()
}

/// The systemd --user unit: low priority and hard bounds, restarted when it dies.
pub(super) fn systemd_unit(exe: &str) -> String {
    format!(
        "[Unit]\nDescription=8sync eco: keep sessions' helpers light\n\n[Service]\nExecStart=\"{exe}\" ccc eco run\nRestart=always\nRestartSec=30\nNice=15\nCPUQuota=5%\nMemoryMax=96M\nIOSchedulingClass=idle\n\n[Install]\nWantedBy=default.target\n"
    )
}

/// Windows: the logon task, registered through PowerShell's ScheduledTasks module because
/// `schtasks /Create` keeps Task Scheduler's defaults (no start on battery, stopped when the
/// laptop unplugs, killed after 72 h): exactly when eco matters. `conhost --headless` keeps it
/// from opening a console window; restarted up to 3 times if it dies.
pub(super) fn ps_register(exe: &str) -> String {
    let q = |s: &str| s.replace('\'', "''");
    let arg = q(&format!("--headless \"{exe}\" ccc eco run"));
    format!(
        "$a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '{arg}'; \
         $t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; \
         $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew; \
         Register-ScheduledTask -TaskPath '\\8sync\\' -TaskName 'eco' -Action $a -Trigger $t -Settings $s -Force | Out-Null; \
         Start-ScheduledTask -TaskPath '\\8sync\\' -TaskName 'eco'"
    )
}

fn quiet(cmd: &mut Command) -> bool {
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success())
}

fn install(home: &Path) -> Result<()> {
    let exe = std::env::current_exe().context("current_exe")?;
    let exe = exe.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    if exe.contains("/target/") || exe.contains("\\target\\") {
        ui::warn(&format!("{exe} trông như bản build tạm: task sẽ trỏ vào đây. Cài bản phát hành rồi chạy lại nếu không muốn vậy."));
    }
    if cfg!(windows) {
        let ok = quiet(Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &ps_register(&exe)]));
        if !ok {
            bail!("Register-ScheduledTask {TASK} không thành công");
        }
        ui::ok(&format!("Scheduled Task `{TASK}`: chạy khi đăng nhập, cả khi chạy pin, không giới hạn giờ, ẩn cửa sổ; đã chạy ngay"));
    } else if cfg!(target_os = "macos") {
        // No priority read (ps), no Efficiency mode, no working-set trim on macOS yet: a service
        // would run and change nothing. `8sync eco` (status) works there.
        bail!("eco chạy nền chưa hỗ trợ macOS (chỉ xem: `8sync eco`)");
    } else {
        let dir = home.join(".config/systemd/user");
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(UNIT), systemd_unit(&exe))?;
        let _ = quiet(Command::new("systemctl").args(["--user", "daemon-reload"]));
        if !quiet(Command::new("systemctl").args(["--user", "enable", "--now", UNIT])) {
            bail!("systemctl --user enable --now {UNIT} không thành công (có user systemd không?)");
        }
        ui::ok(&format!("{UNIT}: Nice=15, CPUQuota=5%, MemoryMax=96M"));
    }
    write_json(&marker(home), &json!({ "at": now_s(), "exe": exe }))?;
    ui::info("xem: 8sync eco · gỡ: 8sync eco uninstall");
    Ok(())
}

fn uninstall(home: &Path) -> Result<()> {
    if cfg!(windows) {
        let _ = quiet(Command::new("schtasks").args(["/End", "/TN", TASK]));
        let _ = quiet(Command::new("schtasks").args(["/Delete", "/TN", TASK, "/F"]));
    } else if !cfg!(target_os = "macos") {
        let _ = quiet(Command::new("systemctl").args(["--user", "disable", "--now", UNIT]));
        let _ = std::fs::remove_file(home.join(".config/systemd/user").join(UNIT));
        let _ = quiet(Command::new("systemctl").args(["--user", "daemon-reload"]));
    }
    // A loop the service manager left running (e.g. the task's conhost ended, its child not).
    let procs = reap::list(now_s());
    let me = std::process::id();
    let loops: Vec<u32> = procs.iter().filter(|p| p.pid != me && p.image == "8sync" && p.cmd.contains("ccc eco run")).map(|p| p.pid).collect();
    if !loops.is_empty() {
        reap::kill(&loops);
    }
    // What eco put in Efficiency mode goes back: only the very processes (pid + start time).
    let st = read_json(&state_path(home));
    let pids: Vec<u32> = ecoed_of(&st).into_iter().filter(|(pid, started)| procs.iter().any(|q| q.pid == *pid && q.started == *started)).map(|(p, _)| p).collect();
    let n = super::pressure::eco(&pids, false);
    let _ = std::fs::remove_file(marker(home));
    let _ = std::fs::remove_file(state_path(home));
    ui::ok(&format!("eco đã gỡ ({n} tiến trình trả về chế độ thường)"));
    Ok(())
}

fn set(home: &Path, rest: &[String]) -> Result<()> {
    let p = cfg_path(home);
    let mut v = read_json(&p);
    if !v.is_object() {
        v = json!({});
    }
    match (rest.first().map(String::as_str), rest.get(1).map(String::as_str)) {
        (Some(k @ ("ram" | "cpu")), Some(n)) => {
            let n: u32 = n.parse().context("cần một số %")?;
            let lo = if k == "ram" { 50 } else { 30 };
            if !(lo..=95).contains(&n) {
                bail!("{k} nhận {lo}..95");
            }
            v[k] = json!(n);
        }
        (Some("battery"), Some(o @ ("on" | "off"))) => v["battery"] = json!(o == "on"),
        _ => bail!("{USAGE}"),
    }
    write_json(&p, &v)?;
    let c = cfg_from(&v);
    ui::ok(&format!("eco: RAM {}% · CPU {}% · pin {}", c.ram, c.cpu, if c.battery { "on" } else { "off" }));
    Ok(())
}

/// `8sync ccc eco …`.
pub(super) fn run(rest: &[String], home: &Path) -> Result<()> {
    let json_out = rest.iter().any(|a| a == "--json");
    let args: Vec<&String> = rest.iter().filter(|a| *a != "--json").collect();
    match args.first().map(|s| s.as_str()) {
        None | Some("status") => {
            let s = Sampler::new().map(|s| s.get(Duration::ZERO)).unwrap_or_default();
            let v = snapshot_json(home, &s);
            if json_out {
                println!("{}", serde_json::to_string_pretty(&v)?);
            } else {
                println!("{}", snapshot_text(&v));
            }
            Ok(())
        }
        Some("tick") => {
            let sampler = Sampler::new();
            let v = tick(home, sampler.as_ref());
            if json_out {
                println!("{}", serde_json::to_string_pretty(&v)?);
            } else {
                println!("eco: {} · hạ ưu tiên {} · Efficiency +{}/-{} · trả RAM {} · dọn helper mồ côi {}", v["mode"].as_str().unwrap_or("?"), v["lowered"], v["ecoOn"], v["ecoOff"], v["trimmed"], v["reaped"]);
            }
            Ok(())
        }
        Some("heavy") => {
            let v = heavy_now();
            let h = &v["heavy"];
            if json_out {
                println!("{}", serde_json::to_string_pretty(&v)?);
            } else if h.as_array().is_some_and(|a| a.is_empty()) {
                println!("Không có renderer nào ≥ {} GB", HEAVY_RENDERER_MB / 1024);
            } else {
                println!("{}", heavy_lines(h).join("\n"));
            }
            Ok(())
        }
        Some("restart") => {
            let pid: u32 = args.get(1).and_then(|s| s.parse().ok()).filter(|p| *p > 0).with_context(|| USAGE.to_string())?;
            restart(pid, json_out)
        }
        Some("scan") => {
            let v = super::watch::scan();
            println!("{}", if json_out { serde_json::to_string_pretty(&v)? } else { super::watch::scan_text(&v) });
            Ok(())
        }
        Some("kill") => {
            let ids: Vec<&str> = args[1..].iter().map(|s| s.as_str()).filter(|s| !s.starts_with("--")).collect();
            if ids.is_empty() {
                bail!("{USAGE}");
            }
            let rows = super::watch::kill(home, &ids, args.iter().any(|a| *a == "--tree"));
            if json_out {
                println!("{}", serde_json::to_string_pretty(&json!({ "results": rows }))?);
            } else {
                for r in &rows {
                    println!("{} {}: {}", if r["ok"] == true { "✓" } else { "✗" }, r["id"].as_str().unwrap_or(""), r["error"].as_str().unwrap_or("đã kill"));
                }
            }
            if rows.iter().all(|r| r["ok"] == true) {
                Ok(())
            } else {
                bail!("có id chưa kill được")
            }
        }
        Some("reap") => {
            let dry = args.iter().any(|a| *a == "--dry-run");
            let now = now_s();
            let rows = reap_orphan_helpers(home, &reap::list(now), now, dry);
            if json_out {
                println!("{}", serde_json::to_string_pretty(&json!({ "dryRun": dry, "helpers": rows }))?);
                return Ok(());
            }
            let verb = if dry { "sẽ dọn" } else { "đã dọn" };
            println!("eco reap{}: {} helper mồ côi (không còn claude/omp/editor/terminal nào phía trên)", if dry { " (dry-run)" } else { "" }, rows.len());
            for r in &rows {
                let ok = if dry || r["killed"] == true { verb } else { "không dọn được" };
                println!(
                    "  {ok}: {} {} pid {} ({} tiến trình, {}m, {} MB) · {}",
                    r["kind"].as_str().unwrap_or("?"),
                    r["name"].as_str().unwrap_or(""),
                    r["pid"],
                    r["pids"],
                    r["ageMin"],
                    r["mb"],
                    r["cmd"].as_str().unwrap_or("")
                );
            }
            Ok(())
        }
        Some("run") => {
            // The loop itself is the lightest thing on the machine.
            super::pressure::lower(&[std::process::id()], true);
            let _ = super::pressure::eco(&[std::process::id()], true);
            let sampler = Sampler::new();
            loop {
                tick(home, sampler.as_ref());
                std::thread::sleep(Duration::from_secs(EVERY_S));
            }
        }
        Some("install") => install(home),
        Some("uninstall") => uninstall(home),
        Some("set") => set(home, &args[1..].iter().map(|s| s.to_string()).collect::<Vec<_>>()),
        _ => bail!("{USAGE}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, ppid: u32, image: &str, cmd: &str) -> Proc {
        Proc { pid, ppid, started: 100, image: image.into(), cmd: cmd.into(), normal: true, rss: 50 * MIB, ..Proc::default() }
    }

    #[test]
    fn battery_parsers() {
        let e = |t: &str, s: &str, c: Option<u8>, o: Option<bool>| Supply { kind: t.into(), status: s.into(), capacity: c, online: o, scope: String::new() };
        assert_eq!(parse_power_supply(&[e("Mains", "", None, Some(true))]), None);
        let b = parse_power_supply(&[e("Mains", "", None, Some(false)), e("Battery", "Discharging", Some(64), None)]).unwrap();
        assert_eq!((b.pct, b.on_ac), (Some(64), false));
        let b = parse_power_supply(&[e("Mains", "", None, Some(true)), e("Battery", "Charging", Some(90), None)]).unwrap();
        assert!(b.on_ac);
        // A wireless mouse's battery is not the machine's: a desktop has none.
        let mouse = Supply { scope: "Device".into(), ..e("Battery", "Discharging", Some(40), None) };
        assert_eq!(parse_power_supply(&[e("Mains", "", None, Some(true)), mouse.clone()]), None);
        // Plugged in over USB-C while the battery still reports discharging (some firmware).
        let b = parse_power_supply(&[mouse, e("USB", "", None, Some(true)), e("Battery", "Discharging", Some(70), None)]).unwrap();
        assert!(b.on_ac && b.pct == Some(70));
        let mac = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t84%; discharging; 4:10 remaining present: true";
        assert_eq!(parse_pmset(mac), Some(Battery { pct: Some(84), on_ac: false, saver: false }));
        assert_eq!(parse_pmset("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged;").map(|b| b.on_ac), Some(true));
        assert_eq!(parse_pmset("Now drawing from 'AC Power'\n"), None);
        assert_eq!(from_power_status(1, 128, 255, 0), None);
        assert_eq!(from_power_status(1, 128 | 8, 255, 0), None, "a bit mask: no battery + charging bits");
        assert_eq!(from_power_status(0, 0, 55, 1), Some(Battery { pct: Some(55), on_ac: false, saver: true }));
        assert_eq!(from_power_status(1, 8, 255, 0).map(|b| b.pct), Some(None));
    }

    #[test]
    fn mode_prefers_battery_then_load() {
        let c = Cfg::default();
        let bat = Some(Battery { pct: Some(50), on_ac: false, saver: false });
        assert_eq!(mode(Some(10), Some(5), bat, c, false), Mode::Battery);
        assert_eq!(mode(Some(10), Some(5), bat, Cfg { battery: false, ..c }, false), Mode::Calm);
        assert_eq!(mode(Some(80), Some(5), None, c, false), Mode::Hot);
        assert_eq!(mode(Some(10), Some(75), None, c, false), Mode::Hot);
        assert_eq!(mode(None, None, None, c, false), Mode::Calm);
        let saver = Some(Battery { pct: Some(90), on_ac: true, saver: true });
        assert_eq!(mode(Some(10), Some(5), saver, c, false), Mode::Battery);
        // Hysteresis: once hot, stays hot until both are HYSTERESIS points under.
        assert_eq!(mode(Some(40), Some(70), None, c, false), Mode::Calm);
        assert_eq!(mode(Some(40), Some(70), None, c, true), Mode::Hot);
        assert_eq!(mode(Some(72), Some(10), None, c, true), Mode::Hot);
        assert_eq!(mode(Some(69), Some(64), None, c, true), Mode::Calm);
    }

    #[test]
    fn cfg_takes_only_sane_numbers() {
        assert_eq!(cfg_from(&json!({ "ram": 70, "cpu": 40, "battery": false })), Cfg { ram: 70, cpu: 40, battery: false });
        assert_eq!(cfg_from(&json!({ "ram": 20, "cpu": 99 })), Cfg::default());
        assert_eq!(cfg_from(&Value::Null), Cfg::default());
    }

    #[test]
    fn targets_are_what_sessions_started_never_the_session_desktop_or_me() {
        let procs = vec![
            p(1, 0, "explorer", ""),
            p(10, 1, "claude", r"C:\Users\a\.local\bin\claude.exe"),
            p(11, 10, "node", "node tsserver.js"),
            p(12, 11, "esbuild", "esbuild --watch"),
            p(13, 10, "claude", "claude --resume x"), // a nested session stays normal
            p(14, 10, "8sync", "8sync ccc hook verify"),
            p(20, 1, "claude", r"C:\Users\a\AppData\Local\AnthropicClaude\app-1.2\claude.exe"),
            p(21, 20, "claude", r"C:\Users\a\AppData\Local\AnthropicClaude\app-1.2\claude.exe --type=renderer"),
            p(22, 20, "node", "node mcp-server.js"),
            p(30, 1, "code", "code ."),
            p(31, 30, "node", "node server.js"),
            p(40, 10, "bash", "bash -c 8sync ccc eco tick"),
            p(41, 40, "8sync", "8sync ccc eco tick"),
        ];
        let got: Vec<u32> = targets(&procs, 41).iter().map(|q| q.pid).collect();
        // Desktop's helpers (21) and its MCP server (22) are not under a CLI session; the shell
        // running this pass (40) is my ancestor.
        assert_eq!(got, vec![11, 12]);
    }

    #[test]
    fn plan_lowers_normal_only_and_puts_back_only_what_it_set() {
        let mut a = p(11, 10, "node", "");
        let mut b = p(12, 10, "esbuild", "");
        b.normal = false;
        a.rss = 300 * MIB;
        let t = vec![&a, &b];
        let c = Cfg::default();
        let calm = plan(&t, Mode::Calm, Some(40), c, &[(99, 5)], 0, 10_000);
        assert_eq!(calm.lower, vec![11]);
        assert!(calm.eco_on.is_empty() && calm.trim.is_empty());
        assert_eq!(calm.eco_off, vec![(99, 5)]);
        let hot = plan(&t, Mode::Hot, Some(85), c, &[], 0, 10_000);
        assert_eq!(hot.eco_on, vec![11, 12]);
        assert_eq!(hot.trim, vec![11]);
        // Trim at most once per TRIM_EVERY_S.
        assert!(plan(&t, Mode::Hot, Some(85), c, &[], 10_000 - 60, 10_000).trim.is_empty());
        // On battery with RAM fine: Efficiency mode, no trim.
        let bat = plan(&t, Mode::Battery, Some(30), c, &[], 0, 10_000);
        assert_eq!((bat.eco_on.len(), bat.trim.len()), (2, 0));
    }

    #[test]
    fn service_files_run_eco_low_and_hidden() {
        let u = systemd_unit("/home/a/.local/bin/8sync");
        assert!(u.contains("ExecStart=\"/home/a/.local/bin/8sync\" ccc eco run") && u.contains("Nice=15") && u.contains("CPUQuota=5%"));
        let ps = ps_register(r"C:\Users\O'Neil\AppData\Local\Programs\8sync\8sync.exe");
        assert!(ps.contains(r#"-Argument '--headless "C:\Users\O''Neil\AppData\Local\Programs\8sync\8sync.exe" ccc eco run'"#), "{ps}");
        for need in ["-AllowStartIfOnBatteries", "-DontStopIfGoingOnBatteries", "-ExecutionTimeLimit ([TimeSpan]::Zero)", "-AtLogOn", r"-TaskPath '\8sync\'", "Start-ScheduledTask"] {
            assert!(ps.contains(need), "{need} missing: {ps}");
        }
    }

    #[test]
    fn snapshot_text_reads_every_part() {
        let v = json!({
            "ram": { "totalMb": 32768, "usedMb": 16384, "pct": 50 },
            "cpu": { "pct": 23, "cores": 16, "watts": 31.5 },
            "gpus": [{ "name": "RTX 4070", "util": 12, "memUsedMb": 1024, "memTotalMb": 12288, "temp": 45, "watts": 18.0 }],
            "gpuWatts": 18.0,
            "battery": null,
            "procs": { "claude": { "n": 3, "mb": 1434 }, "node": { "n": 12, "mb": 2150 } },
            "eco": { "mode": "calm", "ramPct": 80, "cpuPct": 75, "installed": false, "last": null },
        });
        let t = snapshot_text(&v);
        assert!(t.contains("RAM 16.0/32.0 GB (50%)"), "{t}");
        assert!(t.contains("CPU 23% (16 luồng)"));
        assert!(t.contains("GPU RTX 4070: 12% · VRAM 1.0/12.0 GB · 45°C · 18 W"));
        assert!(t.contains("Điện: CPU 32 W · GPU 18 W · không có pin"));
        assert!(t.contains("Claude Code: 3 tiến trình, 1.4 GB"));
        assert!(t.contains("Eco: bình thường"));
    }

    #[test]
    fn reap_takes_only_orphaned_helpers_old_enough() {
        let now = 100 + 3600;
        let pyright = r#""node" "C:\nodejs\node_modules\pyright\langserver.index.js" "--stdio""#;
        let sh = |pid, ppid, cmd: &str| Proc { shell: true, ..p(pid, ppid, "cmd", cmd) };
        let at = |q: Proc, started: u64| Proc { started, ..q };
        let procs = vec![
            p(1, 0, "explorer", ""),
            p(10, 1, "claude", r"C:\Users\a\.local\bin\claude.exe"),
            sh(11, 10, "cmd /c pyright-langserver.cmd --stdio"),
            p(12, 11, "node", pyright), // its claude lives: kept
            sh(21, 999, "cmd /c pyright-langserver.cmd --stdio"),
            p(22, 21, "node", pyright), // its claude is gone: killed, child with it
            p(23, 22, "node", "node worker.js"),
            p(30, 999, "msedge", "msedge.exe --remote-debugging-port=9222 --user-data-dir=x"),
            p(31, 999, "node", r"node C:\x\okx-click-trader\bot\main.ts"),
            p(32, 31, "node", "node okx-trade-mcp/dist/index.js --modules market"),
            p(33, 999, "python", r"python C:\ComfyUI\main.py --listen"),
            p(34, 999, "node", "node node_modules/vite/bin/vite.js dev"),
            p(35, 999, "node", r"node C:\hq-ui\server.js"),
            p(36, 35, "node", "node tsserver.js"), // under HQ: kept
            p(40, 999, "node", "node @trailhq/trail-code/dist/cli.js _trail-index"),
            at(p(41, 999, "node", "node @trailhq/trail-code/dist/cli.js _trail-embed"), now - 300), // trail < 10 min
            at(p(42, 999, "node", "node bash-language-server/out/cli.js start"), now - 60), // < 2 min
            at(p(50, 10, "node", "node typescript-language-server --stdio"), 50), // parent pid recycled by claude
            at(p(60, 1, "svc", ""), 0),
            p(61, 60, "node", "node tsserver.js"), // parent of unknown start: kept
            p(70, 999, "headroom", "headroom.exe mcp serve"),
            p(71, 70, "python", "python headroom.exe mcp serve"), // goes with its shim
            p(80, 999, "conhost", "conhost.exe --headless 8sync.exe ccc eco run"),
            p(81, 80, "node", "node bash-language-server start"), // under a scheduled task: kept
        ];
        let got: Vec<(u32, Vec<u32>)> = orphans(&procs, now, 0).into_iter().map(|o| (o.pid, o.tree)).collect();
        assert_eq!(got, vec![(22, vec![22, 23]), (40, vec![40]), (50, vec![50]), (70, vec![70, 71])]);
        assert_eq!(orphans(&procs, now, 0)[0].kind, "language server");
        // Never me or my ancestors (`8sync ccc eco reap` run from such a tree).
        assert!(orphans(&procs, now, 23).iter().all(|o| o.pid != 22));
    }

    #[test]
    fn reap_is_capped_per_pass() {
        let procs: Vec<Proc> = (0..25).map(|i| p(100 + i, 999, "node", "node tsserver.js")).collect();
        assert_eq!(orphans(&procs, 10_000, 0).len(), REAP_MAX);
        let rows = reap_orphan_helpers(Path::new("/nonexistent"), &procs, 10_000, true);
        assert_eq!(rows.len(), REAP_MAX);
        assert!(rows.iter().all(|r| r["killed"] == false), "dry run kills nothing");
        let mut last = json!({ "targets": 1, "lowered": 0, "ecoOn": 0, "ecoOff": 0, "trimmed": 0, "trimmedMb": 0 });
        assert!(snapshot_text(&json!({ "eco": { "last": last.clone() } })).contains("dọn helper mồ côi 0"), "older state file");
        last["reaped"] = json!(3);
        let t = snapshot_text(&json!({ "eco": { "last": last } }));
        assert!(t.contains("dọn helper mồ côi 3"), "{t}");
    }

    const STORE: &str = r"C:\Program Files\WindowsApps\Claude_1.0.734.0_x64__pzs8sxrjxfjjc\app\claude.exe";

    /// Claude Desktop (Store) with an 11 GB renderer, Edge, Orca, a renderer without its main
    /// process, the Claude Code CLI and 8sync run from inside Claude Desktop.
    fn desktop_procs() -> Vec<Proc> {
        let mb = |q: Proc, mb: u64| Proc { rss: mb * MIB, ..q };
        let edge = r#""C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe""#;
        let orca = r"C:\Users\a\AppData\Local\Programs\orca\Orca.exe";
        vec![
            p(1, 0, "explorer", ""),
            p(46360, 1, "claude", &format!("\"{STORE}\"")),
            mb(p(46364, 46360, "claude", &format!("\"{STORE}\" --type=renderer --user-data-dir=x --app-path=y")), 11_366),
            p(46365, 46360, "claude", &format!("\"{STORE}\" --type=gpu-process")),
            mb(p(46366, 46360, "claude", &format!("{} --type=renderer", STORE.to_lowercase())), 1_024),
            mb(p(46367, 46360, "claude", &format!("\"{STORE}\" --type=renderer")), 4_095), // under the threshold
            p(500, 1, "msedge", &format!("{edge} --profile-directory=Default")),
            mb(p(501, 500, "msedge", &format!("{edge} --type=renderer --extension-process")), 5_000),
            p(600, 1, "orca", orca),
            mb(p(601, 600, "orca", &format!("{orca} --type=renderer")), 6_000),
            mb(p(701, 1, "claude", &format!("\"{STORE}\" --type=renderer")), 4_096), // its main process is gone
            p(900, 1, "claude", r"C:\Users\a\.local\bin\claude.exe"),
            p(999, 46360, "8sync", "8sync ccc eco restart 46360"),
        ]
    }

    #[test]
    fn heavy_renderers_name_the_app_root_and_whether_it_may_restart() {
        let procs = desktop_procs();
        let heavy = heavy_renderers(&procs);
        let got: Vec<(u32, u32, &str, u64, bool)> = heavy.iter().map(|h| (h.pid, h.root, h.app.as_str(), h.mb, h.restartable)).collect();
        assert_eq!(
            got,
            vec![(46364, 46360, "Claude Desktop", 11_366, true), (601, 600, "Orca", 6_000, false), (501, 500, "Microsoft Edge", 5_000, false), (701, 701, "Claude Desktop", 4_096, false)]
        );
        let v = heavy_json(&heavy_renderers(&procs));
        assert_eq!(v[0], json!({ "pid": 46364, "rootPid": 46360, "app": "Claude Desktop", "image": "claude", "mb": 11_366, "restartable": true, "cdp": null }));
        let t = snapshot_text(&json!({ "heavy": v }));
        assert!(t.contains("Renderer nặng: Claude Desktop 11.1 GB (pid 46364) — có thể khởi động lại (`8sync eco restart 46360`)"), "{t}");
        assert!(t.contains("Renderer nặng: Microsoft Edge 4.9 GB (pid 501) — đóng bớt tab/cửa sổ"), "{t}");
        // A renderer is never a session, and eco never targets Claude Desktop.
        assert!(targets(&procs, 0).is_empty());
    }

    /// An agent's Edge (`--remote-debugging-port`) is told apart from the owner's; an Electron app
    /// with the same flag is not a browser eco may touch.
    #[test]
    fn heavy_agent_browser_carries_its_cdp_port() {
        let edge = r#""C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe""#;
        let mb = |q: Proc, mb: u64| Proc { rss: mb * MIB, ..q };
        let procs = vec![
            p(1, 0, "explorer", ""),
            p(800, 1, "msedge", &format!("{edge} --user-data-dir=d --remote-debugging-port=9309")),
            mb(p(801, 800, "msedge", &format!("{edge} --type=renderer --user-data-dir=\"d\" --remote-debugging-port=9309 --lang=en-US")), 4_200),
            p(46360, 1, "claude", &format!("\"{STORE}\"")),
            mb(p(46364, 46360, "claude", &format!("\"{STORE}\" --type=renderer --remote-debugging-port=9222")), 5_000),
        ];
        let h = heavy_renderers(&procs);
        assert_eq!(h.iter().map(|h| (h.pid, h.cdp)).collect::<Vec<_>>(), vec![(46364, None), (801, Some(9309))]);
        assert_eq!(cdp_port("x --remote-debugging-port=0"), None);
        let t = snapshot_text(&json!({ "heavy": heavy_json(&h) }));
        assert!(t.contains("Microsoft Edge 4.1 GB (pid 801) — trình duyệt agent (CDP :9309): eco tự đóng tab New tab"), "{t}");
    }

    /// Only New tab pages close; a real page stays; the last pages being New tabs opens a blank
    /// one first; an id that is not a plain token is never put in a URL path.
    #[test]
    fn new_tab_plan_closes_only_new_tabs_and_keeps_a_window() {
        let list = json!([
            { "type": "page", "id": "A1", "url": "edge://newtab/" },
            { "type": "page", "id": "B2", "url": "https://github.com/8-Sync-Dev" },
            { "type": "other", "id": "C3", "url": "edge://newtab/" },
            { "type": "service_worker", "id": "D4", "url": "https://ntp.msn.com/edge/ntp/service-worker.js" },
            { "type": "page", "id": "../x", "url": "chrome://newtab/" },
        ]);
        assert_eq!(new_tab_plan(&list), (vec!["A1".to_string()], false));
        let only = json!([{ "type": "page", "id": "A1", "url": "https://ntp.msn.com/edge/ntp?x=1" }, { "type": "page", "id": "E5", "url": "chrome://new-tab-page/" }]);
        assert_eq!(new_tab_plan(&only), (vec!["A1".to_string(), "E5".to_string()], true));
        assert_eq!(new_tab_plan(&json!([{ "type": "page", "id": "B2", "url": "about:blank" }])), (vec![], false));
    }

    #[test]
    fn restart_takes_only_a_restartable_root_and_only_its_exe() {
        let procs = desktop_procs();
        let t = restart_target(&procs, 46360, 4242).unwrap();
        assert_eq!((t.app.as_str(), t.exe.as_str(), t.root), ("Claude Desktop", STORE, 46360));
        // Same exe path in any case (Windows), never the CLI's claude.exe nor 8sync.
        assert_eq!(t.pids, vec![46360, 46364, 46365, 46366, 46367, 701]);
        assert_eq!(t.mb, 50 * 2 + 11_366 + 1_024 + 4_095 + 4_096);
        let no = |root: u32, me: u32| restart_target(&procs, root, me).unwrap_err();
        assert!(no(500, 4242).contains("Microsoft Edge") && no(500, 4242).contains("đóng bớt"), "browsers are reported only");
        assert!(no(600, 4242).contains("Orca"));
        assert!(no(46364, 4242).contains("không phải tiến trình chính"), "a renderer pid is not the root");
        assert!(no(701, 4242).contains("không được khởi động lại"), "no main process: nothing to reopen");
        assert!(no(4242, 4242).contains("không phải"));
        assert!(no(46360, 999).contains("bên trong Claude Desktop"), "8sync run from inside the app would close itself");
        // The renderer shrank under the threshold meanwhile: refused (recomputed now).
        let calm: Vec<Proc> = procs.iter().map(|q| if q.pid == 46364 { Proc { rss: MIB, ..q.clone() } } else { q.clone() }).collect();
        assert!(restart_target(&calm, 46360, 4242).is_err());
    }

    #[test]
    fn exe_of_reads_quoted_unquoted_and_bundle_paths() {
        assert_eq!(exe_of(r#""C:\a b\x.exe" --flag"#), r"C:\a b\x.exe");
        assert_eq!(exe_of(r"C:\a b\Orca.EXE --type=renderer"), r"C:\a b\Orca.EXE");
        assert_eq!(exe_of("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer"), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
        assert_eq!(exe_of("/usr/lib/slack/slack --enable-crashpad"), "/usr/lib/slack/slack");
        assert_eq!(exe_of(""), "");
        assert_eq!(app_bundle("/Applications/Claude.app/Contents/MacOS/Claude"), Some("/Applications/Claude.app"));
        assert_eq!(app_bundle("/usr/bin/slack"), None);
    }

    #[test]
    fn restart_scripts_close_by_exe_path_only_and_reopen_through_explorer() {
        let exe = r"C:\Program Files\WindowsApps\O'Neil_1.0_x64__abc\app\claude.exe";
        let c = ps_close(exe);
        assert!(c.contains(r"$exe = 'C:\Program Files\WindowsApps\O''Neil_1.0_x64__abc\app\claude.exe'"), "{c}");
        for need in ["$_.Path -eq $exe", "CloseMainWindow()", "-lt 20", "app | Stop-Process -Force"] {
            assert!(c.contains(need), "{need} missing: {c}");
        }
        assert!(!c.contains("-Name") && !c.contains("taskkill") && !c.contains("ProcessName"), "never by name: {c}");
        let r = ps_relaunch(exe);
        for need in [r"-match '\\WindowsApps\\([^\\]+)\\'", "Get-AppxPackageManifest", r"'shell:AppsFolder\' + $pkg.PackageFamilyName + '!' + $id", r#"Start-Process explorer.exe -ArgumentList ('"' + $exe + '"')"#] {
            assert!(r.contains(need), "{need} missing: {r}");
        }
    }

    #[test]
    fn curly_quotes_in_an_exe_path_cannot_end_the_powershell_string() {
        let exe = "C:\\x\u{2019}; Remove-Item C:\\ -Recurse; \u{2018}\\a.exe";
        let c = ps_close(exe);
        assert!(c.contains("$exe = 'C:\\x\u{2019}\u{2019}; Remove-Item C:\\ -Recurse; \u{2018}\u{2018}\\a.exe'"), "{c}");
    }
}
