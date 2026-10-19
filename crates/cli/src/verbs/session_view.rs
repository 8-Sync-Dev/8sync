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
        let digest = tr.as_deref().map(|p| scan_file(p, Fmt::Omp, detail)).unwrap_or_default();
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
        let tr = (engine == "ccc").then(|| claude_transcript(&env.home, &s.conversation_id)).flatten();
        let digest = tr.as_deref().map(|p| scan_file(p, Fmt::Claude, detail)).unwrap_or_default();
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
