//! Process priority, power and memory calls of `8sync eco` ([`super::eco`]): below-normal / idle
//! priority, Windows Efficiency mode (EcoQoS) and working-set trim. The auto team's resource guard
//! that used to live here went with the auto teams (owner 2026-10-30: no board, no team rooms).

use super::reap::Proc;

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
        fn GetProcessTimes(h: Handle, creation: *mut u64, exit: *mut u64, kernel: *mut u64, user: *mut u64) -> i32;
        fn K32EmptyWorkingSet(h: Handle) -> i32;
    }
    const PROCESS_SET_INFORMATION: u32 = 0x0200;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_QUERY_INFORMATION: u32 = 0x0400;
    const PROCESS_SET_QUOTA: u32 = 0x0100;
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

    /// The open process is the one listed: its creation time (unix s) is within 2 s of `started`
    /// (0 = the listing did not say: no check). A pid reused since the listing is never touched.
    fn same(h: Handle, started: u64) -> bool {
        if started == 0 {
            return true;
        }
        let (mut c, mut e, mut k, mut u) = (0u64, 0u64, 0u64, 0u64);
        // SAFETY: four out-pointers to live u64s (FILETIME layout); `h` is a live handle.
        let ok = unsafe { GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u) != 0 };
        // FILETIME counts 100 ns since 1601-01-01.
        ok && (c / 10_000_000).checked_sub(11_644_473_600).is_some_and(|s| s.abs_diff(started) <= 2)
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

    /// Empties `pid`'s working set (`K32EmptyWorkingSet`, kernel32 since Windows 7,
    /// https://learn.microsoft.com/windows/win32/api/psapi/nf-psapi-emptyworkingset): its resident
    /// pages go to the standby list, so RAM in use drops now; what it touches next faults back in
    /// (soft faults from standby, no disk). Only the process started at `started`.
    pub fn empty_working_set(pid: u32, started: u64) -> bool {
        // SAFETY: `h` is a live handle with PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA.
        with(pid, PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, |h| same(h, started) && unsafe { K32EmptyWorkingSet(h) != 0 }).unwrap_or(false)
    }
}

/// Below-normal priority for `pids` (Windows `SetPriorityClass`, unix `renice +10`), or idle
/// (`idle`: Windows idle class, unix `renice +19`), one by one by PID; how many changed.
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

/// Efficiency mode for `pids` (`on`), or back to the default (`off`): only those not already
/// there change, so a pass after the owner's own `BelowNormal`/Efficiency changes does nothing
/// twice. How many changed; 0 off Windows (no EcoQoS there). A child does not inherit EcoQoS
/// (checked live 2026-10-21: a node spawned by a throttled, below-normal node came out below
/// normal but not in EcoQoS), hence the sweep every pass.
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

/// Empties the working set of `pids` (Windows [`win::empty_working_set`]; a no-op elsewhere): how
/// many were trimmed and their resident bytes before, from `procs`.
pub(super) fn trim(procs: &[Proc], pids: &[u32]) -> (usize, u64) {
    #[cfg(windows)]
    {
        procs.iter().filter(|p| pids.contains(&p.pid) && win::empty_working_set(p.pid, p.started)).fold((0, 0), |(n, b), p| (n + 1, b + p.rss))
    }
    #[cfg(not(windows))]
    {
        let _ = (procs, pids);
        (0, 0)
    }
}
