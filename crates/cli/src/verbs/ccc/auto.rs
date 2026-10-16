//! `8sync ccc auto on [--here] [--hours N] [--after <60|1m>] [--usd-per-hour X] | off | pause | status [--json]`:
//! one switch for "the team never sits idle and the critic answers when the owner is away" =
//! `idle on` (lease) + `delegate on --after` (default 60 s) + a marker file the HQ office reads.
//!
//! Marker: `<state>/ccc/auto.json` (one level above the idle state dir, `idle::state_dir`), schema 1:
//! `{ "on", "paused", "since", "hours", "after_s", "repo"? }`. `pause` = the owner pressed pause: HQ
//! must not turn it on again; `off` = plain off, HQ may turn it on again. Both are idempotent.
//!
//! The switch is per user (one state dir under home), so it reaches every session of every project.
//! `--here` stores the project root of the current folder as `repo`: the `idle`, `delegate` and
//! `taskdone` hooks then skip sessions whose cwd is outside it ([`in_scope`]); subfolders and
//! worktrees inside the repo count as the same project.
//!
//! `--loop [10m] [--team]` queues one inbox message per room of this project ([`loop_prompt`]):
//! the room sets up its own recurring `CronCreate` loop, which re-reads [`status`] every tick and
//! deletes itself once auto is off/paused or the $/hour cap holds. The lease does not stop it: the
//! loop is Claude Code's own scheduler (session-scoped, expires after 7 days,
//! https://code.claude.com/docs/en/scheduled-tasks), started by the owner's own command.
//!
//! Rails stay those of `idle` and `delegate`: a subscription login keeps the lease ≤ 4 h and only
//! runs while the owner types (Consumer Terms; unattended use belongs on a Console API key, see
//! `assets/skills/aup-audit/8sync-anthropic-rules.md`); Ship, secrets, money, deploys and
//! high-risk questions still reach the owner. Validation runs before anything is written.
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::{delegate, idle};

const USAGE: &str = "usage: 8sync ccc auto on [--here] [--loop [10m]] [--team] [--hours N] [--after <giây|1m>] [--usd-per-hour X] | off | pause | status [--json]";
const DEFAULT_AFTER_S: u64 = 60;
const DEFAULT_LOOP_MIN: u64 = 10;
/// Tag every loop carries, so a room never gets two and `CronList` finds it.
const LOOP_TAG: &str = "8sync-auto-loop";

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Mode {
    On {
        hours: f64,
        after: u64,
        rate: f64,
        repo: Option<PathBuf>,
    },
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
        Mode::On {
            hours,
            after,
            rate,
            repo,
        } => {
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
            let mut m = json!({ "schema": 1, "on": true, "paused": false, "since": now, "hours": hours, "after_s": after });
            if let Some(r) = repo {
                m["repo"] = json!(canon(&r).to_string_lossy());
            }
            if let Err(e) = write_marker(home, &m) {
                // Without the marker the `--here` scope is lost and auto would run everywhere.
                let _ = idle::off(home);
                let _ = delegate::off(home);
                return Err(e);
            }
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

/// `auto on` is in force (marker on, both flags on, not paused): the idle hook then treats a
/// session without an agent team as its own lead. Cheap on purpose — it runs at every Stop of
/// every session — so no cost snapshot and no gate here; the hook applies its own gate.
pub(super) fn running(home: &Path) -> bool {
    let m = idle::read_json(&marker(home));
    let flag = |k: &str| m.as_ref().and_then(|m| m[k].as_bool()).unwrap_or(false);
    flag("on") && !flag("paused") && idle::enabled(home) && delegate::enabled(home)
}

/// Symlinks and `C:\x` vs `\\?\C:\x` resolved, so a hook's cwd and the stored root compare equal.
fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// The project root `auto on --here` limited auto to, while the marker is on.
fn scope(home: &Path) -> Option<PathBuf> {
    let m = idle::read_json(&marker(home))?;
    if m["on"].as_bool() != Some(true) {
        return None;
    }
    m["repo"]
        .as_str()
        .filter(|r| !r.is_empty())
        .map(PathBuf::from)
}

/// Hooks ask this before acting on a session: `true` unless `auto on --here` limited auto to one
/// project and `cwd` (from the hook input) is missing or outside it.
pub(super) fn in_scope(home: &Path, cwd: Option<&str>) -> bool {
    let Some(repo) = scope(home) else { return true };
    cwd.map(Path::new)
        .filter(|c| c.is_absolute())
        .is_some_and(|c| canon(c).starts_with(&repo))
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
        "repo": scope(home).map(|r| r.to_string_lossy().into_owned()),
    })
}

fn text(v: &Value) -> String {
    if v["on"].as_bool() == Some(true) {
        let lease = v["lease_until"]
            .as_u64()
            .map(|u| format!(" · lease tới {} UTC", &super::standup::utc_stamp(u)[11..16]))
            .unwrap_or_default();
        let only = v["repo"]
            .as_str()
            .map(|r| format!(" · chỉ dự án {}", r.trim_start_matches(r"\\?\")))
            .unwrap_or_else(|| " · mọi dự án".into());
        let mut s = format!(
            "auto: ĐANG CHẠY liên tục{lease} · critic trả lời sau {} s{only}",
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

/// `--loop` interval in minutes: `10`, `10m`, `2h`; 1 min .. 24 h.
pub(super) fn parse_every(s: &str) -> Result<u64> {
    let (n, mul) = match s.strip_suffix('h') {
        Some(h) => (h, 60),
        None => (s.strip_suffix('m').unwrap_or(s), 1),
    };
    match n.parse::<u64>().ok().map(|n| n * mul) {
        Some(m @ 1..=1440) => Ok(m),
        _ => bail!("--loop: 1m..24h (vd 10m, 1h)\n{USAGE}"),
    }
}

/// The message `auto on --loop` queues for one room: set up its own recurring loop (what `/loop`
/// does: `CronCreate`), shaped by the room's role. Every tick re-checks `auto status`, so `off`,
/// `pause`, the end of the lease or the $/hour cap delete the loop on its next tick.
pub(super) fn loop_prompt(name: &str, every_min: u64, team: bool) -> String {
    let (role, duty) = super::room::role(name);
    let tick = format!(
        "{LOOP_TAG} {name}: chạy `8sync ccc auto status --json`; nếu on=false, paused=true hoặc gate bắt đầu bằng \"chạm trần\" → CronDelete job {LOOP_TAG} này và dừng (lease hết hạn không dừng loop; Claude Code tự xoá loop sau 7 ngày). Không thì: su-code/ship/ACTIVE có vòng lặp mở → /ship-tick <slug>; không thì lấy MỘT việc hợp vai {role} từ su-code/STATE.md mục Next (`8sync ccc . goal` giữ file trước, tránh trùng phòng khác) và tự chọn skill theo việc: code → /ship <việc> đủ flow (karpathy-guidelines khi sửa code, test, review, gate /sec + /rules + /aup-audit trước commit), đổi ≤3 file → /do, R&D → /deep-research (ghi su-code/research/), UI → impeccable, thiết kế hệ thống → /sysdesign; rồi `8sync ccc meet --say`. Không merge/push main/tag/deploy; câu hỏi Ship vẫn chờ owner."
    );
    let mut s = format!(
        "8sync auto --loop: owner bật chạy liên tục cho phòng `{name}` (vai {role}: {duty}). CronList trước: đã có job chứa `{LOOP_TAG}` thì không tạo thêm. Không thì CronCreate lặp mỗi {every_min} phút (như `/loop {every_min}m`) với prompt:\n{tick}"
    );
    if team {
        s.push_str("\nCó tool tạo teammate (agent teams) thì lấp ghế trống ngay: rd, qa, reviewer; mỗi người giữ file riêng (`8sync ccc . goal --files`), báo về lead. Không có tool đó thì bỏ qua (cần mở phòng bằng `--team`).");
    }
    s
}

/// Queue [`loop_prompt`] into every room's inbox. `(name, delivered now?)`: a room without the
/// `8sync-inbox` mod gets it at its next turn end.
pub(super) fn queue_loops(
    home: &Path,
    rooms: &[(String, String)],
    every_min: u64,
    team: bool,
    now: u64,
) -> Vec<(String, bool)> {
    let at = std::time::UNIX_EPOCH + std::time::Duration::from_secs(now);
    let mut out = Vec::new();
    for (name, id) in rooms {
        if crate::verbs::hq::queue_inbox(home, id, &loop_prompt(name, every_min, team), now * 1000)
            .is_ok()
        {
            out.push((name.clone(), crate::verbs::hq::inbox_live(home, id, at)));
        }
    }
    out
}

pub(super) fn run(
    rest: &[String],
    home: &Path,
    subscription: bool,
    rooms: impl FnOnce() -> Vec<(String, String)>,
) -> Result<()> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let known = |allowed: &[&str]| -> Result<()> {
        let mut it = rest.iter().skip(1);
        while let Some(a) = it.next() {
            match a.as_str() {
                f @ ("--json" | "--here" | "--team") if allowed.contains(&f) => {}
                "--loop" if allowed.contains(&"--loop") => {
                    if it.clone().next().is_some_and(|v| !v.starts_with("--")) {
                        it.next();
                    }
                }
                f if allowed.contains(&f) => {
                    it.next();
                }
                x => bail!("không rõ `{x}`\n{USAGE}"),
            }
        }
        Ok(())
    };
    let mut looped = None;
    let v = match rest.first().map(String::as_str) {
        Some("on") => {
            known(&[
                "--hours",
                "--after",
                "--usd-per-hour",
                "--here",
                "--loop",
                "--team",
            ])?;
            let every = match rest.iter().position(|a| a == "--loop") {
                Some(i) => Some(match rest.get(i + 1).filter(|v| !v.starts_with("--")) {
                    Some(v) => parse_every(v)?,
                    None => DEFAULT_LOOP_MIN,
                }),
                None => None,
            };
            let team = rest.iter().any(|a| a == "--team");
            if team && every.is_none() {
                bail!("--team đi cùng --loop\n{USAGE}");
            }
            looped = every.map(|e| (e, team));
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
            let repo = if rest.iter().any(|a| a == "--here") {
                let cwd = std::env::current_dir()?;
                Some(crate::verbs::here::detect_project_root(&cwd).unwrap_or(cwd))
            } else {
                None
            };
            set(
                home,
                Mode::On {
                    hours,
                    after,
                    rate,
                    repo,
                },
                subscription,
                now,
            )?
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
    // Only once auto is really on: a loop queued while the rails hold would delete itself anyway.
    let queued = match looped {
        Some((every, team)) if v["on"].as_bool() == Some(true) => {
            Some((every, queue_loops(home, &rooms(), every, team, now)))
        }
        _ => None,
    };
    if rest.iter().any(|a| a == "--json") {
        let mut v = v;
        if let Some((every, q)) = &queued {
            v["loop"] = json!({ "every_min": every, "rooms": q.iter().map(|(n, live)| json!({ "name": n, "now": live })).collect::<Vec<_>>() });
        }
        println!("{v}");
    } else {
        println!("{}", text(&v));
        if rest.first().map(String::as_str) == Some("on") {
            println!("Vẫn hỏi owner: Ship, secret/login, xoá/không hoàn tác, tiền, deploy prod, merge/release, high-risk. Cần hook mới: `8sync ccc kit` rồi mở session mới.");
            if v["repo"].is_null() {
                println!("Áp dụng cho mọi session ở mọi dự án trên máy này, kể cả session mở sau. Chỉ một dự án: chạy `8sync ccc auto on --here` trong thư mục dự án đó.");
            }
            if subscription {
                println!("Login subscription: lease ≤ 4 giờ, chỉ chạy khi owner có mặt. Chạy không người trông → Console API key.");
            }
        }
        if let Some((every, q)) = &queued {
            if q.is_empty() {
                println!("--loop: dự án này chưa có phòng nào (`8sync ccc . <tên>` để mở).");
            }
            for (name, live) in q {
                let when = if *live {
                    "vào ngay khi phòng rảnh"
                } else {
                    "vào khi phòng xong lượt kế (chưa nạp mod inbox)"
                };
                println!("loop {every} phút → {name}: {when}");
            }
            if !q.is_empty() {
                println!("Loop tự xoá ở nhịp kế khi auto off/pause hoặc chạm trần $/giờ; Claude Code tự xoá sau 7 ngày; chỉ chạy khi phòng còn mở. Xoá tay: bảo phòng \"huỷ job 8sync-auto-loop\" (CronDelete).");
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
            repo: None,
        }
    }

    #[test]
    fn here_limits_auto_to_one_project_and_pause_clears_it() {
        let h = home("here");
        let repo = h.join("proj");
        let other = h.join("proj-2");
        for d in [repo.join("src"), other.clone()] {
            std::fs::create_dir_all(&d).unwrap();
        }
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let here = |r: &Path| Mode::On {
            hours: 2.0,
            after: 60,
            rate: 5.0,
            repo: Some(r.to_path_buf()),
        };
        // nothing on, or on without --here: every project
        assert!(in_scope(&h, Some(&s(&other))) && in_scope(&h, None));
        set(&h, on(2.0, 60), false, 1).unwrap();
        assert!(in_scope(&h, Some(&s(&other))) && status(&h, false, 1)["repo"].is_null());
        assert!(text(&status(&h, false, 1)).contains("mọi dự án"));
        let v = set(&h, here(&repo), false, 2).unwrap();
        assert!(
            v["repo"].as_str().is_some_and(|r| r.ends_with("proj")),
            "{v}"
        );
        assert!(text(&v).contains("chỉ dự án") && !text(&v).contains(r"\\?\"));
        assert!(in_scope(&h, Some(&s(&repo))));
        assert!(
            in_scope(&h, Some(&s(&repo.join("src")))),
            "subfolder / worktree in the repo"
        );
        assert!(
            !in_scope(&h, Some(&s(&other))),
            "sibling sharing a name prefix"
        );
        assert!(!in_scope(&h, None) && !in_scope(&h, Some("relative/path")));
        // the critic answers only in the scoped project (after 60 s: owner silent for years)
        let tp = h.join("t.jsonl");
        std::fs::write(&tp, json!({ "type": "user", "timestamp": "2020-01-01T00:00:00Z", "message": { "role": "user", "content": "làm tiếp" } }).to_string() + "\n").unwrap();
        let ask = |cwd: &Path| {
            json!({ "tool_name": "AskUserQuestion", "cwd": cwd, "transcript_path": tp,
            "tool_input": { "questions": [{ "header": "UI", "question": "Màu nút?", "options": [{ "label": "Lime" }, { "label": "Blue" }] }] } }).to_string()
        };
        if std::env::var("EIGHTSYNC_DELEGATE").is_err() {
            assert!(
                delegate::hook(&ask(&repo), &h).is_some(),
                "inside the scoped project"
            );
        }
        assert!(
            delegate::hook(&ask(&other), &h).is_none(),
            "another project asks its owner"
        );
        // a real checkout, cwd written the way Claude Code sends it (no `\\?\`, native separators)
        let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        set(&h, here(crate_dir), false, 3).unwrap();
        assert!(
            in_scope(&h, Some(&s(&crate_dir.join("src")))),
            "{}",
            status(&h, false, 3)
        );
        assert!(!in_scope(&h, Some(&s(&repo))));
        // a plain `on` widens it again; `pause` drops it
        set(&h, on(2.0, 60), false, 3).unwrap();
        assert!(in_scope(&h, Some(&s(&other))));
        set(&h, here(&repo), false, 4).unwrap();
        set(&h, Mode::Pause, false, 5).unwrap();
        assert!(in_scope(&h, Some(&s(&other))) && status(&h, false, 5)["repo"].is_null());
        let _ = std::fs::remove_dir_all(&h);
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
                "repo",
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
        assert!(run(&s(&["on", "--bogus"]), &h, false, Vec::new).is_err());
        assert!(run(&s(&["on", "--hours"]), &h, false, Vec::new).is_err());
        assert!(run(&s(&["on", "--after", "0"]), &h, false, Vec::new).is_err());
        assert!(run(&s(&["wat"]), &h, false, Vec::new).is_err());
        assert!(run(&s(&["off", "--here"]), &h, false, Vec::new).is_err());
        assert!(
            run(&s(&["on", "--team"]), &h, false, Vec::new).is_err(),
            "--team needs --loop"
        );
        assert!(run(&s(&["on", "--loop", "0m"]), &h, false, Vec::new).is_err());
        assert!(!marker(&h).exists());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn loop_interval_parses_minutes_and_hours() {
        assert_eq!(parse_every("10").unwrap(), 10);
        assert_eq!(parse_every("10m").unwrap(), 10);
        assert_eq!(parse_every("2h").unwrap(), 120);
        for bad in ["0", "0m", "25h", "x", "", "-5m"] {
            assert!(parse_every(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn loop_prompt_sets_one_self_stopping_loop_per_room() {
        let p = loop_prompt("rd-su-code", 15, false);
        for want in [
            LOOP_TAG,
            "CronList",
            "CronCreate",
            "15 phút",
            "auto status --json",
            "CronDelete",
            "Ship",
            "rd-su-code",
            "/ship <việc>",
            "karpathy-guidelines",
            "/sec + /rules + /aup-audit",
            "/deep-research",
        ] {
            assert!(p.contains(want), "missing {want}: {p}");
        }
        assert!(!p.contains("teammate"));
        assert!(loop_prompt("lead", 10, true).contains("rd, qa, reviewer"));
        // The loop stops on the $/hour cap, matched by the prefix of idle::gate's cap error.
        assert!(p.contains("gate bắt đầu bằng \"chạm trần\""));
        let lease = json!({ "on": 0, "until": 10_000, "usd_per_hour": 5.0 });
        assert!(idle::gate(Some(&lease), true, 99.0, 3600, None)
            .unwrap_err()
            .starts_with("chạm trần"));
        // An expired lease alone is not a stop reason for the loop.
        assert!(!idle::gate(Some(&lease), true, 0.0, 20_000, None)
            .unwrap_err()
            .starts_with("chạm trần"));
    }

    #[test]
    fn auto_on_loop_queues_one_message_per_room() {
        let h = home("loop");
        let s = |a: &[&str]| a.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let ids = [
            "a2830544-0719-4d6f-aaa3-644783ddb0b3",
            "b2830544-0719-4d6f-aaa3-644783ddb0b4",
        ];
        let rooms = || {
            vec![
                ("lead".to_string(), ids[0].to_string()),
                ("rd".to_string(), ids[1].to_string()),
            ]
        };
        run(&s(&["on", "--loop", "5m", "--team"]), &h, false, rooms).unwrap();
        for (id, name) in ids.iter().zip(["lead", "rd"]) {
            let f = crate::verbs::hq::inbox_file(&h, id).unwrap();
            let raw = std::fs::read_to_string(&f).unwrap();
            assert_eq!(raw.lines().count(), 1);
            let v: Value = serde_json::from_str(raw.trim()).unwrap();
            let t = v["text"].as_str().unwrap();
            assert!(
                t.contains(&format!("`{name}`"))
                    && t.contains("5 phút")
                    && t.contains("rd, qa, reviewer")
            );
        }
        // Off: no loop is queued (a queued loop would only delete itself).
        let h2 = home("loop-off");
        run(&s(&["off"]), &h2, false, rooms).unwrap();
        assert!(!crate::verbs::hq::inbox_file(&h2, ids[0]).unwrap().exists());
        for d in [h, h2] {
            let _ = std::fs::remove_dir_all(&d);
        }
    }
}
