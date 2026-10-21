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

pub use ccc_core::transcript::*;
use serde_json::Value;

/// Transcript digests kept warm by a long-running process (the HQ core, `hq_core`). An unchanged
/// file (length + mtime + `detail`) is served as is; a whole-scanned file (≤ [`FULL_SCAN_CAP`])
/// that grew is fed only its appended lines, so a busy room costs what it wrote since the last
/// poll, not its whole transcript. Off unless [`enable_digest_cache`] ran; a one-shot `8sync ls`
/// reads every file as before.
struct DigestCache {
    tick: u64,
    map: std::collections::HashMap<std::path::PathBuf, Cached>,
}

struct Cached {
    len: u64,
    mtime: u128,
    detail: bool,
    used: u64,
    digest: Digest,
    /// Whole-file scans only: where the next line starts, the scanner state, and the file's first
    /// bytes (a file rewritten rather than appended to starts over).
    resume: Option<(u64, LineScanner, Vec<u8>)>,
}

static DIGESTS: std::sync::OnceLock<std::sync::Mutex<DigestCache>> = std::sync::OnceLock::new();
/// Transcripts remembered at most; the least recently used is dropped first.
const DIGEST_CAP: usize = 256;
const HEAD_BYTES: usize = 256;

/// Session id → its transcript path, enabled with the digest cache: finding a Claude transcript
/// probes every `projects/*` folder, which is most of a warm `ls` rebuild.
static PATHS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, std::path::PathBuf>>> = std::sync::OnceLock::new();

pub fn enable_digest_cache() {
    DIGESTS.get_or_init(|| std::sync::Mutex::new(DigestCache { tick: 0, map: std::collections::HashMap::new() }));
    PATHS.get_or_init(Default::default);
}

/// [`claude_transcript`], remembered while the file is still there (a session's transcript never moves).
fn claude_transcript_cached(home: &std::path::Path, id: &str) -> Option<std::path::PathBuf> {
    let Some(paths) = PATHS.get() else { return claude_transcript(home, id) };
    let hit = paths.lock().unwrap_or_else(|p| p.into_inner()).get(id).cloned();
    if let Some(p) = hit.filter(|p| p.is_file()) {
        return Some(p);
    }
    let p = claude_transcript(home, id)?;
    let mut m = paths.lock().unwrap_or_else(|p| p.into_inner());
    if m.len() >= 4 * DIGEST_CAP {
        m.clear();
    }
    m.insert(id.to_string(), p.clone());
    Some(p)
}

/// [`scan_file`], served from [`DigestCache`] when enabled: unchanged → cached, appended → only
/// the new lines. The reading runs outside the lock (rows are built on parallel threads).
pub fn scan_cached(path: &std::path::Path, fmt: Fmt, detail: bool) -> Digest {
    let Some(cache) = DIGESTS.get() else { return scan_file(path, fmt, detail) };
    let Some((len, mtime)) = std::fs::metadata(path)
        .ok()
        .map(|m| (m.len(), m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos())))
    else {
        return scan_file(path, fmt, detail);
    };
    let resume = {
        let mut c = cache.lock().unwrap_or_else(|p| p.into_inner());
        c.tick += 1;
        let tick = c.tick;
        match c.map.get_mut(path) {
            Some(e) if e.len == len && e.mtime == mtime && e.detail == detail => {
                e.used = tick;
                return e.digest.clone();
            }
            Some(e) if e.detail == detail && len >= e.len => e.resume.take(),
            _ => None,
        }
    };
    let (digest, resume) = if len <= FULL_SCAN_CAP { scan_whole(path, fmt, detail, resume) } else { (scan_file(path, fmt, detail), None) };
    let mut c = cache.lock().unwrap_or_else(|p| p.into_inner());
    if c.map.len() >= DIGEST_CAP && !c.map.contains_key(path) {
        if let Some(old) = c.map.iter().min_by_key(|(_, e)| e.used).map(|(k, _)| k.clone()) {
            c.map.remove(&old);
        }
    }
    let used = c.tick;
    c.map.insert(path.to_path_buf(), Cached { len, mtime, detail, used, digest: digest.clone(), resume });
    digest
}

/// A whole-file scan (what [`scan_file`] does up to [`FULL_SCAN_CAP`]), resumed from `resume`
/// when the file still starts with the same bytes. A last line without its `\n` (still being
/// written) is fed to a copy only, so it is read again once complete.
fn scan_whole(path: &std::path::Path, fmt: Fmt, detail: bool, resume: Option<(u64, LineScanner, Vec<u8>)>) -> (Digest, Option<(u64, LineScanner, Vec<u8>)>) {
    use std::io::{BufRead, Read, Seek};
    let Ok(mut f) = std::fs::File::open(path) else { return (Digest::default(), None) };
    let mut head = vec![0u8; HEAD_BYTES];
    let n = f.read(&mut head).unwrap_or(0);
    head.truncate(n);
    let (mut at, mut s) = match resume {
        Some((at, s, h)) if head.starts_with(&h) => (at, s),
        _ => (0, LineScanner::new(fmt, detail)),
    };
    if f.seek(std::io::SeekFrom::Start(at)).is_err() {
        return (scan_file(path, fmt, detail), None);
    }
    let mut r = std::io::BufReader::with_capacity(64 * 1024, f);
    let mut buf = Vec::new();
    let mut tail = Vec::new();
    loop {
        buf.clear();
        match r.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) if buf.last() == Some(&b'\n') => {
                s.feed(&buf);
                at += n as u64;
            }
            Ok(_) => {
                tail = std::mem::take(&mut buf);
                break;
            }
        }
    }
    let digest = if tail.is_empty() {
        s.clone().finish()
    } else {
        let mut copy = s.clone();
        copy.feed(&tail);
        copy.finish()
    };
    // The head as it was when line `at` was reached: a shorter file keeps fewer bytes to compare.
    head.truncate(head.len().min(at as usize));
    (digest, Some((at, s, head)))
}

/// Terminal width: `$COLUMNS` when set and sane, else 100.
pub fn term_width() -> usize {
    std::env::var("COLUMNS").ok().and_then(|c| c.parse::<usize>().ok()).filter(|w| *w >= 40).unwrap_or(100).min(240)
}

fn fmt_tokens(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1e6)
    } else if n >= 1000 {
        format!("{}k", n / 1000)
    } else {
        n.to_string()
    }
}

// ── rendering ───────────────────────────────────────────────────────────────

struct Paint(bool);

impl Paint {
    fn bold(&self, s: &str) -> String {
        use owo_colors::OwoColorize;
        if self.0 { s.bold().to_string() } else { s.to_string() }
    }
    fn dim(&self, s: &str) -> String {
        use owo_colors::OwoColorize;
        if self.0 { s.dimmed().to_string() } else { s.to_string() }
    }
    fn green(&self, s: &str) -> String {
        use owo_colors::OwoColorize;
        if self.0 { s.green().to_string() } else { s.to_string() }
    }
    fn yellow(&self, s: &str) -> String {
        use owo_colors::OwoColorize;
        if self.0 { s.yellow().to_string() } else { s.to_string() }
    }
}

pub fn use_color() -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

const INDENT: &str = "      ";

/// Lines for one session, each at most `width` chars (colour codes excluded).
pub fn render(row: &Row, width: usize, now: u64, color: bool) -> Vec<String> {
    let p = Paint(color);
    let mut out = Vec::new();

    // line 1 — ★ name  badge  ago  [branch *]
    let star = if row.is_last { "★" } else { " " };
    let badge_plain = match row.status {
        Status::Running => "● running",
        Status::Active => "● active",
        Status::Idle => "○ idle",
    };
    let badge = match row.status {
        Status::Running => p.green(badge_plain),
        Status::Active => p.yellow(badge_plain),
        Status::Idle => p.dim(badge_plain),
    };
    let when = ago(row.last_active, now);
    let tail = match &row.branch {
        Some(b) => format!("  {b}{}", if row.dirty { " *dirty" } else { "" }),
        None => String::new(),
    };
    let fixed = 2 + badge_plain.chars().count() + 2 + when.chars().count() + tail.chars().count() + 2;
    let name = truncate(&row.name, width.saturating_sub(fixed + 2).clamp(8, 40));
    let tail_s = if tail.is_empty() { String::new() } else { p.dim(&tail) };
    out.push(format!("{star} {}  {badge}  {}{tail_s}", p.bold(&name), p.dim(&when)));

    let d = &row.digest;
    let room = width.saturating_sub(INDENT.chars().count() + 5).max(10);
    // line 2 — what was asked, what happened last
    match d.last_user() {
        Some(u) => out.push(format!("{INDENT}{} {}", p.dim("ask"), truncate(&clean(u, 400), room.min(70)))),
        None => out.push(format!("{INDENT}{}", p.dim("(no messages yet)"))),
    }
    if let Some(a) = d.last_activity() {
        out.push(format!("{INDENT}{} {}", p.dim("now"), truncate(&clean(&a, 400), room)));
    }
    if !d.tasks.is_empty() {
        let head = format!("{}/{} tasks", d.tasks_done(), d.tasks.len());
        let cur = d.current_task().map(|t| format!(" ▸ {}", clean(&t.title, 300))).unwrap_or_default();
        let line = truncate(&format!("{head}{cur}"), room);
        out.push(format!("{INDENT}{} {}", p.dim("todo"), line));
    }
    // line 3 — meta
    let mut meta: Vec<String> = Vec::new();
    if d.user_msgs > 0 {
        meta.push(format!("{}{} msgs", d.user_msgs, if d.partial { "+" } else { "" }));
    }
    if let Some(t) = d.tokens {
        meta.push(format!("{} ctx", fmt_tokens(t)));
    }
    if let Some(m) = &d.model {
        meta.push(m.rsplit('/').next().unwrap_or(m).to_string());
    }
    if let Some(t) = &d.title {
        meta.push(format!("“{}”", clean(t, 50)));
    }
    if !meta.is_empty() {
        out.push(format!("{INDENT}{}", p.dim(&truncate(&meta.join(" · "), width.saturating_sub(INDENT.len()).max(10)))));
    }
    out
}

/// One compact line (for `ls --all`).
pub fn render_compact(row: &Row, width: usize, now: u64, color: bool) -> String {
    let p = Paint(color);
    let star = if row.is_last { "★" } else { " " };
    let dot = match row.status {
        Status::Running => p.green("●"),
        Status::Active => p.yellow("●"),
        Status::Idle => p.dim("○"),
    };
    let when = ago(row.last_active, now);
    let name = truncate(&row.name, 18);
    let used = 4 + 18 + 2 + 9 + 2 + 2;
    let ask = row
        .digest
        .current_task()
        .map(|t| t.title.clone())
        .or_else(|| row.digest.last_user().map(str::to_string))
        .or_else(|| row.digest.title.clone())
        .unwrap_or_else(|| "(no messages yet)".into());
    let ask = truncate(&clean(&ask, 300), width.saturating_sub(used).max(10));
    let pad = " ".repeat(18usize.saturating_sub(name.chars().count()));
    format!("  {star} {dot} {}{pad}  {:<9}  {}", p.bold(&name), when, p.dim(&ask))
}

// ── collecting rows ─────────────────────────────────────────────────────────

use crate::env_detect::Env;


/// Run `f` over `items` on at most 8 scoped threads (transcript scans are I/O +
/// parse). Output has one entry per item, in order: an item whose `f` panics
/// gets `fallback(item)` instead of being dropped, so callers can zip the
/// result with the registry. (Release builds use `panic = "abort"`, so there a
/// panic still ends the process; this keeps tests and dev builds aligned.)
fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync, fallback: impl Fn(&T) -> R + Sync) -> Vec<R> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let next = AtomicUsize::new(0);
    let workers = items.len().min(8);
    let mut done: Vec<(usize, R)> = std::thread::scope(|s| {
        let hs: Vec<_> = (0..workers)
            .map(|_| {
                s.spawn(|| {
                    let mut got = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        let Some(it) = items.get(i) else { break };
                        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(it))).unwrap_or_else(|_| fallback(it));
                        got.push((i, r));
                    }
                    got
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    done.sort_by_key(|(i, _)| *i);
    done.into_iter().map(|(_, r)| r).collect()
}

/// omp sessions of one repo registry. `detail` keeps the extra tool-call ring
/// (files touched) that `8sync show` needs. `root`: the repo the registry belongs to (else the
/// root the registry recorded); it keys each room's inbox id ([`ccc_core::room_id`]).
pub fn omp_rows(reg: &crate::verbs::session::Registry, root: Option<&std::path::Path>, procs: &[Vec<u8>], detail: bool, git: bool) -> Vec<Row> {
    let now = now_secs();
    let root = root.or(reg.root.as_deref());
    let inbox = |name: &str| root.map(|r| ccc_core::room_id(r, name));
    par_map(&reg.sessions, |s| {
        let tr = omp_transcript(&s.session_dir);
        let digest = tr.as_deref().map(|p| scan_cached(p, Fmt::Omp, detail)).unwrap_or_default();
        let mt = tr.as_deref().and_then(mtime_secs);
        let hit = proc_matches(procs, &s.session_dir.to_string_lossy());
        Row {
            engine: "omp",
            name: s.name.clone(),
            is_last: reg.last_used.as_deref() == Some(s.name.as_str()),
            status: classify(hit, mt, now),
            last_active: s.last_active.max(mt.unwrap_or(0)),
            branch: s.worktree.as_ref().map(|w| w.branch.clone()),
            dirty: git && s.worktree.as_ref().is_some_and(|w| crate::verbs::session::is_dirty(&w.path)),
            digest,
            resume: format!("8sync . {}", s.name),
            transcript: tr,
            inbox_id: inbox(&s.name),
        }
    }, |s| Row { inbox_id: inbox(&s.name), ..unreadable("omp", &s.name, format!("8sync . {}", s.name), s.last_active) })
}

/// Claude Code / Forge sessions (name → UUID registry). Only Claude Code has a
/// transcript format we read; Forge shows registry data only.
pub fn uuid_rows(env: &Env, engine: &'static str, reg: &crate::verbs::uuid_sessions::Registry, procs: &[Vec<u8>], detail: bool) -> Vec<Row> {
    let now = now_secs();
    // A Claude Code room's inbox is its session id; Forge rooms have none.
    let inbox = |id: &str| (engine == "ccc").then(|| id.to_string());
    par_map(&reg.sessions, |s| {
        let tr = (engine == "ccc").then(|| claude_transcript_cached(&env.home, &s.conversation_id)).flatten();
        let digest = tr.as_deref().map(|p| scan_cached(p, Fmt::Claude, detail)).unwrap_or_default();
        let mt = tr.as_deref().and_then(mtime_secs);
        let hit = engine == "ccc" && proc_matches(procs, &s.conversation_id);
        Row {
            engine,
            name: s.name.clone(),
            is_last: reg.last_used.as_deref() == Some(s.name.as_str()),
            status: classify(hit, mt, now),
            last_active: s.last_active.max(mt.unwrap_or(0)),
            branch: None,
            dirty: false,
            digest,
            resume: if engine == "ccc" { format!("8sync ccc . {}", s.name) } else { format!("8sync forge {}", s.name) },
            transcript: tr,
            inbox_id: inbox(&s.conversation_id),
        }
    }, |s| Row {
        inbox_id: inbox(&s.conversation_id),
        ..unreadable(engine, &s.name, if engine == "ccc" { format!("8sync ccc . {}", s.name) } else { format!("8sync forge {}", s.name) }, s.last_active)
    })
}

/// Feynman sessions: registry only (Pi's own store has no format we parse).
pub fn feynman_rows(index: &Value) -> Vec<Row> {
    let last = index.get("last_used").and_then(|l| l.as_str());
    index
        .get("sessions")
        .and_then(|s| s.as_array())
        .into_iter()
        .flatten()
        .filter_map(|s| {
            let name = s.get("name")?.as_str()?.to_string();
            Some(Row {
                engine: "feynman",
                is_last: last == Some(name.as_str()),
                status: Status::Idle,
                last_active: s.get("last_active").and_then(|x| x.as_u64()).unwrap_or(0),
                branch: None,
                dirty: false,
                digest: Digest::default(),
                resume: format!("8sync feynman {name}"),
                name,
                transcript: None,
                inbox_id: None,
            })
        })
        .collect()
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
    fn cached_digest_follows_the_file_and_matches_a_fresh_scan() {
        enable_digest_cache();
        let p = std::env::temp_dir().join(format!("sv-digest-{}.jsonl", std::process::id()));
        let user = |t: &str| format!("{}\n", serde_json::json!({ "type": "user", "message": { "role": "user", "content": t } }));
        std::fs::write(&p, user("first ask")).unwrap();
        let a = scan_cached(&p, Fmt::Claude, false);
        assert_eq!(a.user_msgs, 1);
        assert_eq!(scan_cached(&p, Fmt::Claude, false).last_user(), Some("first ask"), "served warm");
        std::fs::write(&p, user("first ask") + &user("second ask")).unwrap();
        let b = scan_cached(&p, Fmt::Claude, false);
        assert_eq!((b.user_msgs, b.last_user()), (2, Some("second ask")), "a changed file is read again");
        let same = |p: &std::path::Path| assert_eq!(format!("{:?}", scan_cached(p, Fmt::Claude, false)), format!("{:?}", scan_file(p, Fmt::Claude, false)));
        same(&p);
        // an assistant line half written, then finished: only the new bytes are read, same digest
        let asst = format!("{}\n", serde_json::json!({ "type": "assistant", "message": { "model": "claude-x", "role": "assistant",
            "content": [{ "type": "text", "text": "done" }], "usage": { "input_tokens": 5, "cache_read_input_tokens": 100 } } }));
        let append = |s: &str| std::io::Write::write_all(&mut std::fs::OpenOptions::new().append(true).open(&p).unwrap(), s.as_bytes()).unwrap();
        append(&asst[..20]);
        same(&p);
        append(&asst[20..]);
        same(&p);
        assert_eq!(scan_cached(&p, Fmt::Claude, false).model.as_deref(), Some("claude-x"));
        append(&user("third ask"));
        same(&p);
        // rewritten (not appended) and longer: starts over
        std::fs::write(&p, user("other start") + &user("x".repeat(400).as_str()) + &asst).unwrap();
        same(&p);
        assert_eq!(scan_cached(&p, Fmt::Claude, false).last_users.first().map(String::as_str), Some("other start"));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn render_respects_width_and_non_ascii() {
        let d = Digest {
            last_users: vec!["Sửa lỗi đăng nhập khi mật khẩu có ký tự đặc biệt và kiểm tra lại toàn bộ luồng thanh toán".repeat(3)],
            last_tool: Some("edit: cập nhật handler đăng nhập ".repeat(8)),
            tasks: vec![
                Task { id: "1".into(), title: "xong".into(), state: TaskState::Done },
                Task { id: "2".into(), title: "đang làm một việc rất dài ".repeat(10), state: TaskState::InProgress },
            ],
            user_msgs: 12,
            tokens: Some(123_456),
            model: Some("google/glm-5".into()),
            title: Some("Tiêu đề".into()),
            ..Default::default()
        };
        for width in [40usize, 60, 100] {
            let lines = render(&row(d.clone()), width, 1024, false);
            assert!(lines.len() >= 4, "{lines:?}");
            for l in &lines {
                assert!(l.chars().count() <= width, "w={width}: {} chars: {l}", l.chars().count());
            }
        }
        let lines = render(&row(d), 100, 1024, false);
        assert!(lines[0].starts_with("★ core  ● running  24s ago"), "{}", lines[0]);
        assert!(lines.iter().any(|l| l.contains("1/2 tasks ▸ đang làm")));
        assert!(lines.last().unwrap().contains("12 msgs · 123k ctx · glm-5"));
    }

    #[test]
    fn branch_only_for_worktree_and_no_dash_column() {
        let mut r = row(Digest::default());
        let plain = render(&r, 100, 1000, false);
        assert!(!plain[0].contains(" - "), "{}", plain[0]);
        assert!(plain.iter().any(|l| l.contains("(no messages yet)")));
        r.branch = Some("8sync/core".into());
        r.dirty = true;
        assert!(render(&r, 100, 1000, false)[0].ends_with("8sync/core *dirty"));
    }

    #[test]
    fn par_map_keeps_every_item_in_order_even_on_panic() {
        let items: Vec<u32> = (0..40).collect();
        let out = par_map(&items, |&n| if n % 7 == 3 { panic!("boom") } else { n * 2 }, |&n| 1000 + n);
        assert_eq!(out.len(), 40);
        for (n, r) in items.iter().zip(&out) {
            assert_eq!(*r, if n % 7 == 3 { 1000 + n } else { n * 2 });
        }
        assert!(par_map(&[] as &[u32], |n| *n, |n| *n).is_empty());
    }

}
