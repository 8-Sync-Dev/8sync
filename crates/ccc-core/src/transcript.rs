//! Shared session view: what each omp / Claude Code session is *doing*, read
//! from its on-disk transcript, plus the width-aware renderer used by
//! `8sync . ls`, `8sync ccc . ls`, `8sync ls` and `8sync show`.
//!
//! Formats (checked against real files, 2026-10):
//! - omp: `<session-dir>/<ts>_<id>.jsonl`; line 1 `{"type":"title",…}`, then
//!   `{"type":"message","message":{"role":"user|assistant|toolResult",…}}`.
//!   Assistant tool calls are `{"type":"toolCall","name","arguments"}` blocks;
//!   the `todo` tool's result carries `details.phases[].tasks[{content,status}]`.
//! - Claude Code: `~/.claude/projects/<slug>/<id>.jsonl`; `user`/`assistant`
//!   lines, `tool_use` blocks (`TaskCreate`/`TaskUpdate`/`TodoWrite`), and
//!   `custom-title` lines.
//!
//! Large transcripts: only files up to [`FULL_SCAN_CAP`] are scanned whole
//! (needed for message counts and task state); bigger ones use the last
//! [`TAIL_BYTES`] and are flagged partial. Nothing here ever prints a secret:
//! every string shown goes through [`mask_secrets`].

use serde_json::Value;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const TAIL_BYTES: u64 = 256 * 1024;
pub const FULL_SCAN_CAP: u64 = 24 * 1024 * 1024;
/// A transcript written this recently counts as "active" even with no process match.
pub const ACTIVE_SECS: u64 = 120;

// ── model ───────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fmt {
    Omp,
    Claude,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TaskState {
    Pending,
    InProgress,
    Done,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub state: TaskState,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    /// A live omp/claude process has this session open.
    Running,
    /// No process match, but the transcript changed within [`ACTIVE_SECS`].
    Active,
    Idle,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Running => "running",
            Status::Active => "active",
            Status::Idle => "idle",
        }
    }
}

#[derive(Clone, Default, Debug)]
pub struct Digest {
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub branch: Option<String>,
    pub model: Option<String>,
    /// Human prompts seen (whole file, or the tail when `partial`).
    pub user_msgs: usize,
    /// Latest human prompts, oldest → newest (max 5).
    pub last_users: Vec<String>,
    /// Latest tool call, e.g. `bash: running tests`.
    pub last_tool: Option<String>,
    /// Raw name of that tool call (`Bash`, `Edit`, …).
    pub last_tool_name: Option<String>,
    /// Latest assistant text block, whole.
    pub last_text: Option<String>,
    /// Context size reported by the latest assistant message.
    pub tokens: Option<u64>,
    pub tasks: Vec<Task>,
    /// Recently written files (newest first, `detail` scans only).
    pub files: Vec<String>,
    pub partial: bool,
}

impl Digest {
    pub fn tasks_done(&self) -> usize {
        self.tasks.iter().filter(|t| t.state == TaskState::Done).count()
    }
    pub fn current_task(&self) -> Option<&Task> {
        self.tasks.iter().find(|t| t.state == TaskState::InProgress)
    }
    pub fn last_user(&self) -> Option<&str> {
        self.last_users.last().map(|s| s.as_str())
    }
    /// What the assistant did last: its latest tool call, else the first line of
    /// its latest text.
    pub fn last_activity(&self) -> Option<String> {
        self.last_tool.clone().or_else(|| self.last_text.as_deref().map(|t| first_line(t).to_string()))
    }
}

/// One session, ready to render.
#[derive(Clone, Debug)]
pub struct Row {
    pub engine: &'static str,
    pub name: String,
    pub is_last: bool,
    pub status: Status,
    pub last_active: u64,
    pub branch: Option<String>,
    pub dirty: bool,
    pub digest: Digest,
    /// Command that resumes it.
    pub resume: String,
    pub transcript: Option<PathBuf>,
    /// Inbox HQ and `ccc msg` deliver to: a Claude Code room's session id, an omp named
    /// session's [`crate::room_id`]; `None` for every other row.
    pub inbox_id: Option<String>,
}

// ── secrets ─────────────────────────────────────────────────────────────────

/// Mask anything that looks like a key/token (shared rules: `secret_mask.rs`).
pub fn mask_secrets(s: &str) -> String {
    crate::secret_mask::mask(s)
}

// ── text helpers ────────────────────────────────────────────────────────────

pub fn first_line(s: &str) -> &str {
    s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("")
}

/// Truncate to `max` chars (not bytes), ending with `…` when cut. Safe on any
/// UTF-8: it slices on char boundaries only.
pub fn truncate(s: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max - 1).collect();
    out.push('…');
    out
}

/// Collapse whitespace runs, mask secrets, cut to `max` chars.
pub fn clean(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    truncate(&mask_secrets(&flat), max)
}


pub fn ago(secs: u64, now: u64) -> String {
    let d = now.saturating_sub(secs);
    match d {
        0..=59 => format!("{d}s ago"),
        60..=3599 => format!("{}m ago", d / 60),
        3600..=86_399 => format!("{}h ago", d / 3600),
        _ => format!("{}d ago", d / 86_400),
    }
}

// ── status detection (pure) ─────────────────────────────────────────────────

/// True when some omp/claude process has `needle` (a session dir or id) as an
/// argument, or a `*.jsonl` file directly inside it (`omp --resume <session-dir>/<file>.jsonl`).
/// `cmdlines` are NUL-separated argv buffers ([`agent_cmdlines`]). The process must itself look
/// like omp/claude so an editor or `grep <id>` doesn't count. On Windows a path compares in any
/// case and slash direction.
pub fn proc_matches(cmdlines: &[Vec<u8>], needle: &str) -> bool {
    cmdlines.iter().any(|raw| proc_match(raw, needle))
}

/// [`proc_matches`] for one NUL-separated argv buffer.
pub fn proc_match(raw: &[u8], needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let want = path_key(needle);
    let sep = if cfg!(windows) { '\\' } else { '/' };
    let args: Vec<String> = raw.split(|b| *b == 0).filter(|a| !a.is_empty()).map(|a| String::from_utf8_lossy(a).into_owned()).collect();
    let is_agent = args.iter().take(3).any(|a| {
        let base = a.rsplit(['/', '\\']).next().unwrap_or(a).to_ascii_lowercase();
        let base = base.strip_suffix(".exe").unwrap_or(&base);
        base == "omp" || base.starts_with("claude") || base == "omp.js"
    });
    is_agent
        && args.iter().skip(1).any(|a| {
            let a = path_key(a);
            a == want || (a.ends_with(".jsonl") && a.rsplit_once(sep).is_some_and(|(dir, _)| dir == want))
        })
}

/// An argument as a path to compare: no trailing separator; on Windows also lower case with `\`.
fn path_key(s: &str) -> String {
    if cfg!(windows) {
        s.replace('/', "\\").trim_end_matches('\\').to_lowercase()
    } else {
        s.trim_end_matches('/').to_string()
    }
}

pub fn classify(proc_hit: bool, mtime: Option<u64>, now: u64) -> Status {
    if proc_hit {
        Status::Running
    } else if mtime.is_some_and(|m| now.saturating_sub(m) < ACTIVE_SECS) {
        Status::Active
    } else {
        Status::Idle
    }
}

/// Argv of live agent processes, NUL-separated. Linux: omp/claude from `/proc`. Windows: `omp.exe`
/// only (Claude Code rooms reach HQ through its hooks and `claude agents`), its command line split
/// like `CommandLineToArgvW`. Empty elsewhere.
pub fn agent_cmdlines() -> Vec<Vec<u8>> {
    agent_procs().into_iter().map(|(_, c)| c).collect()
}

/// [`agent_cmdlines`] with each process id.
pub fn agent_procs() -> Vec<(u32, Vec<u8>)> {
    #[cfg(target_os = "linux")]
    {
        let mut out = Vec::new();
        for e in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
            let Some(pid) = e.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else { continue };
            if let Ok(raw) = std::fs::read(e.path().join("cmdline")) {
                let head = String::from_utf8_lossy(&raw[..raw.len().min(512)]).to_ascii_lowercase();
                if head.contains("omp") || head.contains("claude") {
                    out.push((pid, raw));
                }
            }
        }
        out
    }
    #[cfg(windows)]
    {
        win::command_lines("omp.exe").into_iter().map(|(pid, c)| (pid, win_args(&c).join("\0").into_bytes())).collect()
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        Vec::new()
    }
}

/// A Windows command line split like `CommandLineToArgvW`: 2n backslashes + `"` = n backslashes and
/// a quote toggle, 2n+1 = n backslashes and a literal quote, other backslashes are literal.
pub fn win_args(cmdline: &str) -> Vec<String> {
    let mut out = Vec::new();
    let (mut cur, mut quoted, mut started, mut slashes) = (String::new(), false, false, 0usize);
    for c in cmdline.chars() {
        if c == '\\' {
            slashes += 1;
            started = true;
            continue;
        }
        if c == '"' {
            cur.push_str(&"\\".repeat(slashes / 2));
            if slashes % 2 == 1 {
                cur.push('"');
            } else {
                quoted = !quoted;
            }
            started = true;
        } else if c.is_whitespace() && !quoted {
            cur.push_str(&"\\".repeat(slashes));
            if started {
                out.push(std::mem::take(&mut cur));
                started = false;
            }
        } else {
            cur.push_str(&"\\".repeat(slashes));
            cur.push(c);
            started = true;
        }
        slashes = 0;
    }
    cur.push_str(&"\\".repeat(slashes));
    if started {
        out.push(cur);
    }
    out
}

/// Command lines of running processes by image name, read in-process (Toolhelp snapshot +
/// `NtQueryInformationProcess(ProcessCommandLineInformation)`): no PowerShell per `8sync ls`.
#[cfg(windows)]
mod win {
    use std::ffi::c_void;

    type Handle = *mut c_void;
    const TH32CS_SNAPPROCESS: u32 = 0x2;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
    const MAX_CMDLINE: u32 = 1 << 20;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *const u16,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snap: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn Process32NextW(snap: Handle, entry: *mut ProcessEntry32W) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(h: Handle) -> i32;
        fn GetModuleHandleW(name: *const u16) -> Handle;
        fn GetProcAddress(module: Handle, name: *const u8) -> *const c_void;
    }

    type NtQueryInformationProcess = unsafe extern "system" fn(Handle, u32, *mut c_void, u32, *mut u32) -> i32;

    fn nt_query() -> Option<NtQueryInformationProcess> {
        let name: Vec<u16> = "ntdll.dll".encode_utf16().chain([0]).collect();
        // SAFETY: ntdll is mapped in every process; the symbol has this signature on every Windows.
        unsafe {
            let m = GetModuleHandleW(name.as_ptr());
            if m.is_null() {
                return None;
            }
            let f = GetProcAddress(m, c"NtQueryInformationProcess".as_ptr().cast());
            (!f.is_null()).then(|| std::mem::transmute::<*const c_void, NtQueryInformationProcess>(f))
        }
    }

    /// Command line of `pid`; None when the process is gone or not ours to read.
    fn command_line(query: NtQueryInformationProcess, pid: u32) -> Option<String> {
        // SAFETY: the handle is closed below; the buffer is u64-aligned and `need` bytes long, and
        // the UNICODE_STRING it returns is only read after checking it points inside that buffer.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let mut need = 0u32;
            query(h, PROCESS_COMMAND_LINE_INFORMATION, std::ptr::null_mut(), 0, &mut need);
            let mut out = None;
            if need as usize >= std::mem::size_of::<UnicodeString>() && need <= MAX_CMDLINE {
                let mut buf = vec![0u64; (need as usize).div_ceil(8)];
                if query(h, PROCESS_COMMAND_LINE_INFORMATION, buf.as_mut_ptr().cast(), need, &mut need) >= 0 {
                    let us = &*(buf.as_ptr() as *const UnicodeString);
                    let (start, len) = (buf.as_ptr() as usize, buf.len() * 8);
                    let (at, bytes) = (us.buffer as usize, us.length as usize);
                    if at >= start && at + bytes <= start + len {
                        out = Some(String::from_utf16_lossy(std::slice::from_raw_parts(us.buffer, bytes / 2)));
                    }
                }
            }
            CloseHandle(h);
            out
        }
    }

    /// Pid, parent pid and image name of every running process (Toolhelp walk).
    fn snapshot() -> Vec<(u32, u32, String)> {
        let mut out = Vec::new();
        // SAFETY: plain Toolhelp walk; the entry is sized as the API requires and the snapshot is closed.
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap.is_null() || snap as isize == -1 {
                return out;
            }
            let mut e: ProcessEntry32W = std::mem::zeroed();
            e.dw_size = std::mem::size_of::<ProcessEntry32W>() as u32;
            let mut more = Process32FirstW(snap, &mut e) != 0;
            while more {
                let n = e.sz_exe_file.iter().position(|c| *c == 0).unwrap_or(e.sz_exe_file.len());
                out.push((e.th32_process_id, e.th32_parent_process_id, String::from_utf16_lossy(&e.sz_exe_file[..n])));
                more = Process32NextW(snap, &mut e) != 0;
            }
            CloseHandle(snap);
        }
        out
    }

    /// Pid and command line of every process whose image is `exe` (any case).
    pub(super) fn command_lines(exe: &str) -> Vec<(u32, String)> {
        let Some(query) = nt_query() else { return Vec::new() };
        snapshot().into_iter().filter(|(_, _, name)| name.eq_ignore_ascii_case(exe)).filter_map(|(pid, _, _)| command_line(query, pid).map(|c| (pid, c))).collect()
    }

    /// Creation time (FILETIME) of `pid`, 0 when it is gone or not ours to read.
    fn created(pid: u32) -> u64 {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetProcessTimes(h: Handle, created: *mut u64, exited: *mut u64, kernel: *mut u64, user: *mut u64) -> i32;
        }
        // SAFETY: the handle is checked and closed once; every out-pointer is a writable u64 (FILETIME).
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return 0;
            }
            let (mut c, mut x) = (0u64, 0u64);
            let ok = GetProcessTimes(h, &mut c, &mut x, &mut x, &mut x) != 0;
            CloseHandle(h);
            if ok {
                c
            } else {
                0
            }
        }
    }

    /// Every process, its argv split like `CommandLineToArgvW` (just the image name when its command line is not ours to read).
    pub(super) fn processes() -> Vec<super::ProcEntry> {
        let query = nt_query();
        snapshot()
            .into_iter()
            .map(|(pid, ppid, name)| {
                let argv = query.and_then(|q| command_line(q, pid)).map(|c| super::win_args(&c)).filter(|a| !a.is_empty()).unwrap_or_else(|| vec![name]);
                super::ProcEntry { pid, ppid, started: created(pid), argv }
            })
            .collect()
    }

    /// Full path of the image `pid` runs; None when it is gone or not ours to read.
    pub(super) fn image(pid: u32) -> Option<std::path::PathBuf> {
        #[link(name = "kernel32")]
        extern "system" {
            fn QueryFullProcessImageNameW(h: Handle, flags: u32, name: *mut u16, len: *mut u32) -> i32;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        // SAFETY: the handle is checked and closed once; `buf`/`len` are a writable buffer and its length.
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                return None;
            }
            let ok = QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0;
            CloseHandle(h);
            ok.then(|| String::from_utf16_lossy(&buf[..len as usize]).into())
        }
    }
}

/// One running process for a takeover's tree walk ([`processes`]). `started`: its creation time
/// (Windows FILETIME, Linux clock ticks since boot; 0 = unknown), which tells a real child from a
/// process whose dead parent's pid was reused.
#[derive(Clone, Debug, PartialEq)]
pub struct ProcEntry {
    pub pid: u32,
    pub ppid: u32,
    pub started: u64,
    pub argv: Vec<String>,
}

/// Every running process with its parent and argv. Linux: `/proc`; Windows: Toolhelp + command
/// lines read in-process. Empty elsewhere.
pub fn processes() -> Vec<ProcEntry> {
    #[cfg(target_os = "linux")]
    {
        let mut out = Vec::new();
        for e in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
            let Some(pid) = e.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else { continue };
            // `pid (comm) state ppid … starttime(22) …`: comm may hold spaces and parens, so read after the last `)`.
            let Ok(stat) = std::fs::read_to_string(e.path().join("stat")) else { continue };
            let rest: Vec<&str> = stat.rsplit_once(')').map(|(_, r)| r.split_whitespace().collect()).unwrap_or_default();
            let Some(ppid) = rest.get(1).and_then(|s| s.parse().ok()) else { continue };
            let started = rest.get(19).and_then(|s| s.parse().ok()).unwrap_or(0);
            let argv = std::fs::read(e.path().join("cmdline")).unwrap_or_default().split(|b| *b == 0).filter(|a| !a.is_empty()).map(|a| String::from_utf8_lossy(a).into_owned()).collect();
            out.push(ProcEntry { pid, ppid, started, argv });
        }
        out
    }
    #[cfg(windows)]
    {
        win::processes()
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        Vec::new()
    }
}

/// Full path of the program `pid` runs, None when it is gone or unreadable.
pub fn process_image(pid: u32) -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_link(format!("/proc/{pid}/exe")).ok()
    }
    #[cfg(windows)]
    {
        win::image(pid)
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = pid;
        None
    }
}

pub fn mtime_secs(p: &Path) -> Option<u64> {
    std::fs::metadata(p).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs())
}

// ── locating transcripts ────────────────────────────────────────────────────

/// Newest `*.jsonl` directly inside an omp session dir.
pub fn omp_transcript(session_dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(session_dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max_by_key(|(t, _)| *t)
        .map(|(_, p)| p)
}

/// `projects/*/<id>.jsonl` under Claude Code's config dir.
pub fn claude_transcript(home: &Path, id: &str) -> Option<PathBuf> {
    let base = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude"));
    let name = format!("{id}.jsonl");
    std::fs::read_dir(base.join("projects")).ok()?.flatten().map(|d| d.path().join(&name)).find(|p| p.is_file())
}

// ── transcript scan ─────────────────────────────────────────────────────────

/// Scan a transcript file (whole when small, tail otherwise). Never fails: an
/// unreadable file yields an empty digest.
pub fn scan_file(path: &Path, fmt: Fmt, detail: bool) -> Digest {
    let Ok(mut f) = std::fs::File::open(path) else {
        return Digest::default();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut partial = false;
    let mut first_title = None;
    if len > FULL_SCAN_CAP {
        // The omp title lives on line 1; keep it even when we only read the tail.
        if fmt == Fmt::Omp {
            let mut line = String::new();
            let _ = BufReader::new(&mut f).take(4096).read_line(&mut line);
            first_title = serde_json::from_str::<Value>(&line).ok().and_then(|v| title_of(&v));
        }
        let _ = f.seek(SeekFrom::Start(len - TAIL_BYTES));
        partial = true;
    }
    let mut r = BufReader::with_capacity(256 * 1024, f);
    if partial {
        let mut skip = Vec::new();
        let _ = r.read_until(b'\n', &mut skip); // drop the cut line
    }
    let mut d = scan_reader(r, fmt, detail);
    d.partial = partial;
    if first_title.is_some() {
        d.title = first_title;
    }
    d
}

/// Scan only the last `max_bytes` of a transcript (cheap, bounded; for per-refresh callers like
/// the status line). Never fails: an unreadable file yields an empty digest.
pub fn scan_tail(path: &Path, fmt: Fmt, max_bytes: u64) -> Digest {
    let Ok(mut f) = std::fs::File::open(path) else {
        return Digest::default();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let partial = len > max_bytes;
    if partial {
        let _ = f.seek(SeekFrom::Start(len - max_bytes));
    }
    let mut r = BufReader::with_capacity(64 * 1024, f);
    if partial {
        let mut skip = Vec::new();
        let _ = r.read_until(b'\n', &mut skip); // drop the cut line
    }
    let mut d = scan_reader(r, fmt, false);
    d.partial = partial;
    d
}

fn title_of(v: &Value) -> Option<String> {
    (v.get("type")?.as_str()? == "title").then(|| v.get("title")?.as_str().map(str::to_string)).flatten()
}

/// Core scanner over any line source (unit-tested on fixtures).
pub fn scan_reader<R: BufRead>(mut r: R, fmt: Fmt, detail: bool) -> Digest {
    let mut s = LineScanner::new(fmt, detail);
    let mut buf: Vec<u8> = Vec::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => s.feed(&buf),
        }
    }
    s.finish()
}

/// [`scan_reader`]'s state between lines, so a long-running caller can feed only the lines
/// appended since its last look (`feed` each line with its `\n`, as `read_until` yields it) and
/// get the same [`Digest`] a full scan would (`clone().finish()`).
#[derive(Clone, Debug)]
pub struct LineScanner {
    fmt: Fmt,
    detail: bool,
    d: Digest,
    last_asst: Vec<u8>,
    last_text: Vec<u8>,
    last_tool: Vec<u8>,
    tool_ring: VecDeque<Vec<u8>>,
    next_id: usize,
    change_title: Option<String>,
}

impl LineScanner {
    pub fn new(fmt: Fmt, detail: bool) -> Self {
        LineScanner {
            fmt,
            detail,
            d: Digest::default(),
            last_asst: Vec::new(),
            last_text: Vec::new(),
            last_tool: Vec::new(),
            tool_ring: VecDeque::new(),
            next_id: 1,
            change_title: None,
        }
    }

    /// One raw line (trailing `\n` included when the source had one).
    pub fn feed(&mut self, buf: &[u8]) {
        let Ok(line) = std::str::from_utf8(buf) else { return };
        let head = &line[..floor_boundary(line, 400)];
        let d = &mut self.d;
        match self.fmt {
            Fmt::Omp => {
                if head.starts_with(r#"{"type":"title""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        d.title = title_of(&v);
                    }
                } else if head.starts_with(r#"{"type":"title_change""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        self.change_title = v.get("title").and_then(|t| t.as_str()).map(str::to_string);
                    }
                } else if head.starts_with(r#"{"type":"session""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        d.cwd = v.get("cwd").and_then(|c| c.as_str()).map(str::to_string);
                    }
                } else if head.starts_with(r#"{"type":"model_change""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        d.model = v.get("model").and_then(|c| c.as_str()).map(str::to_string);
                    }
                } else if !head.starts_with(r#"{"type":"message""#) {
                    // custom / usage / compaction entries: nothing we show
                } else if head.contains(r#""role":"user""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if let Some(t) = omp_user_text(&v) {
                            push_user(d, t);
                        }
                    }
                } else if head.contains(r#""role":"toolResult""#) && head.contains(r#""toolName":"todo""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if let Some(t) = omp_tasks(&v) {
                            d.tasks = t;
                        }
                    }
                } else if head.contains(r#""role":"assistant""#) {
                    keep_assistant(line, buf, r#""type":"toolCall""#, &mut self.last_asst, &mut self.last_text, &mut self.last_tool);
                    if self.detail && line.contains(r#""type":"toolCall""#) {
                        push_ring(&mut self.tool_ring, buf);
                    }
                }
            }
            Fmt::Claude => {
                if line.contains(r#""isSidechain":true"#) {
                    return;
                }
                if head.starts_with(r#"{"type":"custom-title""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        d.title = v.get("customTitle").and_then(|c| c.as_str()).map(str::to_string);
                    }
                } else if head.starts_with(r#"{"type":"agent-name""#) {
                    if d.title.is_none() {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            self.change_title = v.get("agentName").and_then(|c| c.as_str()).map(str::to_string);
                        }
                    }
                } else if head.contains(r#""type":"user""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if let Some(c) = v.get("cwd").and_then(|c| c.as_str()) {
                            d.cwd = Some(c.to_string());
                        }
                        if let Some(b) = v.get("gitBranch").and_then(|c| c.as_str()).filter(|b| !b.is_empty()) {
                            if b != "HEAD" {
                                d.branch = Some(b.to_string());
                            }
                        }
                        if let Some(t) = claude_user_text(&v) {
                            push_user(d, t);
                        }
                    }
                } else if line.contains(r#""type":"assistant""#) {
                    keep_assistant(line, buf, r#""type":"tool_use""#, &mut self.last_asst, &mut self.last_text, &mut self.last_tool);
                    let has_task = line.contains(r#""name":"TaskCreate""#)
                        || line.contains(r#""name":"TaskUpdate""#)
                        || line.contains(r#""name":"TodoWrite""#);
                    if has_task {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            apply_claude_tasks(&v, &mut d.tasks, &mut self.next_id);
                        }
                    }
                    if self.detail && line.contains(r#""type":"tool_use""#) {
                        push_ring(&mut self.tool_ring, buf);
                    }
                }
            }
        }
    }

    /// The digest of every line fed so far.
    pub fn finish(self) -> Digest {
        let mut d = self.d;
        if d.title.is_none() {
            d.title = self.change_title;
        }
        // Latest assistant line → model + context size.
        if let Ok(v) = serde_json::from_slice::<Value>(&self.last_asst) {
            let m = v.get("message").unwrap_or(&v);
            if let Some(model) = m.get("model").and_then(|x| x.as_str()) {
                d.model = Some(model.to_string());
            }
            d.tokens = usage_tokens(m.get("usage"));
        }
        if let Ok(v) = serde_json::from_slice::<Value>(&self.last_text) {
            d.last_text = blocks(&v).iter().rev().find_map(text_block).map(|t| mask_secrets(&t));
        }
        if let Ok(v) = serde_json::from_slice::<Value>(&self.last_tool) {
            if let Some((n, a)) = blocks(&v).iter().rev().find_map(tool_block) {
                d.last_tool = Some(tool_summary(&n, &a));
                d.last_tool_name = Some(n);
            }
        }
        if self.detail {
            let mut seen = std::collections::HashSet::new();
            for raw in self.tool_ring.iter().rev() {
                let Ok(v) = serde_json::from_slice::<Value>(raw) else { continue };
                for b in blocks(&v).iter().rev() {
                    if let Some((n, a)) = tool_block(b) {
                        if let Some(p) = touched_file(&n, &a) {
                            if seen.insert(p.clone()) && d.files.len() < 10 {
                                d.files.push(p);
                            }
                        }
                    }
                }
            }
        }
        d
    }
}

fn floor_boundary(s: &str, max: usize) -> usize {
    let mut i = max.min(s.len());
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn push_ring(ring: &mut VecDeque<Vec<u8>>, line: &[u8]) {
    if ring.len() >= 60 {
        ring.pop_front();
    }
    ring.push_back(line.to_vec());
}

fn keep_assistant(line: &str, raw: &[u8], tool_marker: &str, asst: &mut Vec<u8>, text: &mut Vec<u8>, tool: &mut Vec<u8>) {
    asst.clear();
    asst.extend_from_slice(raw);
    if line.contains(r#""type":"text""#) {
        text.clear();
        text.extend_from_slice(raw);
    }
    if line.contains(tool_marker) {
        tool.clear();
        tool.extend_from_slice(raw);
    }
}

/// A prompt worth showing: drops pasted-image placeholders and the harness's
/// own turns (interrupt markers, "session is being continued" summaries).
fn real_prompt(t: &str) -> Option<String> {
    let mut t = t.trim();
    while let Some(rest) = t.strip_prefix("[Image #") {
        t = rest.split_once(']').map_or("", |(_, r)| r).trim_start();
    }
    let skip = t.is_empty() || t.starts_with("[Request interrupted") || t.starts_with("This session is being continued");
    (!skip).then(|| t.to_string())
}

fn push_user(d: &mut Digest, t: String) {
    let Some(t) = real_prompt(&t) else { return };
    d.user_msgs += 1;
    d.last_users.push(t);
    if d.last_users.len() > 5 {
        d.last_users.remove(0);
    }
}

fn blocks(v: &Value) -> Vec<Value> {
    let m = v.get("message").unwrap_or(v);
    m.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default()
}

fn text_block(b: &Value) -> Option<String> {
    (b.get("type")?.as_str()? == "text").then(|| b.get("text")?.as_str().map(str::to_string)).flatten().filter(|t| !t.trim().is_empty())
}

fn tool_block(b: &Value) -> Option<(String, Value)> {
    let ty = b.get("type")?.as_str()?;
    if ty != "toolCall" && ty != "tool_use" {
        return None;
    }
    let name = b.get("name")?.as_str()?.to_string();
    let args = b.get("arguments").or_else(|| b.get("input")).cloned().unwrap_or(Value::Null);
    Some((name, args))
}

fn omp_user_text(v: &Value) -> Option<String> {
    let m = v.get("message")?;
    if m.get("role")?.as_str()? != "user" {
        return None;
    }
    let text = match m.get("content")? {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(text_block).collect::<Vec<_>>().join("\n"),
        _ => return None,
    };
    let t = text.trim();
    (!t.is_empty()).then(|| t.to_string())
}

fn claude_user_text(v: &Value) -> Option<String> {
    if v.get("isMeta").and_then(|x| x.as_bool()) == Some(true) {
        return None;
    }
    if let Some(k) = v.get("origin").and_then(|o| o.get("kind")).and_then(|k| k.as_str()) {
        if k != "human" {
            return None;
        }
    }
    let m = v.get("message")?;
    let text = match m.get("content")? {
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().filter_map(text_block).collect::<Vec<_>>().join("\n"),
        _ => return None,
    };
    let t = text.trim();
    // Harness-injected turns (slash-command echoes, reminders) start with a tag.
    (!t.is_empty() && !t.starts_with('<')).then(|| t.to_string())
}

fn usage_tokens(u: Option<&Value>) -> Option<u64> {
    let u = u?;
    if let Some(t) = u.get("totalTokens").and_then(|t| t.as_u64()).filter(|t| *t > 0) {
        return Some(t);
    }
    let g = |k: &str| u.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let sum = g("input") + g("output") + g("cacheRead") + g("cacheWrite") + g("input_tokens") + g("output_tokens")
        + g("cache_read_input_tokens") + g("cache_creation_input_tokens");
    (sum > 0).then_some(sum)
}

fn state_of(s: &str) -> TaskState {
    match s {
        "completed" | "done" => TaskState::Done,
        "in_progress" | "active" => TaskState::InProgress,
        _ => TaskState::Pending,
    }
}

/// omp `todo` tool result → the full task list (authoritative: it is the state
/// after the call, so the last one wins).
fn omp_tasks(v: &Value) -> Option<Vec<Task>> {
    let phases = v.get("message")?.get("details")?.get("phases")?.as_array()?;
    let mut out = Vec::new();
    for p in phases {
        for t in p.get("tasks").and_then(|t| t.as_array()).into_iter().flatten() {
            let title = t.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
            let st = t.get("status").and_then(|s| s.as_str()).unwrap_or("pending");
            // "abandoned"/"dropped" are no longer work to do.
            if matches!(st, "abandoned" | "dropped") {
                continue;
            }
            out.push(Task { id: out.len().to_string(), title, state: state_of(st) });
        }
    }
    Some(out)
}

/// Replay one assistant line's `TaskCreate` / `TaskUpdate` / `TodoWrite` calls.
/// Task ids are assigned 1,2,3… in creation order (what `TaskUpdate.taskId` uses).
fn apply_claude_tasks(v: &Value, tasks: &mut Vec<Task>, next_id: &mut usize) {
    for b in blocks(v) {
        let Some((name, a)) = tool_block(&b) else { continue };
        match name.as_str() {
            "TaskCreate" => {
                let title = a.get("subject").and_then(|s| s.as_str()).unwrap_or("").to_string();
                tasks.push(Task { id: next_id.to_string(), title, state: TaskState::Pending });
                *next_id += 1;
            }
            "TaskUpdate" => {
                let Some(id) = a.get("taskId").map(|i| i.as_str().map(str::to_string).unwrap_or_else(|| i.to_string())) else {
                    continue;
                };
                let status = a.get("status").and_then(|s| s.as_str());
                if status == Some("deleted") {
                    tasks.retain(|t| t.id != id);
                    continue;
                }
                if let Some(t) = tasks.iter_mut().find(|t| t.id == id) {
                    if let Some(s) = status {
                        t.state = state_of(s);
                    }
                    if let Some(sub) = a.get("subject").and_then(|s| s.as_str()) {
                        t.title = sub.to_string();
                    }
                }
            }
            "TodoWrite" => {
                tasks.clear();
                for (i, t) in a.get("todos").and_then(|t| t.as_array()).into_iter().flatten().enumerate() {
                    let title = t.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
                    let st = t.get("status").and_then(|s| s.as_str()).unwrap_or("pending");
                    tasks.push(Task { id: (i + 1).to_string(), title, state: state_of(st) });
                }
            }
            _ => {}
        }
    }
}

/// `name: what` for the status line. omp attaches a human intent (`i`/`intent`)
/// to every call; otherwise fall back to the most telling argument.
pub fn tool_summary(name: &str, args: &Value) -> String {
    let s = |k: &str| args.get(k).and_then(|x| x.as_str());
    let what = s("intent")
        .or_else(|| s("i"))
        .or_else(|| s("description"))
        .or_else(|| s("command"))
        .or_else(|| s("file_path"))
        .or_else(|| s("path"))
        .or_else(|| s("pattern"))
        .or_else(|| s("subject"))
        .or_else(|| s("query"))
        .or_else(|| s("url"))
        .unwrap_or("");
    let what = first_line(what);
    if what.is_empty() {
        name.to_string()
    } else {
        format!("{name}: {what}")
    }
}

/// File a write-style tool call changed (omp `edit` keeps the path inside
/// `input` as `[path#hash]`).
fn touched_file(name: &str, args: &Value) -> Option<String> {
    if !matches!(name, "edit" | "write" | "Edit" | "Write" | "MultiEdit" | "NotebookEdit") {
        return None;
    }
    let s = |k: &str| args.get(k).and_then(|x| x.as_str());
    if let Some(p) = s("file_path").or_else(|| s("path")).or_else(|| s("notebook_path")) {
        return (!p.starts_with("xd://")).then(|| p.to_string());
    }
    let inp = s("input")?.trim_start();
    let inner = inp.strip_prefix('[')?;
    let end = inner.find(']')?;
    Some(inner[..end].split('#').next()?.to_string())
}

/// Session id usable as a file name: 1..=128 chars of `[A-Za-z0-9_-]`, else `None`.
pub fn safe_id(s: &str) -> Option<String> {
    (!s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).then(|| s.to_string())
}

/// API error type and planned automatic resume time (`resume_at`, epoch s) recorded by the kit's
/// StopFailure hook for a Claude session (`<dir>/<session_id>.json`, written by `ccc/resume.rs`).
/// Read-only; records older than 24 h, or already resumed by 8sync (`resumed_at`), are ignored.
fn stalled_error_in(dir: &Path, row: &Row, now_s: u64) -> Option<(String, Option<u64>)> {
    if row.engine != "claude" {
        return None;
    }
    let id = safe_id(row.transcript.as_deref()?.file_stem()?.to_str()?)?;
    let rec: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(format!("{id}.json"))).ok()?).ok()?;
    if now_s.saturating_sub(rec["ts"].as_u64()?) > 24 * 3600 || !rec["resumed_at"].is_null() {
        return None;
    }
    Some((rec["error"].as_str()?.to_string(), rec["resume_at"].as_u64()))
}

fn stalled_error(row: &Row) -> Option<(String, Option<u64>)> {
    // Same home as the writer (`8sync ccc hook stop-failure`): `$HOME` on unix, the profile
    // folder on Windows, where a hook or HQ child often has no HOME.
    let home = dirs::home_dir();
    let dir = home.filter(|h| h.is_absolute())?.join(".local/state/8sync/ccc/stopfail");
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    stalled_error_in(&dir, row, now)
}

/// Claude session uuid for `claude`/`ccc` rows: the transcript file stem (= registry conversation_id).
fn claude_sid(row: &Row) -> Option<String> {
    if !matches!(row.engine, "claude" | "ccc") {
        return None;
    }
    row.transcript.as_deref()?.file_stem()?.to_str().map(str::to_string)
}

/// JSON for one session — the `--json` contract of `ls`.
pub fn row_json(row: &Row) -> Value {
    let d = &row.digest;
    let stalled = stalled_error(row);
    serde_json::json!({
        "schema": crate::SCHEMA,
        "engine": row.engine,
        "sid": claude_sid(row),
        "name": row.name,
        "last_used": row.is_last,
        "status": row.status.as_str(),
        "last_active": row.last_active,
        "title": d.title.as_deref().map(|t| clean(t, 200)),
        "branch": row.branch,
        "dirty": row.branch.as_ref().map(|_| row.dirty),
        "doing": d.current_task().map(|t| t.title.clone()).or_else(|| d.last_activity()).map(|s| clean(&s, 200)),
        "last_user": d.last_user().map(|u| clean(u, 200)),
        "last_activity": d.last_activity().map(|s| clean(&s, 200)),
        "last_tool": d.last_tool_name.as_deref().map(|s| clean(s, 60)),
        "stalled_error": stalled.as_ref().map(|s| &s.0),
        "stalled_resume_at": stalled.as_ref().and_then(|s| s.1),
        "current_task": d.current_task().map(|t| clean(&t.title, 200)),
        "tasks_done": d.tasks_done(),
        "tasks_total": d.tasks.len(),
        "messages": d.user_msgs,
        "tokens": d.tokens,
        "model": d.model,
        "resume": mask_secrets(&row.resume),
        "inbox_id": row.inbox_id,
        // Local transcript file: HQ reads an omp room's "Nhật ký" from it (server side only).
        "transcript": row.transcript.as_deref().map(|p| p.to_string_lossy()),
    })
}

/// JSON for `show --json`: [`row_json`] plus the detail `8sync show` prints.
/// Every free-text field goes through the shared masker (`secret_mask.rs`).
pub fn show_json(row: &Row) -> Value {
    let d = &row.digest;
    let mut v = row_json(row);
    v["last_users"] = d.last_users.iter().map(|u| clean(u, 600)).collect::<Vec<_>>().into();
    v["last_text"] = d.last_text.as_deref().map(|t| truncate(&mask_secrets(t), 4000)).into();
    v["tasks"] = d
        .tasks
        .iter()
        .map(|t| {
            let state = match t.state {
                TaskState::Pending => "pending",
                TaskState::InProgress => "in_progress",
                TaskState::Done => "done",
            };
            serde_json::json!({ "id": clean(&t.id, 60), "title": clean(&t.title, 300), "state": state })
        })
        .collect::<Vec<_>>()
        .into();
    v["files"] = d.files.iter().map(|f| clean(f, 400)).collect::<Vec<_>>().into();
    v
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Row shown for a session whose transcript scan failed.
pub fn unreadable(engine: &'static str, name: &str, resume: String, last_active: u64) -> Row {
    Row {
        engine,
        name: name.to_string(),
        is_last: false,
        status: Status::Idle,
        last_active,
        branch: None,
        dirty: false,
        digest: Digest { title: Some("unreadable".into()), ..Default::default() },
        resume,
        transcript: None,
        inbox_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn row(digest: Digest) -> Row {
        Row {
            engine: "omp",
            name: "core".into(),
            is_last: true,
            status: Status::Running,
            last_active: 1000,
            branch: None,
            dirty: false,
            digest,
            resume: "8sync . core".into(),
            transcript: None,
            inbox_id: None,
        }
    }

    #[test]
    fn truncate_is_char_safe() {
        assert_eq!(truncate("Tiếng Việt có dấu rất dài", 10), "Tiếng Việ…");
        assert_eq!(truncate("héllo", 5), "héllo");
        assert_eq!(truncate("日本語のテキスト", 4), "日本語…");
        assert_eq!(truncate("abc", 0), "");
        assert_eq!(truncate("abc", 1), "…");
    }

    #[test]
    fn status_detection() {
        let procs = vec![
            b"omp\0--cwd\0/r\0--session-dir\0/s/core\0--continue\0".to_vec(),
            b"/home/u/.local/bin/claude\0--resume\0aaaa-bbbb\0".to_vec(),
            b"vim\0/s/rd\0".to_vec(),
        ];
        assert!(proc_matches(&procs, "/s/core"));
        assert!(proc_matches(&procs, "aaaa-bbbb"));
        assert!(!proc_matches(&procs, "/s/rd"), "an editor is not an agent");
        assert!(!proc_matches(&procs, "/s/other"));
        assert!(!proc_matches(&procs, ""));
        assert_eq!(classify(true, None, 100), Status::Running);
        assert_eq!(classify(false, Some(950), 1000), Status::Active);
        assert_eq!(classify(false, Some(100), 1000), Status::Idle);
        assert_eq!(classify(false, None, 1000), Status::Idle);
    }

    #[test]
    fn omp_resumed_by_transcript_file_counts_for_its_session_dir() {
        let procs = vec![
            b"/usr/bin/omp.exe\0--extension\0x.ts\0--resume\0/s/web/2026-10-07_01a1.jsonl\0".to_vec(),
            b"omp\0/s/notes/readme.md\0".to_vec(),
        ];
        assert!(proc_matches(&procs, "/s/web"));
        assert!(proc_matches(&procs, "/s/web/"), "trailing separator");
        assert!(!proc_matches(&procs, "/s"), "only the file's own dir");
        assert!(!proc_matches(&procs, "/s/web/sub"));
        assert!(!proc_matches(&procs, "/s/notes"), "a non-transcript file is not a session");
    }

    #[cfg(windows)]
    #[test]
    fn windows_command_lines_match_in_any_case_and_slash() {
        let argv = |c: &str| win_args(c).join("\0").into_bytes();
        let procs = vec![
            argv(r#""omp" --cwd C:\r --session-dir C:\Users\A\8sync\sessions\K\core --continue"#),
            argv(r#""C:\Users\A\AppData\Local\omp\omp.exe" --resume C:\Users\A\8sync\sessions\K2\core\2026-10-07T03_01a1.jsonl"#),
            argv(r#"C:\Windows\notepad.exe C:\Users\A\8sync\sessions\K3\core"#),
        ];
        assert!(proc_matches(&procs, "C:/users/a/8sync/sessions/k/CORE/"));
        assert!(proc_matches(&procs, r"C:\Users\A\8sync\sessions\K2\core"));
        assert!(!proc_matches(&procs, r"C:\Users\A\8sync\sessions\K3\core"), "an editor is not an agent");
        assert!(!proc_matches(&procs, r"C:\Users\A\8sync\sessions\K\core2"));
    }

    #[test]
    fn win_args_splits_like_command_line_to_argv() {
        assert_eq!(win_args(r#""omp" --cwd C:\r --session-dir C:\s\omp-lead --continue"#), ["omp", "--cwd", r"C:\r", "--session-dir", r"C:\s\omp-lead", "--continue"]);
        assert_eq!(win_args(r#""C:\a b\omp.exe"  "C:\x y\" a\\\"b"#), [r"C:\a b\omp.exe", r#"C:\x y" a\"b"#]);
        assert_eq!(win_args(r#"x "" y"#), ["x", "", "y"]);
        assert!(win_args("   ").is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_scan_reads_real_command_lines() {
        // The test binary itself is a running process: its own command line must come back whole.
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_string_lossy().into_owned();
        let lines = win::command_lines(&name);
        let me = name.to_lowercase();
        assert!(lines.iter().any(|(pid, l)| *pid == std::process::id() && win_args(l).first().is_some_and(|a| a.to_lowercase().ends_with(&me))), "{lines:?}");
    }

    #[test]
    fn secrets_are_masked() {
        let m = mask_secrets("use sk-ant-api03-abcdefghijkl and ghp_abcdefghijklmnop with API_KEY=hunter2 Bearer abc123 ok");
        assert_eq!(m, "use *** and *** with API_KEY=*** Bearer *** ok");
        assert_eq!(mask_secrets("normal words here"), "normal words here");
        assert_eq!(mask_secrets(&"a1".repeat(20)), "***");
        assert_eq!(mask_secrets("src/verbs/session_view.rs"), "src/verbs/session_view.rs");
    }

    #[test]
    fn row_json_masks_prose_password_in_last_user() {
        let mut d = Digest::default();
        d.last_users = vec!["sudo password của tôi là Fake9876 nhé".into()];
        d.title = Some("mật khẩu: Fake9876x".into());
        let j = row_json(&row(d));
        assert_eq!(j["last_user"], "sudo password của tôi là *** nhé");
        assert_eq!(j["title"], "mật khẩu: ***");
        assert!(!j.to_string().contains("Fake9876"));
    }

    #[test]
    fn show_json_has_schema_detail_and_masks_prose_password() {
        let mut d = Digest::default();
        d.last_users = vec!["a".into(), "sudo password của tôi là Fake9876 nhé".into()];
        d.last_text = Some("line one\nmật khẩu: Fake9876x\nlast".into());
        d.tasks = vec![Task { id: "1".into(), title: "viết test".into(), state: TaskState::InProgress }];
        d.files = vec!["/w/src/a.rs".into()];
        let j = show_json(&row(d));
        assert_eq!(j["schema"], 1);
        assert_eq!(j["engine"], "omp");
        assert_eq!(j["last_users"][1], "sudo password của tôi là *** nhé");
        assert!(j["last_text"].as_str().unwrap().contains("mật khẩu: ***"));
        assert!(j["last_text"].as_str().unwrap().contains('\n'), "multi-line text kept");
        assert_eq!(j["tasks"][0], serde_json::json!({"id": "1", "title": "viết test", "state": "in_progress"}));
        assert_eq!(j["files"][0], "/w/src/a.rs");
        assert_eq!(j["resume"], "8sync . core");
        assert!(!j.to_string().contains("Fake9876"));
        assert_eq!(row_json(&row(Digest::default()))["schema"], 1);
    }

    #[test]
    fn row_json_masks_title_and_unreadable_row_is_idle() {
        let mut r = unreadable("omp", "a", "8sync . a".into(), 5);
        assert_eq!((r.digest.title.as_deref(), r.status), (Some("unreadable"), Status::Idle));
        r.digest.title = Some("fix token: abc123def456 now".into());
        assert_eq!(row_json(&r)["title"], "fix token: *** now");
    }

    const OMP: &str = r#"{"type":"title","v":1,"title":"Fix login flow","source":"auto"}
{"type":"session","version":3,"id":"x","cwd":"/work/demo","title":"old"}
{"type":"model_change","id":"m","model":"vendor/zai/glm-5.2"}
{"type":"message","id":"a","parentId":null,"timestamp":"t","message":{"role":"user","content":[{"type":"text","text":"first request"}]}}
{"type":"message","id":"b","parentId":"a","timestamp":"t","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hm"},{"type":"toolCall","id":"c1","name":"todo","arguments":{"op":"init"},"intent":"x"}],"usage":{"totalTokens":900}}}
{"type":"message","id":"c","parentId":"b","timestamp":"t","message":{"role":"toolResult","toolCallId":"c1","toolName":"todo","content":[{"type":"text","text":"ok"}],"details":{"op":"init","phases":[{"name":"P","tasks":[{"content":"plan","status":"completed"},{"content":"build it","status":"in_progress"},{"content":"ship","status":"pending"},{"content":"dropped one","status":"abandoned"}]}]}}}
{"type":"message","id":"d","parentId":"c","timestamp":"t","message":{"role":"user","content":[{"type":"text","text":"second request\nline two"}]}}
{"type":"message","id":"e","parentId":"d","timestamp":"t","message":{"role":"assistant","content":[{"type":"text","text":"Done with the plan.\nMore."},{"type":"toolCall","id":"c2","name":"edit","arguments":{"input":"[/work/demo/src/a.rs#AB12]\nPUT 1:x","i":"patching a.rs"}}],"model":"zai/glm-5.2","usage":{"input":10,"output":5,"cacheRead":100,"cacheWrite":0,"totalTokens":115}}}
"#;

    #[test]
    fn parses_omp_fixture() {
        let d = scan_reader(Cursor::new(OMP), Fmt::Omp, true);
        assert_eq!(d.title.as_deref(), Some("Fix login flow"));
        assert_eq!(d.cwd.as_deref(), Some("/work/demo"));
        assert_eq!(d.user_msgs, 2);
        assert_eq!(d.last_users, ["first request", "second request\nline two"]);
        assert_eq!(d.last_user(), Some("second request\nline two"));
        assert_eq!(d.last_tool.as_deref(), Some("edit: patching a.rs"));
        assert_eq!(d.last_text.as_deref(), Some("Done with the plan.\nMore."));
        assert_eq!(d.tokens, Some(115));
        assert_eq!(d.model.as_deref(), Some("zai/glm-5.2"));
        assert_eq!((d.tasks_done(), d.tasks.len()), (1, 3), "abandoned tasks are not work");
        assert_eq!(d.current_task().unwrap().title, "build it");
        assert_eq!(d.files, ["/work/demo/src/a.rs"]);
    }

    const CC: &str = r#"{"type":"custom-title","customTitle":"core","sessionId":"s"}
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":"add retries to the client"},"origin":{"kind":"human"},"cwd":"/work/demo","gitBranch":"main"}
{"parentUuid":"1","isSidechain":false,"message":{"model":"claude-x","role":"assistant","content":[{"type":"tool_use","id":"t1","name":"TaskCreate","input":{"subject":"write test"}},{"type":"tool_use","id":"t2","name":"TaskCreate","input":{"subject":"implement"}},{"type":"tool_use","id":"t3","name":"TaskCreate","input":{"subject":"drop me"}}],"usage":{"input_tokens":5,"cache_read_input_tokens":1000,"output_tokens":20}},"type":"assistant"}
{"type":"user","isSidechain":false,"message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]},"origin":{"kind":"human"}}
{"type":"user","isSidechain":false,"message":{"role":"user","content":"<system-reminder>x</system-reminder>"}}
{"parentUuid":"2","isSidechain":false,"message":{"model":"claude-x","role":"assistant","content":[{"type":"text","text":"Starting now"},{"type":"tool_use","id":"t4","name":"TaskUpdate","input":{"taskId":"1","status":"completed"}},{"type":"tool_use","id":"t5","name":"TaskUpdate","input":{"taskId":"2","status":"in_progress"}},{"type":"tool_use","id":"t6","name":"TaskUpdate","input":{"taskId":"3","status":"deleted"}},{"type":"tool_use","id":"t7","name":"Bash","input":{"command":"cargo test -p client","description":"Run client tests"}}]},"type":"assistant"}
{"isSidechain":true,"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"subagent noise"}]}}
"#;

    #[test]
    fn parses_claude_task_tools() {
        let d = scan_reader(Cursor::new(CC), Fmt::Claude, false);
        assert_eq!(d.title.as_deref(), Some("core"));
        assert_eq!(d.cwd.as_deref(), Some("/work/demo"));
        assert_eq!(d.branch.as_deref(), Some("main"));
        assert_eq!(d.user_msgs, 1, "tool results and injected reminders are not prompts");
        assert_eq!(d.last_user(), Some("add retries to the client"));
        assert_eq!(d.tasks.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["write test", "implement"]);
        assert_eq!((d.tasks_done(), d.tasks.len()), (1, 2));
        assert_eq!(d.current_task().unwrap().title, "implement");
        assert_eq!(d.last_tool.as_deref(), Some("Bash: Run client tests"));
        assert_eq!(d.last_tool_name.as_deref(), Some("Bash"));
        assert_eq!(row_json(&row(d.clone()))["last_tool"], "Bash");
        assert_eq!(d.last_text.as_deref(), Some("Starting now"));
        assert!(d.files.is_empty(), "files only on detail scans");
        assert_eq!(d.model.as_deref(), Some("claude-x"));
    }

    #[test]
    fn parses_claude_todowrite() {
        let t = r#"{"type":"assistant","isSidechain":false,"message":{"role":"assistant","content":[{"type":"tool_use","name":"TodoWrite","input":{"todos":[{"content":"a","status":"completed","activeForm":"A"},{"content":"b","status":"in_progress","activeForm":"B"},{"content":"c","status":"pending","activeForm":"C"}]}}]}}
"#;
        let d = scan_reader(Cursor::new(t), Fmt::Claude, false);
        assert_eq!((d.tasks_done(), d.tasks.len()), (1, 3));
        assert_eq!(d.current_task().unwrap().title, "b");
    }

    #[test]
    fn harness_turns_are_not_prompts() {
        assert_eq!(real_prompt("[Image #1] do the thing").as_deref(), Some("do the thing"));
        assert_eq!(real_prompt("[Image #1][Image #2]  x").as_deref(), Some("x"));
        assert_eq!(real_prompt("[Request interrupted by user for tool use]"), None);
        assert_eq!(real_prompt("This session is being continued from a previous conversation"), None);
        assert_eq!(real_prompt("  [Image #3]  "), None);
    }

    #[test]
    fn json_has_new_fields() {
        let d = scan_reader(Cursor::new(OMP), Fmt::Omp, false);
        let v = row_json(&row(d));
        for k in ["status", "doing", "tasks_done", "tasks_total", "current_task", "last_user", "last_activity", "name", "branch"] {
            assert!(v.get(k).is_some(), "missing {k}: {v}");
        }
        assert_eq!(v["status"], "running");
        assert_eq!(v["tasks_done"], 1);
        assert_eq!(v["tasks_total"], 3);
        assert_eq!(v["current_task"], "build it");
        assert_eq!(v["doing"], "build it");
        assert_eq!(v["branch"], Value::Null);
        assert_eq!(v["sid"], Value::Null, "omp row has no claude sid");
        let mut c = row(scan_reader(Cursor::new(OMP), Fmt::Omp, false));
        c.engine = "ccc";
        c.transcript = Some(PathBuf::from("/x/abc-123.jsonl"));
        assert_eq!(row_json(&c)["sid"], "abc-123");
        c.engine = "feynman";
        assert_eq!(row_json(&c)["sid"], Value::Null);
    }

    #[test]
    fn stalled_error_reads_fresh_record_only() {
        let dir = std::env::temp_dir().join(format!("8sync-sv-stopfail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut r = row(Digest::default());
        r.engine = "claude";
        r.transcript = Some(PathBuf::from("/x/abc-123.jsonl"));
        assert_eq!(stalled_error_in(&dir, &r, 1000), None, "absent");
        std::fs::write(dir.join("abc-123.json"), r#"{"error":"rate_limit","ts":1000,"cwd":"/w"}"#).unwrap();
        assert_eq!(stalled_error_in(&dir, &r, 2000), Some(("rate_limit".into(), None)), "old record shape: no resume time");
        assert_eq!(stalled_error_in(&dir, &r, 1000 + 24 * 3600 + 1), None, "old");
        std::fs::write(dir.join("abc-123.json"), r#"{"error":"overloaded","ts":1000,"cwd":"/w","auto":0,"resume_at":1060,"resumed_at":null}"#).unwrap();
        assert_eq!(stalled_error_in(&dir, &r, 2000), Some(("overloaded".into(), Some(1060))));
        std::fs::write(dir.join("abc-123.json"), r#"{"error":"overloaded","ts":1000,"cwd":"/w","auto":0,"resume_at":1060,"resumed_at":1061}"#).unwrap();
        assert_eq!(stalled_error_in(&dir, &r, 2000), None, "resumed by 8sync: not stuck");
        assert!(dir.join("abc-123.json").exists(), "never deleted");
        r.engine = "omp";
        assert_eq!(stalled_error_in(&dir, &r, 2000), None, "claude only");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_survives_garbage_and_missing() {
        assert_eq!(scan_file(Path::new("/definitely/not/here.jsonl"), Fmt::Omp, false).user_msgs, 0);
        let d = scan_reader(Cursor::new("not json\n{\"type\":\"message\",\"message\":{\"role\":\"user\"\n\n"), Fmt::Omp, false);
        assert_eq!(d.user_msgs, 0);
    }
}

