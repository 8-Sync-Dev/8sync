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
//! `on --after <s>` ("owner treo"): the critic only steps in when no prompt typed by a human reached
//! this session in the last `s` seconds (`delegate_after_s`; 0 = always). A hook cannot answer a
//! question that is already on screen, so "the owner has not replied for 1 minute" is approximated
//! by "the owner has not typed here for 1 minute"; when the transcript cannot be read the owner is
//! asked. Limitation: answering an earlier question in a dialog is not counted as typing, so an owner
//! who only clicks answers looks away after `s` seconds (help text says so).
use std::path::Path;

use anyhow::{bail, Result};
use serde_json::{json, Value};

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

pub(super) fn enabled(home: &Path) -> bool {
    crate::verbs::harness::cbm::resolve(std::env::var(ENV).ok().as_deref(), crate::verbs::harness::cbm::read_flag_key(home, KEY))
}

/// Pure: the reason to hand the question back to Claude, or `None` = let the owner see it.
pub(super) fn decide(tool_input: &Value) -> Option<String> {
    let qs = tool_input["questions"].as_array()?;
    if qs.is_empty() {
        return None;
    }
    let mut text = String::new();
    for q in qs {
        if q["header"].as_str().is_some_and(|h| h.trim().eq_ignore_ascii_case("ship")) {
            return None;
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
    if OWNER_ONLY.iter().any(|w| low.contains(w)) {
        return None;
    }
    Some(
        "8sync delegate: owner đã uỷ quyền cho critic, KHÔNG hỏi owner câu này. Làm ngay: (1) gọi Agent subagent_type \"critic\" với \
         nguyên văn các câu hỏi + options + ngữ cảnh (file, số đo); critic chấm từng option FATAL/MAJOR/MINOR và chọn một; \
         (2) đi theo lựa chọn của critic (critic không chạy được → chọn option có \"(Recommended)\", không có → option an toàn, phổ biến nhất); \
         (3) thêm một dòng vào su-code/DECISIONS.md: `- <yyyy-mm-dd> <câu hỏi> → <lựa chọn> (critic: <lý do một dòng>)`; \
         (4) làm tiếp và nêu quyết định trong báo cáo cuối. Secret, xoá/không hoàn tác, tiền, deploy prod, merge/release, câu `Ship` và \
         quyết định high-risk vẫn hỏi owner."
            .to_string(),
    )
}

fn after_s(home: &Path) -> u64 {
    crate::verbs::harness::cbm::read_int_key(home, AFTER_KEY).map_or(0, |n| (n.max(0) as u64).min(AFTER_MAX))
}

/// Pure: with a threshold, the owner counts as away only when their last typed prompt is known and
/// at least `after` seconds old.
fn owner_away(after: u64, last_human: Option<u64>, now: u64) -> bool {
    after == 0 || last_human.is_some_and(|t| now.saturating_sub(t) >= after)
}

/// `8sync ccc hook delegate`: PreToolUse JSON in, a deny decision out (or nothing).
pub(super) fn hook(input: &str, home: &Path) -> Option<String> {
    if !enabled(home) {
        return None;
    }
    let v: Value = serde_json::from_str(input).ok()?;
    if v["tool_name"].as_str() != Some("AskUserQuestion") {
        return None;
    }
    let after = after_s(home);
    if after > 0 {
        let last = v["transcript_path"].as_str().and_then(|p| super::idle::last_human_ts(Path::new(p)));
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        if !owner_away(after, last, now) {
            return None;
        }
    }
    let reason = decide(&v["tool_input"])?;
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason } }).to_string())
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
            crate::verbs::harness::cbm::write_flag_key(home, KEY, x == "on")?;
            crate::verbs::harness::cbm::write_key(home, AFTER_KEY, toml::Value::Integer(after as i64))?;
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
fn parse_after(s: &str) -> Result<u64> {
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

    #[test]
    fn product_and_technical_questions_go_to_the_critic() {
        let r = decide(&ask("Layout", "Sidebar hay top nav cho HQ?", &["Sidebar (Recommended)", "Top nav"])).unwrap();
        assert!(r.contains("subagent_type \"critic\"") && r.contains("DECISIONS.md") && r.contains("(Recommended)"));
        assert!(decide(&ask("Lib", "Dùng vitest hay jest?", &["vitest", "jest"])).is_some());
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
            assert!(decide(&ask(h, q, &["A", "B"])).is_none(), "{h}: {q}");
        }
        // an option alone can make it owner-only
        assert!(decide(&ask("Next", "Làm gì tiếp?", &["Refactor", "Release v1 ngay"])).is_none());
        assert!(decide(&json!({})).is_none() && decide(&json!({ "questions": [] })).is_none());
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
        let bash = json!({ "tool_name": "Bash", "tool_input": { "command": "ls" } }).to_string();
        assert!(hook(&bash, &home).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }
}
