//! Machine sampler: CPU busy share, RAM, GPU (util / memory / temperature / board power), CPU
//! package energy and how much RAM the claude / node processes hold. Nothing runs without a
//! client: while `/v1/machine` was polled within [`ACTIVE`], a thread samples every [`EVERY`] so
//! the poll never waits on the OS reads (the PDH energy collect can take ~0.5 s); otherwise only a
//! request takes a sample, when the last is older than it accepts (power.ts's 15 s tick asks for
//! [`POWER_FRESH`]). Field names follow `apps/hq-ui/lib/server/machine.ts` (`Machine`) and
//! `power.ts` (`Reading`).

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const EVERY: Duration = Duration::from_secs(5);
/// The background thread keeps sampling this long after the last `/v1/machine` poll.
pub const ACTIVE: Duration = Duration::from_secs(60);
/// `/v1/machine` serves a sample up to this old (the thread keeps it far younger while polled).
pub const STALE: Duration = Duration::from_secs(20);
/// `/v1/power` (power.ts every 15 s): a sample this old or newer, else one taken for it.
pub const POWER_FRESH: Duration = Duration::from_secs(10);

#[derive(Clone, Debug, PartialEq)]
pub struct Gpu {
    pub name: String,
    pub util: u32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub temp: Option<u32>,
    pub watts: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Group {
    pub n: u32,
    pub bytes: u64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Sample {
    pub at: u64,
    pub cores: usize,
    pub cpu_pct: Option<u32>,
    /// (total, used) MiB.
    pub mem: Option<(u64, u64)>,
    pub gpus: Option<Vec<Gpu>>,
    /// Cumulative CPU package energy (Wh) and where it wraps (Linux powercap), else None.
    pub cpu_wh: Option<f64>,
    pub cpu_wrap_wh: Option<f64>,
    /// Average CPU package watts since the previous sample.
    pub cpu_w: Option<f64>,
    pub procs: Option<(Group, Group)>,
}

/// CPU counters (idle, total) in any unit; busy share between two readings, 0–100.
pub fn cpu_pct(a: (u64, u64), b: (u64, u64)) -> Option<u32> {
    let total = b.1.checked_sub(a.1)?;
    let idle = b.0.saturating_sub(a.0);
    if total == 0 {
        return None;
    }
    let busy = total.saturating_sub(idle) as f64 * 100.0 / total as f64;
    Some(busy.round().clamp(0.0, 100.0) as u32)
}

/// More than this from one CPU package is a counter that restarted from junk (power.ts MAX_CPU_W).
const MAX_CPU_W: f64 = 2000.0;

/// Average watts between two cumulative readings; a reset or an impossible jump is None.
pub fn cpu_watts(prev: Option<(u64, f64)>, cur: (u64, f64), wrap: Option<f64>) -> Option<f64> {
    let (t0, e0) = prev?;
    let dt = cur.0.checked_sub(t0).filter(|d| *d > 0)? as f64;
    let mut d = cur.1 - e0;
    if d < 0.0 {
        d += wrap?;
    }
    let w = d * 3_600_000.0 / dt;
    (d >= 0.0 && w <= MAX_CPU_W).then_some(w)
}

/// "claude" / "node" by process image name (any case, path and `.exe` stripped), else None.
pub fn kind(name: &str) -> Option<usize> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).to_ascii_lowercase();
    match base.strip_suffix(".exe").unwrap_or(&base) {
        "claude" => Some(0),
        "node" => Some(1),
        _ => None,
    }
}

const MIB: f64 = 1024.0 * 1024.0;

fn group_json(g: Group) -> Value {
    json!({ "n": g.n, "mb": (g.bytes as f64 / MIB).round() as u64 })
}

pub fn machine_json(s: &Sample) -> Value {
    json!({
        "at": s.at,
        "cpu": { "cores": s.cores, "pct": s.cpu_pct },
        "mem": s.mem.map(|(t, u)| json!({ "totalMb": t, "usedMb": u })),
        "gpus": s.gpus.as_ref().map(|g| g.iter().map(|g| json!({
            "name": g.name, "util": g.util, "memUsed": g.mem_used, "memTotal": g.mem_total, "temp": g.temp,
        })).collect::<Vec<_>>()),
        "procs": s.procs.map(|(c, n)| json!({ "claude": group_json(c), "node": group_json(n) })),
    })
}

/// power.ts `Reading` (+ `cpuW`): `gpuW` sums the boards that report power.
pub fn power_json(s: &Sample) -> Value {
    let gpu_w = s.gpus.as_ref().and_then(|g| {
        let w: Vec<f64> = g.iter().filter_map(|g| g.watts).collect();
        (!w.is_empty()).then(|| w.iter().sum::<f64>())
    });
    json!({ "at": s.at, "cpuWh": s.cpu_wh, "cpuWrapWh": s.cpu_wrap_wh, "gpuW": gpu_w, "cpuW": s.cpu_w })
}

/// `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits`
pub fn parse_smi(out: &str) -> Vec<Gpu> {
    let num = |s: &str| s.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0);
    out.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(',').map(str::trim).collect();
            if f.len() < 6 || f[0].is_empty() {
                return None;
            }
            Some(Gpu {
                name: f[0].chars().take(60).collect(),
                util: num(f[1])? as u32,
                mem_used: num(f[2])? as u64,
                mem_total: num(f[3])? as u64,
                temp: num(f[4]).map(|t| t as u32),
                watts: num(f[5]),
            })
        })
        .collect()
}

/// First line of `/proc/stat` → (idle + iowait, total) jiffies.
pub fn parse_proc_stat(s: &str) -> Option<(u64, u64)> {
    let l = s.lines().next()?.strip_prefix("cpu ")?;
    let v: Vec<u64> = l.split_whitespace().filter_map(|x| x.parse().ok()).collect();
    if v.len() < 4 {
        return None;
    }
    // user nice system idle iowait irq softirq steal (guest is already inside user)
    let total = v.iter().take(8).sum();
    Some((v[3] + v.get(4).copied().unwrap_or(0), total))
}

/// `/proc/meminfo` → (total, available) in KiB.
pub fn parse_meminfo(s: &str) -> Option<(u64, u64)> {
    let get = |k: &str| s.lines().find_map(|l| l.strip_prefix(k)?.trim().strip_suffix("kB")?.trim().parse::<u64>().ok());
    Some((get("MemTotal:")?, get("MemAvailable:").or_else(|| get("MemFree:"))?))
}

/// What a backend reads; each part independently unknown.
#[derive(Default)]
struct Raw {
    cpu: Option<(u64, u64)>,
    mem_bytes: Option<(u64, u64)>,
    gpus: Option<Vec<Gpu>>,
    energy: Option<(f64, Option<f64>)>,
    procs: Option<(Group, Group)>,
}

pub struct Sampler {
    /// Taken only by whoever refreshes (serialises the OS reads); readers never wait on it while a
    /// fresh enough sample exists.
    backend: Mutex<Backend>,
    /// The latest sample and the counters it was computed from; held only to copy or update them.
    snap: Mutex<Snap>,
    /// When `/v1/machine` was last asked (ms since the core started); the thread samples only then.
    polled_ms: AtomicU64,
    born: Instant,
}

#[derive(Default)]
struct Snap {
    prev_cpu: Option<(u64, u64)>,
    prev_energy: Option<(u64, f64)>,
    last: Option<(Instant, Sample)>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

impl Sampler {
    /// None on an OS without a backend (node keeps its own probes there).
    pub fn new() -> Option<Sampler> {
        Some(Sampler { backend: Mutex::new(Backend::open()?), snap: Mutex::default(), polled_ms: AtomicU64::new(0), born: Instant::now() })
    }

    /// A client looked at the machine: keep sampling every [`EVERY`] for the next [`ACTIVE`].
    pub fn touch(&self) {
        self.polled_ms.store(self.born.elapsed().as_millis() as u64 + 1, Ordering::Relaxed);
    }

    /// Whether a client polled within [`ACTIVE`] (the background thread samples only then).
    pub fn wanted(&self) -> bool {
        let p = self.polled_ms.load(Ordering::Relaxed);
        p != 0 && (self.born.elapsed().as_millis() as u64).saturating_sub(p) < ACTIVE.as_millis() as u64
    }

    fn fresh(&self, max_age: Duration) -> Option<Sample> {
        let st = self.snap.lock().unwrap_or_else(|p| p.into_inner());
        st.last.as_ref().filter(|(t, _)| t.elapsed() < max_age).map(|(_, s)| s.clone())
    }

    /// The latest sample, taking a new one when the last is older than `max_age`.
    pub fn get(&self, max_age: Duration) -> Sample {
        if let Some(s) = self.fresh(max_age) {
            return s;
        }
        let mut b = self.backend.lock().unwrap_or_else(|p| p.into_inner());
        // Another caller may have refreshed while this one waited.
        if let Some(s) = self.fresh(max_age) {
            return s;
        }
        if self.snap.lock().unwrap_or_else(|p| p.into_inner()).prev_cpu.is_none() {
            // The first CPU share needs two readings (machine.ts samples 250 ms the same way).
            let c = b.read_cpu();
            self.snap.lock().unwrap_or_else(|p| p.into_inner()).prev_cpu = c;
            std::thread::sleep(Duration::from_millis(250));
        }
        // The OS reads (Toolhelp, NVML, PDH; nvidia-smi on Linux) run without the snapshot lock.
        let raw = b.read();
        let at = now_ms();
        let mut st = self.snap.lock().unwrap_or_else(|p| p.into_inner());
        let cpu_pct = match (st.prev_cpu, raw.cpu) {
            (Some(a), Some(b)) => cpu_pct(a, b),
            _ => None,
        };
        if raw.cpu.is_some() {
            st.prev_cpu = raw.cpu;
        }
        let cpu_w = raw.energy.and_then(|(wh, wrap)| cpu_watts(st.prev_energy, (at, wh), wrap));
        st.prev_energy = raw.energy.map(|(wh, _)| (at, wh));
        let s = Sample {
            at,
            cores: std::thread::available_parallelism().map_or(1, |n| n.get()),
            cpu_pct,
            mem: raw.mem_bytes.map(|(t, a)| ((t as f64 / MIB).round() as u64, ((t as f64 / MIB).round() - (a as f64 / MIB).round()) as u64)),
            gpus: raw.gpus,
            cpu_wh: raw.energy.map(|e| e.0),
            cpu_wrap_wh: raw.energy.and_then(|e| e.1),
            cpu_w,
            procs: raw.procs,
        };
        st.last = Some((Instant::now(), s.clone()));
        s
    }
}

// ── Windows: GetSystemTimes, GlobalMemoryStatusEx, Toolhelp, PDH, NVML ─────────────────────────

#[cfg(windows)]
struct Backend {
    pdh: Option<win::Pdh>,
    nvml: Option<win::Nvml>,
}

#[cfg(windows)]
impl Backend {
    fn open() -> Option<Backend> {
        Some(Backend { pdh: win::Pdh::open(), nvml: win::Nvml::open() })
    }

    fn read_cpu(&mut self) -> Option<(u64, u64)> {
        super::sys::win::system_times()
    }

    fn read(&mut self) -> Raw {
        use super::sys::win;
        let mut procs = (Group::default(), Group::default());
        let listed = win::each_process(|exe, pid| {
            let Some(k) = kind(&String::from_utf16_lossy(exe)) else { return };
            let Some(ws) = win::working_set(pid) else { return };
            let g = if k == 0 { &mut procs.0 } else { &mut procs.1 };
            g.n += 1;
            g.bytes += ws;
        });
        Raw {
            cpu: self.read_cpu(),
            mem_bytes: win::memory(),
            gpus: self.nvml.as_ref().and_then(|n| n.read()),
            energy: self.pdh.as_ref().and_then(|p| p.read_pwh()).map(|pwh| (pwh / 1e12, None)),
            procs: listed.then_some(procs),
        }
    }
}

#[cfg(windows)]
pub(crate) mod win {
    use super::super::sys::win::Lib;
    use super::Gpu;
    use std::ffi::c_void;

    type PdhOpen = unsafe extern "system" fn(*const u16, usize, *mut *mut c_void) -> u32;
    type PdhAdd = unsafe extern "system" fn(*mut c_void, *const u16, usize, *mut *mut c_void) -> u32;
    type PdhCollect = unsafe extern "system" fn(*mut c_void) -> u32;
    type PdhFormatted = unsafe extern "system" fn(*mut c_void, u32, *mut u32, *mut FmtValue) -> u32;

    #[repr(C)]
    struct FmtValue {
        status: u32,
        large: i64,
    }

    const PDH_FMT_LARGE: u32 = 0x0400;
    const PDH_FMT_NOCAP100: u32 = 0x8000;
    const COUNTER: &str = "\\Energy Meter(RAPL_Package0_PKG)\\Energy";

    /// The RAPL package energy counter, one query opened for the life of the core.
    pub struct Pdh {
        _lib: Lib,
        query: *mut c_void,
        counter: *mut c_void,
        collect: PdhCollect,
        formatted: PdhFormatted,
    }
    // SAFETY: PDH handles may be used from any thread; the sampler mutex serialises every call.
    unsafe impl Send for Pdh {}

    impl Pdh {
        pub fn open() -> Option<Pdh> {
            let lib = Lib::load("pdh.dll")?;
            // SAFETY: each symbol is transmuted to its documented pdh.h signature.
            unsafe {
                let open: PdhOpen = std::mem::transmute(lib.sym(b"PdhOpenQueryW\0")?);
                let add: PdhAdd = std::mem::transmute(lib.sym(b"PdhAddEnglishCounterW\0")?);
                let collect: PdhCollect = std::mem::transmute(lib.sym(b"PdhCollectQueryData\0")?);
                let formatted: PdhFormatted = std::mem::transmute(lib.sym(b"PdhGetFormattedCounterValue\0")?);
                let mut query = std::ptr::null_mut();
                if open(std::ptr::null(), 0, &mut query) != 0 {
                    return None;
                }
                let path: Vec<u16> = COUNTER.encode_utf16().chain(Some(0)).collect();
                let mut counter = std::ptr::null_mut();
                if add(query, path.as_ptr(), 0, &mut counter) != 0 {
                    return None;
                }
                Some(Pdh { _lib: lib, query, counter, collect, formatted })
            }
        }

        /// Cumulative package energy in picowatt-hours (what typeperf prints).
        pub fn read_pwh(&self) -> Option<f64> {
            let mut v = FmtValue { status: 0, large: 0 };
            // SAFETY: query/counter came from a successful open; `v` is a writable PDH_FMT_COUNTERVALUE.
            let ok = unsafe { (self.collect)(self.query) == 0 && (self.formatted)(self.counter, PDH_FMT_LARGE | PDH_FMT_NOCAP100, std::ptr::null_mut(), &mut v) == 0 };
            (ok && v.status == 0 && v.large >= 0).then_some(v.large as f64)
        }
    }

    type NvInit = unsafe extern "C" fn() -> i32;
    type NvCount = unsafe extern "C" fn(*mut u32) -> i32;
    type NvHandle = unsafe extern "C" fn(u32, *mut *mut c_void) -> i32;
    type NvName = unsafe extern "C" fn(*mut c_void, *mut u8, u32) -> i32;
    type NvUtil = unsafe extern "C" fn(*mut c_void, *mut [u32; 2]) -> i32;
    type NvMem = unsafe extern "C" fn(*mut c_void, *mut [u64; 3]) -> i32;
    type NvMem2 = unsafe extern "C" fn(*mut c_void, *mut Mem2) -> i32;
    type NvTemp = unsafe extern "C" fn(*mut c_void, i32, *mut u32) -> i32;
    type NvPower = unsafe extern "C" fn(*mut c_void, *mut u32) -> i32;

    /// nvmlMemory_v2_t: what nvidia-smi reports as memory.used (reserved memory excluded).
    #[repr(C)]
    struct Mem2 {
        version: u32,
        total: u64,
        reserved: u64,
        free: u64,
        used: u64,
    }

    pub struct Nvml {
        _lib: Lib,
        count: NvCount,
        handle: NvHandle,
        name: NvName,
        util: NvUtil,
        mem: NvMem,
        mem2: Option<NvMem2>,
        temp: NvTemp,
        power: NvPower,
    }

    impl Nvml {
        pub fn open() -> Option<Nvml> {
            let lib = Lib::load("nvml.dll").or_else(|| Lib::load("C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvml.dll"))?;
            // SAFETY: each symbol is transmuted to its documented nvml.h signature; init is called once.
            unsafe {
                let init: NvInit = std::mem::transmute(lib.sym(b"nvmlInit_v2\0")?);
                if init() != 0 {
                    return None;
                }
                Some(Nvml {
                    count: std::mem::transmute(lib.sym(b"nvmlDeviceGetCount_v2\0")?),
                    handle: std::mem::transmute(lib.sym(b"nvmlDeviceGetHandleByIndex_v2\0")?),
                    name: std::mem::transmute(lib.sym(b"nvmlDeviceGetName\0")?),
                    util: std::mem::transmute(lib.sym(b"nvmlDeviceGetUtilizationRates\0")?),
                    mem: std::mem::transmute(lib.sym(b"nvmlDeviceGetMemoryInfo\0")?),
                    mem2: lib.sym(b"nvmlDeviceGetMemoryInfo_v2\0").map(|p| std::mem::transmute::<*const c_void, NvMem2>(p)),
                    temp: std::mem::transmute(lib.sym(b"nvmlDeviceGetTemperature\0")?),
                    power: std::mem::transmute(lib.sym(b"nvmlDeviceGetPowerUsage\0")?),
                    _lib: lib,
                })
            }
        }

        /// Every GPU; None when NVML stops answering.
        pub fn read(&self) -> Option<Vec<Gpu>> {
            const MIB: u64 = 1024 * 1024;
            let mut n = 0u32;
            // SAFETY: NVML was initialised in `open`; every out-pointer is a writable local of the
            // documented type (nvmlUtilization_t = 2 × uint, nvmlMemory_t = 3 × ull).
            unsafe {
                if (self.count)(&mut n) != 0 {
                    return None;
                }
                let mut out = Vec::with_capacity(n.min(16) as usize);
                for i in 0..n.min(16) {
                    let mut dev = std::ptr::null_mut();
                    if (self.handle)(i, &mut dev) != 0 {
                        continue;
                    }
                    let mut name = [0u8; 96];
                    let name = if (self.name)(dev, name.as_mut_ptr(), name.len() as u32) == 0 {
                        let end = name.iter().position(|&b| b == 0).unwrap_or(name.len());
                        String::from_utf8_lossy(&name[..end]).chars().take(60).collect()
                    } else {
                        String::new()
                    };
                    let mut u = [0u32; 2];
                    if (self.util)(dev, &mut u) != 0 {
                        continue;
                    }
                    let mut m2 = Mem2 { version: std::mem::size_of::<Mem2>() as u32 | (2 << 24), total: 0, reserved: 0, free: 0, used: 0 };
                    let (used, total) = match self.mem2 {
                        Some(f) if f(dev, &mut m2) == 0 => (m2.used, m2.total),
                        _ => {
                            let mut m = [0u64; 3];
                            if (self.mem)(dev, &mut m) != 0 {
                                continue;
                            }
                            (m[2], m[0])
                        }
                    };
                    let mut t = 0u32;
                    let temp = ((self.temp)(dev, 0, &mut t) == 0).then_some(t);
                    let mut mw = 0u32;
                    let watts = ((self.power)(dev, &mut mw) == 0).then(|| f64::from(mw) / 1000.0);
                    out.push(Gpu { name, util: u[0], mem_used: used / MIB, mem_total: total / MIB, temp, watts });
                }
                Some(out)
            }
        }
    }
}

// ── Linux: /proc, powercap, nvidia-smi once per sample ──────────────────────────────────────────

#[cfg(target_os = "linux")]
struct Backend {
    smi: Option<std::path::PathBuf>,
}

#[cfg(target_os = "linux")]
impl Backend {
    fn open() -> Option<Backend> {
        Some(Backend { smi: which::which("nvidia-smi").ok() })
    }

    fn read_cpu(&mut self) -> Option<(u64, u64)> {
        parse_proc_stat(&std::fs::read_to_string("/proc/stat").ok()?)
    }

    fn read(&mut self) -> Raw {
        let mem_bytes = std::fs::read_to_string("/proc/meminfo").ok().as_deref().and_then(parse_meminfo).map(|(t, a)| (t * 1024, a * 1024));
        let energy = (|| {
            let dir = std::path::Path::new("/sys/class/powercap/intel-rapl:0");
            let uj: f64 = std::fs::read_to_string(dir.join("energy_uj")).ok()?.trim().parse().ok()?;
            let max = std::fs::read_to_string(dir.join("max_energy_range_uj")).ok().and_then(|s| s.trim().parse::<f64>().ok()).filter(|m| *m > 0.0);
            Some((uj / 3.6e9, max.map(|m| m / 3.6e9)))
        })();
        let gpus = self.smi.as_ref().and_then(|bin| {
            let mut c = std::process::Command::new(bin);
            c.args(["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw", "--format=csv,noheader,nounits"])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null());
            let out = super::agents::run_bounded(c, Duration::from_secs(4))?;
            Some(parse_smi(&String::from_utf8_lossy(&out)))
        });
        let mut procs = (Group::default(), Group::default());
        for e in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
            let p = e.path();
            let Ok(comm) = std::fs::read_to_string(p.join("comm")) else { continue };
            let Some(k) = kind(comm.trim()) else { continue };
            let rss = std::fs::read_to_string(p.join("status"))
                .ok()
                .and_then(|s| s.lines().find_map(|l| l.strip_prefix("VmRSS:")?.trim().strip_suffix("kB")?.trim().parse::<u64>().ok()));
            if let Some(kb) = rss {
                let g = if k == 0 { &mut procs.0 } else { &mut procs.1 };
                g.n += 1;
                g.bytes += kb * 1024;
            }
        }
        Raw { cpu: self.read_cpu(), mem_bytes, gpus, energy, procs: Some(procs) }
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
struct Backend;

#[cfg(not(any(windows, target_os = "linux")))]
impl Backend {
    fn open() -> Option<Backend> {
        None
    }
    fn read_cpu(&mut self) -> Option<(u64, u64)> {
        None
    }
    fn read(&mut self) -> Raw {
        Raw::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_only_on_demand_and_serves_a_fresh_one_from_the_snapshot() {
        let Some(s) = Sampler::new() else { return }; // no backend on this OS
        assert!(!s.wanted(), "nobody polled: the thread reads nothing");
        s.touch();
        assert!(s.wanted());
        let a = s.get(STALE);
        assert!(a.at > 0 && a.cores >= 1);
        assert_eq!(s.get(STALE).at, a.at, "fresh enough: no new read");
        std::thread::sleep(Duration::from_millis(5));
        assert!(s.get(Duration::ZERO).at >= a.at, "max age 0 always reads again");
    }

    #[test]
    fn cpu_share_between_two_readings() {
        assert_eq!(cpu_pct((100, 1000), (150, 1100)), Some(50));
        assert_eq!(cpu_pct((100, 1000), (100, 1000)), None, "no gap");
        assert_eq!(cpu_pct((100, 1000), (200, 900)), None, "counter went back");
        assert_eq!(cpu_pct((0, 0), (1, 3)), Some(67), "rounds like Math.round");
    }

    #[test]
    fn package_watts_from_cumulative_energy() {
        // 0.05 Wh over 6 s = 30 W
        assert_eq!(cpu_watts(Some((0, 1.0)), (6_000, 1.05), None).map(|w| w.round()), Some(30.0));
        assert_eq!(cpu_watts(None, (6_000, 1.05), None), None, "first reading");
        assert_eq!(cpu_watts(Some((0, 2.0)), (6_000, 1.0), None), None, "reset without a wrap");
        assert_eq!(cpu_watts(Some((0, 9.99)), (3_600_000, 0.01), Some(10.0)).map(|w| (w * 100.0).round()), Some(2.0), "wrapped");
        assert_eq!(cpu_watts(Some((0, 0.0)), (1_000, 100.0), None), None, "no CPU draws that");
        assert_eq!(cpu_watts(Some((5, 0.0)), (5, 1.0), None), None, "same instant");
    }

    #[test]
    fn groups_claude_and_node_by_image_name() {
        assert_eq!(kind("claude.exe"), Some(0));
        assert_eq!(kind("C:\\Program Files\\nodejs\\NODE.EXE"), Some(1));
        assert_eq!(kind("/usr/bin/node"), Some(1));
        assert_eq!(kind("claude-helper.exe"), None);
        assert_eq!(kind("nodemon"), None);
        let s = Sample { procs: Some((Group { n: 2, bytes: 3 * 1024 * 1024 + 600_000 }, Group::default())), ..Sample::default() };
        assert_eq!(machine_json(&s)["procs"], json!({ "claude": { "n": 2, "mb": 4 }, "node": { "n": 0, "mb": 0 } }));
    }

    #[test]
    fn json_shapes_match_machine_ts_and_power_ts() {
        let s = Sample {
            at: 5,
            cores: 16,
            cpu_pct: Some(12),
            mem: Some((65_000, 30_000)),
            gpus: Some(vec![Gpu { name: "RTX".into(), util: 7, mem_used: 900, mem_total: 16_000, temp: Some(40), watts: Some(30.5) }]),
            cpu_wh: Some(12.5),
            cpu_wrap_wh: None,
            cpu_w: Some(20.0),
            procs: None,
        };
        assert_eq!(
            machine_json(&s),
            json!({ "at": 5, "cpu": { "cores": 16, "pct": 12 }, "mem": { "totalMb": 65_000, "usedMb": 30_000 },
                    "gpus": [{ "name": "RTX", "util": 7, "memUsed": 900, "memTotal": 16_000, "temp": 40 }], "procs": null })
        );
        assert_eq!(power_json(&s), json!({ "at": 5, "cpuWh": 12.5, "cpuWrapWh": null, "gpuW": 30.5, "cpuW": 20.0 }));
        assert_eq!(power_json(&Sample::default())["gpuW"], Value::Null, "no GPU: null, not 0");
    }

    #[test]
    fn parses_linux_proc_files_and_nvidia_smi() {
        assert_eq!(parse_proc_stat("cpu  10 0 5 80 5 0 0 0 0 0\ncpu0 1 2 3 4\n"), Some((85, 100)));
        assert_eq!(parse_proc_stat("intr 1 2"), None);
        assert_eq!(parse_meminfo("MemTotal:       16000 kB\nMemFree:  100 kB\nMemAvailable:    4000 kB\n"), Some((16000, 4000)));
        let g = parse_smi("NVIDIA GeForce RTX 5080, 3, 1200, 16303, 41, 22.50\nbad line\n, 1, 2, 3, 4, 5\n");
        assert_eq!(g, vec![Gpu { name: "NVIDIA GeForce RTX 5080".into(), util: 3, mem_used: 1200, mem_total: 16303, temp: Some(41), watts: Some(22.5) }]);
        assert_eq!(parse_smi("A, 1, 2, 3, [N/A], [N/A]")[0].watts, None);
    }
}
