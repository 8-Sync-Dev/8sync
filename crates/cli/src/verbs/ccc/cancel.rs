//! `8sync ccc cancel [--all] [--session <name>] [--json]`: one command that stops everything this
//! session set in motion, fail-closed. Idea after oh-my-claudecode's `/cancel` skill
//! (github.com/Yeachan-Heo/oh-my-claudecode, `skills/cancel/SKILL.md`, MIT): one unified cancel
//! scoped to the calling session, cross-session only behind an explicit flag, and "cancelled" only
//! when every piece is verified gone — a step that cannot be verified fails the command. Code ours.
//!
//! Default scope: the goal and urgency this session declared (registry), every live loop named in
//! the repo's `su-code/ship/ACTIVE` (the running `/ship-loop`/`/autopilot`; ACTIVE is per repo, not
//! per session — a loop another session listed there stops too), then ACTIVE itself. `--all` adds
//! every loop under `su-code/ship`. Claude Code's own scheduled tasks
//! (`/loop`, CronCreate) cannot be reached from outside the session: the summary says `/loop clear`.
//!
//! Fail-closed means: a slug that cannot be verified stopped (unreadable or unwritable loop.json,
//! a name that is not a slug) is `FAILED` and stays in ACTIVE for the retry; ACTIVE is removed only
//! when every loop in it is verified stopped; a switch still on after `off` (env override) is FAILED.

use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::path::Path;

use crate::verbs::uuid_sessions::Store;

const USAGE: &str = "usage: 8sync ccc cancel [--all] [--session <name>] [--json]";

/// What one run did: every line is printed, `failed` non-empty = exit 1.
#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Report {
    pub done: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<String>,
}

impl Report {
    pub(super) fn ok(&self) -> bool {
        self.failed.is_empty()
    }

    pub(super) fn json(&self) -> Value {
        json!({ "schema": 1, "ok": self.ok(), "done": self.done, "skipped": self.skipped, "failed": self.failed })
    }

    pub(super) fn text(&self) -> String {
        let mut out = String::new();
        for l in &self.done {
            out.push_str(&format!("✓ {l}\n"));
        }
        for l in &self.skipped {
            out.push_str(&format!("– {l}\n"));
        }
        for l in &self.failed {
            out.push_str(&format!("✗ FAILED {l}\n"));
        }
        out.push_str(&format!("cancel: {} huỷ · {} bỏ qua · {} lỗi", self.done.len(), self.skipped.len(), self.failed.len()));
        if !self.ok() {
            out.push_str(" — CHƯA huỷ hết, xem dòng FAILED");
        }
        out.push_str("\nScheduled task của Claude Code (/loop, CronCreate) chỉ huỷ được trong session: gõ `/loop clear`.\n");
        out
    }
}

struct Opts {
    all: bool,
    session: Option<String>,
    pub json: bool,
}

fn parse(args: &[String]) -> Result<Opts> {
    let mut o = Opts { all: false, session: None, json: false };
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--all" => o.all = true,
            "--json" => o.json = true,
            "--session" => match it.next() {
                Some(n) => o.session = Some(n.clone()),
                None => bail!("{USAGE}"),
            },
            "--help" | "-h" => bail!("{USAGE}"),
            s => bail!("unknown argument `{s}`\n{USAGE}"),
        }
    }
    Ok(o)
}

/// Parse, cancel, print. Returns whether everything was cancelled (false → caller exits 1).
pub(super) fn run(store: &Store, args: &[String], env_id: Option<&str>, cwd: &Path, now: u64) -> Result<bool> {
    let o = parse(args)?;
    let r = cancel(store, o.all, o.session.as_deref(), env_id, cwd, now)?;
    if o.json {
        println!("{}", r.json());
    } else {
        print!("{}", r.text());
    }
    Ok(r.ok())
}

/// The whole cancel, pure over its inputs. Refuses (nothing touched) when no session is named and
/// `CLAUDE_CODE_SESSION_ID` is unset, or when `--session` names a session this repo does not have.
pub(super) fn cancel(store: &Store, all: bool, session: Option<&str>, env_id: Option<&str>, cwd: &Path, now: u64) -> Result<Report> {
    let id = env_id.filter(|s| !s.is_empty());
    if session.is_none() && id.is_none() {
        bail!("no session: pass --session <name> (CLAUDE_CODE_SESSION_ID is not set) — nothing cancelled");
    }
    let mut r = Report::default();
    // 1. goal + urgency of this session (registry).
    let reg = store.load();
    let me = reg.sessions.iter().find(|s| match session {
        Some(n) => s.name == n,
        None => Some(s.conversation_id.as_str()) == id,
    });
    match me {
        None if session.is_some() => bail!("no session '{}' in this repo (see `8sync ccc . ls`) — nothing cancelled", session.unwrap_or_default()),
        None => r.skipped.push("goal/urgent: session này không đăng ký `8sync ccc .` trong repo (không có gì để xoá)".into()),
        Some(s) => {
            let name = s.name.clone();
            if s.goal.is_some() {
                match store.set_goal(session, id, None) {
                    Ok(Some(_)) => r.done.push(format!("goal của '{name}' xoá")),
                    Ok(None) => r.failed.push(format!("goal của '{name}': session biến mất khi ghi")),
                    Err(e) => r.failed.push(format!("goal của '{name}': {e:#}")),
                }
            } else {
                r.skipped.push(format!("goal của '{name}': không có"));
            }
            if s.urgency.is_some() {
                match store.set_urgency(session, id, None) {
                    Ok(Some(_)) => r.done.push(format!("urgent của '{name}' xoá")),
                    Ok(None) => r.failed.push(format!("urgent của '{name}': session biến mất khi ghi")),
                    Err(e) => r.failed.push(format!("urgent của '{name}': {e:#}")),
                }
            } else {
                r.skipped.push(format!("urgent của '{name}': không có"));
            }
        }
    }
    // 2. loops: the names in ACTIVE; every loop under su-code/ship with --all.
    let ship = super::looper::ship_dir(cwd);
    let active_p = ship.join("ACTIVE");
    let active = match std::fs::read_to_string(&active_p) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            r.failed.push(format!("su-code/ship/ACTIVE: không đọc được ({e}) — loop trong đó chưa dừng"));
            None
        }
    };
    let mut names: Vec<String> = active.as_deref().unwrap_or_default().lines().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned).collect();
    if all {
        for s in super::looper::loop_slugs(&ship) {
            if !names.contains(&s) {
                names.push(s);
            }
        }
    }
    let mut keep: Vec<String> = Vec::new(); // ACTIVE lines not verified stopped
    for name in &names {
        if !super::looper::valid_slug(name) {
            r.failed.push(format!("ACTIVE có dòng không phải slug {name:?}: không biết loop nào, sửa tay"));
            keep.push(name.clone());
            continue;
        }
        match super::looper::cancel(&ship.join(name).join("loop.json"), now) {
            Ok(true) => r.done.push(format!("loop {name}: dừng (cancelled)")),
            Ok(false) => r.skipped.push(format!("loop {name}: không chạy")),
            Err(e) => {
                r.failed.push(format!("loop {name}: {e:#}"));
                keep.push(name.clone());
            }
        }
    }
    let keep_active: Vec<&String> = keep.iter().filter(|k| active.as_deref().is_some_and(|a| a.lines().any(|l| l.trim() == k.as_str()))).collect();
    match active {
        None => r.skipped.push("su-code/ship/ACTIVE: không có".into()),
        Some(_) if !keep_active.is_empty() => {
            // Keep exactly the lines that are not verified stopped, so the retry sees them.
            let body = keep_active.iter().map(|k| format!("{k}\n")).collect::<String>();
            match std::fs::write(&active_p, body) {
                Ok(()) => r.failed.push(format!("su-code/ship/ACTIVE giữ lại {} dòng chưa huỷ được", keep_active.len())),
                Err(e) => r.failed.push(format!("su-code/ship/ACTIVE: {e}")),
            }
        }
        Some(_) => match std::fs::remove_file(&active_p) {
            Ok(()) => r.done.push("su-code/ship/ACTIVE xoá".into()),
            Err(e) => r.failed.push(format!("su-code/ship/ACTIVE: {e}")),
        },
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verbs::uuid_sessions::{Goal, Urgency};

    struct Fx {
        dir: std::path::PathBuf,
        store: Store,
    }
    impl Fx {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("8sync-cancel-{tag}-{}-{}", std::process::id(), crate::verbs::uuid_sessions::new_uuid()));
            std::fs::create_dir_all(dir.join("repo/su-code/ship")).unwrap();
            let store = Store::new(&dir.join("cfg"), std::path::Path::new("/repo"), "claude-sessions", "ccc .");
            Self { dir, store }
        }
        fn repo(&self) -> std::path::PathBuf {
            self.dir.join("repo")
        }
        fn live_loop(&self, slug: &str) {
            let d = self.repo().join("su-code/ship").join(slug);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("loop.json"), r#"{"slug":"x","started":1,"max_iter":5,"max_min":9,"iter":1,"digests":[],"stopped":null}"#).unwrap();
        }
        fn loop_stopped(&self, slug: &str) -> Option<String> {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(self.repo().join("su-code/ship").join(slug).join("loop.json")).unwrap()).unwrap();
            v["stopped"].as_str().map(str::to_owned)
        }
    }
    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn cancel_session_scope_clears_goal_urgent_active_loops_and_leaves_the_rest() {
        let fx = Fx::new("scope");
        let a = fx.store.touch("core", false).unwrap();
        fx.store.set_goal(None, Some(&a.conversation_id), Some(Goal { text: "x".into(), files: vec![], set_at: 1 })).unwrap();
        fx.store.set_urgency(None, Some(&a.conversation_id), Some(Urgency { level: "high".into(), note: None, set_at: 1 })).unwrap();
        fx.live_loop("mine");
        fx.live_loop("other");
        std::fs::write(fx.repo().join("su-code/ship/ACTIVE"), "autopilot\nmine\n").unwrap();
        let r = cancel(&fx.store, false, None, Some(&a.conversation_id), &fx.repo(), 50).unwrap();
        assert!(r.ok(), "{r:?}");
        assert_eq!(r.done, ["goal của 'core' xoá", "urgent của 'core' xoá", "loop mine: dừng (cancelled)", "su-code/ship/ACTIVE xoá"]);
        assert_eq!(r.skipped, ["loop autopilot: không chạy"], "the autopilot marker has no loop.json");
        let s = &fx.store.load().sessions[0];
        assert!(s.goal.is_none() && s.urgency.is_none());
        assert_eq!(fx.loop_stopped("mine").as_deref(), Some("cancelled"));
        assert_eq!(fx.loop_stopped("other"), None, "a loop not in ACTIVE is not touched without --all");
        assert!(!fx.repo().join("su-code/ship/ACTIVE").exists());
        // Idempotent: a second run cancels nothing and still succeeds.
        let r2 = cancel(&fx.store, false, None, Some(&a.conversation_id), &fx.repo(), 51).unwrap();
        assert!(r2.ok() && r2.done.is_empty(), "{r2:?}");
        let t = r2.text();
        assert!(t.contains("cancel: 0 huỷ") && t.contains("/loop clear"), "{t}");
    }

    #[test]
    fn cancel_all_stops_every_live_loop() {
        let fx = Fx::new("all");
        fx.store.touch("core", false).unwrap();
        fx.live_loop("a");
        fx.live_loop("b");
        std::fs::create_dir_all(fx.repo().join("su-code/ship/done")).unwrap();
        std::fs::write(fx.repo().join("su-code/ship/done/loop.json"), r#"{"slug":"done","stopped":"done","iter":1,"started":1,"max_iter":1,"max_min":1,"digests":[]}"#).unwrap();
        let r = cancel(&fx.store, true, Some("core"), None, &fx.repo(), 50).unwrap();
        assert!(r.ok(), "{r:?}");
        assert_eq!(fx.loop_stopped("a").as_deref(), Some("cancelled"));
        assert_eq!(fx.loop_stopped("b").as_deref(), Some("cancelled"));
        assert_eq!(fx.loop_stopped("done").as_deref(), Some("done"), "a finished loop keeps its reason");
        let j = r.json();
        assert_eq!(j["ok"], true);
        assert_eq!(j["done"].as_array().unwrap().len(), r.done.len());
    }

    #[test]
    fn cancel_fails_closed_without_a_session_or_on_a_broken_loop() {
        let fx = Fx::new("closed");
        fx.live_loop("x");
        std::fs::write(fx.repo().join("su-code/ship/ACTIVE"), "x\n").unwrap();
        let e = cancel(&fx.store, false, None, None, &fx.repo(), 1).unwrap_err().to_string();
        assert!(e.contains("--session") && e.contains("nothing cancelled"), "{e}");
        assert_eq!(fx.loop_stopped("x"), None, "refused = untouched");
        let e = cancel(&fx.store, false, Some("ghost"), None, &fx.repo(), 1).unwrap_err().to_string();
        assert!(e.contains("no session 'ghost'"), "{e}");
        // An unregistered session id still cancels its loops; goal/urgent are reported as skipped.
        let r = cancel(&fx.store, false, None, Some("not-registered"), &fx.repo(), 1).unwrap();
        assert!(r.ok() && r.skipped[0].starts_with("goal/urgent"), "{r:?}");
        assert_eq!(fx.loop_stopped("x").as_deref(), Some("cancelled"));
        // A corrupt loop.json named in ACTIVE cannot be verified stopped → FAILED, exit 1, and
        // ACTIVE keeps that line (plus a non-slug line) so the retry still sees it; a good loop
        // in the same ACTIVE is still cancelled.
        let d = fx.repo().join("su-code/ship/bad");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("loop.json"), "{not json").unwrap();
        fx.live_loop("good");
        std::fs::write(fx.repo().join("su-code/ship/ACTIVE"), "bad\n../etc\ngood\n").unwrap();
        let r = cancel(&fx.store, false, None, Some("not-registered"), &fx.repo(), 2).unwrap();
        assert!(!r.ok(), "{r:?}");
        assert!(r.failed.iter().any(|l| l.starts_with("loop bad")) && r.failed.iter().any(|l| l.contains("không phải slug")), "{r:?}");
        assert_eq!(fx.loop_stopped("good").as_deref(), Some("cancelled"));
        assert_eq!(std::fs::read_to_string(fx.repo().join("su-code/ship/ACTIVE")).unwrap(), "bad\n../etc\n");
        assert!(r.text().contains("CHƯA huỷ hết") && r.json()["ok"] == false);
        // --all also fails on a corrupt loop that is not in ACTIVE.
        std::fs::remove_file(fx.repo().join("su-code/ship/ACTIVE")).unwrap();
        let r = cancel(&fx.store, true, None, Some("not-registered"), &fx.repo(), 3).unwrap();
        assert!(!r.ok() && r.failed.iter().any(|l| l.starts_with("loop bad")), "{r:?}");
        assert!(parse(&["--nope".to_string()]).is_err() && parse(&["--session".to_string()]).is_err());
    }
}
