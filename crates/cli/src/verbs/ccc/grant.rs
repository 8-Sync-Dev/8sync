//! One-shot ship approval. Instead of a prompt at every `gh pr merge`, tag push or
//! `vercel --prod`, Claude asks the owner ONCE with an `AskUserQuestion` whose header is
//! `Ship` (listing everything it will ship). The owner's answer reaches `ccc hook
//! ship-grant` (PostToolUse on AskUserQuestion) from Claude Code itself, so Claude cannot
//! forge it; the hook writes a per-session grant that the guard reads:
//! - an option starting with "Duyệt tất cả" / "Approve all" → shipping and production deploys;
//! - "Chỉ merge" / "Merge only" → shipping (merge, push main, tag, release, publish), no deploy;
//! - anything else → no grant.
//!
//! Grants last 8 hours and only for that session. Deny rules (force-push, deleting roots,
//! secrets…) never consult a grant.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub(super) const HEADER: &str = "Ship";
const TTL_S: u64 = 8 * 3600;

pub(super) fn dir(home: &Path) -> PathBuf {
    home.join(".local/state/8sync/ccc/grants")
}

fn file(dir: &Path, session: &str) -> Option<PathBuf> {
    let id = crate::verbs::watchdog::safe_id(session)?;
    Some(dir.join(format!("{id}.json")))
}

/// Pure: what an answer to the `Ship` question grants: (ship, deploy).
pub(super) fn scope(answer: &str) -> (bool, bool) {
    let a = answer.trim().to_lowercase();
    if a.starts_with("duyệt tất cả") || a.starts_with("approve all") {
        (true, true)
    } else if a.starts_with("chỉ merge") || a.starts_with("merge only") {
        (true, false)
    } else {
        (false, false)
    }
}

/// PostToolUse(AskUserQuestion): records the grant when the owner answered a `Ship`
/// question with an approving option. Returns the scope it wrote.
pub(super) fn record(input: &str, dir: &Path, now_s: u64) -> Option<(bool, bool)> {
    let v: Value = serde_json::from_str(input).ok()?;
    if v["tool_name"] != "AskUserQuestion" {
        return None;
    }
    let path = file(dir, v["session_id"].as_str()?)?;
    let q = v["tool_input"]["questions"].as_array()?.iter().find(|q| q["header"].as_str().is_some_and(|h| h.trim().eq_ignore_ascii_case(HEADER)))?;
    let text = q["question"].as_str()?;
    let answer = v["tool_response"]["answers"][text].as_str()?;
    let (ship, deploy) = scope(answer);
    if !ship {
        let _ = std::fs::remove_file(&path);
        return Some((false, false));
    }
    let mut db = std::fs::DirBuilder::new();
    db.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut db, 0o700);
    db.create(dir).ok()?;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    use std::io::Write;
    let body = json!({ "ship": ship, "deploy": deploy, "until": now_s + TTL_S, "question": text, "answer": answer });
    o.open(&path).ok()?.write_all(body.to_string().as_bytes()).ok()?;
    Some((ship, deploy))
}

/// Guard side: does this session hold a live grant covering the step?
pub(super) fn allows(dir: &Path, session: Option<&str>, deploy: bool, now_s: u64) -> bool {
    let Some(path) = session.and_then(|s| file(dir, s)) else { return false };
    let Some(g) = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { return false };
    let live = g["until"].as_u64().is_some_and(|u| now_s < u);
    live && g["ship"] == true && (!deploy || g["deploy"] == true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(session: &str, header: &str, answer: &str) -> String {
        json!({
            "session_id": session,
            "tool_name": "AskUserQuestion",
            "tool_input": { "questions": [
                { "question": "Model?", "header": "Model", "options": [] },
                { "question": "Ship these 3 PRs and deploy zus-web to prod?", "header": header, "options": [] }
            ]},
            "tool_response": { "answers": { "Model?": "Opus", "Ship these 3 PRs and deploy zus-web to prod?": answer } }
        })
        .to_string()
    }

    #[test]
    fn owner_answer_grants_once_for_that_session_only() {
        let d = std::env::temp_dir().join(format!("8sync-grant-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(record(&ask("s1", "Ship", "Duyệt tất cả (Recommended)"), &d, 100), Some((true, true)));
        assert!(allows(&d, Some("s1"), true, 200));
        assert!(!allows(&d, Some("s2"), false, 200), "other sessions get nothing");
        assert!(!allows(&d, Some("s1"), true, 100 + TTL_S + 1), "expires");
        // merge-only: no prod deploys
        record(&ask("s3", "ship", "Chỉ merge, chưa deploy"), &d, 100).unwrap();
        assert!(allows(&d, Some("s3"), false, 200) && !allows(&d, Some("s3"), true, 200));
        // "stop" revokes; a question with another header grants nothing
        assert_eq!(record(&ask("s1", "Ship", "Dừng"), &d, 300), Some((false, false)));
        assert!(!allows(&d, Some("s1"), false, 400));
        assert_eq!(record(&ask("s4", "Deploy", "Duyệt tất cả"), &d, 100), None);
        assert!(!allows(&d, Some("s4"), false, 200));
        // path tricks and non-AskUserQuestion input
        assert_eq!(record(&ask("../x", "Ship", "Duyệt tất cả"), &d, 100), None);
        assert_eq!(record(r#"{"tool_name":"Bash","session_id":"s5"}"#, &d, 100), None);
        assert!(!allows(&d, None, false, 0));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(d.join("s3.json")).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn scope_reads_the_option_label() {
        assert_eq!(scope("Approve all (Recommended)"), (true, true));
        assert_eq!(scope("Merge only, no deploy"), (true, false));
        assert_eq!(scope("Dừng lại"), (false, false));
        assert_eq!(scope(""), (false, false));
    }
}
