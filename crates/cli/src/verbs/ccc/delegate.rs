//! "Critic chọn thay owner": `8sync ccc delegate on|off|status` and `8sync ccc hook delegate`
//! (PreToolUse, matcher `AskUserQuestion`, no model call).
//!
//! When the owner turns it on, a product/technical question does not reach the owner: the hook
//! denies the tool call (https://code.claude.com/docs/en/hooks, PreToolUse
//! `permissionDecision: "deny"` + reason, which Claude reads) and tells Claude to have the kit's
//! `critic` agent grade the options (FATAL/MAJOR/MINOR, the reviewer pass of Feynman's deep
//! research) and go with its pick, logging the decision in `su-code/DECISIONS.md`.
//!
//! Rails (8 Sync rules, `assets/configs/claude/CLAUDE.md`): the owner still answers the `Ship` question,
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

/// Flag off (`delegate off`, `ccc cancel --all`); the `--after` value is left as set.
pub(super) fn off(home: &Path) -> Result<()> {
    crate::verbs::harness::features::write_flag_key(home, KEY, false)
}

pub(super) fn enabled(home: &Path) -> bool {
    crate::verbs::harness::features::resolve(std::env::var(ENV).ok().as_deref(), crate::verbs::harness::features::read_flag_key(home, KEY))
}

/// Flag on with `delegate_after_s = after_s` (0 = always). Validate with [`parse_after`] first.
pub(super) fn on(home: &Path, after_s: u64) -> Result<()> {
    if after_s > AFTER_MAX {
        bail!("--after: tối đa 1 ngày");
    }
    crate::verbs::harness::features::write_flag_key(home, KEY, true)?;
    crate::verbs::harness::features::write_key(home, AFTER_KEY, toml::Value::Integer(after_s as i64))
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

pub(super) fn after_s(home: &Path) -> u64 {
    crate::verbs::harness::features::read_int_key(home, AFTER_KEY).map_or(0, |n| (n.max(0) as u64).min(AFTER_MAX))
}

/// Pure: with a threshold, the owner counts as away only when their last typed prompt is known and
/// at least `after` seconds old.
pub(super) fn owner_away(after: u64, last_human: Option<u64>, now: u64) -> bool {
    after == 0 || last_human.is_some_and(|t| now.saturating_sub(t) >= after)
}

/// `8sync ccc hook delegate`: PreToolUse JSON in, a deny decision out (or nothing).
pub(super) fn hook(input: &str, home: &Path) -> Option<String> {
    if !enabled(home) {
        return None;
    }
    let v: Value = serde_json::from_str(input).ok()?;
    if v["tool_name"].as_str() != Some("AskUserQuestion") || !super::auto::in_scope(home, v["cwd"].as_str()) {
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

/// `8sync ccc delegate check --cwd <dir>` with the AskUserQuestion input (`{"questions": …}`) on
/// stdin: may the critic take this question for a room in `dir`? Same rails as [`hook`] (delegate on,
/// auto scope, [`decide`]), minus the owner-typing check: HQ asks this only for a question that has
/// sat on screen past the owner's 60 s. Prints `{"critic": bool}`.
pub(super) fn check(input: &str, cwd: Option<&str>, home: &Path) -> Value {
    let v: Value = serde_json::from_str(input).unwrap_or(Value::Null);
    let reason = (enabled(home) && super::auto::in_scope(home, cwd)).then(|| decide(&v)).flatten();
    json!({ "critic": reason.is_some(), "reason": reason })
}

/// `8sync ccc delegate on | off | status | check`.
pub(super) fn run(rest: &[String], home: &Path) -> Result<()> {
    if rest.first().map(String::as_str) == Some("check") {
        let cwd = match rest.get(1..).unwrap_or_default() {
            [f, d] if f == "--cwd" => Some(d.as_str()),
            [] => None,
            _ => bail!("usage: 8sync ccc delegate check [--cwd <dir>]   (stdin: {{\"questions\": …}})"),
        };
        let mut input = String::new();
        std::io::Read::read_to_string(&mut std::io::Read::take(std::io::stdin(), 256 * 1024), &mut input)?;
        println!("{}", check(&input, cwd, home));
        return Ok(());
    }
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
                crate::verbs::harness::features::write_key(home, AFTER_KEY, toml::Value::Integer(0))?;
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
/// A pending, unanswered question at the end of a Claude Code transcript: the room's turn ended on
/// an `AskUserQuestion` that still waits on a human. The critic ([`hook`]) answers product and
/// technical questions inside the room; what is left (rails: Ship, secrets, money, destructive…
/// and questions from before the kit) sits on screen until someone looks. Only the last
/// [`ASK_TAIL`] bytes are read, newest line first: the first meaningful event must be that
/// tool_use, with no user line (the answer, or a tool_result) after it. `None` = not stuck.
pub(super) fn pending_ask(path: &Path) -> Option<String> {
    /// How much of the tail is scanned: a question is the room's last word, a few lines back.
    const ASK_TAIL: u64 = 64 * 1024;
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(ASK_TAIL))).ok()?;
    let mut buf = String::new();
    f.take(ASK_TAIL).read_to_string(&mut buf).ok()?;
    for line in buf.lines().rev() {
        if line.contains(r#""isSidechain":true"#)
            || line.starts_with(r#"{"type":"summary""#)
            || line.starts_with(r#"{"type":"custom-title""#)
            || line.starts_with(r#"{"type":"agent-name""#)
        {
            continue;
        }
        if line.contains(r#""type":"user""#) {
            return None; // answered (a tool_result or the owner's reply comes as a user line)
        }
        if line.contains(r#""type":"assistant""#) && line.contains(r#""name":"AskUserQuestion""#) {
            let v: Value = serde_json::from_str(line).ok()?;
            let q = v["message"]["content"].as_array()?
                .iter()
                .find(|b| b["type"] == "tool_use" && b["name"] == "AskUserQuestion")?;
            let one = q["input"]["questions"][0].as_object()?;
            let head = one.get("header").and_then(Value::as_str).unwrap_or("hỏi");
            let text = one.get("question").and_then(Value::as_str).unwrap_or_default();
            let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
            return Some(format!("{head}: {}", ccc_core::secret_mask::mask(&ccc_core::transcript::truncate(first, 90))));
        }
        if line.contains(r#""type":"assistant""#) {
            return None; // the room went on talking after its question
        }
    }
    None
}

/// Revive's stuck-question relay (owner 2026-10-22: "khi ccc đang code bị dính hỏi, auto phải gọi
/// agent lead trả lời ngay làm tiếp"): every lane room whose turn ended on an unanswered
/// [`AskUserQuestion`] ([`pending_ask`]) is handed to the lead — it answers the room over HQ
/// (`8sync ccc msg`, per DECISIONS.md) or, for owner-only rails, asks the owner ONE AskUserQuestion
/// — and the lead is woken now. At most once every [`RELAY_S`] per room, so a slow owner is not
/// spammed. Returns the line for the revive report, None when there is nothing to do.
pub(super) fn relay_stuck(home: &Path, root: &Path, registry: &[(String, String)], stuck: &[(String, String)], now: u64) -> Option<String> {
    /// One relay per room this often (the lead gets every due room in one message).
    const RELAY_S: u64 = 600;
    let leads: Vec<(String, String)> = registry.iter().filter(|(n, _)| super::room::crew(n) == "lead").cloned().collect();
    if leads.is_empty() {
        return None;
    }
    let k = |room: &str| format!("{}|{room}", super::auto::canon(root).to_string_lossy());
    let mut due: Vec<&(String, String)> = Vec::new();
    let mut lead_q: Vec<&(String, String)> = Vec::new();
    super::team::update_json(&super::idle::state_dir(home).join("relay.json"), |v| {
        for pair in stuck {
            let key = k(&pair.0);
            if v[&key].as_u64().is_none_or(|at| now.saturating_sub(at) >= RELAY_S) {
                v[&key] = json!(now);
                // The lead's own pending question is owner-only rails (Ship/secret/money: no agent
                // may answer it) or a question nobody relayed: straight to the owner's HQ banner.
                if super::room::crew(&pair.0) == "lead" {
                    lead_q.push(pair);
                } else {
                    due.push(pair);
                }
            }
        }
    });
    let mut lines: Vec<String> = Vec::new();
    if !lead_q.is_empty() {
        let name = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let qs = lead_q.iter().map(|(_, q)| q.clone()).collect::<Vec<_>>().join(" · ");
        let _ = crate::verbs::hq::alert_owner(&format!("Phòng lead {name} dừng chờ trả lời"), &format!("{qs} — trả lời trên HQ để team chạy tiếp (critic không được trả lời câu rails thay anh)."));
        lines.push(format!("stuck-ask (lead): {}", lead_q.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>().join(", ")));
    }
    if due.is_empty() {
        return if lines.is_empty() { None } else { Some(lines.join("; ")) };
    }
    let list = due.iter().map(|(n, q)| format!("{n} hỏi \"{q}\"")).collect::<Vec<_>>().join(" · ");
    let text = format!(
        "[❓ phòng dừng chờ trả lời] {list}. Trả lời NGAY lượt này, từng phòng một qua `8sync ccc msg <phòng> \"<đáp>\"`: câu sản phẩm/kỹ thuật tự quyết theo su-code/DECISIONS.md (không cần owner); câu Ship/secret/tiền/xoá/high-risk gom MỘT câu AskUserQuestion hỏi owner. Phòng đang chờ đang chặn cột của nó."
    );
    let sent: Vec<String> = leads.iter().filter(|(_, id)| crate::verbs::hq::queue_inbox(home, id, &text, now * 1000).is_ok()).map(|(n, _)| n.clone()).collect();
    if sent.is_empty() {
        return None;
    }
    super::team::ask_wake(home, root, &sent, now);
    lines.push(format!("stuck-ask: {} → {}", due.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>().join(", "), sent.join(", ")));
    Some(lines.join("; "))
}

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
        crate::verbs::harness::features::write_flag_key(&home, KEY, true).unwrap();
        let out: Value = serde_json::from_str(&hook(&input, &home).unwrap()).unwrap();
        assert_eq!(out["hookSpecificOutput"]["permissionDecision"], "deny");
        assert_eq!(out["hookSpecificOutput"]["hookEventName"], "PreToolUse");
        let bash = json!({ "tool_name": "Bash", "tool_input": { "command": "ls" } }).to_string();
        assert!(hook(&bash, &home).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn check_hands_a_stuck_product_question_to_the_critic_and_keeps_ship_with_the_owner() {
        // Seen live 2026-10-18: questions asked while auto was paused stayed on screen for an hour.
        let home = std::env::temp_dir().join(format!("8sync-dlg-check-{}", std::process::id()));
        std::fs::create_dir_all(&home).unwrap();
        let q = ask("Tiến hoá", "Sửa lỗi gà ra voi theo hướng nào?", &["Dòng tiến hoá (Recommended)", "Bỏ tiến hoá"]).to_string();
        if std::env::var(ENV).is_err() {
            assert_eq!(check(&q, None, &home)["critic"], false, "delegate off: the owner answers");
        }
        crate::verbs::harness::features::write_flag_key(&home, KEY, true).unwrap();
        assert_eq!(check(&q, None, &home)["critic"], true);
        let ship = ask("Ship", "Merge PR 20?", &["Duyệt tất cả (Recommended)", "Dừng"]).to_string();
        assert_eq!(check(&ship, None, &home)["critic"], false, "Ship stays with the owner");
        let secret = ask("Key", "Dùng api key nào?", &["A", "B"]).to_string();
        assert_eq!(check(&secret, None, &home)["critic"], false);
        assert_eq!(check("not json", None, &home)["critic"], false);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A Claude Code transcript fixture: `lines` are raw jsonl entries.
    fn transcript(name: &str, lines: &[String]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("8sync-dlg-ask-{}-{name}", std::process::id()));
        std::fs::write(&p, lines.iter().map(|l| format!("{l}\n")).collect::<String>()).unwrap();
        p
    }

    fn ask_line(q: &str) -> String {
        json!({ "type": "assistant", "message": { "content": [
            { "type": "tool_use", "name": "AskUserQuestion", "input": { "questions": [
                { "header": "API", "question": q, "options": [{ "label": "A", "description": "" }] }
            ] } }
        ] } }).to_string()
    }

    #[test]
    fn pending_ask_spots_an_unanswered_question_and_its_answer() {
        let user = json!({ "type": "user", "message": { "content": [{ "type": "text", "text": "làm tiếp" }] } }).to_string();
        let talk = json!({ "type": "assistant", "message": { "content": [{ "type": "text", "text": "đã xong phần đó" }] } }).to_string();
        // Last event = the question, nobody replied → stuck, with the header and one masked line.
        let p = transcript("stuck", &[talk.clone(), ask_line("Đổi tên endpoint thành gì\n(chọn một)?")]);
        let q = pending_ask(&p).expect("stuck on the question");
        assert!(q.starts_with("API: ") && q.contains("endpoint"), "{q}");
        // The owner answered (a user line after it) → not stuck.
        let p = transcript("answered", &[talk.clone(), ask_line("Đổi tên endpoint?"), user]);
        assert!(pending_ask(&p).is_none());
        // The room went on after its question (another assistant line) → not stuck.
        let p = transcript("wenton", &[ask_line("Đổi tên endpoint?"), talk]);
        assert!(pending_ask(&p).is_none());
        for p in ["stuck", "answered", "wenton"] {
            let _ = std::fs::remove_file(transcript(p, &[]));
        }
    }

    /// A stuck room is handed to the lead once per 10 min (owner 2026-10-22: "auto phải gọi agent
    /// lead trả lời ngay làm tiếp"), the lead is woken, and its inbox names the room.
    #[test]
    fn relay_stuck_hands_pending_questions_to_the_lead_debounced() {
        let home = std::env::temp_dir().join(format!("8sync-dlg-relay-{}", std::process::id()));
        let root = home.join("r");
        std::fs::create_dir_all(&root).unwrap();
        let lead = ("lead".to_string(), "22222222-2222-4222-8222-222222222222".to_string());
        let reg = vec![lead.clone(), ("dev1".to_string(), "33333333-3333-4333-8333-333333333333".to_string())];
        let stuck = vec![("dev1".to_string(), "API: đổi endpoint?".to_string())];
        let line = relay_stuck(&home, &root, &reg, &stuck, 100).expect("relayed");
        assert!(line.contains("dev1") && line.contains("lead"), "{line}");
        let inbox = crate::verbs::hq::inbox_file(&home, &lead.1).unwrap();
        let text = std::fs::read_to_string(&inbox).unwrap();
        assert!(text.contains("dev1 hỏi") && text.contains("8sync ccc msg"), "{text}");
        assert!(relay_stuck(&home, &root, &reg, &stuck, 200).is_none(), "debounced");
        let second = vec![("qa1".to_string(), "Ship: merge PR 9?".to_string())];
        assert!(relay_stuck(&home, &root, &reg, &second, 300).unwrap().contains("qa1"), "another room is due at once");
        assert!(relay_stuck(&home, &root, &reg, &stuck, 100 + 601).is_some(), "ten minutes later it asks again");
        let no_lead = vec![];
        assert!(relay_stuck(&home, &root, &no_lead, &stuck, 5000).is_none(), "no lead: nothing to do");
        // A stuck LEAD never mails itself: the owner is alerted (rails no agent may answer).
        let lead_stuck = vec![("lead".to_string(), "Ship: merge PR 12?".to_string())];
        let line = relay_stuck(&home, &root, &reg, &lead_stuck, 6000).expect("lead relayed");
        assert!(line.contains("stuck-ask (lead): lead"), "{line}");
        let lead_inbox = crate::verbs::hq::inbox_file(&home, &lead.1).unwrap();
        let before = std::fs::read_to_string(&lead_inbox).unwrap().lines().count();
        relay_stuck(&home, &root, &reg, &lead_stuck, 6100);
        assert_eq!(std::fs::read_to_string(&lead_inbox).unwrap().lines().count(), before, "the lead is not mailed its own question");
        let _ = std::fs::remove_dir_all(&home);
    }
}
