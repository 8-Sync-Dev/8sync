//! `8sync ccc . goal <text…> [--files a,b] [--session <name>]` (or `goal clear`): the agent in a
//! session states its current target and the files it claims, so the other rooms see who is doing
//! what (`ccc . ls`, the SessionStart "Phòng khác đang làm" block, `ccc standup`) and do not edit the
//! same files. The session is picked like `ccc . urgent` (`--session`, else `$CLAUDE_CODE_SESSION_ID`).

use anyhow::{bail, Result};

use crate::verbs::uuid_sessions::{Goal, Store};

/// Max chars of the goal text kept in the registry.
const TEXT_MAX: usize = 120;
/// Max claimed files kept, and chars per path.
const FILES_MAX: usize = 8;
const PATH_MAX: usize = 120;

/// Parse and apply; returns the confirmation line.
pub(super) fn run(store: &Store, args: &[String], env_id: Option<&str>, now: u64) -> Result<String> {
    let usage = "usage: 8sync ccc . goal <mục tiêu…> [--files a,b] [--session <name>]  |  goal clear";
    let mut session: Option<String> = None;
    let mut files: Vec<String> = Vec::new();
    let mut words: Vec<&str> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--session" => match it.next() {
                Some(n) => session = Some(n.clone()),
                None => bail!("{usage}"),
            },
            "--files" => match it.next() {
                Some(f) => files.extend(f.split(',').map(str::trim).filter(|p| !p.is_empty()).map(|p| clean(p, PATH_MAX))),
                None => bail!("{usage}"),
            },
            s => words.push(s),
        }
    }
    let clear = matches!(words.as_slice(), ["clear"] | ["none"] | ["off"]);
    let text = clean(&words.join(" "), TEXT_MAX);
    if !clear && text.is_empty() {
        bail!("{usage}");
    }
    let mut seen = std::collections::HashSet::new();
    files.retain(|f| seen.insert(f.clone()));
    files.truncate(FILES_MAX);
    let goal = (!clear).then_some(Goal { text, files, set_at: now });
    let id = env_id.filter(|s| !s.is_empty());
    if session.is_none() && id.is_none() {
        bail!("no session: pass --session <name> (CLAUDE_CODE_SESSION_ID is not set)");
    }
    match store.set_goal(session.as_deref(), id, goal)? {
        Some(name) if clear => Ok(format!("cleared goal of '{name}'")),
        Some(name) => Ok(format!("'{name}' goal set")),
        None => match session {
            Some(n) => bail!("no session '{n}' in this repo (see `8sync ccc . ls`)"),
            None => bail!("this Claude Code session is not a named `8sync ccc .` session here: pass --session <name>"),
        },
    }
}

/// Characters that can repaint a terminal or hide text: controls (ESC, BEL…), bidi overrides and
/// isolates, zero-width marks, BOM, line/paragraph separators.
fn hidden(c: char) -> bool {
    c.is_control() || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{2028}' | '\u{2029}' | '\u{FEFF}')
}

/// First non-empty line, hidden characters dropped, secrets masked, at most `max` chars. Used on
/// write and on every read path, since an index or board file may predate it or be hand-edited.
pub(super) fn clean(s: &str, max: usize) -> String {
    let line = s.lines().map(|l| l.chars().filter(|c| !hidden(*c)).collect::<String>()).find(|l| !l.trim().is_empty()).unwrap_or_default();
    crate::verbs::session_view::truncate(&crate::verbs::session_view::mask_secrets(line.trim()), max)
}

/// The `goal` line `ls` shows under a session: target, then up to 3 claimed files.
pub(super) fn line(g: &Goal, width: usize) -> String {
    let files = if g.files.is_empty() { String::new() } else { format!(" · file: {}", g.files.iter().take(3).map(|f| clean(f, PATH_MAX)).collect::<Vec<_>>().join(", ")) };
    format!("      goal {}", crate::verbs::session_view::truncate(&format!("{}{files}", clean(&g.text, TEXT_MAX)), width.saturating_sub(12).max(10)))
}

/// JSON form for `ls --json`.
pub(super) fn json(g: Option<&Goal>) -> serde_json::Value {
    match g {
        Some(g) => serde_json::json!({ "text": clean(&g.text, TEXT_MAX), "files": g.files.iter().map(|f| clean(f, PATH_MAX)).collect::<Vec<_>>(), "set_at": g.set_at }),
        None => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(tag: &str) -> (Store, std::path::PathBuf) {
        let d = std::env::temp_dir().join(format!("8sync-goal-{tag}-{}-{}", std::process::id(), crate::verbs::uuid_sessions::new_uuid()));
        (Store::new(&d, std::path::Path::new("/repo"), "claude-sessions", "ccc ."), d)
    }
    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn sets_goal_with_files_by_env_id_and_clears() {
        let (st, d) = store("env");
        let a = st.touch("core", false).unwrap();
        st.touch("rd", false).unwrap();
        let msg = run(&st, &s(&["ship", "standup", "verb", "--files", "crates/a.rs, crates/b.rs,,crates/a.rs"]), Some(&a.conversation_id), 9).unwrap();
        assert_eq!(msg, "'core' goal set");
        let g = st.load().sessions[0].goal.clone().unwrap();
        assert_eq!((g.text.as_str(), g.set_at), ("ship standup verb", 9));
        assert_eq!(g.files, ["crates/a.rs", "crates/b.rs"], "trimmed, empties and repeats dropped");
        assert!(st.load().sessions[1].goal.is_none());
        assert_eq!(run(&st, &s(&["clear"]), Some(&a.conversation_id), 10).unwrap(), "cleared goal of 'core'");
        assert!(st.load().sessions[0].goal.is_none());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn errors_are_clear_and_text_is_sanitised() {
        let (st, d) = store("err");
        st.touch("rd", false).unwrap();
        assert!(run(&st, &s(&[]), Some("x"), 1).is_err(), "empty goal");
        assert!(run(&st, &s(&["x"]), None, 1).unwrap_err().to_string().contains("--session"));
        assert!(run(&st, &s(&["x", "--session", "ghost"]), None, 1).unwrap_err().to_string().contains("no session 'ghost'"));
        assert!(run(&st, &s(&["x"]), Some("not-ours"), 1).unwrap_err().to_string().contains("not a named"));
        assert!(run(&st, &s(&["x", "--files"]), None, 1).is_err());
        run(&st, &s(&["\u{1b}[2Jdọn", "màn", "--session", "rd"]), None, 1).unwrap();
        assert_eq!(st.load().sessions[0].goal.as_ref().unwrap().text, "[2Jdọn màn");
        let key = format!("deploy sk-ant-api03-{}", "A".repeat(40));
        run(&st, &s(&[&key, "--session", "rd"]), None, 1).unwrap();
        assert!(!st.load().sessions[0].goal.as_ref().unwrap().text.contains(&"A".repeat(40)));
        assert_eq!(clean(&"ư".repeat(300), TEXT_MAX).chars().count(), TEXT_MAX);
        assert_eq!(clean("a\u{202E}b\u{200B}c\u{2066}d\u{FEFF}", 50), "abcd", "bidi / zero-width dropped");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn line_and_json() {
        let g = Goal { text: "T7 inbox chips".into(), files: vec!["a.rs".into(), "b.rs".into(), "c.rs".into(), "d.rs".into()], set_at: 3 };
        assert_eq!(line(&g, 100), "      goal T7 inbox chips · file: a.rs, b.rs, c.rs");
        assert_eq!(json(Some(&g))["files"].as_array().unwrap().len(), 4);
        assert!(json(None).is_null());
        let old = Goal { text: "x\u{1b}[2J\u{202E}y".into(), files: vec!["a\u{7}.rs".into()], set_at: 1 };
        assert_eq!(line(&old, 100), "      goal x[2Jy · file: a.rs", "read path cleans an index written before sanitising");
        assert_eq!(json(Some(&old))["text"], "x[2Jy");
    }
}
