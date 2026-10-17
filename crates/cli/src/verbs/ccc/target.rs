//! `8sync ccc auto add|queue|done|drop` and the board verbs `claim|move|note|board|lint`: the
//! project's cards for `auto`. Like a prompt typed while Claude is busy, a card waits in line;
//! `--now` puts it first and pushes it into every room's inbox (Claude Code's "ctrl+x ctrl+s to
//! send now", for the whole project).
//!
//! Board (super-board's columns, MIT, Eric Tech; see THIRD_PARTY_NOTICES.md), local and per project:
//! `backlog` (no acceptance check yet) → `ready` → `building` → `qa` → `review` → `approved` (head SHA
//! reviewed, waits for the owner's Ship) → done, plus `blocked`. `add` lands in `ready` with
//! `--check`, else in `backlog`; label `qa` skips `building`. A room [`claim`]s the first free card
//! of its role's lane (`room::Role::lane`); taking a `ready` card moves it to `building`. A claim
//! older than [`CLAIM_SECS`] is reaped (a stranded `building` card goes back to `ready`). [`move_to`]
//! checks the transition; the third bounce back to `ready` blocks the card (super-board's
//! `rebuild_cap` 2). Re-adding the text of an open card adds a note instead of a twin.
//!
//! Every loop tick reads `auto status --json`, which carries the first open card for rooms without a
//! lane; a room that proves a card met (the `check` command exits 0 after merge, or runnable
//! evidence) runs `auto done <id> --evidence`.
//!
//! File: `<state>/ccc/targets.json` (next to `auto.json`), schema 1:
//! `{ "projects": { "<root>": { "next_id", "items": [Target] } } }`. Per user, keyed by the
//! canonical project root; a room in a subfolder or worktree inside a stored root uses that root.
//! Writes take `targets.lock` and replace the file atomically; a corrupt file fails closed. Cards
//! written before the board read as `ready`.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use super::idle;

/// Chars kept of a target's text, its check command, an evidence line and a note.
const TEXT_MAX: usize = 2000;
const CHECK_MAX: usize = 300;
const EVIDENCE_MAX: usize = 300;
const NOTE_MAX: usize = 400;
/// Open targets per project, finished ones kept for `auto queue`, notes kept per card.
const OPEN_MAX: usize = 50;
const CLOSED_KEEP: usize = 20;
const NOTES_KEEP: usize = 12;
/// A claim not refreshed for this long belongs to a room that stopped (super-board reaps stale locks).
pub(super) const CLAIM_SECS: u64 = 2 * 3600;
/// Bounces back to `ready` a card takes before it blocks (super-board `rebuild_cap`).
const REBUILD_CAP: u32 = 2;

/// Open lanes in board order; `done`/`dropped` live in `state`.
pub(super) const LANES: [&str; 7] = ["backlog", "ready", "building", "qa", "review", "approved", "blocked"];
pub(super) const LABELS: [&str; 3] = ["bug", "feature", "qa"];

/// Allowed moves (from → to). Done goes through `auto done`, which needs evidence.
fn allowed(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("backlog", "ready")
            | ("ready", "building" | "qa" | "backlog")
            | ("building", "qa" | "ready")
            | ("qa", "review" | "ready")
            | ("review", "approved" | "ready" | "qa")
            | ("approved", "review" | "ready")
            | ("blocked", "ready" | "backlog")
    ) || (to == "blocked" && from != "blocked")
}

fn lane_ready() -> String {
    "ready".into()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct Claim {
    pub room: String,
    pub at: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct Note {
    pub at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct Target {
    pub id: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check: Option<String>,
    pub added: u64,
    /// Room that queued it; none = the owner's terminal. Lets the owner spot a target an agent
    /// queued on its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// `open`, `done` or `dropped`.
    pub state: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    /// One of [`LANES`] while open.
    #[serde(default = "lane_ready")]
    pub lane: String,
    /// One of [`LABELS`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim: Option<Claim>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<Note>,
    /// Times sent back to `ready` from qa/review/approved.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub bounces: u32,
    /// The card's pull request (number or URL), set when it leaves `building`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr: Option<String>,
    /// Head commit the review approved; merge only with `--match-head-commit <sha>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

impl Target {
    fn note(&mut self, room: Option<&str>, text: &str, now: u64) {
        let text = clean(text, NOTE_MAX);
        if text.is_empty() {
            return;
        }
        self.notes.push(Note { at: now, room: room.map(str::to_string), text });
        let extra = self.notes.len().saturating_sub(NOTES_KEEP);
        self.notes.drain(..extra);
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Project {
    next_id: u64,
    items: Vec<Target>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Book {
    #[serde(default)]
    projects: BTreeMap<String, Project>,
}

fn file(home: &Path) -> PathBuf {
    let d = idle::state_dir(home);
    d.parent().unwrap_or(&d).join("targets.json")
}

/// Lines kept, hidden characters dropped, secrets masked, at most `max` chars.
fn clean(s: &str, max: usize) -> String {
    let hidden = |c: char| {
        (c.is_control() && c != '\n')
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{2028}' | '\u{2029}' | '\u{FEFF}')
    };
    let t: String = s.chars().filter(|c| !hidden(*c)).collect();
    crate::verbs::session_view::truncate(&crate::verbs::session_view::mask_secrets(t.trim()), max)
}

fn read(home: &Path) -> Result<Book> {
    match std::fs::read_to_string(file(home)) {
        Ok(t) => serde_json::from_str(&t).with_context(|| {
            format!(
                "{} hỏng: sửa hoặc xoá file rồi chạy lại",
                file(home).display()
            )
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Book::default()),
        Err(e) => Err(e.into()),
    }
}

/// The stored root `root` belongs to (longest one that contains it), else `root` itself.
fn key(book: &Book, root: &Path) -> String {
    let root = super::auto::canon(root);
    book.projects
        .keys()
        .filter(|k| root.starts_with(Path::new(k.as_str())))
        .max_by_key(|k| k.len())
        .cloned()
        .unwrap_or_else(|| root.to_string_lossy().into_owned())
}

/// Read, change and write the book under `targets.lock`. Another writer holds the lock for
/// milliseconds; a lock older than 10 s is a crashed writer's and is taken over.
fn edit<T>(home: &Path, root: &Path, f: impl FnOnce(&mut Project) -> Result<T>) -> Result<T> {
    let p = file(home);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let lock = p.with_extension("lock");
    let mut tries = 0;
    loop {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
        {
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && tries < 100 => {
                let stale = std::fs::metadata(&lock)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|at| at.elapsed().ok())
                    .is_some_and(|age| age.as_secs() >= 10);
                if stale {
                    let _ = std::fs::remove_file(&lock);
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                tries += 1;
            }
            Err(e) => return Err(e).context("targets.lock đang bị giữ, thử lại sau"),
        }
    }
    let out = (|| {
        let mut book = read(home)?;
        let k = key(&book, root);
        let out = f(book.projects.entry(k).or_default())?;
        let tmp = p.with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&tmp, format!("{}\n", serde_json::to_string(&book)?))?;
        if let Err(e) = std::fs::rename(&tmp, &p) {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
        Ok(out)
    })();
    let _ = std::fs::remove_file(&lock);
    out
}

/// Every target of the project, open ones first in queue order, then the latest closed ones.
pub(super) fn list(home: &Path, root: &Path) -> Result<Vec<Target>> {
    let mut book = read(home)?;
    let k = key(&book, root);
    let mut items = book
        .projects
        .remove(&k)
        .map(|p| p.items)
        .unwrap_or_default();
    items.sort_by_key(|t| t.state != "open");
    Ok(items)
}

/// The target every room works on now, and how many are open in total.
pub(super) fn current(home: &Path, root: &Path) -> Result<(Option<Target>, usize)> {
    let open: Vec<Target> = list(home, root)?
        .into_iter()
        .filter(|t| t.state == "open")
        .collect();
    Ok((open.first().cloned(), open.len()))
}

/// Queue a card; `first` puts it ahead of every open one. Lands in `ready` with a check, else in
/// `backlog`. The text of an open card again → a note on that card (and `first` moves it up);
/// the bool says it was such a repeat.
#[allow(clippy::too_many_arguments)]
pub(super) fn add(
    home: &Path,
    root: &Path,
    text: &str,
    check: Option<&str>,
    label: Option<&str>,
    first: bool,
    from: Option<&str>,
    now: u64,
) -> Result<(Target, bool)> {
    let text = clean(text, TEXT_MAX);
    if text.is_empty() {
        bail!("đích rỗng");
    }
    if let Some(l) = label.filter(|l| !LABELS.contains(l)) {
        bail!("nhãn `{l}` không hợp lệ: {}", LABELS.join(", "));
    }
    let check = check.map(|c| clean(c, CHECK_MAX)).filter(|c| !c.is_empty());
    edit(home, root, |p| {
        let same = |t: &Target| t.state == "open" && t.text.to_lowercase() == text.to_lowercase();
        if let Some(i) = p.items.iter().position(same) {
            let mut t = p.items.remove(i);
            t.note(from, &format!("↺ thêm lại{}", from.map(|f| format!(" bởi {f}")).unwrap_or_default()), now);
            if t.check.is_none() {
                t.check = check.clone();
            }
            p.items.insert(if first { 0 } else { i }, t.clone());
            return Ok((t, true));
        }
        if p.items.iter().filter(|t| t.state == "open").count() >= OPEN_MAX {
            bail!("hàng đã có {OPEN_MAX} đích mở: `auto done`/`auto drop` bớt trước");
        }
        p.next_id = p
            .next_id
            .max(p.items.iter().map(|t| t.id).max().unwrap_or(0))
            + 1;
        let t = Target {
            id: p.next_id,
            text,
            lane: if check.is_some() { "ready" } else { "backlog" }.into(),
            check,
            added: now,
            from: from.map(str::to_string),
            state: "open".into(),
            closed: None,
            evidence: None,
            by: None,
            label: label.map(str::to_string),
            claim: None,
            notes: Vec::new(),
            bounces: 0,
            pr: None,
            sha: None,
        };
        if first {
            p.items.insert(0, t.clone());
        } else {
            p.items.push(t.clone());
        }
        Ok((t, false))
    })
}

/// Close an open target as `done` (evidence required) or `dropped`; returns it and the next one.
pub(super) fn close(
    home: &Path,
    root: &Path,
    id: u64,
    done: Option<&str>,
    by: Option<&str>,
    now: u64,
) -> Result<(Target, Option<Target>)> {
    let evidence = done.map(|e| clean(e, EVIDENCE_MAX));
    if evidence.as_deref() == Some("") {
        bail!("--evidence rỗng: dán lệnh kiểm + kết quả");
    }
    edit(home, root, |p| {
        let Some(t) = p.items.iter_mut().find(|t| t.id == id) else {
            bail!("không có đích #{id} trong dự án này (`8sync ccc auto queue`)");
        };
        if t.state != "open" {
            bail!("đích #{id} đã {}", t.state);
        }
        t.state = if evidence.is_some() {
            "done"
        } else {
            "dropped"
        }
        .into();
        t.closed = Some(now);
        t.evidence = evidence;
        t.by = by.map(str::to_string);
        t.claim = None;
        let closed = t.clone();
        // Closed targets go after the open ones, newest first; only the last CLOSED_KEEP stay.
        let (open, mut shut): (Vec<Target>, Vec<Target>) = std::mem::take(&mut p.items)
            .into_iter()
            .partition(|t| t.state == "open");
        shut.sort_by_key(|t| std::cmp::Reverse(t.closed.unwrap_or(0)));
        shut.truncate(CLOSED_KEEP);
        let next = open.first().cloned();
        p.items = open.into_iter().chain(shut).collect();
        Ok((closed, next))
    })
}

/// Drop stale claims; a stranded `building` card goes back to `ready` (super-board's reclaim).
fn reap(p: &mut Project, now: u64) {
    for t in p.items.iter_mut().filter(|t| t.state == "open") {
        let Some(c) = t.claim.clone().filter(|c| now.saturating_sub(c.at) >= CLAIM_SECS) else { continue };
        t.claim = None;
        if t.lane == "building" {
            t.lane = "ready".into();
            t.note(None, &format!("↩ {} không báo gì {} giờ: trả về ready", c.room, CLAIM_SECS / 3600), now);
        }
    }
}

/// Does free card `t` belong to `lane`'s rooms? `qa` also takes `ready` cards labelled `qa`, which
/// `ready` skips; a `building` card whose claim went stale counts as `ready` (claim reaps it).
fn fits(t: &Target, lane: &str, now: u64) -> bool {
    let stale = t.claim.as_ref().is_some_and(|c| now.saturating_sub(c.at) >= CLAIM_SECS);
    let at = if t.lane == "building" && stale { "ready" } else { t.lane.as_str() };
    match lane {
        "qa" => at == "qa" || (at == "ready" && t.label.as_deref() == Some("qa")),
        "ready" => at == "ready" && t.label.as_deref() != Some("qa"),
        l => at == l,
    }
}

/// Read-only twin of [`claim`]'s pick: the card `room` would get from `lane` now. `auto wait` polls it.
pub(super) fn claimable(cards: &[Target], room: &str, lane: &str, now: u64) -> Option<u64> {
    // the room holding a live (not stale) claim on `t`
    fn holder(t: &Target, now: u64) -> Option<&str> {
        t.claim.as_ref().filter(|c| now.saturating_sub(c.at) < CLAIM_SECS).map(|c| c.room.as_str())
    }
    let open = cards.iter().filter(|t| t.state == "open");
    open.clone()
        .find(|t| holder(t, now) == Some(room))
        .or_else(|| open.clone().find(|t| holder(t, now).is_none() && fits(t, lane, now)))
        .map(|t| t.id)
}

/// `auto claim`: the card room `room` works on this tick. A card it already holds comes back (claim
/// refreshed); else the first free card of `lane` in queue order. Taking a `ready` card moves it to
/// `building`; the `qa` lane also takes `ready` cards labelled `qa`, the `ready` lane skips them.
pub(super) fn claim(home: &Path, root: &Path, room: &str, lane: &str, now: u64) -> Result<Option<Target>> {
    if !LANES.contains(&lane) || matches!(lane, "building" | "approved") {
        bail!("cột `{lane}` không nhận claim: backlog, ready, qa, review, blocked");
    }
    edit(home, root, |p| {
        reap(p, now);
        let mine = p.items.iter().position(|t| t.state == "open" && t.claim.as_ref().is_some_and(|c| c.room == room));
        let free = |t: &Target| t.state == "open" && t.claim.is_none() && fits(t, lane, now);
        let Some(i) = mine.or_else(|| p.items.iter().position(free)) else { return Ok(None) };
        let t = &mut p.items[i];
        if t.claim.is_none() && t.lane == "ready" {
            let to = if lane == "qa" { "qa" } else { "building" };
            t.note(Some(room), &format!("ready → {to}"), now);
            t.lane = to.into();
        }
        t.claim = Some(Claim { room: room.to_string(), at: now });
        Ok(Some(t.clone()))
    })
}

/// What a move may carry besides the target lane.
#[derive(Debug, Default)]
pub(super) struct Move<'a> {
    pub note: Option<&'a str>,
    pub check: Option<&'a str>,
    pub pr: Option<&'a str>,
    pub sha: Option<&'a str>,
}

/// `auto move <id> <lane>`: a checked transition that releases the claim (the next lane's room
/// takes it). `ready` needs a check; `approved` needs the reviewed head SHA; the bounce back to
/// `ready` past [`REBUILD_CAP`] lands in `blocked` instead.
pub(super) fn move_to(home: &Path, root: &Path, id: u64, to: &str, m: &Move, room: Option<&str>, now: u64) -> Result<Target> {
    if !LANES.contains(&to) {
        bail!("cột `{to}` không có: {} (xong → `auto done <id> --evidence`)", LANES.join(", "));
    }
    let sha = m.sha.map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = sha.filter(|s| !(7..=40).contains(&s.len()) || !s.chars().all(|c| c.is_ascii_hexdigit())) {
        bail!("--sha `{s}` không phải commit SHA");
    }
    edit(home, root, |p| {
        let Some(t) = p.items.iter_mut().find(|t| t.id == id && t.state == "open") else {
            bail!("không có card mở #{id} (`8sync ccc auto board`)");
        };
        if !allowed(&t.lane, to) {
            bail!("card #{id} đang ở {}: không chuyển thẳng sang {to}", t.lane);
        }
        if let Some(c) = m.check.map(|c| clean(c, CHECK_MAX)).filter(|c| !c.is_empty()) {
            t.check = Some(c);
        }
        if to == "ready" && t.check.is_none() {
            bail!("card #{id} cần lệnh check (exit 0 = đạt) trước khi ready: thêm --check \"<lệnh>\"");
        }
        if to == "approved" {
            t.sha = Some(sha.ok_or_else(|| anyhow::anyhow!("approved cần --sha <head commit đã review>"))?.to_string());
        } else {
            t.sha = None;
        }
        if let Some(pr) = m.pr.map(|x| clean(x, 200)).filter(|x| !x.is_empty()) {
            t.pr = Some(pr);
        }
        let from = std::mem::replace(&mut t.lane, to.to_string());
        let mut line = format!("{from} → {to}");
        if to == "ready" && matches!(from.as_str(), "qa" | "review" | "approved") {
            t.bounces += 1;
            if t.bounces > REBUILD_CAP {
                t.lane = "blocked".into();
                line = format!("{from} → blocked (🛡 bị trả lần {}: lead/owner xem lại card)", t.bounces);
            }
        }
        if let Some(n) = m.note.filter(|n| !n.trim().is_empty()) {
            line.push_str(&format!(": {n}"));
        }
        t.note(room, &line, now);
        t.claim = None;
        Ok(t.clone())
    })
}

/// `auto note <id> "<text>"`: progress on a card; refreshes the room's own claim.
pub(super) fn note(home: &Path, root: &Path, id: u64, text: &str, room: Option<&str>, now: u64) -> Result<Target> {
    if clean(text, NOTE_MAX).is_empty() {
        bail!("ghi chú rỗng");
    }
    edit(home, root, |p| {
        let Some(t) = p.items.iter_mut().find(|t| t.id == id && t.state == "open") else {
            bail!("không có card mở #{id} (`8sync ccc auto board`)");
        };
        t.note(room, text, now);
        if let (Some(c), Some(r)) = (t.claim.as_mut(), room) {
            if c.room == r {
                c.at = now;
            }
        }
        Ok(t.clone())
    })
}

/// `auto lint`: what needs a lead or the owner. Pure over the cards.
pub(super) fn lint(cards: &[Target], now: u64) -> Vec<String> {
    let mut out = Vec::new();
    for t in cards.iter().filter(|t| t.state == "open") {
        let id = t.id;
        match t.lane.as_str() {
            "ready" | "building" | "qa" | "review" if t.check.is_none() => out.push(format!("#{id} ở {} mà chưa có lệnh check", t.lane)),
            "building" if t.claim.is_none() => out.push(format!("#{id} building không ai giữ: `auto move {id} ready`")),
            "qa" | "review" if t.pr.is_none() && t.label.as_deref() != Some("qa") => out.push(format!("#{id} ở {} chưa có PR (--pr)", t.lane)),
            "blocked" => out.push(format!("#{id} blocked: {}", t.notes.last().map_or("(không ghi lý do)", |n| n.text.as_str()))),
            "approved" => out.push(format!("#{id} đã duyệt {} · chờ Ship của owner", t.sha.as_deref().unwrap_or("?"))),
            _ => {}
        }
        if let Some(c) = t.claim.as_ref().filter(|c| now.saturating_sub(c.at) >= CLAIM_SECS) {
            out.push(format!("#{id} claim của {} quá {} giờ (claim kế sẽ thu hồi)", c.room, CLAIM_SECS / 3600));
        }
    }
    out
}

/// `auto board --json`: open cards by lane, then the latest closed ones.
pub(super) fn board_json(cards: &[Target]) -> serde_json::Value {
    let lanes: Vec<_> = LANES
        .iter()
        .map(|l| serde_json::json!({ "lane": l, "cards": cards.iter().filter(|t| t.state == "open" && t.lane == *l).collect::<Vec<_>>() }))
        .collect();
    let closed: Vec<_> = cards.iter().filter(|t| t.state != "open").take(10).collect();
    serde_json::json!({ "schema": 1, "lanes": lanes, "closed": closed })
}

/// What `auto status --json` carries for the loop: the current target, without the history.
pub(super) fn json(t: Option<&Target>) -> serde_json::Value {
    t.map_or(
        serde_json::Value::Null,
        |t| serde_json::json!({ "id": t.id, "text": t.text, "check": t.check, "lane": t.lane }),
    )
}

/// The message `auto add --now` puts in a room's inbox.
pub(super) fn now_prompt(t: &Target, room: &str) -> String {
    let (role, _) = super::room::role(room);
    let check = t
        .check
        .as_deref()
        .map(|c| format!("Đạt khi `{c}` exit 0.\n"))
        .unwrap_or_default();
    format!(
        "8sync auto --now: owner gửi việc làm NGAY cho cả dự án (đích #{id}, đứng đầu hàng):\n{text}\n{check}\
         Xong lượt đang làm thì chuyển sang đích này: phần hợp vai phòng `{room}` (vai {role}); giữ file trước bằng `8sync ccc . goal \"…\" --files a,b`. \
         Đạt (lệnh kiểm + kết quả) → `8sync ccc auto done {id} --evidence \"<lệnh: kết quả>\"`. Không merge/push main/tag/deploy; câu hỏi Ship vẫn chờ owner.",
        id = t.id,
        text = t.text,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh home with a project `proj` (and `proj/apps/ui`) inside it.
    fn tmp(tag: &str) -> (PathBuf, PathBuf) {
        let h = std::env::temp_dir().join(format!("8sync-target-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let root = h.join("proj");
        std::fs::create_dir_all(root.join("apps/ui")).unwrap();
        (h, root)
    }

    /// `add` without a label, the card only.
    fn put(h: &Path, root: &Path, text: &str, check: Option<&str>, first: bool, from: Option<&str>, now: u64) -> Result<Target> {
        add(h, root, text, check, None, first, from, now).map(|(t, _)| t)
    }

    fn lanes(h: &Path, root: &Path) -> Vec<(u64, String)> {
        list(h, root).unwrap().into_iter().filter(|t| t.state == "open").map(|t| (t.id, t.lane)).collect()
    }

    #[test]
    fn cards_flow_through_the_lanes_and_claims_follow_the_rooms() {
        let (d, root) = tmp("board");
        let h = d.as_path();
        let spec = put(h, &root, "login page", None, false, None, 1).unwrap();
        let fix = put(h, &root, "fix crash", Some("cargo test -q crash"), false, Some("lead"), 2).unwrap();
        let (uat, _) = add(h, &root, "UAT checkout 390px", Some("pnpm e2e checkout"), Some("qa"), false, None, 3).unwrap();
        assert_eq!(lanes(h, &root), [(1, "backlog".into()), (2, "ready".into()), (3, "ready".into())]);
        assert!(add(h, &root, "x", None, Some("chore"), false, None, 4).is_err(), "unknown label");

        // dev takes the first ready card that is not a qa-only card; it moves to building
        let c = claim(h, &root, "dev", "ready", 10).unwrap().unwrap();
        assert_eq!((c.id, c.lane.as_str(), c.claim.as_ref().unwrap().room.as_str()), (fix.id, "building", "dev"));
        // the same room gets its card back next tick (claim refreshed), another dev gets nothing
        assert_eq!(claim(h, &root, "dev", "ready", 20).unwrap().unwrap().claim.unwrap().at, 20);
        assert_eq!(claim(h, &root, "dev2", "ready", 21).unwrap(), None);
        // qa takes the qa-labelled ready card straight into qa
        let q = claim(h, &root, "qa", "qa", 22).unwrap().unwrap();
        assert_eq!((q.id, q.lane.as_str()), (uat.id, "qa"));
        // lead triages backlog: ready needs a check
        assert_eq!(claim(h, &root, "lead", "backlog", 23).unwrap().unwrap().id, spec.id);
        let e = move_to(h, &root, spec.id, "ready", &Move::default(), Some("lead"), 24).unwrap_err().to_string();
        assert!(e.contains("cần lệnh check"), "{e}");
        let m = Move { note: Some("AC: form validates email"), check: Some("pnpm test login"), ..Move::default() };
        let s = move_to(h, &root, spec.id, "ready", &m, Some("lead"), 25).unwrap();
        assert_eq!((s.lane.as_str(), s.claim, s.check.as_deref()), ("ready", None, Some("pnpm test login")));
        assert!(s.notes.last().unwrap().text.contains("backlog → ready: AC: form validates email"));
        // no skipping lanes, no claim on building/approved, unknown lanes refused
        assert!(move_to(h, &root, fix.id, "approved", &Move { sha: Some("abcdef1"), ..Move::default() }, None, 26).is_err());
        assert!(move_to(h, &root, fix.id, "done", &Move::default(), None, 26).is_err());
        assert!(claim(h, &root, "x", "building", 26).is_err() && claim(h, &root, "x", "approved", 26).is_err());

        // building → qa → review → approved, with PR and SHA
        move_to(h, &root, fix.id, "qa", &Move { pr: Some("#81"), ..Move::default() }, Some("dev"), 30).unwrap();
        assert_eq!(claim(h, &root, "qa", "qa", 31).unwrap().unwrap().id, uat.id, "qa keeps its own card first");
        move_to(h, &root, uat.id, "review", &Move::default(), Some("qa"), 32).unwrap();
        assert_eq!(claim(h, &root, "qa", "qa", 33).unwrap().unwrap().id, fix.id);
        move_to(h, &root, fix.id, "review", &Move::default(), Some("qa"), 34).unwrap();
        assert!(move_to(h, &root, fix.id, "approved", &Move::default(), None, 35).unwrap_err().to_string().contains("--sha"));
        assert!(move_to(h, &root, fix.id, "approved", &Move { sha: Some("not-a-sha"), ..Move::default() }, None, 35).is_err());
        let a = move_to(h, &root, fix.id, "approved", &Move { sha: Some("0123abc"), ..Move::default() }, Some("review"), 36).unwrap();
        assert_eq!((a.sha.as_deref(), a.pr.as_deref()), (Some("0123abc"), Some("#81")));
        // head changed after approval: back to review, SHA dropped
        assert_eq!(move_to(h, &root, fix.id, "review", &Move::default(), None, 37).unwrap().sha, None);
        let (done, _) = close(h, &root, fix.id, Some("gh pr merge 81 --match-head-commit 0123abc: merged"), Some("lead"), 38).unwrap();
        assert_eq!((done.state.as_str(), done.claim), ("done", None));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn claimable_matches_what_claim_would_take() {
        let (d, root) = tmp("claimable");
        let h = d.as_path();
        let a = put(h, &root, "a", Some("true"), false, None, 0).unwrap();
        let (q, _) = add(h, &root, "uat", Some("true"), Some("qa"), false, None, 0).unwrap();
        put(h, &root, "spec", None, false, None, 0).unwrap();
        let cards = |now| list(h, &root).map(|c| (c, now)).unwrap();
        let (c, now) = cards(10);
        assert_eq!(claimable(&c, "dev", "ready", now), Some(a.id), "ready skips the qa card");
        assert_eq!(claimable(&c, "qa", "qa", now), Some(q.id));
        assert_eq!(claimable(&c, "lead", "backlog", now), Some(3));
        assert_eq!(claimable(&c, "x", "review", now), None);
        claim(h, &root, "dev", "ready", 10).unwrap();
        let (c, now) = cards(20);
        assert_eq!(claimable(&c, "dev", "ready", now), Some(a.id), "a room gets its own card back");
        assert_eq!(claimable(&c, "dev2", "ready", now), None);
        // a building card quiet for 2 h is free again in ready, as `claim` would reap it
        let (c, now) = cards(10 + CLAIM_SECS);
        assert_eq!(claimable(&c, "dev2", "ready", now), Some(a.id));
        assert_eq!(claim(h, &root, "dev2", "ready", now).unwrap().map(|t| t.id), Some(a.id));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn stale_claims_are_reaped_and_the_third_bounce_blocks() {
        let (d, root) = tmp("reap");
        let h = d.as_path();
        let c = put(h, &root, "card", Some("true"), false, None, 0).unwrap();
        claim(h, &root, "dev", "ready", 100).unwrap().unwrap();
        // within the window nobody else gets it; after it the stranded card is back in ready
        assert_eq!(claim(h, &root, "dev2", "ready", 100 + CLAIM_SECS - 1).unwrap(), None);
        let back = claim(h, &root, "dev2", "ready", 100 + CLAIM_SECS).unwrap().unwrap();
        assert_eq!((back.lane.as_str(), back.claim.unwrap().room.as_str()), ("building", "dev2"));
        assert!(back.notes.iter().any(|n| n.text.contains("dev không báo gì 2 giờ")));
        // note refreshes only the holder's claim
        let t = note(h, &root, c.id, "đang viết test", Some("dev2"), 9_000).unwrap();
        assert_eq!(t.claim.unwrap().at, 9_000);
        assert_eq!(note(h, &root, c.id, "x", Some("dev"), 9_001).unwrap().claim.unwrap().at, 9_000);
        assert!(note(h, &root, c.id, "  ", None, 9_002).is_err());

        let bounce = |n: u64| {
            move_to(h, &root, c.id, "qa", &Move { pr: Some("1"), ..Move::default() }, None, n).unwrap();
            move_to(h, &root, c.id, "ready", &Move { note: Some("[qa] lỗi"), ..Move::default() }, None, n + 1).unwrap()
        };
        assert_eq!(bounce(10_000).lane, "ready");
        move_to(h, &root, c.id, "building", &Move::default(), None, 10_002).unwrap();
        assert_eq!(bounce(10_003).lane, "ready");
        move_to(h, &root, c.id, "building", &Move::default(), None, 10_005).unwrap();
        let b = bounce(10_006);
        assert_eq!((b.lane.as_str(), b.bounces), ("blocked", 3));
        assert!(b.notes.last().unwrap().text.contains("🛡 bị trả lần 3"));
        assert!(lint(&list(h, &root).unwrap(), 10_007).iter().any(|l| l.starts_with(&format!("#{} blocked: ", c.id))));
        assert!(move_to(h, &root, c.id, "ready", &Move::default(), None, 10_008).is_ok(), "lead unblocks");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn repeats_become_notes_and_old_targets_read_as_ready() {
        let (d, root) = tmp("dup");
        let h = d.as_path();
        let (a, dup) = add(h, &root, "Fix login", None, None, false, None, 1).unwrap();
        put(h, &root, "other", None, false, None, 2).unwrap();
        assert!(!dup);
        let (again, dup) = add(h, &root, "fix LOGIN", Some("pnpm t"), Some("bug"), true, Some("qa"), 3).unwrap();
        assert!(dup);
        assert_eq!((again.id, again.check.as_deref(), again.notes[0].text.as_str()), (a.id, Some("pnpm t"), "↺ thêm lại bởi qa"));
        assert_eq!(current(h, &root).unwrap(), (Some(again.clone()), 2), "--now moved it up, no twin");
        // a file from before the board: no lane field → ready
        let f = file(h);
        let old = std::fs::read_to_string(&f).unwrap();
        let mut v: serde_json::Value = serde_json::from_str(&old).unwrap();
        for p in v["projects"].as_object_mut().unwrap().values_mut() {
            for t in p["items"].as_array_mut().unwrap() {
                t.as_object_mut().unwrap().remove("lane");
            }
        }
        std::fs::write(&f, v.to_string()).unwrap();
        assert!(lanes(h, &root).iter().all(|(_, l)| l == "ready"));
        let b = board_json(&list(h, &root).unwrap());
        assert_eq!(b["lanes"][1]["lane"], "ready");
        assert_eq!(b["lanes"][1]["cards"].as_array().unwrap().len(), 2);
        assert_eq!(b["lanes"].as_array().unwrap().len(), LANES.len());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn targets_queue_in_order_and_now_jumps_the_line() {
        let (d, root) = tmp("queue");
        let h = d.as_path();
        assert_eq!(current(h, &root).unwrap(), (None, 0));
        let a = put(
            h,
            &root,
            "  login page\n",
            Some("pnpm test"),
            false,
            None,
            10,
        )
        .unwrap();
        let b = put(h, &root, "docs", None, false, None, 11).unwrap();
        assert_eq!(
            (a.id, b.id, a.text.as_str(), a.check.as_deref()),
            (1, 2, "login page", Some("pnpm test"))
        );
        assert_eq!(current(h, &root).unwrap().0.unwrap().id, 1);
        let c = put(h, &root, "hotfix crash", None, true, Some("qa"), 12).unwrap();
        let (cur, n) = current(h, &root).unwrap();
        let cur = cur.unwrap();
        assert_eq!(
            (cur.id, n, c.id, cur.from.as_deref()),
            (3, 3, 3, Some("qa"))
        );
        assert_eq!(a.from, None);
        // A room in a subfolder of the project sees the same queue.
        assert_eq!(current(h, &root.join("apps/ui")).unwrap().0.unwrap().id, 3);
        // Another project has its own.
        let other = d.join("proj-2");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(current(h, &other).unwrap(), (None, 0));
        assert!(put(h, &root, " \u{200B} ", None, false, None, 13).is_err());
    }

    #[test]
    fn done_needs_evidence_moves_the_team_on_and_keeps_history() {
        let (d, root) = tmp("done");
        let h = d.as_path();
        put(h, &root, "a", None, false, None, 1).unwrap();
        put(h, &root, "b", None, false, None, 2).unwrap();
        assert!(close(h, &root, 1, Some("  "), None, 3).is_err());
        let (done, next) =
            close(h, &root, 1, Some("cargo test: 12 passed"), Some("dev"), 3).unwrap();
        assert_eq!(
            (done.state.as_str(), done.by.as_deref(), next.unwrap().id),
            ("done", Some("dev"), 2)
        );
        assert!(close(h, &root, 1, Some("again"), None, 4)
            .unwrap_err()
            .to_string()
            .contains("đã done"));
        assert!(close(h, &root, 9, None, None, 4).is_err());
        let (dropped, next) = close(h, &root, 2, None, None, 5).unwrap();
        assert_eq!((dropped.state.as_str(), next), ("dropped", None));
        assert_eq!(current(h, &root).unwrap(), (None, 0));
        let all = list(h, &root).unwrap();
        assert_eq!(all.iter().map(|t| t.id).collect::<Vec<_>>(), vec![2, 1]);
        // Ids never repeat after targets close.
        assert_eq!(put(h, &root, "c", None, false, None, 6).unwrap().id, 3);
    }

    #[test]
    fn a_corrupt_file_fails_closed_and_a_stale_lock_is_taken_over() {
        let (d, root) = tmp("lock");
        let h = d.as_path();
        put(h, &root, "a", None, false, None, 1).unwrap();
        let f = file(h);
        let lock = f.with_extension("lock");
        std::fs::write(&lock, "").unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        std::fs::File::options()
            .write(true)
            .open(&lock)
            .unwrap()
            .set_modified(old)
            .unwrap();
        assert_eq!(put(h, &root, "b", None, false, None, 2).unwrap().id, 2);
        assert!(!lock.exists());
        std::fs::write(&f, "{not json").unwrap();
        assert!(put(h, &root, "c", None, false, None, 3)
            .unwrap_err()
            .to_string()
            .contains("hỏng"));
        assert!(current(h, &root).is_err());
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "{not json");
    }

    #[test]
    fn now_prompt_names_the_room_role_check_and_rails() {
        let (d, root) = tmp("prompt");
        let t = put(&d, &root, "fix login", Some("pnpm test"), false, None, 0).unwrap();
        assert_eq!(t.id, 1);
        let t = Target { id: 7, ..t };
        let p = now_prompt(&t, "qa-su-code");
        for want in [
            "đích #7",
            "fix login",
            "`pnpm test` exit 0",
            "qa-su-code",
            "auto done 7 --evidence",
            "Ship vẫn chờ owner",
        ] {
            assert!(p.contains(want), "missing {want}: {p}");
        }
        assert_eq!(json(Some(&t))["id"], 7);
        assert!(json(None).is_null());
    }
}
