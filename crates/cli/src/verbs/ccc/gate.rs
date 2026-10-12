//! The kit's Stop gate, native: keeps Claude from ending a turn on a plan it
//! has not carried out or on a routine "shall I go ahead?" question.
//!
//! It used to be a `type: prompt` hook on Haiku. That re-sent the whole
//! transcript on every turn end (~30k Haiku tokens and ~2.6 s per turn end, ~48k per bench
//! run) and most of its real blocks were turns waiting on a background agent,
//! which Claude Code wakes by itself when the agent finishes. This version
//! reads only the hook input (and the last user message), in microseconds:
//! - the last line announces more work ("Next I'll…", "I'll fix that now.",
//!   "Tiếp theo tôi sẽ…") → block;
//! - the last line asks permission to carry on with routine work ("Shall I
//!   proceed?", "Bạn có muốn tôi sửa luôn không?") → block.
//!
//! Structure comes first: a second stop in a row, a running background task or
//! a user who just said "stop"/"dừng" always ends the turn. A plan does not
//! block when the last paragraph is about a secret or a destructive,
//! outward-facing or paid action; a question does not block when it is about
//! those, access, or a choice between options: forcing Claude on would make it
//! act where the owner must decide. Any doubt lets the turn end.
//!
//! Optional extras ("Want me to also…?") and plain answers end the turn.
use serde_json::Value;
use std::io::{Read, Seek, SeekFrom};

/// The block reason for a Stop hook input, or `None` to let the turn end.
pub(super) fn check(v: &Value) -> Option<String> {
    if v["stop_hook_active"].as_bool() == Some(true) {
        return None;
    }
    let running = v["background_tasks"].as_array().is_some_and(|t| t.iter().any(|t| !matches!(t["status"].as_str(), Some("completed" | "failed" | "killed" | "stopped"))));
    if running {
        return None;
    }
    // No hook field says the user asked to stop (Stop does not fire on an interrupt);
    // their last message in the transcript does.
    if v["transcript_path"].as_str().and_then(last_user_text).is_some_and(|t| asks_to_stop(&t)) {
        return None;
    }
    let msg = v["last_assistant_message"].as_str()?;
    let line = msg.trim_end().lines().rev().map(str::trim).find(|l| !l.is_empty() && !l.starts_with("```"))?;
    let low = line.to_lowercase();
    let quote: String = line.chars().take(160).collect();
    let para = msg.trim_end().rsplit("\n\n").map(str::trim).find(|p| !p.is_empty() && !p.starts_with("```")).unwrap_or(line).to_lowercase();
    if user_stop_quoted(&para) {
        return None;
    }

    const PLAN: [&str; 22] = [
        "next, i'll", "next i'll", "next i will", "next, i will", "i'll now", "i will now", "now i'll", "now i will",
        "i'm going to", "i am going to", "let me now", "i'll proceed", "i'll go ahead", "i'll continue",
        "doing that now", "doing it now", "tiếp theo tôi sẽ", "tiếp theo mình sẽ", "tiếp theo em sẽ", "bây giờ tôi sẽ",
        "tôi sẽ tiếp tục", "mình sẽ tiếp tục",
    ];
    // Hand-offs: the next step waits on the user or on something else.
    const OFFER: [&str; 30] = [
        "if you", "once you", "when you", "after you", "let me know", "once the", "once it", "for now", "need your",
        "i'll need the", "i'll need your", "i will need the", "i will need your", "going to need", "summarise:", "summarize:",
        "summarise for you", "summarize for you", "nếu bạn", "nếu anh", "nếu chị", "nếu cần", "khi bạn", "sau khi bạn", "khi anh",
        "chờ bạn", "đợi bạn", "sẽ chờ", "sẽ đợi", "sẽ dừng",
    ];
    // "I'll fix that now." / "Let me run the tests next." (OMP's unexpected-stop examples).
    let bare = low.trim_end_matches(|c: char| c.is_ascii_punctuation() || c.is_whitespace());
    let timed = ["i'll ", "i will ", "let me "].iter().any(|p| low.starts_with(p)) && (bare.ends_with(" now") || bare.ends_with(" next"));
    let offer = OFFER.iter().any(|p| low.contains(p)) || hands_off(&low);
    let risky = RISKY.iter().any(|p| mentions(&para, p));
    if !offer && !risky && !low.ends_with('?') && (timed || PLAN.iter().any(|p| low.contains(p))) {
        return Some(format!(
            "8sync gate: your last message announces more work (\"{quote}\"). Do it now instead of stopping; end the turn when it is done or blocked on something only the user can provide."
        ));
    }

    const ASK: [&str; 16] = [
        "would you like me to", "do you want me to", "want me to", "should i ", "shall i ", "can i ", "may i ", "ok to ",
        "okay to ", "bạn có muốn", "anh có muốn", "chị có muốn", "có muốn tôi", "có cần tôi", "tôi có nên", "mình có nên",
    ];
    const PROCEED: [&str; 23] = [
        "proceed", "continue", "go ahead", "start", "begin", "implement", "fix", "apply", "make the change", "make these",
        "do it", "do that", "do this", "run it", "run the", "tiếp tục", "làm tiếp", "bắt đầu", "sửa", "áp dụng", "thực hiện",
        "làm luôn", "làm việc đó",
    ];
    let question = low.ends_with('?') || low.ends_with("không") || low.ends_with("chứ");
    let extra = [" also ", " additionally", " thêm "].iter().any(|p| low.contains(p));
    let justified = JUSTIFIED.iter().any(|p| mentions(&para, p));
    if question && !extra && !justified && ASK.iter().any(|p| low.contains(p)) && PROCEED.iter().any(|p| mentions(&low, p)) {
        return Some(format!(
            "8sync gate: don't stop to ask for routine confirmation (\"{quote}\"). Pick the conservative, conventional option, state the assumption and continue. Ask only for secrets/access, destructive or paid actions, or product decisions."
        ));
    }
    None
}

/// Questions the owner must answer: secrets/access, destructive or paid actions, product
/// direction, or a choice between options. Vietnamese entries are phrases: `giá` alone is in
/// `đánh giá` (review), `khóa` in `khóa học` (course).
const JUSTIFIED: [&str; 58] = [
    "secret", "password", "api key", "token", "credential", "login", "log in", "sign in", "access", "account",
    "production", "prod ", "deploy", "release", "publish", "push", "merge", "force", "delete", "remove", "drop",
    "wipe", "migrat", "irreversible", "pay", "price", "billing", "cost", "budget", "customer", "email", "send",
    "reset", "database", "truncate", "overwrite", "rollback", "roll back", "restart",
    " or ", "which", "mật khẩu", "khóa api", "khoá api", "khóa bí mật", "khoá bí mật", "đăng nhập", "xóa", "xoá",
    "triển khai", "giá gói", "giá tiền", "báo giá", "chi phí", " hay ", "hoặc", "cơ sở dữ liệu", "khởi động lại",
];

/// Announced work Claude must not be pushed into: secrets, destructive, outward-facing or paid
/// actions. Narrower than [`JUSTIFIED`]: "Next I'll remove the dead code" or "…clippy or fmt"
/// is routine work and keeps the turn going.
const RISKY: [&str; 36] = [
    "secret", "password", "api key", "credential", "production", "prod ", "deploy", "release", "publish", "push",
    "force", "delete", "drop", "wipe", "migrat", "irreversible", "pay", "billing", "customer", "email", "send",
    "reset", "database", "truncate", "overwrite", "rollback", "roll back", "restart", "mật khẩu", "triển khai",
    "cơ sở dữ liệu", "khởi động lại", "khóa api", "khoá api", "xóa dữ liệu", "xoá dữ liệu",
];

/// "I'm going to stop here.", "Now I'll hand this over to you.", "I'll now wait for the tests.":
/// the announced step is to stop or hand over, not more work.
fn hands_off(low: &str) -> bool {
    const WHO: [&str; 6] = ["i'll ", "i will ", "i'm going to ", "i am going to ", "now i'll ", "next i'll "];
    const VERB: [&str; 8] = ["stop", "wait", "pause", "hold", "leave", "hand", "call it", "let you"];
    WHO.iter().any(|w| {
        low.match_indices(w).any(|(i, _)| {
            let rest = &low[i + w.len()..];
            let rest = rest.strip_prefix("now ").unwrap_or(rest);
            VERB.iter().any(|v| rest.starts_with(v))
        })
    })
}

/// The user's own message is a stop/wait: the word alone or followed by punctuation ("stop",
/// "Wait, don't…", "dừng lại", "khoan đã"). "Stop mocking the DB and write tests" is an
/// instruction, not a stop.
fn asks_to_stop(text: &str) -> bool {
    let low = text.trim().to_lowercase();
    const WORDS: [&str; 12] = ["stop", "wait", "hold on", "hold off", "pause", "tạm dừng", "dừng", "khoan", "chờ", "đợi", "ngừng", "thôi"];
    const TAIL: [&str; 4] = [" lại", " đã", " đi", " here"];
    WORDS.iter().any(|w| {
        low.strip_prefix(w).is_some_and(|rest| {
            let rest = TAIL.iter().find_map(|t| rest.strip_prefix(t)).unwrap_or(rest);
            rest.chars().next().is_none_or(|c| !c.is_alphanumeric() && c != ' ')
        })
    })
}

/// The text of the last message the user typed, from the tail of the session transcript (JSONL).
/// Tool results, task notifications and skill bodies are `user` entries too; only
/// `origin.kind == "human"` (or entries without an `origin`, older Claude Code) count.
fn last_user_text(path: &str) -> Option<String> {
    const TAIL: u64 = 512 * 1024;
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(TAIL))).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf);
    for line in text.lines().rev() {
        let Ok(e) = serde_json::from_str::<Value>(line) else { continue };
        if e["type"] != "user" || e["isMeta"] == true {
            continue;
        }
        if e["origin"].is_object() && e["origin"]["kind"] != "human" {
            continue;
        }
        let c = &e["message"]["content"];
        let t = match c {
            Value::String(s) => s.clone(),
            Value::Array(parts) => {
                if parts.iter().any(|p| p["type"] == "tool_result") {
                    continue;
                }
                parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n")
            }
            _ => continue,
        };
        return Some(t);
    }
    None
}

/// `para` attributes stop/wait words to the user and quotes them (`you said "stop"`, `bạn bảo
/// “dừng”`), as Claude does when it holds for the next instruction. Claude merely saying it will
/// pause, or a backticked identifier (`` `stop` ``), does not count.
fn user_stop_quoted(para: &str) -> bool {
    const CUES: [&str; 11] = [
        "you said", "you asked", "you told", "as you", "bạn bảo", "bạn nói", "bạn yêu cầu", "anh bảo", "anh nói", "chị bảo", "chị nói",
    ];
    const WORDS: [&str; 9] = ["stop", "wait", "pause", "hold", "dừng", "tạm dừng", "chờ", "đợi", "dừng lại"];
    const QUOTES: [(char, char); 3] = [('"', '"'), ('“', '”'), ('\'', '\'')];
    CUES.iter().any(|c| para.contains(c)) && QUOTES.iter().any(|(o, c)| WORDS.iter().any(|w| para.contains(&format!("{o}{w}{c}"))))
}

/// `text` mentions `entry`: a phrase or non-ASCII entry as a substring, an English word in any
/// common inflection (`delete` → `deleting`, `deletion`) but not inside another word
/// (`token` ≠ `tokenizer`, `pay` ≠ `payload`, `fix` ≠ `prefix`).
fn mentions(text: &str, entry: &str) -> bool {
    if entry.contains(' ') || !entry.is_ascii() {
        return text.contains(entry);
    }
    const SUFFIX: [&str; 18] = ["", "s", "es", "d", "ed", "e", "ing", "er", "ers", "ment", "ments", "ion", "ions", "al", "ping", "ped", "ting", "ten"];
    let stems = [entry, entry.strip_suffix('e').unwrap_or(entry)];
    text.split(|c: char| !c.is_alphanumeric()).any(|w| stems.iter().any(|s| w.strip_prefix(s).is_some_and(|rest| SUFFIX.contains(&rest))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn blocks(msg: &str) -> bool {
        check(&json!({ "last_assistant_message": msg, "stop_hook_active": false, "background_tasks": [] })).is_some()
    }

    #[test]
    fn unfinished_plans_and_routine_go_ahead_questions_block() {
        for msg in [
            "Parser fixed.\nNext I'll add unit tests for the tokenizer.",
            "Đã sửa lexer. Tiếp theo tôi sẽ viết test cho parser.",
            "The plan is ready. Shall I proceed with the implementation?",
            "Tôi đã tìm ra nguyên nhân. Bạn có muốn tôi sửa luôn không?",
            "Found the bug in `eval.rs`. Do you want me to fix it?",
            "I'll pause here for a moment.\nNext I'll add the parser tests.",
            // OMP's judge examples of an unexpected stop.
            "I should do the same for the JS eval worker. Doing that now.",
            "Let me run the tests next.",
            "I'll fix that now.",
            "Should I do that for you?",
            // Reviewer findings: routine plans that used to end the turn.
            "Next I'll fix the `stop` handler.",
            "Next I'll rename the 'wait' helper.",
            "Next I'll remove the dead code.",
            "Next I'll update the README or CHANGELOG.",
            "Next I'll run clippy or fmt.",
            "Bạn có muốn tôi sửa phần đánh giá không?",
            "Bạn có muốn tôi sửa nội dung khóa học không?",
            // Round-3 review: plans the hand-off list must not swallow.
            "Next, I'll need to rewrite the parser.",
            "Next I'll need to update the callers.",
            "Next I'll add the tests until coverage reaches 80%.",
            "Next I'll summarize the changes in the CHANGELOG.",
        ] {
            assert!(blocks(msg), "{msg}");
        }
    }

    #[test]
    fn answers_summaries_extras_and_justified_questions_end_the_turn() {
        for msg in [
            "Done. All 12 tests pass.",
            "I've completed the task.",
            "Is there anything else I can help with?",
            "The fix is done and tests pass.",
            "Q1: 15\nQ2: SUSYNC_NO_AUTO_UPDATE",
            "Implemented. Want me to also add a CHANGELOG entry?",
            "Let me know if you'd like me to tweak the wording.",
            "If you want, I'll add benchmarks next.",
            "Tests pass. Should I push to production?",
            "I need the Stripe API key to continue — can you set STRIPE_KEY?",
            "Should I implement pagination with cursors or offsets?",
            "Bạn muốn giá gói Pro là bao nhiêu?",
            "Next steps for you: run `8sync up`.",
            "```\ncargo test\n```",
            "This drops the orders table in the production DB and cannot be undone.\nShall I proceed?",
            "Once you approve, I'll proceed with dropping the legacy tables.",
            "Shall I proceed with resetting the staging database?",
            "Migration written.\n\nNext I'll drop the old columns.",
            "Once you approve, I'll proceed with the refactor.",
            "Next I'll push the branch to origin.",
            // Round-2 review: hand-offs, not unfinished work.
            "Let me know what to do next.",
            "I'll wait for your review for now.",
            "I'll stop here for now.",
            "I'll leave the rest for now.",
            "I'm going to need your help here.",
            "Next, I'll need the staging URL.",
            "I'll continue once the build finishes.",
            "I will now summarise: 3 files changed.",
            "Tôi sẽ tiếp tục khi bạn gửi file log.",
            // Round-3 review: the same hand-offs in other word orders.
            "I'm going to stop here.",
            "I'm going to wait for your reply.",
            "I am going to pause here and let you review.",
            "Now I'll hand this over to you.",
            "Next I'll let you take it from here.",
            "I'll now wait for the background tests to finish.",
            "Tiếp theo tôi sẽ chờ phản hồi của bạn.",
            "All done. I'm going to call it here.",
            "Should I add a prefix to the log lines?",
            "You said \"stop\", so I'm holding here. Next I'll add the parser tests.",
            "Bạn bảo “dừng” nên tôi dừng ở đây. Tiếp theo tôi sẽ viết test cho parser.",
        ] {
            assert!(!blocks(msg), "{msg}");
        }
    }

    #[test]
    fn running_background_work_or_a_second_stop_never_blocks() {
        let plan = "Next I'll wire the reviewer verdict in.";
        let bg = json!({ "last_assistant_message": plan, "background_tasks": [{ "id": "a1", "type": "shell", "status": "running" }] });
        assert!(check(&bg).is_none(), "Claude Code wakes the session when the task finishes");
        let done = json!({ "last_assistant_message": plan, "background_tasks": [{ "id": "a1", "status": "completed" }] });
        assert!(check(&done).is_some());
        let again = json!({ "last_assistant_message": plan, "stop_hook_active": true });
        assert!(check(&again).is_none());
    }

    #[test]
    fn the_users_last_message_saying_stop_ends_the_turn() {
        let dir = std::env::temp_dir().join(format!("8sync-gate-{}", crate::verbs::uuid_sessions::new_uuid()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let plan = "Next I'll add the parser tests.";
        let write = |said: &str| {
            let rows = [
                json!({ "type": "user", "origin": { "kind": "human" }, "message": { "role": "user", "content": said } }),
                json!({ "type": "assistant", "message": { "role": "assistant", "content": [{ "type": "text", "text": "ok" }] } }),
                json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": "t1", "content": "stop" }] } }),
                json!({ "type": "user", "origin": { "kind": "task-notification" }, "message": { "role": "user", "content": "wait" } }),
                json!({ "type": "user", "isMeta": true, "message": { "role": "user", "content": [{ "type": "text", "text": "stop" }] } }),
            ];
            std::fs::write(&path, rows.iter().map(|r| format!("{r}\n")).collect::<String>()).unwrap();
            check(&json!({ "last_assistant_message": plan, "transcript_path": path.to_str().unwrap() }))
        };
        for said in ["stop", "Wait, don't touch the tests.", "dừng lại", "Khoan đã", "hold on", "Stop!", "dừng đi", "wait here"] {
            assert!(write(said).is_none(), "{said}");
        }
        for said in ["fix the parser", "make the stop handler faster", "add a wait timeout", "Stop mocking the DB and write real tests", "Wait for the build, then fix X"] {
            assert!(write(said).is_some(), "{said}");
        }
        let missing = json!({ "last_assistant_message": plan, "transcript_path": dir.join("none.jsonl").to_str().unwrap() });
        assert!(check(&missing).is_some(), "an unreadable transcript changes nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
