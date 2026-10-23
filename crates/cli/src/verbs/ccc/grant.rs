//! One-shot ship approval. Instead of a prompt at every `gh pr merge`, tag push or
//! `vercel --prod`, Claude asks the owner ONCE with an `AskUserQuestion` whose header is
//! `Ship` (listing everything it will ship). The owner's answer reaches `ccc hook
//! ship-grant` (PostToolUse on AskUserQuestion) from Claude Code itself, so Claude cannot
//! forge it; the hook writes a per-session grant that the guard reads:
//! - an option starting with "Duyệt tất cả" / "Approve all" → shipping and production deploys;
//! - "Chỉ merge" / "Merge only" → shipping (merge, push main, tag, release, publish), no deploy;
//! - anything else → no grant.
//!
//! Grants last 8 hours and only for that session (the project self-merge permission: 8 hours, or
//! 24 when the chosen label says so, [`self_merge_ttl`]). Deny rules (force-push, deleting roots,
//! secrets…) never consult a grant.
//!
//! The same answer also writes a per-project self-merge permission (`self-merge.projects.json`
//! in the same store, keyed by the canonical repo root), so a relaunched lead keeps it: a `Ship`
//! answer that grants shipping, or any question answered with an option starting "Tự merge" /
//! "Cho tự merge" / "Self-merge" / "Auto-merge" without a negation. Only an option label counts
//! (a free-text "Other" answer never does). A `Ship` answer that grants nothing revokes it. Each
//! entry keeps the question, the answer and the session's transcript; [`self_merge`] honours it
//! only while that transcript holds the owner's real answer, so a forged store file grants
//! nothing. `auto merge` and the guard's approved-card merge read it ([`self_merge`]).
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub(super) const HEADER: &str = "Ship";
const TTL_S: u64 = 8 * 3600;
/// The project self-merge permission when the owner's chosen label says 24 h ("Chỉ merge, tự merge
/// 24h"): a day instead of [`TTL_S`], read from the label in the transcript like the grant itself.
/// Owner 2026-10-23: re-answering Ship every 8 h left approved cards waiting overnight.
const DAY_S: u64 = 24 * 3600;

/// Pure: how long a self-merge permission from these chosen labels lasts.
fn self_merge_ttl(labels: &[&str]) -> u64 {
    let day = |l: &&str| {
        let l = l.to_lowercase();
        ["24h", "24 h", "24 giờ", "1 ngày", "24 hours"].iter().any(|k| l.contains(k))
    };
    if labels.iter().any(day) { DAY_S } else { TTL_S }
}

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

/// The project permission store. The `.` keeps it out of the session ids [`file`] accepts.
fn projects_file(dir: &Path) -> PathBuf {
    dir.join("self-merge.projects.json")
}

/// The key a project's permission is filed under: its canonical git repo root (a worktree under
/// `.claude/worktrees` or a subfolder shares its repo's), like `ccc auto`'s own root.
fn project_key(at: &Path) -> String {
    let root = crate::verbs::here::repo_of(at).unwrap_or_else(|| at.to_path_buf());
    super::auto::canon(&root).to_string_lossy().into_owned()
}

/// The home a grant store belongs to (`<home>/.local/state/8sync/ccc/grants`), else None.
pub(super) fn home_of(grants: &Path) -> Option<&Path> {
    let home = grants.ancestors().nth(5)?;
    (dir(home) == grants).then_some(home)
}

/// Pure: does this option label let the lead merge approved cards itself? It starts with a
/// self-merge phrase and has no negation (`Không, tự merge sau` is a no).
pub(super) fn grants_self_merge(label: &str) -> bool {
    const SAYS: [&str; 6] = ["tự merge", "cho tự merge", "self-merge", "self merge", "auto-merge", "auto merge"];
    const NOT: [&str; 8] = ["không", "chưa", "tắt", "no", "not", "off", "later", "sau"];
    let l = label.trim().to_lowercase();
    SAYS.iter().any(|s| l.starts_with(s)) && !l.split(|c: char| !c.is_alphanumeric()).any(|w| NOT.contains(&w))
}

/// The option labels the owner chose: the answer is one label, or (multi-select) labels joined by
/// ", ", matched against the question's `options[].label` (a label may itself hold a comma).
/// Anything else (a free-text "Other" answer) → empty.
pub(super) fn chosen<'a>(answer: &str, q: &'a Value) -> Vec<&'a str> {
    let mut labels: Vec<&str> = q["options"].as_array().map(|o| o.iter().filter_map(|x| x["label"].as_str()).filter(|l| !l.is_empty()).collect()).unwrap_or_default();
    labels.sort_by_key(|l| std::cmp::Reverse(l.len()));
    if let Some(l) = labels.iter().find(|l| **l == answer) {
        return vec![*l];
    }
    let (mut out, mut rest) = (Vec::new(), answer);
    while !rest.is_empty() {
        let Some(l) = labels.iter().find(|l| rest.starts_with(**l) && (rest.len() == l.len() || rest[l.len()..].starts_with(", "))) else { return Vec::new() };
        out.push(*l);
        rest = rest[l.len()..].strip_prefix(", ").unwrap_or_default();
    }
    out
}

/// A live project self-merge permission.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct SelfMerge {
    pub until: u64,
    /// The session whose `AskUserQuestion` the owner answered.
    pub by: String,
    pub answer: String,
}

/// The live self-merge permission of the project `root` is in, from the store `dir`
/// (`<home>/…/grants`). The entry is only a pointer; the proof is re-read every time:
/// - its transcript canonicalizes under `<home>/.claude/projects/` (Claude Code's own logs);
/// - that transcript holds the owner's answer to its question, and the question as found there
///   still grants: a self-merge option label ([`grants_self_merge`]) or a shipping label under
///   header `Ship`;
/// - `until` is at most 8 h after it was recorded and at most 8 h from now.
pub(super) fn self_merge(dir: &Path, root: &Path, now: u64) -> Option<SelfMerge> {
    let home = home_of(dir).filter(|_| dir.is_absolute())?;
    let all: Value = serde_json::from_str(&std::fs::read_to_string(projects_file(dir)).ok()?).ok()?;
    let g = &all[project_key(root)];
    let at = g["at"].as_u64()?;
    let until = g["until"].as_u64().filter(|u| now < *u)?;
    let (q, a, t) = (g["question"].as_str()?, g["answer"].as_str()?, g["transcript"].as_str()?);
    let logs = home.join(".claude").join("projects").canonicalize().ok()?;
    let t = Path::new(t).canonicalize().ok().filter(|t| t.starts_with(&logs))?;
    let question = answered(&t, q, a, None)?;
    let ship = question["header"].as_str().is_some_and(|h| h.trim().eq_ignore_ascii_case(HEADER));
    let labels = chosen(a, &question);
    labels.iter().any(|l| grants_self_merge(l) || (ship && scope(l).0)).then_some(())?;
    // The lifetime comes from the label the transcript proves, never from the store file.
    let ttl = self_merge_ttl(&labels);
    (until <= at.saturating_add(ttl) && until <= now.saturating_add(ttl)).then_some(())?;
    Some(SelfMerge { until, by: g["by"].as_str().unwrap_or_default().into(), answer: a.into() })
}

/// `auto status --json`'s `self_merge`: `{until, by, answer}` or null.
pub(super) fn self_merge_json(dir: &Path, root: &Path, now: u64) -> Value {
    self_merge(dir, root, now).map_or(Value::Null, |g| json!({ "until": g.until, "by": g.by, "answer": g.answer }))
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

/// Set (`Some`) or revoke (`None`) project `key`'s permission; expired entries are dropped.
fn set_project(dir: &Path, key: &str, entry: Option<Value>, now_s: u64) -> Option<()> {
    let path = projects_file(dir);
    let mut all = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let map = all.as_object_mut()?;
    map.retain(|_, g| g["until"].as_u64().is_some_and(|u| now_s < u));
    match entry {
        Some(e) => {
            map.insert(key.to_string(), e);
        }
        None => {
            map.remove(key);
        }
    }
    write_private(dir, &path, &all.to_string())
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
/// question with an approving option, and the project self-merge permission (see the module doc).
/// Returns the `Ship` scope it wrote (None: no `Ship` question).
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
    let project = v["cwd"].as_str().map(Path::new).filter(|p| p.is_absolute()).map(project_key);
    let merge_ok = qs.iter().filter_map(|q| answer(answers, q)).find(|(q, _, a)| chosen(a, q).into_iter().any(grants_self_merge));
    let ship = qs.iter().find(|q| q["header"].as_str().is_some_and(|h| h.trim().eq_ignore_ascii_case(HEADER))).and_then(|q| answer(answers, q));
    let granted = ship.map(|(_, _, a)| scope(a));
    if let Some(key) = &project {
        let transcript = v["transcript_path"].as_str();
        let entry = |(qv, q, a): (&Value, &str, &str)| json!({ "at": now_s, "until": now_s + self_merge_ttl(&chosen(a, qv)), "by": session, "question": q, "answer": a, "transcript": transcript });
        // The project permission needs an option label, not free text.
        let ship_ok = ship.filter(|(q, _, a)| chosen(a, q).into_iter().any(|l| scope(l).0));
        // Best effort: a failed project write never costs the session grant below.
        let _ = match (ship_ok.or(merge_ok), granted) {
            (Some(qa), _) => set_project(dir, key, Some(entry(qa)), now_s),
            // The owner said no to shipping: the self-merge permission ends too.
            (None, Some(_)) => set_project(dir, key, None, now_s),
            (None, None) => None,
        };
    }
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
    answered(t, q, a, Some(HEADER)).is_some()
}

/// The question (as Claude Code recorded it) of an `AskUserQuestion` result in transcript `t`
/// (Claude Code's own record, not tool output) where question `q` (under `header`, if given) got
/// answer `a`; the latest such result.
fn answered(t: &Path, q: &str, a: &str, header: Option<&str>) -> Option<Value> {
    let text = std::fs::read_to_string(t).ok()?;
    text.lines().rev().filter(|l| l.contains("\"toolUseResult\"") && l.contains("\"answers\"")).find_map(|l| {
        let v = serde_json::from_str::<Value>(l).ok()?;
        let r = &v["toolUseResult"];
        (r["answers"][q].as_str() == Some(a)).then_some(())?;
        r["questions"].as_array()?.iter().find(|x| x["question"] == q && header.is_none_or(|h| x["header"].as_str().is_some_and(|x| x.trim().eq_ignore_ascii_case(h)))).cloned()
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

    #[test]
    fn self_merge_is_per_project_survives_relaunch_and_expires() {
        let d = std::env::temp_dir().join(format!("8sync-selfmerge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let (repo, other) = (d.join("game"), d.join("web"));
        for r in [&repo, &other] {
            std::fs::create_dir_all(r.join(".git")).unwrap();
        }
        let store = dir(&d);
        let logs = d.join(".claude/projects/p");
        std::fs::create_dir_all(&logs).unwrap();
        // What Claude Code sends the hook, and the transcript line it writes for the same answer.
        let answer = |session: &str, cwd: &Path, header: &str, a: &str, labels: &[&str]| {
            let qs = json!([{ "question": "Tốc độ?", "header": header, "options": labels.iter().map(|l| json!({ "label": l })).collect::<Vec<_>>() }]);
            let tr = logs.join(format!("{session}.jsonl"));
            let line = json!({ "type": "user", "toolUseResult": { "questions": qs, "answers": { "Tốc độ?": a } } });
            std::fs::write(&tr, format!("{line}\n")).unwrap();
            json!({
                "session_id": session, "cwd": cwd, "tool_name": "AskUserQuestion", "transcript_path": tr,
                "tool_input": { "questions": qs },
                "tool_response": { "answers": { "Tốc độ?": a } }
            })
            .to_string()
        };
        let speed = ["Tự merge khi đủ cổng (Recommended)", "Không, tự merge sau", "Để tôi duyệt từng PR"];
        let ship = ["Duyệt tất cả (Recommended)", "Chỉ merge, chưa deploy", "Dừng"];
        // A "Tự merge" answer under any header: project permission, no session Ship grant.
        assert_eq!(record(&answer("lead-a", &repo, "Tốc độ", "Tự merge khi đủ cổng (Recommended)", &speed), &store, 100), None);
        assert!(!allows(&store, Some("lead-a"), false, 200));
        let g = self_merge(&store, &repo, 200).unwrap();
        assert_eq!((g.until, g.by.as_str()), (100 + TTL_S, "lead-a"));
        // A relaunched lead (another session) in a worktree of the same repo still has it.
        assert!(self_merge(&store, &repo.join(".claude/worktrees/card-7"), 300).is_some());
        assert!(self_merge(&store, &other, 300).is_none(), "per project");
        assert!(self_merge(&store, &repo, 100 + TTL_S).is_none(), "expires at until");
        assert!(self_merge(Path::new("grants"), &repo, 200).is_none(), "a relative store never grants");
        // The transcript no longer holds the answer: nothing to prove it.
        std::fs::write(logs.join("lead-a.jsonl"), "").unwrap();
        assert!(self_merge(&store, &repo, 200).is_none(), "unproven");
        // A Ship answer grants both, for its own project; "Dừng" under Ship revokes it.
        assert_eq!(record(&answer("lead-b", &other, "Ship", "Duyệt tất cả (Recommended)", &ship), &store, 500), Some((true, true)));
        assert!(self_merge(&store, &other, 600).is_some() && allows(&store, Some("lead-b"), true, 600));
        assert_eq!(record(&answer("lead-c", &repo, "Ship", "Dừng", &ship), &store, 700), Some((false, false)));
        assert!(self_merge(&store, &repo, 800).is_none() && self_merge(&store, &other, 800).is_some());
        // Other answers grant nothing: another label, a negated label, free text ("Other").
        record(&answer("lead-d", &repo, "Tốc độ", "Duyệt tất cả", &["Duyệt tất cả"]), &store, 900);
        record(&answer("lead-d", &repo, "Merge", "Không, tự merge sau", &speed), &store, 900);
        record(&answer("lead-d", &repo, "Merge", "Tự merge khi đủ cổng", &speed), &store, 900);
        record(&answer("lead-d", &repo, "Merge", "tự merge luôn đi", &speed), &store, 900);
        assert!(self_merge(&store, &repo, 1_000).is_none());
        // The exact label grants; recorded from a worktree cwd, read from the repo root and back.
        let wt = repo.join(".claude/worktrees/card-9");
        std::fs::create_dir_all(&wt).unwrap();
        record(&answer("lead-e", &wt, "Tốc độ", "Tự merge khi đủ cổng", &["Tự merge khi đủ cổng", "Không"]), &store, 900);
        assert!(self_merge(&store, &repo, 1_000).is_some() && self_merge(&store, &wt, 1_000).is_some());
        // Multi-select: split by the labels (one holds a comma), not by commas.
        let multi = ["Nhanh hơn, ít hỏi", "Tự merge khi đủ cổng", "Không, tự merge sau"];
        record(&answer("lead-f", &other, "Ship", "Dừng", &ship), &store, 900);
        assert!(self_merge(&store, &other, 1_000).is_none());
        record(&answer("lead-f", &other, "Tốc độ", "Nhanh hơn, ít hỏi, Tự merge khi đủ cổng", &multi), &store, 900);
        assert!(self_merge(&store, &other, 1_000).is_some());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_forged_store_entry_grants_nothing() {
        let d = std::env::temp_dir().join(format!("8sync-selfmerge-forged-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let repo = d.join("game");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        let store = dir(&d);
        let line = |q: &str, a: &str, labels: &[&str]| {
            let qs = json!([{ "question": q, "header": "X", "options": labels.iter().map(|l| json!({ "label": l })).collect::<Vec<_>>() }]);
            format!("{}\n", json!({ "type": "user", "toolUseResult": { "questions": qs, "answers": { q: a } } }))
        };
        let logs = d.join(".claude/projects/game");
        std::fs::create_dir_all(&logs).unwrap();
        let real = logs.join("s.jsonl");
        std::fs::write(&real, line("Model?", "Opus", &["Opus", "Sonnet"]) + &line("Tốc độ?", "Tự merge khi đủ cổng", &["Tự merge khi đủ cổng"])).unwrap();
        let fake = d.join("fake.jsonl");
        std::fs::write(&fake, line("Tốc độ?", "Tự merge khi đủ cổng", &["Tự merge khi đủ cổng"])).unwrap();
        let key = project_key(&repo);
        let put = |q: &str, a: &str, at: u64, until: u64, t: Option<&Path>| {
            set_project(&store, &key, Some(json!({ "at": at, "until": until, "by": "x", "question": q, "answer": a, "transcript": t })), 0).unwrap();
            self_merge(&store, &repo, 100).is_some()
        };
        assert!(put("Tốc độ?", "Tự merge khi đủ cổng", 0, TTL_S, Some(&real)), "control: a real answer grants");
        // Scenario A: a real transcript, but an unrelated question/answer, and a huge until.
        assert!(!put("Model?", "Opus", 0, TTL_S, Some(&real)), "the answer does not grant self-merge");
        assert!(!put("Tốc độ?", "Tự merge khi đủ cổng", 0, u64::MAX, Some(&real)), "until past 8 h");
        assert!(!put("Tốc độ?", "Tự merge khi đủ cổng", 50, TTL_S + 60, Some(&real)), "until past recorded + 8 h");
        // Scenario B: a transcript outside ~/.claude/projects, even one holding a valid answer.
        assert!(!put("Tốc độ?", "Tự merge khi đủ cổng", 0, TTL_S, Some(&fake)), "fake transcript");
        assert!(!put("Tốc độ?", "Tự merge khi đủ cổng", 0, TTL_S, Some(&logs.join("../../../fake.jsonl"))), "`..` out of the logs");
        assert!(!put("Tốc độ?", "Không có", 0, TTL_S, Some(&real)), "no such answer in the transcript");
        assert!(!put("Tốc độ?", "Tự merge khi đủ cổng", 0, TTL_S, None), "no transcript");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn chosen_matches_option_labels_only() {
        let q = json!({ "options": [{ "label": "A, b" }, { "label": "A" }, { "label": "C" }] });
        assert_eq!(chosen("A, b", &q), vec!["A, b"]);
        assert_eq!(chosen("A, b, C", &q), vec!["A, b", "C"]);
        assert_eq!(chosen("A, C", &q), vec!["A", "C"]);
        assert!(chosen("A, D", &q).is_empty() && chosen("free text", &q).is_empty() && chosen("", &q).is_empty());
    }

    #[test]
    fn self_merge_reads_the_option_label_and_the_store_finds_its_home() {
        for yes in ["Tự merge khi đủ cổng", "Cho tự merge", "Self-merge when gates pass", "Auto-merge"] {
            assert!(grants_self_merge(yes), "{yes}");
        }
        for no in ["Không tự merge", "Không, tự merge sau", "Tự merge sau", "Tự merge: chưa", "Auto-merge off", "Self-merge later", "Duyệt tất cả", "Dừng", "Nhanh hơn, tự merge khi đủ cổng", ""] {
            assert!(!grants_self_merge(no), "{no}");
        }
        let home = Path::new("/home/u");
        assert_eq!(home_of(&dir(home)), Some(home));
        assert_eq!(home_of(Path::new("/tmp/grants")), None);
    }

    #[test]
    fn self_merge_lasts_a_day_only_when_the_label_says_so() {
        assert_eq!(self_merge_ttl(&["Chỉ merge, tự merge 24h"]), DAY_S);
        assert_eq!(self_merge_ttl(&["Tự merge 24 giờ"]), DAY_S);
        assert_eq!(self_merge_ttl(&["Chỉ merge, chưa deploy"]), TTL_S);
        assert_eq!(self_merge_ttl(&["Tự merge khi đủ cổng"]), TTL_S);
        assert_eq!(self_merge_ttl(&[]), TTL_S);
    }
}
