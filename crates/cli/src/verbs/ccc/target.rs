//! `8sync ccc auto add|queue|done|drop|reopen` and the board verbs `claim|move|note|board|lint`: the
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
/// WIP limit of the pull system: builder cards waiting in `ready`. At the cap, planning rooms take no
/// new backlog card and backlog → ready is refused, except P0. Measured on ai-game-studio
/// (2026-10-19, 36 h): 23 cards in ready, 1 in building, with two of eight rooms building.
pub(super) const READY_CAP: usize = 8;

/// Open cards waiting for a builder (`ready`, not the qa lane's).
pub(super) fn ready_count(cards: &[Target]) -> usize {
    cards.iter().filter(|t| t.state == "open" && t.lane == "ready" && t.label.as_deref() != Some("qa")).count()
}

/// A free card `lane` may take while `ready` holds `ready` cards: a full ready stops new backlog work.
fn open_to(t: &Target, lane: &str, ready: usize) -> bool {
    lane != "backlog" || ready < READY_CAP || t.prio == Some(0)
}

/// Low-water mark of `ready`: below it a backlog room that finds no free card gets back an idea
/// still split into open cards, to split its next batch now. 3d-game 2026-10-20: dev sat at "Chờ
/// card" with ready 0 while ideas #10 and #1 waited on their open pieces; owner: "song song liên tục".
pub(super) const READY_LOW: usize = 6;
/// The same idea comes back for a refill at most this often: a lead with nothing left to split is
/// not woken every `auto wait` tick.
const REFILL_RETRY: u64 = 900;

/// Idea `t`, split into open cards (`split`), is due a refill while `ready` holds `ready` cards.
fn refillable(t: &Target, split: &[u64], ready: usize, now: u64) -> bool {
    ready < READY_LOW && t.state == "open" && t.lane == "backlog" && split.contains(&t.id) && now.saturating_sub(touched(t).max(t.refill_at.unwrap_or(0))) >= REFILL_RETRY
}

/// Open lanes in board order; `done`/`dropped` live in `state`.
pub(super) const LANES: [&str; 7] = ["backlog", "ready", "building", "qa", "review", "approved", "blocked"];
/// `arch`: needs a design first; the lead moves it to ready only once a note starts with "ADR:".
pub(super) const LABELS: [&str; 4] = ["bug", "feature", "qa", "arch"];

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
            | ("blocked", "ready" | "backlog" | "qa" | "review")
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
    /// Priority 0..=3 (P0 most urgent); none counts as P2. Claims take the most urgent free card
    /// first, queue order within a priority.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prio: Option<u8>,
    /// Who builds it (`dev`, `ui`, `rd+game-designer`), set by `--role`; none = the role tag the
    /// title starts with ([`roles`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// When an idea still split into open cards was last handed back for a refill ([`refillable`]);
    /// its own field so the idea's last note on the board stays the real one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refill_at: Option<u64>,
}

fn is_zero(n: &u32) -> bool {
    *n == 0
}

/// The priority a card is claimed by: its own, or P2.
fn rank(t: &Target) -> u8 {
    t.prio.unwrap_or(2)
}

/// The roles a card is for: its `--role`, else the first role tag in the `[…]` run its title
/// starts with (`[#125][ui] …` → ui, `[rd+game-designer]` → rd and game-designer). Empty =
/// untagged: any builder takes it. Measured on ai-game-studio (2026-10-19, 71 min): 10 of 33
/// returns were dev/dev2/ui handing back each other's `[ui]`/`[rd]`/`[game-designer]` cards.
pub(super) fn roles(t: &Target) -> Vec<String> {
    if let Some(r) = &t.role {
        return r.split('+').map(str::to_string).collect();
    }
    let mut rest = t.text.trim_start();
    while let Some(body) = rest.strip_prefix('[') {
        let Some(end) = body.find(']') else { break };
        let found: Vec<String> = body[..end].split(['+', '/', ',']).filter_map(super::room::card_role).collect();
        if !found.is_empty() {
            return found;
        }
        rest = body[end + 1..].trim_start();
    }
    Vec::new()
}

/// The card this one was split off: the first `[#N]` tag of the `[…]` run its title starts with
/// (`[#10] player …`, `[#125][ui] …`, `[ui][#1 v2] …`). Leads split an owner's idea this way.
pub(super) fn parent(t: &Target) -> Option<u64> {
    let mut rest = t.text.trim_start();
    while let Some(body) = rest.strip_prefix('[') {
        let end = body.find(']')?;
        let digits: String = body[..end].trim().strip_prefix('#').unwrap_or("").chars().take_while(char::is_ascii_digit).collect();
        if let Ok(id) = digits.parse::<u64>() {
            return (id != t.id).then_some(id);
        }
        rest = body[end + 1..].trim_start();
    }
    None
}

/// Cards with an open card split off them: their work runs in those cards, so no room claims them
/// and they never wait in `blocked`.
fn split_ids(cards: &[Target]) -> Vec<u64> {
    cards.iter().filter(|t| t.state == "open").filter_map(parent).collect()
}

/// A blocked card is the backlog rooms' (lead, ba) to clear: `claim` hands it to them before new
/// backlog work, then again every [`BLOCKED_RETRY`] while it really waits on the owner (Ship,
/// secret, money). Owner 2026-10-20 ("ý kiến tôi cứ bị block"): his ideas sat in Blocked as
/// "epic", a card waited on a closed PR, another on "owner cấp ảnh", while the lead slept in `auto wait`.
pub(super) const BLOCKED_RETRY: u64 = 3600;

fn unblockable(t: &Target, now: u64) -> bool {
    t.state == "open" && t.lane == "blocked" && t.claim.as_ref().is_none_or(|c| now.saturating_sub(c.at) >= BLOCKED_RETRY)
}

/// When a card last changed: the one blocked longest is cleared first.
fn touched(t: &Target) -> u64 {
    t.notes.last().map_or(t.added, |n| n.at)
}

const UNBLOCK: &str = "card #<id> blocked: gỡ NGAY lượt này, không để chờ. Lý do đã hết (PR được chờ MERGED/CLOSED theo `gh pr view <số> --json state`, PR chồng trên nhánh cũ) → `gh pr edit <số> --base main`, `git merge origin/main` vào nhánh, push thường (không rebase/force-push), `8sync ccc auto move <id> ready --note \"…\"`; thiếu quyết định hay tài nguyên → tự quyết theo su-code/DECISIONS.md + mục tiêu dự án hoặc tìm cách thay, note rồi `move <id> ready`; ý lớn đã tách card con → `move <id> backlog`. Chỉ Ship, secret, tiền mới hỏi owner (AskUserQuestion), rồi `8sync ccc auto note <id> \"chờ owner: …\"` và làm việc khác.";

/// What a backlog room does with the card `claim` gave it when the lane alone does not say: a
/// blocked card to clear now, or an idea whose split-off cards all closed, to accept or split again.
pub(super) fn claim_hint(t: &Target, cards: &[Target]) -> Option<String> {
    if t.lane == "blocked" {
        return Some(UNBLOCK.replace("<id>", &t.id.to_string()));
    }
    let kids: Vec<&Target> = cards.iter().filter(|c| parent(c) == Some(t.id)).collect();
    let ids = |open: bool| kids.iter().filter(|c| (c.state == "open") == open).map(|c| format!("#{}", c.id)).collect::<Vec<_>>().join(" ");
    if t.lane != "backlog" || kids.is_empty() {
        return None;
    }
    let open = ids(true);
    Some(if open.is_empty() {
        format!(
            "card con {} đã đóng: nghiệm thu ý gốc trên main (chạy thật, ảnh): đạt → `8sync ccc auto done {id} --evidence \"<lệnh: kết quả>\"`; chưa → tách đợt kế `8sync ccc auto add \"[#{id}] …\"`, card gốc ở lại backlog",
            ids(false),
            id = t.id
        )
    } else {
        format!(
            "ready còn {ready}/{READY_CAP} card, builder đang chờ: tách NGAY đợt kế của ý #{id} — 2–4 card nhỏ làm song song được (khác file/thư mục, không trùng card con đang mở {open}), mỗi card có AC + check: `8sync ccc auto add \"[#{id}] …\" --check \"<lệnh>\"`. Ý đã đủ card → R&D đề xuất hướng mở rộng mới cho dự án (`8sync ccc auto add \"<ý tưởng>\"`, không check, vào backlog) rồi tách nó; card gốc ở lại backlog",
            ready = ready_count(cards),
            id = t.id
        )
    })
}

/// `--role <vai>`: one role or several joined by `+`, each a room role (`backend` → dev) or a
/// hyphenated one no room has (`game-designer`).
pub(super) fn parse_role(s: &str) -> Result<String> {
    let parts = s
        .split('+')
        .map(|r| super::room::card_role(r).ok_or_else(|| anyhow::anyhow!("--role `{}` không phải vai: dev, ui, qa, review, rd, arch, ba, lead… (nhiều vai nối bằng +, vai không có phòng viết có gạch nối như game-designer)", r.trim())))
        .collect::<Result<Vec<_>>>()?;
    Ok(parts.join("+"))
}

/// `P0`..`P3` (or `0`..`3`); `none`/`-` clears it.
pub(super) fn parse_prio(s: &str) -> Result<Option<u8>> {
    let v = s.trim().to_ascii_lowercase();
    if v == "none" || v == "-" {
        return Ok(None);
    }
    match v.strip_prefix('p').unwrap_or(&v).parse::<u8>() {
        Ok(n) if n <= 3 => Ok(Some(n)),
        _ => bail!("--prio: P0 (gấp nhất) | P1 | P2 | P3 | none"),
    }
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

/// Lines kept, hidden characters dropped, secrets masked, at most `max` chars (also `ccc msg`).
pub(super) fn clean(s: &str, max: usize) -> String {
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
    // A board above the repo `root` sits in is another project's: a nested repo with no card yet
    // must not file under its parent's board.
    let own = crate::verbs::here::repo_of(root).map(|g| super::auto::canon(&g));
    let root = super::auto::canon(root);
    book.projects
        .keys()
        .filter(|k| root.starts_with(Path::new(k.as_str())) && own.as_ref().is_none_or(|g| Path::new(k.as_str()).starts_with(g)))
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

/// The project the cards of `root` are filed under (a worktree or subfolder shares its repo's).
/// `auto board --json` prints it so HQ shows one board per project, nested repos included.
pub(super) fn filed_under(home: &Path, root: &Path) -> Result<String> {
    Ok(key(&read(home)?, root))
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
        // A card a room splits off waits in backlog while ready is full; the owner's go straight in.
        let to_ready = check.is_some() && (from.is_none() || ready_count(&p.items) < READY_CAP);
        let t = Target {
            id: p.next_id,
            text,
            lane: if to_ready { "ready" } else { "backlog" }.into(),
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
            prio: None,
            role: None,
            refill_at: None,
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
    if let Some(e) = evidence.as_deref().filter(|e| !proves(e)) {
        bail!("--evidence \"{e}\" không có kết quả kiểm: ghi `<lệnh>: <kết quả>` (vd `cargo test: 12 passed`) hoặc SHA commit đã merge");
    }
    let res = edit(home, root, |p| {
        let Some(t) = p.items.iter_mut().find(|t| t.id == id) else {
            bail!("không có đích #{id} trong dự án này (`8sync ccc auto queue`)");
        };
        if t.state != "open" {
            bail!("đích #{id} đã {}", t.state);
        }
        // In a board team an owner idea (no `from`) is accepted by the backlog rooms that split it,
        // not by a lane room working one piece: dev2 closed owner cards #7 and #8 on 3d-game
        // (2026-10-20). Without a team every room works the owner's target and closes it.
        if t.from.is_none() && by.and_then(super::room::find).and_then(|r| r.lane).is_some_and(|l| l != "backlog") && super::auto::board_team(home, root) {
            bail!("card #{id} là ý owner: chỉ lead/ba nghiệm thu hoặc bỏ — `8sync ccc auto note {id} \"…\"` kết quả của bạn rồi để lead quyết");
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
    });
    if res.is_ok() {
        prune_card_worktree(root, id);
    }
    res
}

/// Best-effort cleanup of clean `.claude/worktrees/*card-<id>*` folders when card `<id>` closes,
/// so finished worktrees do not pile up or clutter HQ Preview. Dirty worktrees are kept.
fn prune_card_worktree(root: &Path, id: u64) {
    let wt_dir = root.join(".claude").join("worktrees");
    let Ok(rd) = std::fs::read_dir(&wt_dir) else { return };
    let needle = format!("card-{id}");
    for e in rd.flatten() {
        let name = e.file_name();
        let Some(s) = name.to_str() else { continue };
        let low = s.to_ascii_lowercase();
        let matches = low.find(&needle).is_some_and(|i| !low[i + needle.len()..].starts_with(|c: char| c.is_ascii_digit()));
        let p = e.path();
        if matches && p.join(".git").exists() {
            let _ = std::process::Command::new("git")
                .args(["worktree", "remove"])
                .arg(&p)
                .current_dir(root)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    }
}

/// Pure: does a `done` evidence line carry a result: a commit SHA (7–40 hex chars) or the
/// `<lệnh>: <kết quả>` shape? A probing `done 129 --evidence "chưa"` closed a card on
/// ai-game-studio (2026-10-19) that then had to be re-made.
fn proves(e: &str) -> bool {
    let sha = e.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| (7..=40).contains(&w.len()) && w.chars().all(|c| c.is_ascii_hexdigit()));
    sha || e.split_once(':').is_some_and(|(cmd, out)| !cmd.trim().is_empty() && !out.trim().is_empty())
}

/// `auto reopen <id> [--note "…"]`: a card closed by mistake (done or dropped) opens again in the
/// lane it closed from (`building` → ready, nobody holds it; `approved` without a SHA → review;
/// `ready` without a check → backlog), history kept, with a note of who reopened it and what the
/// close said. Only the last [`CLOSED_KEEP`] closed cards are kept.
pub(super) fn reopen(home: &Path, root: &Path, id: u64, why: Option<&str>, room: Option<&str>, now: u64) -> Result<Target> {
    edit(home, root, |p| {
        let Some(i) = p.items.iter().position(|t| t.id == id) else {
            bail!("không có card #{id} trong dự án này (chỉ {CLOSED_KEEP} card đóng gần nhất còn giữ)");
        };
        if p.items[i].state == "open" {
            bail!("card #{id} đang mở ở {}: không cần mở lại", p.items[i].lane);
        }
        if p.items.iter().filter(|t| t.state == "open").count() >= OPEN_MAX {
            bail!("hàng đã có {OPEN_MAX} đích mở: `auto done`/`auto drop` bớt trước");
        }
        let mut t = p.items.remove(i);
        let mut was = format!("đã {}", t.state);
        if let Some(b) = &t.by {
            was.push_str(&format!(" bởi {b}"));
        }
        if let Some(e) = &t.evidence {
            was.push_str(&format!(": {e}"));
        }
        let lane = match t.lane.as_str() {
            "approved" if t.sha.is_none() => "review",
            "building" => "ready",
            l if LANES.contains(&l) => l,
            _ => "ready",
        };
        t.lane = if lane == "ready" && t.check.is_none() { "backlog" } else { lane }.to_string();
        t.state = "open".into();
        (t.closed, t.evidence, t.by, t.claim) = (None, None, None, None);
        let mut line = format!("↺ mở lại bởi {} ({was}) → {}", room.unwrap_or("owner"), t.lane);
        if let Some(n) = why.filter(|n| !n.trim().is_empty()) {
            line.push_str(&format!(": {n}"));
        }
        t.note(room, &line, now);
        // Behind the open cards, ahead of the closed ones.
        let at = p.items.iter().position(|t| t.state != "open").unwrap_or(p.items.len());
        p.items.insert(at, t.clone());
        Ok(t)
    })
}

/// Drop stale claims; a stranded `building` card goes back to `ready` (super-board's reclaim). An
/// idea split into open cards waits for them in `backlog`, held by nobody, never in `blocked`.
fn reap(p: &mut Project, now: u64) {
    let split = split_ids(&p.items);
    for t in p.items.iter_mut().filter(|t| t.state == "open") {
        if split.contains(&t.id) && matches!(t.lane.as_str(), "backlog" | "blocked") {
            t.claim = None;
            if t.lane == "blocked" {
                t.lane = "backlog".into();
                t.note(None, "blocked → backlog: đang làm qua card con, không chờ ở blocked; lead nghiệm thu khi card con đóng", now);
            }
            continue;
        }
        let Some(c) = t.claim.clone().filter(|c| now.saturating_sub(c.at) >= CLAIM_SECS) else { continue };
        t.claim = None;
        if t.lane == "building" {
            t.lane = "ready".into();
            t.note(None, &format!("↩ {} không báo gì {} giờ: trả về ready", c.room, CLAIM_SECS / 3600), now);
        }
    }
}

/// Does free card `t` belong to `lane`'s rooms of role `crew` ([`super::room::crew`])? `qa` also
/// takes `ready` cards labelled or tagged `qa`, which `ready` skips; `ready` gives a room only cards
/// of its role or untagged ones (a dev room never gets `[ui]`, `[rd]` or `[game-designer]`), so a
/// card whose role has no room is never handed out ([`unstaffed`] tells the lead). Triage and
/// review lanes take every role. A `building` card whose claim went stale or was cleared counts as
/// `ready` (claim reaps it).
fn fits(t: &Target, lane: &str, crew: &str, now: u64) -> bool {
    let stale = t.claim.is_none() || t.claim.as_ref().is_some_and(|c| now.saturating_sub(c.at) >= CLAIM_SECS);
    let at = if t.lane == "building" && stale { "ready" } else { t.lane.as_str() };
    let roles = roles(t);
    let for_qa = t.label.as_deref() == Some("qa") || roles.iter().any(|r| r == "qa");
    match lane {
        "qa" => at == "qa" || (at == "ready" && for_qa),
        "ready" => at == "ready" && !for_qa && (roles.is_empty() || roles.iter().any(|r| r == crew)),
        l => at == l,
    }
}

/// Read-only twin of [`claim`]'s pick: the card `room` would get from `lane` now. `auto wait` polls it.
pub(super) fn claimable(cards: &[Target], room: &str, lane: &str, now: u64) -> Option<u64> {
    // the room holding a live (not stale) claim on `t`
    fn holder(t: &Target, now: u64) -> Option<&str> {
        t.claim.as_ref().filter(|c| now.saturating_sub(c.at) < CLAIM_SECS).map(|c| c.room.as_str())
    }
    let crew = super::room::crew(room);
    let split = split_ids(cards);
    let open = cards.iter().filter(|t| t.state == "open" && !(split.contains(&t.id) && lane == "backlog"));
    let ready = ready_count(cards);
    open.clone()
        .find(|t| holder(t, now) == Some(room) && (t.lane != "blocked" || lane == "blocked"))
        .or_else(|| (lane == "backlog").then(|| open.clone().enumerate().filter(|(_, t)| unblockable(t, now)).min_by_key(|(i, t)| (touched(t), *i)).map(|(_, t)| t)).flatten())
        .or_else(|| open.clone().enumerate().filter(|(_, t)| holder(t, now).is_none() && fits(t, lane, &crew, now) && open_to(t, lane, ready)).min_by_key(|(i, t)| (rank(t), *i)).map(|(_, t)| t))
        .or_else(|| (lane == "backlog").then(|| cards.iter().enumerate().filter(|(_, t)| refillable(t, &split, ready, now)).min_by_key(|(i, t)| (rank(t), *i)).map(|(_, t)| t)).flatten())
        .map(|t| t.id)
}

/// `auto claim`: the card room `room` works on this tick. A card it already holds comes back (claim
/// refreshed); else the first free card of `lane` for the room's role in queue order. Taking a
/// `ready` card moves it to `building`; the `qa` lane also takes `ready` cards labelled `qa`, the
/// `ready` lane skips them. The `backlog` lane first takes the card blocked longest
/// ([`unblockable`]; it stays in `blocked` until the room moves it), and never an idea still split
/// into open cards, unless ready ran low ([`READY_LOW`]): then such an idea comes back, at most every
/// [`REFILL_RETRY`], for its next batch.
pub(super) fn claim(home: &Path, root: &Path, room: &str, lane: &str, now: u64) -> Result<Option<Target>> {
    if !LANES.contains(&lane) || matches!(lane, "building" | "approved") {
        bail!("cột `{lane}` không nhận claim: backlog, ready, qa, review, blocked");
    }
    let crew = super::room::crew(room);
    edit(home, root, |p| {
        reap(p, now);
        // A blocked card it took last time is not held over: one it cannot clear must not pin the room.
        let mine = p.items.iter().position(|t| t.state == "open" && t.claim.as_ref().is_some_and(|c| c.room == room) && (t.lane != "blocked" || lane == "blocked"));
        let blocked = || (lane == "backlog").then(|| p.items.iter().enumerate().filter(|(_, t)| unblockable(t, now)).min_by_key(|(i, t)| (touched(t), *i)).map(|(i, _)| i)).flatten();
        let ready = ready_count(&p.items);
        let split = split_ids(&p.items);
        let free = |t: &Target| t.state == "open" && t.claim.is_none() && !(split.contains(&t.id) && lane == "backlog") && fits(t, lane, &crew, now) && open_to(t, lane, ready);
        // The most urgent free card, queue order within a priority.
        let first_free = || p.items.iter().enumerate().filter(|(_, t)| free(t)).min_by_key(|(i, t)| (rank(t), *i)).map(|(i, _)| i);
        let refill = || (lane == "backlog").then(|| p.items.iter().enumerate().filter(|(_, t)| refillable(t, &split, ready, now)).min_by_key(|(i, t)| (rank(t), *i)).map(|(i, _)| i)).flatten();
        let Some(i) = mine.or_else(blocked).or_else(first_free).or_else(refill) else { return Ok(None) };
        let t = &mut p.items[i];
        if refillable(t, &split, ready, now) {
            // not handed back again for REFILL_RETRY
            t.refill_at = Some(now);
        }
        if t.claim.is_none() && matches!(t.lane.as_str(), "ready" | "building") {
            let to = if lane == "qa" { "qa" } else { "building" };
            if t.lane != to {
                t.note(Some(room), &format!("{} → {to}", t.lane), now);
                t.lane = to.into();
            }
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

/// `gh pr view <pr> --json baseRefName,mergeable,headRefOid,state` run in `root`, killed after
/// 20 s: its stdout, or a refusal when gh failed (not installed, not logged in, offline, hung).
fn gh_pr_view(root: &Path, pr: &str) -> Result<String> {
    let mut cmd = std::process::Command::new("gh");
    cmd.args(["pr", "view", pr, "--json", "baseRefName,mergeable,headRefOid,state"])
        .current_dir(root)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    let out = crate::verbs::hq_core::agents::run_bounded(cmd, std::time::Duration::from_secs(20))
        .ok_or_else(|| anyhow::anyhow!("`gh pr view {pr}` lỗi hoặc quá 20 s (cài GitHub CLI, `gh auth login`, kiểm mạng)"))?;
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// How a branch catches up with main. Rebasing needs a force-push, which the guard blocks, so
/// builders opened a new PR each time: 10 replacement PRs for 18 merges on 3d-game (2026-10-20),
/// every named conflict in CHANGELOG.md.
pub(super) const KEEP_PR: &str = "push thường (không rebase, không force-push: PR giữ nguyên số)";

/// Pure: why PR `pr` (gh's JSON `view`) may not move on: not open, stacked on a branch other than
/// the repo's default branch `main` ([`super::merge::default_branch`], the only base `auto merge`
/// takes), conflicting, or, given the reviewed `sha` (for `approved`), at another head. Measured on
/// ai-game-studio (2026-10-19): 25 of 59 open PRs conflicting, 14 on a non-main base.
fn pr_gate(pr: &str, view: &str, sha: Option<&str>, main: &str) -> Result<()> {
    let v: serde_json::Value = serde_json::from_str(view).ok().filter(serde_json::Value::is_object).ok_or_else(|| anyhow::anyhow!("gh trả về dữ liệu lạ cho PR {pr}: không chuyển card khi chưa kiểm được PR"))?;
    let field = |k: &str| v[k].as_str().unwrap_or("").to_string();
    let (base, state) = (field("baseRefName"), field("state"));
    if !state.is_empty() && state != "OPEN" {
        bail!("PR {pr} đã {state}: mở PR mới vào {main} cho card rồi chuyển lại");
    }
    if base.is_empty() {
        bail!("gh không trả base của PR {pr}: không chuyển card khi chưa kiểm được PR");
    }
    if base != main {
        let n = pr.trim_start_matches('#');
        bail!("PR {pr} xếp chồng trên {base}: `gh pr edit {n} --base {main}`, `git merge origin/{main}` vào nhánh, {KEEP_PR} rồi chuyển lại");
    }
    match field("mergeable").as_str() {
        "CONFLICTING" => bail!("PR {pr} conflict với {base}: `git merge origin/{base}` vào nhánh, sửa conflict (CHANGELOG.md: giữ cả hai mục và chuyển mục của card sang `changelog.d/card-<id>.md`), chạy lại check, {KEEP_PR} rồi chuyển lại"),
        "MERGEABLE" => {}
        // Right after a push GitHub answers UNKNOWN for a while: not a conflict, no bounce.
        _ => bail!("{}", super::merge::computing(pr)),
    }
    if let Some(s) = sha {
        let head = field("headRefOid");
        if !head.to_ascii_lowercase().starts_with(&s.to_ascii_lowercase()) {
            let short: String = head.chars().take(12).collect();
            bail!("PR {pr} đang ở head {short}, không phải --sha {s}: review đúng head mới rồi duyệt lại");
        }
    }
    Ok(())
}

/// `auto move <id> <lane>`: a checked transition that releases the claim (the next lane's room
/// takes it). `ready` needs a check; `approved` needs the reviewed head SHA; the bounce back to
/// `ready` past [`REBUILD_CAP`] lands in `blocked` instead. Into `qa` or `approved`, the card's PR
/// must be open, based on the default branch and not conflicting (and at the approved SHA), as
/// `gh` reports it. Out of `blocked` the bounce count stays; `blocked → review` only for a card
/// that already passed QA ([`passed_qa`]).
pub(super) fn move_to(home: &Path, root: &Path, id: u64, to: &str, m: &Move, room: Option<&str>, now: u64) -> Result<Target> {
    move_with(home, root, id, to, m, room, now, &gh_pr_view, &super::merge::default_branch)
}

/// Did the card pass QA at `head` (its PR head, else its `sha`): a `gate <sha>` note whose SHA
/// (≥ 7 hex) is a prefix of that head. A pass at an older head, or no known head, does not count.
fn passed_qa(t: &Target, head: Option<&str>) -> bool {
    let Some(head) = head.map(str::to_ascii_lowercase).filter(|h| h.len() >= 7) else { return false };
    t.notes.iter().filter_map(|n| n.text.strip_prefix("gate ")).any(|rest| {
        let s: String = rest.chars().take_while(char::is_ascii_hexdigit).collect::<String>().to_ascii_lowercase();
        s.len() >= 7 && (head.starts_with(&s) || s.starts_with(&head))
    })
}

/// How many times, and how far apart, a PR whose `mergeable` is still `UNKNOWN` is read again.
/// ai-game-studio 2026-10-20: a move refused right after a push passed 45 s later.
const UNKNOWN_REREADS: usize = 3;
const UNKNOWN_PAUSE: std::time::Duration = std::time::Duration::from_secs(if cfg!(test) { 0 } else { 3 });

/// Is gh's `view` an open PR whose `mergeable` GitHub has not computed yet?
fn still_computing(view: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(view).is_ok_and(|v| v["state"].as_str().is_none_or(|s| s == "OPEN") && v["mergeable"].as_str() == Some("UNKNOWN"))
}

/// [`move_to`] with `gh pr view` (`(root, pr) → JSON`) and the default branch (`root → name`) injected.
#[allow(clippy::too_many_arguments)]
fn move_with(home: &Path, root: &Path, id: u64, to: &str, m: &Move, room: Option<&str>, now: u64, gh: &dyn Fn(&Path, &str) -> Result<String>, main: &dyn Fn(&Path) -> Option<String>) -> Result<Target> {
    if !LANES.contains(&to) {
        bail!("cột `{to}` không có: {} (xong → `auto done <id> --evidence`)", LANES.join(", "));
    }
    let sha = m.sha.map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = sha.filter(|s| !(7..=40).contains(&s.len()) || !s.chars().all(|c| c.is_ascii_hexdigit())) {
        bail!("--sha `{s}` không phải commit SHA");
    }
    // The PR checks run before the lock: gh takes seconds, the lock is held for milliseconds.
    let card = list(home, root)?.into_iter().find(|t| t.id == id && t.state == "open").filter(|t| allowed(&t.lane, to));
    let unblock = to == "review" && card.as_ref().is_some_and(|t| t.lane == "blocked");
    // blocked → review: the head QA's `gate <sha>` must match (the PR's, else the card's sha).
    let mut head = None;
    if matches!(to, "qa" | "approved") || unblock {
        if to == "approved" && sha.is_none() {
            bail!("approved cần --sha <head commit đã review>");
        }
        if let Some(pr) = card.as_ref().and_then(|t| m.pr.map(|x| clean(x, 200)).filter(|x| !x.is_empty()).or(t.pr.clone())) {
            let arg = pr.trim_start_matches('#');
            if arg.is_empty() || arg.starts_with('-') {
                bail!("--pr `{pr}` không phải số hay URL của PR");
            }
            let name = if arg.chars().all(|c| c.is_ascii_digit()) { format!("#{arg}") } else { arg.to_string() };
            let mut view = gh(root, arg).map_err(|e| anyhow::anyhow!("không đọc được PR {name} bằng gh ({e:#}): kiểm `gh auth status` và mạng rồi chạy lại; card #{id} giữ nguyên cột"))?;
            for _ in 0..UNKNOWN_REREADS {
                if unblock || !still_computing(&view) {
                    break;
                }
                std::thread::sleep(UNKNOWN_PAUSE);
                match gh(root, arg) {
                    Ok(v) => view = v,
                    Err(_) => break,
                }
            }
            if unblock {
                head = serde_json::from_str::<serde_json::Value>(&view).ok().and_then(|v| v["headRefOid"].as_str().map(str::to_string));
            } else {
                let base = main(root).ok_or_else(|| anyhow::anyhow!("{}", super::merge::NO_DEFAULT))?;
                pr_gate(&name, &view, if to == "approved" { sha } else { None }, &base)?;
            }
        }
    }
    if unblock && head.is_none() {
        head = card.as_ref().and_then(|t| t.sha.clone());
    }
    edit(home, root, |p| {
        let ready = ready_count(&p.items);
        let kids: Vec<String> = p.items.iter().filter(|c| c.state == "open" && parent(c) == Some(id)).map(|c| format!("#{}", c.id)).collect();
        let Some(t) = p.items.iter_mut().find(|t| t.id == id && t.state == "open") else {
            bail!("không có card mở #{id} (`8sync ccc auto board`)");
        };
        if !allowed(&t.lane, to) {
            bail!("card #{id} đang ở {}: không chuyển thẳng sang {to}", t.lane);
        }
        if t.lane == "blocked" && to == "review" && !passed_qa(t, head.as_deref()) {
            bail!("card #{id} chưa qua QA ở head hiện tại (không có note `gate <sha>` khớp head PR): blocked → qa hoặc ready, không thẳng review");
        }
        if t.lane == "backlog" && to == "blocked" && !kids.is_empty() {
            bail!("card #{id} đang làm qua card con {}: để ở backlog (không phòng nào claim nó tới khi card con đóng, rồi lead nghiệm thu), không blocked", kids.join(" "));
        }
        if t.lane == "backlog" && to == "ready" && ready >= READY_CAP && t.prio != Some(0) {
            bail!("cột ready đầy ({ready}/{READY_CAP} card chờ dev): #{id} ở lại backlog, không tách thêm việc tới khi dev rút bớt (card P0 vẫn qua)");
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
        t.claim = if to == "building" {
            room.map(|r| Claim { room: r.to_string(), at: now })
        } else {
            None
        };
        Ok(t.clone())
    })
}

/// `auto prio <id> P0..P3|none` (also `--prio` on add/move): set how urgent an open card is.
pub(super) fn set_prio(home: &Path, root: &Path, id: u64, prio: Option<u8>, room: Option<&str>, now: u64) -> Result<Target> {
    edit(home, root, |p| {
        let Some(t) = p.items.iter_mut().find(|t| t.id == id && t.state == "open") else {
            bail!("không có card mở #{id} (`8sync ccc auto board`)");
        };
        if t.prio != prio {
            t.prio = prio;
            t.note(room, &prio.map_or_else(|| "bỏ mức ưu tiên".to_string(), |n| format!("ưu tiên P{n}")), now);
        }
        Ok(t.clone())
    })
}

/// `--role <vai>` on add/move ([`parse_role`] first): who builds the card, over its title tag.
pub(super) fn set_role(home: &Path, root: &Path, id: u64, role: &str, room: Option<&str>, now: u64) -> Result<Target> {
    edit(home, root, |p| {
        let Some(t) = p.items.iter_mut().find(|t| t.id == id && t.state == "open") else {
            bail!("không có card mở #{id} (`8sync ccc auto board`)");
        };
        if t.role.as_deref() != Some(role) {
            t.role = Some(role.to_string());
            t.note(room, &format!("vai {role}"), now);
        }
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

/// `auto lint`: open cards not yet past building whose role has no room in `team` (the project's
/// room names), so no claim hands them out. In `ready`/`building` only a room that claims the lane
/// counts (a builder, or qa for a `[qa]` card): an `[rd]`, `[arch]`, `[review]`, `[ba]` or
/// `[lead]` card there waits on a room that never takes ready cards. An empty team (unknown) says
/// nothing.
pub(super) fn unstaffed(cards: &[Target], team: &[String]) -> Vec<String> {
    if team.is_empty() {
        return Vec::new();
    }
    let crews: Vec<String> = team.iter().map(|r| super::room::crew(r)).collect();
    let builders: Vec<String> = team.iter().filter(|r| super::room::builds(r)).map(|r| super::room::crew(r)).collect();
    cards
        .iter()
        .filter(|t| t.state == "open" && matches!(t.lane.as_str(), "backlog" | "ready" | "building" | "blocked"))
        .filter_map(|t| {
            let r = roles(t);
            if r.is_empty() {
                return None;
            }
            if !r.iter().any(|x| crews.contains(x)) {
                return Some(format!("card #{} vai [{}] không có phòng: giao lại vai hoặc thêm phòng", t.id, r.join("+")));
            }
            let claimed = |x: &String| builders.contains(x) || (x == "qa" && crews.contains(x));
            (matches!(t.lane.as_str(), "ready" | "building") && !r.iter().any(claimed))
                .then(|| format!("card #{} vai [{}] ở {} mà phòng vai đó không nhận cột ready: giao vai builder (`--role dev`) hoặc đưa về backlog", t.id, r.join("+"), t.lane))
        })
        .collect()
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
        "8sync auto --now: việc làm NGAY cho cả dự án (đích #{id}, đứng đầu hàng):\n{text}\n{check}\
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

    /// gh's answer for an open PR on main, mergeable, at head `0123abc…`.
    const PR_OK: &str = r#"{"baseRefName":"main","mergeable":"MERGEABLE","headRefOid":"0123abcdef0123abcdef0123abcdef0123abcd","state":"OPEN"}"#;

    /// The real `move_to` with `gh` answering [`PR_OK`]: these tests never touch the network.
    fn move_to(h: &Path, root: &Path, id: u64, to: &str, m: &Move, room: Option<&str>, now: u64) -> Result<Target> {
        move_with(h, root, id, to, m, room, now, &|_, _| Ok(PR_OK.to_string()), &on_main)
    }

    /// A repo whose default branch is `main`.
    fn on_main(_: &Path) -> Option<String> {
        Some("main".into())
    }

    #[test]
    fn qa_and_approved_refuse_a_stacked_conflicting_or_moved_pr() {
        // ai-game-studio 2026-10-19: 25 of 59 open PRs conflicting, 14 on a non-main base.
        let (d, root) = tmp("prgate");
        let h = d.as_path();
        let c = put(h, &root, "fix", Some("true"), false, None, 0).unwrap();
        claim(h, &root, "dev", "ready", 1).unwrap();
        let asked = std::cell::RefCell::new(Vec::new());
        let pr = |json: &'static str| {
            let asked = &asked;
            move |_: &Path, n: &str| -> Result<String> {
                asked.borrow_mut().push(n.to_string());
                Ok(json.to_string())
            }
        };
        let qa = Move { pr: Some("#81"), ..Move::default() };
        let err = |to: &str, m: &Move, gh: &dyn Fn(&Path, &str) -> Result<String>| move_with(h, &root, c.id, to, m, Some("dev"), 2, gh, &on_main).unwrap_err().to_string();
        let stacked = r#"{"baseRefName":"card-x","mergeable":"MERGEABLE","headRefOid":"0123abc","state":"OPEN"}"#;
        let e = err("qa", &qa, &pr(stacked));
        assert!(e.starts_with("PR #81 xếp chồng trên card-x") && e.contains("`gh pr edit 81 --base main`") && e.contains("`git merge origin/main`") && !e.contains("rebase lên"), "{e}");
        assert_eq!(asked.borrow().as_slice(), ["81"], "gh gets the bare number");
        let conflict = r#"{"baseRefName":"main","mergeable":"CONFLICTING","headRefOid":"0123abc","state":"OPEN"}"#;
        let e = err("qa", &qa, &pr(conflict));
        assert!(e.starts_with("PR #81 conflict với main") && e.contains("`git merge origin/main`") && e.contains("không force-push"), "{e}");
        // UNKNOWN right after a push: read 3 more times, then "đang tính", not "conflict"
        let unknown = r#"{"baseRefName":"main","mergeable":"UNKNOWN","headRefOid":"0123abc","state":"OPEN"}"#;
        let n = asked.borrow().len();
        assert_eq!(err("qa", &qa, &pr(unknown)), "GitHub đang tính mergeable của PR #81: thử lại sau 1 phút");
        assert_eq!(asked.borrow().len() - n, 4, "the first read and 3 re-reads");
        let merged = r#"{"baseRefName":"main","mergeable":"UNKNOWN","headRefOid":"0123abc","state":"MERGED"}"#;
        assert!(err("qa", &qa, &pr(merged)).starts_with("PR #81 đã MERGED"));
        // gh itself failing (offline, logged out) refuses instead of letting the card through
        let e = err("qa", &qa, &|_, _| anyhow::bail!("error connecting to api.github.com"));
        assert_eq!(e, "không đọc được PR #81 bằng gh (error connecting to api.github.com): kiểm `gh auth status` và mạng rồi chạy lại; card #1 giữ nguyên cột");
        assert!(err("qa", &qa, &pr("not json")).contains("dữ liệu lạ"));
        assert_eq!(lanes(h, &root), [(c.id, "building".into())], "every refusal leaves the card where it was");
        // on main and mergeable: through; the PR number is kept on the card
        move_with(h, &root, c.id, "qa", &qa, Some("dev"), 3, &pr(PR_OK), &on_main).unwrap();
        move_to(h, &root, c.id, "review", &Move::default(), Some("qa"), 4).unwrap();
        // approved: the card's PR is checked again, and its head must be the reviewed SHA
        let moved = Move { sha: Some("fedcba9"), ..Move::default() };
        assert_eq!(err("approved", &moved, &pr(PR_OK)), "PR #81 đang ở head 0123abcdef01, không phải --sha fedcba9: review đúng head mới rồi duyệt lại");
        assert!(err("approved", &Move { sha: Some("0123abc"), ..Move::default() }, &pr(stacked)).contains("xếp chồng trên card-x"));
        let ok = Move { sha: Some("0123ABC"), ..Move::default() };
        assert_eq!(move_with(h, &root, c.id, "approved", &ok, Some("review"), 5, &pr(PR_OK), &on_main).unwrap().lane, "approved");
        assert_eq!(asked.borrow().last().map(String::as_str), Some("81"));
        // a card with no PR (a qa-only card) has nothing to ask gh about
        let (uat, _) = add(h, &root, "UAT", Some("true"), Some("qa"), false, None, 6).unwrap();
        claim(h, &root, "qa", "qa", 7).unwrap();
        let n = asked.borrow().len();
        move_with(h, &root, uat.id, "review", &Move::default(), Some("qa"), 8, &pr(stacked), &on_main).unwrap();
        move_with(h, &root, uat.id, "approved", &ok, Some("review"), 9, &pr(stacked), &on_main).unwrap();
        assert_eq!(asked.borrow().len(), n);
        // a repo on `master`: its PRs pass, a PR into `main` there is stacked
        let master = PR_OK.replace("\"main\"", "\"master\"");
        assert!(pr_gate("#81", &master, None, "master").is_ok());
        let e = pr_gate("#81", PR_OK, None, "master").unwrap_err().to_string();
        assert!(e.starts_with("PR #81 xếp chồng trên main") && e.contains("--base master") && e.contains("`git merge origin/master`"), "{e}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn unknown_mergeable_is_read_again_and_never_a_bounce() {
        // ai-game-studio 2026-10-20: #147 refused as "conflict" right after a push, passed 45 s later.
        let (d, root) = tmp("unknown");
        let h = d.as_path();
        let c = put(h, &root, "fix", Some("true"), false, None, 0).unwrap();
        claim(h, &root, "dev", "ready", 1).unwrap();
        let unknown = r#"{"baseRefName":"main","mergeable":"UNKNOWN","headRefOid":"0123abcdef","state":"OPEN"}"#;
        let reads = std::cell::Cell::new(0);
        // UNKNOWN twice, then GitHub has computed it: the move passes
        let settles = |_: &Path, _: &str| -> Result<String> {
            reads.set(reads.get() + 1);
            Ok(if reads.get() <= 2 { unknown } else { PR_OK }.to_string())
        };
        let qa = Move { pr: Some("81"), ..Move::default() };
        assert_eq!(move_with(h, &root, c.id, "qa", &qa, Some("dev"), 2, &settles, &on_main).unwrap().lane, "qa");
        assert_eq!(reads.get(), 3);
        move_to(h, &root, c.id, "review", &Move::default(), Some("qa"), 3).unwrap();
        // still UNKNOWN after the re-reads: refused as "đang tính", the card stays, no bounce
        let ok = Move { sha: Some("0123abc"), ..Move::default() };
        let e = move_with(h, &root, c.id, "approved", &ok, Some("review"), 4, &|_, _| Ok(unknown.to_string()), &on_main).unwrap_err().to_string();
        assert_eq!(e, "GitHub đang tính mergeable của PR #81: thử lại sau 1 phút");
        let t = list(h, &root).unwrap().into_iter().find(|t| t.id == c.id).unwrap();
        assert_eq!((t.lane.as_str(), t.bounces), ("review", 0));
        assert_eq!(move_with(h, &root, c.id, "approved", &ok, Some("review"), 5, &|_, _| Ok(PR_OK.to_string()), &on_main).unwrap().lane, "approved");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn an_unknown_role_tag_is_a_role_no_room_claims() {
        // ai-game-studio 2026-10-20: dev claimed #134 `[#125][art-director]`.
        let (d, root) = tmp("artdir");
        let h = d.as_path();
        let card = |text: &str| put(h, &root, text, Some("true"), false, None, 0).unwrap().id;
        let art = card("[#125][art-director] Bảng màu đảo");
        let fix = card("[#130][hot-fix] Sửa crash khi mở kho");
        let cards = list(h, &root).unwrap();
        let of = |id: u64| roles(cards.iter().find(|t| t.id == id).unwrap());
        assert_eq!((of(art), of(fix)), (vec!["art-director".to_string()], vec![]));
        for room in ["dev", "dev2", "ui", "backend", "core"] {
            assert_eq!(claimable(&cards, room, "ready", 1), Some(fix), "{room}");
        }
        assert_eq!(claim(h, &root, "dev", "ready", 1).unwrap().map(|t| t.id), Some(fix));
        assert_eq!(claim(h, &root, "dev2", "ready", 1).unwrap(), None, "the art-director card is nobody's");
        let team: Vec<String> = ["lead", "dev", "dev2", "ui", "qa", "review"].iter().map(|n| n.to_string()).collect();
        assert_eq!(unstaffed(&list(h, &root).unwrap(), &team), [format!("card #{art} vai [art-director] không có phòng: giao lại vai hoặc thêm phòng")]);
        use super::super::room::card_role;
        for no in ["hot-fix", "hotfix", "follow-up", "followup", "WIP", "bug", "feature", "chore", "p0", "P3", "#125", "v2", "m5", "a--b", ""] {
            assert_eq!(card_role(no), None, "{no}");
        }
        assert_eq!((card_role("art-director").as_deref(), card_role("godot").as_deref(), card_role("Designer").as_deref()), (Some("art-director"), Some("godot"), Some("ui")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn rooms_claim_only_their_role_and_roleless_cards_go_to_lint() {
        // ai-game-studio 2026-10-19: dev, dev2 and ui took each other's [ui]/[rd]/[game-designer] cards.
        let (d, root) = tmp("roles");
        let h = d.as_path();
        let card = |text: &str| put(h, &root, text, Some("true"), false, None, 0).unwrap().id;
        let ui = card("[#125][ui] Bản đồ campaign");
        let rd = card("[#70][rd] Vòng 3 sprite");
        let dev = card("[#57][dev] Ánh sáng 2D");
        let plain = card("[#48 M5] HUD đảo đếm ngược");
        let gd = card("[#146][game-designer] Spec kinh tế gacha");
        let both = card("[rd+game-designer] Kho ý tưởng linh thú");
        let plain2 = card("sửa nút skill");
        let roles_of = |id: u64| roles(&list(h, &root).unwrap().into_iter().find(|t| t.id == id).unwrap());
        assert_eq!((roles_of(ui), roles_of(plain), roles_of(both)), (vec!["ui".to_string()], vec![], vec!["rd".to_string(), "game-designer".to_string()]));
        let cards = list(h, &root).unwrap();
        assert_eq!(claimable(&cards, "dev2", "ready", 1), Some(dev), "the first card [ui] is not dev's");
        assert_eq!(claimable(&cards, "ui", "ready", 1), Some(ui));
        let got = |room: &str| claim(h, &root, room, "ready", 1).unwrap().map(|t| t.id);
        assert_eq!(got("dev2"), Some(dev));
        assert_eq!(got("dev"), Some(plain));
        assert_eq!(got("ui"), Some(ui));
        assert_eq!(got("ui2"), Some(plain2), "untagged cards go to any builder");
        assert_eq!(got("backend"), None, "only [rd] and [game-designer] cards are left");
        assert_eq!(got("core"), None);
        let team = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        let full = team(&["lead", "dev", "dev2", "ui", "qa", "review"]);
        let lines = unstaffed(&list(h, &root).unwrap(), &full);
        assert_eq!(lines, [
            format!("card #{rd} vai [rd] không có phòng: giao lại vai hoặc thêm phòng"),
            format!("card #{gd} vai [game-designer] không có phòng: giao lại vai hoặc thêm phòng"),
            format!("card #{both} vai [rd+game-designer] không có phòng: giao lại vai hoặc thêm phòng"),
        ]);
        // an R&D room never claims ready: its [rd] cards there are still listed for the lead, and
        // no builder takes them; an unknown team says nothing
        let with_rd = unstaffed(&list(h, &root).unwrap(), &team(&["lead", "dev", "ui", "rd2"]));
        assert_eq!(with_rd, [
            format!("card #{rd} vai [rd] ở ready mà phòng vai đó không nhận cột ready: giao vai builder (`--role dev`) hoặc đưa về backlog"),
            format!("card #{gd} vai [game-designer] không có phòng: giao lại vai hoặc thêm phòng"),
            format!("card #{both} vai [rd+game-designer] ở ready mà phòng vai đó không nhận cột ready: giao vai builder (`--role dev`) hoặc đưa về backlog"),
        ]);
        assert!(unstaffed(&list(h, &root).unwrap(), &[]).is_empty());
        // the game-designer and rd cards are never claimed, whatever builder asks
        for room in ["dev", "dev3", "ui", "backend", "core", "godot"] {
            let c = claimable(&list(h, &root).unwrap(), room, "ready", 2);
            assert!(c != Some(gd) && c != Some(rd), "{room}");
        }
        // hyphenated non-role words are no role (the card counts as untagged); role words still are
        assert_eq!((super::super::room::card_role("hot-fix"), super::super::room::card_role("follow-up")), (None, None));
        assert_eq!(super::super::room::card_role("game-designer").as_deref(), Some("game-designer"));
        assert!(parse_role("hot-fix").is_err());
        // --role reassigns it (over the title tag): a dev room takes it next
        assert_eq!(parse_role(" Backend ").unwrap(), "dev");
        assert_eq!(parse_role("rd+game-designer").unwrap(), "rd+game-designer");
        assert!(parse_role("bug").is_err() && parse_role("").is_err() && parse_role("#12").is_err());
        let t = set_role(h, &root, gd, &parse_role("dev").unwrap(), Some("lead"), 3).unwrap();
        assert_eq!((t.role.as_deref(), t.notes.last().unwrap().text.as_str()), (Some("dev"), "vai dev"));
        assert_eq!(got("dev3"), Some(gd));
        // a [qa] card goes to the qa lane, not to builders
        let uat = card("[#1 v1][qa] Chuẩn bị playtest");
        assert_eq!(claimable(&list(h, &root).unwrap(), "dev4", "ready", 4), None);
        assert_eq!(claim(h, &root, "qa", "qa", 4).unwrap().map(|t| (t.id, t.lane)), Some((uat, "qa".into())));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn done_needs_a_result_and_reopen_brings_a_card_back() {
        let (d, root) = tmp("reopen");
        let h = d.as_path();
        let a = put(h, &root, "a", Some("true"), false, None, 0).unwrap();
        let b = put(h, &root, "b", Some("true"), false, None, 0).unwrap();
        for weak in ["chưa", "ok", "xong rồi", "cargo test:", ": 12 passed"] {
            let e = close(h, &root, a.id, Some(weak), Some("lead"), 1).unwrap_err().to_string();
            assert!(e.contains("không có kết quả kiểm"), "{weak}: {e}");
        }
        // Owner cards (no `from`): without a team any room closes the owner's target; in a board
        // team a builder may not, the backlog rooms may, and split cards close from their builder.
        let n = put(h, &root, "n", Some("true"), false, None, 0).unwrap();
        assert!(close(h, &root, n.id, Some("cargo test: 12 passed"), Some("dev"), 1).is_ok(), "no team");
        let roots = super::super::idle::state_dir(h).join("team-roots.json");
        super::super::idle::write_json(&roots, &serde_json::json!([root.to_string_lossy()]));
        for builder in ["dev", "qa", "ui"] {
            let e = close(h, &root, a.id, Some("cargo test: 12 passed"), Some(builder), 1).unwrap_err().to_string();
            assert!(e.contains("ý owner"), "{builder}: {e}");
        }
        assert!(close(h, &root, a.id, Some("cargo test: 12 passed"), Some("ba"), 1).is_ok());
        let lead_made = put(h, &root, "x", Some("true"), false, Some("lead"), 0).unwrap();
        assert!(close(h, &root, lead_made.id, Some("cargo test: 12 passed"), Some("dev"), 1).is_ok(), "a split card closes from its builder");
        super::super::idle::write_json(&roots, &serde_json::json!([]));
        assert!(close(h, &root, b.id, Some("merged 0123abcd"), Some("lead"), 1).is_ok());
        let c = put(h, &root, "c", Some("true"), false, None, 0).unwrap();
        assert!(close(h, &root, c.id, Some("0123abcdef0123abcdef"), None, 1).is_ok());
        // a card closed from approved comes back there with its SHA; the history stays
        let (e, _) = add(h, &root, "e", Some("true"), None, false, None, 2).unwrap();
        claim(h, &root, "dev", "ready", 2).unwrap();
        for (to, m) in [("qa", Move { pr: Some("9"), ..Move::default() }), ("review", Move::default()), ("approved", Move { sha: Some("0123abc"), ..Move::default() })] {
            move_to(h, &root, e.id, to, &m, None, 3).unwrap();
        }
        close(h, &root, e.id, Some("gh pr merge 9: merged"), Some("lead"), 4).unwrap();
        let back = reopen(h, &root, e.id, Some("đóng nhầm, PR chưa vào main"), Some("lead"), 5).unwrap();
        assert_eq!((back.state.as_str(), back.lane.as_str(), back.sha.as_deref(), back.evidence.as_deref(), back.by.as_deref()), ("open", "approved", Some("0123abc"), None, None));
        assert_eq!(back.notes.last().unwrap().text, "↺ mở lại bởi lead (đã done bởi lead: gh pr merge 9: merged) → approved: đóng nhầm, PR chưa vào main");
        assert!(back.notes.iter().any(|n| n.text == "review → approved"), "history kept");
        assert_eq!(current(h, &root).unwrap(), (Some(back), 1));
        // a dropped card that was being built goes back to ready; an open or unknown card is refused
        let f = put(h, &root, "f", Some("true"), false, None, 6).unwrap();
        claim(h, &root, "dev", "ready", 6).unwrap();
        close(h, &root, f.id, None, Some("lead"), 7).unwrap();
        assert_eq!(reopen(h, &root, f.id, None, None, 8).unwrap().lane, "ready");
        assert!(reopen(h, &root, f.id, None, None, 9).unwrap_err().to_string().contains("đang mở"));
        assert!(reopen(h, &root, 99, None, None, 9).is_err());
        assert_eq!(super::super::room::crew("dev2"), "dev");
        let _ = std::fs::remove_dir_all(&d);
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
    fn a_nested_repo_keeps_its_own_board_and_its_worktrees_share_it() {
        // UAT 2026-10-17: ai-game-studio sits inside the 8sync-startup repo; HQ showed only the outer, empty board.
        let (d, outer) = tmp("nested");
        let h = d.as_path();
        let game = outer.join("game");
        let wt = game.join(".claude/worktrees/card-5");
        std::fs::create_dir_all(&wt).unwrap();
        put(h, &game, "concept v1", None, false, None, 1).unwrap();
        let k = |p: &Path| filed_under(h, p).unwrap();
        assert_eq!(k(&game), super::super::auto::canon(&game).to_string_lossy());
        assert_eq!(k(&wt), k(&game), "a worktree files under its repo");
        assert_ne!(k(&outer), k(&game), "the outer repo is a different board");
        assert!(list(h, &outer).unwrap().is_empty());
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
    fn an_urgent_card_is_claimed_before_older_ones() {
        let (d, root) = tmp("prio");
        let h = d.as_path();
        let old = put(h, &root, "old", Some("true"), false, None, 0).unwrap();
        let low = put(h, &root, "low", Some("true"), false, None, 1).unwrap();
        let hot = put(h, &root, "hot", Some("true"), false, None, 2).unwrap();
        set_prio(h, &root, low.id, Some(3), Some("lead"), 3).unwrap();
        let t = set_prio(h, &root, hot.id, Some(0), Some("lead"), 3).unwrap();
        assert_eq!((t.prio, t.notes.last().unwrap().text.as_str()), (Some(0), "ưu tiên P0"));
        // P0 first, then the unset (P2) card, and P3 last, whatever the queue order
        let order: Vec<u64> = (0..3).filter_map(|i| claim(h, &root, &format!("dev{i}"), "ready", 10).unwrap()).map(|t| t.id).collect();
        assert_eq!(order, [hot.id, old.id, low.id]);
        assert_eq!(claimable(&list(h, &root).unwrap(), "dev9", "ready", 10), None);
        // clearing goes back to P2; a closed or unknown card is refused
        assert_eq!(set_prio(h, &root, low.id, None, None, 11).unwrap().prio, None);
        assert!(set_prio(h, &root, 99, Some(1), None, 11).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_full_ready_lane_stops_new_backlog_work_except_p0() {
        // WIP limit: ai-game-studio had 23 cards in ready and one in building (2026-10-19).
        let (d, root) = tmp("wip");
        let h = d.as_path();
        for i in 0..READY_CAP {
            put(h, &root, &format!("build {i}"), Some("true"), false, None, 0).unwrap();
        }
        let spec = put(h, &root, "spec", None, false, None, 1).unwrap();
        let cards = list(h, &root).unwrap();
        assert_eq!(ready_count(&cards), READY_CAP);
        assert_eq!(claimable(&cards, "lead", "backlog", 2), None, "planners wait while ready is full");
        assert_eq!(claim(h, &root, "lead", "backlog", 2).unwrap(), None);
        // A room's split waits in backlog; the owner's own card still goes to ready.
        let (split, _) = add(h, &root, "split", Some("true"), None, false, Some("ba"), 3).unwrap();
        assert_eq!(split.lane, "backlog");
        let (own, _) = add(h, &root, "owner ask", Some("true"), None, false, None, 3).unwrap();
        assert_eq!(own.lane, "ready");
        let m = Move { check: Some("true"), ..Move::default() };
        assert!(move_to(h, &root, spec.id, "ready", &m, Some("lead"), 4).is_err(), "backlog → ready refused at the cap");
        // P0 passes both gates.
        set_prio(h, &root, spec.id, Some(0), None, 5).unwrap();
        assert_eq!(claim(h, &root, "lead", "backlog", 6).unwrap().map(|t| t.id), Some(spec.id));
        assert_eq!(move_to(h, &root, spec.id, "ready", &m, Some("lead"), 7).unwrap().lane, "ready");
        // Under the cap a room's split goes straight to ready again.
        for _ in 0..READY_CAP {
            claim(h, &root, "dev", "ready", 8).unwrap();
            let held = list(h, &root).unwrap().into_iter().find(|t| t.claim.as_ref().is_some_and(|c| c.room == "dev")).unwrap();
            move_to(h, &root, held.id, "qa", &Move::default(), Some("dev"), 9).unwrap();
        }
        assert!(ready_count(&list(h, &root).unwrap()) < READY_CAP);
        assert_eq!(add(h, &root, "split 2", Some("true"), None, false, Some("ba"), 10).unwrap().0.lane, "ready");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn prio_accepts_p0_to_p3_and_none() {
        assert_eq!(parse_prio("P0").unwrap(), Some(0));
        assert_eq!(parse_prio(" p3 ").unwrap(), Some(3));
        assert_eq!(parse_prio("1").unwrap(), Some(1));
        assert_eq!(parse_prio("none").unwrap(), None);
        assert_eq!(parse_prio("-").unwrap(), None);
        for bad in ["P4", "high", "", "pp1", "-1"] {
            assert!(parse_prio(bad).is_err(), "{bad}");
        }
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
        assert!(close(h, &root, 1, Some("cargo test: ok"), None, 4)
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
        assert!(!p.contains("owner gửi"), "a room's --now must not claim the owner's voice: {p}");
        assert_eq!(json(Some(&t))["id"], 7);
        assert!(json(None).is_null());
    }

    #[test]
    fn leaving_blocked_keeps_bounces_and_review_needs_qa_first() {
        let (d, root) = tmp("unblock-reclaim");
        let h = d.as_path();
        let gh = |_: &Path, _: &str| -> Result<String> { Ok(PR_OK.to_string()) };
        let mv = |id: u64, to: &str, note: Option<&str>, now: u64| move_with(h, &root, id, to, &Move { note, ..Move::default() }, Some("qa"), now, &gh, &on_main);
        let (t, _) = add(h, &root, "[dev] fix battle", Some("cargo test"), None, false, None, 1).unwrap();
        mv(t.id, "building", None, 2).unwrap();
        // gh could not say the default branch: refuse rather than guess `main`
        let pr = Move { pr: Some("#5"), ..Move::default() };
        let e = move_with(h, &root, t.id, "qa", &pr, Some("dev"), 2, &gh, &|_| None).unwrap_err().to_string();
        assert_eq!(e, super::super::merge::NO_DEFAULT);
        move_with(h, &root, t.id, "qa", &pr, Some("dev"), 2, &gh, &on_main).unwrap();
        note(h, &root, t.id, "gate fedcba9: cargo test: ok", Some("qa"), 2).unwrap();
        assert_eq!(mv(t.id, "ready", Some("[qa] lỗi"), 2).unwrap().bounces, 1);
        mv(t.id, "blocked", Some("kẹt"), 2).unwrap();
        // a qa → review in the history and a gate at an older head do not count
        let e = mv(t.id, "review", Some("QA đã kiểm"), 3).unwrap_err().to_string();
        assert!(e.contains("chưa qua QA"), "{e}");
        assert_eq!(lanes(h, &root), [(t.id, "blocked".into())]);
        note(h, &root, t.id, "gate 0123abc: cargo test: ok", Some("qa"), 3).unwrap();
        let t = mv(t.id, "review", None, 3).unwrap();
        assert_eq!((t.lane.as_str(), t.bounces), ("review", 1), "unblocking keeps the bounce count");
        mv(t.id, "blocked", None, 3).unwrap();
        assert_eq!(mv(t.id, "backlog", None, 3).unwrap().bounces, 1);

        let m = Move::default();
        let (t2, _) = add(h, &root, "[dev] fix hud", Some("cargo test"), None, false, None, 4).unwrap();
        let t2 = move_with(h, &root, t2.id, "building", &m, None, 5, &gh, &on_main).unwrap();
        assert!(t2.claim.is_none());
        let claimed = claim(h, &root, "dev", "ready", 6).unwrap().expect("reclaims unclaimed building card");
        assert_eq!((claimed.id, claimed.lane.as_str()), (t2.id, "building"));
        assert_eq!(claimed.claim.unwrap().room, "dev");
    }

    #[test]
    fn an_idea_split_into_cards_waits_in_backlog_and_comes_back_when_they_close() {
        // 3d-game 2026-10-20: the lead parked the owner's ideas #1 and #10 in Blocked as "epic".
        let (d, root) = tmp("split");
        let h = d.as_path();
        let base = put(h, &root, "x", None, false, None, 0).unwrap();
        let tagged = |text: &str| Target { id: 7, text: text.into(), ..base.clone() };
        assert_eq!(["[#10] player", "[ui][#1 v2] hud", "[#125][ui] art"].map(|s| parent(&tagged(s))), [Some(10), Some(1), Some(125)]);
        assert_eq!(["[dev] fix #5", "x #5", "[#7] itself"].map(|s| parent(&tagged(s))), [None, None, None]);
        close(h, &root, base.id, None, None, 0).unwrap();

        let idea = put(h, &root, "game 3D realistic như Argon", None, false, None, 1).unwrap();
        assert_eq!(claim(h, &root, "lead", "backlog", 2).unwrap().unwrap().id, idea.id);
        let a = put(h, &root, &format!("[#{}] PBR", idea.id), Some("npm test"), false, Some("lead"), 3).unwrap();
        let b = put(h, &root, &format!("[#{}] terrain", idea.id), Some("npm test"), false, Some("lead"), 3).unwrap();
        let e = move_to(h, &root, idea.id, "blocked", &Move { note: Some("epic"), ..Move::default() }, Some("lead"), 4).unwrap_err().to_string();
        assert!(e.contains(&format!("card con #{} #{}", a.id, b.id)) && e.contains("không blocked"), "{e}");
        // nobody claims it while a split-off card is open, and it does not wake a waiting lead
        assert!(claim(h, &root, "lead", "backlog", 5).unwrap().is_none());
        assert_eq!(claimable(&list(h, &root).unwrap(), "lead", "backlog", 5), None);
        assert!(list(h, &root).unwrap().iter().all(|t| t.id != idea.id || t.claim.is_none()), "the lead's claim on it is dropped");

        // an idea parked in blocked before this rule goes back to backlog on the next claim
        let old = put(h, &root, "ý cũ", None, false, None, 6).unwrap();
        move_to(h, &root, old.id, "blocked", &Move { note: Some("epic: tách"), ..Move::default() }, Some("lead"), 6).unwrap();
        put(h, &root, &format!("[#{}] con", old.id), Some("true"), false, Some("lead"), 6).unwrap();
        claim(h, &root, "dev", "ready", 7).unwrap();
        let back = list(h, &root).unwrap().into_iter().find(|t| t.id == old.id).unwrap();
        assert_eq!(back.lane, "backlog");
        assert!(back.notes.last().unwrap().text.starts_with("blocked → backlog"), "{:?}", back.notes);

        // every split-off card closed: the lead gets the idea back to accept it or split again
        close(h, &root, a.id, Some("npm test: 12 passed"), Some("lead"), 8).unwrap();
        close(h, &root, b.id, None, Some("lead"), 8).unwrap();
        let got = claim(h, &root, "lead", "backlog", 9).unwrap().unwrap();
        assert_eq!(got.id, idea.id);
        let hint = claim_hint(&got, &list(h, &root).unwrap()).unwrap();
        assert!(hint.contains(&format!("#{} ", a.id)) && hint.contains(&format!("#{} ", b.id)) && hint.contains("đã đóng") && hint.contains(&format!("auto done {}", idea.id)), "{hint}");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_low_ready_hands_the_lead_a_split_idea_for_its_next_batch() {
        // 3d-game 2026-10-20: ready 0, dev "Chờ card", while idea #10 waited on its open pieces.
        let (d, root) = tmp("refill");
        let h = d.as_path();
        let idea = put(h, &root, "game 3D realistic", None, false, None, 0).unwrap();
        assert_eq!(claim(h, &root, "lead", "backlog", 1).unwrap().unwrap().id, idea.id);
        let a = put(h, &root, &format!("[#{}] PBR", idea.id), Some("npm test"), false, Some("lead"), 2).unwrap();
        assert!(claim(h, &root, "lead", "backlog", 3).unwrap().is_none(), "just split: no refill yet");

        let t = 3 + REFILL_RETRY;
        assert_eq!(claimable(&list(h, &root).unwrap(), "lead", "backlog", t), Some(idea.id), "auto wait wakes the lead");
        let got = claim(h, &root, "lead", "backlog", t).unwrap().unwrap();
        assert_eq!(got.id, idea.id);
        assert!(got.notes.is_empty() && got.refill_at == Some(t), "the board keeps the idea's own last note");
        let hint = claim_hint(&got, &list(h, &root).unwrap()).unwrap();
        assert!(hint.contains("tách NGAY") && hint.contains(&format!("đang mở #{}", a.id)) && hint.contains(&format!("[#{}]", idea.id)), "{hint}");

        // handed back at most every REFILL_RETRY: a lead with nothing left to split is not woken each tick
        assert!(claim(h, &root, "lead", "backlog", t + 60).unwrap().is_none());
        assert_eq!(claimable(&list(h, &root).unwrap(), "lead", "backlog", t + 60), None);
        // ready back at the low-water mark: no refill even after the retry
        for i in 0..READY_LOW {
            put(h, &root, &format!("[#{}] piece {i}", idea.id), Some("true"), false, Some("lead"), t + 70).unwrap();
        }
        assert!(claim(h, &root, "lead", "backlog", t + 2 * REFILL_RETRY).unwrap().is_none());
        // builders are untouched by it
        assert_ne!(claim(h, &root, "dev", "ready", t + 2 * REFILL_RETRY).unwrap().unwrap().id, idea.id);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn backlog_rooms_take_blocked_cards_first_and_again_after_an_hour() {
        // 3d-game 2026-10-20: #16 waited on a closed PR while the lead slept in `auto wait`.
        let (d, root) = tmp("unblock");
        let h = d.as_path();
        let new = put(h, &root, "việc mới", None, false, None, 1).unwrap();
        let stuck = put(h, &root, "[dev] so sánh Argon", Some("true"), false, None, 1).unwrap();
        claim(h, &root, "dev", "ready", 2).unwrap();
        move_to(h, &root, stuck.id, "blocked", &Move { note: Some("chờ PR #4 merge"), ..Move::default() }, Some("dev"), 3).unwrap();
        assert_eq!(claimable(&list(h, &root).unwrap(), "lead", "backlog", 3), Some(stuck.id), "a new blocked card wakes the lead");
        let got = claim(h, &root, "lead", "backlog", 4).unwrap().unwrap();
        assert_eq!((got.id, got.lane.as_str()), (stuck.id, "blocked"), "blocked first, and it stays blocked until moved");
        assert!(claim_hint(&got, &[]).unwrap().contains("gỡ NGAY"));
        // one it cannot clear does not pin the room: next claim gives the backlog card
        assert_eq!(claim(h, &root, "lead", "backlog", 5).unwrap().unwrap().id, new.id);
        assert_eq!(claim(h, &root, "ba", "backlog", 5).unwrap(), None, "the other backlog room does not take it either");
        assert_eq!(claimable(&list(h, &root).unwrap(), "ba", "backlog", 4 + BLOCKED_RETRY), Some(stuck.id), "an hour later it comes back");
        let _ = std::fs::remove_dir_all(&d);
    }
}
