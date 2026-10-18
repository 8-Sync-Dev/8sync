//! Turns that end on an API error. Claude Code runs `StopFailure` instead of `Stop`
//! then (rate_limit, overloaded, server_error, max_output_tokens, …), and that hook
//! has no decision control (https://code.claude.com/docs/en/hooks). So:
//! - `ccc hook stop-failure` records the error per session (`<state>/stopfail/<id>.json`:
//!   `{error, ts, cwd, auto, resume_at, resumed_at}`, [`resume_at`] = the C2 policy) and pops a
//!   desktop notification saying when 8sync resumes it or that the owner must act;
//! - `8sync ccc inbox` (the idle session's poll) hands out a `[8sync:resume]` prompt once the
//!   record is due and `8sync ccc auto` is on for that project ([`due_resume`]);
//! - `ccc hook resume-note` (UserPromptSubmit) tells Claude to check its task list and finish
//!   the work. The automatic prompt keeps the record (marked `resumed_at`, so the consecutive
//!   count survives); a prompt the owner typed removes it.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// `None` without a usable HOME (never write into the current directory).
pub(super) fn state_dir(home: Option<&Path>) -> Option<PathBuf> {
    home.filter(|h| h.is_absolute()).map(|h| h.join(".local/state/8sync/ccc/stopfail"))
}

/// Records older than this are dropped (a session nobody resumed); a resume further away is left
/// to the owner.
const MAX_AGE_S: u64 = 24 * 3600;
/// The automatic resume prompt starts with this; `resume-note` tells it from a typed one.
pub(crate) const RESUME_MARK: &str = "[8sync:resume]";

fn marker(dir: &Path, input: &Value) -> Option<PathBuf> {
    let id = crate::verbs::watchdog::safe_id(input["session_id"].as_str()?)?;
    Some(dir.join(format!("{id}.json")))
}

/// When 8sync resumes a session that stopped on `error` at `ts` after `auto` consecutive automatic
/// resumes; `None` = never, the owner must act. `snap` is the freshest usage snapshot (C1).
/// rate_limit waits for the window that is full (≤ 2 in a row, like Claude Code's own
/// autoContinueAtUsageLimit, and never a weekly reset more than a day away); transient errors back
/// off 60·2^auto s (≤ 900, ≤ 5 in a row); everything else (auth, billing, bad request) needs the owner.
pub(super) fn resume_at(error: &str, ts: u64, auto: u32, snap: Option<&Value>) -> Option<u64> {
    let at = match error {
        "rate_limit" if auto < 2 => {
            let future = |k: &str| snap.and_then(|s| s[k].as_u64()).filter(|&r| r > ts);
            let full = ["five_hour", "seven_day"]
                .iter()
                .filter(|w| snap.and_then(|s| s[format!("{w}_pct")].as_f64()).is_some_and(|p| p >= 90.0))
                .filter_map(|w| future(&format!("{w}_resets_at")))
                .max();
            match full.or_else(|| future("five_hour_resets_at")) {
                Some(reset) => reset + 60,
                None => ts + 900 * (u64::from(auto) + 1),
            }
        }
        "overloaded" | "server_error" | "unknown" if auto < 5 => ts + (60u64 << auto).min(900),
        "max_output_tokens" if auto < 2 => ts + 5,
        _ => return None,
    };
    (at - ts <= MAX_AGE_S).then_some(at)
}

/// `HH:MM` local time where the OS can tell it cheaply (GNU `date`), else `HH:MM UTC`.
pub(super) fn clock(ts: u64) -> String {
    #[cfg(unix)]
    if let Ok(o) = std::process::Command::new("date").args([format!("-d@{ts}").as_str(), "+%H:%M"]).stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).output() {
        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if o.status.success() && s.len() == 5 {
            return s;
        }
    }
    format!("{} UTC", &super::standup::utc_stamp(ts)[11..16])
}

/// tmp + rename, file 0600 in a 0700 dir.
fn write_private(dir: &Path, path: &Path, body: &str) -> Option<()> {
    let mut db = std::fs::DirBuilder::new();
    db.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut db, 0o700);
    db.create(dir).ok()?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600); // created private, no window
    use std::io::Write;
    let ok = o.open(&tmp).and_then(|mut f| f.write_all(body.as_bytes())).is_ok() && std::fs::rename(&tmp, path).is_ok();
    if !ok {
        let _ = std::fs::remove_file(&tmp);
    }
    ok.then_some(())
}

fn read(path: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

/// Writes the record; returns the one-line summary for the notification. `home` locates the usage
/// snapshots the rate-limit policy reads (none → it backs off instead).
pub(super) fn record(input: &str, dir: &Path, home: Option<&Path>, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let path = marker(dir, &v)?;
    let error: String = v["error"].as_str().unwrap_or("unknown").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(40).collect();
    let cwd = v["cwd"].as_str().unwrap_or_default();
    prune(dir, now_s);
    // Consecutive automatic resumes: the previous record counts only if 8sync resumed it.
    let auto = read(&path).filter(|r| r["resumed_at"].is_u64()).map_or(0, |r| r["auto"].as_u64().unwrap_or(0).saturating_add(1).min(u64::from(u32::MAX)) as u32);
    let snaps = home.map(super::report::load_snapshots).unwrap_or_default();
    let sid = v["session_id"].as_str().unwrap_or_default();
    let at = resume_at(&error, now_s, auto, super::report::freshest(&snaps, sid));
    let rec = json!({ "error": error, "ts": now_s, "cwd": cwd, "auto": auto, "resume_at": at, "resumed_at": null });
    write_private(dir, &path, &rec.to_string())?;
    let repo = Path::new(cwd).file_name().and_then(|n| n.to_str()).unwrap_or("session");
    Some(match at {
        Some(at) => format!("Claude Code dừng vì lỗi API ({error}) ở {repo}. 8sync auto sẽ tự chạy tiếp lúc {} nếu `8sync ccc auto` đang bật; hoặc gõ \"tiếp\" trong phiên đó.", clock(at)),
        None => format!("Claude Code dừng vì lỗi API ({error}) ở {repo}. 8sync không tự chạy tiếp lỗi này: anh xử lý nguyên nhân rồi gõ \"tiếp\" trong phiên đó."),
    })
}

/// The UserPromptSubmit context for a session whose last turn died on an API error. A typed
/// prompt removes the record (said once, count reset); the automatic `[8sync:resume]` prompt
/// keeps it with `resumed_at = now`. A record already resumed says nothing.
pub(super) fn note(input: &str, dir: &Path, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let path = marker(dir, &v)?;
    let mut rec = read(&path)?;
    let automatic = v["prompt"].as_str().is_some_and(|p| p.contains(RESUME_MARK));
    let resumed = rec["resumed_at"].is_u64();
    if !automatic {
        let _ = std::fs::remove_file(&path);
    } else if !resumed {
        rec["resumed_at"] = json!(now_s);
        write_private(dir, &path, &rec.to_string())?;
    }
    let age = now_s.saturating_sub(rec["ts"].as_u64().unwrap_or(0));
    if resumed || age > MAX_AGE_S {
        return None;
    }
    let error = rec["error"].as_str().unwrap_or("unknown");
    let ago = age / 60;
    let body = format!(
        "8sync: your previous turn ended early on an API error (`{error}`, {ago} min ago), so work may be unfinished. Before answering, check your task list (TaskList) and the repo's su-code/ship/ACTIVE state; continue any unfinished task unless the owner's new message says otherwise."
    );
    Some(json!({ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": body } }).to_string())
}

/// An offered resume prompt that never came back as a submitted prompt (refused, killed poll) is
/// offered again after this long.
const REOFFER_S: u64 = 600;

/// Pure: the automatic resume prompt for a stop-failure record, when it is due now, not offered in
/// the last [`REOFFER_S`], not resumed, and auto may act (`auto on`, not paused, in scope).
fn due_text(rec: &Value, now_s: u64, may_act: bool) -> Option<String> {
    let ts = rec["ts"].as_u64()?;
    let due = rec["resume_at"].as_u64().is_some_and(|at| now_s >= at);
    let offered = rec["offered_at"].as_u64().is_some_and(|o| now_s.saturating_sub(o) <= REOFFER_S);
    if !(may_act && due && !offered && rec["resumed_at"].is_null() && now_s.saturating_sub(ts) <= MAX_AGE_S) {
        return None;
    }
    let error = rec["error"].as_str().unwrap_or("unknown");
    let ago = now_s.saturating_sub(ts) / 60;
    Some(format!(
        "{RESUME_MARK} 8 Sync auto: lượt trước dừng vì lỗi API `{error}` lúc {} ({ago} phút trước), việc có thể còn dở. Làm tiếp đúng việc đang dở: xem task list, chạy lại bước cuối; lỗi lặp lại thì `8sync ccc . urgent high <lý do>` rồi làm phần khác.",
        clock(ts)
    ))
}

/// [`due_text`] for the record at `path`, stamping `offered_at = now` (atomic rewrite) before it is
/// served; nothing is served when the stamp cannot be written. `may_act` gets the record's cwd.
fn offer(dir: &Path, path: &Path, now_s: u64, may_act: impl FnOnce(Option<&str>) -> bool) -> Option<String> {
    let mut rec = read(path)?;
    let text = due_text(&rec, now_s, may_act(rec["cwd"].as_str().filter(|c| !c.is_empty())))?;
    rec["offered_at"] = json!(now_s);
    write_private(dir, path, &rec.to_string())?;
    Some(text)
}

/// `8sync ccc inbox` claim with nothing queued: the `[8sync:resume]` prompt when this session's
/// stop-failure record is due and `8sync ccc auto` is on (not paused) for the record's project.
pub(crate) fn due_resume(home: &Path, session_id: &str, now_s: u64) -> Option<String> {
    let dir = state_dir(Some(home))?;
    let path = dir.join(format!("{}.json", crate::verbs::watchdog::safe_id(session_id)?));
    offer(&dir, &path, now_s, |cwd| super::auto::running(home) && super::auto::in_scope(home, cwd))
}

fn prune(dir: &Path, now_s: u64) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).is_some_and(|t| now_s.saturating_sub(t.as_secs()) > MAX_AGE_S);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

pub(super) fn notify(msg: &str) {
    if which::which("notify-send").is_ok() {
        // the body is Pango markup: a repo name must not inject tags
        let body = msg.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        let _ = std::process::Command::new("notify-send")
            .args(["-a", "8sync", "--", "8sync: Claude Code stalled", &body])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-stopfail-{tag}-{}", crate::verbs::uuid_sessions::new_uuid()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn failure_is_recorded_then_said_once() {
        let dir = tmp("once");
        let inp = r#"{"session_id":"abc-123","error":"rate_limit","cwd":"/home/u/works/zus"}"#;
        let msg = record(inp, &dir, None, 1_000).unwrap();
        assert!(msg.contains("rate_limit") && msg.contains("zus") && msg.contains("tự chạy tiếp lúc"), "{msg}");
        let n = note(r#"{"session_id":"abc-123","prompt":"tiếp"}"#, &dir, 1_000 + 600).unwrap();
        let v: Value = serde_json::from_str(&n).unwrap();
        let ctx = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(ctx.contains("`rate_limit`, 10 min ago") && ctx.contains("TaskList"));
        assert!(note(r#"{"session_id":"abc-123"}"#, &dir, 2_000).is_none(), "said once");
        // other sessions, path tricks and junk are ignored
        assert!(note(r#"{"session_id":"other"}"#, &dir, 2_000).is_none());
        assert!(record(r#"{"session_id":"../x","error":"e"}"#, &dir, None, 1).is_none());
        assert!(record("not json", &dir, None, 1).is_none());
        // created 0600 inside a 0700 dir
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            record(r#"{"session_id":"p1","error":"e"}"#, &dir, None, 1).unwrap();
            assert_eq!(std::fs::metadata(dir.join("p1.json")).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        // a day-old record is not replayed
        record(r#"{"session_id":"old","error":"e"}"#, &dir, None, 1).unwrap();
        assert!(note(r#"{"session_id":"old"}"#, &dir, 1 + MAX_AGE_S + 1).is_none());
        // no HOME / relative HOME → nowhere to write
        assert!(state_dir(None).is_none() && state_dir(Some(Path::new(""))).is_none() && state_dir(Some(&std::env::temp_dir())).is_some());
        // the error string is sanitised before it reaches Claude; an unknown kind needs the owner
        let m = record(r#"{"session_id":"s2","error":"x\"; echo `pwn`"}"#, &dir, None, 1).unwrap();
        assert!(m.contains("không tự chạy tiếp"), "{m}");
        assert!(note(r#"{"session_id":"s2"}"#, &dir, 1).unwrap().contains("`xechopwn`"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn snap(five: (f64, Option<u64>), seven: (f64, Option<u64>)) -> Value {
        json!({"five_hour_pct": five.0, "five_hour_resets_at": five.1, "seven_day_pct": seven.0, "seven_day_resets_at": seven.1})
    }

    #[test]
    fn rate_limit_waits_for_the_full_window_within_a_day_and_twice_at_most() {
        let t = 10_000;
        // 5 h window full → its reset + 60
        let s = snap((100.0, Some(t + 3_600)), (40.0, Some(t + 50_000)));
        assert_eq!(resume_at("rate_limit", t, 0, Some(&s)), Some(t + 3_660));
        // 7 d window at exactly 90 % counts as full: the later reset wins; 89 % does not
        let s = snap((95.0, Some(t + 3_600)), (90.0, Some(t + 20_000)));
        assert_eq!(resume_at("rate_limit", t, 0, Some(&s)), Some(t + 20_060));
        let s = snap((95.0, Some(t + 3_600)), (89.0, Some(t + 20_000)));
        assert_eq!(resume_at("rate_limit", t, 0, Some(&s)), Some(t + 3_660));
        // no window ≥ 90 %: the 5 h reset if still ahead
        let s = snap((50.0, Some(t + 100)), (10.0, Some(t + 200)));
        assert_eq!(resume_at("rate_limit", t, 1, Some(&s)), Some(t + 160));
        // reset times unknown or already past → backoff 900·(auto+1)
        let s = snap((99.0, None), (99.0, Some(t - 1)));
        assert_eq!(resume_at("rate_limit", t, 0, Some(&s)), Some(t + 900));
        assert_eq!(resume_at("rate_limit", t, 1, None), Some(t + 1_800));
        // weekly reset more than a day away → the owner; exactly 24 h still resumes
        let s = snap((10.0, Some(t + 100)), (100.0, Some(t + 3 * 86_400)));
        assert_eq!(resume_at("rate_limit", t, 0, Some(&s)), None);
        let s = snap((100.0, Some(t + MAX_AGE_S - 60)), (0.0, None));
        assert_eq!(resume_at("rate_limit", t, 0, Some(&s)), Some(t + MAX_AGE_S));
        let s = snap((100.0, Some(t + MAX_AGE_S - 59)), (0.0, None));
        assert_eq!(resume_at("rate_limit", t, 0, Some(&s)), None);
        // two automatic resumes in a row already → the owner
        assert_eq!(resume_at("rate_limit", t, 2, None), None);
    }

    #[test]
    fn transient_errors_back_off_and_the_rest_need_the_owner() {
        let t = 500;
        assert_eq!(resume_at("overloaded", t, 0, None), Some(t + 60));
        assert_eq!(resume_at("server_error", t, 3, None), Some(t + 480));
        assert_eq!(resume_at("unknown", t, 4, None), Some(t + 900), "960 capped at 900");
        assert_eq!(resume_at("overloaded", t, 5, None), None);
        assert_eq!(resume_at("max_output_tokens", t, 1, None), Some(t + 5));
        assert_eq!(resume_at("max_output_tokens", t, 2, None), None);
        for e in ["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "billing_error", "invalid_request", "model_not_found", "cloud_credential_error", "xechopwn"] {
            assert_eq!(resume_at(e, t, 0, None), None, "{e}");
        }
    }

    #[test]
    fn auto_count_carries_over_only_after_an_automatic_resume() {
        let dir = tmp("count");
        let inp = r#"{"session_id":"s","error":"overloaded","cwd":"/w/app"}"#;
        let get = || read(&dir.join("s.json")).unwrap();
        record(inp, &dir, None, 100).unwrap();
        assert_eq!((get()["auto"].as_u64(), get()["resume_at"].as_u64(), get()["resumed_at"].clone()), (Some(0), Some(160), Value::Null));
        // the automatic prompt keeps the record, marks it, and still gives Claude the note
        assert!(note(r#"{"session_id":"s","prompt":"[8sync:resume] 8 Sync auto: …"}"#, &dir, 170).is_some());
        assert_eq!(get()["resumed_at"].as_u64(), Some(170));
        assert!(note(r#"{"session_id":"s","prompt":"[8sync:resume] again"}"#, &dir, 175).is_none(), "already resumed: silent");
        assert_eq!(get()["resumed_at"].as_u64(), Some(170), "first resume time kept");
        record(inp, &dir, None, 200).unwrap();
        assert_eq!((get()["auto"].as_u64(), get()["resume_at"].as_u64()), (Some(1), Some(320)), "second in a row backs off 120 s");
        // not resumed yet (failed again before any prompt) → the count does not grow
        record(inp, &dir, None, 300).unwrap();
        assert_eq!(get()["auto"].as_u64(), Some(0));
        // the next automatic resume counts again; then the owner types → record gone → back to 0
        note(r#"{"session_id":"s","prompt":"[8sync:resume]"}"#, &dir, 310);
        record(inp, &dir, None, 320).unwrap();
        assert_eq!(get()["auto"].as_u64(), Some(1));
        assert!(note(r#"{"session_id":"s","prompt":"làm tiếp nhé"}"#, &dir, 330).is_some());
        assert!(!dir.join("s.json").exists());
        record(inp, &dir, None, 340).unwrap();
        assert_eq!(get()["auto"].as_u64(), Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rate_limit_record_reads_the_freshest_usage_snapshot() {
        let home = tmp("home");
        let usage = super::super::report::usage_dir(&home);
        std::fs::create_dir_all(&usage).unwrap();
        std::fs::write(usage.join("s.json"), r#"{"session_id":"s","ts":90,"five_hour_pct":100,"five_hour_resets_at":4000}"#).unwrap();
        let dir = state_dir(Some(&home)).unwrap();
        record(r#"{"session_id":"s","error":"rate_limit","cwd":"/w"}"#, &dir, Some(&home), 100).unwrap();
        assert_eq!(read(&dir.join("s.json")).unwrap()["resume_at"].as_u64(), Some(4060));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn resume_prompt_only_when_due_unresumed_and_auto_may_act() {
        let rec = json!({"error": "overloaded", "ts": 1_000, "cwd": "/w", "auto": 0, "resume_at": 1_060, "resumed_at": null});
        let t = due_text(&rec, 1_060, true).unwrap();
        assert!(t.starts_with(RESUME_MARK) && t.contains("`overloaded`") && t.contains("urgent high"), "{t}");
        assert!(due_text(&rec, 1_059, true).is_none(), "not due yet");
        assert!(due_text(&rec, 1_060, false).is_none(), "auto off / paused / out of scope");
        let mut r = rec.clone();
        r["resumed_at"] = json!(1_061);
        assert!(due_text(&r, 2_000, true).is_none(), "already resumed");
        r["resumed_at"] = Value::Null;
        r["resume_at"] = Value::Null;
        assert!(due_text(&r, 2_000, true).is_none(), "owner must act");
        assert!(due_text(&rec, 1_000 + MAX_AGE_S + 1, true).is_none(), "stale");
    }

    #[test]
    fn resume_prompt_is_offered_once_per_ten_minutes_until_resumed() {
        let dir = tmp("offer");
        record(r#"{"session_id":"s","error":"overloaded","cwd":"/w/app"}"#, &dir, None, 1_000).unwrap();
        let path = dir.join("s.json");
        let mut seen = None;
        assert!(offer(&dir, &path, 1_060, |cwd| { seen = cwd.map(str::to_string); false }).is_none(), "out of scope");
        assert_eq!(seen.as_deref(), Some("/w/app"), "scope is judged on the record's cwd");
        assert!(read(&path).unwrap()["offered_at"].is_null(), "nothing served, nothing stamped");
        assert!(offer(&dir, &path, 1_060, |_| true).is_some(), "served");
        assert_eq!(read(&path).unwrap()["offered_at"].as_u64(), Some(1_060));
        assert!(offer(&dir, &path, 1_090, |_| true).is_none(), "not again at +30 s");
        assert!(offer(&dir, &path, 1_660, |_| true).is_none(), "not again at +600 s");
        assert!(offer(&dir, &path, 1_661, |_| true).is_some(), "again at +601 s (never submitted)");
        note(r#"{"session_id":"s","prompt":"[8sync:resume] …"}"#, &dir, 1_670);
        assert!(offer(&dir, &path, 5_000, |_| true).is_none(), "never after resumed_at");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
