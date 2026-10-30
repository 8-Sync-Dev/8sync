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

/// The store both sides use: the `ship-grant` hook writes it, the guard reads it. One lookup
/// (`dirs::home_dir`, USERPROFILE on Windows): the hook used to read `HOME`, which Claude Code's
/// hook process on Windows lacks or holds as `/c/Users/…`, so no grant was ever written there
/// and every merge still prompted after the owner's Ship answer.
pub(super) fn default_dir() -> Option<PathBuf> {
    dirs::home_dir().filter(|h| h.is_absolute()).map(|h| dir(&h))
}

fn file(dir: &Path, session: &str) -> Option<PathBuf> {
    let id = crate::verbs::watchdog::safe_id(session)?;
    Some(dir.join(format!("{id}.json")))
}

/// Write `body` to `path` inside `dir`, owner-only on unix, replacing it atomically.
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
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    use std::io::Write;
    o.open(&tmp).ok()?.write_all(body.as_bytes()).ok()?;
    std::fs::rename(&tmp, path).ok().or_else(|| {
        let _ = std::fs::remove_file(&tmp);
        None
    })
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
/// question with an approving option. Returns the `Ship` scope it wrote (None: no `Ship` question).
pub(super) fn record(input: &str, dir: &Path, now_s: u64) -> Option<(bool, bool)> {
    let v: Value = serde_json::from_str(input).ok()?;
    if v["tool_name"] != "AskUserQuestion" {
        return None;
    }
    let session = v["session_id"].as_str()?;
    let path = file(dir, session)?;
    let qs = v["tool_input"]["questions"].as_array()?;
    let answers = &v["tool_response"]["answers"];
    fn answer<'a>(answers: &'a Value, q: &'a Value) -> Option<(&'a Value, &'a str, &'a str)> {
        let t = q["question"].as_str()?;
        Some((q, t, answers[t].as_str()?))
    }
    let ship = qs.iter().find(|q| q["header"].as_str().is_some_and(|h| h.trim().eq_ignore_ascii_case(HEADER))).and_then(|q| answer(answers, q));
    let granted = ship.map(|(_, _, a)| scope(a));
    let ((_, text, answer), (ship, deploy)) = (ship?, granted?);
    if !ship {
        let _ = std::fs::remove_file(&path);
        return Some((false, false));
    }
    let body = json!({ "ship": ship, "deploy": deploy, "until": now_s + TTL_S, "question": text, "answer": answer });
    write_private(dir, &path, &body.to_string())?;
    Some((ship, deploy))
}

/// The grant matches an owner answer that Claude Code itself wrote into this session's transcript:
/// an `AskUserQuestion` result with a `Ship` question and that exact answer, not text a tool
/// printed. Only then does the guard answer `allow` (skipping auto mode's prompt); a grant file
/// written any other way leaves the step to auto mode, as before.
pub(super) fn confirmed(dir: &Path, session: Option<&str>, transcript: Option<&Path>) -> bool {
    let (Some(path), Some(t)) = (session.and_then(|s| file(dir, s)), transcript) else { return false };
    let Some(g) = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { return false };
    let (Some(q), Some(a)) = (g["question"].as_str(), g["answer"].as_str()) else { return false };
    answered(t, q, a).is_some()
}

/// Whether transcript `t` holds an `AskUserQuestion` result (Claude Code's own record, not tool
/// output) where question `q` under header [`HEADER`] got answer `a`.
fn answered(t: &Path, q: &str, a: &str) -> Option<Value> {
    let text = std::fs::read_to_string(t).ok()?;
    text.lines().rev().filter(|l| l.contains("\"toolUseResult\"") && l.contains("\"answers\"")).find_map(|l| {
        let v = serde_json::from_str::<Value>(l).ok()?;
        let r = &v["toolUseResult"];
        (r["answers"][q].as_str() == Some(a)).then_some(())?;
        r["questions"].as_array()?.iter().find(|x| x["question"] == q && x["header"].as_str().is_some_and(|x| x.trim().eq_ignore_ascii_case(HEADER))).cloned()
    })
}

/// Guard side: does this session hold a live grant covering the step?
pub(super) fn allows(dir: &Path, session: Option<&str>, deploy: bool, now_s: u64) -> bool {
    // A relative store (no home) would read a `<session>.json` the repo itself could hold.
    if !dir.is_absolute() {
        return false;
    }
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
        assert!(!allows(Path::new("grants"), Some("s1"), false, 100), "a relative store never grants");
        // hook and guard share one store, found the same way on every OS (no `HOME` on Windows hooks)
        let src = include_str!("../ccc.rs");
        let arm = &src[src.find("Some(\"ship-grant\") =>").unwrap()..];
        let arm = &arm[..arm.find("\n        }").unwrap()];
        assert!(arm.contains("grant::default_dir()") && !arm.contains("\"HOME\""), "{arm}");
        assert!(include_str!("guard.rs").contains("super::grant::default_dir()"));
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
