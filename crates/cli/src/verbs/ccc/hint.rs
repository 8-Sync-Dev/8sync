//! `8sync ccc hint [--complete <token>] [--json]`: what the `8sync-hints` mod draws inside
//! Claude Code — a ghost-text suggestion for the next prompt, a ≤2-line band above the prompt,
//! and typeahead rows for `/skill`, `8sync …`, `ccc …` tokens. Idea ported from omp's predictive
//! composer (n-gram over the owner's own prompt history); the code is ours. Everything is read
//! from local files only (no network, no `gh`) plus one `git status` call with a [`GIT_BUDGET`]
//! budget; everything but git stays under 50 ms. The mod runs it beside the prompt, never in
//! its way, so a slow git (a Windows spawn takes ~100 ms) only delays the band.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::Result;
use serde_json::{json, Value};

use ccc_core::registry::Registry;

/// Max rows for a typeahead answer.
const MAX_ROWS: usize = 8;
/// Longest ghost-text suggestion (one terminal line).
const MAX_SUGGEST: usize = 120;
/// SKILL.md bytes read per skill (frontmatter only).
const SKILL_HEAD: usize = 2048;
/// Tail of `history.jsonl` read per call (the file grows for ever; the bigram needs recent use).
const HISTORY_TAIL: u64 = 512 * 1024;
/// `git status` budget. 50 ms was too tight for a Windows spawn (CI run 38837734481: no branch).
const GIT_BUDGET: Duration = Duration::from_millis(300);
/// Watchdog alert is "fresh" for this long (same as the statusline).
const ALERT_FRESH_S: u64 = 600;

/// ccc verbs with a one-line description — the `8sync ccc <verb>` typeahead table.
pub(super) const CCC_VERBS: &[(&str, &str)] = &[
    (".", "session theo tên trong repo này: 8sync ccc . <tên>"),
    ("help", "mọi verb của ccc trên một màn hình"),
    ("kit", "cài/làm mới kit (hook, skill, mod) vào ~/.claude"),
    ("status", "guard, gate, mod có đang bật không"),
    ("hint", "gợi ý prompt kế + band + typeahead (mod 8sync-hints gọi)"),
    ("inbox", "task HQ đang chờ cho phiên rảnh (mod 8sync-inbox gọi)"),
    ("loop", "vòng lặp /ship-loop: init · tick · status · done · ev"),
    ("cancel", "huỷ hết việc session này đặt (goal, urgent, loop); --all xuyên session"),
    ("risk", "gate bắt buộc cho diff này: /sec, /rules, /aup-audit…"),
    ("term", "terminal thật của một phòng nền cho HQ web (claude attach)"),
    ("auto", "team luôn work: on [--omp] · pause · off · omp on|off · status"),
    ("sleep", "tắt màn hình + khoá máy ngay, Claude vẫn làm tiếp: work [--hours N] [--no-lock] · off · status"),
    ("eco", "máy dùng bao nhiêu (RAM, CPU, GPU, W, pin) + giữ phiên chạy lâu nhẹ: status · tick · run · install · uninstall · set ram|cpu <%> · set battery on|off [--json]"),
    ("awake", "giữ máy không ngủ khi phòng chạy, tắt màn hình khi không ai đụng: on (giữ tới khi off) · off · --while-rooms · --hours N · --screen-off 10 · status [--json]"),
    ("stop", "dừng hết: `stop all` tắt auto + đội omp, dừng mọi phòng nền của mọi dự án (phiên terminal giữ nguyên)"),
    ("meet", "họp sprint daily: --say \"done|doing|blocked\" vào su-code/standup"),
    ("msg", "nhắn phòng khác (cả đội omp): msg <phòng|--all> \"…\""),
    ("standup", "bảng sprint: role nào rảnh, việc trùng file"),
    ("know", "cây tri thức chung của máy: add \"<bài học>\" | ls"),
    ("ls", "session của repo, mới nhất lên đầu"),
    ("report", "token, cost, thời gian, loop"),
    ("show", "tóm tắt một session"),
    ("urgent", "đặt mức cần owner chú ý: high|med|low|clear"),
    ("goal", "mục tiêu + file phòng này đang giữ"),
    ("compact", "nén transcript theo cách của kit"),
    ("secret", "đưa secret vào Encore/Vercel/GitHub qua stdin"),
    ("idle", "gate TaskCompleted khi code chưa test"),
    ("delegate", "critic trả lời thay owner câu hỏi kỹ thuật"),
    ("policy", "managed-settings / deny rule của máy"),
    ("login-kind", "subscription hay API key"),
    ("hook", "hook do kit đăng ký (không gõ tay)"),
    ("statusline", "dòng trạng thái (kit gọi)"),
];

/// Everything `hint` reads; built once per call so tests can point it at a fixture.
pub(super) struct Ctx<'a> {
    pub cwd: &'a Path,
    pub home: &'a Path,
    /// `$CLAUDE_CONFIG_DIR` or `~/.claude`: skills + history.jsonl live here.
    pub claude_dir: &'a Path,
    pub registry: Option<&'a Registry>,
    pub session_id: Option<&'a str>,
    pub now: u64,
    /// Run `git status` (false in unit tests that must not spawn).
    pub git: bool,
}

/// One typeahead row (what `prompt.autocomplete` expects).
#[derive(Debug, PartialEq, Eq, Clone)]
pub(super) struct Row {
    pub text: String,
    pub label: String,
    pub description: String,
}

impl Row {
    fn json(&self) -> Value {
        json!({ "text": self.text, "label": self.label, "description": self.description })
    }
}

/// An active `/ship-loop`: first slug in `su-code/ship/ACTIVE` whose loop.json is not stopped.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Loop {
    pub slug: String,
    pub iter: u64,
    pub max_iter: u64,
}

/// What `git status --porcelain=v2 --branch` says, reduced to what the hints need.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Git {
    pub branch: Option<String>,
    pub ahead: u64,
    pub dirty: bool,
}

/// The repo state both `suggest` and `band` read, gathered once per call.
#[derive(Debug, Default)]
pub(super) struct Facts {
    pub active: Option<Loop>,
    /// `level[: note]` of this session's own urgent flag.
    pub urgency: Option<String>,
    pub git: Git,
    pub alert: Option<String>,
}

pub(super) fn run(rest: &[String], cx: &Ctx) -> Result<()> {
    let json = rest.iter().any(|a| a == "--json");
    let token = rest.iter().position(|a| a == "--complete").and_then(|i| rest.get(i + 1));
    let out = match token {
        Some(tok) => render_complete(&complete(tok, cx)),
        None => render_hint(cx),
    };
    if json {
        println!("{out}");
    } else if token.is_some() {
        for r in out["complete"].as_array().into_iter().flatten() {
            println!("{}\t{}\t{}", r["text"].as_str().unwrap_or(""), r["label"].as_str().unwrap_or(""), r["description"].as_str().unwrap_or(""));
        }
    } else {
        if let Some(s) = out["suggest"].as_str() {
            println!("→ {s}");
        }
        for l in out["band"].as_array().into_iter().flatten().filter_map(Value::as_str) {
            println!("{l}");
        }
    }
    Ok(())
}

/// `{"suggest": string|null, "band": [string]}` — the contract `hint.ts` parses.
pub(super) fn render_hint(cx: &Ctx) -> Value {
    let f = gather(cx);
    json!({ "suggest": suggest(cx, &f), "band": band(&f) })
}

/// `{"complete": [{text,label,description}]}`.
pub(super) fn render_complete(rows: &[Row]) -> Value {
    json!({ "complete": rows.iter().map(Row::json).collect::<Vec<_>>() })
}

pub(super) fn gather(cx: &Ctx) -> Facts {
    Facts {
        active: active_loop(cx.cwd),
        urgency: own_urgency(cx),
        git: if cx.git { git_status(cx.cwd) } else { Git::default() },
        alert: fresh_alert(cx.home, cx.now),
    }
}

/// The next prompt the owner most likely wants (ghost text). Priority: open loop, own urgent
/// flag, bigram from the owner's own history, then git state.
pub(super) fn suggest(cx: &Ctx, f: &Facts) -> Option<String> {
    if let Some(l) = &f.active {
        return Some(format!("tiếp tục loop {} (iter {}/{})", l.slug, l.iter, l.max_iter));
    }
    if let Some(u) = &f.urgency {
        return Some(format!("đã xem urgent {u}; làm tiếp rồi 8sync ccc . urgent clear"));
    }
    if let Some(p) = predict_next(&history_tail(&cx.claude_dir.join("history.jsonl")), &cx.cwd.to_string_lossy()) {
        return Some(p);
    }
    suggest_from_git(&f.git)
}

fn suggest_from_git(g: &Git) -> Option<String> {
    let b = g.branch.as_deref()?;
    if g.dirty {
        return Some("/sec rồi commit theo conventional commits".into());
    }
    if g.ahead > 0 {
        return Some(format!("push nhánh {b} rồi mở PR"));
    }
    None
}

/// ≤ 2 short Vietnamese lines for the band above the prompt. Line 1: loop · git. Line 2:
/// urgent · watchdog alert. Empty parts are dropped; an empty vec means "draw nothing".
pub(super) fn band(f: &Facts) -> Vec<String> {
    let mut l1 = Vec::new();
    if let Some(l) = &f.active {
        l1.push(format!("loop {} {}/{}", l.slug, l.iter, l.max_iter));
    }
    if let Some(b) = &f.git.branch {
        let mut s = format!("⎇ {b}");
        if f.git.ahead > 0 {
            s.push_str(&format!(" ↑{}", f.git.ahead));
        }
        if f.git.dirty {
            s.push_str(" ✎");
        }
        l1.push(s);
    }
    let mut l2 = Vec::new();
    if let Some(u) = &f.urgency {
        l2.push(format!("urgent {u}"));
    }
    if let Some(a) = &f.alert {
        l2.push(format!("watchdog: {a}"));
    }
    [l1, l2].into_iter().filter(|l| !l.is_empty()).map(|l| l.join(" · ")).collect()
}

/// Typeahead rows for the token under the cursor: `/…` → installed skills, `8sync …` → top-level
/// 8sync commands, `8sync ccc …` / `ccc …` → ccc verbs. Prefix matches first, then subsequence.
/// A row whose label is exactly the query is dropped (the engine asks again once a row is taken).
pub(super) fn complete(token: &str, cx: &Ctx) -> Vec<Row> {
    let token = token.trim_start();
    if let Some(q) = token.strip_prefix('/') {
        let q = q.split_whitespace().next().unwrap_or("");
        if !q.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | ':' | '.')) {
            return Vec::new(); // a path like /home/…, not a skill name
        }
        let mut rows: Vec<Row> = skills(cx).into_iter().map(|(n, d)| Row { text: format!("/{n}"), label: n, description: d }).collect();
        rows.sort_by(|a, b| a.label.cmp(&b.label));
        return rank(q, rows);
    }
    let words: Vec<&str> = token.split_whitespace().collect();
    let trailing = token.ends_with(char::is_whitespace);
    // `text` replaces the word under the cursor (what `prompt.autocomplete` writes): a partial
    // last word gets the match alone; a complete keyword with no space after it ("8sync", "ccc")
    // is the token itself, so the row re-writes it followed by the match.
    match words.as_slice() {
        ["ccc", rest @ ..] | ["8sync", "ccc", rest @ ..] => {
            let q = if trailing { "" } else { rest.first().copied().unwrap_or("") };
            if rest.len() > usize::from(!trailing) {
                return Vec::new();
            }
            let lead = if !trailing && rest.is_empty() { "ccc " } else { "" };
            let rows = CCC_VERBS.iter().map(|(v, d)| Row { text: format!("{lead}{v}"), label: v.to_string(), description: d.to_string() }).collect();
            rank(q, rows)
        }
        ["8sync", rest @ ..] => {
            let q = if trailing { "" } else { rest.first().copied().unwrap_or("") };
            if rest.len() > usize::from(!trailing) {
                return Vec::new();
            }
            let lead = if !trailing && rest.is_empty() { "8sync " } else { "" };
            let rows = top_commands().into_iter().map(|(n, d)| Row { text: format!("{lead}{n}"), label: n, description: d }).collect();
            rank(q, rows)
        }
        _ => Vec::new(),
    }
}

/// `8sync` top-level subcommands with their one-line about, from the clap tree (brand-rewritten).
fn top_commands() -> Vec<(String, String)> {
    crate::command()
        .get_subcommands()
        .filter(|c| !c.is_hide_set())
        .map(|c| (c.get_name().to_string(), c.get_about().map(|a| a.to_string()).unwrap_or_default()))
        .collect()
}

/// Prefix matches (in input order) then subsequence matches, capped at [`MAX_ROWS`]; never a
/// row that only repeats the query.
pub(super) fn rank(q: &str, rows: Vec<Row>) -> Vec<Row> {
    let q = q.to_lowercase();
    let rows: Vec<Row> = rows.into_iter().filter(|r| r.label.to_lowercase() != q).collect();
    let (mut pre, rest): (Vec<Row>, Vec<Row>) = rows.into_iter().partition(|r| r.label.to_lowercase().starts_with(&q));
    pre.extend(rest.into_iter().filter(|r| !q.is_empty() && is_subsequence(&q, &r.label.to_lowercase())));
    pre.truncate(MAX_ROWS);
    pre
}

fn is_subsequence(q: &str, s: &str) -> bool {
    let mut it = s.chars();
    q.chars().all(|c| it.any(|x| x == c))
}

/// Installed skills: `<claude_dir>/skills/*/SKILL.md` (symlinks followed) then the repo's own
/// `.claude/skills`. Repo entries override user ones with the same name.
fn skills(cx: &Ctx) -> Vec<(String, String)> {
    let mut out: HashMap<String, String> = HashMap::new();
    for dir in [cx.claude_dir.join("skills"), cx.cwd.join(".claude/skills")] {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        let mut names: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        names.sort();
        for p in names {
            let Some((n, d)) = skill_meta(&p.join("SKILL.md"), &p) else { continue };
            out.insert(n, d);
        }
    }
    out.into_iter().collect()
}

/// `name` + `description` from a SKILL.md frontmatter (first [`SKILL_HEAD`] bytes); the folder
/// name when the frontmatter has no `name`.
fn skill_meta(skill_md: &Path, dir: &Path) -> Option<(String, String)> {
    let mut f = std::fs::File::open(skill_md).ok()?;
    let mut buf = vec![0u8; SKILL_HEAD];
    let n = f.read(&mut buf).ok()?;
    buf.truncate(n);
    let head = String::from_utf8_lossy(&buf);
    let fallback = dir.file_name()?.to_string_lossy().into_owned();
    Some(parse_frontmatter(&head, &fallback))
}

/// `(name, description)` from YAML frontmatter: plain or quoted scalars only; a block scalar
/// (`>` / `|`) is left empty rather than shown as its marker; a BOM before `---` is ignored.
pub(super) fn parse_frontmatter(head: &str, fallback_name: &str) -> (String, String) {
    let mut name = None;
    let mut desc = String::new();
    let mut lines = head.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim) == Some("---") {
        for l in lines {
            let l = l.trim_end();
            if l.trim() == "---" {
                break;
            }
            if let Some(v) = l.strip_prefix("name:") {
                name = Some(scalar(v)).filter(|s| !s.is_empty());
            } else if let Some(v) = l.strip_prefix("description:") {
                desc = scalar(v);
            }
        }
    }
    let mut desc: String = desc.chars().take(MAX_SUGGEST).collect();
    if let Some(i) = desc.find(". ") {
        desc.truncate(i + 1);
    }
    (name.unwrap_or_else(|| fallback_name.to_string()), desc)
}

fn scalar(v: &str) -> String {
    let v = v.trim();
    if matches!(v.chars().next(), Some('>' | '|')) {
        return String::new();
    }
    v.trim_matches(|c| c == '"' || c == '\'').to_string()
}

/// `(project, display)` pairs of the last [`HISTORY_TAIL`] bytes of `history.jsonl`, oldest
/// first; a cut first line and invalid UTF-8 bytes are tolerated.
fn history_tail(p: &Path) -> Vec<(String, String)> {
    let Ok(mut f) = std::fs::File::open(p) else { return Vec::new() };
    let Ok(len) = f.metadata().map(|m| m.len()) else { return Vec::new() };
    let start = len.saturating_sub(HISTORY_TAIL);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut b = Vec::new();
    if f.read_to_end(&mut b).is_err() {
        return Vec::new();
    }
    let raw = String::from_utf8_lossy(&b);
    let mut lines = raw.lines();
    if start > 0 {
        lines.next(); // partial line
    }
    lines
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|o| Some((o["project"].as_str()?.to_string(), o["display"].as_str()?.trim().to_string())))
        .collect()
}

/// Bigram prediction: after the prompt the owner typed last in `project`, which prompt did they
/// type most often the other times? Only this project's history; nothing leaves the machine.
/// Candidates that carry a secret-looking token or a collapsed paste placeholder are skipped:
/// a hint must never put a key back on screen, and a placeholder does not expand when taken.
pub(super) fn predict_next(hist: &[(String, String)], project: &str) -> Option<String> {
    let mine: Vec<&str> = hist.iter().filter(|(p, d)| p == project && !d.is_empty()).map(|(_, d)| d.as_str()).collect();
    let last = *mine.last()?;
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for w in mine.windows(2) {
        if w[0] == last && w[1] != last && w[1].chars().count() >= 3 && is_safe_candidate(w[1]) {
            *counts.entry(w[1]).or_default() += 1;
        }
    }
    let best = counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(a.0)))?.0;
    Some(one_line(best))
}

fn is_safe_candidate(d: &str) -> bool {
    !d.contains("[Pasted text") && ccc_core::secret_mask::mask(d) == d
}

fn one_line(s: &str) -> String {
    let s: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.chars().count() > MAX_SUGGEST {
        let cut: String = s.chars().take(MAX_SUGGEST - 1).collect();
        format!("{cut}…")
    } else {
        s
    }
}

pub(super) fn active_loop(cwd: &Path) -> Option<Loop> {
    let dir = cwd.ancestors().map(|d| d.join("su-code/ship")).find(|d| d.is_dir())?;
    let active = std::fs::read_to_string(dir.join("ACTIVE")).ok()?;
    for slug in active.lines().map(str::trim) {
        if slug.is_empty() || slug.starts_with('.') || !slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(dir.join(slug).join("loop.json")) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else { continue };
        if !v["stopped"].is_null() {
            continue;
        }
        return Some(Loop { slug: slug.to_string(), iter: v["iter"].as_u64().unwrap_or(0), max_iter: v["max_iter"].as_u64().unwrap_or(0) });
    }
    None
}

fn own_urgency(cx: &Ctx) -> Option<String> {
    let id = cx.session_id?;
    let s = cx.registry?.sessions.iter().find(|s| s.conversation_id == id)?;
    let u = s.urgency.as_ref()?;
    Some(match &u.note {
        Some(n) if !n.trim().is_empty() => format!("{}: {}", u.level, one_line(n)),
        _ => u.level.clone(),
    })
}

fn fresh_alert(home: &Path, now: u64) -> Option<String> {
    let raw = std::fs::read_to_string(home.join(".local/state/8sync/watchdog/alerts.jsonl")).ok()?;
    let l = raw.lines().rev().find(|l| !l.trim().is_empty())?;
    let v: Value = serde_json::from_str(l).ok()?;
    (now.saturating_sub(v["ts"].as_u64()?) <= ALERT_FRESH_S).then(|| v["kind"].as_str().unwrap_or("alert").to_string())
}

/// One `git status --porcelain=v2 --branch` within [`GIT_BUDGET`]; `Git::default()` when git is
/// missing, slow, or `cwd` is not a repo. Untracked files count as dirty (a new file still
/// needs `/sec` and a commit).
fn git_status(cwd: &Path) -> Git {
    git_status_within(cwd, GIT_BUDGET)
}

fn git_status_within(cwd: &Path, budget: Duration) -> Git {
    let mut c = Command::new("git");
    c.arg("-C").arg(cwd).args(["status", "--porcelain=v2", "--branch"]).env("GIT_OPTIONAL_LOCKS", "0");
    super::statusline::run_budget(c, None, budget).map(|s| parse_status(&s)).unwrap_or_default()
}

pub(super) fn parse_status(out: &str) -> Git {
    let mut g = Git::default();
    for l in out.lines() {
        if let Some(h) = l.strip_prefix("# branch.head ") {
            g.branch = Some(h.trim().to_string()).filter(|b| b != "(detached)" && !b.is_empty());
        } else if let Some(ab) = l.strip_prefix("# branch.ab ") {
            g.ahead = ab.split_whitespace().next().and_then(|a| a.trim_start_matches('+').parse().ok()).unwrap_or(0);
        } else if l.starts_with(['1', '2', 'u', '?']) {
            g.dirty = true;
        }
    }
    g
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    /// A scratch dir under the OS temp dir, removed on drop (no tempfile dependency).
    struct Tmp(PathBuf);
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A repo with 40 installed skills and a history whose last prompt was seen twice before,
    /// followed each time by the same next prompt.
    fn fixture() -> (Tmp, PathBuf, PathBuf) {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let t = Tmp(std::env::temp_dir().join(format!("8sync-hint-{}-{n}", std::process::id())));
        let _ = std::fs::remove_dir_all(&t.0);
        let home = t.0.join("home");
        let cwd = t.0.join("repo");
        let cd = home.join(".claude");
        for i in 0..40 {
            write(&cd.join(format!("skills/sk{i}/SKILL.md")), &format!("---\nname: sk{i}\ndescription: skill số {i}. Chi tiết dài.\n---\n# body\n"));
        }
        write(&cd.join("skills/ship/SKILL.md"), "---\nname: ship\ndescription: Chạy trọn quy trình một feature. Dùng khi /ship.\n---\n");
        write(&cwd.join(".claude/skills/repo-only/SKILL.md"), "---\ndescription: 'skill của repo'\n---\n");
        let proj = cwd.to_string_lossy().to_string();
        let mut h = String::new();
        for _ in 0..2 {
            h.push_str(&format!("{}\n", json!({"display":"chạy test","project":proj,"timestamp":1})));
            h.push_str(&format!("{}\n", json!({"display":"commit đi","project":proj,"timestamp":2})));
        }
        h.push_str(&format!("{}\n", json!({"display":"chạy test","project":"/other","timestamp":3})));
        h.push_str(&format!("{}\n", json!({"display":"push","project":"/other","timestamp":4})));
        h.push_str("not json at all\n");
        h.push_str(&format!("{}\n", json!({"display":"chạy test","project":proj,"timestamp":5})));
        write(&cd.join("history.jsonl"), &h);
        (t, home, cwd)
    }

    fn ctx<'a>(home: &'a Path, cwd: &'a Path, cd: &'a Path) -> Ctx<'a> {
        Ctx { cwd, home, claude_dir: cd, registry: None, session_id: None, now: 1_000_000, git: false }
    }

    fn git(cwd: &Path, args: &[&str]) {
        let st = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .unwrap();
        assert!(st.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&st.stderr));
    }

    #[test]
    fn hint_suggest_prefers_open_loop_then_bigram_then_git() {
        let (_t, home, cwd) = fixture();
        let cd = home.join(".claude");
        let cx = ctx(&home, &cwd, &cd);
        assert_eq!(suggest(&cx, &gather(&cx)).as_deref(), Some("commit đi"), "bigram when no loop");
        write(&cwd.join("su-code/ship/ACTIVE"), "old\nhints\n");
        write(&cwd.join("su-code/ship/old/loop.json"), r#"{"iter":3,"max_iter":5,"stopped":"done"}"#);
        write(&cwd.join("su-code/ship/hints/loop.json"), r#"{"iter":2,"max_iter":12}"#);
        assert_eq!(suggest(&cx, &gather(&cx)).as_deref(), Some("tiếp tục loop hints (iter 2/12)"));
        assert_eq!(suggest_from_git(&Git { branch: Some("feat/x".into()), ahead: 2, dirty: false }).as_deref(), Some("push nhánh feat/x rồi mở PR"));
        assert_eq!(suggest_from_git(&Git { branch: Some("feat/x".into()), ahead: 2, dirty: true }).as_deref(), Some("/sec rồi commit theo conventional commits"));
        assert_eq!(suggest_from_git(&Git::default()), None);
    }

    #[test]
    fn hint_bigram_filters_by_project_and_ignores_self_pairs() {
        let h = |p: &str, d: &str| (p.to_string(), d.to_string());
        let hist = vec![h("/a", "x"), h("/a", "x"), h("/b", "x"), h("/b", "zzz"), h("/a", "x")];
        assert_eq!(predict_next(&hist, "/a"), None, "x→x is not a suggestion; /b's zzz is another project");
        assert_eq!(predict_next(&hist, "/b"), None, "last /b prompt is zzz, never seen before");
        assert_eq!(predict_next(&[], "/a"), None);
    }

    #[test]
    fn hint_bigram_never_repeats_a_secret_or_a_paste_placeholder() {
        let h = |d: &str| ("/a".to_string(), d.to_string());
        let key = format!("dùng key sk-ant-api03-{}", "A".repeat(40));
        let hist = vec![h("go"), h(&key), h("go"), h(&key), h("go"), h("[Pasted text #1 +12 lines]"), h("go")];
        assert_eq!(predict_next(&hist, "/a"), None, "the only followers are a key and a placeholder");
        let hist = vec![h("go"), h(&key), h("go"), h("ok tiếp"), h("go")];
        assert_eq!(predict_next(&hist, "/a").as_deref(), Some("ok tiếp"), "falls through to the safe candidate");
    }

    #[test]
    fn hint_history_tail_skips_a_cut_first_line() {
        let (_t, home, _cwd) = fixture();
        let p = home.join("big.jsonl");
        let mut s = String::new();
        let line = format!("{}\n", json!({"display":"filler prompt that is long enough","project":"/x","timestamp":1}));
        while s.len() < HISTORY_TAIL as usize + 4096 {
            s.push_str(&line);
        }
        s.push_str(&format!("{}\n", json!({"display":"last","project":"/x","timestamp":2})));
        write(&p, &s);
        let h = history_tail(&p);
        assert!(h.len() > 1000 && h.len() < 7000, "{}", h.len());
        assert_eq!(h.last().unwrap().1, "last");
        assert!(h.iter().all(|(_, d)| d == "last" || d == "filler prompt that is long enough"), "no cut line parsed");
        assert!(history_tail(&home.join("missing.jsonl")).is_empty());
        // QA (2026-10-16): one invalid-UTF-8 line must not throw the whole history away.
        let p = home.join("bad.jsonl");
        let mut b = format!("{}\n", json!({"display":"go","project":"/x","timestamp":1})).into_bytes();
        b.extend_from_slice(b"\xff\xfe\n");
        b.extend_from_slice(format!("{}\n", json!({"display":"after","project":"/x","timestamp":2})).as_bytes());
        std::fs::write(&p, b).unwrap();
        assert_eq!(history_tail(&p).iter().map(|(_, d)| d.as_str()).collect::<Vec<_>>(), vec!["go", "after"]);
    }

    #[test]
    fn hint_urgency_of_own_session_is_suggested_and_in_band() {
        let (_t, home, cwd) = fixture();
        let cd = home.join(".claude");
        let reg: Registry = serde_json::from_value(json!({
            "sessions": [{"name":"core","conversation_id":"abc","created":1,"last_active":2,
                           "urgency":{"level":"high","note":"chờ Ship","set_at":3}}]
        }))
        .unwrap();
        let mut cx = ctx(&home, &cwd, &cd);
        cx.registry = Some(&reg);
        cx.session_id = Some("abc");
        assert_eq!(suggest(&cx, &gather(&cx)).as_deref(), Some("đã xem urgent high: chờ Ship; làm tiếp rồi 8sync ccc . urgent clear"));
        write(&home.join(".local/state/8sync/watchdog/alerts.jsonl"), &format!("{}\n", json!({"ts": 999_900, "kind": "gpu-vram"})));
        assert_eq!(band(&gather(&cx)), vec!["urgent high: chờ Ship · watchdog: gpu-vram".to_string()]);
        cx.session_id = Some("other");
        cx.now = 2_000_000;
        assert!(band(&gather(&cx)).is_empty(), "no loop, no git, stale alert, not my urgency");
    }

    #[test]
    fn hint_band_is_at_most_two_lines_and_json_contract_holds() {
        let (_t, home, cwd) = fixture();
        let cd = home.join(".claude");
        write(&cwd.join("su-code/ship/ACTIVE"), "hints\n");
        write(&cwd.join("su-code/ship/hints/loop.json"), r#"{"iter":1,"max_iter":4}"#);
        write(&home.join(".local/state/8sync/watchdog/alerts.jsonl"), &format!("{}\n", json!({"ts": 1_000_000, "kind": "cpu"})));
        let cx = ctx(&home, &cwd, &cd);
        let v = render_hint(&cx);
        assert_eq!(v, json!({ "suggest": "tiếp tục loop hints (iter 1/4)", "band": ["loop hints 1/4", "watchdog: cpu"] }));
        assert!(v["band"].as_array().unwrap().len() <= 2);
        let v = render_complete(&complete("/sh", &cx));
        assert_eq!(v, json!({ "complete": [{ "text": "/ship", "label": "ship", "description": "Chạy trọn quy trình một feature." }] }));
        assert_eq!(render_complete(&[]), json!({ "complete": [] }));
    }

    #[test]
    fn hint_parse_git_status_v2() {
        let out = "# branch.oid abc\n# branch.head feat/ccc-hints\n# branch.upstream origin/feat/ccc-hints\n# branch.ab +3 -0\n1 .M N... 100644 100644 100644 abc def crates/x.rs\n";
        assert_eq!(parse_status(out), Git { branch: Some("feat/ccc-hints".into()), ahead: 3, dirty: true });
        assert_eq!(parse_status("# branch.oid abc\n# branch.head (detached)\n"), Git::default());
        assert_eq!(parse_status("# branch.oid abc\n# branch.head main\n# branch.ab +0 -2\n"), Git { branch: Some("main".into()), ahead: 0, dirty: false });
        assert_eq!(parse_status("# branch.head main\n? new.rs\n"), Git { branch: Some("main".into()), ahead: 0, dirty: true }, "untracked counts as dirty");
    }

    #[test]
    fn hint_real_git_repo_feeds_suggest_and_band() {
        let (_t, home, cwd) = fixture();
        let cd = home.join(".claude");
        write(&cd.join("history.jsonl"), "");
        git(&cwd, &["init", "-q", "-b", "main"]);
        write(&cwd.join("a.txt"), "1\n");
        git(&cwd, &["add", "."]);
        git(&cwd, &["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"]);
        let cx = ctx(&home, &cwd, &cd);
        // A generous budget here: this checks what real git says, not how fast a loaded
        // Windows runner spawns it (the latency test covers the production budget).
        let slow = Duration::from_secs(20);
        let f = Facts { git: git_status_within(&cwd, slow), ..gather(&cx) };
        assert_eq!(f.git, Git { branch: Some("main".into()), ahead: 0, dirty: false });
        assert_eq!(suggest(&cx, &f), None);
        assert_eq!(band(&f), vec!["⎇ main".to_string()]);
        write(&cwd.join("b.txt"), "2\n");
        let f = Facts { git: git_status_within(&cwd, slow), ..gather(&cx) };
        assert!(f.git.dirty, "untracked file: {f:?}");
        assert_eq!(suggest(&cx, &f).as_deref(), Some("/sec rồi commit theo conventional commits"));
        assert_eq!(band(&f), vec!["⎇ main ✎".to_string()]);
    }

    #[test]
    fn hint_complete_slash_lists_skills_prefix_then_subsequence() {
        let (_t, home, cwd) = fixture();
        let cd = home.join(".claude");
        let cx = ctx(&home, &cwd, &cd);
        let rows = complete("/sh", &cx);
        assert_eq!(rows[0], Row { text: "/ship".into(), label: "ship".into(), description: "Chạy trọn quy trình một feature.".into() });
        let rows = complete("/", &cx);
        assert_eq!(rows.len(), MAX_ROWS);
        let rows = complete("/repo", &cx);
        assert_eq!(rows[0].label, "repo-only", "repo skill without name: uses the folder name");
        assert_eq!(rows[0].description, "skill của repo");
        let rows = complete("/s1", &cx);
        assert_eq!(rows.len(), MAX_ROWS);
        assert!(rows.iter().all(|r| r.label.starts_with("sk1")), "11 prefix rows (sk1, sk10…) fill the cap before any subsequence row: {rows:?}");
        let rows = complete("/sp", &cx);
        assert_eq!(rows.iter().map(|r| r.label.as_str()).collect::<Vec<_>>(), vec!["ship"], "no prefix match: subsequence s…p finds ship only");
        assert!(complete("/ship", &cx).is_empty(), "exact match: nothing to add");
        assert!(complete("/home/alexng/x", &cx).is_empty(), "a path is not a skill query");
        assert!(complete("plain text", &cx).is_empty());
    }

    #[test]
    fn hint_complete_8sync_and_ccc_verbs() {
        let (_t, home, cwd) = fixture();
        let cd = home.join(".claude");
        let cx = ctx(&home, &cwd, &cd);
        let rows = complete("8sync ccc lo", &cx);
        assert_eq!(rows[0], Row { text: "loop".into(), label: "loop".into(), description: CCC_VERBS.iter().find(|(v, _)| *v == "loop").unwrap().1.into() }, "partial last word: the verb replaces it");
        let rows = complete("ccc ", &cx);
        assert_eq!(rows.len(), MAX_ROWS);
        assert_eq!(rows[0].text, rows[0].label, "after a space: the verb alone");
        let rows = complete("ccc", &cx);
        assert!(rows.iter().all(|r| r.text.starts_with("ccc ")), "the token is `ccc` itself: rows re-write it: {rows:?}");
        let rows = complete("8sync cc", &cx);
        assert!(rows.iter().any(|r| r.text == "ccc" && !r.description.is_empty()), "{rows:?}");
        let rows = complete("8sync", &cx);
        assert_eq!(rows.len(), MAX_ROWS);
        assert!(rows.iter().all(|r| r.text.starts_with("8sync ")), "{rows:?}");
        assert!(complete("8sync ccc loop", &cx).is_empty(), "exact verb: nothing to add");
        assert!(complete("8sync ccc loop tick", &cx).is_empty(), "past the verb: no rows");
    }

    #[test]
    fn hint_ccc_verbs_table_matches_dispatcher() {
        for (v, d) in CCC_VERBS {
            assert!(*v == "." || super::super::help::VERBS.contains(v), "{v} is not a dispatcher verb");
            assert!(!d.is_empty());
        }
        for v in super::super::help::VERBS {
            if matches!(*v, "list" | "rm" | "new") {
                continue;
            }
            assert!(CCC_VERBS.iter().any(|(n, _)| n == v), "dispatcher verb {v} missing from CCC_VERBS");
        }
    }

    #[test]
    fn hint_parse_frontmatter_variants() {
        assert_eq!(parse_frontmatter("---\nname: a\ndescription: \"B. C\"\n---\n", "f"), ("a".into(), "B.".into()));
        assert_eq!(parse_frontmatter("# no frontmatter", "f"), ("f".into(), String::new()));
        assert_eq!(parse_frontmatter("---\nname:\n---\n", "f"), ("f".into(), String::new()));
        assert_eq!(parse_frontmatter("\u{feff}---\nname: bom\n---\n", "f"), ("bom".into(), String::new()));
        assert_eq!(parse_frontmatter("---\nname: blk\ndescription: >\n  folded text\n---\n", "f"), ("blk".into(), String::new()), "block scalar: no marker shown");
    }

    /// The real path: a git repo, 41 skills, a 512 KiB history tail and both outputs. Our own
    /// work stays under 50 ms; with git on, the call also waits for one `git status`.
    #[test]
    fn hint_latency_under_50ms_on_fixture() {
        let (_t, home, cwd) = fixture();
        let cd = home.join(".claude");
        let mut s = String::new();
        let proj = cwd.to_string_lossy().to_string();
        while s.len() < HISTORY_TAIL as usize {
            s.push_str(&format!("{}\n", json!({"display":"chạy test rồi báo","project":proj,"timestamp":1})));
            s.push_str(&format!("{}\n", json!({"display":"commit đi","project":proj,"timestamp":2})));
        }
        write(&cd.join("history.jsonl"), &s);
        write(&cwd.join("su-code/ship/ACTIVE"), "hints\n");
        write(&cwd.join("su-code/ship/hints/loop.json"), r#"{"iter":1,"max_iter":4}"#);
        git(&cwd, &["init", "-q", "-b", "main"]);
        git(&cwd, &["add", "."]);
        git(&cwd, &["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"]);
        let mut cx = ctx(&home, &cwd, &cd);
        cx.git = true;
        let _ = (render_hint(&cx), complete("/s", &cx)); // warm the page cache
        let t0 = Instant::now();
        for _ in 0..5 {
            let v = render_hint(&cx);
            assert!(v["band"][0].as_str().unwrap().starts_with("loop hints 1/4"), "{v}");
            let _ = complete("/s", &cx);
            let _ = complete("8sync ccc ", &cx);
        }
        let per = t0.elapsed() / 5;
        assert!(per < Duration::from_millis(50) + GIT_BUDGET, "one hint call took {per:?}");
        cx.git = false;
        let t0 = Instant::now();
        for _ in 0..5 {
            let _ = render_hint(&cx);
            let _ = complete("/s", &cx);
            let _ = complete("8sync ccc ", &cx);
        }
        let per = t0.elapsed() / 5;
        assert!(per < Duration::from_millis(50), "hint without git took {per:?}");
    }
}
