//! "Thức dậy có đáng không": `8sync ccc hook wake` (UserPromptSubmit, no model call) decides whether a
//! scheduled prompt runs, before it costs a single token.
//!
//! HQ's scheduled tasks ("Giao việc" with "Khi nào", the "R&D trực" preset) put [`MARK`] in the prompt
//! the session books with `CronCreate`. UserPromptSubmit hooks also fire when a scheduled task or a
//! `/loop` iteration fires, and `decision: "block"` "stops the prompt before it reaches Claude"
//! (https://code.claude.com/docs/en/hooks, checked 2026-10-15). Idea after ProactiveAgent's
//! decision engine + `min_response_interval` (github.com/leomariga/ProactiveAgent, BSD-3):
//! - **busy**: the session has an `in_progress` task → skip this fire (the work in hand comes first);
//! - **floor**: a marked prompt already ran here less than [`MIN_GAP_S`] ago → skip (fires that
//!   queued up while the session was busy collapse into one, docs: "no catch-up for missed fires").
//!
//! - **owner away on a subscription login**: no prompt typed by a human in this session for
//!   [`super::idle::PRESENT_S`] → skip. Unattended automated use belongs on a Console API key
//!   (Consumer Terms; `assets/skills/aup-audit/8sync-anthropic-rules.md`), same rail as `ccc idle`.
//!   Marked prompts never count as the owner, whatever origin Claude Code gives a cron fire.
//!
//! Prompts without the mark (typed by the owner, other loops) are never touched.
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// Put in the scheduled prompt by HQ (`apps/hq-ui/lib/schedule.ts`).
pub(super) const MARK: &str = "[8sync:wake]";
/// Shortest gap between two marked runs in one session (just under the 5-minute minimum step).
const MIN_GAP_S: u64 = 4 * 60;

#[derive(Debug, PartialEq)]
pub(super) enum Verdict {
    Run,
    Skip(String),
}

/// Pure decision from the facts the hook gathered. `owner_seen` is only checked on a subscription
/// login (`None` there = owner away).
pub(super) fn decide(subscription: bool, owner_seen: Option<u64>, busy_with: Option<&str>, last_run: Option<u64>, now: u64) -> Verdict {
    if subscription && !owner_seen.is_some_and(|t| now.saturating_sub(t) <= super::idle::PRESENT_S) {
        return Verdict::Skip(format!(
            "owner vắng (không gõ gì trong session này {} phút qua, login subscription); chạy không người trông cần Console API key",
            super::idle::PRESENT_S / 60
        ));
    }
    if let Some(t) = busy_with {
        return Verdict::Skip(format!("đang làm việc dở \"{}\"", crate::verbs::session_view::truncate(t, 60)));
    }
    match last_run.map(|t| now.saturating_sub(t)) {
        Some(ago) if ago < MIN_GAP_S => Verdict::Skip(format!("vừa chạy lượt lịch {ago} giây trước")),
        _ => Verdict::Run,
    }
}

fn valid_sid(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn claude_dir(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude"))
}

fn stamp_path(home: &Path, sid: &str) -> PathBuf {
    crate::brand::config_dir(home).join("wake").join(sid)
}

/// Last prompt typed by a human in a transcript (last 1 MiB), ignoring marked scheduled prompts.
pub(super) fn owner_seen(transcript: &Path) -> Option<u64> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(transcript).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(1 << 20))).ok()?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    String::from_utf8_lossy(&buf)
        .lines()
        .rev()
        .filter(|l| super::gate::human_text(l).is_some_and(|t| !t.contains(MARK)))
        .find_map(|l| serde_json::from_str::<Value>(l).ok()?["timestamp"].as_str().and_then(super::idle::iso_secs))
}

/// `8sync ccc hook wake`: UserPromptSubmit JSON in, a block decision out (or nothing = run).
pub(super) fn hook(input: &str, home: &Path, now: u64, subscription: bool) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    if !v["prompt"].as_str().is_some_and(|p| p.contains(MARK)) {
        return None;
    }
    let sid = v["session_id"].as_str().filter(|s| valid_sid(s))?;
    let tasks = super::idle::load_tasks(&claude_dir(home).join("tasks").join(sid));
    let busy = tasks.iter().find(|t| t.status == "in_progress").map(|t| t.subject.as_str());
    let stamp = stamp_path(home, sid);
    let last = std::fs::read_to_string(&stamp).ok().and_then(|s| s.trim().parse::<u64>().ok());
    let seen = if subscription { v["transcript_path"].as_str().and_then(|p| owner_seen(Path::new(p))) } else { None };
    match decide(subscription, seen, busy, last, now) {
        Verdict::Run => {
            if let Some(d) = stamp.parent() {
                let _ = std::fs::create_dir_all(d);
            }
            let _ = std::fs::write(&stamp, now.to_string());
            None
        }
        Verdict::Skip(why) => Some(
            json!({ "decision": "block", "reason": format!("8sync wake: bỏ qua lượt lịch này — {why}. Lịch vẫn giữ, lượt sau chạy lại."), "suppressOriginalPrompt": true })
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decides_busy_then_floor_then_run() {
        assert_eq!(decide(false, None, None, None, 1000), Verdict::Run);
        assert!(matches!(decide(false, None, Some("ship T7"), None, 1000), Verdict::Skip(w) if w.contains("ship T7")));
        assert!(matches!(decide(false, None, None, Some(900), 1000), Verdict::Skip(w) if w.contains("100 giây")));
        assert_eq!(decide(false, None, None, Some(1000 - MIN_GAP_S), 1000), Verdict::Run);
    }

    #[test]
    fn subscription_runs_only_while_the_owner_is_present() {
        let now = 100_000;
        assert!(matches!(decide(true, None, None, None, now), Verdict::Skip(w) if w.contains("Console API key")));
        assert!(matches!(decide(true, Some(now - super::super::idle::PRESENT_S - 1), None, None, now), Verdict::Skip(_)));
        assert_eq!(decide(true, Some(now - 60), None, None, now), Verdict::Run);
        let d = std::env::temp_dir().join(format!("8sync-wake-tp-{}-{}", std::process::id(), crate::verbs::uuid_sessions::new_uuid()));
        std::fs::create_dir_all(&d).unwrap();
        let tp = d.join("t.jsonl");
        let line = |ts: &str, text: &str| json!({ "type": "user", "timestamp": ts, "message": { "role": "user", "content": text } }).to_string();
        std::fs::write(&tp, [line("2026-10-15T01:00:00Z", "làm T7"), line("2026-10-15T05:00:00Z", &format!("{MARK} R&D trực"))].join("\n")).unwrap();
        assert_eq!(owner_seen(&tp), super::super::idle::iso_secs("2026-10-15T01:00:00Z"), "a cron fire is not the owner");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn hook_only_touches_marked_prompts_and_records_runs() {
        let home = std::env::temp_dir().join(format!("8sync-wake-{}-{}", std::process::id(), crate::verbs::uuid_sessions::new_uuid()));
        std::fs::create_dir_all(&home).unwrap();
        let input = |p: &str, sid: &str| json!({ "hook_event_name": "UserPromptSubmit", "session_id": sid, "prompt": p }).to_string();
        let sid = "0f1e2d3c-aaaa-bbbb-cccc-123456789abc";
        if std::env::var_os("CLAUDE_CONFIG_DIR").is_none() {
            assert!(hook(&input("làm tiếp", sid), &home, 100, false).is_none(), "unmarked prompt untouched");
            let p = format!("{MARK} New task: research");
            assert!(hook(&input(&p, sid), &home, 100, false).is_none(), "first fire runs");
            let out: Value = serde_json::from_str(&hook(&input(&p, sid), &home, 160, false).unwrap()).unwrap();
            assert_eq!(out["decision"], "block");
            assert!(hook(&input(&p, sid), &home, 100 + MIN_GAP_S, false).is_none(), "after the floor it runs again");
            let td = home.join(".claude/tasks").join(sid);
            std::fs::create_dir_all(&td).unwrap();
            std::fs::write(td.join("1.json"), json!({ "id": "1", "subject": "T7 chips", "status": "in_progress" }).to_string()).unwrap();
            let out: Value = serde_json::from_str(&hook(&input(&p, sid), &home, 10_000, false).unwrap()).unwrap();
            assert!(out["reason"].as_str().unwrap().contains("T7 chips"));
            assert!(hook(&input(&p, "../etc"), &home, 20_000, false).is_none(), "bad session id = no-op");
        }
        let _ = std::fs::remove_dir_all(&home);
    }
}
