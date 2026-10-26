//! `8sync ccc . urgent <high|med|low|clear> [note…] [--session <name>]`: the agent running in a
//! session flags how urgently it needs the owner, and `ccc . ls` shows that flag (text + colour)
//! on a newest-first list.
//!
//! The session is `--session <name>`, else the one whose conversation id is
//! `$CLAUDE_CODE_SESSION_ID` (Claude Code 2.1.299 sets it for every Bash tool call; seen
//! 2026-10-15, not in the env-var docs, so `--session` is the documented fallback).

use anyhow::{bail, Result};

use crate::verbs::uuid_sessions::{Session, Store, Urgency, URGENCY_LEVELS};

/// Max chars of the note kept in the registry and shown by `ls`.
const NOTE_MAX: usize = 80;

/// Parse and apply; returns the confirmation line.
pub(super) fn run(store: &Store, args: &[String], env_id: Option<&str>, now: u64) -> Result<String> {
    let usage = "usage: 8sync ccc . urgent <high|med|low|clear> [note…] [--session <name>]";
    let mut session: Option<String> = None;
    let mut words: Vec<&str> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--session" => match it.next() {
                Some(n) => session = Some(n.clone()),
                None => bail!("{usage}"),
            },
            s => words.push(s),
        }
    }
    let Some((level, note)) = words.split_first() else { bail!("{usage}") };
    let level = match *level {
        "medium" => "med",
        "clear" | "none" | "off" => "clear",
        l if URGENCY_LEVELS.contains(&l) => l,
        l => bail!("unknown level '{l}' — {usage}"),
    };
    let urgency = (level != "clear").then(|| Urgency { level: level.into(), note: clean_note(&note.join(" ")), set_at: now });
    let id = env_id.filter(|s| !s.is_empty());
    if session.is_none() && id.is_none() {
        bail!("no session to flag: pass --session <name> (CLAUDE_CODE_SESSION_ID is not set)");
    }
    match store.set_urgency(session.as_deref(), id, urgency)? {
        Some(name) if level == "clear" => Ok(format!("cleared urgency of '{name}'")),
        Some(name) => Ok(format!("'{name}' marked {level}")),
        None => match session {
            Some(n) => bail!("no session '{n}' in this repo (see `8sync ccc . ls`)"),
            None => bail!("this Claude Code session is not a named `8sync ccc .` session here: pass --session <name>"),
        },
    }
}

/// First non-empty line, control characters (ANSI escapes) dropped so a note cannot repaint the
/// owner's terminal, secrets masked, at most [`NOTE_MAX`] chars; empty → `None`.
fn clean_note(s: &str) -> Option<String> {
    let line = s.lines().map(|l| l.chars().filter(|c| !c.is_control()).collect::<String>()).find(|l| !l.trim().is_empty())?;
    Some(crate::verbs::session_view::truncate(&crate::verbs::session_view::mask_secrets(line.trim()), NOTE_MAX))
}

/// Chip text for a level: symbol + word, so the meaning never rests on colour alone.
pub(super) fn chip_text(level: &str) -> &'static str {
    match level {
        "high" => "▲ high",
        "med" => "◆ med",
        _ => "▽ low",
    }
}

fn paint(level: &str, s: &str, color: bool) -> String {
    use owo_colors::OwoColorize;
    if !color {
        return s.to_string();
    }
    match level {
        "high" => s.red().bold().to_string(),
        "med" => s.yellow().to_string(),
        _ => s.cyan().to_string(),
    }
}

/// Add the flag to a session's rendered lines: the chip on line 1, the note (if any) as a
/// `flag` line right under it, clipped to `width`.
pub(super) fn decorate(lines: &mut Vec<String>, u: Option<&Urgency>, width: usize, now: u64, color: bool) {
    let Some(u) = u else { return };
    let chip = chip_text(&u.level);
    if let Some(first) = lines.first_mut() {
        first.push_str("  ");
        first.push_str(&paint(&u.level, chip, color));
    }
    let when = crate::verbs::session_view::ago(u.set_at, now);
    let body = match &u.note {
        Some(n) => format!("{n} · {when}"),
        None => when,
    };
    let room = width.saturating_sub(12).max(10);
    let line = format!("      {} {}", paint(&u.level, "flag", color), crate::verbs::session_view::truncate(&body, room));
    lines.insert(1.min(lines.len()), line);
}

/// JSON form of a session's flag for `ls --json`.
pub(super) fn json(s: &Session) -> serde_json::Value {
    match &s.urgency {
        Some(u) => serde_json::json!({ "level": u.level, "note": u.note, "set_at": u.set_at }),
        None => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tag: &str) -> (Store, std::path::PathBuf) {
        let d = std::env::temp_dir().join(format!("8sync-urgent-{tag}-{}-{}", std::process::id(), crate::verbs::uuid_sessions::new_uuid()));
        (Store::new(&d, std::path::Path::new("/repo"), "claude-sessions", "ccc ."), d)
    }
    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn flags_own_session_by_env_id_and_clears() {
        let (st, d) = store("env");
        let a = st.touch("core", false).unwrap();
        st.touch("rd", false).unwrap();
        let msg = run(&st, &s(&["high", "chờ", "owner", "duyệt", "PR"]), Some(&a.conversation_id), 100).unwrap();
        assert_eq!(msg, "'core' marked high");
        let u = st.load().sessions[0].urgency.clone().unwrap();
        assert_eq!((u.level.as_str(), u.note.as_deref(), u.set_at), ("high", Some("chờ owner duyệt PR"), 100));
        assert!(st.load().sessions[1].urgency.is_none(), "only the caller's own session");
        assert_eq!(run(&st, &s(&["clear"]), Some(&a.conversation_id), 101).unwrap(), "cleared urgency of 'core'");
        assert!(st.load().sessions[0].urgency.is_none());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn session_flag_wins_and_errors_are_clear() {
        let (st, d) = store("flag");
        st.touch("core", false).unwrap();
        st.touch("rd", false).unwrap();
        assert_eq!(run(&st, &s(&["medium", "--session", "rd"]), Some("other-id"), 1).unwrap(), "'rd' marked med");
        assert_eq!(st.load().sessions[1].urgency.as_ref().unwrap().note, None);
        assert!(run(&st, &s(&["urgent"]), None, 1).unwrap_err().to_string().contains("unknown level"));
        assert!(run(&st, &s(&["high"]), None, 1).unwrap_err().to_string().contains("--session"));
        assert!(run(&st, &s(&["high"]), Some("not-ours"), 1).unwrap_err().to_string().contains("not a named"));
        assert!(run(&st, &s(&["high", "--session", "ghost"]), None, 1).unwrap_err().to_string().contains("no session 'ghost'"));
        assert!(run(&st, &s(&[]), None, 1).is_err());
        assert!(run(&st, &s(&["low", "--session"]), None, 1).is_err());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn note_is_one_line_masked_and_clipped() {
        assert_eq!(clean_note(""), None);
        assert_eq!(clean_note("\n  dòng một \nhai").as_deref(), Some("dòng một"));
        let long = "ư".repeat(200);
        assert_eq!(clean_note(&long).unwrap().chars().count(), NOTE_MAX);
        let key = format!("key sk-ant-api03-{}", "A".repeat(40));
        assert!(!clean_note(&key).unwrap().contains(&"A".repeat(40)), "secret masked");
        assert_eq!(clean_note("\u{1b}[2J\u{1b}[31mxoá màn hình\u{7}").as_deref(), Some("[2J[31mxoá màn hình"), "no ESC/BEL reaches the terminal");
    }

    #[test]
    fn decorate_adds_text_chip_and_flag_line() {
        let mut lines = vec!["★ core  ● running  2s ago".to_string(), "      ask x".to_string()];
        let u = Urgency { level: "high".into(), note: Some("chờ owner".into()), set_at: 40 };
        decorate(&mut lines, Some(&u), 100, 100, false);
        assert_eq!(lines[0], "★ core  ● running  2s ago  ▲ high");
        assert!(lines[1].starts_with("      flag chờ owner · "), "{}", lines[1]);
        assert_eq!(lines[2], "      ask x");
        let mut plain = vec!["x".to_string()];
        decorate(&mut plain, None, 100, 100, false);
        assert_eq!(plain, ["x"]);
        assert_eq!((chip_text("med"), chip_text("low")), ("◆ med", "▽ low"));
        let mut colored = vec!["x".to_string()];
        decorate(&mut colored, Some(&u), 100, 100, true);
        assert!(colored[0].contains("\u{1b}[") && colored[0].contains("▲ high"), "colour plus text");
    }
}
