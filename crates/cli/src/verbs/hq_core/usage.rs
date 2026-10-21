//! Incremental transcript token scanner: the scan half of `apps/hq-ui/lib/server/usage.ts`
//! (`transcriptDirs`, `scanTranscripts`, the per-session dedupe of `rowsFrom` and `sumAll`) kept
//! warm in the core. Node keeps what needs its database (names, aliases, projects) and builds the
//! same `/api/usage` rows from this output. Same rules: per-file offset (always a line start),
//! dedupe by message id keeping the largest usage, ≤ 48 MiB read per call, a long transcript's
//! first read binary-searches the first line at or after `keep_from`.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const BYTES_PER_REQUEST: u64 = 48 * 1024 * 1024;
const CHUNK: u64 = 4 * 1024 * 1024;
const MAX_LINE: u64 = 32 * 1024 * 1024;
const SEEK_MIN: u64 = 2 * 1024 * 1024;
/// Bounds on the warm state; real use stays far below both.
const MAX_FILES: usize = 4096;
const MAX_CALLS_PER_FILE: usize = 200_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Call {
    pub ts: i64,
    pub input: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub output: u64,
}

#[derive(Debug, Default)]
pub struct FileState {
    pub size: u64,
    pub mtime: f64,
    pub offset: u64,
    skipping: bool,
    pub session_id: String,
    pub cwd: Option<String>,
    pub model: Option<String>,
    /// Insertion-ordered so dedupe across files picks the same call node would.
    pub calls: Vec<(String, Call)>,
    index: HashMap<String, usize>,
}

impl FileState {
    fn keep(&mut self, id: String, c: Call) {
        if let Some(&i) = self.index.get(&id) {
            let o = &mut self.calls[i].1;
            o.ts = o.ts.min(c.ts);
            o.input = o.input.max(c.input);
            o.cache_read = o.cache_read.max(c.cache_read);
            o.cache_write = o.cache_write.max(c.cache_write);
            o.output = o.output.max(c.output);
        } else if self.calls.len() < MAX_CALLS_PER_FILE {
            self.index.insert(id.clone(), self.calls.len());
            self.calls.push((id, c));
        }
    }

    fn prune(&mut self, keep_from: i64) {
        if self.calls.iter().all(|(_, c)| c.ts >= keep_from) {
            return;
        }
        self.calls.retain(|(_, c)| c.ts >= keep_from);
        self.index = self.calls.iter().enumerate().map(|(i, (id, _))| (id.clone(), i)).collect();
    }
}

// ---------- one line ----------

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type")]
    ty: Option<Value>,
    timestamp: Option<Value>,
    cwd: Option<Value>,
    #[serde(rename = "requestId")]
    request_id: Option<Value>,
    message: Option<Msg>,
}

#[derive(Deserialize)]
struct Msg {
    id: Option<Value>,
    model: Option<Value>,
    usage: Option<Value>,
}

/// `num` in usage.ts: a positive finite number, else 0.
fn num(v: Option<&Value>) -> u64 {
    v.and_then(Value::as_f64).filter(|x| x.is_finite() && *x > 0.0).map_or(0, |x| x as u64)
}

/// An assistant line with usage → (id, call, cwd, model); anything else None (usage.ts `parseLine`).
pub fn parse_line(line: &str) -> Option<(String, Call, Option<String>, Option<String>)> {
    if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
        return None;
    }
    let v: Line = serde_json::from_str(line).ok()?;
    if v.ty.as_ref().and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let m = v.message?;
    let u = m.usage.filter(Value::is_object)?;
    let id = match m.id.as_ref().and_then(Value::as_str) {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => v.request_id.as_ref().and_then(Value::as_str)?.to_string(),
    };
    if id.is_empty() {
        return None;
    }
    let ts = parse_iso_ms(v.timestamp.as_ref()?.as_str()?)?;
    let call = Call {
        ts,
        input: num(u.get("input_tokens")),
        cache_read: num(u.get("cache_read_input_tokens")),
        cache_write: num(u.get("cache_creation_input_tokens")),
        output: num(u.get("output_tokens")),
    };
    if call.input + call.cache_read + call.cache_write + call.output == 0 {
        return None; // <synthetic>
    }
    let model = m.model.as_ref().and_then(Value::as_str).filter(|s| *s != "<synthetic>").map(str::to_string);
    let cwd = v.cwd.as_ref().and_then(Value::as_str).map(str::to_string);
    Some((id, call, cwd, model))
}

/// `YYYY-MM-DDTHH:MM:SS[.fff…](Z|±HH:MM)` → unix ms (the form Claude Code writes; `Date.parse` subset).
pub fn parse_iso_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || !matches!(b[10], b'T' | b't' | b' ') || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let d = |r: std::ops::Range<usize>| -> Option<i64> { s.get(r)?.parse::<i64>().ok() };
    let (y, mo, da, h, mi, se) = (d(0..4)?, d(5..7)?, d(8..10)?, d(11..13)?, d(14..16)?, d(17..19)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&da) || h > 24 || mi > 59 || se > 59 {
        return None;
    }
    let mut i = 19;
    let mut ms = 0i64;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        let frac = &s[start..i];
        if frac.is_empty() {
            return None;
        }
        ms = format!("{:0<3}", &frac[..frac.len().min(3)]).parse().ok()?;
    }
    let off_min = match b.get(i) {
        Some(b'Z' | b'z') if i + 1 == b.len() => 0,
        Some(sign @ (b'+' | b'-')) if b.len() == i + 6 && b[i + 3] == b':' => {
            let v = d(i + 1..i + 3)? * 60 + d(i + 4..i + 6)?;
            if *sign == b'+' { v } else { -v }
        }
        _ => return None,
    };
    // days from civil (Howard Hinnant)
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = yy.div_euclid(400);
    let yoe = yy - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + da - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + h * 3600 + mi * 60 + se - off_min * 60) * 1000) + ms)
}

// ---------- seeking ----------

/// First `"timestamp":"…"` value in a line.
fn line_ts(line: &[u8]) -> Option<i64> {
    const KEY: &[u8] = b"\"timestamp\":\"";
    let at = line.windows(KEY.len()).position(|w| w == KEY)? + KEY.len();
    let rest = &line[at..];
    let end = rest.iter().take(41).position(|&c| c == b'"')?;
    if !(10..=40).contains(&end) {
        return None;
    }
    parse_iso_ms(std::str::from_utf8(&rest[..end]).ok()?)
}

/// The first timestamp at or after byte `at` (on a fresh line) and that line's start; None within the next 256 KiB.
fn ts_at(f: &mut File, at: u64, size: u64) -> Option<(i64, u64)> {
    let mut buf = vec![0u8; (256 * 1024).min(size - at) as usize];
    f.seek(SeekFrom::Start(at)).ok()?;
    let n = read_full(f, &mut buf);
    let buf = &buf[..n];
    let mut i = if at == 0 { 0 } else { buf.iter().position(|&c| c == b'\n')? + 1 };
    while i < n {
        let end = i + buf[i..].iter().position(|&c| c == b'\n')?;
        if let Some(ts) = line_ts(&buf[i..end]) {
            return Some((ts, at + i as u64));
        }
        i = end + 1;
    }
    None
}

/// Binary search for a line start before `since` near the first line at/after it (usage.ts `seekSince`).
pub fn seek_since(f: &mut File, size: u64, since: i64) -> u64 {
    let (mut lo, mut hi) = (0u64, size);
    while hi - lo > 1024 * 1024 {
        let mid = (lo + hi) / 2;
        match ts_at(f, mid, size) {
            Some((ts, line)) if ts < since => lo = line,
            _ => hi = mid,
        }
    }
    lo
}

fn read_full(f: &mut File, buf: &mut [u8]) -> usize {
    let mut n = 0;
    while n < buf.len() {
        match f.read(&mut buf[n..]) {
            Ok(0) | Err(_) => break,
            Ok(k) => n += k,
        }
    }
    n
}

/// New complete lines of one file into its state, at most `budget` bytes; bytes consumed.
fn read_new(path: &Path, st: &mut FileState, budget: u64) -> u64 {
    let Ok(mut f) = File::open(path) else { return 0 };
    let mut used = 0u64;
    let mut buf: Vec<u8> = Vec::new();
    while st.offset < st.size && used < budget {
        let mut len = CHUNK.min(st.size - st.offset).min(budget - used);
        let read_at = |f: &mut File, buf: &mut Vec<u8>, len: u64| -> usize {
            buf.resize(len as usize, 0);
            if f.seek(SeekFrom::Start(st.offset)).is_err() {
                return 0;
            }
            read_full(f, buf)
        };
        let mut n = read_at(&mut f, &mut buf, len);
        if n == 0 {
            break;
        }
        let mut nl = buf[..n].iter().rposition(|&c| c == b'\n');
        // Out of budget mid-line: the next request goes on from this line start.
        if nl.is_none() && used > 0 {
            break;
        }
        // A line longer than the chunk: grow up to MAX_LINE, past it skip the line.
        while nl.is_none() && st.offset + (n as u64) < st.size && len < MAX_LINE {
            len = (len * 2).min(MAX_LINE).min(st.size - st.offset);
            n = read_at(&mut f, &mut buf, len);
            nl = buf[..n].iter().rposition(|&c| c == b'\n');
        }
        let Some(nl) = nl else {
            if st.offset + n as u64 >= st.size {
                break; // the last line is still being written
            }
            st.skipping = true;
            st.offset += n as u64;
            used += n as u64;
            continue;
        };
        let mut start = 0;
        if st.skipping {
            start = buf.iter().position(|&c| c == b'\n').map_or(0, |i| i + 1);
            st.skipping = false;
        }
        let text = String::from_utf8_lossy(&buf[start..nl]);
        for line in text.split('\n') {
            let Some((id, call, cwd, model)) = parse_line(line) else { continue };
            st.keep(id, call);
            if cwd.is_some() {
                st.cwd = cwd;
            }
            if model.is_some() {
                st.model = model;
            }
        }
        st.offset += nl as u64 + 1;
        used += nl as u64 + 1;
    }
    used
}

// ---------- folders and files ----------

/// usage.ts `projectDirName`: every non-alphanumeric ASCII char (and any non-ASCII) becomes `-`.
pub fn project_dir_name(p: &str) -> String {
    p.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// Claude Code project folders of `roots` and their worktrees (usage.ts `transcriptDirs`).
pub fn transcript_dirs(roots: &[String], projects: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(projects) else { return Vec::new() };
    let mut exact = HashSet::new();
    let mut prefixes = Vec::new();
    for root in roots {
        let enc = project_dir_name(root);
        prefixes.push(format!("{enc}--").to_lowercase());
        exact.insert(enc.to_lowercase());
        let wt = Path::new(root).join(".git").join("worktrees");
        for w in std::fs::read_dir(&wt).into_iter().flatten().flatten() {
            let Ok(gd) = std::fs::read_to_string(w.path().join("gitdir")) else { continue };
            let gd = gd.trim();
            if gd.is_empty() {
                continue;
            }
            let abs = std::path::absolute(gd).unwrap_or_else(|_| PathBuf::from(gd));
            if let Some(parent) = abs.parent() {
                exact.insert(project_dir_name(&parent.to_string_lossy()).to_lowercase());
            }
        }
    }
    let mut out: Vec<PathBuf> = rd
        .flatten()
        .filter(|e| {
            let l = e.file_name().to_string_lossy().to_lowercase();
            exact.contains(&l) || prefixes.iter().any(|p| l.starts_with(p.as_str()))
        })
        .map(|e| e.path())
        .collect();
    out.sort();
    out
}

fn is_session_id(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, &c)| if matches!(i, 8 | 13 | 18 | 23) { c == b'-' } else { c.is_ascii_hexdigit() })
}

struct Found {
    path: PathBuf,
    sid: String,
    size: u64,
    mtime: f64,
}

fn mtime_ms(m: &std::fs::Metadata) -> f64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// `<dir>/<sid>.jsonl` and `<dir>/<sid>/subagents/*.jsonl`, touched at or after `since`.
fn transcript_files(dir: &Path, since: i64, out: &mut Vec<Found>) {
    let mut add = |path: PathBuf, sid: &str| {
        if let Ok(m) = std::fs::metadata(&path) {
            let mtime = mtime_ms(&m);
            if m.is_file() && mtime >= since as f64 {
                out.push(Found { path, sid: sid.to_string(), size: m.len(), mtime });
            }
        }
    };
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if let Some(sid) = n.strip_suffix(".jsonl") {
            if is_session_id(sid) {
                add(e.path(), sid);
            }
        } else if is_session_id(&n) {
            for s in std::fs::read_dir(e.path().join("subagents")).into_iter().flatten().flatten() {
                if s.file_name().to_string_lossy().ends_with(".jsonl") {
                    add(s.path(), &n);
                }
            }
        }
    }
}

// ---------- totals ----------

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Tokens {
    pub input: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub output: u64,
    pub calls: u64,
    pub median_ctx: Option<u64>,
}

impl Tokens {
    fn json(&self) -> Value {
        json!({ "input": self.input, "cache_read": self.cache_read, "cache_write": self.cache_write, "output": self.output, "calls": self.calls, "median_ctx": self.median_ctx })
    }
}

/// Median; an even count averages the middle two rounded half up (`Math.round`).
pub fn median(xs: &mut [u64]) -> Option<u64> {
    if xs.is_empty() {
        return None;
    }
    xs.sort_unstable();
    let m = xs.len() / 2;
    Some(if xs.len() % 2 == 1 { xs[m] } else { (xs[m - 1] + xs[m]).div_ceil(2) })
}

pub fn sum_calls<'a>(calls: impl Iterator<Item = &'a Call>, from: i64) -> Tokens {
    let mut t = Tokens::default();
    let mut ctx = Vec::new();
    for c in calls.filter(|c| c.ts >= from) {
        t.input += c.input;
        t.cache_read += c.cache_read;
        t.cache_write += c.cache_write;
        t.output += c.output;
        t.calls += 1;
        ctx.push(c.input + c.cache_read + c.cache_write);
    }
    t.median_ctx = median(&mut ctx);
    t
}

// ---------- the warm scanner ----------

#[derive(Default)]
pub struct Scanner {
    files: HashMap<PathBuf, FileState>,
}

pub struct Scan {
    pub sessions: Vec<Value>,
    pub totals: (Tokens, Tokens),
    pub files: usize,
    pub read_bytes: u64,
    pub pending_bytes: u64,
}

impl Scanner {
    /// Bring the per-file cache up to date for `dirs` (freshest files first, ≤ `budget` bytes),
    /// drop calls older than `keep_from`, and forget files out of scope (usage.ts `scanTranscripts`).
    /// Returns the files in scope, newest first.
    fn update(&mut self, dirs: &[PathBuf], keep_from: i64, budget: u64) -> (Vec<PathBuf>, u64, u64) {
        let mut found = Vec::new();
        for d in dirs {
            transcript_files(d, keep_from, &mut found);
        }
        found.sort_by(|a, b| b.mtime.total_cmp(&a.mtime));
        found.truncate(MAX_FILES);
        let (mut read, mut pending) = (0u64, 0u64);
        for f in &found {
            if self.files.get(&f.path).is_none_or(|st| f.size < st.offset) {
                // New file, or rewritten shorter: start over (from the first line on or after keep_from).
                let mut st = FileState { size: f.size, mtime: f.mtime, session_id: f.sid.clone(), ..FileState::default() };
                if f.size > SEEK_MIN {
                    if let Ok(mut h) = File::open(&f.path) {
                        st.offset = seek_since(&mut h, f.size, keep_from);
                    }
                }
                self.files.insert(f.path.clone(), st);
            }
            let Some(st) = self.files.get_mut(&f.path) else { continue };
            st.size = f.size;
            st.mtime = f.mtime;
            if st.offset < st.size && read < budget {
                read += read_new(&f.path, st, budget - read);
            }
            pending += st.size.saturating_sub(st.offset);
            st.prune(keep_from);
        }
        let keep: HashSet<&PathBuf> = found.iter().map(|f| &f.path).collect();
        self.files.retain(|p, _| keep.contains(p));
        (found.into_iter().map(|f| f.path).collect(), read, pending)
    }

    /// One `/v1/usage` answer: per-session sums (usage.ts `rowsFrom` order, before node's sort),
    /// overall totals (`sumAll`) and scan counters.
    pub fn report(&mut self, roots: &[String], projects: &Path, keep_from: i64, day: i64, window: i64, budget: u64) -> Scan {
        let dirs = transcript_dirs(roots, projects);
        let (paths, read_bytes, pending_bytes) = self.update(&dirs, keep_from, budget);
        let states: Vec<&FileState> = paths.iter().filter_map(|p| self.files.get(p)).collect();
        // Per session: oldest file first, a message id counts only in the first file it appears in.
        let mut by_mtime = states.clone();
        by_mtime.sort_by(|a, b| a.mtime.total_cmp(&b.mtime));
        let mut seen: HashSet<&str> = HashSet::new();
        let mut order: Vec<&str> = Vec::new();
        let mut by: HashMap<&str, (Vec<Call>, Option<&str>, Option<&str>)> = HashMap::new();
        for st in by_mtime {
            let r = by.entry(st.session_id.as_str()).or_insert_with(|| {
                order.push(st.session_id.as_str());
                (Vec::new(), None, None)
            });
            for (id, c) in &st.calls {
                if seen.insert(id.as_str()) {
                    r.0.push(*c);
                }
            }
            r.1 = st.cwd.as_deref().or(r.1);
            r.2 = st.model.as_deref().or(r.2);
        }
        let sessions = order
            .iter()
            .filter_map(|sid| {
                let (calls, cwd, model) = &by[sid];
                let today = sum_calls(calls.iter(), day);
                let win = sum_calls(calls.iter(), window);
                if today.calls == 0 && win.calls == 0 {
                    return None;
                }
                let last_at = calls.iter().map(|c| c.ts).max();
                Some(json!({ "session_id": sid, "cwd": cwd, "model": model, "today": today.json(), "window": win.json(), "last_at": last_at }))
            })
            .collect();
        // sumAll: every deduped call, the newest file's copy first.
        let mut all: HashMap<&str, Call> = HashMap::new();
        for st in &states {
            for (id, c) in &st.calls {
                all.entry(id.as_str()).or_insert(*c);
            }
        }
        let totals = (sum_calls(all.values(), day), sum_calls(all.values(), window));
        Scan { sessions, totals, files: states.len(), read_bytes, pending_bytes }
    }
}

pub fn scan_json(s: &Scan) -> Value {
    json!({
        "sessions": s.sessions,
        "totals": { "today": s.totals.0.json(), "window": s.totals.1.json() },
        "scan": { "files": s.files, "read_bytes": s.read_bytes, "pending_bytes": s.pending_bytes },
    })
}

/// `/v1/usage` request body.
#[derive(Deserialize)]
pub struct Ask {
    pub roots: Vec<String>,
    pub keep_from: i64,
    pub day_start: i64,
    pub window_start: i64,
    pub budget: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SID: &str = "1eb79553-8369-4a90-b428-2dedb50e18db";
    const SID2: &str = "9c4e39c6-43ee-4657-83ee-4baed6708855";
    const NOW: i64 = 1_792_422_000_000; // 2026-10-19T15:00:00Z (Date.UTC(2026, 9, 19, 15))

    fn iso(ms: i64) -> String {
        // inverse of parse_iso_ms for test fixtures
        let (secs, milli) = (ms.div_euclid(1000), ms.rem_euclid(1000));
        let days = secs.div_euclid(86_400);
        let sod = secs.rem_euclid(86_400);
        let z = days + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = doy - (153 * mp + 2) / 5 + 1;
        let m = if mp < 10 { mp + 3 } else { mp - 9 };
        let y = yoe + era * 400 + i64::from(m <= 2);
        format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{milli:03}Z", sod / 3600, sod % 3600 / 60, sod % 60)
    }

    fn line(id: &str, ts: i64, u: [u64; 4], pad: usize) -> String {
        let v = json!({
            "type": "assistant", "timestamp": iso(ts), "cwd": "/w/shop", "sessionId": SID, "pad": "x".repeat(pad),
            "message": { "id": id, "model": "claude-opus-5-5", "role": "assistant", "content": [{ "type": "text", "text": "ok" }],
                "usage": { "input_tokens": u[0], "cache_read_input_tokens": u[1], "cache_creation_input_tokens": u[2], "output_tokens": u[3] } }
        });
        format!("{v}\n")
    }

    struct Fx {
        dir: PathBuf,
        projects: PathBuf,
        root: String,
    }

    fn fx(tag: &str) -> Fx {
        let dir = std::env::temp_dir().join(format!("hq-core-usage-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("work").join("shop").to_string_lossy().into_owned();
        std::fs::create_dir_all(&root).unwrap();
        let projects = dir.join("projects");
        std::fs::create_dir_all(projects.join(project_dir_name(&root))).unwrap();
        Fx { dir, projects, root }
    }

    impl Fx {
        fn file(&self, sid: &str) -> PathBuf {
            self.projects.join(project_dir_name(&self.root)).join(format!("{sid}.jsonl"))
        }
        fn run(&self, s: &mut Scanner, budget: u64) -> Scan {
            s.report(std::slice::from_ref(&self.root), &self.projects, 0, 0, NOW - 5 * 3_600_000, budget)
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn append(p: &Path, s: &str) {
        use std::io::Write;
        std::fs::OpenOptions::new().create(true).append(true).open(p).unwrap().write_all(s.as_bytes()).unwrap();
    }

    #[test]
    fn parses_iso_timestamps_like_date_parse() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-10-19T15:00:00.000Z"), Some(NOW));
        assert_eq!(parse_iso_ms("2026-10-19T15:00:00Z"), Some(NOW));
        assert_eq!(parse_iso_ms("2026-10-19T22:00:00.5+07:00"), Some(NOW + 500));
        assert_eq!(parse_iso_ms("2026-10-19T15:00:00.123456Z"), Some(NOW + 123));
        assert_eq!(parse_iso_ms("2026-10-19"), None);
        assert_eq!(parse_iso_ms("2026-13-19T15:00:00Z"), None);
        assert_eq!(iso(NOW), "2026-10-19T15:00:00.000Z");
    }

    #[test]
    fn parse_line_keeps_only_assistant_usage_and_falls_back_to_request_id() {
        let (id, c, cwd, model) = parse_line(line("msg_a", NOW, [3, 1000, 200, 10], 0).trim()).unwrap();
        assert_eq!((id.as_str(), c.input, c.cache_read, c.cache_write, c.output, c.ts), ("msg_a", 3, 1000, 200, 10, NOW));
        assert_eq!((cwd.as_deref(), model.as_deref()), (Some("/w/shop"), Some("claude-opus-5-5")));
        assert!(parse_line(line("msg_s", NOW, [0, 0, 0, 0], 0).trim()).is_none(), "synthetic");
        assert!(parse_line(r#"{"type":"user","message":{"content":"usage assistant"}}"#).is_none());
        let r = r#"{"type":"assistant","timestamp":"2026-10-19T15:00:00Z","requestId":"req_1","cwd":7,"message":{"model":"<synthetic>","usage":{"output_tokens":2}}}"#;
        let (id, _, cwd, model) = parse_line(r).unwrap();
        assert_eq!((id.as_str(), cwd, model), ("req_1", None, None));
    }

    #[test]
    fn dedupes_content_block_lines_by_message_id() {
        let f = fx("dedupe");
        std::fs::write(
            f.file(SID),
            line("msg_a", NOW - 60_000, [3, 1000, 200, 10], 0)
                + &line("msg_a", NOW - 59_000, [3, 1000, 200, 40], 0)
                + &line("msg_b", NOW - 30_000, [5, 2000, 0, 7], 0)
                + "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"usage assistant\"}}\n"
                + &line("msg_syn", NOW - 10_000, [0, 0, 0, 0], 0),
        )
        .unwrap();
        let s = f.run(&mut Scanner::default(), BYTES_PER_REQUEST);
        assert_eq!(s.totals.0, Tokens { input: 8, cache_read: 3000, cache_write: 200, output: 47, calls: 2, median_ctx: Some((1203 + 2005 + 1) / 2) });
        assert_eq!(s.sessions.len(), 1);
        assert_eq!(s.sessions[0]["last_at"], json!(NOW - 30_000));
        assert_eq!(s.sessions[0]["today"]["calls"], json!(2));
    }

    #[test]
    fn reads_only_appended_lines_and_waits_for_a_line_to_finish() {
        let f = fx("append");
        let p = f.file(SID);
        std::fs::write(&p, line("msg_1", NOW - 60_000, [1, 0, 0, 1], 0)).unwrap();
        let mut sc = Scanner::default();
        assert_eq!(f.run(&mut sc, BYTES_PER_REQUEST).read_bytes, std::fs::metadata(&p).unwrap().len());
        assert_eq!(f.run(&mut sc, BYTES_PER_REQUEST).read_bytes, 0);
        let next = line("msg_2", NOW - 30_000, [2, 0, 0, 2], 0);
        append(&p, &(next.clone() + &next[..20]));
        let third = f.run(&mut sc, BYTES_PER_REQUEST);
        assert_eq!(third.read_bytes, next.len() as u64);
        assert_eq!(third.pending_bytes, 20);
        assert_eq!(third.totals.1.calls, 2);
        append(&p, &next[20..]);
        let fourth = f.run(&mut sc, BYTES_PER_REQUEST);
        assert_eq!(fourth.pending_bytes, 0);
        assert_eq!(fourth.totals.1.calls, 2, "same id: deduped");
    }

    #[test]
    fn bounds_bytes_per_call_and_continues() {
        let f = fx("budget");
        let body: String = (0..50).map(|i| line(&format!("msg_{i}"), NOW - 60_000 + i, [1, 0, 0, 1], 0)).collect();
        std::fs::write(f.file(SID), body).unwrap();
        let mut sc = Scanner::default();
        let a = f.run(&mut sc, 2000);
        assert!(a.read_bytes <= 2000 && a.pending_bytes > 0);
        let mut n = 0;
        while f.run(&mut sc, 2000).pending_bytes > 0 && n < 100 {
            n += 1;
        }
        assert_eq!(f.run(&mut sc, 2000).totals.1.calls, 50);
    }

    #[test]
    fn skips_old_history_in_a_long_transcript() {
        let f = fx("seek");
        let mut body = String::new();
        let mut i = 0;
        while body.len() < 6 * 1024 * 1024 {
            body += &line(&format!("msg_old{i}"), NOW - 3 * 86_400_000, [1, 0, 0, 1], 4000);
            i += 1;
        }
        body += &line("msg_new", NOW - 60_000, [9, 0, 0, 9], 0);
        std::fs::write(f.file(SID), body).unwrap();
        let s = Scanner::default().report(std::slice::from_ref(&f.root), &f.projects, NOW - 86_400_000, 0, 0, BYTES_PER_REQUEST);
        assert!(s.read_bytes < 2 * 1024 * 1024, "read {}", s.read_bytes);
        assert_eq!((s.totals.0.calls, s.totals.0.input), (1, 9));
    }

    #[test]
    fn finds_the_project_folder_and_its_worktrees_not_a_sibling() {
        let f = fx("dirs");
        let wt = Path::new(&f.root).join(".claude").join("worktrees").join("card-1");
        for d in [wt.to_string_lossy().into_owned(), format!("{}-web", f.root)] {
            std::fs::create_dir_all(f.projects.join(project_dir_name(&d))).unwrap();
        }
        let mut got: Vec<String> = transcript_dirs(std::slice::from_ref(&f.root), &f.projects).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        got.sort();
        let mut want = vec![project_dir_name(&f.root), project_dir_name(&wt.to_string_lossy())];
        want.sort();
        assert_eq!(got, want);
    }

    #[test]
    fn subagents_join_their_session_and_a_forked_copy_counts_once() {
        let f = fx("fork");
        let main = f.file(SID);
        std::fs::write(&main, line("msg_1", NOW - 60_000, [1, 0, 0, 1], 0)).unwrap();
        let sub = f.projects.join(project_dir_name(&f.root)).join(SID).join("subagents");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("agent-x.jsonl"), line("msg_sub", NOW - 50_000, [2, 0, 0, 2], 0)).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        // a forked session copies msg_1 and adds its own call, written later
        std::fs::write(f.file(SID2), line("msg_1", NOW - 60_000, [1, 0, 0, 1], 0) + &line("msg_2", NOW - 10_000, [5, 0, 0, 5], 0)).unwrap();
        let s = f.run(&mut Scanner::default(), BYTES_PER_REQUEST);
        let by: HashMap<String, u64> = s.sessions.iter().map(|r| (r["session_id"].as_str().unwrap().to_string(), r["today"]["calls"].as_u64().unwrap())).collect();
        assert_eq!(by[SID], 2, "main + subagent");
        assert_eq!(by[SID2], 1, "the copied call counts in the older file only");
        assert_eq!(s.totals.0.calls, 3);
        assert_eq!(s.files, 3);
    }

    #[test]
    fn forgets_files_out_of_scope_and_prunes_old_calls() {
        let f = fx("prune");
        std::fs::write(f.file(SID), line("msg_old", NOW - 7 * 3_600_000, [1, 0, 0, 1], 0) + &line("msg_new", NOW - 60_000, [1, 0, 0, 1], 0)).unwrap();
        let mut sc = Scanner::default();
        let s = sc.report(std::slice::from_ref(&f.root), &f.projects, 0, 0, 0, BYTES_PER_REQUEST);
        assert_eq!(s.totals.0.calls, 2);
        let s = sc.report(std::slice::from_ref(&f.root), &f.projects, NOW - 5 * 3_600_000, 0, 0, BYTES_PER_REQUEST);
        assert_eq!(s.totals.0.calls, 1, "the call before keep_from is dropped");
        let s = sc.report(&[], &f.projects, 0, 0, 0, BYTES_PER_REQUEST);
        assert_eq!(s.files, 0);
        assert!(sc.files.is_empty(), "no root: nothing kept");
    }

    #[test]
    fn median_rounds_half_up() {
        assert_eq!(median(&mut []), None);
        assert_eq!(median(&mut [3, 1, 2]), Some(2));
        assert_eq!(median(&mut [1, 2]), Some(2));
        assert_eq!(median(&mut [2, 2]), Some(2));
    }
}
