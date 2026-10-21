//! `8sync ccc auto loop on [trọng tâm] | off | wake | status [--json]`: the auto-ship loop of one
//! project (HQ composer `/hq-auto-ship`, owner 2026-10-21: "loop làm liên tục"). On, the project's
//! lead runs rounds of R&D, optimize, upgrade, improve, security and gap checks, each finding a board
//! card the team builds through the normal auto flow. The next round must not depend on the lead
//! remembering, nor wait for the owner ("vô hạn … tự biết khi nào có usage … không có đợi tôi"):
//! `auto revive` ([`tick`], HQ runs it every ≤ 2 min) mails the lead the next round's brief once
//! the board has drained (no card in [`BUSY_LANES`]), at most every [`ROUND_GAP_S`].
//! It has no round limit; while the usage window / lease / budget rests, the resource guard holds
//! the project (L2/L3 or rooms it paused), auto is off / paused or the lead has not read the last
//! brief, the round waits and goes out by itself once that clears ([`next_reason`], shown in
//! `auto status --json` `ship_loops`). Only a loop that finds nothing parks: [`PARK_AFTER`] rounds
//! in a row that added no card, until the owner writes to the project or sends `/hq-auto-ship`
//! (`auto loop wake` / `on`). Owner-only on/off/wake ([`super::auto::owner`]), and only for a team
//! root auto acts on; `auto down` and `auto close` turn it off.
//!
//! State: `<idle state dir>/ship-loop.json`, `{ "<canonical root>": { "focus", "since", "round",
//! "last", "mark": {"id", "at"}, "empty", "parked", "leads", "log" } }`: `mark` = the board when the
//! round started (newest card id, time), `empty` = rounds in a row that added no card, `leads` =
//! the conversation ids the last brief went to, `log` = the last rounds' `{round, added, merged}`.

use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::{auto, idle, target};

/// Least time between two rounds (and between `on` and the first round the loop starts itself).
pub(super) const ROUND_GAP_S: u64 = 20 * 60;
/// The R&D pipeline stays ahead of the builders (owner 2026-10-21: "phải lên task backlog ready
/// nhiều lên … R&D và lead phải làm việc tự lên task liên tục"): a round tops the queue up whenever
/// fewer than [`TOP_UP`] cards wait in backlog/ready. Building/qa/review/approved/blocked never
/// block a round — that is the team working, not a reason to stop finding work.
const TOP_UP: usize = 2;
/// Lanes that wait for the team to pick up (a card here means the queue is topped up).
const QUEUE_LANES: [&str; 2] = ["backlog", "ready"];
/// Rounds in a row that added no card before the loop parks.
pub(super) const PARK_AFTER: u64 = 2;
const LOG_KEEP: usize = 10;
const FOCUS_MAX: usize = 300;
/// Every brief starts with it (here and apps/hq-ui lib/slash.ts): an unread one is found by it.
const HEAD: &str = "[HQ /hq-auto-ship]";

fn file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("ship-loop.json")
}

fn key(root: &Path) -> String {
    auto::canon(root).to_string_lossy().into_owned()
}

/// A root as stored (Rust's `\\?\` prefix dropped).
fn plain(root: &str) -> PathBuf {
    PathBuf::from(root.trim_start_matches(r"\\?\"))
}

/// The loop of `root`, or None when it is off.
pub(super) fn get(home: &Path, root: &Path) -> Option<Value> {
    idle::read_json(&file(home)).map(|v| v[key(root)].clone()).filter(Value::is_object)
}

/// Whether auto acts on `root`'s team: a team root (`auto up` there) inside `auto on --here`'s scope.
fn team_project(home: &Path, root: &Path) -> bool {
    let c = auto::canon(root);
    super::team::team_roots(home).iter().any(|r| auto::canon(&plain(r)) == c) && auto::in_scope(home, Some(&root.to_string_lossy()))
}

/// The board at a round's start: the newest card id and the time.
fn mark(home: &Path, root: &Path, now: u64) -> Value {
    let newest = target::list(home, root).map_or(0, |c| c.iter().map(|t| t.id).max().unwrap_or(0));
    json!({ "id": newest, "at": now })
}

/// What the round that started at `l["mark"]` gave: cards added since, cards merged (done) since.
fn round_yield(home: &Path, root: &Path, l: &Value) -> (u64, u64) {
    let (id, at) = (l["mark"]["id"].as_u64().unwrap_or(0), l["mark"]["at"].as_u64().unwrap_or(0));
    let cards = target::list(home, root).unwrap_or_default();
    let added = cards.iter().filter(|t| t.id > id).count() as u64;
    let merged = cards.iter().filter(|t| t.state == "done" && t.closed.is_some_and(|c| c >= at)).count() as u64;
    (added, merged)
}

/// Whether a brief still waits unread in one of these rooms' inboxes.
fn unread(home: &Path, ids: &[String]) -> bool {
    ids.iter().any(|id| crate::verbs::hq::inbox_file(home, id).and_then(|f| std::fs::read_to_string(f).ok()).is_some_and(|s| s.contains(HEAD)))
}

fn ids_of(l: &Value) -> Vec<String> {
    l["leads"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Whether the queue is topped up ([`QUEUE_LANES`] holds at least [`TOP_UP`] open cards the team
/// can take). A card waiting on the owner does not count — platform 2026-10-21: three backlog cards
/// ("chờ owner: Actions tắt cấp repo", a parent whose only open children were blocked on the same
/// answer) held round 3 back for 5 h while 13 rooms sat with nothing to claim.
fn in_flight(cards: &[target::Target]) -> bool {
    cards.iter().filter(|t| t.state == "open" && QUEUE_LANES.contains(&t.lane.as_str()) && !owner_gated(t, cards)).count() >= TOP_UP
}

/// Waits on the owner: its last note says so (`chờ owner:` / `cần owner`, the convention the rooms
/// write), or every open card split off it (`[#id] …`) is blocked or gated itself.
fn owner_gated(t: &target::Target, cards: &[target::Target]) -> bool {
    // "lead: chờ owner …", "chờ owner: …", "cần owner duyệt …" — the rooms' wording varies; a note
    // that mentions waiting on the owner anywhere in its last line is one.
    let said = |n: &str| {
        let n = n.to_lowercase();
        n.contains("chờ owner") || n.contains("cần owner")
    };
    if t.notes.last().is_some_and(|n| said(&n.text)) {
        return true;
    }
    let tag = format!("[#{}]", t.id);
    let kids: Vec<&target::Target> = cards.iter().filter(|c| c.state == "open" && c.id != t.id && c.text.starts_with(&tag)).collect();
    !kids.is_empty() && kids.iter().all(|k| k.lane == "blocked" || k.notes.last().is_some_and(|n| said(&n.text)))
}

/// Every loop by root for `auto status --json` `ship_loops`: `{on, focus, round, since, last,
/// parked, log, next_reason}`; `resting` = the status' usage gate or cap holds (window ≥ 90%,
/// lease over, $/hour).
pub(super) fn view(home: &Path, resting: bool, now: u64) -> Value {
    let mut v = idle::read_json(&file(home)).filter(Value::is_object).unwrap_or_else(|| json!({}));
    if let Some(o) = v.as_object_mut() {
        for (root, l) in o.iter_mut() {
            let p = plain(root);
            let why = next_reason(home, &p, l, &ids_of(l), resting, super::pressure::holds(home, &p), now);
            l["on"] = json!(true);
            l["next_reason"] = json!(why);
        }
    }
    v
}

/// Why the loop of `root` (state `l`, its lead rooms' conversation ids `leads`) sends no round now,
/// None = the next revive tick sends it. Every reason but `idle` clears by itself and the round then
/// goes out (no round limit): `auto` = auto off or paused by the owner; `scope` = not a team root auto
/// acts on; `idle` = parked after [`PARK_AFTER`] empty rounds (the owner wakes it); `usage` = the
/// usage window / lease / budget rests; `guard` = the resource guard holds the project (L2/L3, paused
/// rooms); `gap` = under [`ROUND_GAP_S`] since the last round; `board` = cards in flight; `lead` = the
/// lead has not read the last brief yet.
pub(super) fn next_reason(home: &Path, root: &Path, l: &Value, leads: &[String], resting: bool, guard_holds: bool, now: u64) -> Option<&'static str> {
    if !auto::running(home) {
        Some("auto")
    } else if !team_project(home, root) {
        Some("scope")
    } else if l["parked"].as_bool() == Some(true) {
        Some("idle")
    } else if resting {
        Some("usage")
    } else if guard_holds {
        Some("guard")
    } else if l["last"].as_u64().is_some_and(|t| now.saturating_sub(t) < ROUND_GAP_S) {
        Some("gap")
    } else if target::list(home, root).map_or(true, |cards| in_flight(&cards)) {
        Some("board")
    } else if unread(home, leads) {
        Some("lead")
    } else {
        None
    }
}

/// Turn the loop on in `root` (again: the focus is replaced, the round count kept, a parked loop
/// runs again). Round 1 is the brief the owner's `/hq-auto-ship` itself sent, so the loop's own next
/// round is round 2. Refused for a project auto does not run a team in.
pub(super) fn on(home: &Path, root: &Path, focus: Option<&str>, now: u64) -> Result<Value> {
    if !team_project(home, root) {
        bail!("auto-ship chỉ chạy cho dự án có team auto: `8sync ccc auto up` trong dự án này trước (hoặc dự án nằm ngoài phạm vi `auto on --here`)");
    }
    let focus = focus.map(str::trim).filter(|f| !f.is_empty()).map(|f| f.chars().take(FOCUS_MAX).collect::<String>());
    let m = mark(home, root, now);
    let mut out = Value::Null;
    super::team::update_json(&file(home), |v| {
        let k = key(root);
        let old = v[&k].clone();
        v[&k] = json!({
            "focus": focus,
            "since": old["since"].as_u64().unwrap_or(now),
            "round": old["round"].as_u64().unwrap_or(1),
            "last": now,
            "mark": m,
            "empty": 0,
            "parked": false,
            "leads": [],
            "log": old["log"].as_array().cloned().unwrap_or_default(),
        });
        out = v[&k].clone();
    });
    Ok(out)
}

/// The owner wrote to the project: a parked loop runs again (from now). Whether it was parked.
pub(super) fn wake(home: &Path, root: &Path, now: u64) -> bool {
    let m = mark(home, root, now);
    let mut woke = false;
    super::team::update_json(&file(home), |v| {
        let k = key(root);
        if v[&k]["parked"].as_bool() == Some(true) {
            let l = &mut v[&k];
            l["parked"] = json!(false);
            l["empty"] = json!(0);
            l["mark"] = m;
            woke = true;
        }
    });
    woke
}

/// Turn it off; whether it was on.
pub(super) fn off(home: &Path, root: &Path) -> bool {
    let mut was = false;
    super::team::update_json(&file(home), |v| {
        if let Some(o) = v.as_object_mut() {
            was = o.remove(&key(root)).is_some();
        }
    });
    was
}

/// The brief of round `round` (also the round the owner's `/hq-auto-ship` sends, apps/hq-ui lib/slash.ts).
pub(super) fn brief(focus: Option<&str>, round: u64) -> String {
    let focus = focus.map(|f| format!(" · trọng tâm: {f}")).unwrap_or_default();
    format!(
        "{HEAD} Vòng {round}{focus}. Hàng việc sắp cạn (backlog/ready < {TOP_UP} card): lead mở vòng mới.\n\
         Tự lên việc LIÊN TỤC, không đợi owner: mỗi vòng thêm 3–6 card nhỏ (P0–P2), giữ ready luôn ≥ 3 card để team không chờ việc; building/qa/review đang chạy không phải lý do ngưng tìm việc.\n\
         1. R&D: còn thiếu gì / làm tốt hơn gì so với công cụ tương tự, docs.\n\
         2. Optimize: hiệu năng, kích thước, token.\n\
         3. Nâng cấp: deps/toolchain, chỉ bản an toàn.\n\
         4. Cải tiến: UX, chất lượng code.\n\
         5. Check sec: secret, audit deps, OWASP trên diff gần đây.\n\
         6. Check thiếu: test, docs, đường lỗi, tính năng làm dở.\n\
         Mỗi phát hiện → MỘT card nhỏ: `8sync ccc auto add \"<việc>\" --check \"<lệnh kiểm>\"`; team build/review/merge theo luồng auto thường.\n\
         Luật: card nhỏ; \"xong\" phải có bằng chứng (lệnh kiểm + kết quả); không thao tác phá huỷ; tôn trọng guard CPU/RAM của owner; không release ngoài cổng thường của team. \
         Hết card vòng này thì thôi, 8sync tự gửi vòng kế; {PARK_AFTER} vòng liền không ra card thì loop nghỉ tới khi owner nhắn. Dừng: owner nói \"dừng\" hoặc `/hq-stop` (`8sync ccc auto loop off`)."
    )
}

/// One revive tick for `root`: when the loop is on and nothing holds it back ([`next_reason`]),
/// count what the finished round gave (cards added / merged since its start). [`PARK_AFTER`] rounds
/// in a row without a new card park the loop; otherwise mail the next round's brief to the lead
/// rooms of `rooms` (registry `(name, conversation id)`). Round, time and mark advance only on a
/// real send. Returns the line for the revive report, None when nothing happened.
pub(super) fn tick(home: &Path, root: &Path, rooms: &[(String, String)], resting: bool, guard_holds: bool, now: u64) -> Option<String> {
    let l = get(home, root)?;
    let leads: Vec<&(String, String)> = rooms.iter().filter(|(n, _)| super::room::crew(n) == "lead").collect();
    let ids: Vec<String> = leads.iter().map(|(_, id)| id.clone()).collect();
    if leads.is_empty() || next_reason(home, root, &l, &ids, resting, guard_holds, now).is_some() {
        return None;
    }
    let done = l["round"].as_u64().unwrap_or(1);
    let (added, merged) = round_yield(home, root, &l);
    let empty = if added == 0 { l["empty"].as_u64().unwrap_or(0) + 1 } else { 0 };
    let entry = json!({ "round": done, "added": added, "merged": merged });
    let log = |v: &mut Value| {
        let mut log = v["log"].as_array().cloned().unwrap_or_default();
        log.push(entry.clone());
        let skip = log.len().saturating_sub(LOG_KEEP);
        v["log"] = Value::Array(log.into_iter().skip(skip).collect());
    };
    let k = key(root);
    if empty >= PARK_AFTER {
        super::team::update_json(&file(home), |v| {
            if v[&k].is_object() {
                v[&k]["parked"] = json!(true);
                v[&k]["empty"] = json!(empty);
                log(&mut v[&k]);
            }
        });
        return Some(format!("auto-ship nghỉ: {PARK_AFTER} vòng liền không ra card (owner nhắn dự án hay /hq-auto-ship để chạy lại)"));
    }
    let round = done + 1;
    let text = brief(l["focus"].as_str(), round);
    let sent: Vec<&(String, String)> = leads.into_iter().filter(|(_, id)| crate::verbs::hq::queue_inbox(home, id, &text, now * 1000).is_ok()).collect();
    if sent.is_empty() {
        return None;
    }
    // An idle lead is re-armed by the next revive (the same mark ⚡ Làm ngay leaves), so a round
    // does not sit unread until the owner happens to write (owner 2026-10-21: "không có đợi tôi").
    super::team::ask_wake(home, root, &sent.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>(), now);
    let m = mark(home, root, now);
    super::team::update_json(&file(home), |v| {
        // Turned off meanwhile: stays off.
        if v[&k].is_object() {
            v[&k]["round"] = json!(round);
            v[&k]["last"] = json!(now);
            v[&k]["mark"] = m.clone();
            v[&k]["empty"] = json!(empty);
            v[&k]["leads"] = json!(sent.iter().map(|(_, id)| id).collect::<Vec<_>>());
            log(&mut v[&k]);
        }
    });
    Some(format!("auto-ship vòng {round} → {} (vòng {done}: +{added} card, {merged} merge)", sent.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>().join(", ")))
}

/// `auto loop on [trọng tâm…] | off | wake | status [--json]` in `root`; `owner`: [`auto::owner`] of the caller.
pub(super) fn run(args: &[String], home: &Path, root: &Path, owner: bool, now: u64) -> Result<()> {
    let as_json = args.iter().any(|a| a == "--json");
    let words: Vec<&str> = args.iter().map(String::as_str).filter(|a| *a != "--json" && *a != "--").collect();
    let line = |l: &Value| {
        let focus = l["focus"].as_str().map(|f| format!(", trọng tâm: {f}")).unwrap_or_default();
        let round = l["round"].as_u64().unwrap_or(1);
        if l["parked"].as_bool() == Some(true) {
            format!("auto-ship: NGHỈ ở vòng {round}{focus} ({PARK_AFTER} vòng liền không ra card; owner nhắn hay `auto loop wake` để chạy lại)")
        } else {
            format!("auto-ship: BẬT, vòng {round}{focus} (vòng kế khi board cạn, cách nhau ≥ {} phút)", ROUND_GAP_S / 60)
        }
    };
    match words.split_first() {
        Some((&"on", rest)) => {
            if !owner {
                bail!("chỉ owner bật auto-ship (HQ `/hq-auto-ship` hoặc terminal của owner), không phải một phòng");
            }
            let focus = rest.join(" ");
            let l = on(home, root, Some(&focus), now)?;
            if as_json {
                println!("{}", json!({ "loop": l }));
            } else {
                println!("{}", line(&l));
            }
        }
        Some((&"wake", [])) => {
            if !owner {
                bail!("chỉ owner đánh thức auto-ship");
            }
            let woke = wake(home, root, now);
            if as_json {
                println!("{}", json!({ "loop": get(home, root), "woke": woke }));
            } else {
                println!("{}", if woke { "auto-ship: chạy lại" } else { "auto-ship: không nghỉ, không cần đánh thức" });
            }
        }
        Some((&"off", [])) => {
            if !owner {
                bail!("chỉ owner tắt auto-ship (HQ `/hq-stop` hoặc terminal của owner)");
            }
            let was = off(home, root);
            if as_json {
                println!("{}", json!({ "loop": null, "was_on": was }));
            } else {
                println!("{}", if was { "auto-ship: TẮT (card đang làm vẫn xong theo luồng thường)" } else { "auto-ship: vốn đã tắt" });
            }
        }
        Some((&"status", [])) | None => {
            let l = get(home, root);
            if as_json {
                println!("{}", json!({ "loop": l }));
            } else {
                println!("{}", l.as_ref().map_or_else(|| "auto-ship: TẮT".to_string(), line));
            }
        }
        _ => bail!("loop: on [trọng tâm] | off | wake | status [--json]"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> (PathBuf, PathBuf) {
        let h = std::env::temp_dir().join(format!("8sync-shiploop-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let root = h.join("proj");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        (h, root)
    }

    const LEAD: &str = "a1830544-0719-4d6f-aaa3-644783ddb0b5";

    fn rooms() -> Vec<(String, String)> {
        vec![("lead".to_string(), LEAD.to_string()), ("dev".to_string(), "a2830544-0719-4d6f-aaa3-644783ddb0b5".to_string())]
    }

    fn inbox(h: &Path, id: &str) -> String {
        std::fs::read_to_string(crate::verbs::hq::inbox_file(h, id).unwrap()).unwrap_or_default()
    }

    /// The lead read its inbox.
    fn read_inbox(h: &Path) {
        let _ = std::fs::remove_file(crate::verbs::hq::inbox_file(h, LEAD).unwrap());
    }

    /// A team root with auto running.
    fn running(h: &Path, root: &Path) {
        super::super::team::set_team_root(h, root, true);
        auto::set(h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: None }, false, 1000).unwrap();
    }

    /// One card added and merged at `at`.
    fn ship_card(h: &Path, root: &Path, at: u64) {
        let (t, _) = target::add(h, root, &format!("card {at}"), Some("true"), None, false, None, at).unwrap();
        target::close(h, root, t.id, Some("cargo test: ok"), None, at).unwrap();
    }

    #[test]
    fn on_off_wake_status_owner_only_and_team_roots_only() {
        let (h, root) = tmp("onoff");
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(get(&h, &root).is_none());
        let e = run(&a(&["on", "x"]), &h, &root, true, 10).unwrap_err().to_string();
        assert!(e.contains("auto up"), "not a team root: {e}");
        assert!(get(&h, &root).is_none());
        super::super::team::set_team_root(&h, &root, true);
        assert!(run(&a(&["on", "hiệu", "năng"]), &h, &root, false, 10).is_err(), "a room cannot turn it on");
        assert!(get(&h, &root).is_none());
        run(&a(&["on", "hiệu", "năng"]), &h, &root, true, 10).unwrap();
        let l = get(&h, &root).unwrap();
        assert_eq!((l["focus"].as_str(), l["round"].as_u64(), l["since"].as_u64(), l["last"].as_u64()), (Some("hiệu năng"), Some(1), Some(10), Some(10)));
        assert_eq!(view(&h, false, 10).as_object().unwrap().len(), 1);
        // Again: new focus, same start and round; no focus = null.
        run(&a(&["on"]), &h, &root, true, 50).unwrap();
        let l = get(&h, &root).unwrap();
        assert_eq!((l["focus"].as_str(), l["since"].as_u64(), l["last"].as_u64()), (None, Some(10), Some(50)));
        run(&a(&["status", "--json"]), &h, &root, false, 60).unwrap();
        assert!(run(&a(&["wake"]), &h, &root, false, 60).is_err(), "a room cannot wake it");
        assert!(!wake(&h, &root, 60), "not parked");
        assert!(run(&a(&["off"]), &h, &root, false, 60).is_err(), "a room cannot stop it");
        assert!(get(&h, &root).is_some());
        run(&a(&["off"]), &h, &root, true, 60).unwrap();
        assert!(get(&h, &root).is_none());
        assert!(!off(&h, &root), "already off");
        assert!(run(&a(&["bogus"]), &h, &root, true, 60).is_err());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn next_round_only_when_drained_spaced_read_and_nothing_rests_and_it_never_ends() {
        let (h, root) = tmp("tick");
        let rooms = rooms();
        let ids = vec![LEAD.to_string()];
        let why = |resting: bool, holds: bool, at: u64| next_reason(&h, &root, &get(&h, &root).unwrap(), &ids, resting, holds, at);
        let shown = |resting: bool, at: u64| view(&h, resting, at)[key(&root)]["next_reason"].clone();
        assert!(tick(&h, &root, &rooms, false, false, 5000).is_none(), "loop off");
        super::super::team::set_team_root(&h, &root, true);
        on(&h, &root, Some("perf"), 1000).unwrap();
        assert!(tick(&h, &root, &rooms, false, false, 5000).is_none(), "auto off");
        assert_eq!(why(false, false, 5000), Some("auto"));
        running(&h, &root);
        assert!(tick(&h, &root, &rooms, false, false, 1000 + ROUND_GAP_S - 1).is_none(), "under 20 min since on");
        assert_eq!(why(false, false, 1000 + ROUND_GAP_S - 1), Some("gap"));
        // The queue topped up (≥ TOP_UP in backlog/ready) waits; the team working does not (owner
        // 2026-10-21: "phải lên task backlog ready nhiều lên … tự lên task liên tục").
        let (t, _) = target::add(&h, &root, "fix crash", Some("true"), None, false, None, 1000).unwrap();
        assert!(tick(&h, &root, &rooms, false, false, 1000 + ROUND_GAP_S).is_some(), "one ready card: still under TOP_UP, the round goes out");
        let (t2, _) = target::add(&h, &root, "second", Some("true"), None, false, None, 1000).unwrap();
        assert!(tick(&h, &root, &rooms, false, false, 1000 + ROUND_GAP_S + ROUND_GAP_S).is_none(), "two waiting: the queue is topped up");
        assert_eq!(shown(false, 1000 + ROUND_GAP_S + ROUND_GAP_S), json!("board"));
        let mut cards = target::list(&h, &root).unwrap();
        for (lane, busy) in [("approved", false), ("blocked", false), ("building", false), ("review", false)] {
            cards[0].lane = lane.into();
            cards[1].lane = lane.into();
            assert_eq!(in_flight(&cards), busy, "{lane} is the team working, not a stop");
        }
        cards[0].lane = "ready".into();
        cards[1].lane = "backlog".into();
        assert!(in_flight(&cards), "ready + backlog count");
        // Waiting on the owner is not a queue: a note, or a parent whose open children all wait.
        cards[1].notes.push(target::Note { at: 1000, room: Some("lead".into()), text: "chờ owner: bật Actions".into() });
        assert!(!in_flight(&cards), "a card waiting on the owner does not top the queue up");
        cards[1].notes.pop();
        let kid = target::Target { id: 99, text: format!("[#{}] con", cards[1].id), lane: "blocked".into(), ..cards[1].clone() };
        let with_kid = [cards.clone(), vec![kid]].concat();
        assert!(!in_flight(&with_kid), "a parent whose only open child is blocked waits with it");
        let mut kid_ready = with_kid.clone();
        kid_ready[2].lane = "ready".into();
        assert!(in_flight(&kid_ready), "a child in ready: the parent counts again, and so does the child");
        target::close(&h, &root, t.id, Some("cargo test: ok"), None, 1000).unwrap();
        target::close(&h, &root, t2.id, Some("cargo test: ok"), None, 1000).unwrap();
        // Round 2 went out at 1000 + ROUND_GAP_S (one ready card is still under TOP_UP).
        assert_eq!(get(&h, &root).unwrap()["round"].as_u64(), Some(2));
        // The idle lead is re-armed like ⚡ Làm ngay does (wake-now mark).
        let marks = idle::read_json(&idle::state_dir(&h).join("wake-now.json")).unwrap();
        assert!(marks[format!("{}|lead", auto::canon(&root).to_string_lossy())].as_u64().is_some(), "the lead is woken");
        assert!(inbox(&h, LEAD).contains("[HQ /hq-auto-ship] Vòng 2 · trọng tâm: perf"), "{}", inbox(&h, LEAD));
        assert!(inbox(&h, &rooms[1].1).is_empty(), "only the lead");
        assert_eq!((get(&h, &root).unwrap()["leads"].clone(), get(&h, &root).unwrap()["log"][0].clone()), (json!([LEAD]), json!({"round": 1, "added": 1, "merged": 0})));
        // Usage resting or the guard holding: skipped, not cancelled — the loop stays on.
        let t3 = 1000 + 3 * ROUND_GAP_S;
        assert!(tick(&h, &root, &rooms, true, false, t3).is_none(), "usage rests");
        assert_eq!(shown(true, t3), json!("usage"));
        assert!(tick(&h, &root, &rooms, false, true, t3).is_none(), "the guard holds the project");
        assert_eq!(why(false, true, t3), Some("guard"));
        assert!(get(&h, &root).is_some(), "still on");
        // The lead has not read the brief: the next round waits for it (round/last unchanged).
        assert!(tick(&h, &root, &rooms, false, false, t3).is_none(), "brief unread");
        assert_eq!(shown(false, t3), json!("lead"));
        assert_eq!(get(&h, &root).unwrap()["round"].as_u64(), Some(2));
        // No round limit: it keeps going as long as the rounds find work.
        let mut at = t3;
        for n in 3..8u64 {
            read_inbox(&h);
            ship_card(&h, &root, at + 100);
            at += ROUND_GAP_S;
            // Round 3 counts the card round 2's own send left behind (t2) plus this ship_card.
            let yield_n = if n == 3 { "+2 card, 1 merge" } else { "+1 card, 1 merge" };
            assert_eq!(tick(&h, &root, &rooms, false, false, at).unwrap(), format!("auto-ship vòng {n} → lead (vòng {}: {yield_n})", n - 1), "at {at}");
        }
        assert_eq!(get(&h, &root).unwrap()["log"].as_array().unwrap().len(), 6);
        read_inbox(&h);
        auto::mark_paused(&h, 1000).unwrap();
        assert!(tick(&h, &root, &rooms, false, false, 1000 + 20 * ROUND_GAP_S).is_none(), "auto paused");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn two_empty_rounds_park_it_until_the_owner_wakes_it() {
        let (h, root) = tmp("park");
        let rooms = rooms();
        running(&h, &root);
        on(&h, &root, None, 1000).unwrap();
        let mut at = 1000 + ROUND_GAP_S;
        // Round 1 found nothing: round 2 still goes out.
        assert_eq!(tick(&h, &root, &rooms, false, false, at).unwrap(), "auto-ship vòng 2 → lead (vòng 1: +0 card, 0 merge)");
        read_inbox(&h);
        at += ROUND_GAP_S;
        // Round 2 found nothing either: parked, no round 3.
        assert!(tick(&h, &root, &rooms, false, false, at).unwrap().starts_with("auto-ship nghỉ"));
        assert!(inbox(&h, LEAD).is_empty(), "no brief");
        let l = get(&h, &root).unwrap();
        assert_eq!((l["round"].as_u64(), l["parked"].as_bool(), l["last"].as_u64()), (Some(2), Some(true), Some(1000 + ROUND_GAP_S)));
        assert_eq!(view(&h, false, at + 4 * ROUND_GAP_S)[key(&root)]["next_reason"], json!("idle"));
        assert!(tick(&h, &root, &rooms, false, false, at + 4 * ROUND_GAP_S).is_none(), "parked stays parked");
        // The owner wrote: it runs again (the counter restarts).
        assert!(wake(&h, &root, at + 5 * ROUND_GAP_S));
        assert_eq!(tick(&h, &root, &rooms, false, false, at + 5 * ROUND_GAP_S).unwrap(), "auto-ship vòng 3 → lead (vòng 2: +0 card, 0 merge)");
        // A loop out of auto's scope says so.
        super::super::team::set_team_root(&h, &root, false);
        assert_eq!(view(&h, false, at)[key(&root)]["next_reason"], json!("scope"));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn the_brief_names_every_check_the_focus_and_how_to_stop() {
        let b = brief(Some("UX mobile"), 4);
        assert!(b.starts_with("[HQ /hq-auto-ship] Vòng 4 · trọng tâm: UX mobile"));
        for w in ["R&D", "Optimize", "Nâng cấp", "Cải tiến", "Check sec", "Check thiếu", "auto add", "--check", "bằng chứng", "guard", "auto loop off", "2 vòng liền"] {
            assert!(b.contains(w), "{w}");
        }
    }
}
