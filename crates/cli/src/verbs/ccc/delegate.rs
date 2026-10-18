//! "Critic chọn thay owner": `8sync ccc delegate on|off|status` and `8sync ccc hook delegate`
//! (PreToolUse, matcher `AskUserQuestion`, no model call).
//!
//! When the owner turns it on, a product/technical question does not reach the owner: the hook
//! denies the tool call (https://code.claude.com/docs/en/hooks, PreToolUse
//! `permissionDecision: "deny"` + reason, which Claude reads) and tells Claude to have the kit's
//! `critic` agent grade the options (FATAL/MAJOR/MINOR, the reviewer pass of Feynman's deep
//! research) and go with its pick, logging the decision in `su-code/DECISIONS.md`.
//!
//! Rails (8 Sync rules, `assets/claude/CLAUDE.md`): the owner still answers the `Ship` question,
//! anything about secrets/credentials/login, destructive / irreversible / paid steps, production
//! deploys, merges and releases, and high-risk decisions (legal, medical, hiring, credit). Those
//! pass through untouched. OFF by default (`delegate = true` in features.toml or
//! `EIGHTSYNC_DELEGATE=1`).
//!
//! `on --after <s>` ("owner treo"): nothing happens while a prompt typed by a human reached this
//! session in the last `s` seconds (`delegate_after_s`; 0 = the critic answers at once). Once the
//! owner is away the question is parked for HQ (`pending`, contract C5) for `min(s, 540)` seconds:
//! an HQ answer is handed to Claude Code as the AskUserQuestion answer (PreToolUse `allow` +
//! `updatedInput.answers`); no answer → the critic (owner-only questions: the dialog, as before).
//! "Away" is approximated by "has not typed here for `s` seconds"; an unreadable transcript counts
//! as present. Limitation: answering an earlier question in a dialog is not counted as typing.
//!
//! `8sync ccc hook permission` (PermissionRequest, matcher `*`): same switch, scope and presence
//! (threshold `s`, 60 when 0). An away owner's permission prompt is parked for HQ; only the
//! owner's `allow` allows, a deny or no answer denies with guidance so the room keeps working.
use std::path::Path;

use anyhow::{bail, Result};
use serde_json::{json, Map, Value};

use super::pending::{self, Answer};

pub(super) const KEY: &str = "delegate";
const AFTER_KEY: &str = "delegate_after_s";
/// Longest "owner away" threshold accepted (1 day).
const AFTER_MAX: u64 = 86_400;
const ENV: &str = "EIGHTSYNC_DELEGATE";

/// Words that keep a question with the owner (lowercase substrings, Vietnamese + English).
/// High-risk areas follow the Usage Policy's "AI Recommendations" list (https://www.anthropic.com/legal/aup).
const OWNER_ONLY: [&str; 55] = [
    "secret", "password", "mật khẩu", "api key", "token", "credential", "login", "đăng nhập", "account", "tài khoản",
    "deploy", "production", "prod ", "release", "publish", "merge", "push", "tag ", "xoá", "xóa", "delete", "drop",
    "migrat", "force", "rotate", "không hoàn tác", "irreversible", "payment", "thanh toán", "money", "tiền", "pay ",
    "billing", "mua ", "buy", "pháp lý", "legal", "y tế", "medical", "tuyển", "hiring", "tín dụng",
    "credit", "bảo hiểm", "insurance", "nhà ở", "housing", "tài chính", "financ", "phúc lợi", "welfare", "admission",
    "chấm điểm", "grading", "khách hàng thật",
];

/// Flag off (`delegate off`, `ccc cancel --all`); the `--after` value is left as set.
pub(super) fn off(home: &Path) -> Result<()> {
    crate::verbs::harness::cbm::write_flag_key(home, KEY, false)
}

pub(super) fn enabled(home: &Path) -> bool {
    crate::verbs::harness::cbm::resolve(std::env::var(ENV).ok().as_deref(), crate::verbs::harness::cbm::read_flag_key(home, KEY))
}

/// Flag on with `delegate_after_s = after_s` (0 = always). Validate with [`parse_after`] first.
pub(super) fn on(home: &Path, after_s: u64) -> Result<()> {
    if after_s > AFTER_MAX {
        bail!("--after: tối đa 1 ngày");
    }
    crate::verbs::harness::cbm::write_flag_key(home, KEY, true)?;
    crate::verbs::harness::cbm::write_key(home, AFTER_KEY, toml::Value::Integer(after_s as i64))
}

/// What Claude reads when the critic answers instead of the owner.
const CRITIC: &str = "8sync delegate: owner đã uỷ quyền cho critic, KHÔNG hỏi owner câu này. Làm ngay: (1) gọi Agent subagent_type \"critic\" với \
     nguyên văn các câu hỏi + options + ngữ cảnh (file, số đo); critic chấm từng option FATAL/MAJOR/MINOR và chọn một; \
     (2) đi theo lựa chọn của critic (critic không chạy được → chọn option có \"(Recommended)\", không có → option an toàn, phổ biến nhất); \
     (3) thêm một dòng vào su-code/DECISIONS.md: `- <yyyy-mm-dd> <câu hỏi> → <lựa chọn> (critic: <lý do một dòng>)`; \
     (4) làm tiếp và nêu quyết định trong báo cáo cuối. Secret, xoá/không hoàn tác, tiền, deploy prod, merge/release, câu `Ship` và \
     quyết định high-risk vẫn hỏi owner.";

/// Pure: the `Ship` question, secrets, destructive / paid / deploy / merge / release and
/// high-risk questions stay with the owner (never the critic).
fn owner_only(qs: &[Value]) -> bool {
    let mut text = String::new();
    for q in qs {
        if q["header"].as_str().is_some_and(|h| h.trim().eq_ignore_ascii_case("ship")) {
            return true;
        }
        text.push_str(q["question"].as_str().unwrap_or_default());
        text.push(' ');
        text.push_str(q["header"].as_str().unwrap_or_default());
        for o in q["options"].as_array().into_iter().flatten() {
            text.push(' ');
            text.push_str(o["label"].as_str().unwrap_or_default());
            text.push(' ');
            text.push_str(o["description"].as_str().unwrap_or_default());
        }
        text.push(' ');
    }
    let low = text.to_lowercase();
    OWNER_ONLY.iter().any(|w| low.contains(w))
}

pub(super) fn after_s(home: &Path) -> u64 {
    crate::verbs::harness::cbm::read_int_key(home, AFTER_KEY).map_or(0, |n| (n.max(0) as u64).min(AFTER_MAX))
}

/// Pure: with a threshold, the owner counts as away only when their last typed prompt is known and
/// at least `after` seconds old.
fn owner_away(after: u64, last_human: Option<u64>, now: u64) -> bool {
    after == 0 || last_human.is_some_and(|t| now.saturating_sub(t) >= after)
}

/// The owner has not typed into this session (hook input `transcript_path`) for `after` seconds.
fn away(v: &Value, after: u64) -> bool {
    let last = v["transcript_path"].as_str().and_then(|p| super::idle::last_human_ts(Path::new(p)));
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    owner_away(after, last, now)
}

/// Longest wait for an HQ answer. Unit tests never park a hook for real (the auto/delegate
/// tests call the hooks with a threshold); the waiting paths are tested with an explicit cap.
fn wait_cap() -> u64 {
    if cfg!(test) { 0 } else { pending::WAIT_MAX_S }
}

/// `8sync ccc hook delegate`: PreToolUse JSON in; the owner's HQ answer, the critic's deny, or
/// nothing (the owner sees the question).
pub(super) fn hook(input: &str, home: &Path) -> Option<String> {
    hook_with(input, home, wait_cap())
}

fn hook_with(input: &str, home: &Path, cap_s: u64) -> Option<String> {
    if !enabled(home) {
        return None;
    }
    let v: Value = serde_json::from_str(input).ok()?;
    if v["tool_name"].as_str() != Some("AskUserQuestion") || !super::auto::in_scope(home, v["cwd"].as_str()) {
        return None;
    }
    let qs = v["tool_input"]["questions"].as_array().filter(|q| !q.is_empty())?;
    let owner_only = owner_only(qs);
    let after = after_s(home);
    if after == 0 {
        return (!owner_only).then(critic_output);
    }
    if !away(&v, after) {
        return None;
    }
    let mut req = pending::base("question", &v, owner_only, if owner_only { "dialog" } else { "critic" });
    req["questions"] = json!(qs);
    match pending::ask(home, req, after.min(cap_s)) {
        Some(Answer::Question { answers, note }) => answered_output(&v["tool_input"], answers, note),
        _ => (!owner_only).then(critic_output),
    }
}

fn critic_output() -> String {
    json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": CRITIC } }).to_string()
}

/// Pure: AskUserQuestion answered programmatically — the original input (its `questions`) plus
/// `answers` (question text → label, multi-select labels joined with ", ").
fn answered_output(tool_input: &Value, answers: Map<String, Value>, note: Option<String>) -> Option<String> {
    let mut input = tool_input.as_object()?.clone();
    input.insert("answers".into(), Value::Object(answers));
    let mut out = json!({ "hookEventName": "PreToolUse", "permissionDecision": "allow", "permissionDecisionReason": "8sync: owner trả lời qua HQ", "updatedInput": input });
    if let Some(n) = note {
        out["additionalContext"] = json!(format!("8sync: owner trả lời câu hỏi qua HQ, kèm ghi chú: {n}"));
    }
    Some(json!({ "hookSpecificOutput": out }).to_string())
}

/// `8sync ccc hook permission`: PermissionRequest JSON in; the owner's HQ decision, a deny with
/// guidance when the owner does not answer, or nothing (the dialog shows). Never allows by itself.
pub(super) fn permission(input: &str, home: &Path) -> Option<String> {
    permission_with(input, home, wait_cap())
}

fn permission_with(input: &str, home: &Path, cap_s: u64) -> Option<String> {
    if !enabled(home) {
        return None;
    }
    let v: Value = serde_json::from_str(input).ok()?;
    let tool = v["tool_name"].as_str()?;
    // An AskUserQuestion dialog left for the owner (owner-only, owner present) is not a permission.
    if tool == "AskUserQuestion" || !super::auto::in_scope(home, v["cwd"].as_str()) {
        return None;
    }
    let after = match after_s(home) {
        0 => 60,
        n => n,
    };
    if !away(&v, after) {
        return None;
    }
    let mut req = pending::base("permission", &v, false, "deny");
    req["tool"] = json!(tool);
    req["summary"] = json!(pending::summary(&v["tool_input"]));
    Some(permission_output(pending::ask(home, req, after.min(cap_s)), after))
}

/// Pure: allow only on the owner's `allow: true`; anything else denies with what to do instead.
fn permission_output(answer: Option<Answer>, after: u64) -> String {
    const NEXT: &str = "dùng cách không cần quyền này hoặc ghi vào báo cáo cuối việc cần owner duyệt rồi làm phần còn lại.";
    let decision = match answer {
        Some(Answer::Permission { allow: true, .. }) => json!({ "behavior": "allow" }),
        Some(Answer::Permission { allow: false, note }) => {
            let why = note.map(|n| format!(" (owner ghi: {n})")).unwrap_or_default();
            json!({ "behavior": "deny", "message": format!("8sync: owner từ chối quyền này qua HQ{why}; đừng thử lại cách này — {NEXT}") })
        }
        _ => json!({ "behavior": "deny", "message": format!("8sync: owner vắng > {after} giây nên quyền này bị từ chối tự động; đừng chờ — {NEXT}") }),
    };
    json!({ "hookSpecificOutput": { "hookEventName": "PermissionRequest", "decision": decision } }).to_string()
}

/// `8sync ccc delegate on | off | status`.
pub(super) fn run(rest: &[String], home: &Path) -> Result<()> {
    match rest.first().map(String::as_str) {
        Some(x @ ("on" | "off")) => {
            let after = match rest.get(1..).unwrap_or_default() {
                [] => 0,
                [f, n] if f == "--after" && x == "on" => parse_after(n)?,
                _ => bail!("usage: 8sync ccc delegate on [--after <giây|1m|5m>] | off | status"),
            };
            if x == "on" {
                on(home, after)?;
            } else {
                off(home)?;
                crate::verbs::harness::cbm::write_key(home, AFTER_KEY, toml::Value::Integer(0))?;
            }
            if x == "on" {
                println!("delegate: BẬT — critic chọn thay owner cho câu hỏi sản phẩm/kỹ thuật, ghi su-code/DECISIONS.md.");
                if after > 0 {
                    println!("Chỉ khi owner không gõ gì vào session đó trong {after} giây qua; đang gõ thì câu hỏi vẫn tới owner.");
                }
                println!("Vẫn hỏi owner: Ship, secret/login, xoá/không hoàn tác, tiền, deploy prod, merge/release, high-risk.");
                println!("Cần hook + agent critic: `8sync ccc kit` rồi mở session mới.");
            } else {
                println!("delegate: TẮT — câu hỏi lại tới owner (ask gate vẫn lọc câu không cần hỏi).");
            }
            Ok(())
        }
        Some("status") | None => {
            let after = after_s(home);
            let when = if after > 0 { format!(" — khi owner không gõ {after} giây") } else { String::new() };
            println!("delegate: {}", if enabled(home) { format!("BẬT{when}") } else { "TẮT (mặc định)".to_string() });
            println!("Đổi: `8sync ccc delegate on` · `8sync ccc delegate off`");
            Ok(())
        }
        Some(x) => bail!("usage: 8sync ccc delegate [on [--after <giây|1m>] | off | status] (got `{x}`)"),
    }
}

/// `60`, `60s`, `1m`, `5m` → seconds, 1..=1 day.
pub(super) fn parse_after(s: &str) -> Result<u64> {
    let t = s.trim().to_ascii_lowercase();
    let (num, mul) = match t.strip_suffix('m') {
        Some(n) => (n, 60),
        None => (t.strip_suffix('s').unwrap_or(&t), 1),
    };
    match num.parse::<u64>() {
        Ok(n) if n > 0 && n.checked_mul(mul).is_some_and(|v| v <= AFTER_MAX) => Ok(n * mul),
        _ => bail!("--after: số giây (vd 60) hoặc phút (vd 1m), tối đa 1 ngày (got `{s}`)"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ask(header: &str, q: &str, opts: &[&str]) -> Value {
        json!({ "questions": [{ "header": header, "question": q, "multiSelect": false,
            "options": opts.iter().map(|o| json!({ "label": o, "description": "" })).collect::<Vec<_>>() }] })
    }

    fn oo(v: &Value) -> bool {
        owner_only(v["questions"].as_array().unwrap())
    }

    #[test]
    fn product_and_technical_questions_go_to_the_critic() {
        assert!(!oo(&ask("Layout", "Sidebar hay top nav cho HQ?", &["Sidebar (Recommended)", "Top nav"])));
        assert!(!oo(&ask("Lib", "Dùng vitest hay jest?", &["vitest", "jest"])));
        assert!(CRITIC.contains("subagent_type \"critic\"") && CRITIC.contains("DECISIONS.md") && CRITIC.contains("(Recommended)"));
    }

    #[test]
    fn owner_keeps_ship_secrets_destructive_money_and_high_risk() {
        for (h, q) in [
            ("Ship", "Duyệt merge + release?"),
            ("ship", "ok?"),
            ("Key", "Dán API key Mistral ở đâu?"),
            ("Data", "Xoá bảng users cũ?"),
            ("Deploy", "Deploy production tối nay?"),
            ("Plan", "Mua gói Max?"),
            ("Hiring", "Chọn ứng viên nào (tuyển dụng)?"),
            ("Git", "Force push nhánh?"),
            ("Auth", "Đổi cách đăng nhập?"),
            ("Bot", "Chatbot tư vấn bảo hiểm nên trả lời thế nào?"),
            ("Edu", "Chấm điểm bài nộp của học viên tự động?"),
        ] {
            assert!(oo(&ask(h, q, &["A", "B"])), "{h}: {q}");
        }
        // an option alone can make it owner-only
        assert!(oo(&ask("Next", "Làm gì tiếp?", &["Refactor", "Release v1 ngay"])));
    }

    #[test]
    fn after_threshold_waits_for_the_owner() {
        assert!(owner_away(0, None, 100), "no threshold = always");
        assert!(!owner_away(60, None, 100), "unknown presence = ask the owner");
        assert!(!owner_away(60, Some(50), 100), "typed 50 s ago = present");
        assert!(owner_away(60, Some(40), 100), "60 s without typing = away");
        assert_eq!(parse_after("60").unwrap(), 60);
        assert_eq!(parse_after("1m").unwrap(), 60);
        assert_eq!(parse_after("90s").unwrap(), 90);
        for bad in ["0", "-1", "x", "2000m", "", "18446744073709551615m"] {
            assert!(parse_after(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn after_mode_reads_the_transcript() {
        let home = std::env::temp_dir().join(format!("8sync-dlg-after-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        run(&["on".into(), "--after".into(), "1m".into()], &home).unwrap();
        assert_eq!(after_s(&home), 60);
        let tp = home.join("t.jsonl");
        let line = |ts: &str| json!({ "type": "user", "timestamp": ts, "message": { "role": "user", "content": "làm tiếp" } }).to_string();
        let input = |tp: &Path| json!({ "tool_name": "AskUserQuestion", "transcript_path": tp, "tool_input": ask("UI", "Màu nút?", &["Lime", "Blue"]) }).to_string();
        std::fs::write(&tp, line("2020-01-01T00:00:00Z") + "\n").unwrap();
        if std::env::var(ENV).is_err() {
            assert!(hook(&input(&tp), &home).is_some(), "owner silent for years → critic");
            let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
            let now = super::super::standup::utc_stamp(secs).replace('Z', ":00Z");
            std::fs::write(&tp, line(&now) + "\n").unwrap();
            assert!(hook(&input(&tp), &home).is_none(), "owner just typed → ask the owner");
            assert!(hook(&input(&home.join("missing.jsonl")), &home).is_none(), "unreadable transcript → ask the owner");
        }
        run(&["on".into()], &home).unwrap();
        assert_eq!(after_s(&home), 0, "plain `on` clears the threshold");
        assert!(run(&["off".into(), "--after".into(), "1m".into()], &home).is_err());
        assert!(run(&["on".into(), "--after".into()], &home).is_err(), "missing value");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn hook_is_off_by_default_and_denies_only_ask_user_question() {
        let home = std::env::temp_dir().join(format!("8sync-dlg-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let input = json!({ "tool_name": "AskUserQuestion", "tool_input": ask("UI", "Màu nút?", &["Lime", "Blue"]) }).to_string();
        if std::env::var(ENV).is_err() {
            assert!(hook(&input, &home).is_none(), "off by default");
        }
        crate::verbs::harness::cbm::write_flag_key(&home, KEY, true).unwrap();
        let out: Value = serde_json::from_str(&hook(&input, &home).unwrap()).unwrap();
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "deny");
        assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        assert!(!pending::dir(&home).exists(), "no threshold: the critic answers at once, nothing parked for HQ");
        let bash = json!({ "tool_name": "Bash", "tool_input": { "command": "ls" } }).to_string();
        assert!(hook(&bash, &home).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    fn fresh(tag: &str) -> std::path::PathBuf {
        let h = std::env::temp_dir().join(format!("8sync-dlg-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        std::fs::create_dir_all(&h).unwrap();
        h
    }

    /// A transcript whose last typed prompt is at `ts` (RFC 3339).
    fn transcript(h: &Path, ts: &str) -> std::path::PathBuf {
        let tp = h.join(format!("t-{}.jsonl", ts.replace(':', "")));
        std::fs::write(&tp, json!({ "type": "user", "timestamp": ts, "message": { "role": "user", "content": "làm tiếp" } }).to_string() + "\n").unwrap();
        tp
    }

    fn now_stamp() -> String {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        super::super::standup::utc_stamp(secs).replace('Z', ":00Z")
    }

    #[test]
    fn away_owner_answers_from_hq_else_critic_or_dialog() {
        if std::env::var(ENV).is_ok() {
            return;
        }
        let h = fresh("hq");
        on(&h, 60).unwrap();
        let tp = transcript(&h, "2020-01-01T00:00:00Z");
        let input = |ti: &Value| json!({ "tool_name": "AskUserQuestion", "session_id": "s1", "cwd": h, "transcript_path": tp, "tool_input": ti }).to_string();
        let q = ask("UI", "Màu nút?", &["Lime", "Blue"]);
        let w = pending::answer_when_posted(h.clone(), |_| json!({ "v": 1, "answers": { "Màu nút?": "Blue" }, "note": "giữ tông tối" }));
        let out: Value = serde_json::from_str(&hook_with(&input(&q), &h, 5).unwrap()).unwrap();
        let req = w.join().unwrap();
        assert_eq!((req["kind"].as_str(), req["owner_only"].as_bool(), req["fallback"].as_str(), req["session_id"].as_str()), (Some("question"), Some(false), Some("critic"), Some("s1")));
        assert_eq!(req["questions"], q["questions"]);
        assert!(req["deadline"].as_u64().unwrap() - req["created"].as_u64().unwrap() <= 5_000, "wait capped");
        let o = &out["hookSpecificOutput"];
        assert_eq!((o["hookEventName"].as_str(), o["permissionDecision"].as_str()), (Some("PreToolUse"), Some("allow")));
        assert_eq!(o["updatedInput"]["questions"], q["questions"], "original input echoed");
        assert_eq!(o["updatedInput"]["answers"], json!({ "Màu nút?": "Blue" }));
        assert!(o["additionalContext"].as_str().unwrap().contains("giữ tông tối"));
        // no answer: a normal question goes to the critic …
        let crit: Value = serde_json::from_str(&hook_with(&input(&q), &h, 0).unwrap()).unwrap();
        assert_eq!((crit["hookSpecificOutput"]["permissionDecision"].as_str(), crit["hookSpecificOutput"]["permissionDecisionReason"].as_str()), (Some("deny"), Some(CRITIC)));
        // … an owner-only one is parked too, then left to the dialog (an unusable answer is ignored)
        let w = pending::answer_when_posted(h.clone(), |_| json!({ "v": 1, "answers": { "Deploy production tối nay?": "" } }));
        assert!(hook_with(&input(&ask("Deploy", "Deploy production tối nay?", &["Có", "Không"])), &h, 1).is_none());
        let req = w.join().unwrap();
        assert_eq!((req["owner_only"].as_bool(), req["fallback"].as_str()), (Some(true), Some("dialog")));
        assert_eq!(std::fs::read_dir(pending::dir(&h)).unwrap().count(), 0, "nothing left behind");
        // owner present → nothing parked, the owner sees it
        let tp_now = transcript(&h, &now_stamp());
        let present = json!({ "tool_name": "AskUserQuestion", "transcript_path": tp_now, "tool_input": q }).to_string();
        assert!(hook_with(&present, &h, 5).is_none());
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn permission_is_the_owners_call_or_denied_with_guidance() {
        if std::env::var(ENV).is_ok() {
            return;
        }
        let h = fresh("perm");
        let old = transcript(&h, "2020-01-01T00:00:00Z");
        let input = |tool: &str, tp: &Path| {
            json!({ "hook_event_name": "PermissionRequest", "tool_name": tool, "session_id": "s1", "cwd": h, "transcript_path": tp,
                "tool_input": { "command": "git push origin main" } })
            .to_string()
        };
        assert!(permission_with(&input("Bash", &old), &h, 0).is_none(), "delegate off → the dialog");
        on(&h, 0).unwrap(); // no threshold → 60 s for permissions
        assert!(permission_with(&input("AskUserQuestion", &old), &h, 0).is_none(), "questions are not permissions");
        assert!(permission_with(&input("Bash", &h.join("missing.jsonl")), &h, 0).is_none(), "presence unknown → the dialog");
        assert!(permission_with(&input("Bash", &transcript(&h, &now_stamp())), &h, 0).is_none(), "owner present → the dialog");
        assert!(!pending::dir(&h).exists(), "nothing parked while a gate is closed");
        // no answer → deny with what to do instead
        let out: Value = serde_json::from_str(&permission_with(&input("Bash", &old), &h, 0).unwrap()).unwrap();
        let d = &out["hookSpecificOutput"];
        assert_eq!((d["hookEventName"].as_str(), d["decision"]["behavior"].as_str()), (Some("PermissionRequest"), Some("deny")));
        let msg = d["decision"]["message"].as_str().unwrap();
        assert!(msg.contains("> 60 giây") && msg.contains("đừng chờ") && msg.contains("báo cáo cuối"), "{msg}");
        // the owner allows from HQ
        let w = pending::answer_when_posted(h.clone(), |_| json!({ "v": 1, "allow": true }));
        let out: Value = serde_json::from_str(&permission_with(&input("Bash", &old), &h, 5).unwrap()).unwrap();
        let req = w.join().unwrap();
        assert_eq!(
            (req["kind"].as_str(), req["tool"].as_str(), req["summary"].as_str(), req["fallback"].as_str(), req["owner_only"].as_bool()),
            (Some("permission"), Some("Bash"), Some("git push origin main"), Some("deny"), Some(false))
        );
        assert_eq!(out["hookSpecificOutput"]["decision"], json!({ "behavior": "allow" }));
        // the owner denies from HQ, with a note
        let w = pending::answer_when_posted(h.clone(), |_| json!({ "v": 1, "allow": false, "note": "mở PR thay vì push" }));
        let out: Value = serde_json::from_str(&permission_with(&input("Bash", &old), &h, 5).unwrap()).unwrap();
        w.join().unwrap();
        let d = &out["hookSpecificOutput"]["decision"];
        assert_eq!(d["behavior"], "deny");
        assert!(d["message"].as_str().unwrap().contains("mở PR thay vì push"));
        let _ = std::fs::remove_dir_all(&h);
    }
}
