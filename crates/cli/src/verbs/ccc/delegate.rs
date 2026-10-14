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
use std::path::Path;

use anyhow::{bail, Result};
use serde_json::{json, Value};

pub(super) const KEY: &str = "delegate";
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

/// `8sync ccc hook delegate`: PreToolUse JSON in, a deny decision out (or nothing).
pub(super) fn hook(input: &str, home: &Path) -> Option<String> {
    if !enabled(home) {
        return None;
    }
    let v: Value = serde_json::from_str(input).ok()?;
    if v["tool_name"].as_str() != Some("AskUserQuestion") {
        return None;
    }
    let reason = decide(&v["tool_input"])?;
    Some(json!({ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason } }).to_string())
}

/// `8sync ccc delegate on | off | status`.
pub(super) fn run(rest: &[String], home: &Path) -> Result<()> {
    match rest.first().map(String::as_str) {
        Some(x @ ("on" | "off")) => {
            crate::verbs::harness::cbm::write_flag_key(home, KEY, x == "on")?;
            if x == "on" {
                println!("delegate: BẬT — critic chọn thay owner cho câu hỏi sản phẩm/kỹ thuật, ghi su-code/DECISIONS.md.");
                println!("Vẫn hỏi owner: Ship, secret/login, xoá/không hoàn tác, tiền, deploy prod, merge/release, high-risk.");
                println!("Cần hook + agent critic: `8sync ccc kit` rồi mở session mới.");
            } else {
                println!("delegate: TẮT — câu hỏi lại tới owner (ask gate vẫn lọc câu không cần hỏi).");
            }
            Ok(())
        }
        Some("status") | None => {
            println!("delegate: {}", if enabled(home) { "BẬT" } else { "TẮT (mặc định)" });
            println!("Đổi: `8sync ccc delegate on` · `8sync ccc delegate off`");
            Ok(())
        }
        Some(x) => bail!("usage: 8sync ccc delegate [on | off | status] (got `{x}`)"),
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
