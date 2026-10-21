//! OS calls the core needs, behind safe functions. Windows: kernel32 is always linked; `pdh.dll`
//! and `nvml.dll` are loaded at run time ([`Lib`]) so a machine without them (or without an
//! NVIDIA driver) just reports `null` and the binary links nothing new.

/// Start time of a live process (Windows creation FILETIME; Linux `starttime` clock ticks), so a
/// later process that reuses the pid reads differently. None: gone or unreadable.
pub fn proc_start(pid: u32) -> Option<u64> {
    #[cfg(windows)]
    {
        win::proc_start(pid)
    }
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // Field 22; the comm field (2) may hold spaces, so count from the closing paren.
        stat.rsplit_once(')')?.1.split_whitespace().nth(19)?.parse().ok()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = pid;
        None
    }
}

#[cfg(windows)]
pub mod win {
    use std::ffi::c_void;

    pub type Handle = *mut c_void;

    #[repr(C)]
    pub struct MemoryStatusEx {
        pub length: u32,
        pub memory_load: u32,
        pub total_phys: u64,
        pub avail_phys: u64,
        pub total_page_file: u64,
        pub avail_page_file: u64,
        pub total_virtual: u64,
        pub avail_virtual: u64,
        pub avail_extended_virtual: u64,
    }

    #[repr(C)]
    pub struct ProcessEntry32W {
        pub size: u32,
        pub usage: u32,
        pub pid: u32,
        pub heap_id: usize,
        pub module_id: u32,
        pub threads: u32,
        pub parent_pid: u32,
        pub pri_class_base: i32,
        pub flags: u32,
        pub exe_file: [u16; 260],
    }

    #[repr(C)]
    #[derive(Default)]
    pub struct ProcessMemoryCounters {
        pub size: u32,
        pub page_fault_count: u32,
        pub peak_working_set: usize,
        pub working_set: usize,
        pub quota_peak_paged_pool: usize,
        pub quota_paged_pool: usize,
        pub quota_peak_non_paged_pool: usize,
        pub quota_non_paged_pool: usize,
        pub pagefile_usage: usize,
        pub peak_pagefile_usage: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn GetExitCodeProcess(h: Handle, code: *mut u32) -> i32;
        fn GetProcessTimes(h: Handle, created: *mut u64, exited: *mut u64, kernel: *mut u64, user: *mut u64) -> i32;
        fn GetSystemTimes(idle: *mut u64, kernel: *mut u64, user: *mut u64) -> i32;
        fn GlobalMemoryStatusEx(m: *mut MemoryStatusEx) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snap: Handle, e: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snap: Handle, e: *mut ProcessEntry32W) -> i32;
        fn K32GetProcessMemoryInfo(h: Handle, c: *mut ProcessMemoryCounters, size: u32) -> i32;
        fn LoadLibraryW(name: *const u16) -> Handle;
        fn GetProcAddress(m: Handle, name: *const u8) -> *const c_void;
    }

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_VM_READ: u32 = 0x0010;
    const STILL_ACTIVE: u32 = 259;
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const INVALID_HANDLE: Handle = -1isize as Handle;

    pub fn proc_start(pid: u32) -> Option<u64> {
        // SAFETY: plain call; a null handle is checked before use.
        let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if h.is_null() {
            return None;
        }
        let (mut code, mut created, mut x) = (0u32, 0u64, 0u64);
        // SAFETY: `h` is a live handle; the out-pointers are writable locals (FILETIME = one u64).
        let ok = unsafe { GetExitCodeProcess(h, &mut code) != 0 && code == STILL_ACTIVE && GetProcessTimes(h, &mut created, &mut x, &mut x, &mut x) != 0 };
        // SAFETY: closes the handle opened above, once.
        unsafe { CloseHandle(h) };
        ok.then_some(created)
    }

    /// (idle, kernel + user) in 100 ns units since boot; kernel time includes idle time.
    pub fn system_times() -> Option<(u64, u64)> {
        let (mut idle, mut kernel, mut user) = (0u64, 0u64, 0u64);
        // SAFETY: three writable FILETIME-sized locals.
        (unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } != 0).then_some((idle, kernel + user))
    }

    /// (total, available) physical memory in bytes.
    pub fn memory() -> Option<(u64, u64)> {
        // SAFETY: an all-zero MEMORYSTATUSEX is valid; dwLength is set before the call.
        let mut m: MemoryStatusEx = unsafe { std::mem::zeroed() };
        m.length = std::mem::size_of::<MemoryStatusEx>() as u32;
        // SAFETY: `m` is writable and sized.
        (unsafe { GlobalMemoryStatusEx(&mut m) } != 0).then_some((m.total_phys, m.avail_phys))
    }

    /// Calls `f(exe name, pid)` for every process in one Toolhelp snapshot.
    pub fn each_process(mut f: impl FnMut(&[u16], u32)) -> bool {
        // SAFETY: plain call; the invalid handle is checked before use.
        let snap = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snap == INVALID_HANDLE || snap.is_null() {
            return false;
        }
        // SAFETY: an all-zero PROCESSENTRY32W is valid; dwSize is set before the first call.
        let mut e: ProcessEntry32W = unsafe { std::mem::zeroed() };
        e.size = std::mem::size_of::<ProcessEntry32W>() as u32;
        // SAFETY: `snap` is a live snapshot, `e` a sized writable entry.
        let mut more = unsafe { Process32FirstW(snap, &mut e) } != 0;
        while more {
            let n = e.exe_file.iter().position(|&c| c == 0).unwrap_or(e.exe_file.len());
            f(&e.exe_file[..n], e.pid);
            // SAFETY: as above.
            more = unsafe { Process32NextW(snap, &mut e) } != 0;
        }
        // SAFETY: closes the snapshot once.
        unsafe { CloseHandle(snap) };
        true
    }

    /// Working set in bytes (what tasklist shows as "Mem Usage"); None when the process is not ours to read.
    pub fn working_set(pid: u32) -> Option<u64> {
        // SAFETY: plain calls; a null handle is checked, the handle closed once.
        unsafe {
            let mut h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
            if h.is_null() {
                h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            }
            if h.is_null() {
                return None;
            }
            let mut c = ProcessMemoryCounters { size: std::mem::size_of::<ProcessMemoryCounters>() as u32, ..Default::default() };
            let ok = K32GetProcessMemoryInfo(h, &mut c, c.size) != 0;
            CloseHandle(h);
            ok.then_some(c.working_set as u64)
        }
    }

    /// A DLL loaded once and never freed (the core lives as long as the process).
    pub struct Lib(Handle);
    // SAFETY: a module handle is a process-wide value usable from any thread.
    unsafe impl Send for Lib {}
    // SAFETY: as above; the handle is never mutated.
    unsafe impl Sync for Lib {}

    impl Lib {
        pub fn load(name: &str) -> Option<Lib> {
            let w: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
            // SAFETY: `w` is a NUL-terminated UTF-16 string.
            let h = unsafe { LoadLibraryW(w.as_ptr()) };
            (!h.is_null()).then_some(Lib(h))
        }

        /// The address of `name` (NUL-terminated). The caller transmutes it to the documented signature.
        pub fn sym(&self, name: &[u8]) -> Option<*const c_void> {
            debug_assert_eq!(name.last(), Some(&0));
            // SAFETY: a live module handle and a NUL-terminated ASCII name.
            let p = unsafe { GetProcAddress(self.0, name.as_ptr()) };
            (!p.is_null()).then_some(p)
        }
    }
}
