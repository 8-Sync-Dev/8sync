//! "Lease liên tục" and "ghim dự án" (owner 2026-10-21: "có nút auto lease liên tục biết usage có là
//! chạy đi không đợi; có nút ghim dự án quan trọng cần lease tập trung vào đó").
//!
//! `8sync ccc auto lease auto on|off` (owner only, marker `lease_auto`, default off) keeps the idle
//! lease ([`idle::on`]) alive:
//! - API key: every `auto revive` tick renews it ([`renew`]) once less than [`RENEW_LEFT_S`] is left,
//!   while the $/hour budget ([`idle::cap`]) does not rest: the budget is the usage limit.
//! - Subscription: only a fresh owner action renews it, never the clock alone: `auto lease renew`
//!   (HQ calls it on an owner POST, at most every 5 min: apps/hq-ui lib/server/lease-touch.ts), or a
//!   prompt the owner typed in the last [`idle::PRESENT_S`] ([`presence`], the signal the idle and
//!   wake hooks already use). The lease never reaches past now + 4 h. Unattended automated use
//!   belongs on a Console API key (Consumer Terms; `assets/skills/aup-audit/8sync-anthropic-rules.md`).
//!
//! Pins: `8sync ccc auto pin [<root>] | unpin [<root>] | pins [--json]` (owner only), machine-wide
//! in `pinned-roots.json` next to `team-roots.json` (`{ "<root>": <pinned at> }`). While usage is
//! tight ([`tight`]) only pinned projects work ([`focus_why`]: revive, claim, wait, loops and the idle
//! hook rest the others); with usage loose everything runs, pinned projects first in revive's order.
//! Nothing pinned: no change.
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::{auto, idle};

/// The tick renews a lease with less than this left.
pub(super) const RENEW_LEFT_S: u64 = 30 * 60;
/// Usage counts as tight from these window readings (%): only pinned projects work.
pub(super) const TIGHT_5H: f64 = 70.0;
pub(super) const TIGHT_7D: f64 = 80.0;

const USAGE: &str = "usage: 8sync ccc auto lease auto on|off | lease renew [--json] | pin [<thư mục dự án>] | unpin [<thư mục dự án>] | pins [--json]";

fn pins_file(home: &Path) -> PathBuf {
    idle::state_dir(home).join("pinned-roots.json")
}

/// A root as the pin list keeps it: canonical, without the `\\?\` prefix.
fn key(root: &Path) -> String {
    auto::canon(root).to_string_lossy().trim_start_matches(r"\\?\").to_string()
}

/// Pinned roots, oldest pin first.
pub(super) fn pins(home: &Path) -> Vec<String> {
    let v = idle::read_json(&pins_file(home)).unwrap_or_default();
    let mut out: Vec<(u64, String)> = v.as_object().into_iter().flatten().map(|(k, at)| (at.as_u64().unwrap_or(0), k.clone())).collect();
    out.sort();
    out.into_iter().map(|(_, k)| k).collect()
}

fn same(a: &str, b: &Path) -> bool {
    auto::canon(Path::new(a)) == auto::canon(b)
}

pub(super) fn pinned(home: &Path, root: &Path) -> bool {
    pins(home).iter().any(|p| same(p, root))
}

/// Pin or unpin `root`; whether the list changed (idempotent).
pub(super) fn set_pin(home: &Path, root: &Path, on: bool, now: u64) -> bool {
    let k = key(root);
    let mut changed = false;
    super::team::update_json(&pins_file(home), |v| {
        let Some(o) = v.as_object_mut() else { return };
        let had: Vec<String> = o.keys().filter(|x| same(x, root)).cloned().collect();
        if on {
            if had.is_empty() {
                o.insert(k, json!(now));
                changed = true;
            }
        } else {
            for x in had {
                o.remove(&x);
                changed = true;
            }
        }
    });
    changed
}

/// Revive's order: pinned roots first (oldest pin first), the rest as listed.
pub(super) fn revive_order(home: &Path, roots: Vec<String>) -> Vec<String> {
    let p = pins(home);
    let rank = |r: &String| p.iter().position(|x| same(x, Path::new(r))).unwrap_or(usize::MAX);
    let mut roots = roots;
    roots.sort_by_key(rank);
    roots
}

/// Usage is tight: the 5-hour window at [`TIGHT_5H`]% or the 7-day one at [`TIGHT_7D`]%.
pub(super) fn tight(u: &idle::Usage) -> bool {
    u.five_hour.is_some_and(|p| p >= TIGHT_5H) || u.seven_day.is_some_and(|p| p >= TIGHT_7D)
}

/// Pure: why `root` rests to leave the usage to the pinned projects; None = it works.
pub(super) fn focus_why(pins: &[String], root: &Path, u: &idle::Usage) -> Option<String> {
    if pins.is_empty() || !tight(u) || pins.iter().any(|p| same(p, root)) {
        return None;
    }
    let pct = |p: Option<f64>| p.map_or("?".into(), |p| format!("{p:.0}%"));
    Some(format!("nhường usage cho dự án ghim (usage 5 giờ {} · 7 ngày {}; chạy lại khi usage hạ hoặc owner ghim dự án này)", pct(u.five_hour), pct(u.seven_day)))
}

/// [`focus_why`] from the files: `root` = a project root or any folder inside it (a worktree, a
/// hook's cwd), resolved to its repo.
pub(super) fn focus_rest(home: &Path, root: &Path, now: u64) -> Option<String> {
    let p = pins(home);
    if p.is_empty() {
        return None;
    }
    let repo = crate::verbs::here::repo_of(root).unwrap_or_else(|| root.to_path_buf());
    let lease = idle::read_json(&idle::state_dir(home).join("lease.json"));
    focus_why(&p, &repo, &idle::usage(home, lease.as_ref(), now))
}

/// Pure: whether the revive tick renews the lease now. `on` = lease liên tục on, `running` = auto on
/// and not paused, `cap_ok` = the usage rail ([`idle::cap`]) does not rest, `seen` = when the owner
/// last typed a prompt (asked on a subscription only).
pub(super) fn renew_due(on: bool, running: bool, subscription: bool, lease: Option<&Value>, cap_ok: bool, seen: impl FnOnce() -> Option<u64>, now: u64) -> bool {
    let Some(l) = lease.filter(|_| on && running && cap_ok) else { return false };
    if l["until"].as_u64().unwrap_or(0).saturating_sub(now) >= RENEW_LEFT_S {
        return false;
    }
    !subscription || seen().is_some_and(|t| t <= now + 60 && now.saturating_sub(t) <= idle::PRESENT_S)
}

/// Push the lease's end out: subscription to now + 4 h (never further), API key by the hours of the
/// last `auto on`. Start, baseline and $ rate stay, so the $/hour budget keeps counting from the
/// first `on`. None when there is no lease.
pub(super) fn renew(home: &Path, subscription: bool, now: u64) -> Option<u64> {
    let p = idle::state_dir(home).join("lease.json");
    let mut l = idle::read_json(&p).filter(Value::is_object)?;
    let span = if subscription { idle::SUB_MAX_HOURS } else { auto::marker_hours(home) };
    let cap = now + (span * 3600.0) as u64;
    let until = if subscription { cap } else { cap.max(l["until"].as_u64().unwrap_or(0)) };
    l["until"] = json!(until);
    l["renewed_at"] = json!(now);
    idle::write_json(&p, &l);
    Some(until)
}

/// One revive tick: renew when [`renew_due`]; the line to print when it did.
pub(super) fn tick(home: &Path, subscription: bool, now: u64, seen: impl FnOnce() -> Option<u64>) -> Option<String> {
    let lease = idle::read_json(&idle::state_dir(home).join("lease.json"));
    let cap_ok = lease.as_ref().is_none_or(|l| idle::cap(l, &idle::usage(home, Some(l), now), subscription, now).is_ok());
    if !renew_due(auto::lease_auto(home), auto::running(home), subscription, lease.as_ref(), cap_ok, seen, now) {
        return None;
    }
    let until = renew(home, subscription, now)?;
    Some(format!("lease liên tục: gia hạn tới {} UTC ({})", &super::standup::utc_stamp(until)[11..16], if subscription { "owner có mặt" } else { "API key, trong ngân sách" }))
}

/// The newest prompt the owner typed in any Claude Code session written to in the last
/// [`idle::PRESENT_S`] (at most 40 transcripts, newest first; scheduled `[8sync:wake]` prompts and
/// non-human origins do not count).
pub(super) fn presence(claude_dir: &Path, now: u64) -> Option<u64> {
    let fresh = |m: &std::fs::Metadata| m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs());
    let mut files: Vec<(u64, PathBuf)> = std::fs::read_dir(claude_dir.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|d| std::fs::read_dir(d.path()).into_iter().flatten().flatten())
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| Some((fresh(&e.metadata().ok()?)?, e.path())))
        .filter(|(at, _)| now.saturating_sub(*at) <= idle::PRESENT_S)
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.iter().take(40).filter_map(|(_, f)| super::wake::owner_seen(f)).max()
}

/// `lease_rest` of `auto status --json`: why auto rests and until when; null while it runs.
/// `kind`: `usage` (a subscription window at [`idle::SUB_WINDOW_PCT`]%, `until` = its reset when the
/// status line said it, else null = "chờ usage"), `budget` ($/hour), `lease` (expired, no owner).
pub(super) fn rest_json(home: &Path, gate: Option<&str>, u: &idle::Usage, subscription: bool, now: u64) -> Value {
    let Some(g) = gate else { return Value::Null };
    let windows = [("5h", "five_hour", u.five_hour), ("7d", "seven_day", u.seven_day)];
    if let Some((label, k, p)) = windows.iter().find_map(|(l, k, p)| p.filter(|p| subscription && *p >= idle::SUB_WINDOW_PCT).map(|p| (*l, *k, p))) {
        return json!({ "kind": "usage", "window": label, "pct": p.round(), "until": resets_at(home, k, now), "text": g });
    }
    let kind = if g.contains("lease") || g.contains("owner vắng") { "lease" } else { "budget" };
    json!({ "kind": kind, "text": g, "until": null })
}

/// When the newest reading of window `w` (`five_hour` / `seven_day`) says it resets, if still ahead.
fn resets_at(home: &Path, w: &str, now: u64) -> Option<u64> {
    let pct = format!("{w}_pct");
    let snaps = super::report::load_snapshots(home);
    snaps.iter().find(|s| s[pct.as_str()].is_number())?[format!("{w}_resets_at").as_str()].as_u64().filter(|at| *at > now)
}

/// What `auto status --json` carries about the lease and the pins.
pub(super) fn status_fields(home: &Path, lease: Option<&Value>, gate: Option<&str>, u: &idle::Usage, subscription: bool, now: u64) -> Value {
    let p = pins(home);
    json!({
        "lease_auto": auto::lease_auto(home),
        "lease_renewed_at": lease.and_then(|l| l["renewed_at"].as_u64()),
        "lease_rest": rest_json(home, gate, u, subscription, now),
        "usd_per_hour": lease.and_then(|l| l["usd_per_hour"].as_f64()).or((!subscription).then_some(idle::DEFAULT_USD_PER_HOUR)),
        "focus": !p.is_empty() && tight(u),
        "pins": p,
    })
}

/// `lease …`, `pin`, `unpin`, `pins`: owner only for every change (`owner`: no `--as`, no room env).
pub(super) fn run(rest: &[String], home: &Path, subscription: bool, root: &Path, owner: bool, now: u64) -> Result<()> {
    let as_json = rest.iter().any(|a| a == "--json");
    let words: Vec<&str> = rest.iter().map(String::as_str).filter(|a| *a != "--json").collect();
    let need_owner = |what: &str| -> Result<()> {
        if owner {
            Ok(())
        } else {
            bail!("{what}: chỉ owner (terminal của owner hoặc HQ) — phòng hay `--as` không đổi được")
        }
    };
    match words.as_slice() {
        ["lease", "auto", s @ ("on" | "off")] => {
            need_owner("lease liên tục")?;
            auto::set_lease_auto(home, *s == "on", now)?;
            let line = match (*s == "on", subscription) {
                (false, _) => "lease liên tục: TẮT — lease hết hạn thì team nghỉ như cũ.".to_string(),
                (true, true) => format!("lease liên tục: BẬT — gói subscription: tự gia hạn tới {} giờ mỗi lần anh dùng HQ hoặc gõ prompt (cần anh có mặt); chạy không người trông → Console API key.", idle::SUB_MAX_HOURS),
                (true, false) => "lease liên tục: BẬT — API key: tự gia hạn khi còn < 30 phút, dừng gia hạn khi chạm ngân sách $/giờ.".to_string(),
            };
            if as_json {
                println!("{}", json!({ "lease_auto": *s == "on" }));
            } else {
                println!("{line}");
            }
            Ok(())
        }
        ["lease", "renew"] => {
            need_owner("gia hạn lease")?;
            let due = auto::lease_auto(home) && auto::running(home);
            let until = if due { renew(home, subscription, now) } else { None };
            let why = if !auto::lease_auto(home) {
                Some("lease liên tục đang tắt")
            } else if !auto::running(home) {
                Some("auto không chạy (tắt hoặc tạm dừng)")
            } else if until.is_none() {
                Some("chưa có lease (`8sync ccc auto on`)")
            } else {
                None
            };
            if as_json {
                println!("{}", json!({ "renewed": until.is_some(), "until": until, "why": why }));
            } else {
                match (until, why) {
                    (Some(u), _) => println!("lease: gia hạn tới {} UTC", &super::standup::utc_stamp(u)[11..16]),
                    (None, w) => println!("lease: không gia hạn — {}", w.unwrap_or("?")),
                }
            }
            Ok(())
        }
        [v @ ("pin" | "unpin"), more @ ..] if more.len() <= 1 => {
            need_owner("ghim dự án")?;
            let target = match more.first() {
                Some(p) => {
                    let p = Path::new(p);
                    if !p.is_dir() {
                        bail!("{} không phải thư mục", p.display());
                    }
                    crate::verbs::here::repo_of(p).unwrap_or_else(|| p.to_path_buf())
                }
                None => root.to_path_buf(),
            };
            let changed = set_pin(home, &target, *v == "pin", now);
            if as_json {
                println!("{}", json!({ "changed": changed, "pins": pins(home) }));
            } else {
                let shown = key(&target);
                match (*v == "pin", changed) {
                    (true, true) => println!("đã ghim {shown}: usage chặt thì chỉ dự án ghim chạy; revive mở phòng dự án ghim trước."),
                    (true, false) => println!("{shown} đã ghim sẵn."),
                    (false, true) => println!("đã bỏ ghim {shown}."),
                    (false, false) => println!("{shown} chưa ghim."),
                }
            }
            Ok(())
        }
        ["pins"] => {
            let p = pins(home);
            if as_json {
                println!("{}", json!({ "pins": p }));
            } else if p.is_empty() {
                println!("chưa ghim dự án nào (`8sync ccc auto pin` trong thư mục dự án).");
            } else {
                p.iter().for_each(|r| println!("📌 {r}"));
            }
            Ok(())
        }
        _ => bail!("{USAGE}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("8sync-lease-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(&h).unwrap();
        h
    }

    fn snap(home: &Path, v: Value) {
        let d = super::super::report::usage_dir(home);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(format!("{}.json", v["session_id"].as_str().unwrap())), v.to_string()).unwrap();
    }

    fn lease_until(h: &Path) -> u64 {
        idle::read_json(&idle::state_dir(h).join("lease.json")).unwrap()["until"].as_u64().unwrap()
    }

    fn on(h: &Path, subscription: bool, hours: f64, now: u64) {
        auto::set(h, auto::Mode::On { hours, after: 60, rate: None, repo: None }, subscription, now).unwrap();
    }

    /// The lease as `auto on` wrote it, with `on`/`until` moved to the fake clock.
    fn at(h: &Path, on_at: u64, until: u64) {
        let p = idle::state_dir(h).join("lease.json");
        let mut l = idle::read_json(&p).unwrap();
        l["on"] = json!(on_at);
        l["until"] = json!(until);
        idle::write_json(&p, &l);
    }

    #[test]
    fn api_key_tick_renews_near_expiry_and_stops_when_the_budget_rests() {
        let h = tmp("api");
        let t = 2_000_000;
        on(&h, false, 2.0, t);
        at(&h, t, t + 7200);
        assert_eq!(tick(&h, false, t + 3600, || None), None, "lease auto off: never");
        auto::set_lease_auto(&h, true, t).unwrap();
        assert_eq!(tick(&h, false, t + 3600, || None), None, "an hour left: not yet");
        let now = t + 7200 - 20 * 60;
        assert!(tick(&h, false, now, || None).is_some(), "under 30 min left: renewed");
        assert_eq!(lease_until(&h), now + 7200, "by the hours of the last `auto on`");
        assert_eq!(idle::read_json(&idle::state_dir(&h).join("lease.json")).unwrap()["renewed_at"], json!(now));
        assert_eq!(idle::read_json(&idle::state_dir(&h).join("lease.json")).unwrap()["on"], json!(t), "the budget keeps counting from the first on");
        // Over the $5/hour budget (one session spent $40 since `on`): the tick stops renewing.
        snap(&h, json!({ "session_id": "s1", "ts": now, "cost_usd": 40.0 }));
        let later = now + 7200 - 10 * 60;
        assert_eq!(tick(&h, false, later, || None), None, "budget rests: no renewal");
        assert_eq!(lease_until(&h), now + 7200);
        // Paused: never.
        let _ = std::fs::remove_dir_all(super::super::report::usage_dir(&h));
        auto::set(&h, auto::Mode::Pause, false, later).unwrap();
        assert_eq!(tick(&h, false, later, || None), None);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn subscription_renews_only_on_presence_or_an_owner_action_never_past_4h() {
        let h = tmp("sub");
        let t = 3_000_000;
        on(&h, true, 4.0, t);
        auto::set_lease_auto(&h, true, t).unwrap();
        at(&h, t, t + 4 * 3600);
        let near = t + 4 * 3600 - 10 * 60;
        assert_eq!(tick(&h, true, near, || None), None, "no prompt typed: never from the clock");
        assert_eq!(tick(&h, true, near, || Some(near - 31 * 60)), None, "a prompt older than 30 min is not presence");
        let late = t + 5 * 3600;
        assert_eq!(tick(&h, true, late, || None), None, "expired and nobody there: stays expired");
        assert_eq!(lease_until(&h), t + 4 * 3600);
        assert!(tick(&h, true, near, || Some(near - 60)).is_some(), "the owner typed a minute ago");
        assert_eq!(lease_until(&h), near + 4 * 3600, "never past now + 4 h");
        // The owner's HQ action (`auto lease renew`): to now + 4 h at most, whatever was left.
        let soon = near + 600;
        assert_eq!(renew(&h, true, soon), Some(soon + 4 * 3600));
        assert!(lease_until(&h) <= soon + 4 * 3600);
        // The renewed lease passes the gate; an expired one does not.
        let l = idle::read_json(&idle::state_dir(&h).join("lease.json")).unwrap();
        assert!(idle::gate(Some(&l), true, &idle::Usage::default(), soon + 3 * 3600, None).is_ok());
        assert!(idle::gate(Some(&l), true, &idle::Usage::default(), soon + 4 * 3600 + 1, None).is_err());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn renew_due_is_pure_and_lazy_about_presence() {
        let l = json!({ "until": 1000 + 600 });
        let asked = std::cell::Cell::new(false);
        assert!(renew_due(true, true, false, Some(&l), true, || { asked.set(true); None }, 1000));
        assert!(!asked.get(), "an API key never reads transcripts");
        assert!(!renew_due(true, false, false, Some(&l), true, || None, 1000), "auto paused");
        assert!(!renew_due(true, true, false, None, true, || None, 1000), "no lease");
        assert!(!renew_due(true, true, true, Some(&l), true, || Some(5000), 1000), "a timestamp from the future is not presence");
    }

    #[test]
    fn rest_says_why_and_until_when() {
        let h = tmp("rest");
        let t = 4_000_000;
        snap(&h, json!({ "session_id": "a", "ts": t - 10, "five_hour_pct": 91, "five_hour_resets_at": t + 1800 }));
        let u = idle::usage(&h, None, t);
        let r = rest_json(&h, Some("chạm trần"), &u, true, t);
        assert_eq!((r["kind"].as_str(), r["window"].as_str(), r["pct"].as_f64(), r["until"].as_u64()), (Some("usage"), Some("5h"), Some(91.0), Some(t + 1800)));
        assert!(rest_json(&h, None, &u, true, t).is_null(), "running: no rest");
        snap(&h, json!({ "session_id": "a", "ts": t - 10, "five_hour_pct": 95 }));
        assert!(rest_json(&h, Some("x"), &idle::usage(&h, None, t), true, t)["until"].is_null(), "no reset time: chờ usage");
        assert_eq!(rest_json(&h, Some("gói subscription: lease hết hạn"), &idle::Usage::default(), true, t)["kind"], "lease");
        assert_eq!(rest_json(&h, Some("chạm trần $5.00/giờ"), &idle::Usage::default(), false, t)["kind"], "budget");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn pins_are_idempotent_ordered_and_focus_only_when_tight() {
        let h = tmp("pins");
        let (a, b) = (h.join("a"), h.join("b"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        assert!(set_pin(&h, &b, true, 10));
        assert!(!set_pin(&h, &b, true, 11), "pin twice: one entry");
        assert!(set_pin(&h, &a, true, 12));
        assert_eq!(pins(&h).len(), 2);
        assert!(pinned(&h, &b) && pinned(&h, &a));
        let roots = vec![h.join("c").to_string_lossy().into_owned(), a.to_string_lossy().into_owned(), b.to_string_lossy().into_owned()];
        let order = revive_order(&h, roots.clone());
        assert_eq!(order, [roots[2].clone(), roots[1].clone(), roots[0].clone()], "pinned first, oldest pin first");
        let loose = idle::Usage { five_hour: Some(40.0), seven_day: Some(50.0), ..Default::default() };
        let tight5 = idle::Usage { five_hour: Some(70.0), ..Default::default() };
        let tight7 = idle::Usage { seven_day: Some(80.0), ..Default::default() };
        let p = pins(&h);
        let c = h.join("c");
        assert_eq!(focus_why(&p, &c, &loose), None, "usage loose: everything runs");
        assert!(focus_why(&p, &c, &tight5).unwrap().contains("nhường usage cho dự án ghim"));
        assert!(focus_why(&p, &c, &tight7).is_some());
        assert_eq!(focus_why(&p, &a, &tight5), None, "a pinned project works");
        assert_eq!(focus_why(&[], &c, &tight5), None, "nothing pinned: unchanged");
        assert!(set_pin(&h, &a, false, 13));
        assert!(!set_pin(&h, &a, false, 14), "unpin twice: no change");
        assert_eq!(pins(&h).len(), 1);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn changes_are_owner_only() {
        let h = tmp("owner");
        let a = h.join("a");
        std::fs::create_dir_all(&a).unwrap();
        let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        for args in [v(&["pin"]), v(&["unpin"]), v(&["lease", "auto", "on"]), v(&["lease", "auto", "off"]), v(&["lease", "renew"])] {
            let e = run(&args, &h, true, &a, false, 1).unwrap_err().to_string();
            assert!(e.contains("chỉ owner"), "{args:?}: {e}");
        }
        assert!(pins(&h).is_empty() && !auto::lease_auto(&h), "a refused room changed nothing");
        run(&v(&["pin", "--json"]), &h, true, &a, true, 1).unwrap();
        run(&v(&["pin"]), &h, true, &a, true, 2).unwrap();
        assert_eq!(pins(&h).len(), 1);
        run(&v(&["lease", "auto", "on"]), &h, true, &a, true, 1).unwrap();
        assert!(auto::lease_auto(&h));
        assert!(run(&v(&["pins"]), &h, true, &a, false, 1).is_ok(), "reading the list is anyone's");
        let _ = std::fs::remove_dir_all(&h);
    }
}
