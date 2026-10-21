//! `8sync ccc auto loop on [trọng tâm] | off | status [--json]`: the auto-ship loop of one project
//! (HQ composer `/hq-auto-ship`, owner 2026-10-21: "loop làm liên tục"). On, the project's lead runs
//! rounds of R&D, optimize, upgrade, improve, security and gap checks, each finding a board card the
//! team builds through the normal auto flow. The next round must not depend on the lead
//! remembering, nor wait for the owner ("vô hạn … tự biết khi nào có usage … không có đợi tôi"):
//! `auto revive` ([`tick`], HQ runs it every ≤ 2 min) mails the lead the next round's brief once
//! the board has drained (no ready / building / qa / review card), at most every [`ROUND_GAP_S`].
//! It has no round limit; while the usage window / lease / budget rests, the resource guard holds
//! the project (L2/L3 or rooms it paused) or auto is off / paused, the round waits and goes out by
//! itself once that clears ([`next_reason`], shown in `auto status --json` `ship_loops`).
//! Owner-only on/off ([`super::auto::owner`]): a room cannot start or stop it.
//!
//! State: `<idle state dir>/ship-loop.json`, `{ "<canonical root>": { "focus", "since", "round", "last" } }`.

use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::{auto, idle, target};

/// Least time between two rounds (and between `on` and the first round the loop starts itself).
pub(super) const ROUND_GAP_S: u64 = 20 * 60;
/// Lanes holding work in flight: the next round waits until none has a card.
const BUSY_LANES: [&str; 4] = ["ready", "building", "qa", "review"];
const FOCUS_MAX: usize = 300;

fn file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("ship-loop.json")
}

fn key(root: &Path) -> String {
    auto::canon(root).to_string_lossy().into_owned()
}

/// The loop of `root`, or None when it is off.
pub(super) fn get(home: &Path, root: &Path) -> Option<Value> {
    idle::read_json(&file(home)).map(|v| v[key(root)].clone()).filter(Value::is_object)
}

/// Every loop by root for `auto status --json` `ship_loops`: `{on, focus, round, since, last,
/// next_reason}`; `resting` = the status' usage gate or cap holds (window ≥ 90%, lease over, $/hour).
pub(super) fn view(home: &Path, resting: bool, now: u64) -> Value {
    let mut v = idle::read_json(&file(home)).filter(Value::is_object).unwrap_or_else(|| json!({}));
    if let Some(o) = v.as_object_mut() {
        for (root, l) in o.iter_mut() {
            let p = Path::new(root);
            let why = next_reason(home, p, l, resting, super::pressure::holds(home, p), now);
            l["on"] = json!(true);
            l["next_reason"] = json!(why);
        }
    }
    v
}

/// Why the loop of `root` (state `l`) sends no round now, None = the next revive tick sends it.
/// Every reason is a wait, never an end: the loop has no round limit and fires by itself once the
/// reason clears (owner 2026-10-21: "vô hạn … tự biết khi nào có usage … không có đợi tôi").
/// `usage`: the usage window / lease / budget rests; `guard`: the resource guard holds the project
/// (L2/L3, paused rooms); `auto`: auto off or paused by the owner; `gap`: under [`ROUND_GAP_S`]
/// since the last round; `board`: cards still in flight.
pub(super) fn next_reason(home: &Path, root: &Path, l: &Value, resting: bool, guard_holds: bool, now: u64) -> Option<&'static str> {
    if !auto::running(home) {
        Some("auto")
    } else if resting {
        Some("usage")
    } else if guard_holds {
        Some("guard")
    } else if l["last"].as_u64().is_some_and(|t| now.saturating_sub(t) < ROUND_GAP_S) {
        Some("gap")
    } else if target::list(home, root).map_or(true, |cards| cards.iter().any(|t| t.state == "open" && BUSY_LANES.contains(&t.lane.as_str()))) {
        Some("board")
    } else {
        None
    }
}

/// Turn the loop on in `root` (again: the focus is replaced, the round count kept). Round 1 is the
/// brief the owner's `/hq-auto-ship` itself sent, so the loop's own next round is round 2.
pub(super) fn on(home: &Path, root: &Path, focus: Option<&str>, now: u64) -> Value {
    let focus = focus.map(str::trim).filter(|f| !f.is_empty()).map(|f| f.chars().take(FOCUS_MAX).collect::<String>());
    let mut out = Value::Null;
    super::team::update_json(&file(home), |v| {
        let k = key(root);
        let round = v[&k]["round"].as_u64().unwrap_or(1);
        v[&k] = json!({ "focus": focus, "since": v[&k]["since"].as_u64().unwrap_or(now), "round": round, "last": now });
        out = v[&k].clone();
    });
    out
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
        "[HQ /hq-auto-ship] Vòng {round}{focus}. Board đã cạn (không còn card ready/building/qa/review): lead mở vòng mới.\n\
         1. R&D: còn thiếu gì / làm tốt hơn gì so với công cụ tương tự, docs.\n\
         2. Optimize: hiệu năng, kích thước, token.\n\
         3. Nâng cấp: deps/toolchain, chỉ bản an toàn.\n\
         4. Cải tiến: UX, chất lượng code.\n\
         5. Check sec: secret, audit deps, OWASP trên diff gần đây.\n\
         6. Check thiếu: test, docs, đường lỗi, tính năng làm dở.\n\
         Mỗi phát hiện → MỘT card nhỏ: `8sync ccc auto add \"<việc>\" --check \"<lệnh kiểm>\"`; team build/review/merge theo luồng auto thường.\n\
         Luật: card nhỏ; \"xong\" phải có bằng chứng (lệnh kiểm + kết quả); không thao tác phá huỷ; tôn trọng guard CPU/RAM của owner; không release ngoài cổng thường của team. \
         Hết card vòng này thì thôi, 8sync tự gửi vòng kế. Dừng: owner nói \"dừng\" hoặc `/hq-stop` (`8sync ccc auto loop off`)."
    )
}

/// One revive tick for `root`: when the loop is on and nothing holds it back ([`next_reason`]:
/// auto runs, usage does not rest, the guard does not hold the project, the last round is at least
/// [`ROUND_GAP_S`] old, the board has drained), mail the next round's brief to the lead rooms of
/// `rooms` (registry `(name, conversation id)`). Returns the line for the revive report, None when
/// nothing was sent.
pub(super) fn tick(home: &Path, root: &Path, rooms: &[(String, String)], resting: bool, guard_holds: bool, now: u64) -> Option<String> {
    let l = get(home, root)?;
    if next_reason(home, root, &l, resting, guard_holds, now).is_some() {
        return None;
    }
    let leads: Vec<&(String, String)> = rooms.iter().filter(|(n, _)| super::room::crew(n) == "lead").collect();
    if leads.is_empty() {
        return None;
    }
    let round = l["round"].as_u64().unwrap_or(1) + 1;
    let text = brief(l["focus"].as_str(), round);
    let sent: Vec<&str> = leads.iter().filter(|(_, id)| crate::verbs::hq::queue_inbox(home, id, &text, now * 1000).is_ok()).map(|(n, _)| n.as_str()).collect();
    if sent.is_empty() {
        return None;
    }
    super::team::update_json(&file(home), |v| {
        let k = key(root);
        // Turned off meanwhile: stays off.
        if v[&k].is_object() {
            v[&k]["round"] = json!(round);
            v[&k]["last"] = json!(now);
        }
    });
    Some(format!("auto-ship vòng {round} → {}", sent.join(", ")))
}

/// `auto loop on [trọng tâm…] | off | status [--json]` in `root`; `owner`: [`auto::owner`] of the caller.
pub(super) fn run(args: &[String], home: &Path, root: &Path, owner: bool, now: u64) -> Result<()> {
    let as_json = args.iter().any(|a| a == "--json");
    let words: Vec<&str> = args.iter().map(String::as_str).filter(|a| *a != "--json" && *a != "--").collect();
    let line = |l: &Value| {
        let focus = l["focus"].as_str().map(|f| format!(", trọng tâm: {f}")).unwrap_or_default();
        format!("auto-ship: BẬT, vòng {}{focus} (vòng kế khi board cạn, cách nhau ≥ {} phút)", l["round"].as_u64().unwrap_or(1), ROUND_GAP_S / 60)
    };
    match words.split_first() {
        Some((&"on", rest)) => {
            if !owner {
                bail!("chỉ owner bật auto-ship (HQ `/hq-auto-ship` hoặc terminal của owner), không phải một phòng");
            }
            let focus = rest.join(" ");
            let l = on(home, root, Some(&focus), now);
            if as_json {
                println!("{}", json!({ "loop": l }));
            } else {
                println!("{}", line(&l));
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
        _ => bail!("loop: on [trọng tâm] | off | status [--json]"),
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

    #[test]
    fn on_off_status_and_owner_only() {
        let (h, root) = tmp("onoff");
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(get(&h, &root).is_none());
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
        assert!(run(&a(&["off"]), &h, &root, false, 60).is_err(), "a room cannot stop it");
        assert!(get(&h, &root).is_some());
        run(&a(&["off"]), &h, &root, true, 60).unwrap();
        assert!(get(&h, &root).is_none());
        assert!(!off(&h, &root), "already off");
        assert!(run(&a(&["bogus"]), &h, &root, true, 60).is_err());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn next_round_only_when_drained_spaced_and_nothing_rests_and_it_never_ends() {
        let (h, root) = tmp("tick");
        let rooms = vec![("lead".to_string(), "a1830544-0719-4d6f-aaa3-644783ddb0b5".to_string()), ("dev".to_string(), "a2830544-0719-4d6f-aaa3-644783ddb0b5".to_string())];
        let inbox = |i: usize| std::fs::read_to_string(crate::verbs::hq::inbox_file(&h, &rooms[i].1).unwrap()).unwrap_or_default();
        let why = |resting: bool, holds: bool, at: u64| next_reason(&h, &root, &get(&h, &root).unwrap(), resting, holds, at);
        let shown = |resting: bool, at: u64| view(&h, resting, at)[key(&root)]["next_reason"].clone();
        assert!(tick(&h, &root, &rooms, false, false, 5000).is_none(), "loop off");
        on(&h, &root, Some("perf"), 1000);
        assert!(tick(&h, &root, &rooms, false, false, 5000).is_none(), "auto off");
        assert_eq!(why(false, false, 5000), Some("auto"));
        auto::set(&h, auto::Mode::On { hours: 2.0, after: 60, rate: None, repo: None }, false, 1000).unwrap();
        assert!(tick(&h, &root, &rooms, false, false, 1000 + ROUND_GAP_S - 1).is_none(), "under 20 min since on");
        assert_eq!(why(false, false, 1000 + ROUND_GAP_S - 1), Some("gap"));
        // A card in flight: the round waits.
        let (t, _) = target::add(&h, &root, "fix crash", Some("true"), None, false, None, 1000).unwrap();
        assert_eq!(target::list(&h, &root).unwrap()[0].lane, "ready");
        assert!(tick(&h, &root, &rooms, false, false, 1000 + ROUND_GAP_S).is_none(), "a ready card");
        assert_eq!(shown(false, 1000 + ROUND_GAP_S), json!("board"));
        target::close(&h, &root, t.id, Some("cargo test: ok"), None, 1000).unwrap();
        // Usage resting or the guard holding: skipped, not cancelled — the loop stays on.
        assert!(tick(&h, &root, &rooms, true, false, 1000 + ROUND_GAP_S).is_none(), "usage rests");
        assert_eq!(shown(true, 1000 + ROUND_GAP_S), json!("usage"));
        assert!(tick(&h, &root, &rooms, false, true, 1000 + ROUND_GAP_S).is_none(), "the guard holds the project");
        assert_eq!(why(false, true, 1000 + ROUND_GAP_S), Some("guard"));
        assert!(get(&h, &root).is_some(), "still on");
        assert_eq!(shown(false, 1000 + ROUND_GAP_S), Value::Null, "due");
        let line = tick(&h, &root, &rooms, false, false, 1000 + ROUND_GAP_S).unwrap();
        assert_eq!(line, "auto-ship vòng 2 → lead");
        assert!(inbox(0).contains("[HQ /hq-auto-ship] Vòng 2 · trọng tâm: perf"), "{}", inbox(0));
        assert!(inbox(1).is_empty(), "only the lead");
        assert_eq!(get(&h, &root).unwrap()["round"].as_u64(), Some(2));
        assert!(tick(&h, &root, &rooms, false, false, 1000 + ROUND_GAP_S + 60).is_none(), "debounced");
        // No round limit: it keeps going as long as the board drains.
        for n in 3..8u64 {
            assert_eq!(tick(&h, &root, &rooms, false, false, 1000 + (n - 1) * ROUND_GAP_S).unwrap(), format!("auto-ship vòng {n} → lead"));
        }
        auto::mark_paused(&h, 1000).unwrap();
        assert!(tick(&h, &root, &rooms, false, false, 1000 + 20 * ROUND_GAP_S).is_none(), "auto paused");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn the_brief_names_every_check_the_focus_and_how_to_stop() {
        let b = brief(Some("UX mobile"), 4);
        assert!(b.starts_with("[HQ /hq-auto-ship] Vòng 4 · trọng tâm: UX mobile"));
        for w in ["R&D", "Optimize", "Nâng cấp", "Cải tiến", "Check sec", "Check thiếu", "auto add", "--check", "bằng chứng", "guard", "auto loop off"] {
            assert!(b.contains(w), "{w}");
        }
    }
}
