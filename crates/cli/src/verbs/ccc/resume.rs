//! Turns that end on an API error. Claude Code runs `StopFailure` instead of `Stop`
//! then (rate_limit, overloaded, server_error, max_output_tokens, …), and that hook
//! has no decision control (https://code.claude.com/docs/en/hooks). So:
//! - `ccc hook stop-failure` records the error per session (`<state>/stopfail/<id>.json`)
//!   and pops a desktop notification so the owner knows the session stalled;
//! - `ccc hook resume-note` (UserPromptSubmit) consumes that record on the next prompt
//!   (even a bare "tiếp") and tells Claude to check its task list and finish the work.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub(super) fn state_dir(home: &Path) -> PathBuf {
    home.join(".local/state/8sync/ccc/stopfail")
}

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
    std::fs::create_dir_all(dir).ok()?;
    std::fs::write(&path, json!({ "error": error, "ts": now_s, "cwd": cwd }).to_string()).ok()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
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
    let ago = now_s.saturating_sub(rec["ts"].as_u64().unwrap_or(now_s)) / 60;
    let body = format!(
        "8sync: your previous turn ended early on an API error (`{error}`, {ago} min ago), so work may be unfinished. Before answering, check your task list (TaskList) and the repo's su-code/ship/ACTIVE state; continue any unfinished task unless the owner's new message says otherwise."
    );
    Some(json!({ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": body } }).to_string())
}

pub(super) fn notify(msg: &str) {
    if which::which("notify-send").is_ok() {
        let _ = std::process::Command::new("notify-send")
            .args(["-a", "8sync", "8sync: Claude Code stalled", msg])
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
        // the error string is sanitised before it reaches Claude
        record(r#"{"session_id":"s2","error":"x\"; echo `pwn`"}"#, &dir, 1).unwrap();
        assert!(note(r#"{"session_id":"s2"}"#, &dir, 1).unwrap().contains("`xechopwn`"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
