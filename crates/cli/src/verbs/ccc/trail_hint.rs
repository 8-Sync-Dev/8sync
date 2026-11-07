//! `8sync ccc hook trail-hint` (PreToolUse on Grep|Glob): when the repo has a trail index
//! (`.trail/`), remind Claude once per session per repo that `trail ask|grep|skeleton|callers`
//! answers code questions cheaper than raw grep. Never blocks: the output carries only
//! `additionalContext`, no `permissionDecision`. Not on Bash: every Bash call would pay a second
//! process spawn beside the guard. Silent on repeat calls (one stdin parse and a few `stat`s).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// Dedupe files older than this are pruned (a session rarely lives a week).
const MAX_AGE_S: u64 = 7 * 24 * 3600;

const HINT: &str = "Repo có trail index (.trail/): mọi tìm kiếm code đi qua code map, rẻ hơn grep/glob nhiều lần. Ai gọi X · X gọi gì · impact · đường A→B → `GRAPHIFY_MAX_WORKERS=4 graphify update . --no-cluster` (đầu phiên + sau khi sửa) rồi `graphify explain <symbol>` / `graphify path \"A()\" \"B()\"`. X ở đâu · chữ kèm ngữ cảnh symbol · khung file → `trail ask|grep|skeleton`. Chỉ grep khi cả hai không trả lời được.";

/// Where the per-session dedupe files live.
pub(super) fn state_dir(home: Option<&Path>) -> Option<PathBuf> {
    home.filter(|h| h.is_absolute()).map(|h| h.join(".local/state/8sync/ccc/trail-hint"))
}

/// The nearest ancestor of `cwd` holding a `.trail/` dir, stopping at the repo root (`.git`).
fn trail_root(cwd: &Path) -> Option<PathBuf> {
    for dir in cwd.ancestors() {
        if dir.join(".trail").is_dir() {
            return Some(dir.to_path_buf());
        }
        if dir.join(".git").exists() {
            return None;
        }
    }
    None
}

pub(super) fn run(input: &str, state: &Path, now_s: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    if !matches!(v["tool_name"].as_str()?, "Grep" | "Glob") {
        return None;
    }
    // No usable session id = no dedupe = stay quiet rather than repeat on every call.
    let sid = v["session_id"].as_str().filter(|s| crate::verbs::ccc::report::safe_id(s))?;
    let root = trail_root(Path::new(v["cwd"].as_str()?))?;
    let key = root.to_string_lossy().into_owned();
    let seen_file = state.join(format!("{sid}.seen"));
    let seen: HashSet<String> = std::fs::read_to_string(&seen_file).map(|t| t.lines().map(String::from).collect()).unwrap_or_default();
    if seen.contains(&key) {
        return None;
    }
    let _ = std::fs::create_dir_all(state);
    prune(state, now_s);
    let mut all: Vec<String> = seen.into_iter().collect();
    all.push(key);
    // Can't record it (read-only state dir)? Skip the hint: repeating it every call costs more.
    std::fs::write(&seen_file, all.join("\n")).ok()?;
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "additionalContext": HINT } }).to_string())
}

fn prune(dir: &Path, now_s: u64) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        if e.path().extension().is_none_or(|x| x != "seen") {
            continue;
        }
        let old = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).is_some_and(|t| now_s.saturating_sub(t.as_secs()) > MAX_AGE_S);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("8sync_trail_hint_{}_{tag}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn call(tool: &str, input: Value, cwd: &Path, sid: &str) -> String {
        json!({ "session_id": sid, "tool_name": tool, "tool_input": input, "cwd": cwd.to_string_lossy() }).to_string()
    }

    #[test]
    fn hints_once_per_session_and_repo_when_trail_index_exists() {
        let t = Tmp::new("once");
        let repo = t.0.join("repo");
        std::fs::create_dir_all(repo.join(".trail")).unwrap();
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let sub = repo.join("src");
        std::fs::create_dir_all(&sub).unwrap();
        let state = t.0.join("state");

        let out = run(&call("Grep", json!({ "pattern": "fn main" }), &sub, "s1"), &state, 0).expect("first search hints");
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        assert!(v["hookSpecificOutput"]["additionalContext"].as_str().unwrap().contains("trail ask"));
        // Never a decision: the tool call always proceeds.
        assert!(v["hookSpecificOutput"].get("permissionDecision").is_none() && v.get("decision").is_none());

        // Same session + repo: silent, whatever the search tool.
        assert_eq!(run(&call("Glob", json!({ "pattern": "**/*.rs" }), &repo, "s1"), &state, 0), None);
        // A new session hints again.
        assert!(run(&call("Grep", json!({ "pattern": "foo" }), &repo, "s2"), &state, 0).is_some());
    }

    #[test]
    fn never_hints_without_trail_index_or_for_non_search_calls() {
        let t = Tmp::new("none");
        let repo = t.0.join("plain");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let state = t.0.join("state");
        assert_eq!(run(&call("Grep", json!({ "pattern": "x" }), &repo, "s1"), &state, 0), None);

        let indexed = t.0.join("indexed");
        std::fs::create_dir_all(indexed.join(".trail")).unwrap();
        for (tool, input) in [("Bash", json!({ "command": "rg foo" })), ("Read", json!({ "file_path": "a.rs" })), ("Edit", json!({}))] {
            assert_eq!(run(&call(tool, input, &indexed, "s1"), &state, 0), None, "tool={tool}");
        }
        // A `.trail` above the repo root (`.git`) does not count.
        let nested = indexed.join("child");
        std::fs::create_dir_all(nested.join(".git")).unwrap();
        assert_eq!(run(&call("Grep", json!({ "pattern": "x" }), &nested, "s1"), &state, 0), None);
    }

    #[test]
    fn unsafe_session_id_never_names_a_state_file() {
        let t = Tmp::new("sid");
        let repo = t.0.join("repo");
        std::fs::create_dir_all(repo.join(".trail")).unwrap();
        let state = t.0.join("state");
        for sid in ["../escape", "a/b", "", "..\\x"] {
            assert_eq!(run(&call("Grep", json!({ "pattern": "x" }), &repo, sid), &state, 0), None, "sid={sid:?}");
        }
        assert!(!state.exists() && !t.0.join("escape.seen").exists());
    }
}
