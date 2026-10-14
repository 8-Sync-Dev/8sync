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
/// argument. `cmdlines` are raw `/proc/<pid>/cmdline` buffers (NUL-separated).
/// The process must itself look like omp/claude so an editor or `grep <id>`
/// doesn't count.
pub fn proc_matches(cmdlines: &[Vec<u8>], needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    cmdlines.iter().any(|raw| {
        let args: Vec<&[u8]> = raw.split(|b| *b == 0).filter(|a| !a.is_empty()).collect();
        let is_agent = args.iter().take(3).any(|a| {
            let base = a.rsplit(|b| *b == b'/').next().unwrap_or(a);
            let base = String::from_utf8_lossy(base).to_ascii_lowercase();
            base == "omp" || base == "claude" || base.starts_with("claude") || base == "omp.js"
        });
        is_agent && args.iter().skip(1).any(|a| *a == needle.as_bytes())
    })
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

/// Cmdlines of live omp/claude processes (Linux `/proc`; empty elsewhere).
pub fn agent_cmdlines() -> Vec<Vec<u8>> {
    #[cfg(target_os = "linux")]
    {
        let mut out = Vec::new();
        for e in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
            let name = e.file_name();
            if !name.to_string_lossy().bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            if let Ok(raw) = std::fs::read(e.path().join("cmdline")) {
                let head = String::from_utf8_lossy(&raw[..raw.len().min(512)]).to_ascii_lowercase();
                if head.contains("omp") || head.contains("claude") {
                    out.push(raw);
                }
            }
        }
        out
    }
    #[cfg(not(target_os = "linux"))]
    {
        Vec::new()
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
    let mut d = Digest::default();
    let mut buf: Vec<u8> = Vec::new();
    let mut last_asst: Vec<u8> = Vec::new();
    let mut last_text: Vec<u8> = Vec::new();
    let mut last_tool: Vec<u8> = Vec::new();
    let mut tool_ring: VecDeque<Vec<u8>> = VecDeque::new();
    let mut next_id = 1usize;
    let mut change_title: Option<String> = None;
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(line) = std::str::from_utf8(&buf) else { continue };
        let head = &line[..floor_boundary(line, 400)];
        match fmt {
            Fmt::Omp => {
                if head.starts_with(r#"{"type":"title""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        d.title = title_of(&v);
                    }
                } else if head.starts_with(r#"{"type":"title_change""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        change_title = v.get("title").and_then(|t| t.as_str()).map(str::to_string);
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
                            push_user(&mut d, t);
                        }
                    }
                } else if head.contains(r#""role":"toolResult""#) && head.contains(r#""toolName":"todo""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if let Some(t) = omp_tasks(&v) {
                            d.tasks = t;
                        }
                    }
                } else if head.contains(r#""role":"assistant""#) {
                    keep_assistant(line, &buf, r#""type":"toolCall""#, &mut last_asst, &mut last_text, &mut last_tool);
                    if detail && line.contains(r#""type":"toolCall""#) {
                        push_ring(&mut tool_ring, &buf);
                    }
                }
            }
            Fmt::Claude => {
                if line.contains(r#""isSidechain":true"#) {
                    continue;
                }
                if head.starts_with(r#"{"type":"custom-title""#) {
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        d.title = v.get("customTitle").and_then(|c| c.as_str()).map(str::to_string);
                    }
                } else if head.starts_with(r#"{"type":"agent-name""#) {
                    if d.title.is_none() {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            change_title = v.get("agentName").and_then(|c| c.as_str()).map(str::to_string);
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
                            push_user(&mut d, t);
                        }
                    }
                } else if line.contains(r#""type":"assistant""#) {
                    keep_assistant(line, &buf, r#""type":"tool_use""#, &mut last_asst, &mut last_text, &mut last_tool);
                    let has_task = line.contains(r#""name":"TaskCreate""#)
                        || line.contains(r#""name":"TaskUpdate""#)
                        || line.contains(r#""name":"TodoWrite""#);
                    if has_task {
                        if let Ok(v) = serde_json::from_str::<Value>(line) {
                            apply_claude_tasks(&v, &mut d.tasks, &mut next_id);
                        }
                    }
                    if detail && line.contains(r#""type":"tool_use""#) {
                        push_ring(&mut tool_ring, &buf);
                    }
                }
            }
        }
    }
    if d.title.is_none() {
        d.title = change_title;
    }
    // Latest assistant line → model + context size.
    if let Ok(v) = serde_json::from_slice::<Value>(&last_asst) {
        let m = v.get("message").unwrap_or(&v);
        if let Some(model) = m.get("model").and_then(|x| x.as_str()) {
            d.model = Some(model.to_string());
        }
        d.tokens = usage_tokens(m.get("usage"));
    }
    if let Ok(v) = serde_json::from_slice::<Value>(&last_text) {
        d.last_text = blocks(&v).iter().rev().find_map(text_block).map(|t| mask_secrets(&t));
    }
    if let Ok(v) = serde_json::from_slice::<Value>(&last_tool) {
        if let Some((n, a)) = blocks(&v).iter().rev().find_map(tool_block) {
            d.last_tool = Some(tool_summary(&n, &a));
            d.last_tool_name = Some(n);
        }
    }
    if detail {
        let mut seen = std::collections::HashSet::new();
        for raw in tool_ring.iter().rev() {
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

/// API error type recorded by the kit's StopFailure hook for a Claude session
/// (`<dir>/<session_id>.json`, written by `ccc/resume.rs`). Read-only; records older
/// than 24 h are ignored.
fn stalled_error_in(dir: &Path, row: &Row, now_s: u64) -> Option<String> {
    if row.engine != "claude" {
        return None;
    }
    let id = safe_id(row.transcript.as_deref()?.file_stem()?.to_str()?)?;
    let rec: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(format!("{id}.json"))).ok()?).ok()?;
    if now_s.saturating_sub(rec["ts"].as_u64()?) > 24 * 3600 {
        return None;
    }
    rec["error"].as_str().map(str::to_string)
}

fn stalled_error(row: &Row) -> Option<String> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
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
        "stalled_error": stalled_error(row),
        "current_task": d.current_task().map(|t| clean(&t.title, 200)),
        "tasks_done": d.tasks_done(),
        "tasks_total": d.tasks.len(),
        "messages": d.user_msgs,
        "tokens": d.tokens,
        "model": d.model,
        "resume": mask_secrets(&row.resume),
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
        assert_eq!(stalled_error_in(&dir, &r, 2000).as_deref(), Some("rate_limit"));
        assert_eq!(stalled_error_in(&dir, &r, 1000 + 24 * 3600 + 1), None, "old");
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

