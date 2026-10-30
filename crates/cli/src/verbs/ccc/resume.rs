//! Turns that end on an API error. Claude Code runs `StopFailure` instead of `Stop`
//! then (rate_limit, overloaded, server_error, max_output_tokens, …), and that hook
//! has no decision control (https://code.claude.com/docs/en/hooks). So:
//! - `ccc hook stop-failure` records the error per session (`<state>/stopfail/<id>.json`:
//!   `{error, ts, cwd, resume_at}`, [`resume_at`] = when the session can go on) and pops a
//!   desktop notification saying when the owner can tell it to go on, or that the owner must fix
//!   the cause first. 8sync never resumes a session by itself (owner 2026-10-30: sessions only
//!   from the owner);
//! - `ccc hook resume-note` (UserPromptSubmit) tells Claude, on the owner's next prompt, to check
//!   its task list and finish the work; the record goes then (said once).
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

use super::read_json;

/// `None` without a usable HOME (never write into the current directory).
pub(super) fn state_dir(home: Option<&Path>) -> Option<PathBuf> {
    home.filter(|h| h.is_absolute()).map(|h| h.join(".local/state/8sync/ccc/stopfail"))
}

/// Records older than this are dropped (a session nobody went back to); a wait further away is
/// shown as "the owner must act".
const MAX_AGE_S: u64 = 24 * 3600;

fn marker(dir: &Path, input: &Value) -> Option<PathBuf> {
    let id = crate::verbs::watchdog::safe_id(input["session_id"].as_str()?)?;
    Some(dir.join(format!("{id}.json")))
}

/// When a session that stopped on `error` at `ts` can go on; `None` = the owner must fix the
/// cause first. `snap` is the freshest usage snapshot. rate_limit waits for the window that is
/// full (never a weekly reset more than a day away); transient errors a minute; everything else
/// (auth, billing, bad request) needs the owner.
pub(super) fn resume_at(error: &str, ts: u64, snap: Option<&Value>) -> Option<u64> {
    let at = match error {
        "rate_limit" => {
            let future = |k: &str| snap.and_then(|s| s[k].as_u64()).filter(|&r| r > ts);
            let full = ["five_hour", "seven_day"]
                .iter()
                .filter(|w| snap.and_then(|s| s[format!("{w}_pct")].as_f64()).is_some_and(|p| p >= 90.0))
                .filter_map(|w| future(&format!("{w}_resets_at")))
                .max();
            match full.or_else(|| future("five_hour_resets_at")) {
                Some(reset) => reset + 60,
                None => ts + 900,
            }
        }
        "overloaded" | "server_error" | "unknown" => ts + 60,
        "max_output_tokens" => ts + 5,
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
    format!("{} UTC", &super::utc_stamp(ts)[11..16])
}

/// Writes the record; returns the one-line summary for the notification. `home` locates the usage
/// snapshots the rate-limit wait reads (none → the default wait).
pub(super) fn record(input: &str, dir: &Path, home: Option<&Path>, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let path = marker(dir, &v)?;
    let error: String = v["error"].as_str().unwrap_or("unknown").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(40).collect();
    let cwd = v["cwd"].as_str().unwrap_or_default();
    prune(dir, now_s);
    let snaps = home.map(super::report::load_snapshots).unwrap_or_default();
    let sid = v["session_id"].as_str().unwrap_or_default();
    let at = resume_at(&error, now_s, super::report::freshest(&snaps, sid));
    let rec = json!({ "error": error, "ts": now_s, "cwd": cwd, "resume_at": at });
    write_private(&path, &rec)?;
    let repo = Path::new(cwd).file_name().and_then(|n| n.to_str()).unwrap_or("session");
    Some(match at {
        Some(at) => format!("Claude Code dừng vì lỗi API ({error}) ở {repo}. Chạy tiếp được từ {}: gõ \"tiếp\" trong phiên đó.", clock(at)),
        None => format!("Claude Code dừng vì lỗi API ({error}) ở {repo}. Lỗi này cần anh xử lý nguyên nhân trước, rồi gõ \"tiếp\" trong phiên đó."),
    })
}

/// The UserPromptSubmit context for a session whose last turn died on an API error, once: the
/// prompt removes the record.
pub(super) fn note(input: &str, dir: &Path, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let path = marker(dir, &v)?;
    let rec = read_json(&path)?;
    let _ = std::fs::remove_file(&path);
    let age = now_s.saturating_sub(rec["ts"].as_u64().unwrap_or(0));
    if age > MAX_AGE_S {
        return None;
    }
    let error = rec["error"].as_str().unwrap_or("unknown");
    let ago = age / 60;
    let body = format!(
        "8sync: your previous turn ended early on an API error (`{error}`, {ago} min ago), so work may be unfinished. Before answering, check your task list (TaskList) and the repo's su-code/ship/ACTIVE state; continue any unfinished task unless the owner's new message says otherwise."
    );
    Some(json!({ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": body } }).to_string())
}

/// The record, 0600 (tmp + rename) in a 0700 dir.
fn write_private(path: &Path, rec: &Value) -> Option<()> {
    crate::verbs::hq::write_private(path, rec.to_string().as_bytes()).ok()
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
        assert!(msg.contains("rate_limit") && msg.contains("zus") && msg.contains("Chạy tiếp được từ"), "{msg}");
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
        assert!(m.contains("cần anh xử lý"), "{m}");
        assert!(note(r#"{"session_id":"s2"}"#, &dir, 1).unwrap().contains("`xechopwn`"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn snap(five: (f64, Option<u64>), seven: (f64, Option<u64>)) -> Value {
        json!({"five_hour_pct": five.0, "five_hour_resets_at": five.1, "seven_day_pct": seven.0, "seven_day_resets_at": seven.1})
    }

    #[test]
    fn rate_limit_waits_for_the_full_window_within_a_day() {
        let t = 10_000;
        // 5 h window full → its reset + 60
        let s = snap((100.0, Some(t + 3_600)), (40.0, Some(t + 50_000)));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), Some(t + 3_660));
        // 7 d window at exactly 90 % counts as full: the later reset wins; 89 % does not
        let s = snap((95.0, Some(t + 3_600)), (90.0, Some(t + 20_000)));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), Some(t + 20_060));
        let s = snap((95.0, Some(t + 3_600)), (89.0, Some(t + 20_000)));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), Some(t + 3_660));
        // no window ≥ 90 %: the 5 h reset if still ahead
        let s = snap((50.0, Some(t + 100)), (10.0, Some(t + 200)));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), Some(t + 160));
        // reset times unknown or already past → 15 min
        let s = snap((99.0, None), (99.0, Some(t - 1)));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), Some(t + 900));
        assert_eq!(resume_at("rate_limit", t, None), Some(t + 900));
        // weekly reset more than a day away → the owner; exactly 24 h still counts
        let s = snap((10.0, Some(t + 100)), (100.0, Some(t + 3 * 86_400)));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), None);
        let s = snap((100.0, Some(t + MAX_AGE_S - 60)), (0.0, None));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), Some(t + MAX_AGE_S));
        let s = snap((100.0, Some(t + MAX_AGE_S - 59)), (0.0, None));
        assert_eq!(resume_at("rate_limit", t, Some(&s)), None);
    }

    #[test]
    fn transient_errors_wait_a_minute_and_the_rest_need_the_owner() {
        let t = 500;
        assert_eq!(resume_at("overloaded", t, None), Some(t + 60));
        assert_eq!(resume_at("server_error", t, None), Some(t + 60));
        assert_eq!(resume_at("unknown", t, None), Some(t + 60));
        assert_eq!(resume_at("max_output_tokens", t, None), Some(t + 5));
        for e in ["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "billing_error", "invalid_request", "model_not_found", "cloud_credential_error", "xechopwn"] {
            assert_eq!(resume_at(e, t, None), None, "{e}");
        }
    }

    #[test]
    fn rate_limit_record_reads_the_freshest_usage_snapshot() {
        let home = tmp("home");
        let usage = super::super::report::usage_dir(&home);
        std::fs::create_dir_all(&usage).unwrap();
        std::fs::write(usage.join("s.json"), r#"{"session_id":"s","ts":90,"five_hour_pct":100,"five_hour_resets_at":4000}"#).unwrap();
        let dir = state_dir(Some(&home)).unwrap();
        record(r#"{"session_id":"s","error":"rate_limit","cwd":"/w"}"#, &dir, Some(&home), 100).unwrap();
        assert_eq!(read_json(&dir.join("s.json")).unwrap()["resume_at"].as_u64(), Some(4060));
        let _ = std::fs::remove_dir_all(&home);
    }
}
