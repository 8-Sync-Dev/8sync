//! Resource guard of `auto revive`. 3d-game, night of 2026-10-20: a 13-room boost team drove the
//! machine to 100% RAM and 100% CPU. A room held 2–2.5 GB: claude.exe 0.3–1 GB, the
//! `typescript-lsp` plugin's tsserver per worktree 0.6–1 GB, serena MCP ~150 MB, dev servers
//! ~100 MB each, headless chrome; Defender burned CPU scanning 13 worktrees' node_modules. Owner
//! (2026-10-21): "ccc auto phải có chế độ tự động clean dọn khi đạt ngưỡng 60% để kill và bắn cho
//! agent nào đó dọn gấp và sẽ khởi động lại team tối ưu ram, cpu, gpu".
//! Same day, CPU: `auto up` started every room's codebase-memory indexer and tsserver at once and
//! Defender scanned every write in the worktrees ("check cpu bị cao lắm phải auto dừng chặn clean
//! up ngay khi bị cao tải và auto run lại tối ưu hóa cpu, ram nhất").
//!
//! A pass ([`tick`]) runs in every revive tick (HQ, every 2 min; at most once per [`TICK_S`]) and,
//! within seconds of a breach, from `8sync ccc auto guard now` (HQ's 5 s sampler fires it; at most
//! once per [`NOW_GAP_S`]), while auto runs for the project and the guard is on (threshold
//! [`DEFAULT_PCT`]%, `8sync ccc auto guard <pct>|off`). Levels go by how long a breach has held
//! ([`Breach`], [`level`]), not by tick counts:
//! - always: every process of a room's tree still at normal priority goes to below normal
//!   ([`lower`]): builds, servers and indexers yield to the owner's own apps.
//! - L1 — at once on RAM or CPU ≥ threshold, or VRAM ≥ [`VRAM_HOT`]%: the rooms' build/test
//!   processes drop to idle priority first ([`to_idle`]), then what rooms left behind goes
//!   ([`l1_pick`], PID trees, never by image name; stale `<room>-scratch` entries: [`stale_scratch`])
//!   and each room holding ≥ 1 GB outside its own claude.exe hears what it holds ([`attribute`], one
//!   message per 15 min). A row names the top CPU users ([`cpu_top`]).
//! - L2 — RAM ≥ threshold + 15, or over the threshold for [`L2_RAM_S`]: restart up to [`RESTARTS`]
//!   idle heavy rooms (same conversation) lean ([`lean`]): LSP plugins and indexing MCP servers off.
//!   A room is restarted once per high-RAM spell; `revive` re-checks it right before the stop.
//! - L3 — CPU ≥ [`CPU_MAX`]% for [`L3_CPU_S`], or RAM ≥ threshold + 15 for [`L3_RAM_S`]: pause the
//!   rooms that do not fit ([`keep_count`], [`DROP_ORDER`]); their cards go back to the lane. They
//!   come back one per pass once one more room has fit under the threshold ([`room_fits`]) for
//!   [`CALM_S`]. Turning the guard off brings them all back.
//! - CPU cap — every pass, and right after `auto up`/`revive` open rooms ([`cap_now`]): the Claude
//!   Code daemon and every room's tree run on [`cap_mask`] (the highest-numbered N logical CPUs, N
//!   = cap% of the machine, default [`DEFAULT_CAP`]%); halved while CPU ≥ the threshold until it
//!   is back [`CAP_CALM`] points under ([`cap_tight`]). Owner 2026-10-21: "never cpu go to 60%".
//!   Affinity, not a job-object rate cap: node puts its children in its own job (measured 55% with a
//!   10% hard cap), while an affinity mask is inherited (16 burners on 8 CPUs: +32% not +50%).
//!
//! Native: a process listing, priority changes, kills, `claude stop`, inbox messages. No tokens.
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::reap::{self, Proc};
use super::team::{Claude, Row};
use super::{auto, idle, room, target};

/// The owner's RAM number (2026-10-21).
pub(super) const DEFAULT_PCT: u32 = 60;
/// The CPU threshold apart from RAM (owner 2026-10-21: "never cpu go to 60%"; the owner's own
/// RAM baseline is 50–61%, so one number for both kept the guard busy on load the rooms did not
/// cause), `auto guard cpu <30..95>`.
pub(super) const DEFAULT_CPU: u32 = 55;
/// Rooms' share of the machine's logical CPUs (37% = 12 of 32), `auto guard cap <n>|off`.
pub(super) const DEFAULT_CAP: u32 = 37;
/// Caps `auto guard cap` takes.
pub(super) const CAP_RANGE: std::ops::RangeInclusive<u32> = 10..=90;
/// A tightened cap ([`cap_tight`]) lets go once CPU is this many points under the threshold.
const CAP_CALM: u32 = 10;
/// Thresholds `auto guard` takes.
pub(super) const PCT_RANGE: std::ops::RangeInclusive<u32> = 30..=95;
/// One guard pass per project at most this often from `auto revive` (HQ ticks every 120 s)…
pub(super) const TICK_S: u64 = 100;
/// …and from `auto guard now` (HQ fires it within seconds of a breach, at most every 20 s).
pub(super) const NOW_GAP_S: u64 = 15;
/// A CPU reading over a window older than this says nothing about now (HQ closed, auto paused).
const STALE_S: u64 = 400;
/// Two passes at most this far apart see one unbroken breach.
const CONTINUOUS_S: u64 = 150;
/// CPU (% of the machine) from which, held [`L3_CPU_S`], L3 pauses rooms.
const CPU_MAX: u32 = 90;
const L3_CPU_S: u64 = 45;
/// RAM ≥ threshold + 15 held this long → L3; RAM over the threshold held [`L2_RAM_S`] → L2.
const L3_RAM_S: u64 = 60;
const L2_RAM_S: u64 = 30;
const VRAM_HOT: u32 = 90;
/// Leftover servers and watch runners from this age go at L1 (the reaper waits 30 min).
const LEFT_AGE_S: u64 = 300;
/// Room scratch entries (`.claude/worktrees/<room>-scratch/*`) untouched this long go at L1.
const SCRATCH_AGE_S: u64 = 3600;
/// `%TEMP%\qa-card-*` / `qa-fetch*` is measured at most this often, for at most 2 s.
const TEMP_QA_EVERY_S: u64 = 1800;
/// A room holding this much outside its claude.exe is told what it holds.
const HELD: u64 = 1 << 30;
/// A room tree (claude.exe included) this big is a restart candidate at L2.
const HEAVY: u64 = 3 << 29;
const WARN_EVERY_S: u64 = 900;
const RESTARTS: usize = 2;
/// A room restarted lean is not restarted again before this, whatever the spell.
const RESTART_AGAIN_S: u64 = 1800;
/// Entries walked at most to date a scratch entry ([`newest_mtime`]).
const SCRATCH_WALK: usize = 20_000;
/// RAM and CPU (% of the machine) a paused room must leave free under the threshold to come back.
const RESUME_MARGIN: u64 = 5;
/// Room-owned MCP servers and headless browsers remembered (pid, start) for L1.
const OWNED_KEEP: usize = 300;
const CALM_S: u64 = 600;
/// MsMpEng CPU share (whole machine, %) from which the Defender hint row shows, at most hourly
/// (measured 2026-10-21 with 6 rooms starting: 4.2%, the top process of the machine).
const DEFENDER_PCT: u32 = 3;
const DEFENDER_EVERY_S: u64 = 3600;
const ACTIONS_KEEP: usize = 10;
/// Rooms L3 pauses first. Never lead, dev, qa or the sweep ([`kept`]); a room not listed goes after these.
pub(super) const DROP_ORDER: [&str; 12] = ["review2", "dev6", "dev5", "qa2", "ba", "dev4", "dev3", "review", "dev2", "ui", "rd", "arch"];
const CORE: [&str; 3] = ["lead", "dev", "qa"];

/// Rooms L3 never pauses: the core rooms, and the sweep ([`room::SWEEP`]) that cleans the machine
/// while it is overloaded (it starts lean, [`lean`], and idles in `auto wait --mail`).
fn kept(name: &str) -> bool {
    CORE.contains(&name) || room::is_sweep(name)
}
const MIB: u64 = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Level {
    Calm,
    Clean,
    Restart,
    Shrink,
}

impl Level {
    fn n(self) -> u64 {
        self as u64
    }

    fn of(n: u64) -> Level {
        match n {
            1 => Level::Clean,
            2 => Level::Restart,
            3 => Level::Shrink,
            _ => Level::Calm,
        }
    }

    fn label(n: u64) -> &'static str {
        match n {
            1 => "dọn mạnh",
            2 => "khởi động lại phòng nặng gọn nhẹ",
            3 => "tạm dừng bớt phòng",
            _ => "bình thường",
        }
    }
}

/// The guard's two thresholds (%): RAM (`auto guard <pct>`) drives L1/L2/L3 on RAM, CPU (`auto
/// guard cpu <pct>`) drives L1, the tightened cap, idle builds and L3 on CPU. A RAM breach never
/// tightens the cap; a CPU breach never restarts rooms lean (L2 is RAM only).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Limits {
    pub ram: u32,
    pub cpu: u32,
}

/// Since when (unix s) each breach has held without a break: RAM ≥ threshold, RAM ≥ threshold +
/// 15, CPU ≥ threshold, CPU ≥ [`CPU_MAX`]. Kept in the guard state so back-to-back passes
/// (`auto guard now` from HQ every ~20 s, `auto revive` every 2 min) escalate on time held.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Breach {
    pub ram: Option<u64>,
    pub ram_hi: Option<u64>,
    pub cpu: Option<u64>,
    pub cpu_max: Option<u64>,
}

impl Breach {
    fn of(st: &Value) -> Breach {
        let b = &st["breach"];
        Breach { ram: b["ram"].as_u64(), ram_hi: b["ram_hi"].as_u64(), cpu: b["cpu"].as_u64(), cpu_max: b["cpu_max"].as_u64() }
    }

    fn json(&self) -> Value {
        json!({ "ram": self.ram, "ram_hi": self.ram_hi, "cpu": self.cpu, "cpu_max": self.cpu_max })
    }

    /// This pass's runs: a run still breached goes on when the last pass was at most
    /// [`CONTINUOUS_S`] ago (`gap`), else it starts now; one not breached ends.
    fn next(self, ram: u32, cpu: Option<u32>, t: Limits, gap: Option<u64>, now: u64) -> Breach {
        let on = gap.is_some_and(|g| g <= CONTINUOUS_S);
        let run = |was: Option<u64>, hot: bool| hot.then(|| if on { was.unwrap_or(now) } else { now });
        Breach {
            ram: run(self.ram, ram >= t.ram),
            ram_hi: run(self.ram_hi, ram >= t.ram + 15),
            cpu: run(self.cpu, cpu.is_some_and(|c| c >= t.cpu)),
            cpu_max: run(self.cpu_max, cpu.is_some_and(|c| c >= CPU_MAX)),
        }
    }

    /// L3 on CPU: at [`CPU_MAX`] for [`L3_CPU_S`].
    fn cpu_shrink(&self, now: u64) -> bool {
        self.cpu_max.is_some_and(|s| now.saturating_sub(s) >= L3_CPU_S)
    }
}

/// This pass's level, at once on a breach (owner 2026-10-21: "bị cao là auto xử lý liền luôn"):
/// L1 RAM ≥ the RAM threshold, CPU ≥ the CPU threshold, or VRAM ≥ [`VRAM_HOT`]%; L2 RAM ≥ RAM
/// threshold + 15, or over it for [`L2_RAM_S`] (L1 did not bring it down); L3 CPU ≥ [`CPU_MAX`]%
/// for [`L3_CPU_S`] or RAM ≥ RAM threshold + 15 for [`L3_RAM_S`].
pub(super) fn level(ram: u32, vram: Option<u32>, cpu: Option<u32>, t: Limits, b: &Breach, now: u64) -> Level {
    let held = |since: Option<u64>, s: u64| since.is_some_and(|t| now.saturating_sub(t) >= s);
    if b.cpu_shrink(now) || held(b.ram_hi, L3_RAM_S) {
        Level::Shrink
    } else if ram >= t.ram + 15 || held(b.ram, L2_RAM_S) {
        Level::Restart
    } else if ram >= t.ram || cpu.is_some_and(|c| c >= t.cpu) || vram.is_some_and(|v| v >= VRAM_HOT) {
        Level::Clean
    } else {
        Level::Calm
    }
}

// ── CPU over a tick ─────────────────────────────────────────────────────────────────────────

/// What the next tick compares with: `{pid: [start, cpu]}` of every process that used CPU (pid 0,
/// Windows' System Idle Process, carries the machine's idle time).
fn cpu_snapshot(procs: &[Proc]) -> Value {
    Value::Object(procs.iter().filter(|p| p.cpu > 0).map(|p| (p.pid.to_string(), json!([p.started, p.cpu]))).collect())
}

/// CPU time (100 ns) each process used since `prev` ([`cpu_snapshot`]); a pid now naming a later
/// process (another start) counts from 0.
pub(super) fn cpu_deltas(procs: &[Proc], prev: &Value) -> Vec<(u32, u64)> {
    procs
        .iter()
        .filter_map(|p| {
            let was = &prev[p.pid.to_string()];
            let base = if was[0].as_u64() == Some(p.started) { was[1].as_u64().unwrap_or(0) } else { 0 };
            let d = p.cpu.saturating_sub(base);
            (d > 0).then_some((p.pid, d))
        })
        .collect()
}

/// The machine's CPU (%) over `ms` from the idle time of pid 0 (Windows), None without it. The
/// fallback when [`machine_cpu`] has no system times.
fn tick_cpu(deltas: &[(u32, u64)], procs: &[Proc], ms: u64, cores: usize) -> Option<u32> {
    procs.iter().find(|p| p.pid == 0 && p.cpu > 0)?;
    let idle = deltas.iter().find(|(pid, _)| *pid == 0).map_or(0, |(_, d)| *d);
    (ms > 0).then(|| 100u32.saturating_sub(cpu_share(idle, ms, cores)))
}

/// The machine's CPU (%) between two [`system_times`] readings (idle, total), None when either is
/// missing or no time passed.
pub(super) fn machine_cpu(prev: Option<(u64, u64)>, cur: Option<(u64, u64)>) -> Option<u32> {
    let ((i0, t0), (i1, t1)) = (prev?, cur?);
    let (di, dt) = (i1.checked_sub(i0)?, t1.checked_sub(t0)?);
    (dt > 0).then(|| (100.0 - di.min(dt) as f64 * 100.0 / dt as f64).round() as u32)
}

/// The machine's (idle, total) CPU time so far: Windows `GetSystemTimes` (100 ns; kernel includes
/// idle), Linux `/proc/stat` (ticks; idle + iowait). None elsewhere.
pub(super) fn system_times() -> Option<(u64, u64)> {
    #[cfg(windows)]
    {
        win::system_times()
    }
    #[cfg(target_os = "linux")]
    {
        let s = std::fs::read_to_string("/proc/stat").ok()?;
        let v: Vec<u64> = s.lines().next()?.split_whitespace().skip(1).filter_map(|x| x.parse().ok()).collect();
        (v.len() >= 5).then(|| (v[3] + v[4], v.iter().sum()))
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        None
    }
}

/// The room `pid` belongs to (its claude.exe or a descendant), from each room's tree.
fn owner<'a>(trees: &'a [(String, Vec<u32>)], pid: u32) -> Option<&'a str> {
    trees.iter().find(|(_, t)| t.contains(&pid)).map(|(n, _)| n.as_str())
}

/// The top 3 CPU users of the tick, by kind and owning room: `codebase-memory-mcp 12% (dev2)`,
/// `MsMpEng 4% (máy)`; processes of one kind and owner add up.
pub(super) fn cpu_top(procs: &[Proc], deltas: &[(u32, u64)], trees: &[(String, Vec<u32>)], ms: u64, cores: usize) -> Vec<String> {
    let mut by: Vec<((String, String), u64)> = Vec::new();
    for (pid, d) in deltas.iter().filter(|(pid, _)| *pid != 0) {
        let Some(p) = procs.iter().find(|p| p.pid == *pid) else { continue };
        let kind = what(p).unwrap_or_else(|| p.name.strip_suffix(".exe").unwrap_or(&p.name).to_string());
        let key = (kind, owner(trees, *pid).unwrap_or("máy").to_string());
        match by.iter_mut().find(|(k, _)| *k == key) {
            Some((_, t)) => *t += d,
            None => by.push((key, *d)),
        }
    }
    by.sort_by(|a, b| b.1.cmp(&a.1));
    by.into_iter().take(3).map(|((k, o), d)| format!("{k} {}% ({o})", cpu_share(d, ms, cores))).collect()
}

// ── what L1 takes ───────────────────────────────────────────────────────────────────────────

fn is_browser(name: &str) -> bool {
    let b = name.strip_suffix(".exe").unwrap_or(name);
    matches!(b, "chrome" | "chromium" | "chromium-browser" | "msedge" | "chrome-headless-shell" | "headless_shell")
}

fn is_py_uv(name: &str) -> bool {
    let b = name.strip_suffix(".exe").unwrap_or(name);
    b.starts_with("python") || matches!(b, "uv" | "uvx" | "pythonw")
}

/// The MCP server a command line runs (lowercased `c`).
fn mcp(c: &str) -> Option<&'static str> {
    if c.contains("serena") && c.contains("mcp") {
        Some("serena")
    } else if c.contains("headroom") && c.contains("mcp") {
        Some("headroom")
    } else if c.contains("@playwright/mcp") || c.contains("playwright-mcp") {
        Some("playwright")
    } else if c.contains("chrome-devtools-mcp") {
        Some("chrome-devtools")
    } else if c.contains("codebase-memory-mcp") {
        Some("codebase-memory")
    } else if c.contains("mcp-server") || c.contains("start-mcp-server") {
        Some("mcp")
    } else {
        None
    }
}

/// A language server's command line (lowercased `c`): tsserver, typescript-language-server,
/// pyright-langserver, vscode-*-language-server.
fn lsp(c: &str) -> Option<&'static str> {
    if c.contains("tsserver") {
        Some("tsserver")
    } else if c.contains("typescript-language-server") {
        Some("typescript-language-server")
    } else if c.contains("pyright") {
        Some("pyright")
    } else if c.contains("language-server") || c.contains("langserver") {
        Some("language-server")
    } else {
        None
    }
}

/// A test runner left watching (lowercased `c`): `vitest` without `run`, `jest --watch[All]`.
fn watch(c: &str) -> Option<&'static str> {
    let toks: Vec<&str> = c.split_whitespace().map(|t| t.trim_matches(['"', '\''])).collect();
    let at = |name: &str| toks.iter().position(|t| t.rsplit('/').next().is_some_and(|b| b == name || b.starts_with(&format!("{name}."))));
    if c.contains("/vitest/dist/workers/") {
        return None;
    }
    if let Some(i) = at("vitest") {
        let rest = &toks[i + 1..];
        return (!rest.iter().any(|t| matches!(*t, "run" | "bench" | "list" | "--run"))).then_some("vitest");
    }
    if at("jest").is_some() && toks.iter().any(|t| matches!(*t, "--watch" | "--watchall")) {
        return Some("jest --watch");
    }
    None
}

/// `--headless` browser main process (not a `--type=` child).
fn headless_main(c: &str) -> bool {
    c.contains("--headless") && !c.contains("--type=")
}

/// What a process is, for a kill row or a room's list: `vite preview`, `tsserver`, `chrome
/// headless`, `MCP serena`, …; a heavy process of no known kind by its image. None: nothing to name.
fn what(p: &Proc) -> Option<String> {
    let c = p.cmd.to_lowercase().replace('\\', "/");
    if let Some(m) = mcp(&c) {
        return Some(format!("MCP {m}"));
    }
    if is_browser(&p.name) {
        let b = p.name.strip_suffix(".exe").unwrap_or(&p.name);
        return Some(if c.contains("--headless") { format!("{b} headless") } else { b.to_string() });
    }
    if !p.shell {
        if let Some(k) = reap::kind(&p.cmd) {
            return Some(k);
        }
        if let Some(l) = lsp(&c).or_else(|| watch(&c)) {
            return Some(l.into());
        }
    }
    (p.rss >= 200 * MIB && !p.shell).then(|| p.name.strip_suffix(".exe").unwrap_or(&p.name).to_string()).filter(|s| !s.is_empty())
}

/// `vite preview :4197 pid 812 (2h 10m, 120 MB)`; `rss` = the whole tree's.
fn describe(p: &Proc, rss: u64, now: u64) -> String {
    let kind = what(p).unwrap_or_else(|| p.name.strip_suffix(".exe").unwrap_or(&p.name).to_string());
    let port = if is_browser(&p.name) { String::new() } else { reap::port(&p.cmd).map(|x| format!(" :{x}")).unwrap_or_default() };
    let m = now.saturating_sub(p.started) / 60;
    let age = if m >= 60 { format!("{}h {}m", m / 60, m % 60) } else { format!("{m}m") };
    format!("{kind}{port} pid {} ({age}, {} MB)", p.pid, rss / MIB)
}

/// One L1 kill: the top process and every pid of its tree to kill (top first).
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Pick {
    pub pid: u32,
    pub tree: Vec<u32>,
}

/// What L1 kills for `root`, never `me`, its ancestors, HQ's own app or a process of unknown start:
/// - the reaper's leftovers ([`reap::pick`]) from [`LEFT_AGE_S`] old;
/// - a language server of a room worktree whose card is closed (`closed`) or whose folder is gone,
///   detached or under a room's claude.exe (`rooms`: their pids);
/// - a detached test runner left watching in a room worktree, from [`LEFT_AGE_S`] old;
/// - an orphaned headless browser (main process) or MCP server (serena, headroom …) of this
///   project only: the project root or a room worktree in its own line or the chain above it, or
///   seen inside a room's tree before (`owned`: pid, start). Its driver / host is gone.
///
/// "Detached" is the reaper's chain rule ([`orphan_chain`]): walking up through helper processes
/// (node, shells; python/uv and the MCP's own shims for an MCP) ends at a parent that is gone,
/// never at unix init. A pick inside another pick's tree goes with that one.
#[allow(clippy::too_many_arguments)]
pub(super) fn l1_pick(procs: &[Proc], root: &Path, now: u64, me: u32, rooms: &[u32], owned: &[(u32, u64)], exists: &dyn Fn(&Path) -> bool, closed: &dyn Fn(&str) -> bool) -> Vec<Pick> {
    let Some(rootn) = reap::root_key(root) else { return Vec::new() };
    let fold = reap::windows_path(&root.to_string_lossy());
    let keep = reap::lineage(procs, me);
    let ok = |p: &Proc| !keep.contains(&p.pid) && p.started != 0 && !reap::is_hq(&p.cmd.to_lowercase());
    let helper = |q: &Proc| q.node || q.shell;
    let under_room = |p: &Proc| {
        let mut cur = p;
        for _ in 0..32 {
            let Some(q) = procs.iter().find(|q| cur.ppid > 1 && q.pid == cur.ppid && q.started <= cur.started) else { return false };
            if rooms.contains(&q.pid) {
                return true;
            }
            cur = q;
        }
        false
    };
    let ours = |chain: &[&Proc]| chain.iter().any(|q| owned.contains(&(q.pid, q.started)) || reap::names(&reap::norm(&q.cmd, fold), &rootn));
    let mut out: Vec<Pick> = reap::pick(procs, root, now, LEFT_AGE_S, me, exists).into_iter().map(|pid| Pick { pid, tree: reap::tree_of(procs, pid, &|q| q.node) }).collect();
    for p in procs.iter().filter(|p| ok(p)) {
        let c = reap::norm(&p.cmd, fold);
        let low = c.to_lowercase();
        let age = now.saturating_sub(p.started);
        let wt = reap::worktree(&c, &rootn);
        let mcp_chain = |q: &Proc| helper(q) || is_py_uv(&q.name) || mcp(&q.cmd.to_lowercase()).is_some();
        // What to kill from: the process itself, or for an MCP the top of its orphaned chain (the
        // `uvx` that started `uv` that started python) so the whole launcher goes.
        let top = if p.node && lsp(&low).is_some() {
            (wt.is_some_and(|dir| !exists(&root.join(".claude").join("worktrees").join(dir)) || closed(dir)) && (reap::detached(procs, p, &helper) || under_room(p))).then_some(p.pid)
        } else if p.node && watch(&low).is_some() {
            (wt.is_some() && age >= LEFT_AGE_S && reap::detached(procs, p, &helper)).then_some(p.pid)
        } else if is_browser(&p.name) {
            (headless_main(&low) && orphan_chain(procs, p, &helper).is_some_and(|ch| ours(&ch))).then_some(p.pid)
        } else if mcp(&low).is_some() {
            orphan_chain(procs, p, &mcp_chain).filter(|ch| ours(ch)).and_then(|ch| ch.last().map(|q| q.pid)).filter(|t| !keep.contains(t))
        } else {
            None
        };
        let Some(top) = top else { continue };
        if out.iter().any(|o| o.pid == top) {
            continue;
        }
        let tree = if is_browser(&p.name) {
            reap::tree_of(procs, top, &|q| is_browser(&q.name))
        } else if mcp(&low).is_some() {
            reap::tree_of(procs, top, &|q| !keep.contains(&q.pid))
        } else {
            reap::tree_of(procs, top, &|q| q.node)
        };
        out.push(Pick { pid: top, tree });
    }
    let all = out.clone();
    out.retain(|o| !all.iter().any(|x| x.pid != o.pid && x.tree.contains(&o.pid)));
    out
}

/// [`reap::detached`] keeping the chain walked (`p` first): `Some` when it ends at a parent that is
/// gone. Never at unix init (ppid 1): what a service manager (systemd, pm2) runs is not orphaned.
fn orphan_chain<'a>(procs: &'a [Proc], p: &'a Proc, through: &dyn Fn(&Proc) -> bool) -> Option<Vec<&'a Proc>> {
    let mut chain = vec![p];
    let mut cur = p;
    for _ in 0..32 {
        if cur.ppid == 1 {
            return None;
        }
        match procs.iter().find(|q| cur.ppid > 1 && q.pid == cur.ppid && q.started <= cur.started) {
            None => return Some(chain),
            Some(q) if q.started != 0 && through(q) => {
                chain.push(q);
                cur = q;
            }
            Some(_) => return None,
        }
    }
    None
}

/// What L1 may take later once its room is gone: an MCP server or a headless browser main process.
fn room_owned(p: &Proc) -> bool {
    let low = p.cmd.to_lowercase();
    mcp(&low).is_some() || (is_browser(&p.name) && headless_main(&low))
}

/// `owned` (pid, start) still alive, plus the [`room_owned`] processes inside the rooms' trees now.
fn remember_owned(procs: &[Proc], owned: &[(u32, u64)], in_rooms: &[u32]) -> Vec<(u32, u64)> {
    let mut out: Vec<(u32, u64)> = owned.iter().copied().filter(|(pid, s)| procs.iter().any(|p| p.pid == *pid && p.started == *s)).collect();
    for p in procs.iter().filter(|p| p.started != 0 && in_rooms.contains(&p.pid) && room_owned(p)) {
        if !out.contains(&(p.pid, p.started)) {
            out.push((p.pid, p.started));
        }
    }
    let skip = out.len().saturating_sub(OWNED_KEEP);
    out.split_off(skip)
}

fn owned_of(st: &Value) -> Vec<(u32, u64)> {
    st["owned"].as_array().into_iter().flatten().filter_map(|v| Some((u32::try_from(v[0].as_u64()?).ok()?, v[1].as_u64()?))).collect()
}

// ── files rooms left behind ─────────────────────────────────────────────────────────────────

/// Entries of a room scratch dir (`<root>/.claude/worktrees/<room>-scratch/<entry>`, where the QA
/// and review lanes keep throwaway files) untouched for [`SCRATCH_AGE_S`] (`mtime`: the newest
/// write anywhere inside; None = unknown, kept) and named in no live process's command line: L1
/// deletes them. Nothing of `<room>-scratch` while `<room>` works (`working`: a process's working
/// dir is not readable on Windows, so a room mid-turn may sit in it). A link entry is never followed.
fn stale_scratch(root: &Path, procs: &[Proc], now: u64, working: &dyn Fn(&str) -> bool, mtime: &dyn Fn(&Path) -> Option<u64>) -> Vec<PathBuf> {
    let fold = reap::windows_path(&root.to_string_lossy());
    let lines: Vec<String> = procs.iter().map(|p| reap::norm(&p.cmd, fold)).collect();
    let dirs = std::fs::read_dir(root.join(".claude").join("worktrees")).into_iter().flatten().flatten();
    let mut out = Vec::new();
    for d in dirs.filter(|d| d.file_type().is_ok_and(|t| t.is_dir())) {
        let name = d.file_name().to_string_lossy().to_ascii_lowercase();
        let Some(room) = name.strip_suffix("-scratch") else { continue };
        if working(room) {
            continue;
        }
        for e in std::fs::read_dir(d.path()).into_iter().flatten().flatten() {
            let p = e.path();
            let key = reap::norm(&p.to_string_lossy(), fold);
            if lines.iter().any(|l| l.contains(&key)) {
                continue;
            }
            if mtime(&p).is_some_and(|m| now.saturating_sub(m) >= SCRATCH_AGE_S) {
                out.push(p);
            }
        }
    }
    out
}

/// Newest last-write (unix s) anywhere under `p` (links not followed), walking at most `limit`
/// entries: None when the walk is cut short or `p` cannot be read — then nothing is known to be old.
fn newest_mtime(p: &Path, limit: usize) -> Option<u64> {
    let secs = |m: &std::fs::Metadata| m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs());
    let mut newest = 0;
    let mut stack = vec![p.to_path_buf()];
    let mut seen = 0;
    while let Some(cur) = stack.pop() {
        seen += 1;
        if seen > limit {
            return None;
        }
        let m = std::fs::symlink_metadata(&cur).ok()?;
        newest = newest.max(secs(&m)?);
        if m.is_dir() {
            stack.extend(std::fs::read_dir(&cur).ok()?.flatten().map(|e| e.path()));
        }
    }
    Some(newest)
}

/// Deletes `p` (a dir with its contents, or a file or link) — only ever a [`stale_scratch`] entry.
fn remove_entry(p: &Path) -> bool {
    match std::fs::symlink_metadata(p) {
        Ok(m) if m.is_dir() => std::fs::remove_dir_all(p).is_ok(),
        Ok(_) => std::fs::remove_file(p).or_else(|_| std::fs::remove_dir(p)).is_ok(),
        Err(_) => false,
    }
}

/// Size (MiB) and count of `%TEMP%\qa-card-*` / `qa-fetch*` (QA rooms once extracted whole repo
/// copies with node_modules there; Defender scanned them at 41% CPU, 2026-10-21). Shown, never
/// deleted: nothing ties them to a project. The walk stops after `budget` (`partial`).
fn temp_qa(dir: &Path, budget: std::time::Duration) -> Value {
    let until = std::time::Instant::now() + budget;
    let mut bytes = 0u64;
    let mut dirs = 0u64;
    let mut partial = false;
    let mut stack: Vec<PathBuf> = Vec::new();
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().to_ascii_lowercase();
        if n.starts_with("qa-card-") || n.starts_with("qa-fetch") {
            dirs += 1;
            stack.push(e.path());
        }
    }
    while let Some(p) = stack.pop() {
        if std::time::Instant::now() >= until {
            partial = true;
            break;
        }
        match std::fs::symlink_metadata(&p) {
            Ok(m) if m.is_dir() => stack.extend(std::fs::read_dir(&p).into_iter().flatten().flatten().map(|e| e.path())),
            Ok(m) => bytes += m.len(),
            Err(_) => {}
        }
    }
    json!({ "mb": bytes / MIB, "dirs": dirs, "partial": partial })
}

// ── who holds what ──────────────────────────────────────────────────────────────────────────

/// A live room's process tree.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Load {
    pub name: String,
    /// The room's claude.exe.
    pub pid: u32,
    /// Its whole tree, claude.exe included (bytes).
    pub total: u64,
    /// Outside its own claude.exe.
    pub held: u64,
    /// Heaviest first, at most 3: `vite preview :4197 pid 812 (12m, 120 MB)`.
    pub items: Vec<String>,
    /// Blocked in `8sync ccc auto wait` (waiting for a card, not working).
    pub waiting: bool,
}

/// Each room's tree (`rooms`: name, claude.exe pid): every descendant (start-time rule of
/// [`reap::tree_of`]); its items are the processes of a known kind ([`what`]) with no such process
/// between them and the room, each counted with its own subtree.
pub(super) fn attribute(procs: &[Proc], rooms: &[(String, u32)], now: u64) -> Vec<Load> {
    let rss = |pids: &[u32]| procs.iter().filter(|q| pids.contains(&q.pid)).map(|q| q.rss).sum::<u64>();
    rooms
        .iter()
        .filter(|(_, pid)| procs.iter().any(|p| p.pid == *pid))
        .map(|(name, pid)| {
            let tree = reap::tree_of(procs, *pid, &|_| true);
            let total = rss(&tree);
            let own = rss(&[*pid]);
            let mut items: Vec<(u64, String)> = Vec::new();
            for q in procs.iter().filter(|q| q.pid != *pid && tree.contains(&q.pid)) {
                if what(q).is_none() {
                    continue;
                }
                // Nearest ancestor below the room with a kind: then q is counted in that one.
                let mut cur = q;
                let mut inner = false;
                while let Some(up) = procs.iter().find(|u| u.pid == cur.ppid && u.pid != *pid && tree.contains(&u.pid)) {
                    if what(up).is_some() {
                        inner = true;
                        break;
                    }
                    cur = up;
                }
                if !inner {
                    let sub = rss(&reap::tree_of(procs, q.pid, &|_| true));
                    items.push((sub, describe(q, sub, now)));
                }
            }
            items.sort_by(|a, b| b.0.cmp(&a.0));
            let waiting = procs.iter().any(|q| tree.contains(&q.pid) && is_auto_wait(q));
            Load { name: name.clone(), pid: *pid, total, held: total.saturating_sub(own), items: items.into_iter().take(3).map(|(_, d)| d).collect(), waiting }
        })
        .collect()
}

/// The message a room holding ≥ [`HELD`] gets.
fn held_text(ram: u32, l: &Load) -> String {
    format!(
        "[RAM {ram}%] phòng bạn đang giữ {} MB: {}. Tắt cái không cần NGAY (kill theo PID cây), không mở server nền mới; chụp xong tắt preview.",
        l.held / MIB,
        l.items.join(", ")
    )
}

/// `8sync ccc auto wait`: a room blocked waiting for a card, not working.
fn is_auto_wait(q: &Proc) -> bool {
    q.name.starts_with("8sync") && q.cmd.to_lowercase().contains("auto wait")
}

/// Whether room claude.exe `pid` is still blocked in `auto wait` in `procs` (the revive's shared
/// listing): `revive`'s check right before a lean restart of a room that looked busy.
pub(super) fn still_waiting(procs: &[Proc], pid: u32) -> bool {
    let tree = reap::tree_of(procs, pid, &|_| true);
    procs.iter().any(|q| q.pid != pid && tree.contains(&q.pid) && is_auto_wait(q))
}

/// L2: up to [`RESTARTS`] idle rooms whose tree is at least [`HEAVY`], heaviest first: `busy`
/// false, or blocked in `auto wait` with nothing in its inbox (`pending`: a resume forks an id that
/// never reads it). Never one already restarted in this high-RAM spell (`restarted`: it is lean
/// already, a second restart frees nothing while what is high is not the rooms), nor one restarted
/// in the last [`RESTART_AGAIN_S`] whatever the spell (`floor`: room → when).
pub(super) fn restart_pick(loads: &[Load], busy: &dyn Fn(&str) -> bool, pending: &dyn Fn(&str) -> bool, restarted: &Value, floor: &Value, now: u64) -> Vec<String> {
    let mut c: Vec<&Load> = loads
        .iter()
        .filter(|l| {
            let recent = floor[&l.name].as_u64().is_some_and(|at| now.saturating_sub(at) < RESTART_AGAIN_S);
            l.total >= HEAVY && !pending(&l.name) && (l.waiting || !busy(&l.name)) && restarted.get(&l.name).is_none() && !recent
        })
        .collect();
    c.sort_by(|a, b| b.total.cmp(&a.total));
    c.into_iter().take(RESTARTS).map(|l| l.name.clone()).collect()
}

/// L3: how many rooms to keep so `used` drops under `budget` (RAM MiB, or CPU in 0.1 %). `loads`
/// = each live room's share in the same unit; each paused room frees their average. When what is
/// not a room is over `budget` on its own, the rooms only give up their share of the overshoot
/// (rooms / used): pausing them all would not bring it under anyway. Never fewer than the core
/// rooms (`core`), never more than run.
pub(super) fn keep_count(loads: &[u64], used: u64, budget: u64, core: usize) -> usize {
    let n = loads.len();
    if n == 0 {
        return 0;
    }
    let rooms = loads.iter().sum::<u64>();
    let avg = (rooms / n as u64).max(1);
    let over = used.saturating_sub(budget);
    let need = if used.saturating_sub(rooms) >= budget { over * rooms / used.max(1) } else { over };
    let drop = need.div_ceil(avg) as usize;
    n.saturating_sub(drop).clamp(core.min(n), n)
}

/// Which of `live` to pause so `keep` stay: [`DROP_ORDER`] first, then other non-core rooms;
/// never lead, dev, qa or the sweep ([`kept`]).
pub(super) fn to_pause(live: &[String], keep: usize) -> Vec<String> {
    let extra = live.len().saturating_sub(keep);
    let mut order: Vec<&String> = live.iter().filter(|n| !kept(n)).collect();
    order.sort_by_key(|n| DROP_ORDER.iter().position(|d| d == n).unwrap_or(DROP_ORDER.len()));
    order.into_iter().take(extra).cloned().collect()
}

/// One more room at the rooms' average share `avg` fits: `used + avg` stays under `budget` with
/// `margin` to spare (one unit: RAM MiB, or CPU in 0.1 %). What the owner runs counts as it is; a
/// paused room comes back as soon as there is room for it, not only on an idle machine.
fn room_fits(used: u64, avg: u64, budget: u64, margin: u64) -> bool {
    used + avg + margin <= budget
}

/// The paused room to bring back now: the last one paused (the most needed), once one more room
/// has fit ([`room_fits`]) since `calm_since` for [`CALM_S`]. One per tick.
pub(super) fn resume_pick(paused: &[String], calm_since: Option<u64>, now: u64) -> Option<String> {
    let ok = calm_since.is_some_and(|s| now.saturating_sub(s) >= CALM_S);
    ok.then(|| paused.last().cloned()).flatten()
}

// ── priority and power ──────────────────────────────────────────────────────────────────────

/// Windows process calls by PID: below-normal priority and EcoQoS ("Efficiency mode": the
/// scheduler runs the process at low clocks — `SetProcessInformation(ProcessPowerThrottling,
/// EXECUTION_SPEED)`, https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation).
#[cfg(windows)]
mod win {
    type Handle = *mut std::ffi::c_void;
    #[repr(C)]
    struct Throttle {
        version: u32,
        control: u32,
        state: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn SetPriorityClass(h: Handle, class: u32) -> i32;
        fn SetProcessInformation(h: Handle, class: i32, info: *const std::ffi::c_void, size: u32) -> i32;
        fn GetProcessInformation(h: Handle, class: i32, info: *mut std::ffi::c_void, size: u32) -> i32;
        fn GetProcessAffinityMask(h: Handle, process: *mut usize, system: *mut usize) -> i32;
        fn SetProcessAffinityMask(h: Handle, mask: usize) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn GetSystemTimes(idle: *mut u64, kernel: *mut u64, user: *mut u64) -> i32;
    }
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    pub const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x4000;
    pub const IDLE_PRIORITY_CLASS: u32 = 0x40;
    const PROCESS_POWER_THROTTLING: i32 = 4;
    const EXECUTION_SPEED: u32 = 1;

    /// `f` on an open handle of `pid` (closed after); None when the process is gone or not ours.
    fn with<T>(pid: u32, access: u32, f: impl FnOnce(Handle) -> T) -> Option<T> {
        // SAFETY: plain calls; a null handle is checked before use and closed once.
        unsafe {
            let h = OpenProcess(access, 0, pid);
            if h.is_null() {
                return None;
            }
            let out = f(h);
            CloseHandle(h);
            Some(out)
        }
    }

    /// `pid`'s affinity mask (its first group), None when unreadable.
    pub fn affinity(pid: u32) -> Option<u64> {
        let (mut p, mut s) = (0usize, 0usize);
        // SAFETY: two out-pointers to live usizes.
        let ok = with(pid, PROCESS_QUERY_LIMITED_INFORMATION, |h| unsafe { GetProcessAffinityMask(h, &mut p, &mut s) != 0 })?;
        (ok && p != 0).then_some(p as u64)
    }

    /// https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-setprocessaffinitymask:
    /// inherited by the children the process starts after.
    pub fn set_affinity(pid: u32, mask: u64) -> bool {
        // SAFETY: `h` is a live handle with PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION.
        with(pid, PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, |h| unsafe { SetProcessAffinityMask(h, mask as usize) != 0 }).unwrap_or(false)
    }

    /// (idle, kernel + user) 100-ns times of the whole machine (kernel includes idle).
    pub fn system_times() -> Option<(u64, u64)> {
        let (mut i, mut k, mut u) = (0u64, 0u64, 0u64);
        // SAFETY: three out-pointers to live u64s (FILETIME is two u32s, same layout).
        let ok = unsafe { GetSystemTimes(&mut i, &mut k, &mut u) != 0 };
        ok.then_some((i, k + u))
    }

    /// Logical CPUs of the system mask (first group), whatever this process is pinned to.
    pub fn system_cpus() -> Option<usize> {
        let (mut p, mut s) = (0usize, 0usize);
        // SAFETY: the pseudo handle needs no close; two out-pointers to live usizes.
        let ok = unsafe { GetProcessAffinityMask(GetCurrentProcess(), &mut p, &mut s) != 0 };
        (ok && s != 0).then_some(s.count_ones() as usize)
    }

    pub fn set_class(pid: u32, class: u32) -> bool {
        // SAFETY: `h` is a live handle with PROCESS_SET_INFORMATION.
        with(pid, PROCESS_SET_INFORMATION, |h| unsafe { SetPriorityClass(h, class) != 0 }).unwrap_or(false)
    }

    /// Whether `pid` runs in EcoQoS; None when it cannot be read.
    pub fn eco(pid: u32) -> Option<bool> {
        let mut t = Throttle { version: 1, control: 0, state: 0 };
        // SAFETY: `t` is a PROCESS_POWER_THROTTLING_STATE the call fills, its size passed.
        let ok = with(pid, PROCESS_QUERY_LIMITED_INFORMATION, |h| unsafe { GetProcessInformation(h, PROCESS_POWER_THROTTLING, &mut t as *mut Throttle as *mut _, std::mem::size_of::<Throttle>() as u32) != 0 })?;
        ok.then_some(t.control & EXECUTION_SPEED != 0 && t.state & EXECUTION_SPEED != 0)
    }

    /// EcoQoS on, or back to the system's default (not forced off) for `on` false.
    pub fn set_eco(pid: u32, on: bool) -> bool {
        let t = Throttle { version: 1, control: if on { EXECUTION_SPEED } else { 0 }, state: if on { EXECUTION_SPEED } else { 0 } };
        // SAFETY: `t` is a PROCESS_POWER_THROTTLING_STATE, its size passed.
        with(pid, PROCESS_SET_INFORMATION, |h| unsafe { SetProcessInformation(h, PROCESS_POWER_THROTTLING, &t as *const Throttle as *const _, std::mem::size_of::<Throttle>() as u32) != 0 }).unwrap_or(false)
    }
}

/// Below-normal priority for `pids` (Windows `SetPriorityClass`, unix `renice +10`), or idle
/// (`idle`: Windows idle class, unix `renice +19`), one by one by PID; how many changed. Only ever
/// called with a room's tree.
pub(super) fn lower(pids: &[u32], idle: bool) -> usize {
    #[cfg(windows)]
    {
        let class = if idle { win::IDLE_PRIORITY_CLASS } else { win::BELOW_NORMAL_PRIORITY_CLASS };
        pids.iter().filter(|&&pid| win::set_class(pid, class)).count()
    }
    #[cfg(not(windows))]
    {
        let n = if idle { "19" } else { "10" };
        pids.iter()
            .filter(|pid| {
                std::process::Command::new("renice")
                    .args(["-n", n, "-p", &pid.to_string()])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .is_ok_and(|s| s.success())
            })
            .count()
    }
}

/// Efficiency mode for the rooms' processes `pids` (`on`), or back to the default (`off`): only
/// those not already there change, so a tick after the owner's own `BelowNormal`/Efficiency
/// changes does nothing twice. How many changed; 0 off Windows (no EcoQoS there). A child does not
/// inherit EcoQoS (checked live 2026-10-21: a node spawned by a throttled, below-normal node came
/// out below normal but not in EcoQoS), hence the sweep every tick.
pub(super) fn eco(pids: &[u32], on: bool) -> usize {
    #[cfg(windows)]
    {
        pids.iter().filter(|&&pid| win::eco(pid).is_some_and(|now| now != on) && win::set_eco(pid, on)).count()
    }
    #[cfg(not(windows))]
    {
        let _ = (pids, on);
        0
    }
}

// ── CPU cap (affinity) ──────────────────────────────────────────────────────────────────────

/// Every logical CPU of the first processor group (≤ 64).
fn full_mask(cpus: usize) -> u64 {
    let n = cpus.clamp(1, 64);
    u64::MAX >> (64 - n)
}

/// The affinity mask for a `cap`% of `cpus` logical CPUs: N = cap × cpus / 100 rounded (37% of 32
/// = 12, the 12 CPUs the owner pinned by hand), at least
/// 2, halved (at least 2) while `tight`, the highest-numbered first (on AMD X3D the V-Cache CCD is
/// CPUs 0..15: left to the owner). Over 64 CPUs only the first group counts.
pub(super) fn cap_mask(cap: u32, cpus: usize, tight: bool) -> u64 {
    let cpus = cpus.clamp(1, 64);
    let mut n = ((cap as usize * cpus + 50) / 100).max(2);
    if tight {
        n = (n / 2).max(2);
    }
    let n = n.min(cpus) as u32;
    let full = full_mask(cpus);
    full & !full.checked_shr(n).unwrap_or(0)
}

/// The cap tightens while the machine's CPU is ≥ the threshold and lets go once it is
/// [`CAP_CALM`] points under; in between (or unknown) it stays as it was.
pub(super) fn cap_tight(was: bool, cpu: Option<u32>, pct: u32) -> bool {
    match cpu {
        Some(c) if c >= pct => true,
        Some(c) if c + CAP_CALM <= pct => false,
        _ => was,
    }
}

/// Claude Code's background daemon (`claude daemon`) or its pty host (`--bg-pty-host`): rooms are
/// spawned under it, so its mask covers rooms not open yet. Never the owner's interactive claude.
pub(super) fn is_daemon(p: &Proc) -> bool {
    let claude = p.image == "claude" || (p.node && p.cmd.to_lowercase().contains("claude"));
    claude && (p.cmd.contains("--bg-pty-host") || p.cmd.split_whitespace().skip(1).any(|t| t == "daemon"))
}

/// What the cap pins: every process of the rooms' trees and the daemon(s), once each.
pub(super) fn cap_targets(procs: &[Proc], trees: &[(String, Vec<u32>)]) -> Vec<u32> {
    let mut v = in_rooms(trees);
    v.extend(procs.iter().filter(|p| is_daemon(p)).map(|p| p.pid));
    v.sort_unstable();
    v.dedup();
    v.retain(|pid| procs.iter().any(|p| p.pid == *pid));
    v
}

/// What `cap off` / `guard off` puts back on every CPU: the daemons and all they spawned (the rooms
/// and their trees, whatever project), nothing else.
pub(super) fn uncap_targets(procs: &[Proc]) -> Vec<u32> {
    let mut v: Vec<u32> = procs.iter().filter(|p| is_daemon(p)).flat_map(|p| reap::tree_of(procs, p.pid, &|_| true)).collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// Of `pids`, those whose current mask (`get`) is readable and not `mask` yet.
pub(super) fn to_pin(pids: &[u32], mask: u64, get: &dyn Fn(u32) -> Option<u64>) -> Vec<u32> {
    pids.iter().copied().filter(|&pid| get(pid).is_some_and(|m| m != mask)).collect()
}

/// Logical CPUs of the machine's first group: Windows the system mask (not this process's), else
/// what std reports.
pub(super) fn logical_cpus() -> usize {
    #[cfg(windows)]
    if let Some(n) = win::system_cpus() {
        return n;
    }
    std::thread::available_parallelism().map_or(1, |n| n.get()).min(64)
}

/// `pid`'s affinity mask; None when unreadable (gone, not ours, macOS).
pub(super) fn affinity_of(pid: u32) -> Option<u64> {
    #[cfg(windows)]
    {
        win::affinity(pid)
    }
    #[cfg(target_os = "linux")]
    {
        let out = std::process::Command::new("taskset").args(["-p", &pid.to_string()]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output().ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        u64::from_str_radix(s.trim().rsplit(' ').next()?.trim(), 16).ok()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = pid;
        None
    }
}

/// Pin `pids` to `mask` one by one (Windows `SetProcessAffinityMask`, Linux `taskset -a -p` for
/// every thread); how many changed. Only ever called with [`cap_targets`] / [`uncap_targets`].
pub(super) fn pin(pids: &[u32], mask: u64) -> usize {
    #[cfg(windows)]
    {
        pids.iter().filter(|&&pid| win::set_affinity(pid, mask)).count()
    }
    #[cfg(target_os = "linux")]
    {
        pids.iter()
            .filter(|pid| {
                std::process::Command::new("taskset")
                    .args(["-a", "-p", &format!("{mask:x}"), &pid.to_string()])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .status()
                    .is_ok_and(|s| s.success())
            })
            .count()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (pids, mask);
        0
    }
}

/// Whether the cap is tightened now (machine-wide: the daemon is shared by every project).
fn tight_now(home: &Path) -> bool {
    idle::read_json(&machine_file(home)).and_then(|m| m["cap_tight"].as_bool()).unwrap_or(false)
}

/// Pin the daemon and the rooms' trees to the cap's mask; how many changed. None while the guard
/// or the cap is off.
fn enforce(home: &Path, procs: &[Proc], trees: &[(String, Vec<u32>)], tight: bool) -> Option<usize> {
    auto::guard_pct(home)?;
    let cap = auto::guard_cap(home)?;
    let mask = cap_mask(cap, logical_cpus(), tight);
    let pins = to_pin(&cap_targets(procs, trees), mask, &affinity_of);
    Some(if pins.is_empty() { 0 } else { pin(&pins, mask) })
}

/// Right after `auto up` / `revive` open rooms: the new trees go under the cap at once (the
/// daemon's mask covers them already unless Claude Code restarted it). How many changed.
pub(super) fn cap_now(home: &Path, root: &Path, claude: &dyn Claude, registry: &[(String, String)], now: u64) -> usize {
    if auto::guard_pct(home).is_none() || auto::guard_cap(home).is_none() {
        return 0;
    }
    let procs = reap::list(now);
    let live = claude
        .run(&["agents".into(), "--json".into(), "--cwd".into(), root.to_string_lossy().into_owned()])
        .map(|j| live_rooms(&j, registry, &records(home)))
        .unwrap_or_default();
    let trees = room_trees(&procs, &live);
    enforce(home, &procs, &trees, tight_now(home)).unwrap_or(0)
}

/// `cap off` / `guard off`: the daemons and everything under them back on every CPU; how many
/// changed. The tightened state ends.
pub(super) fn uncap(home: &Path, now: u64) -> usize {
    let mfile = machine_file(home);
    if let Some(mut m) = idle::read_json(&mfile).filter(|m| m["cap_tight"].as_bool() == Some(true)) {
        m["cap_tight"] = json!(false);
        idle::write_json(&mfile, &m);
    }
    let procs = reap::list(now);
    let full = full_mask(logical_cpus());
    let pins = to_pin(&uncap_targets(&procs), full, &affinity_of);
    if pins.is_empty() {
        0
    } else {
        pin(&pins, full)
    }
}

/// The cap's text: `CPU phòng tối đa 37% (12/32 luồng)`, `· đang siết` while tightened.
fn cap_text(cap: u32, cpus: usize, tight: bool) -> String {
    let n = cap_mask(cap, cpus, tight).count_ones();
    let cpus = cpus.clamp(1, 64);
    format!("CPU phòng tối đa {cap}% ({n}/{cpus} luồng){}", if tight { " · đang siết (CPU vượt ngưỡng)" } else { "" })
}

/// Each live room's process tree (its claude.exe first).
fn room_trees(procs: &[Proc], live: &[LiveRoom]) -> Vec<(String, Vec<u32>)> {
    live.iter().filter(|r| procs.iter().any(|p| p.pid == r.pid)).map(|r| (r.name.clone(), reap::tree_of(procs, r.pid, &|_| true))).collect()
}

/// Every process of the rooms' trees.
fn in_rooms(trees: &[(String, Vec<u32>)]) -> Vec<u32> {
    trees.iter().flat_map(|(_, t)| t.iter().copied()).collect()
}

/// The processes of the rooms' trees still at normal priority ([`Proc::normal`]).
pub(super) fn to_lower(procs: &[Proc], trees: &[(String, Vec<u32>)]) -> Vec<u32> {
    procs.iter().filter(|p| p.normal && owner(trees, p.pid).is_some()).map(|p| p.pid).collect()
}

/// Build/test work a room runs (node, esbuild, browsers, cargo, rustc …): these go to idle priority
/// while the machine is over the threshold. Never an MCP server, `8sync` (`auto wait` included),
/// nor the room's own claude (node.exe when Claude Code came from npm: [`to_idle`]).
fn build_kind(p: &Proc) -> bool {
    let n = p.name.trim_end_matches(".exe");
    let kind = p.node || is_browser(&p.name) || matches!(n, "esbuild" | "tsc" | "cargo" | "rustc" | "go" | "deno" | "bun" | "python" | "pytest" | "cl" | "link" | "cc1" | "cc1plus" | "ld");
    kind && !n.starts_with("8sync") && !is_auto_wait(p) && mcp(&p.cmd.to_lowercase()).is_none()
}

/// Breach: the rooms' build/test processes not at idle priority yet ([`build_kind`]); a room's
/// own claude (the root of its tree) never.
fn to_idle(procs: &[Proc], trees: &[(String, Vec<u32>)]) -> Vec<u32> {
    let roots: Vec<u32> = trees.iter().filter_map(|(_, t)| t.first().copied()).collect();
    procs.iter().filter(|p| !p.idle && !roots.contains(&p.pid) && build_kind(p) && owner(trees, p.pid).is_some()).map(|p| p.pid).collect()
}

/// Calm again: the rooms' processes the breach left at idle go back to below normal.
fn to_restore(procs: &[Proc], trees: &[(String, Vec<u32>)]) -> Vec<u32> {
    procs.iter().filter(|p| p.idle && owner(trees, p.pid).is_some()).map(|p| p.pid).collect()
}

/// Staggered start (`auto up`, `revive`): after a room opens, wait until the machine's CPU settles
/// under the guard threshold — sampled every 2 s, at least 4 s, at most 25 s — spending from
/// `budget`, so a dozen indexers never start at once. No wait while the guard is off, or in tests.
pub(super) fn settle(home: &Path, budget: &mut std::time::Duration) {
    use std::time::{Duration, Instant};
    if cfg!(test) || budget.is_zero() {
        return;
    }
    let Some(pct) = auto::guard_cpu(home) else { return };
    let Some(s) = crate::verbs::hq_core::sampler::Sampler::new() else { return };
    s.get(Duration::ZERO);
    let start = Instant::now();
    loop {
        std::thread::sleep(Duration::from_secs(2));
        let cpu = s.get(Duration::ZERO).cpu_pct;
        let el = start.elapsed();
        if (el >= Duration::from_secs(4) && cpu.is_some_and(|c| c < pct)) || el >= Duration::from_secs(25) || el >= *budget {
            *budget = budget.saturating_sub(el);
            return;
        }
    }
}

// ── lean rooms ──────────────────────────────────────────────────────────────────────────────

/// Rooms that never need a language server: they plan, test and review, not build.
fn lean_role(name: &str) -> bool {
    !room::builds(name) || room::crew(name) == "eye"
}

/// Room `name` starts lean ([`lean_plugins`] and [`lean_mcp`] off): the sweep always (it reads
/// sizes and processes, never code), others while the guard is on: always for a non-builder, for
/// every room while the project's guard is at L2 or more.
pub(super) fn lean(home: &Path, root: &Path, name: &str) -> bool {
    room::is_sweep(name) || (auto::guard_pct(home).is_some() && (lean_role(name) || level_of(home, root) >= Level::Restart))
}

/// Claude Code's config dir (`CLAUDE_CONFIG_DIR`, else `~/.claude`).
fn claude_dir(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude"))
}

/// The LSP plugins the user's settings turn on (`<name>-lsp@<marketplace>`: typescript-lsp,
/// pyright-lsp, gopls-lsp, rust-analyzer-lsp …): a lean room turns them off with `--settings`
/// `enabledPlugins` (checked live 2026-10-21 on Claude Code 2.1.296: the init event lists
/// `typescript-lsp` without it and not with `{"enabledPlugins":{"typescript-lsp@…":false}}`; the
/// other plugins stay — https://code.claude.com/docs/en/settings#settings-precedence).
pub(super) fn lean_plugins(user_settings: &Value) -> Vec<String> {
    let mut v: Vec<String> = user_settings["enabledPlugins"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(k, on)| on.as_bool() == Some(true) && k.split('@').next().is_some_and(|n| n.ends_with("-lsp") || n == "lsp"))
        .map(|(k, _)| k.clone())
        .collect();
    v.sort();
    v
}

/// Indexing MCP servers every room would start its own copy of (codebase-memory-mcp indexed for
/// ~43 s of CPU in each new room's first 5 min, 2026-10-21; serena ~190 MB a room): these names
/// always, plus any server of the user's `~/.claude.json` named like them. A lean room denies them
/// with `--settings` `deniedMcpServers` (`serverName`), which merges from every scope and keeps all
/// other servers — user, project `.mcp.json`, plugins
/// (https://code.claude.com/docs/en/settings-reference#deniedmcpservers; checked live 2026-10-21:
/// the init event lists `codebase-memory-mcp` and `serena` without it, neither with it).
/// `--strict-mcp-config` would also drop the project's and plugins' servers rooms may need.
pub(super) fn lean_mcp(claude_json: &Value) -> Vec<String> {
    let mut v: Vec<String> = ["codebase-memory-mcp", "serena"].iter().map(|s| s.to_string()).collect();
    for k in claude_json["mcpServers"].as_object().into_iter().flatten().map(|(k, _)| k) {
        let low = k.to_lowercase();
        if (low.contains("serena") || low.contains("codebase-memory") || low.contains("codegraph")) && !v.contains(k) {
            v.push(k.clone());
        }
    }
    v.sort();
    v
}

/// [`lean_plugins`] and [`lean_mcp`] of this machine's Claude Code config.
pub(super) fn lean_of(home: &Path) -> (Vec<String>, Vec<String>) {
    let dir = claude_dir(home);
    let user = idle::read_json(&dir.join("settings.json")).map(|v| lean_plugins(&v)).unwrap_or_default();
    let global = if std::env::var_os("CLAUDE_CONFIG_DIR").is_some() { dir.join(".claude.json") } else { home.join(".claude.json") };
    (user, lean_mcp(&idle::read_json(&global).unwrap_or(Value::Null)))
}

// ── state ───────────────────────────────────────────────────────────────────────────────────

fn file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("guard.json")
}

fn key(root: &Path) -> String {
    root.to_string_lossy().into_owned()
}

/// Machine-wide guard state (`temp_qa`), apart from the per-project file.
fn machine_file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("guard-machine.json")
}

fn load(home: &Path) -> Value {
    idle::read_json(&file(home)).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

fn names(v: &Value) -> Vec<String> {
    v.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect()
}

fn level_of(home: &Path, root: &Path) -> Level {
    Level::of(load(home)[key(root)]["level"].as_u64().unwrap_or(0))
}

/// Rooms the guard paused in `root`: `auto revive` does not bring them back. None while the guard
/// is off (its pauses end with it).
pub(super) fn paused(home: &Path, root: &Path) -> Vec<String> {
    if auto::guard_pct(home).is_none() {
        return Vec::new();
    }
    names(&load(home)[key(root)]["paused"])
}

/// A room L2 asked `revive` to restart lean.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Restart {
    pub name: String,
    /// Blocked in `auto wait` when picked (busy to `claude agents`, idle in fact).
    pub waiting: bool,
    /// Its claude.exe then.
    pub pid: u32,
}

/// The rooms L2 asked `revive` to restart lean; each stays asked until [`restart_done`] (a room
/// put off by the deadline or a turn is retried next tick). None while the guard is off.
pub(super) fn restarts(home: &Path, root: &Path) -> Vec<Restart> {
    if auto::guard_pct(home).is_none() {
        return Vec::new();
    }
    load(home)[key(root)]["restart"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| Some(Restart { name: v["name"].as_str()?.to_string(), waiting: v["waiting"].as_bool().unwrap_or(false), pid: u32::try_from(v["pid"].as_u64().unwrap_or(0)).unwrap_or(0) }))
        .collect()
}

/// `revive` restarted `room` lean: no longer asked, not restarted again in this high-RAM spell nor
/// within [`RESTART_AGAIN_S`].
pub(super) fn restart_done(home: &Path, root: &Path, room: &str, now: u64) {
    let mut all = load(home);
    let st = &mut all[key(root)];
    if let Some(a) = st["restart"].as_array_mut() {
        a.retain(|v| v["name"].as_str() != Some(room));
    }
    st["restarted"][room] = json!(now);
    st["restart_floor"][room] = json!(now);
    idle::write_json(&file(home), &all);
}

/// `auto up`: the owner brings the whole team up, the guard's pauses end.
pub(super) fn clear_paused(home: &Path, root: &Path) {
    let mut all = load(home);
    if all[key(root)]["paused"].as_array().is_some_and(|a| !a.is_empty()) {
        all[key(root)]["paused"] = json!([]);
        idle::write_json(&file(home), &all);
    }
}

/// `auto up --add <rooms>` / `down --only <room>`: only these rooms leave the guard's paused list.
pub(super) fn unpause(home: &Path, root: &Path, rooms: &[String]) {
    let mut all = load(home);
    let k = key(root);
    let Some(a) = all[&k]["paused"].as_array_mut() else { return };
    let n = a.len();
    a.retain(|v| !v.as_str().is_some_and(|s| rooms.iter().any(|r| r == s)));
    if a.len() != n {
        idle::write_json(&file(home), &all);
    }
}

/// `auto guard off`: every project's pauses and asked restarts end (the next revive brings the
/// paused rooms back).
pub(super) fn clear_all(home: &Path) {
    let mut all = load(home);
    let mut changed = false;
    for st in all.as_object_mut().into_iter().flat_map(|o| o.values_mut()) {
        for k in ["paused", "restart"] {
            if st[k].as_array().is_some_and(|a| !a.is_empty()) {
                st[k] = json!([]);
                changed = true;
            }
        }
    }
    if changed {
        idle::write_json(&file(home), &all);
    }
}

fn log(st: &mut Value, now: u64, text: &str) {
    let mut a: Vec<Value> = st["actions"].as_array().cloned().unwrap_or_default();
    a.push(json!({ "at": now, "text": text }));
    let skip = a.len().saturating_sub(ACTIONS_KEEP);
    st["actions"] = Value::from(a.into_iter().skip(skip).collect::<Vec<_>>());
}

/// `auto status --json`'s `guard`: the threshold (null = off) and each project's last pass.
pub(super) fn status_json(home: &Path, pct: Option<u32>) -> Value {
    let all = load(home);
    let projects: Vec<Value> = all
        .as_object()
        .into_iter()
        .flatten()
        .map(|(root, st)| {
            json!({
                "root": root,
                "level": st["level"].as_u64().unwrap_or(0),
                "at": st["at"].as_u64(),
                "ram": st["ram"].as_u64(),
                "cpu": st["cpu"].as_u64(),
                "paused": if pct.is_some() { names(&st["paused"]) } else { Vec::new() },
                "actions": st["actions"].as_array().cloned().unwrap_or_default(),
                "defender": st["defender"].as_str(),
                "defender_cpu": st["defender_cpu"].as_u64(),
                "rooms": st["rooms"].as_array().cloned().unwrap_or_default(),
                "top": st["top"].as_array().cloned().unwrap_or_default(),
                "breach": Breach::of(st).json(),
                "last": st["actions"].as_array().and_then(|a| a.last()).cloned(),
            })
        })
        .collect();
    let temp_qa = idle::read_json(&machine_file(home)).map(|m| m["temp_qa"].clone()).filter(Value::is_object);
    let tight = idle::read_json(&machine_file(home)).and_then(|m| m["cap_tight"].as_bool()).unwrap_or(false);
    let cpus = logical_cpus();
    let cap = auto::guard_cap(home);
    let cap_n = cap.map(|c| cap_mask(c, cpus, tight).count_ones());
    json!({ "pct": pct, "cpu_pct": pct.and(auto::guard_cpu(home)), "eco": auto::guard_eco(home), "cap": cap, "cap_n": cap_n, "cpus": cpus.min(64), "cap_tight": tight, "projects": projects, "temp_qa": temp_qa })
}

/// The text lines of a `guard` status object.
pub(super) fn lines(g: &Value) -> Vec<String> {
    let Some(pct) = g["pct"].as_u64() else {
        return vec![format!("máy: tự dọn TẮT (bật: `8sync ccc auto guard {DEFAULT_PCT}`)")];
    };
    let eco = if g["eco"].as_bool() == Some(false) { "TẮT" } else { "BẬT" };
    let cap = match g["cap"].as_u64().and_then(|c| u32::try_from(c).ok()) {
        Some(c) => cap_text(c, g["cpus"].as_u64().unwrap_or(1) as usize, g["cap_tight"].as_bool() == Some(true)),
        None => "CPU phòng: không giới hạn".into(),
    };
    let cpu_t = g["cpu_pct"].as_u64().unwrap_or(u64::from(DEFAULT_CPU));
    let mut out = vec![format!("máy: tự dọn khi RAM ≥ {pct}% · CPU ≥ {cpu_t}% · {cap} · tiết kiệm điện (EcoQoS) {eco} (đổi: `8sync ccc auto guard <30..95>|off|cpu <30..95>|cap <10..90>|off|eco on|off`)")];
    for p in g["projects"].as_array().into_iter().flatten() {
        let lvl = p["level"].as_u64().unwrap_or(0);
        let paused = names(&p["paused"]);
        let name = p["root"].as_str().unwrap_or_default().rsplit(['/', '\\']).next().unwrap_or_default().to_string();
        if lvl > 0 || !paused.is_empty() {
            let ram = p["ram"].as_u64().map(|r| format!(" · RAM {r}%")).unwrap_or_default() + &p["cpu"].as_u64().map(|c| format!(" · CPU {c}%")).unwrap_or_default();
            let pz = if paused.is_empty() { String::new() } else { format!(" · tạm dừng: {}", paused.join(", ")) };
            let last = p["actions"].as_array().and_then(|a| a.last()).and_then(|a| a["text"].as_str()).map(|t| format!(" · gần nhất: {t}")).unwrap_or_default();
            out.push(format!("  {name}: L{lvl} {}{ram}{pz}{last}", Level::label(lvl)));
        }
        if let Some(d) = p["defender"].as_str().filter(|_| p["defender_cpu"].as_u64().is_some_and(|c| c >= u64::from(DEFENDER_PCT))) {
            out.push(format!("  {name}: Defender ăn CPU {}% — PowerShell admin (8sync không tự chạy): {d}", p["defender_cpu"].as_u64().unwrap_or(0)));
        }
    }
    let t = &g["temp_qa"];
    if let Some(mb) = t["mb"].as_u64().filter(|mb| *mb >= 500) {
        let ge = if t["partial"].as_bool() == Some(true) { "≥ " } else { "" };
        out.push(format!("  %TEMP%\\qa-card-*, qa-fetch*: {ge}{:.1} GB / {} mục — bản sao repo của phòng QA, Defender quét liên tục; xoá tay khi xong", mb as f64 / 1024.0, t["dirs"].as_u64().unwrap_or(0)));
    }
    out
}

// ── the pass ────────────────────────────────────────────────────────────────────────────────

/// A team room live in the background: (name, session id, claude.exe pid, mid-turn).
#[derive(Debug, Clone, PartialEq)]
pub(super) struct LiveRoom {
    pub name: String,
    pub sid: String,
    pub pid: u32,
    pub busy: bool,
}

/// The registry's rooms (`registry`: name, session id) running as background sessions in
/// `claude agents --json` (`agents`). The pid comes from the listing, else from Claude Code's
/// `<pid>.json` session records (`records`: session id, pid).
pub(super) fn live_rooms(agents: &str, registry: &[(String, String)], records: &[(String, u32)]) -> Vec<LiveRoom> {
    let v: Value = serde_json::from_str(agents.trim()).unwrap_or(Value::Null);
    v.as_array()
        .into_iter()
        .flatten()
        .filter(|a| a["kind"].as_str() == Some("background"))
        .filter_map(|a| {
            let sid = a["sessionId"].as_str()?;
            let (name, _) = registry.iter().find(|(_, id)| id == sid)?;
            let pid = a["pid"].as_u64().and_then(|p| u32::try_from(p).ok()).or_else(|| records.iter().find(|(s, _)| s == sid).map(|(_, p)| *p))?;
            Some(LiveRoom { name: name.clone(), sid: sid.to_string(), pid, busy: a["status"].as_str() != Some("idle") })
        })
        .collect()
}

/// (session id, pid) of Claude Code's live-session records (`<pid>.json`; never the `.key` files).
fn records(home: &Path) -> Vec<(String, u32)> {
    std::fs::read_dir(claude_dir(home).join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            (p.extension()? == "json").then_some(())?;
            let v: Value = serde_json::from_str(&std::fs::read_to_string(&p).ok()?).ok()?;
            let pid = v["pid"].as_u64().and_then(|x| u32::try_from(x).ok()).or_else(|| p.file_stem()?.to_str()?.parse().ok())?;
            Some((v["sessionId"].as_str()?.to_string(), pid))
        })
        .collect()
}

/// Whole-machine CPU share (%) of `cpu` 100-ns units used over `ms` milliseconds on `cores` threads.
fn cpu_share(delta_100ns: u64, ms: u64, cores: usize) -> u32 {
    if ms == 0 || cores == 0 {
        return 0;
    }
    (delta_100ns as f64 / (ms as f64 * 1e4 * cores as f64) * 100.0).round() as u32
}

fn row(role: &str, state: String) -> Row {
    Row { name: "máy".into(), role: role.into(), model: String::new(), state, short: String::new() }
}

/// CPU share in 0.1 % of the machine (the unit [`keep_count`] and [`room_fits`] take for CPU).
fn cpu_permille(delta_100ns: u64, ms: u64, cores: usize) -> u64 {
    if ms == 0 || cores == 0 {
        return 0;
    }
    (delta_100ns as f64 / (ms as f64 * 1e4 * cores as f64) * 1000.0).round() as u64
}

/// Pids holding GPU memory (`nvidia-smi --query-compute-apps`): a VRAM breach is the rooms' only
/// when one of their processes is listed. Empty without nvidia-smi.
fn vram_pids() -> Vec<u32> {
    let mut cmd = std::process::Command::new("nvidia-smi");
    cmd.args(["--query-compute-apps=pid", "--format=csv,noheader,nounits"]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = crate::verbs::hq_core::agents::run_bounded(cmd, std::time::Duration::from_secs(5)).unwrap_or_default();
    String::from_utf8_lossy(&out).lines().filter_map(|l| l.trim().parse().ok()).collect()
}

/// The guard's pass for `root` (see the module doc), from `auto revive` (`min_gap` [`TICK_S`])
/// or `auto guard now` ([`NOW_GAP_S`]). `registry`: the project's rooms (name, session id);
/// `gated`: auto rests (lease, usage window): rooms are paused but never restarted or resumed.
/// `listing`: this run's process listing, shared with the reaper. Nothing while the guard is off,
/// auto does not run here, or the last pass was under `min_gap` ago. L2's rooms are left in the
/// state for `revive` to restart lean ([`restarts`]). Also whether the pass acted: killed,
/// asked a restart, paused, resumed or changed level (HQ backs off its trigger when not).
#[allow(clippy::too_many_arguments)]
pub(super) fn tick(home: &Path, root: &Path, claude: &dyn Claude, registry: &[(String, String)], gated: bool, now: u64, min_gap: u64, listing: &reap::Listing) -> (Vec<Row>, bool) {
    let mut acted = false;
    let rows = pass(home, root, claude, registry, gated, now, min_gap, listing, &mut acted);
    (rows, acted)
}

#[allow(clippy::too_many_arguments)]
fn pass(home: &Path, root: &Path, claude: &dyn Claude, registry: &[(String, String)], gated: bool, now: u64, min_gap: u64, listing: &reap::Listing, acted: &mut bool) -> Vec<Row> {
    let Some(pct) = auto::guard_pct(home) else { return Vec::new() };
    let lim = Limits { ram: pct, cpu: auto::guard_cpu(home).unwrap_or(DEFAULT_CPU) };
    let cpu_t = lim.cpu;
    if !auto::running(home) || !auto::in_scope(home, Some(&root.to_string_lossy())) {
        return Vec::new();
    }
    let mut all = load(home);
    let k = key(root);
    let mut st = all.get(&k).filter(|v| v.is_object()).cloned().unwrap_or_else(|| json!({}));
    let since = st["at"].as_u64().map(|a| now.saturating_sub(a));
    if since.is_some_and(|s| s < min_gap) {
        return Vec::new();
    }
    let fresh = since.is_some_and(|s| s <= STALE_S);
    let Some(sample) = crate::verbs::hq_core::sampler::Sampler::new().map(|s| s.get(std::time::Duration::ZERO)) else { return Vec::new() };
    let Some(ram) = reap::ram_pct(sample.mem) else { return Vec::new() };
    let vram = sample.gpus.iter().flatten().filter(|g| g.mem_total > 0).map(|g| (g.mem_used * 100 / g.mem_total) as u32).max();
    let procs = listing.procs();
    // CPU over the time between this listing and the last pass's (both stamped when taken), not
    // between the passes' starts: a short `guard now` gap or a slow listing would skew it.
    let (ms, sys_cpu) = if fresh { window(&st, listing.stamp(), since.unwrap_or(0) * 1000) } else { (0, None) };
    let deltas = if fresh { cpu_deltas(&procs, &st["procs"]) } else { Vec::new() };
    let cpu = sys_cpu.or_else(|| tick_cpu(&deltas, &procs, ms, sample.cores)).or(sample.cpu_pct);
    let breach = Breach::of(&st).next(ram, cpu, lim, since, now);
    let mut rows = Vec::new();
    let mut said: Vec<String> = Vec::new();
    let cpu_s = cpu.map_or("?".into(), |c| format!("{c}%"));

    let live = claude
        .run(&["agents".into(), "--json".into(), "--cwd".into(), root.to_string_lossy().into_owned()])
        .map(|j| live_rooms(&j, registry, &records(home)))
        .unwrap_or_default();
    let room_pids: Vec<u32> = live.iter().map(|r| r.pid).collect();
    let pairs: Vec<(String, u32)> = live.iter().map(|r| (r.name.clone(), r.pid)).collect();
    let trees: Vec<(String, Vec<u32>)> = live.iter().filter(|r| procs.iter().any(|p| p.pid == r.pid)).map(|r| (r.name.clone(), reap::tree_of(&procs, r.pid, &|_| true))).collect();
    // A full GPU escalates only when the rooms hold GPU memory; otherwise (the owner's game or
    // model) at most the rooms' builds drop to idle priority.
    let vram_hot = vram.is_some_and(|v| v >= VRAM_HOT);
    let vram_rooms = vram_hot && {
        let mine = in_rooms(&trees);
        vram_pids().iter().any(|p| mine.contains(p))
    };
    let lvl = level(ram, vram.filter(|_| vram_rooms), cpu, lim, &breach, now);
    if lvl.n() != st["level"].as_u64().unwrap_or(0) {
        *acted = true;
    }
    // MCP servers and headless browsers seen inside a room: L1 knows them as this project's once
    // their room is gone.
    let mut owned = remember_owned(&procs, &owned_of(&st), &in_rooms(&trees));
    // Each room's RAM (MiB) and CPU (0.1 %) this tick, heaviest first.
    let mut stats: Vec<(String, u64, Option<u64>)> = trees
        .iter()
        .map(|(name, t)| {
            let mb = procs.iter().filter(|p| t.contains(&p.pid)).map(|p| p.rss).sum::<u64>() / MIB;
            let d: u64 = deltas.iter().filter(|(pid, _)| t.contains(pid)).map(|(_, d)| d).sum();
            (name.clone(), mb, fresh.then(|| cpu_permille(d, ms, sample.cores)))
        })
        .collect();
    stats.sort_by(|a, b| b.1.cmp(&a.1));

    // Every tick: the rooms' processes yield to the owner's own apps and, in eco mode, run in
    // Efficiency mode (lower clocks, less power). Only what is not there yet changes.
    // On a breach, before anything else, the rooms' build/test processes drop to idle priority;
    // calm again, they go back to below normal.
    let low = to_lower(&procs, &trees);
    let n = if low.is_empty() { 0 } else { lower(&low, false) };
    // Builds drop to idle on a CPU breach (or a full GPU), never for RAM alone.
    let (idle_now, back) = if breach.cpu.is_some() || vram_hot { (to_idle(&procs, &trees), Vec::new()) } else { (Vec::new(), to_restore(&procs, &trees)) };
    let i = if idle_now.is_empty() { 0 } else { lower(&idle_now, true) };
    let b = if back.is_empty() { 0 } else { lower(&back, false) };
    let eco_on = auto::guard_eco(home);
    let e = eco(&in_rooms(&trees), eco_on);
    if n > 0 || e > 0 || i > 0 || b > 0 {
        let mut parts = Vec::new();
        if n > 0 {
            parts.push(format!("hạ {n} tiến trình của phòng xuống dưới bình thường"));
        }
        if i > 0 {
            parts.push(format!("{i} tiến trình build/test của phòng xuống mức nhàn rỗi (idle) ngay"));
        }
        if b > 0 {
            parts.push(format!("{b} tiến trình về lại dưới bình thường (hết quá tải)"));
        }
        if e > 0 {
            parts.push(if eco_on { format!("{e} vào chế độ tiết kiệm điện (EcoQoS)") } else { format!("{e} ra khỏi EcoQoS (eco tắt)") });
        }
        rows.push(row("ưu tiên", parts.join(" · ")));
        if i > 0 {
            log(&mut st, now, &format!("RAM {ram}% CPU {}: {i} tiến trình build/test của phòng xuống idle", cpu.map_or("?".into(), |c| format!("{c}%"))));
        }
    }

    // CPU cap: the daemon and the rooms' trees on the cap's CPUs, fewer while CPU is over the
    // threshold (machine-wide state: the daemon is shared by every project).
    if let Some(cap) = auto::guard_cap(home) {
        let mfile = machine_file(home);
        let mut m = idle::read_json(&mfile).filter(Value::is_object).unwrap_or_else(|| json!({}));
        let was = m["cap_tight"].as_bool().unwrap_or(false);
        let tight = cap_tight(was, cpu, cpu_t);
        if tight != was {
            m["cap_tight"] = json!(tight);
            idle::write_json(&mfile, &m);
            *acted = true;
            let text = if tight { format!("CPU {cpu_s} ≥ ngưỡng CPU {cpu_t}%: siết {}", cap_text(cap, logical_cpus(), true)) } else { format!("CPU {cpu_s} đã dịu: nới về {}", cap_text(cap, logical_cpus(), false)) };
            rows.push(row("CPU cap", text.clone()));
            log(&mut st, now, &text);
        }
        let k = enforce(home, &procs, &trees, tight).unwrap_or(0);
        if k > 0 {
            rows.push(row("CPU cap", format!("ghim {k} tiến trình (daemon + cây phòng) · {}", cap_text(cap, logical_cpus(), tight))));
        }
    }

    // Defender scanning the worktrees: its share is shown, the exclusion only suggested, never run.
    if procs.iter().any(|p| p.name == "msmpeng.exe") {
        let cmd = format!("Add-MpPreference -ExclusionPath '{}'", root.join(".claude").join("worktrees").display());
        let share = fresh.then(|| cpu_share(deltas.iter().filter(|(pid, _)| procs.iter().any(|p| p.pid == *pid && p.name == "msmpeng.exe")).map(|(_, d)| d).sum(), ms, sample.cores));
        st["defender"] = json!(cmd);
        st["defender_cpu"] = json!(share);
        if let Some(share) = share.filter(|s| *s >= DEFENDER_PCT) {
            if st["defender_at"].as_u64().is_none_or(|at| now.saturating_sub(at) >= DEFENDER_EVERY_S) {
                st["defender_at"] = json!(now);
                rows.push(row("Defender", format!("MsMpEng ăn CPU {share}% (quét node_modules của worktree) — PowerShell admin, 8sync không tự chạy: {cmd}")));
                log(&mut st, now, &format!("Defender ăn CPU {share}%: gợi ý loại trừ worktree"));
            }
        }
    }

    // A high-RAM spell ends under L2: its restarts are forgotten (a room may be restarted again in
    // the next spell) and nothing stays asked.
    let mut restarted = st["restarted"].as_object().cloned().unwrap_or_default();
    if lvl < Level::Restart {
        restarted.clear();
        st["restart"] = json!([]);
    }
    let mut killed: Vec<u32> = Vec::new();
    let mut loads = Vec::new();
    if lvl >= Level::Clean {
        rows.push(row(&format!("L{}", lvl.n()), format!("{} · CPU cả tick {cpu_s} · ngưỡng RAM {pct}% · CPU {cpu_t}%: {}", reap::machine_line(&sample), Level::label(lvl.n()))));
        let top = cpu_top(&procs, &deltas, &trees, ms, sample.cores);
        if !top.is_empty() {
            rows.push(row("CPU", format!("ăn CPU nhất trong tick: {}", top.join(", "))));
        }
        let cards = target::list(home, root).unwrap_or_default();
        let closed = |dir: &str| {
            let low = dir.to_ascii_lowercase();
            let id = low.find("card-").and_then(|i| low[i + 5..].split(|c: char| !c.is_ascii_digit()).next()?.parse::<u64>().ok());
            id.is_some_and(|id| cards.iter().any(|t| t.id == id && t.state != "open"))
        };
        let picks = l1_pick(&procs, root, now, std::process::id(), &room_pids, &owned, &|p| p.exists(), &closed);
        let mut freed = 0u64;
        let mut n = 0;
        for pk in &picks {
            let Some(p) = procs.iter().find(|p| p.pid == pk.pid) else { continue };
            let rss: u64 = procs.iter().filter(|q| pk.tree.contains(&q.pid)).map(|q| q.rss).sum();
            let desc = describe(p, rss, now);
            let ok = reap::kill(&pk.tree).first().copied().unwrap_or(false);
            if ok {
                killed.extend(&pk.tree);
                listing.killed(&pk.tree);
                freed += rss;
                n += 1;
            }
            rows.push(row("dọn", if ok { format!("dọn {desc}") } else { format!("không dọn được {desc}") }));
        }
        if n > 0 {
            *acted = true;
            log(&mut st, now, &format!("L1 RAM {ram}% CPU {cpu_s}: dọn {n} tiến trình bỏ lại ({} MB)", freed / MIB));
        }
        // Scratch rooms left in their `<room>-scratch` dirs: an hour untouched anywhere inside,
        // named by no process, its room not mid-turn (blocked in `auto wait` is not working).
        let working = |room: &str| live.iter().any(|r| r.name.eq_ignore_ascii_case(room) && r.busy && !still_waiting(&procs, r.pid));
        let stale = stale_scratch(root, &procs, now, &working, &|p| newest_mtime(p, SCRATCH_WALK));
        let gone = stale.iter().filter(|p| remove_entry(p)).count();
        if !stale.is_empty() {
            *acted |= gone > 0;
            let text = format!("xoá {gone}/{} mục scratch cũ của phòng (> 60 phút, không tiến trình nào dùng)", stale.len());
            rows.push(row("dọn", text.clone()));
            log(&mut st, now, &text);
        }
        let left: Vec<Proc> = procs.iter().filter(|p| !killed.contains(&p.pid)).cloned().collect();
        loads = attribute(&left, &pairs, now);

        // L2 before the room messages: a room picked for a restart is not messaged this tick (the
        // message would start a turn the stop cuts, or wait in an inbox the resumed id never reads).
        let mut pick = Vec::new();
        if lvl >= Level::Restart && !gated {
            let busy = |n: &str| live.iter().any(|r| r.name == n && r.busy);
            let pending = |n: &str| live.iter().any(|r| r.name == n && super::team::pending_inbox(home, &r.sid));
            let floor = &st["restart_floor"];
            pick = restart_pick(&loads, &busy, &pending, &Value::Object(restarted.clone()), floor, now);
            let asked: Vec<&Load> = pick.iter().filter_map(|n| loads.iter().find(|l| &l.name == n)).collect();
            st["restart"] = Value::from(asked.iter().map(|l| json!({ "name": l.name, "waiting": l.waiting, "pid": l.pid })).collect::<Vec<_>>());
            if !asked.is_empty() {
                *acted = true;
                let heavy: Vec<String> = asked.iter().map(|l| format!("{} ({} MB)", l.name, l.total / MIB)).collect();
                let text = format!("L2 RAM {ram}% (ngưỡng {pct}%): khởi động lại gọn nhẹ (tắt LSP + MCP index, cùng hội thoại) {}", heavy.join(", "));
                rows.push(row("L2", text.clone()));
                log(&mut st, now, &text);
                said.push(text);
            }
        }

        let mut warned = st["warned"].as_object().cloned().unwrap_or_default();
        let now_ms = now * 1000;
        for l in loads.iter().filter(|l| l.held >= HELD && !l.items.is_empty() && !pick.contains(&l.name)) {
            if warned.get(&l.name).and_then(Value::as_u64).is_some_and(|at| now.saturating_sub(at) < WARN_EVERY_S) {
                continue;
            }
            let Some(r) = live.iter().find(|r| r.name == l.name) else { continue };
            let sent = super::msg::deliver(home, root, ("máy", "máy", None), (&r.sid, &r.name), &held_text(ram, l), now_ms).is_ok();
            warned.insert(l.name.clone(), json!(now));
            rows.push(row("nhắc dọn", format!("{} giữ {} MB ngoài claude.exe{}", l.name, l.held / MIB, if sent { ": đã nhắn phòng" } else { " (không nhắn được)" })));
        }
        st["warned"] = Value::Object(warned);
    }
    st["restarted"] = Value::Object(restarted);

    // A paused room comes back once one more room (at the rooms' average) has fit under the
    // threshold for CALM_S. The average is remembered for when every room is down.
    let avg = |xs: Vec<u64>, key: &str, st: &mut Value| -> u64 {
        if xs.is_empty() {
            return st[key].as_u64().unwrap_or(0);
        }
        let a = xs.iter().sum::<u64>() / xs.len() as u64;
        st[key] = json!(a);
        a
    };
    let avg_mb = avg(stats.iter().map(|s| s.1).collect(), "room_mb", &mut st);
    let avg_cpu = avg(stats.iter().filter_map(|s| s.2).collect(), "room_cpu", &mut st);
    let fits = sample.mem.is_some_and(|(total, used)| room_fits(used, avg_mb, total * u64::from(pct) / 100, total * RESUME_MARGIN / 100))
        && cpu.is_none_or(|c| room_fits(u64::from(c) * 10, avg_cpu, u64::from(cpu_t) * 10, RESUME_MARGIN * 10));
    if fits {
        if st["calm_since"].as_u64().is_none() {
            st["calm_since"] = json!(now);
        }
    } else {
        st["calm_since"] = Value::Null;
    }
    let mut paused = names(&st["paused"]);
    if lvl == Level::Shrink {
        if loads.is_empty() {
            loads = attribute(&procs, &pairs, now);
        }
        let names_live: Vec<String> = loads.iter().map(|l| l.name.clone()).collect();
        let n_live = names_live.len();
        let core = names_live.iter().filter(|n| kept(n)).count();
        // RAM: rooms at their measured MiB; CPU: at their share of the tick (0.1 %).
        let keep_ram = match sample.mem.filter(|_| ram >= pct + 15) {
            Some((total, used)) => keep_count(&loads.iter().map(|l| l.total / MIB).collect::<Vec<_>>(), used, total * u64::from(pct) / 100, core),
            None => n_live,
        };
        let keep_cpu = match cpu.filter(|_| breach.cpu_shrink(now) && ms > 0) {
            Some(c) => {
                let share = |name: &str| stats.iter().find(|s| s.0 == name).and_then(|s| s.2).unwrap_or(0);
                keep_count(&names_live.iter().map(|n| share(n)).collect::<Vec<_>>(), u64::from(c) * 10, u64::from(cpu_t) * 10, core)
            }
            None => n_live,
        };
        let keep = keep_ram.min(keep_cpu);
        let mut gone = Vec::new();
        for n in to_pause(&names_live, keep) {
            let Some(r) = live.iter().find(|r| r.name == n) else { continue };
            if claude.run(&["stop".into(), r.sid.chars().take(8).collect()]).is_err() {
                rows.push(row("L3", format!("không dừng được {n}")));
                continue;
            }
            let cards = target::release(home, root, &[n.as_str()], "tạm dừng (máy quá tải)", now).unwrap_or_default();
            let back = if cards.is_empty() { String::new() } else { format!(" · trả card {}", cards.iter().map(|(id, _, _)| format!("#{id}")).collect::<Vec<_>>().join(", ")) };
            gone.push(format!("{n}{back}"));
            if !paused.contains(&n) {
                paused.push(n);
            }
        }
        if !gone.is_empty() {
            *acted = true;
            let text = format!("L3 RAM {ram}% CPU {cpu_s} (ngưỡng RAM {pct}% · CPU {cpu_t}%): vừa đủ {keep}/{n_live} phòng, tạm dừng {}; mở lại từng phòng khi đủ chỗ thêm 1 phòng dưới ngưỡng suốt 10 phút", gone.join(", "));
            rows.push(row("L3", text.clone()));
            log(&mut st, now, &text);
            said.push(text);
        }
    } else if !gated {
        if let Some(n) = resume_pick(&paused, st["calm_since"].as_u64(), now) {
            paused.retain(|p| *p != n);
            *acted = true;
            // The next room waits its own 10 minutes with this one running.
            st["calm_since"] = Value::Null;
            let text = format!("RAM {ram}% CPU {cpu_s}: đủ chỗ thêm 1 phòng dưới ngưỡng (RAM {pct}% · CPU {cpu_t}%) suốt 10 phút: mở lại phòng {n}");
            rows.push(row("mở lại", text.clone()));
            log(&mut st, now, &text);
        }
    }
    st["paused"] = json!(paused);

    // The lead hears about restarts and pauses (what and why, numbers).
    if !said.is_empty() {
        if let Some((lead, sid)) = registry.iter().find(|(n, _)| room::find(n).is_some_and(|r| r.name == "Lead/PM")) {
            let _ = super::msg::deliver(home, root, ("máy", "máy", None), (sid, lead), &said.join(" · "), now * 1000);
        }
    }
    owned.retain(|(pid, _)| !killed.contains(pid));
    st["owned"] = Value::from(owned.iter().map(|(pid, s)| json!([pid, s])).collect::<Vec<_>>());
    st["at"] = json!(now);
    st["level"] = json!(lvl.n());
    st["ram"] = json!(ram);
    st["cpu"] = json!(cpu);
    st["breach"] = breach.json();
    if let Some(o) = st.as_object_mut() {
        o.remove("cpu_hot");
        o.remove("cpu_max");
    }
    st["procs"] = cpu_snapshot(&procs);
    let stamp = listing.stamp();
    st["procs_ms"] = json!(stamp.ms);
    st["sys"] = json!(stamp.sys.map(|(i, t)| [i, t]));
    // `%TEMP%` QA copies (machine-wide, shown in HQ, never deleted): measured at most every 30 min.
    let mfile = machine_file(home);
    let mut m = idle::read_json(&mfile).filter(Value::is_object).unwrap_or_else(|| json!({}));
    if m["temp_qa"]["at"].as_u64().is_none_or(|at| now.saturating_sub(at) >= TEMP_QA_EVERY_S) {
        let mut t = temp_qa(&std::env::temp_dir(), std::time::Duration::from_secs(2));
        t["at"] = json!(now);
        m["temp_qa"] = t;
        idle::write_json(&mfile, &m);
    }
    // What HQ shows: each room's RAM and CPU (%) of the tick, heaviest first, and the machine's top CPU users.
    st["rooms"] = Value::from(stats.iter().map(|(name, mb, c)| json!({ "name": name, "mb": mb, "cpu": c.map(|c| (c + 5) / 10) })).collect::<Vec<_>>());
    st["top"] = json!(cpu_top(&procs, &deltas, &trees, ms, sample.cores));
    all[&k] = st;
    idle::write_json(&file(home), &all);
    rows
}

/// The window of this pass's CPU figures: ms between the last pass's listing and this one's
/// (`now`, both stamped when taken; `fallback_ms` for a state from before stamps), and the
/// machine's CPU over it from the system times stored with each.
fn window(st: &Value, now: reap::Stamp, fallback_ms: u64) -> (u64, Option<u32>) {
    let ms = st["procs_ms"].as_u64().map_or(fallback_ms, |at| now.ms.saturating_sub(at));
    let prev = st["sys"].as_array().and_then(|a| Some((a.first()?.as_u64()?, a.get(1)?.as_u64()?)));
    (ms, machine_cpu(prev, now.sys))
}

/// `8sync ccc auto guard --dry-run`: what a pass would see right now for `root`, read-only (no
/// kill, no priority change, no message, no state): the machine, CPU over 5 s and its top users,
/// the L1 picks, the room processes still at normal priority and each live room's load.
pub(super) fn dry_run(home: &Path, root: &Path, claude: &dyn Claude, registry: &[(String, String)], now: u64) -> Vec<String> {
    let pct = auto::guard_pct(home);
    let lim = pct.map(|p| Limits { ram: p, cpu: auto::guard_cpu(home).unwrap_or(DEFAULT_CPU) });
    let mut out = Vec::new();
    let sample = crate::verbs::hq_core::sampler::Sampler::new().map(|s| s.get(std::time::Duration::ZERO));
    let ram = sample.as_ref().and_then(|s| reap::ram_pct(s.mem));
    let cores = sample.as_ref().map_or(1, |s| s.cores);
    let first = reap::Listing::new(now);
    let before = cpu_snapshot(&first.procs());
    let s0 = first.stamp();
    std::thread::sleep(std::time::Duration::from_secs(5));
    let second = reap::Listing::new(now);
    let procs = second.procs();
    let s1 = second.stamp();
    let ms = s1.ms.saturating_sub(s0.ms);
    let deltas = cpu_deltas(&procs, &before);
    let cpu = machine_cpu(s0.sys, s1.sys).or_else(|| tick_cpu(&deltas, &procs, ms, cores));
    out.push(format!(
        "máy: {} · CPU {:.1} s {} · ngưỡng {} · mức nếu chạy bây giờ: L{}",
        sample.as_ref().map(reap::machine_line).unwrap_or_default(),
        ms as f64 / 1000.0,
        cpu.map_or("?".into(), |c| format!("{c}%")),
        lim.map_or("TẮT".into(), |l| format!("RAM ≥ {}% · CPU ≥ {}%", l.ram, l.cpu)),
        lim.zip(ram).map_or(0, |(l, r)| level(r, None, cpu, l, &Breach::default(), now).n())
    ));
    let live = claude
        .run(&["agents".into(), "--json".into(), "--cwd".into(), root.to_string_lossy().into_owned()])
        .map(|j| live_rooms(&j, registry, &records(home)))
        .unwrap_or_default();
    let trees: Vec<(String, Vec<u32>)> = live.iter().filter(|r| procs.iter().any(|p| p.pid == r.pid)).map(|r| (r.name.clone(), reap::tree_of(&procs, r.pid, &|_| true))).collect();
    out.push(format!("ăn CPU nhất {:.1} s: {}", ms as f64 / 1000.0, cpu_top(&procs, &deltas, &trees, ms, cores).join(", ")));
    out.push(format!("sẽ hạ ưu tiên {} tiến trình của phòng còn ở mức bình thường", to_lower(&procs, &trees).len()));
    match auto::guard_cap(home).filter(|_| pct.is_some()) {
        Some(cap) => {
            let tight = tight_now(home);
            let mask = cap_mask(cap, logical_cpus(), tight);
            let targets = cap_targets(&procs, &trees);
            let k = to_pin(&targets, mask, &affinity_of).len();
            out.push(format!("{} · mask {mask:#x} · sẽ ghim {k}/{} tiến trình (daemon + cây phòng)", cap_text(cap, logical_cpus(), tight), targets.len()));
        }
        None => out.push("CPU phòng: không giới hạn (bật: `8sync ccc auto guard cap 37`)".into()),
    }
    let cards = target::list(home, root).unwrap_or_default();
    let closed = |dir: &str| {
        let low = dir.to_ascii_lowercase();
        let id = low.find("card-").and_then(|i| low[i + 5..].split(|c: char| !c.is_ascii_digit()).next()?.parse::<u64>().ok());
        id.is_some_and(|id| cards.iter().any(|t| t.id == id && t.state != "open"))
    };
    let pids: Vec<u32> = live.iter().map(|r| r.pid).collect();
    let owned = owned_of(&load(home)[key(root)]);
    let picks = l1_pick(&procs, root, now, std::process::id(), &pids, &owned, &|p| p.exists(), &closed);
    out.push(format!("L1 sẽ dọn {} tiến trình ({} tiến trình trên máy):", picks.len(), procs.len()));
    for pk in &picks {
        if let Some(p) = procs.iter().find(|p| p.pid == pk.pid) {
            let rss: u64 = procs.iter().filter(|q| pk.tree.contains(&q.pid)).map(|q| q.rss).sum();
            out.push(format!("  {} · cây {:?}", describe(p, rss, now), pk.tree));
        }
    }
    let pairs: Vec<(String, u32)> = live.iter().map(|r| (r.name.clone(), r.pid)).collect();
    let loads = attribute(&procs, &pairs, now);
    out.push(format!("phòng nền đang chạy: {}", loads.len()));
    for l in &loads {
        let busy = live.iter().any(|r| r.name == l.name && r.busy);
        out.push(format!(
            "  {} claude pid {} · cả cây {} MB · ngoài claude {} MB · {}{}",
            l.name,
            l.pid,
            l.total / MIB,
            l.held / MIB,
            if l.waiting { "chờ card" } else if busy { "đang làm" } else { "rảnh" },
            if l.items.is_empty() { String::new() } else { format!(" · {}", l.items.join(", ")) }
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_000_000;
    const MB: u64 = MIB;

    fn p(pid: u32, ppid: u32, age_min: u64, name: &str, cmd: &str, mb: u64) -> Proc {
        let image = name.trim_end_matches(".exe").to_string();
        Proc { pid, ppid, started: NOW - age_min * 60, rss: mb * MB, node: name == "node.exe", shell: matches!(name, "bash.exe" | "cmd.exe"), image, cmd: cmd.into(), name: name.into(), cpu: 0, normal: false, idle: false }
    }

    #[test]
    fn breaches_act_at_once_and_escalate_on_time_held() {
        let t = Limits { ram: 60, cpu: 60 };
        let none = Breach::default();
        assert_eq!(level(59, None, Some(50), t, &none, NOW), Level::Calm);
        assert_eq!(level(60, None, None, t, &none, NOW), Level::Clean, "RAM at the threshold: L1 at once");
        assert_eq!(level(50, None, Some(97), t, &none, NOW), Level::Clean, "CPU high once: L1 at once, no second tick");
        assert_eq!(level(50, Some(92), None, t, &none, NOW), Level::Clean, "VRAM full");
        assert_eq!(level(75, None, None, t, &none, NOW), Level::Restart, "15 over: L2 at once");
        // HQ's `guard now` every ~20 s at CPU 97%: L1, L1, L1, then L3 once 45 s have held.
        let mut b = none;
        let mut seen = Vec::new();
        for (i, at) in [NOW, NOW + 20, NOW + 40, NOW + 60].into_iter().enumerate() {
            b = b.next(50, Some(97), t, (i > 0).then_some(20), at);
            seen.push(level(50, None, Some(97), t, &b, at));
        }
        assert_eq!(seen, [Level::Clean, Level::Clean, Level::Clean, Level::Shrink]);
        assert_eq!(b.cpu_max, Some(NOW), "the run started at the first breach");
        // Revive alone (every 120 s): the second high pass is 120 s in → L3.
        let b1 = none.next(50, Some(95), t, None, NOW);
        let b2 = b1.next(50, Some(95), t, Some(120), NOW + 120);
        assert_eq!((level(50, None, Some(95), t, &b1, NOW), level(50, None, Some(95), t, &b2, NOW + 120)), (Level::Clean, Level::Shrink));
        // A gap over CONTINUOUS_S (HQ closed) or a low pass breaks the run.
        assert_eq!(b1.next(50, Some(95), t, Some(CONTINUOUS_S + 1), NOW + 400).cpu_max, Some(NOW + 400));
        assert_eq!(b1.next(50, Some(40), t, Some(20), NOW + 20), none);
        // RAM: over the threshold 30 s → L2; 15 over for 60 s → L3.
        let r1 = none.next(64, None, t, None, NOW);
        assert_eq!(level(64, None, None, t, &r1, NOW), Level::Clean);
        let r2 = r1.next(64, None, t, Some(30), NOW + 30);
        assert_eq!(level(64, None, None, t, &r2, NOW + 30), Level::Restart, "L1 did not bring it down");
        let h1 = none.next(76, None, t, None, NOW);
        let h2 = h1.next(76, None, t, Some(40), NOW + 40);
        let h3 = h2.next(76, None, t, Some(20), NOW + 60);
        assert_eq!((level(76, None, None, t, &h2, NOW + 40), level(76, None, None, t, &h3, NOW + 60)), (Level::Restart, Level::Shrink));
        // Back under: calm at once; the state round-trips.
        assert_eq!(level(58, None, Some(30), t, &h3.next(58, Some(30), t, Some(20), NOW + 80), NOW + 80), Level::Calm);
        assert_eq!(Breach::of(&json!({ "breach": h3.json() })), h3);
    }

    #[test]
    fn cpu_is_averaged_over_the_tick_and_blamed_on_rooms() {
        let s = 10_000_000u64; // one CPU-second
        let mut idle = p(0, 0, 900, "system idle process", "", 0);
        idle.cpu = 1000 * s;
        let mut room = p(100, 1, 60, "claude.exe", "claude --bg", 500);
        room.cpu = 10 * s;
        let mut cbm = p(101, 100, 60, "codebase-memory-mcp.exe", "codebase-memory-mcp", 50);
        cbm.cpu = 50 * s;
        let mut av = p(200, 4, 900, "msmpeng.exe", "", 600);
        av.cpu = 100 * s;
        let before = cpu_snapshot(&[idle.clone(), room.clone(), cbm.clone(), av.clone()]);
        // 100 s later on 4 threads (400 CPU-s): 240 idle → 40% busy; cbm 96 s, Defender 40 s, claude 4 s.
        idle.cpu += 240 * s;
        room.cpu += 4 * s;
        cbm.cpu += 96 * s;
        av.cpu += 40 * s;
        // a recycled pid counts from its own start
        let mut reborn = p(300, 1, 1, "node.exe", "node x.js", 10);
        reborn.cpu = 8 * s;
        let mut prev = before.clone();
        prev["300"] = json!([1, 999 * s]);
        // a pid the last snapshot did not have (started during the tick) counts from 0
        let mut newcomer = p(400, 1, 1, "node.exe", "node build.js", 10);
        newcomer.cpu = 5 * s;
        let procs = vec![idle, room, cbm, av, reborn, newcomer];
        let d = cpu_deltas(&procs, &prev);
        assert_eq!(d.iter().find(|(p, _)| *p == 300).map(|x| x.1), Some(8 * s));
        assert_eq!(d.iter().find(|(p, _)| *p == 400).map(|x| x.1), Some(5 * s));
        assert_eq!(tick_cpu(&d, &procs, 100_000, 4), Some(40));
        assert_eq!(tick_cpu(&d, &procs[1..], 100_000, 4), None, "no idle counter: none");
        let trees = vec![("dev2".to_string(), vec![100, 101])];
        assert_eq!(cpu_top(&procs, &d, &trees, 100_000, 4), ["MCP codebase-memory 24% (dev2)", "msmpeng 10% (máy)", "node 3% (máy)"]);
        // only room trees still at normal priority are lowered (idempotent: below-normal ones stay out)
        let mut norm = procs.clone();
        norm[1].normal = true;
        norm[2].normal = false;
        norm[3].normal = true;
        assert_eq!(to_lower(&norm, &trees), [100], "the owner's/system processes are never touched");
    }

    #[test]
    fn cpu_window_is_the_time_between_the_listings_not_the_nominal_gap() {
        // The last pass's listing at 1.0 s, this one's at 8.5 s: a "5 s" wait whose two listings
        // took 2.5 s more. A process that used 7.5 CPU-seconds ran one core flat out.
        let st = json!({ "procs_ms": 1_000, "sys": [1_000, 10_000] });
        let now = reap::Stamp { ms: 8_500, sys: Some((1_000 + 45_000, 10_000 + 60_000)) };
        let (ms, machine) = window(&st, now, 5_000);
        assert_eq!(ms, 7_500, "divided by 7.5 s, not 5");
        assert_eq!(cpu_share(75_000_000, ms, 1), 100);
        assert_eq!(cpu_share(75_000_000, 5_000, 1), 150, "the old skew");
        assert_eq!(cpu_permille(75_000_000, ms, 4), 250);
        assert_eq!(machine, Some(25), "machine CPU from the system times: 45 of 60 idle");
        // A state from before stamps: the pass gap; no system times: none (tick_cpu then).
        assert_eq!(window(&json!({}), now, 5_000), (5_000, None));
        assert_eq!(machine_cpu(Some((5, 10)), Some((4, 20))), None, "a counter going back says nothing");
        assert_eq!(machine_cpu(Some((5, 10)), Some((5, 10))), None);
        assert_eq!(machine_cpu(Some((0, 0)), Some((0, 100))), Some(100));
    }

    #[test]
    fn a_breach_idles_the_rooms_build_work_never_their_mcp_claude_or_8sync() {
        let procs = vec![
            // Claude Code installed from npm runs as node.exe: the room's own process.
            p(10, 1, 60, "node.exe", r"node C:\Users\A\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\cli.js --bg", 500),
            p(11, 10, 5, "node.exe", r"node C:\w\game\.claude\worktrees\card-5\node_modules\vite\bin\vite.js build", 300),
            p(12, 10, 5, "esbuild.exe", "esbuild --service=0.21", 40),
            p(13, 10, 5, "rustc.exe", "rustc --crate-name game", 900),
            p(14, 10, 60, "node.exe", r"node C:\Users\A\mcp\chrome-devtools-mcp\index.js", 90),
            p(15, 10, 60, "python.exe", "python serena start-mcp-server", 150),
            p(16, 10, 5, "8sync.exe", "8sync ccc auto wait --json --as dev", 10),
            p(17, 10, 5, "8sync.exe", "8sync ccc auto status --json", 10),
            // the owner's own build: not a room's
            p(20, 1, 5, "node.exe", r"node C:\w\game\node_modules\vite\bin\vite.js build", 300),
        ];
        let trees = vec![("dev".to_string(), vec![10, 11, 12, 13, 14, 15, 16, 17])];
        assert_eq!(to_idle(&procs, &trees), [11, 12, 13], "the room's claude (node), MCP servers and 8sync / auto wait keep their priority");
        let mut done = procs.clone();
        done[1].idle = true;
        done[2].idle = true;
        done[3].idle = true;
        assert!(to_idle(&done, &trees).is_empty(), "idempotent");
        assert_eq!(to_restore(&done, &trees), [11, 12, 13], "calm: back to below normal");
        done[8].idle = true;
        assert!(!to_restore(&done, &trees).contains(&20), "the owner's idle process is left alone");
    }

    #[test]
    fn stale_room_scratch_goes_unless_in_use_temp_qa_is_only_measured() {
        let base = std::env::temp_dir().join(format!("8sync-scratch-{}", crate::verbs::uuid_sessions::new_uuid()));
        let root = base.join("game");
        let wt = root.join(".claude").join("worktrees");
        for d in ["qa-scratch/old", "qa-scratch/new", "qa-scratch/used", "review-scratch/old2", "card-5/old"] {
            std::fs::create_dir_all(wt.join(d)).unwrap();
        }
        std::fs::write(wt.join("qa-scratch").join("old.tar"), b"x").unwrap();
        let used = wt.join("qa-scratch").join("used");
        let procs = vec![p(30, 1, 5, "node.exe", &format!("node {}/x.js", used.display()), 50)];
        let mtime = |p: &Path| Some(if p.ends_with("new") { NOW - 600 } else { NOW - SCRATCH_AGE_S });
        let idle_rooms = |_: &str| false;
        let mut got: Vec<String> = stale_scratch(&root, &procs, NOW, &idle_rooms, &mtime).iter().map(|p| p.strip_prefix(&wt).unwrap().to_string_lossy().replace('\\', "/")).collect();
        got.sort();
        assert_eq!(got, ["qa-scratch/old", "qa-scratch/old.tar", "review-scratch/old2"], "an hour untouched, named by no process; never outside *-scratch");
        // qa mid-turn (it may sit in its scratch dir): none of qa-scratch goes.
        let qa_works = |r: &str| r == "qa";
        let mid: Vec<PathBuf> = stale_scratch(&root, &procs, NOW, &qa_works, &mtime);
        assert!(mid.iter().all(|p| !p.starts_with(wt.join("qa-scratch"))) && mid.len() == 1, "{mid:?}");
        assert!(remove_entry(&wt.join("qa-scratch").join("old")) && remove_entry(&wt.join("qa-scratch").join("old.tar")));
        assert!(!wt.join("qa-scratch").join("old").exists() && wt.join("qa-scratch").join("new").exists());
        // The deep walk dates a dir by its newest file anywhere inside; a walk cut short dates nothing.
        std::fs::write(wt.join("qa-scratch").join("new").join("deep.txt"), b"x").unwrap();
        let fresh = newest_mtime(&wt.join("qa-scratch"), 100).unwrap();
        assert!(fresh + 120 >= std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs());
        assert_eq!(newest_mtime(&wt.join("qa-scratch"), 2), None);
        // %TEMP% QA copies: size and count only.
        let tmp = base.join("tmp");
        std::fs::create_dir_all(tmp.join("qa-card-7").join("node_modules")).unwrap();
        std::fs::write(tmp.join("qa-card-7").join("node_modules").join("a.bin"), vec![0u8; 2 * MIB as usize]).unwrap();
        std::fs::write(tmp.join("qa-fetch-7.tar"), vec![0u8; MIB as usize]).unwrap();
        std::fs::write(tmp.join("other.bin"), vec![0u8; MIB as usize]).unwrap();
        assert_eq!(temp_qa(&tmp, std::time::Duration::from_secs(5)), json!({ "mb": 3, "dirs": 2, "partial": false }));
        assert!(tmp.join("qa-card-7").exists(), "never deleted");
        let g = json!({ "pct": 60, "temp_qa": { "mb": 12_288, "dirs": 125, "partial": true } });
        assert!(lines(&g).iter().any(|l| l.contains("≥ 12.0 GB / 125 mục")), "{:?}", lines(&g));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn rooms_hear_once_per_quarter_hour_and_restart_once_per_spell() {
        let heavy = |name: &str, gb: u64, waiting: bool| Load { name: name.into(), pid: 1, total: gb * 1024 * MB, held: gb * 512 * MB, items: vec![], waiting };
        let loads = vec![heavy("dev", 2, false), heavy("qa", 3, false), heavy("dev2", 4, true), heavy("ui", 1, false), heavy("review", 5, false)];
        let busy = |n: &str| n == "dev2" || n == "review";
        let empty = |_: &str| false;
        // review: busy, not waiting → skipped; dev2 busy but waiting in `auto wait` → idle; ui too light.
        let none = json!({});
        assert_eq!(restart_pick(&loads, &busy, &empty, &json!({}), &none, NOW), ["dev2", "qa"]);
        assert_eq!(restart_pick(&loads, &busy, &empty, &json!({ "dev2": NOW - 7200 }), &none, NOW), ["qa", "dev"], "restarted in this spell: never again in it");
        let inbox = |n: &str| n == "dev2";
        assert_eq!(restart_pick(&loads, &busy, &inbox, &json!({}), &none, NOW), ["qa", "dev"], "a message waiting: a resume would strand it");
        // The 30-min floor holds across spells (a new spell forgets `restarted`, not the floor).
        assert_eq!(restart_pick(&loads, &busy, &empty, &json!({}), &json!({ "dev2": NOW - 600 }), NOW), ["qa", "dev"], "restarted 10 min ago in another spell");
        assert_eq!(restart_pick(&loads, &busy, &empty, &json!({}), &json!({ "dev2": NOW - RESTART_AGAIN_S }), NOW), ["dev2", "qa"]);
        let l = Load { name: "dev3".into(), pid: 9, total: 3 * 1024 * MB, held: 1536 * MB, items: vec!["vite preview :4197 pid 12 (12m, 120 MB)".into()], waiting: false };
        let t = held_text(72, &l);
        assert!(t.starts_with("[RAM 72%] phòng bạn đang giữ 1536 MB: vite preview :4197 pid 12") && t.contains("kill theo PID cây") && t.contains("chụp xong tắt preview"), "{t}");
    }

    #[test]
    fn attribution_counts_each_rooms_tree_and_names_the_top_items() {
        let procs = vec![
            p(100, 1, 300, "claude.exe", "claude --bg", 800),
            // LSP plugin: language server + tsserver child, counted as one item.
            p(101, 100, 200, "node.exe", "node typescript-language-server --stdio", 100),
            p(102, 101, 200, "node.exe", r"node C:\w\game\.claude\worktrees\card-5\node_modules\typescript\lib\tsserver.js", 900),
            // a preview started through bash: the bash is walked through.
            p(103, 100, 30, "bash.exe", "bash -c npx vite preview --port 4197", 5),
            p(104, 103, 30, "node.exe", r"node C:\w\game\.claude\worktrees\card-5\node_modules\vite\bin\vite.js preview --port 4197", 120),
            // serena MCP: uvx → python
            p(105, 100, 300, "uvx.exe", "uvx --from git+https://github.com/oraios/serena serena start-mcp-server", 8),
            p(106, 105, 300, "python.exe", "python serena start-mcp-server", 150),
            // waiting for a card
            p(107, 100, 5, "8sync.exe", "8sync ccc auto wait --json --as dev", 10),
            // another room, light
            p(200, 1, 300, "claude.exe", "claude --bg", 400),
            // the owner's terminal: not a room
            p(300, 1, 300, "node.exe", r"node C:\w\game\node_modules\vite\bin\vite.js", 500),
        ];
        let loads = attribute(&procs, &[("dev".into(), 100), ("qa".into(), 200), ("gone".into(), 999)], NOW);
        assert_eq!(loads.len(), 2, "a room whose claude.exe is gone has no tree");
        let dev = &loads[0];
        assert_eq!((dev.total / MB, dev.held / MB), (2093, 1293));
        assert!(dev.waiting);
        assert_eq!(dev.items.len(), 3);
        assert!(dev.items[0].starts_with("typescript-language-server pid 101 (3h 20m, 1000 MB)"), "{:?}", dev.items);
        assert!(dev.items[1].starts_with("MCP serena pid 105 (5h 0m, 158 MB)"), "{:?}", dev.items);
        assert!(dev.items[2].starts_with("vite preview :4197 pid 104 (30m, 120 MB)"), "{:?}", dev.items);
        assert_eq!((loads[1].held, loads[1].waiting), (0, false));
    }

    #[test]
    fn l1_takes_only_detached_leftovers_of_rooms_never_the_owners() {
        let root = PathBuf::from(r"C:\w\game");
        let wt = r"C:\w\game\.claude\worktrees";
        let tmp_chrome = r#""C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --user-data-dir=C:\Users\A\AppData\Local\Temp\playwright_chromiumdev_profile-x --remote-debugging-pipe"#;
        let wt_chrome = r#""C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --user-data-dir=C:\w\game\.claude\worktrees\card-5\.pw-profile --remote-debugging-pipe"#;
        let procs = vec![
            // HQ (me = 2) under its parent 1.
            p(1, 0, 900, "8sync.exe", "8sync hq ui", 40),
            p(2, 1, 1, "8sync.exe", "8sync ccc auto revive", 10),
            // A live room (claude 10): its LSP of an open card stays; of a closed card goes.
            p(10, 0, 300, "claude.exe", "claude --bg", 800),
            p(11, 10, 200, "node.exe", &format!(r"node {wt}\card-5\node_modules\typescript\lib\tsserver.js"), 900),
            p(12, 10, 200, "node.exe", &format!(r"node {wt}\card-3\node_modules\typescript\lib\tsserver.js"), 700),
            // Detached vite 6 min old in a worktree: goes (L1 takes from 5 min); a 3 min one stays.
            p(20, 4242, 6, "node.exe", &format!(r"node {wt}\card-5\node_modules\vite\bin\vite.js preview --port 4120"), 120),
            p(21, 4242, 3, "node.exe", &format!(r"node {wt}\card-5\node_modules\vite\bin\vite.js preview --port 4121"), 120),
            // Detached vitest watch (and its worker) goes; `vitest run` and one under a live host stay.
            p(30, 4242, 20, "node.exe", &format!(r"node {wt}\card-5\node_modules\vitest\vitest.mjs"), 300),
            p(31, 30, 20, "node.exe", &format!(r"node {wt}\card-5\node_modules\vitest\dist\workers\forks.js"), 200),
            p(32, 4242, 20, "node.exe", &format!(r"node {wt}\card-5\node_modules\vitest\vitest.mjs run"), 300),
            p(33, 10, 20, "node.exe", &format!(r"node {wt}\card-5\node_modules\vitest\vitest.mjs"), 300),
            // Headless chrome whose driver is gone: one with its profile in a room worktree goes
            // (main + renderer); a temp-profile one is anybody's (the owner's own scripts) and stays.
            // The owner's Edge (no --headless) and a headless one under a live room stay.
            p(40, 4242, 30, "chrome.exe", wt_chrome, 300),
            p(44, 4242, 30, "chrome.exe", tmp_chrome, 300),
            p(41, 40, 30, "chrome.exe", r#""chrome.exe" --type=renderer --headless=new"#, 400),
            p(42, 0, 900, "msedge.exe", r#""msedge.exe" --no-startup-window"#, 300),
            p(43, 33, 10, "chrome.exe", tmp_chrome, 300),
            // Orphaned serena (uvx → uv → python, host gone): nothing in its lines names the
            // project, so it goes only once seen inside a room (`owned`); the owner's live one stays.
            p(50, 4242, 300, "uvx.exe", "uvx --from git+https://github.com/oraios/serena serena start-mcp-server", 8),
            p(51, 50, 300, "uv.exe", "uv tool uvx --from git+https://github.com/oraios/serena serena start-mcp-server", 50),
            p(52, 51, 300, "python.exe", r"C:\cache\python.exe serena start-mcp-server", 150),
            p(60, 0, 900, "omp.exe", "omp", 500),
            p(61, 60, 300, "uvx.exe", "uvx --from git+https://github.com/oraios/serena serena start-mcp-server", 8),
            // An orphaned MCP naming this project goes; one naming another project, or one a
            // service manager runs (ppid 1, unix), stays.
            p(80, 4242, 300, "node.exe", r"node C:\Users\A\mcp\chrome-devtools-mcp\index.js --cwd C:\w\game", 90),
            p(81, 4242, 300, "node.exe", r"node C:\Users\A\mcp\chrome-devtools-mcp\index.js --cwd C:\w\other", 90),
            p(82, 1, 300, "node.exe", r"node /srv/chrome-devtools-mcp/index.js --cwd C:\w\game", 90),
            // The owner's own dev server in the repo root (detached): never.
            p(70, 4242, 300, "node.exe", r"node C:\w\game\node_modules\vite\bin\vite.js", 200),
            // A detached tsserver of the owner's editor in the root: never (not a room worktree).
            p(71, 4242, 300, "node.exe", r"node C:\w\game\node_modules\typescript\lib\tsserver.js", 600),
        ];
        let closed = |d: &str| d == "card-3";
        let picks = l1_pick(&procs, &root, NOW, 2, &[10], &[], &|_| true, &closed);
        let tops: Vec<u32> = picks.iter().map(|p| p.pid).collect();
        assert_eq!(tops, [20, 12, 30, 40, 80], "machine-wide matches that are not this project's stay");
        assert_eq!(picks[2].tree, [30, 31]);
        assert_eq!(picks[3].tree, [40, 41]);
        // serena's python seen in a room earlier (pid + start): the whole orphaned chain goes.
        let owned = [(52, NOW - 300 * 60)];
        let with = l1_pick(&procs, &root, NOW, 2, &[10], &owned, &|_| true, &closed);
        assert_eq!(with.iter().find(|p| p.pid == 50).map(|p| p.tree.clone()), Some(vec![50, 51, 52]));
        assert!(!l1_pick(&procs, &root, NOW, 2, &[10], &[(52, 1)], &|_| true, &closed).iter().any(|p| p.pid == 50), "a pid reused by another start is not ours");
        // Remembered: room-owned processes in a room tree now, and earlier ones still alive.
        let tree_pids = [10, 11, 12, 33, 43, 61];
        assert_eq!(remember_owned(&procs, &[(52, NOW - 300 * 60), (99, 5)], &tree_pids), [(52, NOW - 300 * 60), (43, NOW - 600), (61, NOW - 300 * 60)]);
        // Without the room pid the closed card's LSP (child of a live claude.exe) is not taken.
        assert!(!l1_pick(&procs, &root, NOW, 2, &[], &[], &|_| true, &closed).iter().any(|p| p.pid == 12));
        // A deleted worktree's LSP under a room goes too.
        let gone = |d: &Path| !d.to_string_lossy().contains("card-5");
        assert!(l1_pick(&procs, &root, NOW, 2, &[10], &[], &gone, &|_| false).iter().any(|p| p.pid == 11));
        // HQ's own tree is never taken, even if it matched.
        let mut hq = procs.clone();
        hq.push(p(3, 2, 30, "node.exe", &format!(r"node {wt}\card-5\node_modules\vite\bin\vite.js preview"), 120));
        hq.last_mut().unwrap().ppid = 4242;
        assert!(l1_pick(&hq, &root, NOW, 3, &[10], &[], &|_| true, &closed).iter().all(|p| p.pid != 3));
    }

    #[test]
    fn pick_rules_for_browsers_watchers_and_mcp() {
        assert!(watch("node c:/x/node_modules/vitest/vitest.mjs").is_some());
        assert!(watch("node c:/x/node_modules/.bin/vitest --reporter=dot").is_some());
        assert!(watch("node c:/x/node_modules/vitest/vitest.mjs run").is_none());
        assert!(watch("node c:/x/node_modules/vitest/dist/workers/forks.js").is_none());
        assert!(watch("node c:/x/node_modules/jest/bin/jest.js --watchall").is_some());
        assert!(watch("node c:/x/node_modules/jest/bin/jest.js").is_none());
        assert!(headless_main("chrome.exe --headless=new") && !headless_main("chrome.exe --type=gpu-process --headless"));
        assert_eq!(mcp("c:/scoop/shims/headroom.exe mcp serve"), Some("headroom"));
        assert_eq!(mcp("uvx --from git+https://github.com/oraios/serena serena start-mcp-server"), Some("serena"));
        assert_eq!(mcp("node c:/w/game/scripts/build.js"), None);
        assert!(is_browser("msedge.exe") && is_browser("chromium") && !is_browser("claude.exe"));
    }

    #[test]
    fn the_team_shrinks_in_drop_order_and_comes_back_one_room_at_a_time() {
        // 64 GB box at 90%: 13 rooms × 2 GB = 26 GB, 31.6 GB other. Budget at 60% = 39.3 GB → 7.7 GB
        // for rooms → 3 rooms of 2 GB fit.
        let totals = vec![2048u64; 13];
        assert_eq!(keep_count(&totals, 58_982, 39_321, 3), 3);
        assert_eq!(keep_count(&totals, 30_000, 39_321, 3), 13, "everything fits");
        assert_eq!(keep_count(&totals, 65_000, 19_660, 3), 3, "never under the core");
        assert_eq!(keep_count(&[], 65_000, 39_321, 0), 0);
        // CPU (0.1 %): 13 rooms at 6% each = 78% of a 95% machine, threshold 60% → 17% other, 43% for
        // rooms → 7 rooms.
        assert_eq!(keep_count(&[60; 13], 950, 600, 3), 7);
        // The owner's own load alone is over the budget (50 GB of 64, rooms 13 × 100 MB): the rooms
        // give up only their share of the overshoot (4 rooms), not everything down to the core (3).
        assert_eq!(keep_count(&[100; 13], 51_300, 39_321, 3), 9);
        assert_eq!(keep_count(&[10; 13], 950, 600, 3), 8, "CPU: the owner's build, rooms nearly idle");
        let live: Vec<String> = room::BOOST_TEAM.iter().map(|s| s.to_string()).collect();
        let p = to_pause(&live, 3);
        assert_eq!(p, ["review2", "dev6", "dev5", "qa2", "ba", "dev4", "dev3", "review", "dev2", "ui"]);
        assert!(!p.iter().any(|n| CORE.contains(&n.as_str())), "never lead/dev/qa");
        assert_eq!(to_pause(&live, 11), ["review2", "dev6"]);
        assert_eq!(to_pause(&["lead".into(), "dev".into(), "qa".into(), "custom".into(), "review2".into()], 3), ["review2", "custom"]);
        assert!(to_pause(&["lead".into(), "dev".into()], 0).is_empty());
        // The sweep cleans the overloaded machine: never paused, and it counts as kept.
        let with_sweep: Vec<String> = ["lead", "dev", "qa", "sweep", "review2", "rd"].iter().map(|s| s.to_string()).collect();
        assert_eq!(to_pause(&with_sweep, 0), ["review2", "rd"]);
        assert!(kept("sweep") && kept("sweep-zus") && !kept("eye"));
        // Back the other way: the last paused (most needed) first, only after 10 minutes in which one
        // more room fit under the threshold — with the owner's own load counted as it is.
        let paused = vec!["review2".to_string(), "dev6".to_string()];
        assert_eq!(resume_pick(&paused, Some(NOW - 700), NOW).as_deref(), Some("dev6"));
        assert_eq!(resume_pick(&paused, Some(NOW - 300), NOW), None, "fit only 5 min");
        assert_eq!(resume_pick(&paused, None, NOW), None);
        assert_eq!(resume_pick(&[], Some(0), NOW), None);
        // 64 GB at 60% = 39 321 MiB budget, 5% margin = 3 276: the owner's apps at 33.9 GB leave room
        // for one 2 GB room (33 900 + 2 048 + 3 276 ≤ 39 321), at 35 GB not.
        assert!(room_fits(33_900, 2_048, 39_321, 3_276));
        assert!(!room_fits(35_000, 2_048, 39_321, 3_276));
        assert!(room_fits(480, 60, 600, 50) && !room_fits(500, 60, 600, 50), "CPU in 0.1 %: 48% + one room at 6% + 5% margin fits 60%");
    }

    #[test]
    fn lean_rooms_turn_off_only_the_lsp_plugins() {
        let user = json!({ "enabledPlugins": {
            "typescript-lsp@claude-plugins-official": true, "pyright-lsp@claude-plugins-official": true,
            "gopls-lsp@claude-plugins-official": false, "8sync-hints@8sync": true, "lsp-tools@x": true
        } });
        assert_eq!(lean_plugins(&user), ["pyright-lsp@claude-plugins-official", "typescript-lsp@claude-plugins-official"]);
        assert!(lean_plugins(&json!({})).is_empty());
        let cj = json!({ "mcpServers": { "serena-dev": {}, "codegraph": {}, "headroom": {}, "playwright": {} } });
        assert_eq!(lean_mcp(&cj), ["codebase-memory-mcp", "codegraph", "serena", "serena-dev"], "indexers only; the rest stay");
        assert_eq!(lean_mcp(&Value::Null), ["codebase-memory-mcp", "serena"]);
        for n in ["lead", "ba", "qa", "qa2", "review", "review2", "rd", "eye", "sweep"] {
            assert!(lean_role(n), "{n}");
        }
        assert!(lean(Path::new("/no/such/home"), Path::new("/no/such/repo"), "sweep"), "the sweep starts lean whatever the guard");
        for n in ["dev", "dev3", "ui", "core"] {
            assert!(!lean_role(n), "{n}");
        }
    }

    #[test]
    fn rooms_map_to_their_claude_pid() {
        let reg = vec![("dev".to_string(), "aaaaaaaa-1".to_string()), ("qa".to_string(), "bbbbbbbb-2".to_string()), ("lead".to_string(), "cccccccc-3".to_string())];
        let agents = r#"[{"sessionId":"aaaaaaaa-1","kind":"background","status":"idle","pid":4100},
            {"sessionId":"bbbbbbbb-2","kind":"background","status":"running"},
            {"sessionId":"cccccccc-3","kind":"interactive","status":"idle","pid":4300},
            {"sessionId":"dddddddd-4","kind":"background","status":"idle","pid":4400}]"#;
        let got = live_rooms(agents, &reg, &[("bbbbbbbb-2".into(), 4200)]);
        assert_eq!(
            got,
            [
                LiveRoom { name: "dev".into(), sid: "aaaaaaaa-1".into(), pid: 4100, busy: false },
                LiveRoom { name: "qa".into(), sid: "bbbbbbbb-2".into(), pid: 4200, busy: true }
            ],
            "the owner's interactive lead and sessions of no room are left out"
        );
        assert!(live_rooms("not json", &reg, &[]).is_empty());
        assert_eq!(cpu_share(32 * 10_000_000, 10_000, 32), 10);
    }

    #[test]
    fn state_paused_restarts_and_status() {
        let home = std::env::temp_dir().join(format!("8sync-guard-{}", crate::verbs::uuid_sessions::new_uuid()));
        let root = Path::new(r"C:\w\game");
        let k = key(root);
        idle::write_json(&file(&home), &json!({ k.clone(): { "level": 3, "ram": 88, "cpu": 71, "at": 5, "paused": ["review2", "dev6"], "restart": [{ "name": "dev", "waiting": true, "pid": 41 }, { "name": "ui" }], "actions": [{ "at": 5, "text": "L3 …" }], "defender": "Add-MpPreference -ExclusionPath 'x'", "defender_cpu": 5 } }));
        assert_eq!(paused(&home, root), ["review2", "dev6"]);
        assert_eq!(level_of(&home, root), Level::Shrink);
        // A restart stays asked until revive did it (one put off by the deadline is retried).
        let asked = restarts(&home, root);
        assert_eq!(asked[0], Restart { name: "dev".into(), waiting: true, pid: 41 });
        assert_eq!(restarts(&home, root).len(), 2, "reading does not consume");
        restart_done(&home, root, "dev", 77);
        assert_eq!(restarts(&home, root).iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["ui"]);
        assert_eq!(load(&home)[&k]["restarted"]["dev"].as_u64(), Some(77));
        let g = status_json(&home, Some(60));
        assert_eq!((g["pct"].as_u64(), g["projects"][0]["level"].as_u64(), g["projects"][0]["paused"][1].as_str()), (Some(60), Some(3), Some("dev6")));
        let l = lines(&g);
        assert!(l[0].contains("RAM ≥ 60% · CPU ≥ 55% · CPU phòng tối đa 37%") && l[0].contains("EcoQoS) BẬT") && l[1].contains("L3 tạm dừng bớt phòng · RAM 88% · CPU 71% · tạm dừng: review2, dev6 · gần nhất: L3 …") && l[2].contains("Defender ăn CPU 5%"), "{l:?}");
        assert!(lines(&status_json(&home, None))[0].contains("TẮT"));
        assert_eq!(status_json(&home, None)["projects"][0]["paused"], json!([]), "guard off: HQ shows no pause");
        clear_paused(&home, root);
        assert!(paused(&home, root).is_empty());
        // Guard off ends every pause and asked restart; revive then brings the rooms back.
        idle::write_json(&file(&home), &json!({ k.clone(): { "paused": ["review2"], "restart": [{ "name": "ui" }] } }));
        auto::set_guard(&home, None, 1).unwrap();
        assert!(paused(&home, root).is_empty() && restarts(&home, root).is_empty());
        auto::set_guard(&home, Some(60), 2).unwrap();
        assert!(paused(&home, root).is_empty() && restarts(&home, root).is_empty(), "cleared, not just hidden");
        let mut st = json!({});
        for i in 0..12 {
            log(&mut st, i, &format!("a{i}"));
        }
        assert_eq!((st["actions"].as_array().unwrap().len(), st["actions"][0]["text"].as_str()), (ACTIONS_KEEP, Some("a2")));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn cap_mask_takes_the_highest_cpus_at_least_two_first_group_only() {
        assert_eq!(cap_mask(37, 32, false), 0xFFF0_0000, "12 of 32, high CPUs (V-Cache CCD left alone)");
        assert_eq!(cap_mask(37, 32, true), 0xFC00_0000, "tight: halved to 6");
        assert_eq!(cap_mask(25, 32, false).count_ones(), 8);
        assert_eq!(cap_mask(50, 16, false), 0xFF00);
        assert_eq!(cap_mask(10, 4, false), 0b1100, "min 2");
        assert_eq!(cap_mask(10, 4, true), 0b1100, "tight never under 2");
        assert_eq!(cap_mask(90, 2, false), 0b11);
        assert_eq!(cap_mask(90, 1, false), 0b1, "never more CPUs than there are");
        assert_eq!(cap_mask(50, 128, false), 0xFFFF_FFFF_0000_0000, "> 64 CPUs: first group only");
        assert_eq!(cap_mask(90, 64, false).count_ones(), 58);
        assert_eq!(full_mask(32), 0xFFFF_FFFF);
        assert_eq!(full_mask(200), u64::MAX);
    }

    #[test]
    fn ram_and_cpu_thresholds_are_apart_ram_never_tightens_cpu_never_restarts() {
        let t = Limits { ram: 60, cpu: 55 };
        let none = Breach::default();
        // The owner's own RAM at 62%, CPU calm: L1 on RAM, the CPU breach run stays empty → the cap
        // stays as it is and builds are not idled.
        let b = none.next(62, Some(30), t, None, NOW);
        assert_eq!((b.ram, b.cpu), (Some(NOW), None));
        assert_eq!(level(62, None, Some(30), t, &b, NOW), Level::Clean);
        assert!(!cap_tight(false, Some(30), t.cpu), "a RAM-only breach never tightens the cap");
        // CPU 57% (over 55, under the RAM 60) for a long time, RAM low: L1 every pass, never L2.
        let mut b = none;
        for i in 0..20u64 {
            b = b.next(40, Some(57), t, (i > 0).then_some(20), NOW + i * 20);
            assert_eq!(level(40, None, Some(57), t, &b, NOW + i * 20), Level::Clean, "a CPU-only breach never lean-restarts rooms");
        }
        assert_eq!((b.cpu, b.ram), (Some(NOW), None));
        assert!(cap_tight(false, Some(57), t.cpu), "the CPU breach tightens the cap");
        // 57% CPU is under one shared 60 threshold: the split is what catches it.
        assert_eq!(level(40, None, Some(57), Limits { ram: 60, cpu: 60 }, &none, NOW), Level::Calm);
        let g = json!({ "pct": 60, "cpu_pct": 55, "cap": 37, "cpus": 32, "cap_tight": false, "projects": [] });
        assert!(lines(&g)[0].starts_with("máy: tự dọn khi RAM ≥ 60% · CPU ≥ 55% · CPU phòng tối đa 37% (12/32 luồng)"), "{:?}", lines(&g));
    }

    #[test]
    fn cap_tightens_on_a_cpu_breach_and_lets_go_once_calm() {
        assert!(cap_tight(false, Some(55), 55), "at the threshold");
        assert!(cap_tight(true, Some(50), 55), "just under: still tight");
        assert!(!cap_tight(true, Some(45), 55), "10 points under: back");
        assert!(cap_tight(true, None, 55), "unknown CPU keeps the state");
        assert!(!cap_tight(false, Some(50), 55));
        assert_eq!(cap_text(37, 32, false), "CPU phòng tối đa 37% (12/32 luồng)");
        assert!(cap_text(37, 32, true).starts_with("CPU phòng tối đa 37% (6/32 luồng) · đang siết"));
    }

    #[test]
    fn cap_pins_only_room_trees_and_the_daemon_and_off_restores_them() {
        let procs = vec![
            p(10, 1, 60, "claude.exe", "C:\\x\\claude.exe daemon", 100),
            p(11, 10, 60, "claude.exe", "C:\\x\\claude.exe --bg-pty-host 123", 50),
            p(20, 11, 30, "claude.exe", "claude --bg --resume abc", 300), // room dev
            p(21, 20, 10, "node.exe", "node vite", 100),
            p(30, 11, 30, "claude.exe", "claude --bg --resume def", 300), // background session not a room here
            p(40, 1, 90, "claude.exe", "claude", 300),                    // owner's interactive claude
            p(41, 40, 5, "node.exe", "node build", 100),
            p(50, 1, 90, "omp.exe", "omp", 100),
            p(60, 1, 90, "8sync.exe", "8sync ccc auto guard now", 10),
            p(70, 1, 90, "node.exe", "node C:\\npm\\claude-code\\cli.js daemon", 100), // npm daemon
        ];
        let trees = vec![("dev".to_string(), vec![20, 21])];
        assert_eq!(cap_targets(&procs, &trees), vec![10, 11, 20, 21, 70]);
        let mask = cap_mask(37, 32, false);
        let get = |pid: u32| match pid {
            11 => Some(mask),
            21 => None,
            _ => Some(0xFFFF_FFFF),
        };
        assert_eq!(to_pin(&cap_targets(&procs, &trees), mask, &get), vec![10, 20, 70], "already pinned and unreadable skipped");
        let off = uncap_targets(&procs);
        assert_eq!(off, vec![10, 11, 20, 21, 30, 70], "daemons and all they spawned, never the owner's claude, omp, 8sync");
        let get_off = |pid: u32| Some(if pid == 30 { 0xFFFF_FFFF } else { mask });
        assert_eq!(to_pin(&off, full_mask(32), &get_off), vec![10, 11, 20, 21, 70]);
        assert!(!is_daemon(&p(1, 0, 1, "claude.exe", "claude --resume daemon-notes", 1)));
    }

}
