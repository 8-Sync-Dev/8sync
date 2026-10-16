//! `8sync ccc auto on [--hours N] [--after <60|1m>] [--usd-per-hour X] | off | pause | status [--json]`:
//! one switch for "the team never sits idle and the critic answers when the owner is away" =
//! `idle on` (lease) + `delegate on --after` (default 60 s) + a marker file the HQ office reads.
//!
//! Marker: `<state>/ccc/auto.json` (one level above the idle state dir, `idle::state_dir`), schema 1:
//! `{ "on", "paused", "since", "hours", "after_s" }`. `pause` = the owner pressed pause: HQ must
//! not turn it on again; `off` = plain off, HQ may turn it on again. Both are idempotent.
//!
//! Rails stay those of `idle` and `delegate`: a subscription login keeps the lease ≤ 4 h and only
//! runs while the owner types (Consumer Terms; unattended use belongs on a Console API key, see
//! `assets/skills/aup-audit/8sync-anthropic-rules.md`); Ship, secrets, money, deploys and
//! high-risk questions still reach the owner. Validation runs before anything is written.
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::{delegate, idle};

const USAGE: &str = "usage: 8sync ccc auto on [--hours N] [--after <giây|1m>] [--usd-per-hour X] | off | pause | status [--json]";
const DEFAULT_AFTER_S: u64 = 60;

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Mode {
    On { hours: f64, after: u64, rate: f64 },
    Pause,
    Off,
}

fn marker(home: &Path) -> PathBuf {
    idle::state_dir(home)
        .parent()
        .map(|p| p.join("auto.json"))
        .unwrap_or_else(|| idle::state_dir(home).join("auto.json"))
}

/// Apply `mode`, then report [`status`]. Fail closed: bad `hours`/`after` → nothing is touched.
pub(super) fn set(home: &Path, mode: Mode, subscription: bool, now: u64) -> Result<Value> {
    match mode {
        Mode::On { hours, after, rate } => {
            if after == 0 || after > 86_400 {
                bail!("--after: 1..86400 giây");
            }
            // idle::on validates (hours, rate, subscription cap) before writing anything.
            idle::on(home, hours, rate, subscription, true)?;
            if let Err(e) = delegate::on(home, after) {
                // Half-on is worse than off: no lease without the marker that lets HQ show / pause it.
                let _ = idle::off(home);
                return Err(e);
            }
            write_marker(
                home,
                &json!({ "schema": 1, "on": true, "paused": false, "since": now, "hours": hours, "after_s": after }),
            )?;
        }
        Mode::Pause | Mode::Off => {
            idle::off(home)?;
            delegate::off(home)?;
            write_marker(
                home,
                &json!({ "schema": 1, "on": false, "paused": mode == Mode::Pause, "since": now }),
            )?;
        }
    }
    Ok(status(home, subscription, now))
}

/// The marker write must not fail silently: a lost `paused` would let HQ turn auto on again.
fn write_marker(home: &Path, v: &Value) -> Result<()> {
    let p = marker(home);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = p.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, format!("{v}\n"))?;
    if let Err(e) = std::fs::rename(&tmp, &p) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// `ccc cancel --all` pressed the owner's off switch: remember it so HQ does not turn auto on again.
pub(super) fn mark_paused(home: &Path, now: u64) -> Result<()> {
    write_marker(
        home,
        &json!({ "schema": 1, "on": false, "paused": true, "since": now }),
    )
}

/// Pure over files: what is on right now.
pub(super) fn status(home: &Path, subscription: bool, now: u64) -> Value {
    let m = idle::read_json(&marker(home));
    let lease = idle::read_json(&idle::state_dir(home).join("lease.json"));
    let spent = lease.as_ref().map_or(0.0, |l| {
        idle::spent_since(&l["baseline"], &idle::costs(home))
    });
    let gate = idle::gate(lease.as_ref(), subscription, spent, now, None).err();
    let (i, d) = (idle::enabled(home), delegate::enabled(home));
    let flag = |k: &str| m.as_ref().and_then(|m| m[k].as_bool()).unwrap_or(false);
    // The marker says on but `idle off` / `delegate off` / `cancel --all` ran by hand: that is the
    // owner's off switch, so HQ must treat it as paused. Flags on without the marker (`idle on
    // --hours 8` by hand): "manual" — HQ must not clobber that lease with its own defaults.
    let on = i && d && flag("on");
    json!({
        "schema": 1,
        "on": on,
        "paused": flag("paused") || (flag("on") && !on),
        "manual": !flag("on") && (i || d),
        "idle": i,
        "delegate": d,
        "after_s": delegate::after_s(home),
        "lease_until": lease.as_ref().and_then(|l| l["until"].as_u64()),
        "gate": gate,
        "subscription": subscription,
    })
}

fn text(v: &Value) -> String {
    if v["on"].as_bool() == Some(true) {
        let lease = v["lease_until"]
            .as_u64()
            .map(|u| format!(" · lease tới {} UTC", &super::standup::utc_stamp(u)[11..16]))
            .unwrap_or_default();
        let mut s = format!(
            "auto: ĐANG CHẠY liên tục{lease} · critic trả lời sau {} s",
            v["after_s"].as_u64().unwrap_or(0)
        );
        if let Some(g) = v["gate"].as_str() {
            s.push_str(&format!("\nđang cho nghỉ: {g}"));
        }
        s
    } else if v["paused"].as_bool() == Some(true) {
        "auto: TẠM DỪNG (owner)".into()
    } else if v["manual"].as_bool() == Some(true) {
        "auto: TẮT (idle/delegate đang bật tay — `auto on` sẽ ghi đè)".into()
    } else {
        "auto: TẮT".into()
    }
}

fn num(rest: &[String], flag: &str) -> Result<Option<String>> {
    match rest.iter().position(|a| a == flag) {
        Some(i) => Ok(Some(
            rest.get(i + 1)
                .filter(|v| !v.starts_with("--"))
                .ok_or_else(|| anyhow::anyhow!("{flag} cần một giá trị\n{USAGE}"))?
                .clone(),
        )),
        None => Ok(None),
    }
}

pub(super) fn run(rest: &[String], home: &Path, subscription: bool) -> Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let known = |allowed: &[&str]| -> Result<()> {
        let mut it = rest.iter().skip(1);
        while let Some(a) = it.next() {
            match a.as_str() {
                f if allowed.contains(&f) && f != "--json" => {
                    it.next();
                }
                "--json" if allowed.contains(&"--json") => {}
                x => bail!("không rõ `{x}`\n{USAGE}"),
            }
        }
        Ok(())
    };
    let v = match rest.first().map(String::as_str) {
        Some("on") => {
            known(&["--hours", "--after", "--usd-per-hour"])?;
            let hours = match num(rest, "--hours")? {
                Some(h) => h
                    .parse::<f64>()
                    .map_err(|_| anyhow::anyhow!("--hours cần một số\n{USAGE}"))?,
                None => idle::DEFAULT_HOURS as f64,
            };
            let rate = match num(rest, "--usd-per-hour")? {
                Some(r) => r
                    .parse::<f64>()
                    .map_err(|_| anyhow::anyhow!("--usd-per-hour cần một số\n{USAGE}"))?,
                None => idle::DEFAULT_USD_PER_HOUR,
            };
            let after = match num(rest, "--after")? {
                Some(a) => delegate::parse_after(&a)?,
                None => DEFAULT_AFTER_S,
            };
            set(home, Mode::On { hours, after, rate }, subscription, now)?
        }
        Some(x @ ("off" | "pause")) => {
            known(&[])?;
            set(
                home,
                if x == "pause" { Mode::Pause } else { Mode::Off },
                subscription,
                now,
            )?
        }
        Some("status") | None => {
            known(&["--json"])?;
            status(home, subscription, now)
        }
        Some(x) => bail!("không rõ `{x}`\n{USAGE}"),
    };
    if rest.iter().any(|a| a == "--json") {
        println!("{v}");
    } else {
        println!("{}", text(&v));
        if rest.first().map(String::as_str) == Some("on") {
            println!("Vẫn hỏi owner: Ship, secret/login, xoá/không hoàn tác, tiền, deploy prod, merge/release, high-risk. Cần hook mới: `8sync ccc kit` rồi mở session mới.");
            if subscription {
                println!("Login subscription: lease ≤ 4 giờ, chỉ chạy khi owner có mặt. Chạy không người trông → Console API key.");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("8sync-auto-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(&h).unwrap();
        h
    }
    fn on(hours: f64, after: u64) -> Mode {
        Mode::On {
            hours,
            after,
            rate: 5.0,
        }
    }

    #[test]
    fn on_writes_all_three_states_and_status_reports_on() {
        let h = home("on");
        let v = set(&h, on(2.0, 60), false, 1000).unwrap();
        assert_eq!(
            (
                v["on"].clone(),
                v["idle"].clone(),
                v["delegate"].clone(),
                v["paused"].clone()
            ),
            (json!(true), json!(true), json!(true), json!(false))
        );
        assert_eq!(v["after_s"], 60);
        assert!(v["lease_until"].as_u64().unwrap() > 0 && v["gate"].is_null());
        let m = idle::read_json(&marker(&h)).unwrap();
        assert_eq!(
            (
                m["schema"].clone(),
                m["on"].clone(),
                m["since"].clone(),
                m["hours"].clone(),
                m["after_s"].clone()
            ),
            (json!(1), json!(true), json!(1000), json!(2.0), json!(60))
        );
        assert!(idle::enabled(&h) && delegate::enabled(&h));
        assert_eq!(status(&h, false, 1000)["on"], true);
        assert!(
            text(&v).starts_with("auto: ĐANG CHẠY liên tục · lease tới ")
                && text(&v).contains("critic trả lời sau 60 s")
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn hand_off_switch_counts_as_paused_and_hand_on_counts_as_manual() {
        let h = home("hand");
        set(&h, on(2.0, 60), false, 1).unwrap();
        idle::off(&h).unwrap();
        let v = status(&h, false, 2);
        assert_eq!(
            (v["on"].clone(), v["paused"].clone(), v["manual"].clone()),
            (json!(false), json!(true), json!(false))
        );
        assert_eq!(text(&v), "auto: TẠM DỪNG (owner)");
        set(&h, Mode::Off, false, 3).unwrap();
        delegate::on(&h, 300).unwrap();
        let v = status(&h, false, 4);
        assert_eq!(
            (v["on"].clone(), v["paused"].clone(), v["manual"].clone()),
            (json!(false), json!(false), json!(true))
        );
        assert!(text(&v).starts_with("auto: TẮT (idle/delegate đang bật tay"));
        mark_paused(&h, 5).unwrap();
        let v = status(&h, false, 6);
        assert_eq!(
            (v["paused"].clone(), v["manual"].clone()),
            (json!(true), json!(true))
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn marker_write_failure_is_an_error_not_a_silent_success() {
        let h = home("ro");
        // The marker's parent path is a FILE, so create_dir_all / write must fail.
        let dir = marker(&h).parent().unwrap().to_path_buf();
        std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
        std::fs::write(&dir, "not a dir").unwrap();
        assert!(mark_paused(&h, 1).is_err());
        assert!(set(&h, Mode::Pause, false, 1).is_err());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn pause_turns_both_off_and_keeps_paused_off_clears_it() {
        let h = home("pause");
        set(&h, on(2.0, 60), false, 1).unwrap();
        for _ in 0..2 {
            let v = set(&h, Mode::Pause, false, 2).unwrap();
            assert_eq!(
                (
                    v["on"].clone(),
                    v["idle"].clone(),
                    v["delegate"].clone(),
                    v["paused"].clone()
                ),
                (json!(false), json!(false), json!(false), json!(true))
            );
            assert!(v["lease_until"].is_null());
            assert_eq!(text(&v), "auto: TẠM DỪNG (owner)");
        }
        let v = set(&h, Mode::Off, false, 3).unwrap();
        assert_eq!(
            (v["on"].clone(), v["paused"].clone()),
            (json!(false), json!(false))
        );
        assert_eq!(text(&v), "auto: TẮT");
        assert_eq!(
            set(&h, Mode::Off, false, 4).unwrap()["paused"],
            false,
            "idempotent"
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn invalid_input_bails_and_leaves_nothing() {
        let h = home("bad");
        for (hours, after) in [(0.0, 60), (25.0, 60), (2.0, 0), (2.0, 90_000)] {
            assert!(
                set(&h, on(hours, after), false, 1).is_err(),
                "{hours} {after}"
            );
        }
        assert!(!marker(&h).exists() && !idle::state_dir(&h).join("lease.json").exists());
        assert!(!idle::enabled(&h) && !delegate::enabled(&h));
        assert!(delegate::parse_after("0").is_err() && delegate::parse_after("x").is_err());
        assert_eq!(delegate::parse_after("1m").unwrap(), 60);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn subscription_caps_the_lease_at_four_hours() {
        let h = home("sub");
        let e = set(&h, on(8.0, 60), true, 1).unwrap_err().to_string();
        assert!(e.contains("tối đa"), "{e}");
        assert!(!marker(&h).exists() && !idle::enabled(&h) && !delegate::enabled(&h));
        let v = set(&h, on(4.0, 60), true, 1).unwrap();
        assert_eq!(
            (v["on"].clone(), v["subscription"].clone()),
            (json!(true), json!(true))
        );
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn json_shape_is_stable() {
        let h = home("shape");
        let v = status(&h, false, 1);
        let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "after_s",
                "delegate",
                "gate",
                "idle",
                "lease_until",
                "manual",
                "on",
                "paused",
                "schema",
                "subscription"
            ]
        );
        assert_eq!(
            (
                v["schema"].clone(),
                v["on"].clone(),
                v["lease_until"].clone(),
                v["gate"].clone()
            ),
            (json!(1), json!(false), Value::Null, Value::Null)
        );
        // subscription without a lease reports the gate reason
        assert!(status(&h, true, 1)["gate"]
            .as_str()
            .unwrap()
            .contains("lease"));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn run_rejects_unknown_arguments() {
        let h = home("args");
        let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(run(&s(&["on", "--bogus"]), &h, false).is_err());
        assert!(run(&s(&["on", "--hours"]), &h, false).is_err());
        assert!(run(&s(&["on", "--after", "0"]), &h, false).is_err());
        assert!(run(&s(&["wat"]), &h, false).is_err());
        assert!(!marker(&h).exists());
        let _ = std::fs::remove_dir_all(&h);
    }
}
