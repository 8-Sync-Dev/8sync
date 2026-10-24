//! `8sync watchdog` — an always-on, std-only background loop that protects the machine
//! and the harness from runaway helpers.
//!
//! It reads `/proc` directly every ~2 s, finds the process trees under `claude` / `omp`
//! plus a configurable list of known harness helpers (headroom,
//! tsserver…), and when one burns CPU or RAM it (1) appends an alert to
//! `~/.local/state/8sync/watchdog/alerts.jsonl` (which `8sync ccc hook watchdog` feeds
//! to Claude Code as `additionalContext`), (2) calls `notify-send`, and (3) for KNOWN
//! HELPERS ONLY sends SIGTERM, then SIGKILL after a grace period, and quarantines a
//! helper that keeps respawning (`~/.config/8sync/watchdog-blocked`).
//!
//! The decision logic (`Engine`) is pure: it takes a `Snap` and returns alerts + actions,
//! so every threshold, window and allowlist rule is unit-tested without touching /proc.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::collections::{BTreeSet, HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use clap::{Args as ClapArgs, Subcommand};
use serde_json::{json, Value};

use crate::ui;

const TICKS_PER_SEC: f64 = 100.0; // CLK_TCK is 100 on every Linux 8sync targets
const PAGE: u64 = 4096;
const UNIT: &str = "8sync-watchdog.service";
const HOOK_MAX_CHARS: usize = 1500;
/// Never killed even when a user lists them as helpers: the owner's session, editors,
/// browsers, shells and the runtimes everything else runs on.
const PROTECTED: [&str; 24] = [
    "claude", "omp", "8sync", "code", "codium", "nvim", "vim", "hx", "helix", "emacs", "zed", "firefox", "chrome",
    "chromium", "brave", "kitty", "systemd", "sshd", "bash", "zsh", "sh", "node", "bun", "python",
];
const RUNTIMES: [&str; 9] = ["node", "bun", "deno", "python", "python3", "uv", "uvx", "npx", "java"];

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync watchdog run [--dry-run]   foreground loop (alerts only with --dry-run)
      8sync watchdog install           systemd --user service (Linux): Nice=10 CPUQuota=5% MemoryMax=64M
      8sync watchdog uninstall         stop + remove the service
      8sync watchdog status            service, thresholds file, recent alerts, blocked helpers
      8sync watchdog unblock <name>    allow a quarantined helper again (--all clears the list)
    Config: ~/.config/8sync/watchdog.toml (created with defaults). Alerts: ~/.local/state/8sync/watchdog/alerts.jsonl
    Claude Code sees alerts through the kit hook `8sync ccc hook watchdog` (`8sync ccc kit` registers it).
"})]
pub struct Args {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Foreground monitor loop
    Run {
        /// Alert only: never signal a process or write the blocked list
        #[arg(long)]
        dry_run: bool,
        /// Use this thresholds file instead of ~/.config/8sync/watchdog.toml
        #[arg(long)]
        config: Option<PathBuf>,
    },
    /// Install + start the systemd --user service (Linux)
    Install,
    /// Stop + remove the service
    Uninstall,
    /// Service state, recent alerts, blocked helpers
    Status,
    /// Allow quarantined helpers again (the running service picks it up next tick)
    Unblock {
        /// Helper names as listed by `8sync watchdog status`
        names: Vec<String>,
        /// Clear the whole blocked list
        #[arg(long, conflicts_with = "names")]
        all: bool,
    },
}

pub fn run(a: Args) -> Result<()> {
    let paths = Paths::detect()?;
    match a.cmd {
        Cmd::Run { dry_run, config } => run_loop(&paths, config.as_deref(), dry_run),
        Cmd::Install => install(&paths),
        Cmd::Uninstall => uninstall(),
        Cmd::Status => status(&paths),
        Cmd::Unblock { names, all } => unblock(&paths, &names, all),
    }
}

// ───────────────────────── config ─────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub period_secs: f64,
    /// Per-helper CPU% (100 = one core) that must hold for `cpu_sustain_secs`.
    pub cpu_pct: f64,
    pub cpu_sustain_secs: f64,
    /// Non-helper watched runtimes (node, python…) under a session: longer window, alert only.
    pub watched_cpu_sustain_secs: f64,
    pub helper_rss_mb: u64,
    pub rss_sustain_secs: f64,
    /// `claude` / `omp` main process RSS: warn only.
    pub claude_rss_mb: u64,
    pub mem_avail_pct: f64,
    pub load_factor: f64,
    pub sys_sustain_secs: f64,
    pub gpu_mem_mb: u64,
    pub auto_kill: bool,
    pub kill_grace_secs: f64,
    pub respawn_limit: usize,
    pub respawn_window_secs: f64,
    pub notify: bool,
    pub roots: Vec<String>,
    pub helpers: Vec<String>,
    /// Helpers that are legitimately heavy while indexing (LSPs): alert, never kill.
    pub warn_only: Vec<String>,
    pub watch: Vec<String>,
    pub build: Vec<String>,
    /// Under machine pressure, session processes above this CPU% get `renice 19` + `ionice -c3`.
    pub auto_renice: bool,
    pub renice_cpu_pct: f64,
    pub renice_after_secs: f64,
    /// PSI (`/proc/pressure/*`, avg10 %): earlier than MemAvailable/load.
    pub psi_mem_full_pct: f64,
    pub psi_io_full_pct: f64,
    pub psi_cpu_some_pct: f64,
    /// Machine GPU (AMD sysfs; NVIDIA is measured per process via nvidia-smi): warn above these.
    pub gpu_vram_pct: f64,
    pub gpu_busy_pct: f64,
}

impl Default for Config {
    fn default() -> Self {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect();
        Config {
            period_secs: 2.0,
            cpu_pct: 150.0,
            cpu_sustain_secs: 20.0,
            watched_cpu_sustain_secs: 60.0,
            helper_rss_mb: 1536,
            rss_sustain_secs: 6.0,
            claude_rss_mb: 4096,
            mem_avail_pct: 10.0,
            load_factor: 2.0,
            sys_sustain_secs: 30.0,
            gpu_mem_mb: 4096,
            auto_kill: true,
            kill_grace_secs: 10.0,
            respawn_limit: 3,
            respawn_window_secs: 600.0,
            notify: true,
            roots: v(&["claude", "omp"]),
            helpers: v(&[
                "headroom", "tsserver", "rust-analyzer",
                "typescript-language-server", "gopls", "pyright-langserver", "basedpyright-langserver",
            ]),
            warn_only: v(&[
                "tsserver", "rust-analyzer", "typescript-language-server", "gopls", "pyright-langserver",
                "basedpyright-langserver",
            ]),
            build: v(&[
                "cargo", "rustc", "rust-lld", "ld", "ld.lld", "mold", "collect2", "cc", "cc1", "cc1plus", "clang", "gcc", "g++",
                "go", "tsc", "esbuild", "vite", "webpack", "next", "turbo", "make", "ninja", "cmake", "gradle", "mvn",
            ]),
            auto_renice: true,
            renice_cpu_pct: 25.0,
            renice_after_secs: 6.0,
            psi_mem_full_pct: 5.0,
            psi_io_full_pct: 20.0,
            psi_cpu_some_pct: 70.0,
            gpu_vram_pct: 90.0,
            gpu_busy_pct: 98.0,
            watch: v(&["node", "bun", "python", "python3", "uv", "uvx", "npx", "deno", "java"]),
        }
    }
}

const CONFIG_TEMPLATE: &str = "\
# 8sync watchdog thresholds. Edit and restart: systemctl --user restart 8sync-watchdog
period_secs = 2.0
# Known helpers (listed below) running under a claude/omp session are SIGTERMed after the
# CPU/RSS window (except warn_only); claude/omp and processes outside a session never are.
cpu_pct = 150.0              # 100 = one core
cpu_sustain_secs = 20.0
watched_cpu_sustain_secs = 60.0   # node/python/... under a session: alert only
helper_rss_mb = 1536
rss_sustain_secs = 6.0
claude_rss_mb = 4096         # claude/omp main process: warn only
mem_avail_pct = 10.0         # machine MemAvailable below this %: warn
load_factor = 2.0            # load1 above factor x cores: warn
sys_sustain_secs = 30.0
gpu_mem_mb = 4096            # needs nvidia-smi; sampled every 10 s, warn only
auto_kill = true             # false = alert only
kill_grace_secs = 10.0       # SIGTERM, then SIGKILL after this
respawn_limit = 3            # killed more than this many times ...
respawn_window_secs = 600.0  # ... within this window = quarantined (~/.config/8sync/watchdog-blocked)
notify = true
roots = [\"claude\", \"omp\"]
helpers = [\"headroom\", \"tsserver\", \"rust-analyzer\", \"typescript-language-server\", \"gopls\", \"pyright-langserver\", \"basedpyright-langserver\"]
# helpers that index heavily by design: alert only, never killed
warn_only = [\"tsserver\", \"rust-analyzer\", \"typescript-language-server\", \"gopls\", \"pyright-langserver\", \"basedpyright-langserver\"]
# under pressure (low MemAvailable, high load or PSI), session processes above renice_cpu_pct
# get renice 19 + ionice idle (they keep running, the desktop stays responsive)
auto_renice = true
renice_cpu_pct = 25.0
psi_mem_full_pct = 5.0       # /proc/pressure/memory full avg10
psi_io_full_pct = 20.0       # /proc/pressure/io full avg10
psi_cpu_some_pct = 70.0      # /proc/pressure/cpu some avg10
gpu_vram_pct = 90.0          # AMD (sysfs) machine VRAM: warn above
gpu_busy_pct = 98.0
watch = [\"node\", \"bun\", \"python\", \"python3\", \"uv\", \"uvx\", \"npx\", \"deno\", \"java\"]
";

impl Config {
    /// Overlay the keys present in `t` on the defaults; a wrong-typed key is ignored.
    fn from_table(t: &toml::Table) -> Config {
        let mut c = Config::default();
        let f = |k: &str, v: &mut f64| {
            if let Some(x) = t.get(k).and_then(|x| x.as_float().or_else(|| x.as_integer().map(|i| i as f64))) {
                *v = x;
            }
        };
        let n = |k: &str, v: &mut u64| {
            if let Some(x) = t.get(k).and_then(|x| x.as_integer()).and_then(|i| u64::try_from(i).ok()) {
                *v = x;
            }
        };
        let l = |k: &str, v: &mut Vec<String>| {
            if let Some(a) = t.get(k).and_then(|x| x.as_array()) {
                *v = a.iter().filter_map(|x| x.as_str().map(str::to_lowercase)).collect();
            }
        };
        f("period_secs", &mut c.period_secs);
        f("cpu_pct", &mut c.cpu_pct);
        f("cpu_sustain_secs", &mut c.cpu_sustain_secs);
        f("watched_cpu_sustain_secs", &mut c.watched_cpu_sustain_secs);
        n("helper_rss_mb", &mut c.helper_rss_mb);
        f("rss_sustain_secs", &mut c.rss_sustain_secs);
        n("claude_rss_mb", &mut c.claude_rss_mb);
        f("mem_avail_pct", &mut c.mem_avail_pct);
        f("load_factor", &mut c.load_factor);
        f("sys_sustain_secs", &mut c.sys_sustain_secs);
        n("gpu_mem_mb", &mut c.gpu_mem_mb);
        f("kill_grace_secs", &mut c.kill_grace_secs);
        let mut limit = c.respawn_limit as u64;
        n("respawn_limit", &mut limit);
        c.respawn_limit = limit as usize;
        f("respawn_window_secs", &mut c.respawn_window_secs);
        for (k, v) in [("auto_kill", &mut c.auto_kill), ("notify", &mut c.notify)] {
            if let Some(b) = t.get(k).and_then(|x| x.as_bool()) {
                *v = b;
            }
        }
        l("roots", &mut c.roots);
        l("helpers", &mut c.helpers);
        l("warn_only", &mut c.warn_only);
        l("watch", &mut c.watch);
        l("build", &mut c.build);
        f("renice_cpu_pct", &mut c.renice_cpu_pct);
        f("renice_after_secs", &mut c.renice_after_secs);
        f("psi_mem_full_pct", &mut c.psi_mem_full_pct);
        f("psi_io_full_pct", &mut c.psi_io_full_pct);
        f("psi_cpu_some_pct", &mut c.psi_cpu_some_pct);
        f("gpu_vram_pct", &mut c.gpu_vram_pct);
        f("gpu_busy_pct", &mut c.gpu_busy_pct);
        if let Some(b) = t.get("auto_renice").and_then(|x| x.as_bool()) {
            c.auto_renice = b;
        }
        c
    }

    fn parse(s: &str) -> Result<Config, toml::de::Error> {
        s.parse::<toml::Table>().map(|t| Config::from_table(&t))
    }

    /// Read `path`; create it with the documented defaults when missing. A broken file
    /// falls back to defaults rather than stopping the guard.
    fn load(path: &Path) -> Config {
        match fs::read_to_string(path) {
            Ok(s) => Config::parse(&s).unwrap_or_else(|e| {
                eprintln!("watchdog: {} is invalid ({e}); using defaults", path.display());
                Config::default()
            }),
            Err(_) => {
                if let Some(d) = path.parent() {
                    let _ = fs::create_dir_all(d);
                }
                let _ = fs::write(path, CONFIG_TEMPLATE);
                Config::default()
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct Paths {
    pub config: PathBuf,
    pub blocked: PathBuf,
    pub state: PathBuf,
    pub alerts: PathBuf,
    pub cursors: PathBuf,
}

impl Paths {
    fn detect() -> Result<Paths> {
        Ok(Paths::at(&dirs::home_dir().context("no home dir")?))
    }
    pub fn at(home: &Path) -> Paths {
        let state = home.join(".local/state/8sync/watchdog");
        Paths {
            config: home.join(".config/8sync/watchdog.toml"),
            blocked: home.join(".config/8sync/watchdog-blocked"),
            alerts: state.join("alerts.jsonl"),
            cursors: state.join("cursors"),
            state,
        }
    }
}

// ───────────────────────── /proc parsers ─────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct Stat {
    pub pid: u32,
    pub comm: String,
    pub ppid: u32,
    /// utime + stime in clock ticks
    pub ticks: u64,
    pub start: u64,
}

/// `/proc/<pid>/stat`. `comm` may hold spaces and parentheses, so split on the LAST `)`.
pub fn parse_stat(s: &str) -> Option<Stat> {
    let open = s.find('(')?;
    let close = s.rfind(')')?;
    let f: Vec<&str> = s.get(close + 1..)?.split_whitespace().collect();
    Some(Stat {
        pid: s[..open].trim().parse().ok()?,
        comm: s[open + 1..close].to_string(),
        ppid: f.get(1)?.parse().ok()?,
        ticks: f.get(11)?.parse::<u64>().ok()? + f.get(12)?.parse::<u64>().ok()?,
        start: f.get(19)?.parse().ok()?,
    })
}

/// `/proc/<pid>/statm` → resident bytes (second field, in pages).
pub fn parse_statm_rss(s: &str) -> Option<u64> {
    Some(s.split_whitespace().nth(1)?.parse::<u64>().ok()? * PAGE)
}

/// `/proc/meminfo` → (MemAvailable kB, MemTotal kB)
pub fn parse_meminfo(s: &str) -> Option<(u64, u64)> {
    let get = |k: &str| s.lines().find_map(|l| l.strip_prefix(k)?.trim().trim_end_matches("kB").trim().parse::<u64>().ok());
    Some((get("MemAvailable:")?, get("MemTotal:")?))
}

/// Online CPUs from `/proc/stat` (`cpuN` lines). Not `available_parallelism`:
/// under the service's `CPUQuota=5%` that reports 1, and load avg is machine-wide.
pub fn parse_cores(stat: &str) -> usize {
    stat.lines().filter(|l| l.strip_prefix("cpu").is_some_and(|r| r.starts_with(|c: char| c.is_ascii_digit()))).count()
}

fn machine_cores() -> f64 {
    match parse_cores(&read("/proc/stat".into())) {
        0 => std::thread::available_parallelism().map_or(1.0, |n| n.get() as f64),
        n => n as f64,
    }
}

/// `/proc/pressure/*`: (some avg10, full avg10).
pub fn parse_psi(s: &str) -> (f64, f64) {
    let avg10 = |kind: &str| {
        s.lines()
            .find(|l| l.starts_with(kind))
            .and_then(|l| l.split_whitespace().find_map(|f| f.strip_prefix("avg10=")))
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    (avg10("some"), avg10("full"))
}

/// AMD (amdgpu sysfs): (busy %, VRAM used %) from `gpu_busy_percent`, `mem_info_vram_used/_total`.
pub fn parse_amdgpu(busy: &str, used: &str, total: &str) -> Option<(f64, f64)> {
    let b = busy.trim().parse::<f64>().ok()?;
    let u = used.trim().parse::<f64>().ok().unwrap_or(0.0);
    let t = total.trim().parse::<f64>().ok().filter(|t| *t > 0.0);
    Some((b, t.map_or(0.0, |t| u / t * 100.0)))
}

/// The busiest readable GPU: AMD via sysfs; `None` if no card exposes stats.
fn machine_gpu() -> Option<(f64, f64, String)> {
    let mut best: Option<(f64, f64, String)> = None;
    for e in fs::read_dir("/sys/class/drm").into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with("card") || name.contains('-') {
            continue;
        }
        let d = e.path().join("device");
        let rd = |f: &str| fs::read_to_string(d.join(f)).unwrap_or_default();
        // reading a runtime-suspended dGPU's counters can wake it: only read active cards
        let pm = rd("power/runtime_status");
        if !pm.is_empty() && pm.trim() != "active" {
            continue;
        }
        if let Some((b, v)) = parse_amdgpu(&rd("gpu_busy_percent"), &rd("mem_info_vram_used"), &rd("mem_info_vram_total")) {
            if best.as_ref().is_none_or(|x| b.max(v) > x.0.max(x.1)) {
                best = Some((b, v, format!("amdgpu {name}")));
            }
        }
    }
    best
}

pub fn parse_loadavg(s: &str) -> Option<f64> {
    s.split_whitespace().next()?.parse().ok()
}

/// `nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits`
pub fn parse_nvidia(s: &str) -> Vec<(u32, u64)> {
    s.lines()
        .filter_map(|l| {
            let (p, m) = l.split_once(',')?;
            Some((p.trim().parse().ok()?, m.trim().parse().ok()?))
        })
        .collect()
}

/// CPU% (100 = one core) from two cumulative tick counts `dt` seconds apart.
pub fn cpu_pct(prev: u64, cur: u64, dt: f64) -> f64 {
    if dt <= 0.0 || cur < prev {
        return 0.0;
    }
    (cur - prev) as f64 / TICKS_PER_SEC / dt * 100.0
}

// ───────────────────────── classification ─────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// `claude` / `omp`: a session root. Only ever warned about.
    Root,
    /// A known harness helper: the only kind that may be signalled.
    Helper,
    /// node/python/... under a session: alert only.
    Watched,
    /// Compilers/linkers/bundlers under a session: never alerted on, reniced under pressure.
    Build,
    Other,
}

fn base(arg: &str, strip_ext: bool) -> String {
    let b = arg.rsplit('/').next().unwrap_or(arg).to_lowercase();
    match b.rsplit_once('.') {
        Some((stem, "js" | "mjs" | "cjs" | "py" | "ts" | "jar")) if strip_ext && !stem.is_empty() => stem.to_string(),
        _ => b,
    }
}

/// Every name a process answers to: exe, comm, argv0; for a runtime also the script it runs.
pub fn names_of(exe: Option<&str>, comm: &str, args: &[String]) -> Vec<String> {
    let mut n: Vec<String> = exe.iter().map(|e| e.to_lowercase()).collect();
    n.push(comm.to_lowercase());
    if let Some(a0) = args.first() {
        n.push(base(a0, false));
    }
    if n.iter().any(|x| RUNTIMES.contains(&x.as_str())) {
        n.extend(args.iter().skip(1).filter(|a| !a.starts_with('-')).take(3).map(|a| base(a, true)));
    }
    n.dedup();
    n
}

/// Kind plus the name used for kill lists (the matched helper, else the primary name).
pub fn classify(names: &[String], cfg: &Config) -> (Kind, String) {
    let primary = names.first().cloned().unwrap_or_default();
    let has = |l: &[String]| names.iter().find(|n| l.contains(n)).cloned();
    if has(&cfg.roots).is_some() || names.iter().any(|n| n == "claude" || n == "omp") {
        return (Kind::Root, primary);
    }
    let helper = names.iter().find(|n| cfg.helpers.contains(n) && !PROTECTED.contains(&n.as_str()) && !cfg.roots.contains(n));
    if let Some(h) = helper {
        return (Kind::Helper, h.clone());
    }
    if let Some(w) = has(&cfg.watch) {
        return (Kind::Watched, w);
    }
    if let Some(b) = has(&cfg.build) {
        return (Kind::Build, b);
    }
    (Kind::Other, primary)
}

#[derive(Debug, Clone)]
pub struct P {
    pub pid: u32,
    pub start: u64,
    #[cfg_attr(not(test), allow(dead_code))]
    pub ppid: u32,
    pub ticks: u64,
    pub rss: u64,
    pub name: String,
    pub kind: Kind,
    pub cwd: Option<String>,
    pub gpu_mb: u64,
    /// nearest ancestor (or self) that is a `claude`/`omp` root
    pub root: Option<u32>,
}

/// Nearest `claude`/`omp` ancestor of `pid` (itself if it is one); chains are capped at 64.
pub fn root_of(pid: u32, parent: impl Fn(u32) -> Option<u32>, is_root: impl Fn(u32) -> bool) -> Option<u32> {
    let mut cur = pid;
    for _ in 0..64 {
        if is_root(cur) {
            return Some(cur);
        }
        cur = parent(cur).filter(|&p| p > 1 && p != cur)?;
    }
    None
}

// ───────────────────────── engine (pure) ─────────────────────────

/// "Over the limit continuously for `window` seconds" fires once per episode.
#[derive(Default, Debug)]
pub struct Sustain {
    since: Option<f64>,
    fired: bool,
}

impl Sustain {
    pub fn update(&mut self, now: f64, over: bool, window: f64) -> bool {
        if !over {
            self.since = None;
            self.fired = false;
            return false;
        }
        let since = *self.since.get_or_insert(now);
        if !self.fired && now - since >= window {
            self.fired = true;
            return true;
        }
        false
    }
}

#[derive(Default)]
pub struct Snap {
    /// monotonic seconds
    pub now: f64,
    /// seconds since the previous snapshot
    pub dt: f64,
    pub wall_ms: u64,
    pub procs: Vec<P>,
    pub avail_pct: f64,
    pub load: f64,
    pub cores: f64,
    /// the watchdog and its ancestors: never signalled
    pub protect: HashSet<u32>,
    /// PSI avg10 %: memory full, io full, cpu some
    pub psi_mem: f64,
    pub psi_io: f64,
    pub psi_cpu: f64,
    /// busiest GPU: (busy %, VRAM used %, label); None when no GPU can be read
    pub gpu: Option<(f64, f64, String)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Alert {
    pub id: u64,
    pub ts: u64,
    pub kind: String,
    pub pid: u32,
    pub exe: String,
    pub root_pid: u32,
    pub root_cwd: String,
    pub metric: String,
    pub value: f64,
    pub threshold: f64,
    pub action: String,
    pub msg: String,
    pub suggest: String,
}

impl Alert {
    fn to_json(&self) -> String {
        json!({
            "id": self.id, "ts": self.ts, "kind": self.kind, "pid": self.pid, "exe": self.exe,
            "root_pid": self.root_pid, "root_cwd": self.root_cwd, "metric": self.metric,
            "value": self.value, "threshold": self.threshold, "action": self.action,
            "msg": self.msg, "suggest": self.suggest
        })
        .to_string()
    }

    fn from_line(line: &str) -> Option<Alert> {
        let v: Value = serde_json::from_str(line).ok()?;
        let st = |k: &str| v[k].as_str().unwrap_or_default().to_string();
        Some(Alert {
            id: v["id"].as_u64()?,
            ts: v["ts"].as_u64()?,
            kind: st("kind"),
            pid: v["pid"].as_u64()? as u32,
            exe: st("exe"),
            root_pid: v["root_pid"].as_u64()? as u32,
            root_cwd: st("root_cwd"),
            metric: st("metric"),
            value: v["value"].as_f64().unwrap_or(0.0),
            threshold: v["threshold"].as_f64().unwrap_or(0.0),
            action: st("action"),
            msg: st("msg"),
            suggest: st("suggest"),
        })
    }
}

#[derive(Debug, PartialEq)]
pub enum Act {
    Term(u32, u64),
    Kill(u32, u64),
    /// the full quarantine list to persist
    Block(String),
    /// lowest CPU + idle IO priority (the process keeps running)
    Renice(u32, u64),
}

#[derive(Default)]
pub struct Out {
    pub alerts: Vec<Alert>,
    pub acts: Vec<Act>,
}

type Key = (u32, u64);

pub struct Engine {
    cfg: Config,
    dry: bool,
    prev: HashMap<Key, u64>,
    cpu: HashMap<Key, Sustain>,
    rss: HashMap<Key, Sustain>,
    gpu: HashMap<Key, Sustain>,
    mem: Sustain,
    load: Sustain,
    psi: Sustain,
    gpu_sys: Sustain,
    pressure_since: Option<f64>,
    reniced: HashSet<Key>,
    pending: HashMap<Key, f64>,
    kills: HashMap<String, Vec<f64>>,
    pub blocked: BTreeSet<String>,
    last_id: u64,
}

/// What Claude should do when the machine is under pressure.
const THROTTLE: &str = "the machine is under pressure: start no new parallel agents or builds; run heavy build/test on CI (push + `gh workflow run`/`gh run watch`); locally only light checks with `nice -n 19 ionice -c3` and `-j2`.";

/// Remedy for any process alert: helpers get their off switch; anything else
/// (node, python, a build) is only reported, never killed.
pub fn suggest_for(helper: bool, name: &str) -> String {
    if helper {
        helper_suggest(name)
    } else {
        format!("check what it is (`ps -o args -p <pid>`); `{name}` is not a known helper, so the watchdog only reports it — stop it yourself if it is stuck.")
    }
}

/// Remedy for a helper alert.
pub fn helper_suggest(_name: &str) -> String {
    "keep that helper off for this task (disable its MCP server / LSP) or work in smaller repos; the watchdog blocks it if it keeps respawning (`8sync watchdog unblock <name>` allows it again).".to_string()
}

impl Engine {
    pub fn new(cfg: Config, dry: bool, blocked: BTreeSet<String>) -> Engine {
        Engine {
            cfg,
            dry,
            prev: HashMap::new(),
            cpu: HashMap::new(),
            rss: HashMap::new(),
            gpu: HashMap::new(),
            mem: Sustain::default(),
            load: Sustain::default(),
            psi: Sustain::default(),
            gpu_sys: Sustain::default(),
            pressure_since: None,
            reniced: HashSet::new(),
            pending: HashMap::new(),
            kills: HashMap::new(),
            blocked,
            last_id: 0,
        }
    }

    /// Adopt the on-disk blocked list (`8sync watchdog unblock` edits it while the
    /// service runs); an unblocked helper starts with a clean kill history.
    pub fn set_blocked(&mut self, blocked: BTreeSet<String>) {
        for gone in self.blocked.difference(&blocked) {
            self.kills.remove(gone);
        }
        self.blocked = blocked;
    }

    #[allow(clippy::too_many_arguments)]
    fn alert(&mut self, s: &Snap, p: Option<&P>, kind: &str, metric: &str, value: f64, thr: f64, action: &str, msg: String, suggest: &str) -> Alert {
        self.last_id = s.wall_ms.max(self.last_id + 1);
        let (pid, exe, root_pid, root_cwd) = match p {
            Some(p) => {
                let root = p.root.and_then(|r| s.procs.iter().find(|x| x.pid == r));
                (p.pid, p.name.clone(), p.root.unwrap_or(0), root.and_then(|r| r.cwd.clone()).unwrap_or_default())
            }
            None => (0, "machine".into(), 0, String::new()),
        };
        Alert {
            id: self.last_id,
            ts: s.wall_ms / 1000,
            kind: kind.into(),
            pid,
            exe,
            root_pid,
            root_cwd,
            metric: metric.into(),
            value: (value * 10.0).round() / 10.0,
            threshold: thr,
            action: action.into(),
            msg,
            suggest: suggest.into(),
        }
    }

    fn may_kill(&self, s: &Snap, p: &P) -> bool {
        self.cfg.auto_kill
            && p.kind == Kind::Helper
            && p.root.is_some()
            && !self.cfg.warn_only.contains(&p.name)
            && p.pid > 1 && !s.protect.contains(&p.pid) && !self.pending.contains_key(&(p.pid, p.start))
    }

    /// SIGTERM bookkeeping for one helper; returns the action label and may quarantine.
    fn terminate(&mut self, s: &Snap, p: &P, out: &mut Out) -> String {
        if self.dry {
            return "dry-run: would SIGTERM".into();
        }
        out.acts.push(Act::Term(p.pid, p.start));
        self.pending.insert((p.pid, p.start), s.now);
        let win = self.cfg.respawn_window_secs;
        let list = self.kills.entry(p.name.clone()).or_default();
        list.retain(|t| s.now - t <= win);
        list.push(s.now);
        let n = list.len();
        if n > self.cfg.respawn_limit && self.blocked.insert(p.name.clone()) {
            out.acts.push(Act::Block(p.name.clone()));
            let msg = format!(
                "{} killed {n}x in {:.0} min → blocked (`8sync watchdog unblock {}` allows it again)",
                p.name,
                win / 60.0,
                p.name
            );
            let sug = helper_suggest(&p.name);
            let a = self.alert(s, Some(p), "quarantine", "kills", n as f64, self.cfg.respawn_limit as f64, "blocked", msg, &sug);
            out.alerts.push(a);
        }
        format!("SIGTERM, SIGKILL after {:.0} s", self.cfg.kill_grace_secs)
    }

    pub fn step(&mut self, s: &Snap) -> Out {
        let mut out = Out::default();
        let live: HashSet<Key> = s.procs.iter().map(|p| (p.pid, p.start)).collect();
        for m in [&mut self.cpu, &mut self.rss, &mut self.gpu] {
            m.retain(|k, _| live.contains(k));
        }
        // escalate SIGTERM → SIGKILL, forget the dead
        let grace = self.cfg.kill_grace_secs;
        let mut due = Vec::new();
        self.pending.retain(|k, at| {
            if !live.contains(k) {
                return false;
            }
            if s.now - *at >= grace {
                due.push(*k);
                return false;
            }
            true
        });
        for (pid, start) in due {
            out.acts.push(Act::Kill(pid, start));
            if let Some(p) = s.procs.iter().find(|p| p.pid == pid && p.start == start) {
                let msg = format!("{} (pid {pid}) ignored SIGTERM for {grace:.0} s → SIGKILL", p.name);
                let a = self.alert(s, Some(p), "sigkill", "alive_after_term", grace, grace, "killed", msg, &helper_suggest(&p.name));
                out.alerts.push(a);
            }
        }

        self.reniced.retain(|k| live.contains(k));
        let prev = std::mem::take(&mut self.prev);
        let mut top: Option<(f64, String, u32)> = None;
        let mut heavy: Vec<(u32, u64, String)> = Vec::new();
        for p in s.procs.iter().filter(|p| p.kind != Kind::Other) {
            let key = (p.pid, p.start);
            self.prev.insert(key, p.ticks);
            let cpu = prev.get(&key).map_or(0.0, |&t| cpu_pct(t, p.ticks, s.dt));
            if p.kind != Kind::Root && top.as_ref().is_none_or(|t| cpu > t.0) {
                top = Some((cpu, p.name.clone(), p.pid));
            }
            if matches!(p.kind, Kind::Build | Kind::Watched) && p.root.is_some() && cpu >= self.cfg.renice_cpu_pct && !s.protect.contains(&p.pid) {
                heavy.push((p.pid, p.start, p.name.clone()));
            }
            let rss_mb = p.rss / (1024 * 1024);
            let act_for = |this: &Engine| if this.may_kill(s, p) { "kill" } else { "warn" };
            match p.kind {
                Kind::Root => {
                    let over = rss_mb > self.cfg.claude_rss_mb;
                    if self.rss.entry(key).or_default().update(s.now, over, 0.0) {
                        let msg = format!("{} (pid {}) uses {rss_mb} MB RAM (warn above {} MB)", p.name, p.pid, self.cfg.claude_rss_mb);
                        let a = self.alert(s, Some(p), "claude_rss", "rss_mb", rss_mb as f64, self.cfg.claude_rss_mb as f64, "warn", msg, "consider /compact or a fresh session; the watchdog never kills claude or omp.");
                        out.alerts.push(a);
                    }
                }
                Kind::Helper | Kind::Watched => {
                    let helper = p.kind == Kind::Helper;
                    let window = if helper { self.cfg.cpu_sustain_secs } else { self.cfg.watched_cpu_sustain_secs };
                    if self.cpu.entry(key).or_default().update(s.now, cpu > self.cfg.cpu_pct, window) {
                        let verdict = if act_for(self) == "kill" { self.terminate(s, p, &mut out) } else { "warn only".into() };
                        let verb = if verdict.starts_with("SIGTERM") { "killed" } else if verdict.starts_with("dry-run") { "dry-run" } else { "warn" };
                        let msg = format!("{} (pid {}) used {cpu:.0}% CPU for {window:.0} s → {verdict}", p.name, p.pid);
                        let sug = suggest_for(helper, &p.name);
                        let a = self.alert(s, Some(p), "cpu", "cpu_pct", cpu, self.cfg.cpu_pct, verb, msg, &sug);
                        out.alerts.push(a);
                    }
                    let over = rss_mb > self.cfg.helper_rss_mb;
                    if self.rss.entry(key).or_default().update(s.now, over, self.cfg.rss_sustain_secs) {
                        let verdict = if act_for(self) == "kill" { self.terminate(s, p, &mut out) } else { "warn only".into() };
                        let verb = if verdict.starts_with("SIGTERM") { "killed" } else if verdict.starts_with("dry-run") { "dry-run" } else { "warn" };
                        let msg = format!("{} (pid {}) holds {rss_mb} MB RAM (limit {} MB) → {verdict}", p.name, p.pid, self.cfg.helper_rss_mb);
                        let a = self.alert(s, Some(p), "rss", "rss_mb", rss_mb as f64, self.cfg.helper_rss_mb as f64, verb, msg, &suggest_for(helper, &p.name));
                        out.alerts.push(a);
                    }
                    if p.gpu_mb > 0 && self.gpu.entry(key).or_default().update(s.now, p.gpu_mb > self.cfg.gpu_mem_mb, 0.0) {
                        let msg = format!("{} (pid {}) holds {} MB GPU memory (limit {} MB)", p.name, p.pid, p.gpu_mb, self.cfg.gpu_mem_mb);
                        let a = self.alert(s, Some(p), "gpu", "gpu_mb", p.gpu_mb as f64, self.cfg.gpu_mem_mb as f64, "warn", msg, "free the GPU by stopping the model / worker that owns it.");
                        out.alerts.push(a);
                    }
                    // a quarantined helper that came back is killed on sight
                    if helper && self.blocked.contains(&p.name) && self.may_kill(s, p) && !self.dry {
                        out.acts.push(Act::Term(p.pid, p.start));
                        self.pending.insert(key, s.now);
                        let msg = format!("{} (pid {}) is blocked (respawned after quarantine) → SIGTERM", p.name, p.pid);
                        let a = self.alert(s, Some(p), "blocked_seen", "blocked", 1.0, 0.0, "killed", msg, &helper_suggest(&p.name));
                        out.alerts.push(a);
                    }
                }
                Kind::Build | Kind::Other => {}
            }
        }

        // machine-wide
        let tops = top.map(|(c, n, pid)| format!("; busiest session process: {n} pid {pid} {c:.0}% CPU")).unwrap_or_default();
        let over = s.avail_pct < self.cfg.mem_avail_pct;
        if self.mem.update(s.now, over, self.cfg.sys_sustain_secs) {
            let msg = format!("machine MemAvailable {:.0}% (< {:.0}%) for {:.0} s{tops}", s.avail_pct, self.cfg.mem_avail_pct, self.cfg.sys_sustain_secs);
            let a = self.alert(s, None, "mem", "mem_avail_pct", s.avail_pct, self.cfg.mem_avail_pct, "warn", msg, "pause heavy work and close idle sessions.");
            out.alerts.push(a);
        }
        let limit = self.cfg.load_factor * s.cores;
        if self.load.update(s.now, s.load > limit, self.cfg.sys_sustain_secs) {
            let msg = format!("load average {:.1} (> {limit:.0} = {}x {:.0} cores) for {:.0} s{tops}", s.load, self.cfg.load_factor, s.cores, self.cfg.sys_sustain_secs);
            let a = self.alert(s, None, "load", "load1", s.load, limit, "warn", msg, "pause heavy work; check `ps -eo pid,pcpu,args --sort=-pcpu | head`.");
            out.alerts.push(a);
        }
        // cpu "some" is high in any parallel build: it only triggers the renice, not an alert
        let psi_alert = s.psi_mem >= self.cfg.psi_mem_full_pct || s.psi_io >= self.cfg.psi_io_full_pct;
        let psi_over = psi_alert || s.psi_cpu >= self.cfg.psi_cpu_some_pct;
        if self.psi.update(s.now, psi_alert, self.cfg.sys_sustain_secs.min(20.0)) {
            let msg = format!("machine pressure (PSI avg10): memory full {:.0}%, io full {:.0}%, cpu some {:.0}%{tops}", s.psi_mem, s.psi_io, s.psi_cpu);
            let a = self.alert(s, None, "pressure", "psi", s.psi_mem.max(s.psi_io).max(s.psi_cpu), self.cfg.psi_mem_full_pct, "warn", msg, THROTTLE);
            out.alerts.push(a);
        }
        if let Some((busy, vram, label)) = &s.gpu {
            let over = *vram >= self.cfg.gpu_vram_pct || *busy >= self.cfg.gpu_busy_pct;
            if self.gpu_sys.update(s.now, over, self.cfg.sys_sustain_secs) {
                let msg = format!("GPU {label}: busy {busy:.0}%, VRAM {vram:.0}% for {:.0} s", self.cfg.sys_sustain_secs);
                let a = self.alert(s, None, "gpu_machine", "vram_pct", *vram, self.cfg.gpu_vram_pct, "warn", msg, "stop the model/worker holding the GPU, or run it on CI / a remote box.");
                out.alerts.push(a);
            }
        }
        // soft remedy: under sustained pressure, lower the priority of busy session processes
        let pressured = s.avail_pct < self.cfg.mem_avail_pct || s.load > limit || psi_over;
        self.pressure_since = if pressured { self.pressure_since.or(Some(s.now)) } else { None };
        let active = self.pressure_since.is_some_and(|t| s.now - t >= self.cfg.renice_after_secs);
        if active && self.cfg.auto_renice && self.dry {
            let fresh: Vec<_> = heavy.iter().filter(|(pid, start, _)| self.reniced.insert((*pid, *start))).map(|(pid, _, n)| format!("{n}({pid})")).collect();
            if !fresh.is_empty() {
                let msg = format!("dry-run: would renice {} busy session process(es): {}", fresh.len(), fresh.join(", "));
                let a = self.alert(s, None, "renice", "procs", fresh.len() as f64, 0.0, "dry-run", msg, THROTTLE);
                out.alerts.push(a);
            }
        } else if active && self.cfg.auto_renice {
            let fresh: Vec<_> = heavy.into_iter().filter(|(pid, start, _)| self.reniced.insert((*pid, *start))).collect();
            if !fresh.is_empty() {
                let names: Vec<String> = fresh.iter().take(6).map(|(pid, _, n)| format!("{n}({pid})")).collect();
                out.acts.extend(fresh.iter().map(|(pid, start, _)| Act::Renice(*pid, *start)));
                let msg = format!("machine under pressure → lowered priority (nice 19, idle IO) of {} busy session process(es): {}", fresh.len(), names.join(", "));
                let a = self.alert(s, None, "renice", "procs", fresh.len() as f64, 0.0, "reniced", msg, THROTTLE);
                out.alerts.push(a);
            }
        }
        out
    }
}

// ───────────────────────── sampling (/proc) ─────────────────────────

struct Ident {
    start: u64,
    ppid: u32,
    name: String,
    kind: Kind,
    cwd: Option<String>,
    mine: bool,
}

struct Sampler {
    cfg: Config,
    /// by pid; `Other` entries are trusted for ~15 ticks so an idle machine costs a listing, not 600 reads
    idents: HashMap<u32, Ident>,
    tick: u64,
    last: Option<Instant>,
    t0: Instant,
    uid: Option<u32>,
    cores: f64,
    nvidia: Option<PathBuf>,
    gpu_at: Option<Instant>,
    gpu: HashMap<u32, u64>,
    last_gpu: Option<(f64, f64, String)>,
}

fn read(path: String) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn uid_of(path: &str) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        fs::metadata(path).ok().map(|m| m.uid())
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

fn load_ident(st: &Stat, cfg: &Config, uid: Option<u32>) -> Ident {
    let pid = st.pid;
    let exe = fs::read_link(format!("/proc/{pid}/exe")).ok().and_then(|p| {
        p.file_name().map(|n| n.to_string_lossy().trim_end_matches(" (deleted)").to_string())
    });
    let cmd = fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    let args: Vec<String> = cmd.split(|b| *b == 0).filter(|a| !a.is_empty()).take(5).map(|a| String::from_utf8_lossy(a).into_owned()).collect();
    let (kind, name) = classify(&names_of(exe.as_deref(), &st.comm, &args), cfg);
    let cwd = (kind == Kind::Root).then(|| fs::read_link(format!("/proc/{pid}/cwd")).ok().map(|p| p.display().to_string())).flatten();
    Ident { start: st.start, ppid: st.ppid, name, kind, cwd, mine: uid.is_none() || uid_of(&format!("/proc/{pid}")) == uid }
}

impl Sampler {
    fn new(cfg: Config) -> Sampler {
        Sampler {
            cfg,
            idents: HashMap::new(),
            tick: 0,
            last: None,
            t0: Instant::now(),
            uid: uid_of("/proc/self"),
            cores: machine_cores(),
            nvidia: which::which("nvidia-smi").ok(),
            gpu_at: None,
            gpu: HashMap::new(),
            last_gpu: None,
        }
    }

    fn sample_gpu(&mut self) {
        let Some(bin) = &self.nvidia else { return };
        if self.gpu_at.is_some_and(|t| t.elapsed() < Duration::from_secs(10)) {
            return;
        }
        self.gpu_at = Some(Instant::now());
        self.gpu = Command::new(bin)
            .args(["--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map(|o| parse_nvidia(&String::from_utf8_lossy(&o.stdout)).into_iter().collect())
            .unwrap_or_default();
    }

    fn sample(&mut self) -> Snap {
        let now_i = Instant::now();
        let dt = self.last.map_or(0.0, |t| now_i.duration_since(t).as_secs_f64());
        self.last = Some(now_i);
        self.sample_gpu();
        let mut procs = Vec::new();
        let mut protect = HashSet::new();
        let me = std::process::id();
        let mut stats = HashMap::new();
        self.tick += 1;
        for e in fs::read_dir("/proc").into_iter().flatten().flatten() {
            let Some(pid) = e.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else { continue };
            // untracked processes: pid + parent never change, so skip the read until their re-check turn
            if let Some(id) = self.idents.get(&pid).filter(|i| i.kind == Kind::Other && !(self.tick + pid as u64).is_multiple_of(15)) {
                stats.insert(pid, Stat { pid, comm: String::new(), ppid: id.ppid, ticks: 0, start: id.start });
                continue;
            }
            if let Some(st) = parse_stat(&read(format!("/proc/{pid}/stat"))) {
                stats.insert(pid, st);
            }
        }
        let mut cur = me;
        for _ in 0..64 {
            protect.insert(cur);
            match stats.get(&cur) {
                Some(st) if st.ppid > 1 => cur = st.ppid,
                _ => break,
            }
        }
        let (cfg, uid) = (&self.cfg, self.uid);
        for st in stats.values() {
            if self.idents.get(&st.pid).is_none_or(|i| i.start != st.start || (i.kind == Kind::Other && !st.comm.is_empty())) {
                self.idents.insert(st.pid, load_ident(st, cfg, uid));
            }
            let id = &self.idents[&st.pid];
            if id.kind == Kind::Other || !id.mine {
                continue;
            }
            procs.push(P {
                pid: st.pid,
                start: st.start,
                ppid: st.ppid,
                ticks: st.ticks,
                rss: parse_statm_rss(&read(format!("/proc/{}/statm", st.pid))).unwrap_or(0),
                name: id.name.clone(),
                kind: id.kind,
                cwd: id.cwd.clone(),
                gpu_mb: self.gpu.get(&st.pid).copied().unwrap_or(0),
                root: None,
            });
        }
        self.idents.retain(|k, _| stats.contains_key(k));
        // roots need the full parent chain, which crosses untracked wrappers (shells)
        let idents = &self.idents;
        for p in procs.iter_mut() {
            p.root = root_of(
                p.pid,
                |c| stats.get(&c).map(|st| st.ppid),
                |c| idents.get(&c).is_some_and(|id| id.kind == Kind::Root),
            );
        }
        let (avail, total) = parse_meminfo(&read("/proc/meminfo".into())).unwrap_or((1, 1));
        let wall_ms = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        // AMD sysfs reads are cheap, but the GPU barely changes in 2 s: every 5th tick
        if self.tick % 5 == 1 {
            self.last_gpu = machine_gpu();
        }
        Snap {
            now: now_i.duration_since(self.t0).as_secs_f64(),
            dt,
            wall_ms,
            procs,
            avail_pct: avail as f64 / total.max(1) as f64 * 100.0,
            load: parse_loadavg(&read("/proc/loadavg".into())).unwrap_or(0.0),
            cores: self.cores,
            protect,
            psi_mem: parse_psi(&read("/proc/pressure/memory".into())).1,
            psi_io: parse_psi(&read("/proc/pressure/io".into())).1,
            psi_cpu: parse_psi(&read("/proc/pressure/cpu".into())).0,
            gpu: self.last_gpu.clone(),
        }
    }
}

// ───────────────────────── actions + I/O ─────────────────────────

fn set_private(path: &Path, mode: u32) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(mode));
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
}

fn ensure_private_dir(d: &Path) {
    let _ = fs::create_dir_all(d);
    set_private(d, 0o700);
}

/// Append one alert as a JSON line; the file is 0600 and rolled over past 512 KiB.
pub fn append_alert(paths: &Paths, a: &Alert) -> std::io::Result<()> {
    ensure_private_dir(&paths.state);
    if fs::metadata(&paths.alerts).is_ok_and(|m| m.len() > 512 * 1024) {
        let _ = fs::rename(&paths.alerts, paths.alerts.with_extension("jsonl.1"));
    }
    let new = !paths.alerts.exists();
    let mut f = fs::OpenOptions::new().create(true).append(true).open(&paths.alerts)?;
    if new {
        set_private(&paths.alerts, 0o600);
    }
    writeln!(f, "{}", a.to_json())
}

fn parse_blocked(s: &str) -> BTreeSet<String> {
    s.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(String::from).collect()
}

/// `None` on a read error other than "missing", so a transient failure never
/// clears quarantines.
fn try_read_blocked(paths: &Paths) -> Option<BTreeSet<String>> {
    match fs::read_to_string(&paths.blocked) {
        Ok(s) => Some(parse_blocked(&s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(BTreeSet::new()),
        Err(_) => None,
    }
}

fn read_blocked(paths: &Paths) -> BTreeSet<String> {
    try_read_blocked(paths).unwrap_or_default()
}

/// Read-modify-write of the blocked list under an exclusive lock, written via
/// tmp + rename, so the service (`Act::Block`) and `unblock` never lose each
/// other's change and a reader never sees a half-written file.
fn update_blocked<T>(paths: &Paths, f: impl FnOnce(&mut BTreeSet<String>) -> T) -> std::io::Result<T> {
    let dir = paths.blocked.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(dir)?;
    let lock = fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join("watchdog-blocked.lock"))?;
    lock.lock()?;
    let mut set = match fs::read_to_string(&paths.blocked) {
        Ok(s) => parse_blocked(&s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeSet::new(),
        Err(e) => return Err(e),
    };
    let out = f(&mut set);
    let tmp = paths.blocked.with_extension("tmp");
    let body: String = set.iter().map(|n| format!("{n}\n")).collect();
    fs::write(&tmp, body)?;
    fs::rename(&tmp, &paths.blocked)?;
    Ok(out)
}

/// Removes names from the blocked list; returns (removed, unknown).
pub fn unblock_names(cur: &BTreeSet<String>, names: &[String], all: bool) -> (BTreeSet<String>, Vec<String>, Vec<String>) {
    if all {
        return (BTreeSet::new(), cur.iter().cloned().collect(), Vec::new());
    }
    let mut keep = cur.clone();
    let (mut removed, mut unknown) = (Vec::new(), Vec::new());
    for n in names {
        if keep.remove(n) { removed.push(n.clone()) } else { unknown.push(n.clone()) }
    }
    (keep, removed, unknown)
}

fn unblock(paths: &Paths, names: &[String], all: bool) -> Result<()> {
    if names.is_empty() && !all {
        bail!("8sync watchdog unblock: name a helper (see `8sync watchdog status`) or pass --all");
    }
    let (removed, unknown) = update_blocked(paths, |set| {
        let (keep, removed, unknown) = unblock_names(set, names, all);
        *set = keep;
        (removed, unknown)
    })?;
    println!("unblocked {}", if removed.is_empty() { "nothing".into() } else { removed.join(", ") });
    if !unknown.is_empty() {
        println!("not blocked: {}", unknown.join(", "));
    }
    Ok(())
}

fn signal(sig: &str, pid: u32, start: u64) {
    // pid reuse guard: only signal the very process we measured
    let same = parse_stat(&read(format!("/proc/{pid}/stat"))).is_some_and(|s| s.start == start);
    if same && pid > 1 {
        let _ = Command::new("kill").arg(sig).arg(pid.to_string()).stdin(Stdio::null()).stderr(Stdio::null()).status();
    }
}

/// `renice 19` + `ionice -c3` on the very process we measured (pid-reuse guard as in `signal`).
fn renice(pid: u32, start: u64) {
    let same = parse_stat(&read(format!("/proc/{pid}/stat"))).is_some_and(|s| s.start == start);
    if same && pid > 1 {
        let q = |c: &mut Command| {
            let _ = c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
        };
        // Linux priorities are per thread: touch every task of the process (rustc, ld, node are multithreaded)
        let mut tids: Vec<String> = fs::read_dir(format!("/proc/{pid}/task")).into_iter().flatten().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|t| t.bytes().all(|b| b.is_ascii_digit())).collect();
        if tids.is_empty() {
            tids.push(pid.to_string());
        }
        q(Command::new("renice").args(["-n", "19", "-p"]).args(&tids));
        for t in &tids {
            q(Command::new("ionice").args(["-c", "3", "-p", t]));
        }
    }
}

fn notify(a: &Alert) {
    if let Ok(mut c) = Command::new("notify-send").args(["-u", "critical", "-a", "8sync", "8sync watchdog", &a.msg]).stdin(Stdio::null()).stderr(Stdio::null()).spawn() {
        std::thread::spawn(move || {
            let _ = c.wait();
        });
    }
}

fn run_loop(paths: &Paths, config: Option<&Path>, dry: bool) -> Result<()> {
    if !cfg!(target_os = "linux") {
        bail!("8sync watchdog run: not supported yet on this OS (needs /proc)");
    }
    let cfg = Config::load(config.unwrap_or(&paths.config));
    ensure_private_dir(&paths.state);
    ensure_private_dir(&paths.cursors);
    prune_cursors(paths);
    let have_notify = cfg.notify && !dry && which::which("notify-send").is_ok();
    let period = Duration::from_secs_f64(cfg.period_secs.clamp(0.5, 60.0));
    let mut engine = Engine::new(cfg.clone(), dry, read_blocked(paths));
    let mut sampler = Sampler::new(cfg);
    println!(
        "8sync watchdog: {} · period {:?} · alerts → {}{}",
        if dry { "DRY RUN (never signals)" } else { "active" },
        period,
        paths.alerts.display(),
        if sampler.nvidia.is_some() { " · GPU sampling on" } else { "" }
    );
    loop {
        let t = Instant::now();
        let snap = sampler.sample();
        if let Some(b) = try_read_blocked(paths) {
            engine.set_blocked(b);
        }
        let out = engine.step(&snap);
        for a in &out.alerts {
            println!("[{}] {} · {}", a.kind, a.msg, a.action);
            let _ = append_alert(paths, a);
            if have_notify {
                notify(a);
            }
        }
        for act in out.acts {
            if dry {
                continue; // belt and braces: the engine emits no acts in dry-run either
            }
            match act {
                Act::Term(pid, start) => signal("-TERM", pid, start),
                Act::Kill(pid, start) => signal("-KILL", pid, start),
                Act::Renice(pid, start) => renice(pid, start),
                Act::Block(name) => {
                    let _ = update_blocked(paths, |b| {
                        b.insert(name.clone());
                    });
                    println!("blocked helper: {name} — `8sync watchdog unblock {name}` allows it again");
                }
            }
        }
        std::thread::sleep(period.saturating_sub(t.elapsed()));
    }
}

fn prune_cursors(paths: &Paths) {
    let week = Duration::from_secs(7 * 86400);
    for e in fs::read_dir(&paths.cursors).into_iter().flatten().flatten() {
        if e.metadata().and_then(|m| m.modified()).ok().and_then(|m| m.elapsed().ok()).is_some_and(|age| age > week) {
            let _ = fs::remove_file(e.path());
        }
    }
}

// ───────────────────────── hook (Claude Code) ─────────────────────────

/// Hook-side: this process's nearest `claude`/`omp` ancestor.
fn my_session_root(cfg: &Config) -> Option<u32> {
    let mut cur = parse_stat(&read("/proc/self/stat".into()))?.ppid;
    for _ in 0..64 {
        let st = parse_stat(&read(format!("/proc/{cur}/stat")))?;
        if load_ident(&st, cfg, None).kind == Kind::Root {
            return Some(cur);
        }
        if st.ppid <= 1 {
            return None;
        }
        cur = st.ppid;
    }
    None
}

pub(crate) use ccc_core::transcript::safe_id;

/// `8sync ccc hook watchdog` (UserPromptSubmit + PostToolUse). Returns the hook JSON
/// when this session has unseen, relevant alerts. Nothing to say = no output and no
/// side effects; the cost is one small file read.
pub fn hook_output(input: &str, paths: &Paths, now_s: u64, my_root: impl FnOnce() -> Option<u32>) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let sid = safe_id(v["session_id"].as_str()?)?;
    let event = v["hook_event_name"].as_str().filter(|e| matches!(*e, "UserPromptSubmit" | "PostToolUse")).unwrap_or("PostToolUse");
    let cursor_file = paths.cursors.join(&sid);
    let cursor: Option<u64> = fs::read_to_string(&cursor_file).ok().and_then(|s| s.trim().parse().ok());
    let text = fs::read_to_string(&paths.alerts).ok()?;
    let mut fresh: Vec<Alert> = Vec::new();
    for line in text.lines().rev() {
        let Some(a) = Alert::from_line(line) else { continue };
        // first call of a session: only what is recent, not the whole history
        if cursor.map_or(a.ts + 300 < now_s, |c| a.id <= c) {
            break;
        }
        fresh.push(a);
    }
    fresh.reverse();
    let newest = fresh.last()?.id;
    let root = my_root();
    let mut shown: Vec<(Alert, bool)> = Vec::new();
    for a in fresh {
        let mine = root.is_some_and(|r| a.root_pid == r);
        if !(mine || a.root_pid == 0) {
            continue;
        }
        match shown.iter().position(|(x, _)| x.exe == a.exe && x.kind == a.kind) {
            Some(i) => shown[i] = (a, mine),
            None => shown.push((a, mine)),
        }
    }
    ensure_private_dir(&paths.cursors);
    let _ = fs::write(&cursor_file, newest.to_string());
    set_private(&cursor_file, 0o600);
    if shown.is_empty() {
        return None;
    }
    let mut body = shown
        .iter()
        .map(|(a, mine)| {
            let scope = if *mine { " [process of this session]" } else if a.root_pid == 0 { " [machine-wide]" } else { "" };
            format!("⚠ 8sync watchdog: {}{scope}. Suggest: {}", a.msg, a.suggest)
        })
        .collect::<Vec<_>>()
        .join("\n");
    if body.chars().count() > HOOK_MAX_CHARS {
        body = body.chars().take(HOOK_MAX_CHARS - 1).collect::<String>() + "…";
    }
    Some(json!({ "hookSpecificOutput": { "hookEventName": event, "additionalContext": body } }).to_string())
}

/// Entry from `ccc hook watchdog`.
pub fn run_hook(input: &str) -> Option<String> {
    let paths = Paths::at(&dirs::home_dir()?);
    if !paths.alerts.exists() {
        return None; // nothing was ever alerted: no work
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs();
    hook_output(input, &paths, now, || my_session_root(&Config::default()))
}

// ───────────────────────── service ─────────────────────────

pub fn unit_text(exe: &str) -> String {
    format!(
        "[Unit]\nDescription=8sync watchdog: protects the machine from runaway harness helpers\n\n\
[Service]\nType=simple\nExecStart={exe} watchdog run\nRestart=on-failure\nRestartSec=5\nNice=10\nCPUQuota=5%\nMemoryMax=64M\n\n\
[Install]\nWantedBy=default.target\n"
    )
}

fn unit_path() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("systemd/user").join(UNIT))
}

fn systemctl(args: &[&str]) -> bool {
    Command::new("systemctl").arg("--user").args(args).stdin(Stdio::null()).status().is_ok_and(|s| s.success())
}

fn install(paths: &Paths) -> Result<()> {
    if !cfg!(target_os = "linux") {
        println!("8sync watchdog install: not supported yet on this OS (status works)");
        return Ok(());
    }
    let exe = which::which(crate::brand::CMD).or_else(|_| std::env::current_exe()).context("locate the 8sync binary")?;
    let unit = unit_path().context("no config dir")?;
    fs::create_dir_all(unit.parent().context("unit dir")?)?;
    fs::write(&unit, unit_text(&exe.display().to_string()))?;
    Config::load(&paths.config); // creates the defaults file
    systemctl(&["daemon-reload"]);
    if !systemctl(&["enable", "--now", UNIT]) {
        bail!("systemctl --user enable --now {UNIT} failed (is a user systemd session running?)");
    }
    ui::ok(&format!("watchdog running as {UNIT} · thresholds {} · alerts {}", paths.config.display(), paths.alerts.display()));
    ui::info("Claude Code reads alerts via the kit hook: run `8sync ccc kit` once to register `ccc hook watchdog`");
    Ok(())
}

fn uninstall() -> Result<()> {
    if !cfg!(target_os = "linux") {
        println!("8sync watchdog uninstall: not supported yet on this OS");
        return Ok(());
    }
    systemctl(&["disable", "--now", UNIT]);
    if let Some(u) = unit_path() {
        let _ = fs::remove_file(u);
    }
    systemctl(&["daemon-reload"]);
    ui::ok("watchdog service removed (config and alerts kept)");
    Ok(())
}

fn status(paths: &Paths) -> Result<()> {
    let svc = if cfg!(target_os = "linux") {
        let o = Command::new("systemctl").args(["--user", "is-active", UNIT]).stderr(Stdio::null()).output();
        o.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_else(|_| "unknown (no systemctl)".into())
    } else {
        "not supported yet on this OS".into()
    };
    println!("service   {UNIT}: {svc}");
    println!("config    {} ({})", paths.config.display(), if paths.config.exists() { "present" } else { "defaults; created on first run" });
    let nv = which::which("nvidia-smi").is_ok();
    let nv_card = Path::new("/proc/driver/nvidia/version").exists() || fs::read_dir("/sys/bus/pci/devices").into_iter().flatten().flatten().any(|d| {
        fs::read_to_string(d.path().join("vendor")).is_ok_and(|v| v.trim() == "0x10de") && fs::read_to_string(d.path().join("class")).is_ok_and(|c| c.starts_with("0x03"))
    });
    let amd = machine_gpu().map(|(b, v, l)| format!("{l} busy {b:.0}% VRAM {v:.0}%"));
    let nvs = match (nv_card, nv) {
        (true, true) => "NVIDIA per-process VRAM via nvidia-smi".to_string(),
        (true, false) => "NVIDIA card present but not measured (no nvidia-smi: install the NVIDIA driver utils)".into(),
        _ => String::new(),
    };
    let gpus: Vec<String> = [amd.unwrap_or_default(), nvs].into_iter().filter(|x| !x.is_empty()).collect();
    println!("gpu       {}", if gpus.is_empty() { "none readable".into() } else { gpus.join(" · ") });
    let (ms, mf) = parse_psi(&read("/proc/pressure/memory".into()));
    println!("pressure  memory some {ms:.1}% full {mf:.1}% · io full {:.1}% · cpu some {:.1}% (avg10)", parse_psi(&read("/proc/pressure/io".into())).1, parse_psi(&read("/proc/pressure/cpu".into())).0);
    let blocked = read_blocked(paths);
    println!("blocked   {}", if blocked.is_empty() { "none".into() } else { blocked.into_iter().collect::<Vec<_>>().join(", ") });
    let text = fs::read_to_string(&paths.alerts).unwrap_or_default();
    let all: Vec<Alert> = text.lines().filter_map(Alert::from_line).collect();
    println!("alerts    {} in {}", all.len(), paths.alerts.display());
    for a in all.iter().rev().take(5).rev() {
        println!("  [{}] {} · {}", a.kind, a.msg, a.action);
    }
    Ok(())
}

// ───────────────────────── tests ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const STAT: &str = "119579 (head (room) mcp) S 4242 119579 119579 0 -1 4194560 100 0 0 0 7000 1500 0 0 20 0 9 0 5555 1000 2000 18446744073709551615 0 0 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0";

    fn tmp(tag: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static N: AtomicU32 = AtomicU32::new(0);
        let d = std::env::temp_dir().join(format!("8sync-wd-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn proc(pid: u32, ppid: u32, name: &str, kind: Kind, ticks: u64, rss_mb: u64) -> P {
        P { pid, start: pid as u64 * 10, ppid, ticks, rss: rss_mb * 1024 * 1024, name: name.into(), kind, cwd: Some("/work/repo".into()), gpu_mb: 0, root: None }
    }

    fn snap(now: f64, procs: Vec<P>) -> Snap {
        let mut procs = procs;
        let roots: Vec<_> = procs.iter().map(|p| root_of(p.pid, |c| procs.iter().find(|x| x.pid == c).map(|x| x.ppid), |c| procs.iter().any(|x| x.pid == c && x.kind == Kind::Root))).collect();
        procs.iter_mut().zip(roots).for_each(|(p, r)| p.root = r);
        Snap { now, dt: 2.0, wall_ms: 1_000_000 + (now * 1000.0) as u64, procs, avail_pct: 50.0, load: 1.0, cores: 8.0, protect: HashSet::from([1]), ..Default::default() }
    }

    /// claude(100) → helper hr(200) burning `ticks_per_step` ticks every 2 s step.
    fn burn_world(now: f64, step: u64) -> Snap {
        snap(now, vec![proc(100, 1, "claude", Kind::Root, 10, 500), proc(200, 100, "headroom", Kind::Helper, step * (now as u64 / 2 + 1), 800)])
    }

    #[test]
    fn proc_parsers_on_fixtures() {
        let st = parse_stat(STAT).unwrap();
        assert_eq!((st.pid, st.comm.as_str(), st.ppid, st.ticks, st.start), (119579, "head (room) mcp", 4242, 8500, 5555));
        assert_eq!(parse_statm_rss("5000 2000 100 1 0 300 0"), Some(2000 * 4096));
        let mi = "MemTotal:       32000000 kB\nMemFree: 1 kB\nMemAvailable:    3200000 kB\n";
        assert_eq!(parse_meminfo(mi), Some((3_200_000, 32_000_000)));
        assert_eq!(parse_loadavg("49.12 30.00 20.00 3/900 1234\n"), Some(49.12));
        assert_eq!(parse_nvidia("119579, 2048\n 77, 12\nbad\n"), vec![(119579, 2048), (77, 12)]);
        assert!(parse_stat("garbage").is_none());
    }

    #[test]
    fn psi_and_amdgpu_parsers() {
        let mem = "some avg10=7.66 avg60=8.93 avg300=6.21 total=61092211\nfull avg10=6.76 avg60=7.55 avg300=5.15 total=51328271\n";
        assert_eq!(parse_psi(mem), (7.66, 6.76));
        assert_eq!(parse_psi("some avg10=3.89 avg60=4.48 avg300=6.98 total=1\n"), (3.89, 0.0));
        assert_eq!(parse_psi(""), (0.0, 0.0));
        assert_eq!(parse_amdgpu("37\n", "536870912\n", "2147483648\n"), Some((37.0, 25.0)));
        assert_eq!(parse_amdgpu("", "1", "2"), None, "no busy file → not an amdgpu card");
        assert_eq!(parse_amdgpu("5", "x", "0"), Some((5.0, 0.0)));
    }

    #[test]
    fn builds_are_reniced_once_under_pressure_never_killed() {
        let cfg = Config::default();
        assert_eq!(classify(&names(&["rustc"]), &cfg).0, Kind::Build);
        assert_eq!(classify(&names(&["claude"]), &cfg).0, Kind::Root);
        let world = |now: f64, avail: f64| {
            let procs = vec![
                proc(100, 1, "claude", Kind::Root, 0, 500),
                proc(200, 100, "rustc", Kind::Build, (now as u64) * 100, 900), // ~100% CPU, under the session
                proc(300, 1, "rustc", Kind::Build, (now as u64) * 100, 900),   // same burn, not under a session
            ];
            let mut s = snap(now, procs);
            s.avail_pct = avail;
            s
        };
        let run = |e: &mut Engine, avail: f64| {
            let mut acts = Vec::new();
            let mut kinds = Vec::new();
            for i in 0..10 {
                let o = e.step(&world(i as f64 * 2.0, avail));
                acts.extend(o.acts);
                kinds.extend(o.alerts.into_iter().map(|a| a.kind));
            }
            (acts, kinds)
        };
        let (acts, kinds) = run(&mut Engine::new(cfg.clone(), false, BTreeSet::new()), 5.0);
        assert_eq!(acts, vec![Act::Renice(200, 2000)], "once, only the in-session build, no kill");
        assert_eq!(kinds.iter().filter(|k| *k == "renice").count(), 1);
        let (acts, _) = run(&mut Engine::new(cfg.clone(), false, BTreeSet::new()), 50.0);
        assert!(acts.is_empty(), "no pressure → nothing touched");
        let (acts, _) = run(&mut Engine::new(cfg.clone(), true, BTreeSet::new()), 5.0);
        assert!(acts.is_empty(), "dry-run");
        let off = Config { auto_renice: false, ..cfg };
        assert!(run(&mut Engine::new(off, false, BTreeSet::new()), 5.0).0.is_empty());
    }

    #[test]
    fn psi_pressure_and_machine_gpu_warn() {
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let mut kinds = Vec::new();
        for i in 0..20 {
            let mut s = snap(i as f64 * 2.0, vec![proc(100, 1, "claude", Kind::Root, 0, 1)]);
            s.psi_mem = 12.0;
            s.gpu = Some((10.0, 95.0, "amdgpu card1".into()));
            kinds.extend(e.step(&s).alerts.into_iter().map(|a| a.kind));
        }
        assert_eq!(kinds.iter().filter(|k| *k == "pressure").count(), 1);
        assert_eq!(kinds.iter().filter(|k| *k == "gpu_machine").count(), 1);
    }

    #[test]
    fn cores_come_from_proc_stat_not_the_cgroup_quota() {
        let stat = "cpu  1 2 3\ncpu0 1 2 3\ncpu1 1 2 3\ncpu15 1\nintr 5\nctxt 9\n";
        assert_eq!(parse_cores(stat), 3);
        assert_eq!(parse_cores(""), 0);
        #[cfg(target_os = "linux")]
        assert!(machine_cores() >= 1.0);
    }

    #[test]
    fn cpu_percent_delta_math() {
        assert_eq!(cpu_pct(1000, 1200, 2.0), 100.0); // 200 ticks = 2 s of CPU in 2 s
        assert_eq!(cpu_pct(0, 566, 2.0), 283.0);
        assert_eq!(cpu_pct(500, 100, 2.0), 0.0, "counter reset");
        assert_eq!(cpu_pct(0, 100, 0.0), 0.0);
    }

    #[test]
    fn classify_allowlist_never_claude_or_omp() {
        let mut cfg = Config::default();
        cfg.helpers.push("claude".into());
        cfg.helpers.push("omp".into());
        cfg.helpers.push("node".into());
        assert_eq!(classify(&names(&["claude"]), &cfg).0, Kind::Root);
        assert_eq!(classify(&names(&["bun", "bun", "bun", "omp"]), &cfg).0, Kind::Root);
        let args = names(&["node", "/x/node_modules/typescript/lib/tsserver.js", "--stdio"]);
        let n = names_of(Some("node"), "node", &args);
        assert_eq!(n, names(&["node", "tsserver"]));
        assert_eq!(classify(&n, &cfg), (Kind::Helper, "tsserver".into()));
        // a helper list entry that is a protected runtime/editor never becomes killable
        assert_eq!(classify(&names(&["node"]), &cfg).0, Kind::Watched);
        assert_eq!(classify(&names(&["headroom"]), &cfg).0, Kind::Helper);
        assert_eq!(classify(&names(&["firefox"]), &cfg).0, Kind::Other);
        assert_eq!(classify(&names(&["cargo"]), &cfg).0, Kind::Build, "builds are reniced, never killed");
    }

    #[test]
    fn tree_roots_cross_wrappers() {
        let ps = [
            proc(100, 1, "claude", Kind::Root, 0, 1),
            proc(150, 100, "sh", Kind::Other, 0, 1),
            proc(200, 150, "gopls", Kind::Helper, 0, 1),
            proc(300, 1, "headroom", Kind::Helper, 0, 1),
            proc(400, 100, "omp", Kind::Root, 0, 1),
            proc(500, 200, "node", Kind::Watched, 0, 1),
        ];
        let parent = |c: u32| ps.iter().find(|p| p.pid == c).map(|p| p.ppid);
        let is_root = |c: u32| ps.iter().any(|p| p.pid == c && p.kind == Kind::Root);
        let r: Vec<_> = ps.iter().map(|p| root_of(p.pid, parent, is_root)).collect();
        assert_eq!(r, vec![Some(100), Some(100), Some(100), None, Some(400), Some(100)]);
        assert_eq!(root_of(7, |_| Some(7), |_| false), None, "self-parent loop terminates");
    }

    #[test]
    fn sustain_window_fires_once_per_episode() {
        let mut s = Sustain::default();
        assert!(!s.update(0.0, true, 20.0));
        assert!(!s.update(10.0, true, 20.0));
        assert!(s.update(20.0, true, 20.0));
        assert!(!s.update(22.0, true, 20.0), "no repeat while still over");
        assert!(!s.update(24.0, false, 20.0), "dip resets");
        assert!(!s.update(26.0, true, 20.0));
        assert!(s.update(46.0, true, 20.0));
    }

    fn run_burn(engine: &mut Engine, until: f64) -> Vec<(f64, Out)> {
        let mut res = Vec::new();
        let mut t = 0.0;
        while t <= until {
            res.push((t, engine.step(&burn_world(t, 566)))); // 283% CPU
            t += 2.0;
        }
        res
    }

    #[test]
    fn engine_cpu_alert_then_sigterm_then_sigkill() {
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let res = run_burn(&mut e, 40.0);
        let first = res.iter().find(|(_, o)| !o.alerts.is_empty()).unwrap();
        assert!(first.0 >= 20.0, "not before the 20 s window: {}", first.0);
        let a = &first.1.alerts[0];
        assert_eq!((a.kind.as_str(), a.exe.as_str(), a.pid, a.root_pid, a.action.as_str()), ("cpu", "headroom", 200, 100, "killed"));
        assert!(a.value > 280.0 && a.msg.contains("283% CPU for 20 s"));
        assert_eq!(first.1.acts, vec![Act::Term(200, 2000)]);
        let kill = res.iter().find(|(_, o)| o.acts.contains(&Act::Kill(200, 2000))).unwrap();
        assert!((kill.0 - first.0 - 10.0).abs() < 2.1, "SIGKILL ~10 s after SIGTERM: {} vs {}", kill.0, first.0);
        assert!(res.iter().all(|(_, o)| o.alerts.iter().filter(|a| a.kind == "cpu").count() <= 1));
    }

    #[test]
    fn engine_respects_dry_run_and_auto_kill_false() {
        let mut dry = Engine::new(Config::default(), true, BTreeSet::new());
        let res = run_burn(&mut dry, 40.0);
        assert!(res.iter().all(|(_, o)| o.acts.is_empty()));
        assert!(res.iter().flat_map(|(_, o)| &o.alerts).any(|a| a.action.contains("dry-run") || a.msg.contains("dry-run")));
        let cfg = Config { auto_kill: false, ..Config::default() };
        let mut warn = Engine::new(cfg, false, BTreeSet::new());
        let res = run_burn(&mut warn, 40.0);
        assert!(res.iter().all(|(_, o)| o.acts.is_empty()));
        assert!(res.iter().flat_map(|(_, o)| &o.alerts).any(|a| a.kind == "cpu" && a.action == "warn"));
    }

    #[test]
    fn engine_never_signals_roots_or_non_helpers() {
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let mut all = Vec::new();
        for i in 0..40u64 {
            let t = i as f64 * 2.0;
            let procs = vec![
                proc(100, 1, "claude", Kind::Root, 800 * i, 6000), // 6 GB and 400% CPU
                proc(300, 100, "node", Kind::Watched, 800 * i, 3000),
                proc(400, 100, "omp", Kind::Root, 800 * i, 100),
            ];
            all.push(e.step(&snap(t, procs)));
        }
        assert!(all.iter().all(|o| o.acts.is_empty()), "no signals for root/watched");
        let alerts: Vec<_> = all.iter().flat_map(|o| &o.alerts).collect();
        assert!(alerts.iter().any(|a| a.kind == "claude_rss" && a.exe == "claude"));
        assert!(alerts.iter().any(|a| a.kind == "cpu" && a.exe == "node" && a.action == "warn"));
        assert!(alerts.iter().any(|a| a.kind == "rss" && a.exe == "node"));
    }

    #[test]
    fn engine_protects_watchdog_ancestry() {
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let mut protect_world = |t: f64| {
            let mut s = burn_world(t, 566);
            s.protect.insert(200);
            e.step(&s)
        };
        let outs: Vec<_> = (0..20).map(|i| protect_world(i as f64 * 2.0)).collect();
        assert!(outs.iter().all(|o| o.acts.is_empty()));
    }

    #[test]
    fn respawn_quarantine_after_more_than_three_kills() {
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let mut blocked_at = None;
        let mut kills = 0;
        // a fresh pid every 30 s, each burning from birth
        'outer: for gen in 0..6u32 {
            let pid = 200 + gen;
            for i in 0..12u64 {
                let t = gen as f64 * 30.0 + i as f64 * 2.0;
                let procs = vec![proc(100, 1, "claude", Kind::Root, 0, 1), proc(pid, 100, "headroom", Kind::Helper, 566 * i, 100)];
                let o = e.step(&snap(t, procs));
                kills += o.acts.iter().filter(|a| matches!(a, Act::Term(..))).count();
                if let Some(Act::Block(n)) = o.acts.iter().find(|a| matches!(a, Act::Block(_))) {
                    assert_eq!(n, "headroom");
                    assert!(o.alerts.iter().any(|a| a.kind == "quarantine" && a.msg.contains("blocked")));
                    blocked_at = Some(gen);
                    break 'outer;
                }
            }
        }
        assert_eq!((blocked_at, kills), (Some(3), 4), "4th kill within 10 min quarantines");
        // once blocked, a new instance is terminated on sight
        let procs = vec![proc(100, 1, "claude", Kind::Root, 0, 1), proc(900, 100, "headroom", Kind::Helper, 0, 10)];
        let o = e.step(&snap(400.0, procs));
        assert_eq!(o.acts, vec![Act::Term(900, 9000)]);
    }

    #[test]
    fn unblock_clears_list_and_kill_history() {
        let set = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<BTreeSet<String>>();
        let cur = set(&["headroom", "tsserver"]);
        let (keep, rm, unk) = unblock_names(&cur, &["tsserver".into(), "gopls".into()], false);
        assert_eq!((keep, rm, unk), (set(&["headroom"]), vec!["tsserver".to_string()], vec!["gopls".to_string()]));
        let (keep, rm, _) = unblock_names(&cur, &[], true);
        assert!(keep.is_empty() && rm.len() == 2);

        let mut e = Engine::new(Config::default(), false, set(&["tsserver"]));
        e.kills.insert("tsserver".into(), vec![1.0, 2.0, 3.0, 4.0]);
        e.set_blocked(BTreeSet::new());
        assert!(e.blocked.is_empty() && !e.kills.contains_key("tsserver"), "unblocked helper starts clean");
        // a blocked-again helper keeps nothing stale either; a still-blocked one keeps its history
        e.kills.insert("gopls".into(), vec![1.0]);
        e.set_blocked(set(&["gopls"]));
        assert!(e.kills.contains_key("gopls"));
    }

    #[test]
    fn kill_only_inside_a_session_and_never_warn_only() {
        let burn = |e: &mut Engine, procs: &dyn Fn(u64) -> Vec<P>| {
            let mut acts = Vec::new();
            for i in 0..15u64 {
                let o = e.step(&snap(i as f64 * 2.0, procs(i)));
                acts.extend(o.acts);
            }
            acts
        };
        // a helper the owner runs outside any claude/omp tree (editor, terminal)
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let outside = burn(&mut e, &|i| vec![proc(300, 1, "headroom", Kind::Helper, 566 * i, 100)]);
        assert!(outside.is_empty(), "no session root → alert only: {outside:?}");
        // an LSP under a session indexes hard by design → alert only
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let lsp = burn(&mut e, &|i| vec![proc(100, 1, "claude", Kind::Root, 0, 1), proc(301, 100, "rust-analyzer", Kind::Helper, 566 * i, 100)]);
        assert!(lsp.is_empty(), "warn_only helper is never signalled: {lsp:?}");
        // the same burn by hr under a session is killed
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let hr = burn(&mut e, &|i| vec![proc(100, 1, "claude", Kind::Root, 0, 1), proc(302, 100, "headroom", Kind::Helper, 566 * i, 100)]);
        assert!(hr.contains(&Act::Term(302, 3020)));
    }

    #[test]
    fn blocked_file_updates_are_serialized() {
        let paths = Paths::at(&tmp("blk"));
        let hs: Vec<_> = (0..4)
            .map(|t| {
                let paths = paths.clone();
                std::thread::spawn(move || {
                    for i in 0..25 {
                        update_blocked(&paths, |b| {
                            b.insert(format!("h{t}-{i}"));
                        })
                        .unwrap();
                    }
                })
            })
            .collect();
        hs.into_iter().for_each(|h| h.join().unwrap());
        assert_eq!(read_blocked(&paths).len(), 100, "no lost update");
        unblock(&paths, &["h0-0".into()], false).unwrap();
        assert!(!read_blocked(&paths).contains("h0-0") && read_blocked(&paths).len() == 99);
        assert_eq!(try_read_blocked(&Paths::at(&tmp("none"))), Some(BTreeSet::new()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn signal_skips_a_reused_pid() {
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id();
        let start = parse_stat(&read(format!("/proc/{pid}/stat"))).unwrap().start;
        signal("-TERM", pid, start + 1); // wrong start time = a different process
        std::thread::sleep(Duration::from_millis(100));
        assert!(child.try_wait().unwrap().is_none(), "a pid with another start time must not be signalled");
        signal("-TERM", pid, start);
        assert!(child.wait().unwrap().code().is_none(), "terminated by signal");
    }

    #[test]
    fn helper_remedy_names_the_unblock_switch() {
        assert!(helper_suggest("headroom").contains("keep that helper off"));
        assert!(suggest_for(false, "node").contains("only reports") && !suggest_for(false, "node").contains("helper off"));
        let other = helper_suggest("gopls");
        assert!(!other.contains("8sync harness") && other.contains("8sync watchdog unblock"));
    }

    #[test]
    fn system_pressure_warns_after_window() {
        let mut e = Engine::new(Config::default(), false, BTreeSet::new());
        let mut kinds = Vec::new();
        for i in 0..20 {
            let mut s = snap(i as f64 * 2.0, vec![proc(100, 1, "claude", Kind::Root, 0, 1)]);
            s.avail_pct = 6.0;
            s.load = 49.0;
            kinds.extend(e.step(&s).alerts.into_iter().map(|a| (a.kind, a.pid, a.root_pid)));
        }
        assert_eq!(kinds, vec![("mem".to_string(), 0, 0), ("load".to_string(), 0, 0)]);
    }

    fn write_alert(paths: &Paths, id: u64, root: u32, exe: &str, msg: &str) {
        let a = Alert { id, ts: 1_000, kind: "cpu".into(), pid: 7, exe: exe.into(), root_pid: root, root_cwd: "/r".into(), metric: "cpu_pct".into(), value: 283.0, threshold: 150.0, action: "killed".into(), msg: msg.into(), suggest: "disable it".into() };
        append_alert(paths, &a).unwrap();
    }

    #[test]
    fn hook_json_cursor_and_relevance() {
        let home = tmp("hook");
        let paths = Paths::at(&home);
        let input = json!({"session_id": "s-1", "hook_event_name": "UserPromptSubmit"}).to_string();
        assert!(hook_output(&input, &paths, 1_100, || Some(100)).is_none(), "no alerts file");
        write_alert(&paths, 1, 100, "headroom", "headroom pid 7 used 283% CPU for 20 s → killed");
        write_alert(&paths, 2, 555, "tsserver", "tsserver of another session");
        write_alert(&paths, 3, 0, "machine", "machine MemAvailable 6%");
        let out = hook_output(&input, &paths, 1_100, || Some(100)).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit");
        let ctx = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(ctx.contains("283% CPU") && ctx.contains("[process of this session]") && ctx.contains("MemAvailable"));
        assert!(!ctx.contains("another session") && ctx.chars().count() <= HOOK_MAX_CHARS);
        assert!(hook_output(&input, &paths, 1_100, || Some(100)).is_none(), "cursor: seen once, silent after");
        assert!(hook_output(&json!({"session_id": "s-2"}).to_string(), &paths, 1_100, || Some(100)).is_some(), "other session has its own cursor");
        write_alert(&paths, 4, 100, "headroom", "again");
        let v: Value = serde_json::from_str(&hook_output(&json!({"session_id": "s-1", "hook_event_name": "PostToolUse"}).to_string(), &paths, 1_100, || Some(100)).unwrap()).unwrap();
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "PostToolUse");
        assert!(hook_output(&json!({"session_id": "../x"}).to_string(), &paths, 1_100, || None).is_none(), "unsafe session id");
        assert!(hook_output(&json!({"session_id": "s-9"}).to_string(), &paths, 9_999_999, || None).is_none(), "old alerts are not replayed to a new session");
        for i in 10..40 {
            write_alert(&paths, i, 100, &format!("helper{i}"), &"x".repeat(200));
        }
        let long = hook_output(&json!({"session_id": "s-3"}).to_string(), &paths, 1_100, || Some(100)).unwrap();
        let ctx = serde_json::from_str::<Value>(&long).unwrap()["hookSpecificOutput"]["additionalContext"].as_str().unwrap().to_string();
        assert_eq!(ctx.chars().count(), HOOK_MAX_CHARS);
        let _ = fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn alerts_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let home = tmp("perm");
        let paths = Paths::at(&home);
        write_alert(&paths, 1, 1, "x", "m");
        assert_eq!(fs::metadata(&paths.alerts).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(fs::metadata(&paths.state).unwrap().permissions().mode() & 0o777, 0o700);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn config_template_is_the_defaults_and_is_created() {
        assert_eq!(Config::parse(CONFIG_TEMPLATE).unwrap(), Config::default());
        let c = Config::parse("cpu_pct = 99\nauto_kill = false\nhelpers = [\"Foo\"]").unwrap();
        assert_eq!((c.cpu_pct, c.cpu_sustain_secs, c.auto_kill, c.helpers), (99.0, 20.0, false, names(&["foo"])));
        assert_eq!(Config::parse("cpu_pct = \"x\"").unwrap(), Config::default(), "wrong type ignored");
        let home = tmp("cfg");
        let p = home.join("c/watchdog.toml");
        assert_eq!(Config::load(&p), Config::default());
        assert!(p.exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn unit_has_the_resource_limits() {
        let u = unit_text("/usr/bin/8sync");
        for want in ["ExecStart=/usr/bin/8sync watchdog run", "Restart=on-failure", "Nice=10", "CPUQuota=5%", "MemoryMax=64M"] {
            assert!(u.contains(want), "{want}");
        }
    }
}
