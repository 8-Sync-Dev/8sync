//! Questions and permission prompts parked for the owner's HQ (contract C5). A hook writes
//! `<hq state>/pending/<id>.json`, HQ answers with `<id>.answer.json` (atomic), the hook polls
//! every 500 ms until the deadline. Answer → both files go; timeout → the request goes and the
//! hook applies its fallback. Answers are checked against the request: a question answer must
//! name every question and give an option label or free text ≤ 500 chars; a permission answer
//! is a bool. Nothing here ever decides for the owner.
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, bail, Result};
use serde_json::{json, Map, Value};

/// How often a waiting hook looks for the answer.
pub(super) const POLL: Duration = Duration::from_millis(500);
/// Longest wait of a hook (the kit's hook timeout is 600 s).
pub(super) const WAIT_MAX_S: u64 = 540;
const FREE_TEXT_MAX: usize = 500;
const SUMMARY_MAX: usize = 300;
/// A request whose deadline passed longer ago than this belongs to a hook that died.
const SWEEP_MS: u64 = 3_600_000;

#[derive(Debug, PartialEq)]
pub(super) enum Answer {
    /// question text → chosen label(s) or free text.
    Question { answers: Map<String, Value>, note: Option<String> },
    Permission { allow: bool, note: Option<String> },
}

/// `<home>/.local/state/8sync/hq/pending` (same root as HQ's `Paths::under(home).state_dir`).
pub(super) fn dir(home: &Path) -> PathBuf {
    home.join(".local/state").join(crate::brand::NS).join("hq").join("pending")
}

pub(super) fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn new_id() -> Result<String> {
    let mut b = [0u8; 8];
    getrandom::getrandom(&mut b).map_err(|e| anyhow!("no OS randomness: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn files(dir: &Path, id: &str) -> (PathBuf, PathBuf) {
    (dir.join(format!("{id}.json")), dir.join(format!("{id}.answer.json")))
}

/// The fields every request shares; the caller adds `questions` or `tool` + `summary`.
pub(super) fn base(kind: &str, input: &Value, owner_only: bool, fallback: &str) -> Value {
    let cwd = input["cwd"].as_str();
    let session = input["session_id"].as_str().unwrap_or_default();
    json!({
        "kind": kind,
        "session_id": session,
        "cwd": cwd.unwrap_or_default(),
        "room": room(cwd, session),
        "owner_only": owner_only,
        "fallback": fallback,
    })
}

/// The ccc registry name of this session (`8sync ccc . <name>`), if it has one.
fn room(cwd: Option<&str>, session: &str) -> Option<String> {
    let cwd = Path::new(cwd?);
    if !cwd.is_absolute() || session.is_empty() {
        return None;
    }
    let root = crate::verbs::here::detect_project_root(cwd).unwrap_or_else(|| cwd.to_path_buf());
    let cfg = dirs::config_dir().or_else(|| dirs::home_dir().map(|h| h.join(".config")))?;
    let reg = crate::verbs::uuid_sessions::Store::new(&cfg, &root, "claude-sessions", "ccc .").load();
    reg.sessions.into_iter().find(|s| s.conversation_id == session).map(|s| s.name)
}

/// Writes the request atomically (0600 in a 0700 dir) with `v` and a fresh `id`; returns the id.
pub(super) fn post(home: &Path, req: &Value) -> Result<String> {
    let mut req = req.clone();
    let Some(obj) = req.as_object_mut() else { bail!("pending request must be an object") };
    let id = new_id()?;
    obj.insert("v".into(), json!(1));
    obj.insert("id".into(), json!(id));
    let dir = dir(home);
    let mut db = std::fs::DirBuilder::new();
    db.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut db, 0o700);
    db.create(&dir)?;
    let tmp = dir.join(format!(".{id}.json.tmp"));
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    use std::io::Write;
    o.open(&tmp)?.write_all(req.to_string().as_bytes())?;
    std::fs::rename(&tmp, files(&dir, &id).0)?;
    Ok(id)
}

/// Polls for the answer to `req` (a posted request, `id` set) until `deadline` (ms). Answer →
/// both files removed; timeout → the request and any unusable answer removed. An answer that
/// does not fit the request is ignored (HQ may rewrite it before the deadline).
pub(super) fn wait(home: &Path, req: &Value, deadline: u64, poll: Duration) -> Option<Answer> {
    let id = req["id"].as_str().filter(|id| id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit()))?;
    let (rp, ap) = files(&dir(home), id);
    let got = loop {
        if let Some(a) = std::fs::read_to_string(&ap).ok().and_then(|t| parse_answer(req, &t)) {
            break Some(a);
        }
        let now = now_ms();
        if now >= deadline {
            break None;
        }
        std::thread::sleep(poll.min(Duration::from_millis(deadline - now)));
    };
    let _ = std::fs::remove_file(&rp);
    let _ = std::fs::remove_file(&ap);
    got
}

/// Sweep, post `req` with a deadline `wait_s` from now, wait. `None` on timeout or when the
/// request cannot be written (the caller's fallback applies either way).
pub(super) fn ask(home: &Path, mut req: Value, wait_s: u64) -> Option<Answer> {
    let created = now_ms();
    let deadline = created + wait_s.min(WAIT_MAX_S) * 1000;
    sweep(&dir(home), created);
    req["created"] = json!(created);
    req["deadline"] = json!(deadline);
    let id = post(home, &req).ok()?;
    req["id"] = json!(id);
    wait(home, &req, deadline, POLL)
}

/// Drops requests whose deadline passed over an hour ago (their hook died), with their answers,
/// and hour-old orphan answers / temp files.
fn sweep(dir: &Path, now: u64) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let old = |p: &Path| {
        std::fs::metadata(p)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .is_some_and(|t| now.saturating_sub(t.as_millis() as u64) > SWEEP_MS)
    };
    for e in rd.flatten() {
        let p = e.path();
        let Some(name) = p.file_name().and_then(|n| n.to_str()).map(String::from) else { continue };
        if let Some(id) = name.strip_suffix(".answer.json") {
            if !dir.join(format!("{id}.json")).exists() && old(&p) {
                let _ = std::fs::remove_file(&p);
            }
        } else if let Some(id) = name.strip_suffix(".json") {
            let deadline = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v["deadline"].as_u64());
            if deadline.map_or_else(|| old(&p), |d| d.saturating_add(SWEEP_MS) < now) {
                let _ = std::fs::remove_file(&p);
                let _ = std::fs::remove_file(dir.join(format!("{id}.answer.json")));
            }
        } else if name.ends_with(".tmp") && old(&p) {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// Pure: the answer file checked against its request, `None` when it does not fit.
pub(super) fn parse_answer(req: &Value, text: &str) -> Option<Answer> {
    let a: Value = serde_json::from_str(text).ok()?;
    if a.get("v").is_some_and(|v| v != 1) {
        return None;
    }
    let note = match &a["note"] {
        Value::Null => None,
        Value::String(n) => Some(cut(&clean(n), FREE_TEXT_MAX)).filter(|n| !n.is_empty()),
        _ => return None,
    };
    match req["kind"].as_str()? {
        "permission" => Some(Answer::Permission { allow: a["allow"].as_bool()?, note }),
        "question" => {
            let qs = req["questions"].as_array().filter(|q| !q.is_empty())?;
            let given = a["answers"].as_object()?;
            let mut answers = Map::new();
            for q in qs {
                let text = q["question"].as_str()?;
                answers.insert(text.to_string(), json!(choice(q, given.get(text)?.as_str()?)?));
            }
            // every key names a question of the request
            (given.len() == answers.len()).then_some(Answer::Question { answers, note })
        }
        _ => None,
    }
}

/// An option label, labels joined with ", " (multi-select), or free text ≤ 500 chars.
fn choice(q: &Value, raw: &str) -> Option<String> {
    let s = clean(raw);
    if s.is_empty() {
        return None;
    }
    let labels: Vec<&str> = q["options"].as_array().into_iter().flatten().filter_map(|o| o["label"].as_str()).collect();
    let label = |x: &str| labels.contains(&x);
    let ok = label(&s) || (q["multiSelect"] == true && s.split(", ").all(label)) || s.chars().count() <= FREE_TEXT_MAX;
    ok.then_some(s)
}

/// Control and invisible / bidi characters dropped (newlines kept), trimmed.
fn clean(s: &str) -> String {
    let hidden = |c: char| {
        (c.is_control() && c != '\n')
            || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{2028}' | '\u{2029}' | '\u{FEFF}')
    };
    s.chars().filter(|c| !hidden(*c)).collect::<String>().trim().to_string()
}

/// At most `max` chars (char-safe), `…` marking a cut.
fn cut(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        None => s.to_string(),
        Some(_) => {
            let end = s.char_indices().nth(max.saturating_sub(1)).map_or(0, |(i, _)| i);
            format!("{}…", &s[..end])
        }
    }
}

/// Pure: one masked line (≤ 300 chars) saying what the tool wants — `command`, `file_path` or
/// `url`, else the input as JSON.
pub(super) fn summary(tool_input: &Value) -> String {
    let raw = ["command", "file_path", "url"].iter().find_map(|k| tool_input[*k].as_str()).map_or_else(|| tool_input.to_string(), String::from);
    let masked = crate::verbs::secret_mask::mask(&raw);
    cut(&masked.split_whitespace().collect::<Vec<_>>().join(" "), SUMMARY_MAX)
}

/// Test helper: waits (≤ 10 s) for the first request under `home`, writes `answer(request)` as
/// its answer the way HQ does (tmp + rename), and returns the request it saw.
#[cfg(test)]
pub(super) fn answer_when_posted(home: PathBuf, answer: impl Fn(&Value) -> Value + Send + 'static) -> std::thread::JoinHandle<Value> {
    std::thread::spawn(move || {
        let d = dir(&home);
        for _ in 0..1000 {
            let req = std::fs::read_dir(&d).into_iter().flatten().flatten().find_map(|e| {
                let n = e.file_name().into_string().ok()?;
                (n.ends_with(".json") && !n.ends_with(".answer.json") && !n.starts_with('.')).then(|| std::fs::read_to_string(e.path()).ok())??.parse::<Value>().ok()
            });
            if let Some(req) = req {
                let id = req["id"].as_str().unwrap().to_string();
                let tmp = d.join(format!("{id}.answer.tmp"));
                std::fs::write(&tmp, answer(&req).to_string()).unwrap();
                std::fs::rename(&tmp, d.join(format!("{id}.answer.json"))).unwrap();
                return req;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("no request posted under {}", d.display());
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home(tag: &str) -> PathBuf {
        let h = std::env::temp_dir().join(format!("8sync-pending-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        h
    }

    fn question_req() -> Value {
        json!({ "kind": "question", "questions": [
            { "question": "Màu nút?", "header": "UI", "multiSelect": false, "options": [{ "label": "Lime" }, { "label": "Blue" }] },
            { "question": "Thêm gì?", "header": "Extra", "multiSelect": true, "options": [{ "label": "Dark mode" }, { "label": "Toast" }] }
        ] })
    }

    #[test]
    fn answers_are_checked_against_the_request() {
        let req = question_req();
        let a = |v: Value| parse_answer(&req, &v.to_string());
        let Some(Answer::Question { answers, note }) = a(json!({ "v": 1, "answers": { "Màu nút?": "Lime", "Thêm gì?": "Dark mode, Toast" }, "note": " ok\u{202E} " })) else { panic!() };
        assert_eq!((answers["Màu nút?"].as_str(), answers["Thêm gì?"].as_str(), note.as_deref()), (Some("Lime"), Some("Dark mode, Toast"), Some("ok")));
        assert!(a(json!({ "answers": { "Màu nút?": "Xanh rêu nhạt", "Thêm gì?": "không" } })).is_some(), "free text, `v` optional");
        let long = "á".repeat(501);
        assert!(a(json!({ "answers": { "Màu nút?": long, "Thêm gì?": "Toast" } })).is_none(), "free text over 500 chars");
        assert!(a(json!({ "answers": { "Màu nút?": "Lime" } })).is_none(), "every question answered");
        assert!(a(json!({ "answers": { "Màu nút?": "Lime", "Thêm gì?": "Toast", "Khác?": "x" } })).is_none(), "unknown question");
        assert!(a(json!({ "answers": { "Màu nút?": " \u{200B} ", "Thêm gì?": "Toast" } })).is_none(), "blank");
        assert!(a(json!({ "answers": { "Màu nút?": 1, "Thêm gì?": "Toast" } })).is_none());
        assert!(a(json!({ "v": 2, "answers": { "Màu nút?": "Lime", "Thêm gì?": "Toast" } })).is_none(), "unknown version");
        assert!(a(json!({ "allow": true })).is_none(), "permission answer to a question");
        assert!(parse_answer(&req, "{not json").is_none());
        let perm = json!({ "kind": "permission" });
        assert_eq!(parse_answer(&perm, r#"{"v":1,"allow":false,"note":"không"}"#), Some(Answer::Permission { allow: false, note: Some("không".into()) }));
        assert_eq!(parse_answer(&perm, r#"{"v":1,"allow":true}"#), Some(Answer::Permission { allow: true, note: None }));
        for bad in [r#"{"v":1,"allow":"yes"}"#, r#"{"v":1}"#, r#"{"v":1,"allow":true,"note":5}"#] {
            assert!(parse_answer(&perm, bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn summary_is_one_masked_line_cut_char_safe() {
        let s = summary(&json!({ "command": "curl -H \"Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789\" \\\n  https://x.dev" }));
        assert!(!s.contains("abcdefghijklmnop") && !s.contains('\n') && s.contains("https://x.dev"), "{s}");
        assert_eq!(summary(&json!({ "file_path": "/repo/a.rs", "content": "x" })), "/repo/a.rs");
        assert_eq!(summary(&json!({ "url": "https://docs.rs" })), "https://docs.rs");
        assert_eq!(summary(&json!({ "pattern": "*.rs" })), r#"{"pattern":"*.rs"}"#);
        let long = summary(&json!({ "command": format!("echo {}", "ệ".repeat(400)) }));
        assert_eq!(long.chars().count(), SUMMARY_MAX);
        assert!(long.ends_with('…'));
    }

    #[test]
    fn timeout_removes_the_request() {
        let h = home("timeout");
        let req = json!({ "kind": "permission", "tool": "Bash" });
        let id = post(&h, &req).unwrap();
        assert!(id.len() == 16 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        let (rp, ap) = files(&dir(&h), &id);
        let stored: Value = serde_json::from_str(&std::fs::read_to_string(&rp).unwrap()).unwrap();
        assert_eq!((stored["v"].as_u64(), stored["id"].as_str(), stored["tool"].as_str()), (Some(1), Some(id.as_str()), Some("Bash")));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&rp).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(std::fs::metadata(dir(&h)).unwrap().permissions().mode() & 0o777, 0o700);
        }
        std::fs::write(&ap, r#"{"v":1,"allow":"maybe"}"#).unwrap(); // unusable: ignored
        let t = std::time::Instant::now();
        assert_eq!(wait(&h, &stored, now_ms() + 200, Duration::from_millis(20)), None);
        assert!(t.elapsed() >= Duration::from_millis(150));
        assert!(!rp.exists() && !ap.exists(), "both files gone after the timeout");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn answer_written_while_waiting_is_returned_and_cleaned_up() {
        let h = home("answer");
        let writer = answer_when_posted(h.clone(), |_| json!({ "v": 1, "answers": { "Màu nút?": "Blue", "Thêm gì?": "Toast" } }));
        let got = ask(&h, question_req(), 10);
        let seen = writer.join().unwrap();
        let Some(Answer::Question { answers, .. }) = got else { panic!("{got:?}") };
        assert_eq!(answers["Màu nút?"], "Blue");
        assert!(seen["deadline"].as_u64().unwrap() > seen["created"].as_u64().unwrap());
        assert_eq!(std::fs::read_dir(dir(&h)).unwrap().count(), 0, "request + answer removed");
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn sweep_drops_only_long_expired_requests() {
        let h = home("sweep");
        let now = now_ms();
        let old = post(&h, &json!({ "kind": "permission", "deadline": now - SWEEP_MS - 1 })).unwrap();
        let recent = post(&h, &json!({ "kind": "permission", "deadline": now - 1000 })).unwrap();
        let d = dir(&h);
        std::fs::write(files(&d, &old).1, "{}").unwrap();
        sweep(&d, now);
        assert!(!files(&d, &old).0.exists() && !files(&d, &old).1.exists());
        assert!(files(&d, &recent).0.exists(), "expired < 1 h ago: kept for HQ");
        let _ = std::fs::remove_dir_all(&h);
    }
}
