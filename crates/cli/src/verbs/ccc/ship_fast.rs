//! `8sync ccc auto ship-fast on [--hours N] | off | status [--json]`: the owner's "Ship tốc độ cao"
//! button (owner 2026-10-21: "nút mà all members in room đẩy nhanh tốc độ push, merge, build, check
//! test, release sản phẩm nhanh nhất ít lỗi" — Sấm Sét stays what it is, adding headcount).
//! While it is on, the whole team lands work nearest-done first: review/qa clear their lanes before
//! anything new, builders stop pulling fresh feature cards while ≥ [`HOLD_AT`] cards wait in
//! qa/review/approved, every card still goes through its check and CI, and the lead asks the owner's
//! one-tap Ship as soon as cards approve (the merge consent stays the owner's, `grant.rs`).
//! Nothing here skips a gate: it reorders effort and removes idle gaps, it does not release.
//!
//! `on` writes `<idle state dir>/ship-fast.json` for the project (`{since, until}`) and mails+wakes
//! every room of the project with the sprint brief. The revive tick ends it when no card is left in
//! ready/building/qa/review (approved cards wait for the owner's Ship) or at `until`, and tells the
//! owner once via `alert_owner`. Owner-only, like every owner button.

use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use super::{auto, idle, target};

/// Default and maximum sprint length (hours). `--hours 0.5..4`.
pub(super) const DEFAULT_HOURS: f64 = 2.0;
const MAX_HOURS: f64 = 4.0;
/// While this many cards wait in qa/review/approved, builders take no fresh feature card.
pub(super) const HOLD_AT: usize = 3;
/// Lanes whose cards still need the team (approved waits for the owner's Ship, not the team).
const TEAM_LANES: [&str; 4] = ["ready", "building", "qa", "review"];

fn file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("ship-fast.json")
}

fn key(root: &Path) -> String {
    auto::canon(root).to_string_lossy().into_owned()
}

/// The sprint of `root`, None when it is off (or expired: callers see it end via [`tick`]).
pub(super) fn get(home: &Path, root: &Path) -> Option<Value> {
    let l = idle::read_json(&file(home)).map(|v| v[key(root)].clone()).filter(Value::is_object)?;
    l["until"].as_u64().map(Some).unwrap_or(None)?;
    Some(l)
}

/// Every sprint by root for `auto status --json` `ship_fast`: `{on, since, until}` (an expired one
/// stays listed until its tick ends it, so HQ can show why it just ended).
pub(super) fn view(home: &Path, now: u64) -> Value {
    let v = idle::read_json(&file(home)).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let mut out = serde_json::Map::new();
    if let Some(o) = v.as_object() {
        for (root, l) in o {
            if let Some(until) = l["until"].as_u64().filter(|u| *u > now) {
                out.insert(root.clone(), json!({ "on": true, "since": l["since"].as_u64(), "until": until }));
            }
        }
    }
    Value::Object(out)
}

/// The brief every room of the project gets when the sprint starts.
pub(super) fn brief(left_min: u64) -> String {
    format!(
        "[🚀 owner] Ship tốc độ cao ({left_min} phút): cả team dồn land việc, nhanh nhất mà vẫn ít lỗi.\n\
         1. Card gần xong trước: approved → review → qa → building; không bắt đầu tính năng mới khi còn card gần xong.\n\
         2. review/qa dọn cột mình trước tiên; builder sửa finding của review/CI trước khi lấy card mới (≥ {HOLD_AT} card đang chờ qa/review/approved thì không lấy card feature mới).\n\
         3. PR nhỏ, chạy lệnh kiểm của card + test liên quan trước khi push; CI xanh mới merge theo luồng thường.\n\
         4. Card approved: lead hỏi Ship ngay (AskUserQuestion một chạm) để owner bấm — owner mới được merge/release.\n\
         Không bỏ cổng nào: chỉ đổi thứ tự và bỏ chỗ đứng chết. Hết giờ hoặc hết card thì 8sync báo owner."
    )
}

/// `auto ship-fast on`: owner-only. Writes the sprint and returns the brief's header line.
pub(super) fn on(home: &Path, root: &Path, hours: f64, rooms: &[(String, String)], now: u64) -> Result<(u64, usize)> {
    if !(0.5..=MAX_HOURS).contains(&hours) {
        bail!("--hours 0.5..{MAX_HOURS}");
    }
    let until = now + (hours * 3600.0) as u64;
    super::team::update_json(&file(home), |v| {
        v[key(root)] = json!({ "since": now, "until": until });
    });
    let text = brief(((until - now) / 60).max(1));
    let sent: Vec<String> = rooms.iter().filter(|(_, id)| crate::verbs::hq::queue_inbox(home, id, &text, now * 1000).is_ok()).map(|(n, _)| n.clone()).collect();
    if !sent.is_empty() {
        super::team::ask_wake(home, root, &sent, now);
    }
    Ok((until, sent.len()))
}

/// `auto ship-fast off`: owner-only. Whether a sprint was on.
pub(super) fn off(home: &Path, root: &Path) -> bool {
    let mut was = false;
    super::team::update_json(&file(home), |v| {
        if let Some(o) = v.as_object_mut() {
            was = o.remove(&key(root)).is_some();
        }
    });
    was
}

/// One revive tick: end the sprint when no card needs the team or time is up, and tell the owner
/// once. Returns the line for the revive report, None when the sprint simply continues.
pub(super) fn tick(home: &Path, root: &Path, now: u64) -> Option<String> {
    let l = get(home, root)?;
    let (until, since) = (l["until"].as_u64()?, l["since"].as_u64().unwrap_or(now));
    let cards = target::list(home, root).unwrap_or_default();
    let waiting: Vec<&target::Target> = cards.iter().filter(|t| t.state == "open" && TEAM_LANES.contains(&t.lane.as_str())).collect();
    let approved = cards.iter().filter(|t| t.state == "open" && t.lane == "approved").count();
    let expired = now >= until;
    // "Done" = everything the team could land has landed (approved waits for the owner's Ship).
    // A board with nothing at all stays on until `until`: the owner just pressed the button.
    if !expired && !(waiting.is_empty() && approved >= 1) {
        return None;
    }
    if !off(home, root) {
        return None; // another revive already ended it and alerted
    }
    let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let title = if expired {
        format!("Ship tốc độ cao hết giờ: {name}")
    } else {
        format!("Ship tốc độ cao xong: {name}")
    };
    let text = format!(
        "{} — còn {} card đang chạy (qa/review/building), {} card approved chờ anh bấm Ship. Bấm lại Ship tốc độ cao để tiếp, hoặc để team chạy nhịp thường.",
        if expired { "Hết giờ sprint" } else { "Hết card cần team" },
        waiting.len(),
        approved
    );
    let _ = since;
    let _ = crate::verbs::hq::alert_owner(&title, &text);
    Some(format!("ship-fast hết: {title}"))
}

/// The board's approved cards waiting for the owner's Ship.
fn approved_cards(home: &Path, root: &Path) -> Vec<target::Target> {
    target::list(home, root).unwrap_or_default().into_iter().filter(|t| t.state == "open" && t.lane == "approved").collect()
}

/// `auto ship-ask` and the revive tick's watch: the lead is told to ask the owner's one-tap Ship
/// (owner 2026-10-21: "bảng approve bị kẹt nhiều quá … nên có nút để tiện bấm ship"). Only when
/// cards wait and no self-merge grant holds (with one, `merge::background` is already landing
/// them); at most once every [`NUDGE_S`] per project. Returns the line for the report, None when
/// nothing to do.
/// `omp`: the team is omp rooms, which cannot ask the owner (the grant is read from a Claude Code
/// transcript): the owner gets one HQ alert instead, same debounce.
pub(super) fn ask_ship(home: &Path, root: &Path, registry: &[(String, String)], omp: bool, now: u64) -> Option<String> {
    const NUDGE_S: u64 = 30 * 60;
    let approved = approved_cards(home, root);
    if approved.is_empty() || super::grant::self_merge(&super::grant::dir(home), root, now).is_some() {
        return None;
    }
    let k = key(root);
    let mut due = false;
    super::team::update_json(&file(home), |v| {
        due = v[&k]["nudge"].as_u64().is_none_or(|at| now.saturating_sub(at) >= NUDGE_S);
        if due {
            v[&k]["nudge"] = json!(now);
        }
    });
    if !due {
        return None;
    }
    if omp {
        let name = root.file_name().map_or_else(|| root.display().to_string(), |n| n.to_string_lossy().into_owned());
        let text = format!("{} card approved ở {name} chờ Ship: bấm \"Ship card approved\" trên HQ (đội omp không hỏi được câu Ship).", approved.len());
        return crate::verbs::hq::alert_owner("Ship", &text).ok().map(|()| format!("ship-ask: {} card approved → owner (HQ)", approved.len()));
    }
    let leads: Vec<(String, String)> = registry.iter().filter(|(n, _)| super::room::crew(n) == "lead").cloned().collect();
    if leads.is_empty() {
        return None;
    }
    let text = format!(
        "[🚀 owner] {} card approved đang chờ Ship: hỏi owner MỘT câu AskUserQuestion header \"Ship\" gom mọi card approved (option \"Duyệt tất cả (Recommended)\" | \"Chỉ merge, chưa deploy\" | \"Chỉ merge, tự merge 24h\" | \"Dừng\") NGAY lượt này, trước `auto wait`; owner duyệt xong `8sync ccc auto merge` tự land.",
        approved.len()
    );
    let sent: Vec<String> = leads.iter().filter(|(_, id)| crate::verbs::hq::queue_inbox(home, id, &text, now * 1000).is_ok()).map(|(n, _)| n.clone()).collect();
    if sent.is_empty() {
        return None;
    }
    super::team::ask_wake(home, root, &sent, now);
    Some(format!("ship-ask: {} card approved → {}", approved.len(), sent.join(", ")))
}

/// Whether builders of `root` hold off fresh feature cards ([`HOLD_AT`] or more waiting in
/// qa/review/approved). Read by `target::claim`.
pub(super) fn holding(home: &Path, root: &Path, cards: &[target::Target]) -> bool {
    get(home, root).is_some() && cards.iter().filter(|t| t.state == "open" && matches!(t.lane.as_str(), "qa" | "review")).count() >= HOLD_AT
}

/// `8sync ccc auto ship-fast on [--hours N] | off | status [--json]` in `root`; `owner`:
/// [`super::auto::owner`] of the caller (the HQ button is the owner).
pub(super) fn run(args: &[String], home: &Path, root: &Path, owner: bool, rooms: &[(String, String)], now: u64) -> Result<()> {
    let as_json = args.iter().any(|a| a == "--json");
    let words: Vec<&str> = args.iter().map(String::as_str).filter(|a| *a != "--json").collect();
    let hours = |rest: &[&str]| -> Result<f64> {
        match rest.iter().position(|a| *a == "--hours") {
            Some(i) => rest.get(i + 1).map(|n| n.parse::<f64>()).transpose()?.ok_or_else(|| anyhow::anyhow!("--hours cần một số")),
            None => Ok(DEFAULT_HOURS),
        }
    };
    match words.split_first() {
        Some((&"on", rest)) => {
            if !owner {
                bail!("chỉ owner bật Ship tốc độ cao (nút HQ), không phải một phòng");
            }
            let (until, sent) = on(home, root, hours(rest)?, rooms, now)?;
            if as_json {
                println!("{}", json!({ "until": until, "sent": sent }));
            } else {
                println!("Ship tốc độ cao: BẬT, {} phút, brief tới {sent} phòng", (until - now) / 60);
                println!("{}", brief(((until - now) / 60).max(1)));
            }
        }
        Some((&"ship-ask", []) | (&"ask", [])) => {
            if !owner {
                bail!("chỉ owner yêu cầu Ship (nút HQ)");
            }
            // The verb reports and leaves the mailing to the next revive tick (it has the registry);
            // force it due now so that tick is the very next one.
            super::team::update_json(&file(home), |v| {
                v[key(root)]["nudge"] = json!(0);
            });
            let line = None::<String>;
            if as_json {
                println!("{}", json!({ "asked": line.is_some(), "line": line }));
            } else {
                println!("{}", line.unwrap_or_else(|| "không có card approved đang chờ (hoặc lead đã được nhắc gần đây)".into()));
            }
        }
        Some((&"off", [])) => {
            if !owner {
                bail!("chỉ owner tắt Ship tốc độ cao");
            }
            let was = off(home, root);
            if as_json {
                println!("{}", json!({ "was_on": was }));
            } else {
                println!("Ship tốc độ cao: {}", if was { "TẮT" } else { "đang không bật" });
            }
        }
        _ => {
            let l = get(home, root);
            if as_json {
                println!("{}", json!({ "ship_fast": l }));
            } else {
                println!(
                    "Ship tốc độ cao: {}",
                    l.as_ref().and_then(|l| l["until"].as_u64()).map_or("TẮT".to_string(), |u| format!("BẬT, còn {} phút", u.saturating_sub(now) / 60))
                );
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let h = std::env::temp_dir().join(format!("shipfast-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(&h).unwrap();
        let root = h.join("r");
        std::fs::create_dir_all(&root).unwrap();
        (h, root)
    }

    fn card(h: &std::path::Path, root: &std::path::Path, text: &str, lane: &str, at: u64) -> u64 {
        let (t, _) = target::add(h, root, text, Some("true"), None, false, None, at).unwrap();
        if lane != "ready" {
            target::move_to(h, root, t.id, lane, &target::Move::default(), None, at).unwrap();
        }
        t.id
    }

    #[test]
    fn on_off_status_is_owner_only_and_bounded() {
        let (h, root) = tmp("verbs");
        assert!(run(&["on".into()], &h, &root, false, &vec![], 100).is_err(), "a room cannot start it");
        run(&["on".into(), "--hours".into(), "2".into()], &h, &root, true, &vec![], 100).unwrap();
        let l = get(&h, &root).unwrap();
        assert_eq!((l["since"].as_u64(), l["until"].as_u64()), (Some(100), Some(100 + 2 * 3600)));
        assert!(run(&["on".into(), "--hours".into(), "9".into()], &h, &root, true, &vec![], 100).is_err(), "over the cap");
        assert!(run(&["off".into()], &h, &root, false, &vec![], 100).is_err(), "a room cannot stop it");
        assert!(off(&h, &root));
        assert!(get(&h, &root).is_none());
        let _ = std::fs::remove_dir_all(&h);
    }

    /// Approved cards pile up → the lead is told to ask the owner's Ship, at most every 30 min.
    #[test]
    fn approved_pile_up_nudges_the_lead_once_per_half_hour() {
        let (h, root) = tmp("ask");
        let reg = vec![("lead".to_string(), "11111111-1111-4111-8111-111111111111".to_string())];
        assert!(ask_ship(&h, &root, &reg, false, 100).is_none(), "nothing approved");
        let a = card(&h, &root, "done thing", "ready", 100);
        for (step, m) in [
            ("building", target::Move::default()),
            ("qa", target::Move::default()),
            ("review", target::Move::default()),
            ("approved", target::Move { sha: Some("0d596904e5cbf53f94fbc8198fcd9b0f9848866e"), ..Default::default() }),
        ] {
            target::move_to(&h, &root, a, step, &m, None, 150).unwrap();
        }
        let line = ask_ship(&h, &root, &reg, false, 200).expect("nudged");
        assert!(line.contains("1 card approved") && line.contains("lead"), "{line}");
        assert!(ask_ship(&h, &root, &reg, false, 300).is_none(), "debounced");
        assert!(ask_ship(&h, &root, &reg, false, 200 + 31 * 60).is_some(), "half an hour later it asks again");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn claim_holds_fresh_ready_cards_while_the_sprint_piles_up() {
        let (h, root) = tmp("claim");
        run(&["on".into()], &h, &root, true, &vec![], 100).unwrap();
        let id = card(&h, &root, "fresh", "ready", 150);
        for (n, lane) in [("a", "qa"), ("b", "review"), ("d", "qa")] {
            let c = card(&h, &root, n, "ready", 150);
            let steps = 2 + ["qa", "review"].iter().position(|l| *l == lane).unwrap();
            for step in ["building", "qa", "review"].iter().take(steps) {
                target::move_to(&h, &root, c, step, &target::Move::default(), None, 150).unwrap();
            }
        }
        assert!(holding(&h, &root, &target::list(&h, &root).unwrap()), "3 waiting");
        assert!(target::claim(&h, &root, "dev", "ready", 200).is_ok_and(|t| t.is_none()), "holding: no fresh card");
        assert!(target::claim(&h, &root, "qa", "qa", 200).is_ok_and(|t| t.is_some()), "qa still takes its lane");
        off(&h, &root);
        assert!(target::claim(&h, &root, "dev", "ready", 300).is_ok_and(|t| t.is_some_and(|t| t.id == id)), "sprint over: the builder takes it");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn builders_hold_while_qa_review_approved_pile_up() {
        let (h, root) = tmp("hold");
        run(&["on".into()], &h, &root, true, &vec![], 100).unwrap();
        assert!(!holding(&h, &root, &target::list(&h, &root).unwrap()), "nothing waiting");
        for (n, lane) in [("a", "qa"), ("b", "review"), ("d", "qa")] {
            let id = card(&h, &root, n, "ready", 150);
            let steps = 2 + ["qa", "review"].iter().position(|l| *l == lane).unwrap();
            for step in ["building", "qa", "review"].iter().take(steps) {
                target::move_to(&h, &root, id, step, &target::Move::default(), None, 150).unwrap();
            }
        }
        assert!(holding(&h, &root, &target::list(&h, &root).unwrap()), "3 waiting: builders take no fresh card");
        let approved_only: Vec<target::Target> = target::list(&h, &root).unwrap().into_iter().map(|mut t| { if matches!(t.lane.as_str(), "qa" | "review") { t.lane = "approved".into(); } t }).collect();
        assert!(!holding(&h, &root, &approved_only), "approved does not freeze builders");
        off(&h, &root);
        assert!(!holding(&h, &root, &target::list(&h, &root).unwrap()), "sprint over: normal order");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn tick_ends_it_when_the_team_is_done_or_time_is_up_and_alerts_once() {
        let (h, root) = tmp("tick");
        run(&["on".into()], &h, &root, true, &vec![], 1000).unwrap();
        assert!(tick(&h, &root, 2000).is_none(), "nothing to do yet but time remains: continues");
        let a = card(&h, &root, "fix", "ready", 1200);
        target::move_to(&h, &root, a, "building", &target::Move::default(), None, 1200).unwrap();
        assert!(tick(&h, &root, 2000).is_none(), "a card in flight");
        for (step, m) in [
            ("qa", target::Move::default()),
            ("review", target::Move::default()),
            ("approved", target::Move { sha: Some("0d596904e5cbf53f94fbc8198fcd9b0f9848866e"), ..Default::default() }),
        ] {
            target::move_to(&h, &root, a, step, &m, None, 2500).unwrap();
        }
        let line = tick(&h, &root, 3000).expect("done: only approved waits for the owner");
        assert!(line.contains("xong"), "{line}");
        assert!(get(&h, &root).is_none(), "ended");
        assert!(tick(&h, &root, 4000).is_none(), "no second alert");
        run(&["on".into()], &h, &root, true, &vec![], 5000).unwrap();
        let b = card(&h, &root, "long", "ready", 5100);
        target::move_to(&h, &root, b, "building", &target::Move::default(), None, 5100).unwrap();
        assert!(tick(&h, &root, 5000 + 3 * 3600).unwrap().contains("hết giờ"), "expired with work left");
        let _ = std::fs::remove_dir_all(&h);
    }
}
