//! Turns that end on an API error. Claude Code runs `StopFailure` instead of `Stop`
//! then (rate_limit, overloaded, server_error, max_output_tokens, …), and that hook
//! has no decision control (https://code.claude.com/docs/en/hooks). So:
//! - `ccc hook stop-failure` records the error per session (`<state>/stopfail/<id>.json`)
//!   and pops a desktop notification so the owner knows the session stalled;
//! - `ccc hook resume-note` (UserPromptSubmit) consumes that record on the next prompt
//!   (even a bare "tiếp") and tells Claude to check its task list and finish the work.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// `None` without a usable HOME (never write into the current directory).
pub(super) fn state_dir(home: Option<&Path>) -> Option<PathBuf> {
    home.filter(|h| h.is_absolute()).map(|h| h.join(".local/state/8sync/ccc/stopfail"))
}

/// Records older than this are dropped (a session nobody resumed).
const MAX_AGE_S: u64 = 24 * 3600;

fn marker(dir: &Path, input: &Value) -> Option<PathBuf> {
    let id = crate::verbs::watchdog::safe_id(input["session_id"].as_str()?)?;
    Some(dir.join(format!("{id}.json")))
}

/// Writes the record; returns the one-line summary for the notification.
pub(super) fn record(input: &str, dir: &Path, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let path = marker(dir, &v)?;
    let error: String = v["error"].as_str().unwrap_or("unknown").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(40).collect();
    let cwd = v["cwd"].as_str().unwrap_or_default();
    let mut db = std::fs::DirBuilder::new();
    db.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut db, 0o700);
    db.create(dir).ok()?;
    prune(dir, now_s);
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600); // created private, no window
    use std::io::Write;
    o.open(&path).ok()?.write_all(json!({ "error": error, "ts": now_s, "cwd": cwd }).to_string().as_bytes()).ok()?;
    let repo = Path::new(cwd).file_name().and_then(|n| n.to_str()).unwrap_or("session");
    Some(format!("Claude Code stopped on an API error ({error}) in {repo}. Type \"tiếp\" in that session to resume."))
}

/// The UserPromptSubmit context for a session whose last turn died on an API error;
/// the record is removed so it is said once.
pub(super) fn note(input: &str, dir: &Path, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let path = marker(dir, &v)?;
    let rec: Value = serde_json::from_str(&std::fs::read_to_string(&path).ok()?).ok()?;
    let _ = std::fs::remove_file(&path);
    let error = rec["error"].as_str().unwrap_or("unknown");
    let age = now_s.saturating_sub(rec["ts"].as_u64().unwrap_or(0));
    if age > MAX_AGE_S {
        return None;
    }
    let ago = age / 60;
    let body = format!(
        "8sync: your previous turn ended early on an API error (`{error}`, {ago} min ago), so work may be unfinished. Before answering, check your task list (TaskList) and the repo's su-code/ship/ACTIVE state; continue any unfinished task unless the owner's new message says otherwise."
    );
    Some(json!({ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": body } }).to_string())
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

    #[test]
    fn failure_is_recorded_then_said_once() {
        let dir = std::env::temp_dir().join(format!("8sync-stopfail-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let inp = r#"{"session_id":"abc-123","error":"rate_limit","cwd":"/home/u/works/zus"}"#;
        let msg = record(inp, &dir, 1_000).unwrap();
        assert!(msg.contains("rate_limit") && msg.contains("zus"));
        let n = note(r#"{"session_id":"abc-123","prompt":"tiếp"}"#, &dir, 1_000 + 600).unwrap();
        let v: Value = serde_json::from_str(&n).unwrap();
        let ctx = v["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
        assert!(ctx.contains("`rate_limit`, 10 min ago") && ctx.contains("TaskList"));
        assert!(note(r#"{"session_id":"abc-123"}"#, &dir, 2_000).is_none(), "said once");
        // other sessions, path tricks and junk are ignored
        assert!(note(r#"{"session_id":"other"}"#, &dir, 2_000).is_none());
        assert!(record(r#"{"session_id":"../x","error":"e"}"#, &dir, 1).is_none());
        assert!(record("not json", &dir, 1).is_none());
        // created 0600 inside a 0700 dir
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            record(r#"{"session_id":"p1","error":"e"}"#, &dir, 1).unwrap();
            assert_eq!(std::fs::metadata(dir.join("p1.json")).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        // a day-old record is not replayed
        record(r#"{"session_id":"old","error":"e"}"#, &dir, 1).unwrap();
        assert!(note(r#"{"session_id":"old"}"#, &dir, 1 + MAX_AGE_S + 1).is_none());
        // no HOME / relative HOME → nowhere to write
        assert!(state_dir(None).is_none() && state_dir(Some(Path::new(""))).is_none() && state_dir(Some(&std::env::temp_dir())).is_some());
        // the error string is sanitised before it reaches Claude
        record(r#"{"session_id":"s2","error":"x\"; echo `pwn`"}"#, &dir, 1).unwrap();
        assert!(note(r#"{"session_id":"s2"}"#, &dir, 1).unwrap().contains("`xechopwn`"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
