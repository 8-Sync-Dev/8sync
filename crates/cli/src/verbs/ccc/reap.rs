//! Leftover dev/preview servers of a project. Rooms start `npx vite preview --port 41xx` for a UAT
//! screenshot and kill only the `npx` wrapper; on Windows the `node …/vite.js` child lives on.
//! Seen live 2026-10-20: 73 of them (6 GB) plus 10 tsserver of long-closed worktrees (5.6 GB) on
//! the 3d-game team. `auto revive` (HQ, every 2 min) patrols each project once per [`EVERY_S`],
//! sooner (every [`PRESSURE_EVERY_S`], servers from [`PRESSURE_SERVER_AGE_S`] old) while RAM is at
//! [`PRESSURE_PCT`] or more ("RAM ăn cao quá", owner 2026-10-20).

use std::path::Path;

use serde_json::{json, Value};

use super::idle;
use super::team::Row;
use crate::verbs::hq_core::sampler::{Sample, Sampler};

/// A project is patrolled at most this often.
const EVERY_S: u64 = 600;
/// A dev/preview server younger than this may still be in use.
const SERVER_AGE_S: u64 = 30 * 60;
/// A language server of a worktree that still exists goes only after this long.
const TS_AGE_S: u64 = 6 * 3600;
/// RAM in use (%) from which a project is swept right away …
const PRESSURE_PCT: u32 = 85;
/// … at most this often …
const PRESSURE_EVERY_S: u64 = 120;
/// … taking dev/preview servers from this age.
const PRESSURE_SERVER_AGE_S: u64 = 10 * 60;

/// A process as the OS lists it (every image: a parent must be seen to tell an orphan).
#[derive(Debug, Clone, PartialEq, Default)]
pub(super) struct Proc {
    pub pid: u32,
    pub ppid: u32,
    /// Start time (unix seconds), 0 when the OS did not say.
    pub started: u64,
    /// Resident memory (bytes), 0 when unknown.
    pub rss: u64,
    /// The image is node: nothing else is ever picked or killed here (`auto close` takes more; the
    /// resource guard, [`super::pressure`], also takes headless browsers and orphaned MCP servers).
    pub node: bool,
    /// The image is a shell (bash, sh, zsh, cmd, pwsh…): what a room's background tool call leaves.
    pub shell: bool,
    /// Image name, lower case, without `.exe` (`node`, `omp`, `python3`, `msedge`).
    pub image: String,
    /// Command line; empty when the OS did not give it.
    pub cmd: String,
    /// Image file name, lowercased (`node.exe`, `chrome.exe`, `node`); empty when unknown.
    pub name: String,
    /// CPU time used so far (100 ns units), 0 when unknown.
    pub cpu: u64,
    /// Runs at normal (or above-normal) priority: the resource guard lowers a room's
    /// ([`super::pressure`]). False when unknown.
    pub normal: bool,
    /// Already at idle priority (Windows base priority 4, unix nice 19): the guard's breach
    /// measure for a room's build/test processes. False when unknown.
    pub idle: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Sweep {
    /// The regular pass, once per [`EVERY_S`].
    Patrol,
    /// RAM at [`PRESSURE_PCT`] or more.
    Pressure,
}

impl Sweep {
    fn server_age(self) -> u64 {
        match self {
            Sweep::Patrol => SERVER_AGE_S,
            Sweep::Pressure => PRESSURE_SERVER_AGE_S,
        }
    }
}

/// RAM in use (%) of a sample's `(total, used)` MiB.
pub(super) fn ram_pct(mem: Option<(u64, u64)>) -> Option<u32> {
    mem.filter(|(t, _)| *t > 0).map(|(t, u)| (u.min(t) * 100 / t) as u32)
}

/// Whether `root` (`key` in the stamps) is swept now: under pressure once per
/// [`PRESSURE_EVERY_S`] (the patrol stamp ignored), else once per [`EVERY_S`].
fn due(stamps: &Value, key: &str, now: u64, ram: Option<u32>) -> Option<Sweep> {
    let since = |k: &str| stamps[k].as_u64().map_or(u64::MAX, |at| now.saturating_sub(at));
    if ram.is_some_and(|r| r >= PRESSURE_PCT) && since(&format!("{key}|pressure")) >= PRESSURE_EVERY_S {
        Some(Sweep::Pressure)
    } else if since(key) >= EVERY_S {
        Some(Sweep::Patrol)
    } else {
        None
    }
}

/// `RAM 88% · CPU 40% · GPU 35% (6120/16303 MB)`; parts the OS did not give are left out.
pub(super) fn machine_line(s: &Sample) -> String {
    let mut parts = Vec::new();
    if let Some(r) = ram_pct(s.mem) {
        parts.push(format!("RAM {r}%"));
    }
    if let Some(c) = s.cpu_pct {
        parts.push(format!("CPU {c}%"));
    }
    for g in s.gpus.iter().flatten() {
        parts.push(format!("GPU {}% ({}/{} MB)", g.util, g.mem_used, g.mem_total));
    }
    parts.join(" · ")
}

/// RAM in use (%) once `freed` bytes went back.
fn pct_after(mem: (u64, u64), freed: u64) -> Option<u32> {
    let (t, u) = mem;
    ram_pct(Some((t, u.saturating_sub(freed / (1024 * 1024)))))
}

/// One process listing per revive pass, taken on first use and shared by the reaper and the
/// resource guard ([`super::pressure`]); what one of them killed is left out for the other.
pub(super) struct Listing {
    now: u64,
    procs: std::cell::OnceCell<(Vec<Proc>, Stamp)>,
    killed: std::cell::RefCell<Vec<u32>>,
}

/// When a listing was taken (unix ms, read right after it) and the machine's CPU times then
/// ([`super::pressure::system_times`]): per-process CPU deltas between two listings are divided
/// by the time between them, not by the gap between the passes that asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Stamp {
    pub ms: u64,
    pub sys: Option<(u64, u64)>,
}

impl Stamp {
    pub(super) fn now() -> Stamp {
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        Stamp { ms, sys: super::pressure::system_times() }
    }
}

impl Listing {
    pub(super) fn new(now: u64) -> Listing {
        Listing { now, procs: std::cell::OnceCell::new(), killed: std::cell::RefCell::new(Vec::new()) }
    }

    fn get(&self) -> &(Vec<Proc>, Stamp) {
        self.procs.get_or_init(|| {
            let p = list(self.now);
            (p, Stamp::now())
        })
    }

    /// The processes, minus the ones killed through [`Listing::killed`].
    pub(super) fn procs(&self) -> Vec<Proc> {
        let k = self.killed.borrow();
        self.get().0.iter().filter(|p| !k.contains(&p.pid)).cloned().collect()
    }

    /// When the listing was taken ([`Stamp`]); takes it if not yet.
    pub(super) fn stamp(&self) -> Stamp {
        self.get().1
    }

    pub(super) fn killed(&self, pids: &[u32]) {
        self.killed.borrow_mut().extend_from_slice(pids);
    }
}

/// `auto revive`'s pass for `root`: a machine row, then one row per leftover server killed
/// ([`pick`], with its node children: [`tree`]); under RAM pressure also a summary row. Nothing
/// while auto does not run for `root` (the owner's machine without a team is never swept) or when
/// the sweep is not [`due`].
pub(super) fn tick(home: &Path, root: &Path, now: u64, listing: &Listing) -> Vec<Row> {
    if !super::auto::running(home) || !super::auto::in_scope(home, Some(&root.to_string_lossy())) {
        return Vec::new();
    }
    let sample = Sampler::new().map(|s| s.get(std::time::Duration::ZERO));
    let ram = sample.as_ref().and_then(|s| ram_pct(s.mem));
    let file = idle::state_dir(home).join("reap.json");
    let mut stamps = idle::read_json(&file).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let key = root.to_string_lossy().into_owned();
    let Some(sweep) = due(&stamps, &key, now, ram) else { return Vec::new() };
    stamps[&key] = json!(now);
    if sweep == Sweep::Pressure {
        stamps[format!("{key}|pressure")] = json!(now);
    }
    idle::write_json(&file, &stamps);
    let row = |role: String, state: String| Row { name: "máy".into(), role, model: String::new(), state, short: String::new() };
    let mut rows = Vec::new();
    if let Some(line) = sample.as_ref().map(machine_line).filter(|l| !l.is_empty()) {
        rows.push(row("trạng thái".into(), line));
    }
    let procs = listing.procs();
    let mut freed = (0, 0u64);
    for pid in pick(&procs, root, now, sweep.server_age(), std::process::id(), &|p| p.exists()) {
        let Some(p) = procs.iter().find(|p| p.pid == pid) else { continue };
        let pids = tree(&procs, pid);
        let rss = procs.iter().filter(|q| pids.contains(&q.pid)).map(|q| q.rss).sum();
        let what = describe(&Proc { rss, ..p.clone() }, now);
        // The server itself is first in the tree: its kill is the one that counts.
        let ok = kill(&pids).first().copied().unwrap_or(false);
        if ok {
            listing.killed(&pids);
            freed = (freed.0 + 1, freed.1 + rss);
        }
        let state = if ok { format!("dọn server cũ: {what}") } else { format!("không dọn được server cũ: {what}") };
        rows.push(row(format!("pid {pid}"), state));
    }
    if let (Sweep::Pressure, Some(r), Some(mem)) = (sweep, ram, sample.and_then(|s| s.mem)) {
        let after = pct_after(mem, freed.1).unwrap_or(r);
        rows.push(row("RAM".into(), format!("RAM {r}%: dọn {} server cũ, còn {after}%", freed.0)));
    }
    rows
}

/// Which of `procs` to kill for `root` at `now`: a DETACHED node process — walking up through node
/// and shell parents ends at one whose parent is gone (or names a pid reused by a later process).
/// 3d-game 2026-10-20: 37 room servers each sat under `cmd < npx < bash < bash` whose top bash had
/// lost its parent (the room's turn ended); the owner's `npm run dev` ends at a live terminal,
/// editor or agent (any other image) and stays — and whose command line names `root`
/// (case-insensitive for a Windows path, `\` = `/`) and that is
/// - a dev/preview server ([`kind`]: `vite` but never `vitest`, `next dev|start`, `webpack serve`,
///   `http-server`, `serve -s`, `live-server`) in a room worktree `<root>/.claude/worktrees/<dir>`,
///   at least `server_age` old ([`SERVER_AGE_S`],
///   [`PRESSURE_SERVER_AGE_S`] under RAM pressure), or
/// - `tsserver` / `typescript-language-server` of `<root>/.claude/worktrees/<dir>` where `<dir>` is
///   gone (`exists` false) or that is at least [`TS_AGE_S`] old.
///
/// Never `me` or its ancestors (HQ runs `auto revive`), never HQ's own app (`hq-ui`, `hq-channel`),
/// never a process with no start time.
pub(super) fn pick(procs: &[Proc], root: &Path, now: u64, server_age: u64, me: u32, exists: &dyn Fn(&Path) -> bool) -> Vec<u32> {
    let fold = windows_path(&root.to_string_lossy());
    let Some(rootn) = root_key(root) else { return Vec::new() };
    let keep = lineage(procs, me);
    let detached = |p: &Proc| detached(procs, p, &|q| q.node || q.shell);
    let mut out = Vec::new();
    for p in procs {
        if !p.node || keep.contains(&p.pid) || p.started == 0 || !detached(p) {
            continue;
        }
        let c = norm(&p.cmd, fold);
        if is_hq(&c) || !names(&c, &rootn) {
            continue;
        }
        let age = now.saturating_sub(p.started);
        // A room's server runs in its card worktree; one in the repo itself may be the owner's own
        // window (`start cmd /k npm run dev` from a launcher that exited) or a service (pm2,
        // systemd: ppid 1) and is never taken.
        let stale = if kind(&p.cmd).is_some() {
            age >= server_age && worktree(&c, &rootn).is_some()
        } else if c.contains("tsserver") || c.contains("typescript-language-server") {
            worktree(&c, &rootn).is_some_and(|dir| age >= TS_AGE_S || !exists(&root.join(".claude").join("worktrees").join(dir)))
        } else {
            false
        };
        if stale {
            out.push(p.pid);
        }
    }
    // A server under another picked one (next dev's worker) goes with that one's tree kill.
    let trees: Vec<Vec<u32>> = out.iter().map(|&pid| tree(procs, pid)).collect();
    out.iter().copied().filter(|pid| !trees.iter().any(|t| t[0] != *pid && t.contains(pid))).collect()
}

/// [`norm_root`] of `root`; None for an empty root.
pub(super) fn root_key(root: &Path) -> Option<String> {
    Some(norm_root(&root.to_string_lossy())).filter(|r| !r.is_empty())
}

/// Walking up from `p` through parents that `through` accepts ends at one whose parent is gone (or
/// names a pid reused by a later process). A parent of unknown start time (0) counts as a live
/// host: kept rather than guessed. pid 1 is unix init adopting an orphan.
pub(super) fn detached(procs: &[Proc], p: &Proc, through: &dyn Fn(&Proc) -> bool) -> bool {
    let mut cur = p;
    for _ in 0..32 {
        match procs.iter().find(|q| cur.ppid > 1 && q.pid == cur.ppid && q.started <= cur.started) {
            None => return true,
            Some(q) if q.started != 0 && through(q) => cur = q,
            Some(_) => return false,
        }
    }
    false
}

/// `pid` then its node descendants: a child counts only when it started no earlier than its
/// parent (a `ParentProcessId` naming a recycled pid is never followed); a non-node child is walked
/// through but never returned, so nothing but node is ever killed.
fn tree(procs: &[Proc], pid: u32) -> Vec<u32> {
    tree_of(procs, pid, &|q| q.node)
}

/// `pid` then every descendant `keep` accepts (others are walked through, never returned), with the
/// start-time rule of [`descendants`].
pub(super) fn tree_of(procs: &[Proc], pid: u32, keep: &dyn Fn(&Proc) -> bool) -> Vec<u32> {
    descendants(procs, pid, &|_| false).into_iter().filter(|p| *p == pid || procs.iter().any(|q| q.pid == *p && keep(q))).collect()
}

/// `pid` then every descendant of any image, parents before children; a child counts only when it
/// started no earlier than its parent (a recycled pid is never followed). A child `skip` holds is
/// neither returned nor walked into.
pub(super) fn descendants(procs: &[Proc], pid: u32, skip: &dyn Fn(&Proc) -> bool) -> Vec<u32> {
    let mut walk = vec![pid];
    let mut i = 0;
    while let Some(&cur) = walk.get(i) {
        i += 1;
        let Some(parent) = procs.iter().find(|p| p.pid == cur) else { continue };
        for c in procs {
            if c.ppid == cur && c.started != 0 && c.started >= parent.started && !walk.contains(&c.pid) && !skip(c) {
                walk.push(c.pid);
            }
        }
    }
    walk
}

/// `me` and its ancestors: never killed (HQ runs `auto revive` and `auto close`; an agent may run
/// `auto close` from a session of the project).
pub(super) fn lineage(procs: &[Proc], me: u32) -> Vec<u32> {
    let mut keep = vec![me];
    let mut cur = me;
    while let Some(p) = procs.iter().find(|p| p.pid == cur && p.ppid != 0 && !keep.contains(&p.ppid)) {
        keep.push(p.ppid);
        cur = p.ppid;
    }
    keep
}

/// HQ's own app: never killed.
pub(super) fn is_hq(cmd_norm: &str) -> bool {
    cmd_norm.contains("hq-ui") || cmd_norm.contains("hq-channel")
}

/// `C:\…` / `c:/…`: matched case-insensitively.
pub(super) fn windows_path(s: &str) -> bool {
    let b = s.trim_start_matches(r"\\?\").as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

/// `\` = `/`; a Windows path also in lower case.
pub(super) fn norm(s: &str, fold: bool) -> String {
    let s = s.replace('\\', "/");
    if fold {
        s.to_lowercase()
    } else {
        s
    }
}

/// `root` as [`names`] looks for it in a normalized command line: no `\\?\`, no trailing `/`.
pub(super) fn norm_root(root: &str) -> String {
    let n = norm(root, windows_path(root));
    n.strip_prefix("//?/").unwrap_or(&n).trim_end_matches('/').to_string()
}

/// `c` names `root` as a whole path (not `<root>-2`, not `/x<root>`).
pub(super) fn names(c: &str, root: &str) -> bool {
    c.match_indices(root).any(|(i, _)| {
        let before = c[..i].chars().next_back();
        let after = c[i + root.len()..].chars().next();
        matches!(before, None | Some('"' | '\'' | ' ' | '=' | '\t')) && matches!(after, None | Some('/' | '"' | '\'' | ' ' | '\t'))
    })
}

/// `<dir>` of the first `<root>/.claude/worktrees/<dir>` in `c` (as `c` spells it).
pub(super) fn worktree<'a>(c: &'a str, root: &str) -> Option<&'a str> {
    let marker = format!("{root}/.claude/worktrees/");
    let i = c.find(&marker)? + marker.len();
    let dir = c[i..].split(['/', '"', '\'', ' ', '\t']).next()?;
    (!dir.is_empty()).then_some(dir)
}

/// The dev/preview server `cmd` runs (`vite preview`, `next dev`, …), None for anything else.
pub(super) fn kind(cmd: &str) -> Option<String> {
    let c = cmd.to_lowercase().replace('\\', "/");
    if c.contains("vitest") {
        return None;
    }
    let toks: Vec<&str> = c.split_whitespace().map(|t| t.trim_matches(['"', '\''])).collect();
    let stem = |t: &str| {
        let b = t.rsplit('/').next().unwrap_or(t);
        [".js", ".mjs", ".cjs", ".cmd", ".exe"].iter().find_map(|x| b.strip_suffix(x)).unwrap_or(b).to_string()
    };
    for (i, t) in toks.iter().enumerate() {
        let s = stem(t);
        let next = toks.get(i + 1).copied().unwrap_or("");
        let rest = &toks[i + 1..];
        match s.as_str() {
            "vite" if next == "build" => return None,
            "vite" if matches!(next, "preview" | "dev" | "serve") => return Some(format!("vite {next}")),
            "vite" => return Some("vite".into()),
            "next" if matches!(next, "dev" | "start") => return Some(format!("next {next}")),
            "http-server" => return Some("http-server".into()),
            "live-server" => return Some("live-server".into()),
            _ => {}
        }
        if t.contains("webpack") && rest.contains(&"serve") {
            return Some("webpack serve".into());
        }
        if (s == "serve" || t.contains("/serve/build/")) && rest.contains(&"-s") {
            return Some("serve -s".into());
        }
    }
    None
}

/// `--port 4197` / `--port=4197` / `-p 4197`.
pub(super) fn port(cmd: &str) -> Option<&str> {
    let toks: Vec<&str> = cmd.split_whitespace().map(|t| t.trim_matches(['"', '\''])).collect();
    toks.iter().enumerate().find_map(|(i, t)| {
        let v = t.strip_prefix("--port=").or_else(|| matches!(*t, "--port" | "-p").then(|| toks.get(i + 1).copied()).flatten())?;
        v.chars().all(|c| c.is_ascii_digit()).then_some(v)
    })
}

/// `vite preview :4197 (2h 10m, 120 MB)`.
fn describe(p: &Proc, now: u64) -> String {
    let what = kind(&p.cmd).unwrap_or_else(|| if p.cmd.contains("typescript-language-server") { "typescript-language-server".into() } else { "tsserver".into() });
    let port = port(&p.cmd).map(|x| format!(" :{x}")).unwrap_or_default();
    let m = now.saturating_sub(p.started) / 60;
    let age = if m >= 60 { format!("{}h {}m", m / 60, m % 60) } else { format!("{m}m") };
    let mem = if p.rss > 0 { format!(", {} MB", p.rss / (1024 * 1024)) } else { String::new() };
    format!("{what}{port} ({age}{mem})")
}

/// Kills each pid alone (`taskkill /F` without `/T`, which would follow stale parent links);
/// `true` where the kill went through. Never by image name.
pub(super) fn kill(pids: &[u32]) -> Vec<bool> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        pids.iter()
            .map(|pid| {
                std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/F"])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                    .status()
                    .is_ok_and(|s| s.success())
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        let sig = |s: &str, pid: u32| {
            std::process::Command::new("kill")
                .args([s, &pid.to_string()])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|x| x.success())
        };
        let sent: Vec<bool> = pids.iter().map(|&p| sig("-TERM", p)).collect();
        if sent.iter().any(|&s| s) {
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
        pids.iter().zip(sent).map(|(&p, ok)| ok && (!sig("-0", p) || sig("-KILL", p))).collect()
    }
}

/// Every process on this machine with its command line (empty when the OS listing fails).
pub(super) fn list(now: u64) -> Vec<Proc> {
    #[cfg(windows)]
    {
        let _ = now;
        // Native first (owner 2026-10-22: "fix tận gốc … ram, cpu"): every guard tick of every
        // project ran `Get-CimInstance Win32_Process` with command lines, and WmiPrvSE grew to
        // 12.7 GB RAM / 22% CPU on the owner's PC. ToolHelp + per-process queries answer in
        // milliseconds and never touch WMI. WMI stays only as the fallback when that comes back empty.
        let native = win_procs::list();
        if !native.is_empty() {
            return native;
        }
        use std::os::windows::process::CommandExt;
        // UTF-8 out: in the OEM code page a room's command line (its Vietnamese goal prompt) came
        // out with `→` as a raw 0x1A, and the whole listing failed to parse (seen live 2026-10-21).
        let ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine,Priority,@{n='Cpu';e={[uint64]$_.KernelModeTime+[uint64]$_.UserModeTime}},@{n='Started';e={if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeSeconds()}else{0}}} | ConvertTo-Json -Compress";
        let mut c = std::process::Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", ps])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        crate::verbs::hq_core::agents::run_bounded(c, std::time::Duration::from_secs(15))
            .map(|o| parse_windows(&String::from_utf8_lossy(&o)))
            .unwrap_or_default()
    }
    #[cfg(target_os = "linux")]
    {
        let _ = now;
        list_linux()
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = std::process::Command::new("ps");
        c.args(["-axo", "pid=,ppid=,etime=,rss=,command="])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        crate::verbs::hq_core::agents::run_bounded(c, std::time::Duration::from_secs(15))
            .map(|o| parse_ps(&String::from_utf8_lossy(&o), now))
            .unwrap_or_default()
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = now;
        Vec::new()
    }
}

/// Every process through the Win32 API, no WMI: a ToolHelp snapshot (pid, parent, image, base
/// priority), then per process with `PROCESS_QUERY_LIMITED_INFORMATION`: times (start, CPU), working
/// set and the command line (`NtQueryInformationProcess` class 60, Windows 8.1+). A process this
/// user may not open keeps its snapshot fields, the rest 0 / empty, as WMI gave for it.
#[cfg(windows)]
mod win_procs {
    use super::{image_of, is_shell, Proc};
    use std::ffi::c_void;

    type Handle = *mut c_void;
    const INVALID: Handle = -1isize as Handle;
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_COMMAND_LINE_INFORMATION: i32 = 60;
    const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC000_0004_u32 as i32;
    /// FILETIME of 1970-01-01 (100 ns since 1601).
    const UNIX_EPOCH_FT: u64 = 116_444_736_000_000_000;

    #[repr(C)]
    struct ProcessEntry {
        size: u32,
        usage: u32,
        pid: u32,
        heap: usize,
        module: u32,
        threads: u32,
        ppid: u32,
        pri_base: i32,
        flags: u32,
        exe: [u16; 260],
    }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct MemCounters {
        cb: u32,
        page_faults: u32,
        peak_ws: usize,
        ws: usize,
        quota_peak_paged: usize,
        quota_paged: usize,
        quota_peak_nonpaged: usize,
        quota_nonpaged: usize,
        pagefile: usize,
        peak_pagefile: usize,
    }
    #[repr(C)]
    struct UnicodeString {
        len: u16,
        max: u16,
        buf: *const u16,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snap: Handle, entry: *mut ProcessEntry) -> i32;
        fn Process32NextW(snap: Handle, entry: *mut ProcessEntry) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn GetProcessTimes(h: Handle, create: *mut FileTime, exit: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
        fn K32GetProcessMemoryInfo(h: Handle, counters: *mut MemCounters, cb: u32) -> i32;
        fn CloseHandle(h: Handle) -> i32;
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(h: Handle, class: i32, info: *mut c_void, len: u32, ret: *mut u32) -> i32;
    }

    fn ft(t: FileTime) -> u64 {
        (u64::from(t.high) << 32) | u64::from(t.low)
    }

    /// The command line of an open process handle; empty when the OS refuses.
    fn command_line(h: Handle) -> String {
        // u64 words keep the UNICODE_STRING header aligned at the start of the buffer.
        let mut words: Vec<u64> = vec![0; 1024];
        for _ in 0..2 {
            let bytes = (words.len() * 8) as u32;
            let mut need = 0u32;
            // SAFETY: `words` is a writable buffer of `bytes` bytes owned by us; `need` is a valid out pointer.
            let st = unsafe { NtQueryInformationProcess(h, PROCESS_COMMAND_LINE_INFORMATION, words.as_mut_ptr().cast(), bytes, &mut need) };
            if st == STATUS_INFO_LENGTH_MISMATCH && need > bytes && need < 1 << 22 {
                words = vec![0; (need as usize).div_ceil(8)];
                continue;
            }
            if st < 0 {
                return String::new();
            }
            // SAFETY: on success the buffer starts with a UNICODE_STRING whose `buf` points into the
            // same buffer, `len` bytes long; both checked against the buffer bounds below.
            let us = unsafe { &*(words.as_ptr().cast::<UnicodeString>()) };
            let base = words.as_ptr() as usize;
            let end = base + words.len() * 8;
            let start = us.buf as usize;
            let n = usize::from(us.len) / 2;
            if us.buf.is_null() || start < base || start + n * 2 > end {
                return String::new();
            }
            // SAFETY: bounds checked just above; u16 reads inside our own buffer.
            let s = unsafe { std::slice::from_raw_parts(us.buf, n) };
            return String::from_utf16_lossy(s);
        }
        String::new()
    }

    pub(super) fn list() -> Vec<Proc> {
        // SAFETY: plain snapshot call; the handle is closed below.
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap == INVALID || snap.is_null() {
            return Vec::new();
        }
        let mut out = Vec::new();
        // SAFETY: zeroed POD struct with its size set, as the API requires.
        let mut e: ProcessEntry = unsafe { std::mem::zeroed() };
        e.size = std::mem::size_of::<ProcessEntry>() as u32;
        // SAFETY: valid snapshot handle and entry pointer.
        let mut ok = unsafe { Process32FirstW(snap, &mut e) } != 0;
        while ok {
            let len = e.exe.iter().position(|&c| c == 0).unwrap_or(e.exe.len());
            let name = String::from_utf16_lossy(&e.exe[..len]);
            let (mut started, mut cpu, mut rss, mut cmd) = (0u64, 0u64, 0u64, String::new());
            // SAFETY: OpenProcess with limited query rights; a null handle means no access and is skipped.
            let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, e.pid) };
            if !h.is_null() {
                let (mut c, mut x, mut k, mut u) = (FileTime::default(), FileTime::default(), FileTime::default(), FileTime::default());
                // SAFETY: valid handle and four out pointers to our locals.
                if unsafe { GetProcessTimes(h, &mut c, &mut x, &mut k, &mut u) } != 0 {
                    started = ft(c).saturating_sub(UNIX_EPOCH_FT) / 10_000_000;
                    cpu = ft(k) + ft(u);
                }
                let mut m = MemCounters { cb: std::mem::size_of::<MemCounters>() as u32, ..Default::default() };
                // SAFETY: valid handle, counters struct with its size set.
                if unsafe { K32GetProcessMemoryInfo(h, &mut m, m.cb) } != 0 {
                    rss = m.ws as u64;
                }
                cmd = command_line(h);
                // SAFETY: closing the handle we opened.
                unsafe { CloseHandle(h) };
            }
            out.push(Proc {
                pid: e.pid,
                ppid: e.ppid,
                started,
                rss,
                node: name.eq_ignore_ascii_case("node.exe"),
                shell: is_shell(&name),
                image: image_of(&name),
                cmd,
                name: name.to_ascii_lowercase(),
                cpu,
                // Base priority, as WMI's `Priority`: 8 normal, 10 above normal, 4 idle.
                normal: (8..=10).contains(&e.pri_base),
                idle: e.pri_base == 4,
            });
            // SAFETY: same snapshot and entry.
            ok = unsafe { Process32NextW(snap, &mut e) } != 0;
        }
        // SAFETY: closing the snapshot we created.
        unsafe { CloseHandle(snap) };
        out
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn lists_this_process_with_its_command_line_and_parent_without_wmi() {
            let me = std::process::id();
            let all = super::list();
            assert!(all.len() > 10, "a Windows machine runs more than 10 processes");
            let p = all.iter().find(|p| p.pid == me).expect("this test process is listed");
            assert!(p.ppid != 0);
            assert!(p.started > 1_600_000_000, "start time in unix seconds");
            assert!(p.rss > 0);
            assert!(p.cmd.to_lowercase().contains(&p.image), "command line names the image: {} / {}", p.cmd, p.image);
        }
    }
}

/// `ConvertTo-Json` of the `Win32_Process` rows: an array, or one object for a single process. A raw
/// control character (never valid JSON, inside a string or out) reads as a space.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn parse_windows(s: &str) -> Vec<Proc> {
    let clean: String = s.trim().chars().map(|c| if c.is_control() && !matches!(c, '\t' | '\n' | '\r') { ' ' } else { c }).collect();
    let v: Value = serde_json::from_str(&clean).unwrap_or(Value::Null);
    let rows = match v {
        Value::Array(a) => a,
        o @ Value::Object(_) => vec![o],
        _ => Vec::new(),
    };
    rows.iter()
        .filter_map(|r| {
            let name = r["Name"].as_str().unwrap_or_default();
            Some(Proc {
                pid: u32::try_from(r["ProcessId"].as_u64()?).ok()?,
                ppid: r["ParentProcessId"].as_u64().and_then(|x| u32::try_from(x).ok()).unwrap_or(0),
                started: r["Started"].as_u64().unwrap_or(0),
                rss: r["WorkingSetSize"].as_u64().unwrap_or(0),
                node: name.eq_ignore_ascii_case("node.exe"),
                shell: is_shell(name),
                image: image_of(name),
                cmd: r["CommandLine"].as_str().unwrap_or_default().to_string(),
                name: name.to_ascii_lowercase(),
                cpu: r["Cpu"].as_u64().unwrap_or(0),
                // Base priority: 8 normal, 10 above normal (6 below normal, 4 idle, 13 high, 24 realtime).
                normal: matches!(r["Priority"].as_u64(), Some(8..=10)),
                idle: r["Priority"].as_u64() == Some(4),
            })
        })
        .collect()
}

/// `bash.exe`, `/bin/zsh`, `-bash` (login shell): an image a tool call runs its command through.
fn is_shell(arg0: &str) -> bool {
    matches!(image_of(arg0).as_str(), "bash" | "sh" | "zsh" | "dash" | "fish" | "cmd" | "pwsh" | "powershell")
}

/// `C:\…\Node.EXE`, `/usr/bin/python3`, `-zsh` → `node`, `python3`, `zsh`.
fn image_of(arg0: &str) -> String {
    let base = arg0.rsplit(['/', '\\']).next().unwrap_or(arg0).trim_start_matches('-').to_ascii_lowercase();
    base.strip_suffix(".exe").unwrap_or(&base).to_string()
}

/// `ps -axo pid=,ppid=,etime=,rss=,command=` (macOS: `etime` is `[[dd-]hh:]mm:ss`, `rss` KB).
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn parse_ps(s: &str, now: u64) -> Vec<Proc> {
    s.lines()
        .filter_map(|l| {
            let mut f = l.split_whitespace();
            let pid = f.next()?.parse().ok()?;
            let ppid = f.next()?.parse().ok()?;
            let etime = f.next()?;
            let rss: u64 = f.next()?.parse().ok()?;
            let cmd = f.collect::<Vec<_>>().join(" ");
            let arg0 = cmd.split_whitespace().next().unwrap_or_default();
            let base = arg0.rsplit('/').next().unwrap_or(arg0).to_ascii_lowercase();
            let node = base.starts_with("node");
            let (days, hms) = etime.split_once('-').map_or((0, etime), |(d, r)| (d.parse().unwrap_or(0), r));
            let secs = hms.split(':').try_fold(0u64, |acc, x| x.parse::<u64>().ok().map(|n| acc * 60 + n))?;
            let (shell, image) = (is_shell(arg0), image_of(arg0));
            Some(Proc { pid, ppid, started: now.saturating_sub(days * 86_400 + secs), rss: rss * 1024, node, shell, image, cmd, name: base, cpu: 0, normal: false, idle: false })
        })
        .collect()
}

/// `/proc/<pid>/{cmdline,stat,statm}`; start = boot time + field 22 (USER_HZ 100).
#[cfg(target_os = "linux")]
fn list_linux() -> Vec<Proc> {
    let Some(btime) = std::fs::read_to_string("/proc/stat")
        .ok()
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("btime ").and_then(|x| x.trim().parse::<u64>().ok())))
    else {
        return Vec::new();
    };
    let Ok(dir) = std::fs::read_dir("/proc") else { return Vec::new() };
    dir.flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_str()?.parse().ok()?;
            let raw = std::fs::read(e.path().join("cmdline")).ok()?;
            let argv: Vec<String> = raw.split(|b| *b == 0).filter(|a| !a.is_empty()).map(|a| String::from_utf8_lossy(a).into_owned()).collect();
            let base = argv.first().and_then(|a| a.rsplit('/').next()).unwrap_or_default().to_ascii_lowercase();
            let node = base.starts_with("node");
            let stat = std::fs::read_to_string(e.path().join("stat")).ok()?;
            let f: Vec<&str> = stat.rsplit_once(')')?.1.split_whitespace().collect();
            let ppid = f.get(1)?.parse().ok()?;
            let ticks: u64 = f.get(19)?.parse().ok()?;
            // utime + stime, clock ticks (USER_HZ 100) → 100 ns units.
            let cpu = f.get(11).and_then(|u| u.parse::<u64>().ok()).unwrap_or(0) + f.get(12).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            let rss = std::fs::read_to_string(e.path().join("statm"))
                .ok()
                .and_then(|s| s.split_whitespace().nth(1).and_then(|x| x.parse::<u64>().ok()))
                .map_or(0, |pages| pages * 4096);
            let shell = argv.first().is_some_and(|a| is_shell(a));
            let image = argv.first().map(|a| image_of(a)).unwrap_or_default();
            // field 19: nice; 0 or less runs at normal priority or above, 19 is idle.
            let nice = f.get(16).and_then(|n| n.parse::<i64>().ok());
            let (normal, idle) = (nice.is_some_and(|n| n <= 0), nice == Some(19));
            Some(Proc { pid, ppid, started: btime + ticks / 100, rss, node, shell, image, cmd: argv.join(" "), name: base, cpu: cpu * 100_000, normal, idle })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const NOW: u64 = 1_000_000;

    fn p(pid: u32, ppid: u32, age_min: u64, cmd: &str) -> Proc {
        Proc { pid, ppid, started: NOW - age_min * 60, rss: 120 * 1024 * 1024, node: true, shell: false, image: "node".into(), cmd: cmd.into(), name: "node.exe".into(), cpu: 0, normal: true, idle: false }
    }

    /// A process of another image (shell, terminal, claude.exe).
    fn other(pid: u32, ppid: u32, age_min: u64) -> Proc {
        Proc { node: false, image: "other".into(), cmd: String::new(), name: "claude.exe".into(), ..p(pid, ppid, age_min, "") }
    }

    fn all_exist(_: &Path) -> bool {
        true
    }

    #[test]
    fn windows_picks_only_old_servers_of_this_project() {
        let root = PathBuf::from(r"C:\Users\Projects\startup\8sync-startup\game\3d-game");
        let procs = vec![
            // HQ: runs `auto revive` (me = 2), its own next start in hq-ui.
            p(1, 0, 900, r#""C:\Program Files\nodejs\node.exe" C:\Users\Admin\AppData\Local\8sync\hq-ui\server.js"#),
            p(3, 0, 900, r#"node C:\users\projects\startup\8sync-startup\game\3d-game\node_modules\next\dist\bin\next start"#),
            // old detached vite preview in the repo itself (the owner's launcher window): kept.
            p(10, 0, 130, r#""C:\Program Files\nodejs\node.exe" "c:/users/projects/startup/8sync-startup/game/3D-GAME/node_modules/vite/bin/vite.js" preview --port 4197 --strictPort"#),
            // old vite in a card worktree: picked.
            p(11, 0, 45, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-46\node_modules\vite\bin\vite.js preview --port 4120"#),
            // young vite in a worktree, path cased and slashed differently: kept (taken under pressure).
            p(12, 0, 10, r#""C:\Program Files\nodejs\node.exe" "c:/users/projects/startup/8sync-startup/game/3D-GAME/.claude/worktrees/card-47/node_modules/vite/bin/vite.js" preview --port 4121"#),
            // vitest worker: kept.
            p(13, 0, 300, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\node_modules\vitest\dist\workers\forks.js"#),
            // old vite of another project (and a sibling sharing the prefix): kept.
            p(14, 0, 300, r#"node C:\Users\Projects\startup\8sync-startup\game\other\node_modules\vite\bin\vite.js preview"#),
            p(15, 0, 300, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game-2\node_modules\vite\bin\vite.js"#),
            // tsserver of a deleted worktree: picked; of a live young worktree: kept; of the root: kept.
            p(16, 0, 60, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-12\node_modules\typescript\lib\tsserver.js --useNodeIpc"#),
            p(17, 0, 60, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-50\node_modules\typescript\lib\tsserver.js"#),
            p(18, 0, 900, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\node_modules\typescript\lib\tsserver.js"#),
            // tsserver of a live worktree older than 6 h: picked.
            p(19, 0, 400, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-50\node_modules\.bin\typescript-language-server --stdio"#),
            // a node script in the root that is no server: kept.
            p(20, 0, 900, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\scripts\watch-assets.js"#),
            // no start time: kept.
            Proc { started: 0, rss: 0, ..p(21, 0, 0, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\node_modules\vite\bin\vite.js"#) },
        ];
        let me_tree = vec![Proc { started: NOW, rss: 0, ..p(2, 3, 0, "") }];
        let procs: Vec<Proc> = procs.into_iter().chain(me_tree).collect();
        let exists = |d: &Path| !d.to_string_lossy().contains("card-12");
        assert_eq!(pick(&procs, &root, NOW, SERVER_AGE_S, 2, &exists), vec![11, 16, 19]);
        // Under RAM pressure the 10-min-old worktree vite goes too; nothing else changes.
        assert_eq!(pick(&procs, &root, NOW, PRESSURE_SERVER_AGE_S, 2, &exists), vec![11, 12, 16, 19]);
        assert_eq!(describe(&procs[2], NOW), "vite preview :4197 (2h 10m, 120 MB)");
    }

    #[test]
    fn unix_paths_are_case_sensitive_and_a_child_goes_with_its_server() {
        let root = PathBuf::from("/home/dev/game");
        let procs = vec![
            p(30, 1, 200, "node /home/dev/game/.claude/worktrees/c1/node_modules/.bin/next dev -p 3000"),
            p(31, 30, 200, "node /home/dev/game/.claude/worktrees/c1/node_modules/next/dist/server/lib/start-server.js /home/dev/game/.claude/worktrees/c1/node_modules/vite/bin/vite.js"),
            p(32, 1, 200, "node /home/dev/Game/node_modules/vite/bin/vite.js"),
            p(33, 1, 200, "node /home/dev/game/.claude/worktrees/c1/node_modules/http-server/bin/http-server dist -p 8080"),
            p(34, 1, 200, "node /home/dev/game/.claude/worktrees/c1/node_modules/serve/build/main.js -s dist"),
            p(35, 1, 200, "node /home/dev/game/.claude/worktrees/c1/node_modules/webpack-cli/bin/cli.js serve --port=9000"),
            p(36, 1, 200, "node /home/dev/game/.claude/worktrees/c1/node_modules/vite/bin/vite.js build --watch"),
            p(37, 1, 200, "node /home/dev/game/.claude/worktrees/c1/node_modules/live-server/live-server.js"),
        ];
        // 31 is under a live 30: never picked itself, killed in 30's tree.
        assert_eq!(pick(&procs, &root, NOW, SERVER_AGE_S, 99, &all_exist), vec![30, 33, 34, 35, 37]);
        assert_eq!(tree(&procs, 30), vec![30, 31]);
        assert_eq!(describe(&procs[0], NOW), "next dev :3000 (3h 20m, 120 MB)");
        assert_eq!(describe(&procs[5], NOW).split(' ').take(3).collect::<Vec<_>>(), ["webpack", "serve", ":9000"]);
    }

    #[test]
    fn parses_the_os_listings() {
        let one = r#"{"ProcessId":7,"ParentProcessId":1,"Name":"node.exe","WorkingSetSize":2048,"CommandLine":"node a.js","Cpu":5000,"Started":123}"#;
        assert_eq!(parse_windows(one), vec![Proc { pid: 7, ppid: 1, started: 123, rss: 2048, node: true, shell: false, image: "node".into(), cmd: "node a.js".into(), name: "node.exe".into(), cpu: 5000, normal: false, idle: false }]);
        assert!(parse_windows(&one.replace("\"Started\"", "\"Priority\":4,\"Started\""))[0].idle);
        assert!(parse_windows(&one.replace("\"Started\"", "\"Priority\":8,\"Started\""))[0].normal);
        let many = r#"[{"ProcessId":7,"ParentProcessId":1,"Name":"cmd.exe","WorkingSetSize":1,"CommandLine":null,"Started":3},{"ProcessId":8,"ParentProcessId":7,"Name":"NODE.EXE","WorkingSetSize":1,"CommandLine":"node b","Started":5},{"ProcessId":9,"ParentProcessId":1,"Name":"omp.exe","CommandLine":"omp --session-dir x","Started":6},{"ParentProcessId":7}]"#;
        let got = parse_windows(many);
        assert_eq!(
            got.iter().map(|p| (p.pid, p.node, p.shell, p.image.as_str(), p.cmd.as_str(), p.name.as_str())).collect::<Vec<_>>(),
            vec![(7, false, true, "cmd", "", "cmd.exe"), (8, true, false, "node", "node b", "node.exe"), (9, false, false, "omp", "omp --session-dir x", "omp.exe")]
        );
        assert!(parse_windows("").is_empty());
        let sub = "[{\"ProcessId\":9,\"ParentProcessId\":1,\"Name\":\"claude.exe\",\"CommandLine\":\"claude /goal a \u{1a} b\",\"Started\":5}]";
        assert_eq!(parse_windows(sub)[0].cmd, "claude /goal a   b", "an OEM-mangled char does not sink the whole listing");
        let ps = "  41     1 1-02:03:04  2048 /usr/local/bin/node /x/vite.js preview\n  42 1 05:06 10 /bin/zsh -l\n 43 1 07 1 node y.js\n";
        let got = parse_ps(ps, NOW);
        assert_eq!(got.len(), 3);
        assert_eq!(got[0], Proc { pid: 41, ppid: 1, started: NOW - (86_400 + 2 * 3600 + 3 * 60 + 4), rss: 2048 * 1024, node: true, shell: false, image: "node".into(), cmd: "/usr/local/bin/node /x/vite.js preview".into(), name: "node".into(), cpu: 0, normal: false, idle: false });
        assert_eq!((got[1].node, got[1].shell, got[1].image.as_str(), got[1].cmd.as_str(), got[1].name.as_str(), got[1].started), (false, true, "zsh", "/bin/zsh -l", "zsh", NOW - 306));
        assert_eq!(got[2].started, NOW - 7);
    }

    #[test]
    fn only_orphans_go_and_their_tree_never_follows_recycled_links() {
        let root = PathBuf::from(r"C:\w\game");
        let vite = r"node C:\w\game\.claude\worktrees\card-3\node_modules\vite\bin\vite.js preview --port 4200";
        let procs = vec![
            // The owner's `npm run dev` under a live terminal: kept.
            other(50, 0, 300),
            p(51, 50, 200, vite),
            // Parent pid now names a process started after the server (pid reused): orphan, picked.
            other(53, 0, 10),
            p(52, 53, 200, vite),
            // Parent gone: orphan, picked.
            p(60, 4242, 200, vite),
            // A non-node image whose line mentions the root: never picked.
            Proc { cmd: vite.into(), ..other(61, 0, 200) },
            // 52's real children: a node worker (killed), esbuild.exe (walked, never killed) and its
            // node child (killed).
            p(56, 52, 199, "node worker.js"),
            other(55, 52, 199),
            p(59, 55, 198, "node inner.js"),
            // A room's claude.exe older than 52 that names it as parent (stale link): not followed,
            // nor is its node child.
            other(57, 52, 500),
            p(58, 57, 400, "node mcp.js"),
        ];
        assert_eq!(pick(&procs, &root, NOW, SERVER_AGE_S, 1, &all_exist), vec![52, 60]);
        assert_eq!(tree(&procs, 52), vec![52, 56, 59]);
        assert_eq!(tree(&procs, 60), vec![60]);
    }

    #[test]
    fn a_server_left_by_a_finished_tool_call_goes_one_under_a_live_host_stays() {
        let root = PathBuf::from(r"C:\w\game");
        let vite = r"node C:\w\game\.claude\worktrees\card-9\node_modules\vite\bin\vite.js preview --port 4300";
        let sh = |pid, ppid, age| Proc { shell: true, ..other(pid, ppid, age) };
        let procs = vec![
            // A room's background call: vite < cmd < npx (node) < bash < bash, the top bash's parent gone.
            sh(70, 4343, 100),
            sh(71, 70, 100),
            p(72, 71, 100, "node npx-cli.js vite preview"),
            sh(73, 72, 100),
            p(74, 73, 100, vite),
            // The same chain under a live non-shell host (a terminal, an editor, claude.exe): kept.
            other(80, 0, 900),
            sh(81, 80, 100),
            p(82, 81, 100, "node npx-cli.js vite preview"),
            sh(83, 82, 100),
            p(84, 83, 100, vite),
            // A shell parent of unknown start time is not walked through: kept.
            Proc { started: 0, ..sh(90, 4343, 100) },
            p(91, 90, 100, vite),
        ];
        assert_eq!(pick(&procs, &root, NOW, SERVER_AGE_S, 1, &all_exist), vec![74]);
        assert!(is_shell(r"C:\Program Files\Git\usr\bin\bash.exe") && is_shell("-zsh") && is_shell("CMD.EXE") && !is_shell("claude.exe") && !is_shell("node"));
    }

    #[test]
    fn nothing_while_auto_does_not_run_for_the_project() {
        let home = std::env::temp_dir().join(format!("reap-off-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let listing = Listing::new(NOW);
        assert!(tick(&home, Path::new(r"C:\w\game"), NOW, &listing).is_empty());
        assert!(listing.procs.get().is_none(), "nothing listed when nothing is due");
        assert!(!idle::state_dir(&home).join("reap.json").exists(), "no sweep, no stamp");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn sweeps_every_ten_minutes_and_every_two_under_ram_pressure() {
        let k = "C:/p";
        let none = json!({});
        assert_eq!(due(&none, k, NOW, None), Some(Sweep::Patrol));
        assert_eq!(due(&none, k, NOW, Some(90)), Some(Sweep::Pressure));
        let patrolled = json!({ k: NOW - 60 });
        assert_eq!(due(&patrolled, k, NOW, Some(84)), None);
        assert_eq!(due(&patrolled, k, NOW, Some(85)), Some(Sweep::Pressure), "pressure ignores the 10-min stamp");
        let pressed = json!({ k: NOW - 60, "C:/p|pressure": NOW - 60 });
        assert_eq!(due(&pressed, k, NOW, Some(95)), None, "at most once per 2 min");
        let pressed = json!({ k: NOW - 130, "C:/p|pressure": NOW - 130 });
        assert_eq!(due(&pressed, k, NOW, Some(95)), Some(Sweep::Pressure));
        assert_eq!(due(&pressed, k, NOW, Some(50)), None);
        assert_eq!(due(&json!({ k: NOW - 600 }), k, NOW, Some(50)), Some(Sweep::Patrol));
        assert_eq!(due(&json!({ "C:/other": NOW }), k, NOW, None), Some(Sweep::Patrol), "stamps are per project");
        assert_eq!((Sweep::Patrol.server_age(), Sweep::Pressure.server_age()), (1800, 600));
    }

    #[test]
    fn machine_numbers() {
        assert_eq!(ram_pct(Some((65_536, 57_672))), Some(88));
        assert_eq!(ram_pct(Some((0, 0))), None);
        assert_eq!(ram_pct(None), None);
        assert_eq!(pct_after((65_536, 57_672), 6 * 1024 * 1024 * 1024), Some(78));
        let gpu = crate::verbs::hq_core::sampler::Gpu { name: "RTX".into(), util: 35, mem_used: 6120, mem_total: 16303, temp: None, watts: None };
        let s = Sample { mem: Some((65_536, 57_672)), cpu_pct: Some(40), gpus: Some(vec![gpu]), ..Sample::default() };
        assert_eq!(machine_line(&s), "RAM 88% · CPU 40% · GPU 35% (6120/16303 MB)");
        assert_eq!(machine_line(&Sample { cpu_pct: Some(3), ..Sample::default() }), "CPU 3%");
    }
}
