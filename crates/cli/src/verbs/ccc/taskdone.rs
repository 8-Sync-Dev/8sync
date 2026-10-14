//! `8sync ccc hook task-done` — the quality gate on `TaskCompleted`, part of "không ai rảnh"
//! (same switch: OFF unless `no_idle`). No model call: it reads the agent's transcript tail and
//! `git status`.
//!
//! Hook (https://code.claude.com/docs/en/hooks#taskcompleted, checked 2026-10-14): fires when a
//! task is marked completed through TaskUpdate, and when an agent-team teammate ends its turn with
//! in-progress tasks; exit 2 keeps the task open and feeds stderr back to the model. The event
//! has no `additionalContext`, so the learning nudge (a task that was held back, then passed) is
//! left in `idle/learn/` for the member's next `hook idle` to deliver once.
//!
//! Held back when the transcript shows a code edit after the last test/check command and the
//! git tree is dirty; at most [`MAX_HOLDS`] times per task, then it passes (the gate must not trap
//! an agent that cannot run the checks).
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde_json::{json, Value};

const MAX_HOLDS: u32 = 2;
const TAIL: u64 = 512 * 1024;

/// Words that make a runner's command a test/check/build run.
const CHECK_WORDS: [&str; 17] =
    ["test", "tests", "check", "clippy", "nextest", "vitest", "jest", "pytest", "tsc", "typecheck", "lint", "eslint", "build", "vet", "ruff", "mypy", "uat"];
/// Programs that run a project's checks (the word after them decides), and checkers on their own.
const RUNNERS: [&str; 19] =
    ["cargo", "pnpm", "npm", "yarn", "bun", "npx", "go", "uv", "uvx", "python", "python3", "make", "just", "deno", "dotnet", "mvn", "gradle", "bash", "sh"];
const CHECKERS: [&str; 7] = ["pytest", "vitest", "jest", "tsc", "eslint", "ruff", "mypy"];
/// Prefixes skipped to find the program: `nice -n 19 ionice -c3 cargo test`, `FOO=1 pnpm test`.
const WRAPPERS: [&str; 6] = ["nice", "ionice", "timeout", "env", "time", "command"];
/// Edits to these files need no check.
const DOC_EXT: [&str; 6] = ["md", "mdx", "txt", "rst", "adoc", "log"];

/// One segment (between `&&`, `;`, `|`) runs a check: its program is a checker, a runner followed by a
/// check word (`cargo test`, `pnpm run lint`, `bash scripts/uat/x.sh`), or `8sync run|loop ev`.
/// `ls tests`, `mkdir test`, `git check-ignore` are not checks.
fn is_check(cmd: &str) -> bool {
    cmd.split(['&', ';', '|', '\n']).any(|seg| {
        let words: Vec<&str> = seg.split_whitespace().collect();
        let mut i = 0;
        while i < words.len() {
            let w = words[i];
            let base = w.rsplit(['/', '\\']).next().unwrap_or(w);
            if WRAPPERS.contains(&base) || w.starts_with('-') || w.contains('=') || w.parse::<f64>().is_ok() {
                i += 1;
                continue;
            }
            break;
        }
        let Some(prog) = words.get(i).map(|w| w.rsplit(['/', '\\']).next().unwrap_or(w).trim_end_matches(".exe").to_ascii_lowercase()) else { return false };
        let rest = || words[i + 1..].iter().flat_map(|w| w.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))).map(str::to_ascii_lowercase);
        match prog.as_str() {
            p if CHECKERS.contains(&p) => true,
            p if RUNNERS.contains(&p) => rest().any(|w| CHECK_WORDS.contains(&w.as_str())),
            "8sync" => words.get(i + 1).is_some_and(|w| *w == "run") || (words.get(i + 1) == Some(&"ccc") && words.get(i + 2) == Some(&"loop") && words.get(i + 3) == Some(&"ev")),
            _ => false,
        }
    })
}

fn is_code(path: &str) -> bool {
    let ext = Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    !DOC_EXT.contains(&ext.as_str())
}

/// The code file edited after the last check command in this transcript, if any.
pub(super) fn unchecked_edit(transcript: &str) -> Option<String> {
    let mut last_edit: Option<String> = None;
    for line in transcript.lines() {
        if !line.contains(r#""type":"assistant""#) || !line.contains("tool_use") {
            continue;
        }
        let Ok(e) = serde_json::from_str::<Value>(line) else { continue };
        for b in e["message"]["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "tool_use") {
            let input = &b["input"];
            match b["name"].as_str().unwrap_or_default() {
                "Edit" | "Write" | "MultiEdit" | "NotebookEdit" => {
                    let f = input["file_path"].as_str().or(input["notebook_path"].as_str()).unwrap_or_default();
                    if is_code(f) {
                        last_edit = Some(f.to_string());
                    }
                }
                "Bash" | "PowerShell" if input["command"].as_str().is_some_and(is_check) => last_edit = None,
                _ => {}
            }
        }
    }
    last_edit
}

fn tail(path: &Path) -> String {
    let Ok(mut f) = std::fs::File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut buf = Vec::new();
    if f.seek(SeekFrom::Start(len.saturating_sub(TAIL))).is_ok() {
        let _ = f.read_to_end(&mut buf);
    }
    String::from_utf8_lossy(&buf).into_owned()
}

/// Tracked files changed in `cwd`'s repo. Not a repo / no git → not dirty (fail open).
fn dirty(cwd: &Path) -> bool {
    cwd.is_absolute()
        && std::process::Command::new("git")
            // No repo-configured fsmonitor command runs from a hook.
            .args(["-c", "core.fsmonitor=false", "status", "--porcelain", "--untracked-files=no"])
            .current_dir(cwd)
            .stdin(std::process::Stdio::null())
            .output()
            .is_ok_and(|o| o.status.success() && !o.stdout.is_empty())
}

#[derive(Debug, PartialEq)]
pub(super) enum Verdict {
    Hold(String),
    Pass,
}

/// `holds`: times this task was already held back. Returns the verdict and the new count.
pub(super) fn decide(task: &str, edit: Option<&str>, dirty: bool, holds: u32) -> (Verdict, u32) {
    match edit {
        Some(f) if dirty && holds < MAX_HOLDS => (
            Verdict::Hold(format!(
                "8sync task-done: task {task} chưa xong — đã sửa {f} nhưng chưa chạy test/check nào sau đó và tree còn thay đổi chưa commit. Chạy test/lint/build của repo cho phần vừa sửa, sửa lỗi nếu có, rồi mới TaskUpdate completed."
            )),
            holds + 1,
        ),
        _ => (Verdict::Pass, holds),
    }
}

/// Team + member keys shared with `hook idle`.
pub(super) fn who(v: &Value) -> Option<(String, String)> {
    let sid = v["session_id"].as_str().unwrap_or_default();
    let team = v["team_name"].as_str().filter(|t| !t.is_empty()).map(String::from).or_else(|| Some(format!("session-{}", sid.get(..8)?)))?;
    let me = v["teammate_name"].as_str().filter(|t| !t.is_empty()).unwrap_or("lead").to_string();
    Some((team, me))
}

/// The pending learning nudge for a member, written when a held task finally passes.
pub(super) fn learn_path(home: &Path, team: &str, me: &str) -> std::path::PathBuf {
    super::idle::state_dir(home).join("learn").join(format!("{}__{}.json", super::idle::safe(team), super::idle::safe(me)))
}

/// The transcript of the agent that finished the task. With `agent_id` (a teammate or subagent),
/// `transcript_path` may be the lead's, so read `<lead transcript dir>/<lead id>/subagents/
/// agent-<agent_id>.jsonl` (layout seen on disk, Claude Code 2.1.299; not documented). Not found
/// → `None`, and the task passes: a lead's edits must never hold a teammate's task.
fn transcript(v: &Value) -> Option<std::path::PathBuf> {
    let main = std::path::PathBuf::from(v["transcript_path"].as_str()?);
    match v["agent_id"].as_str().filter(|a| !a.is_empty()) {
        None => Some(main),
        Some(a) if a.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') && a.len() <= 64 => {
            let p = main.parent()?.join(main.file_stem()?).join("subagents").join(format!("agent-{a}.jsonl"));
            p.is_file().then_some(p)
        }
        Some(_) => None,
    }
}

/// `Some(stderr message)` = hold the task (exit 2).
pub(super) fn hook(input: &str, home: &Path) -> Option<String> {
    if !super::idle::enabled(home) {
        return None;
    }
    let v: Value = serde_json::from_str(input).ok()?;
    let (team, me) = who(&v)?;
    let task_id = v["task_id"].as_str().unwrap_or_default();
    let subject = v["task_subject"].as_str().unwrap_or_default();
    let label = if subject.is_empty() { format!("#{task_id}") } else { format!("#{task_id} ({subject})") };
    let edit = transcript(&v).and_then(|p| unchecked_edit(&tail(&p)));
    let is_dirty = edit.is_some() && v["cwd"].as_str().is_some_and(|c| dirty(Path::new(c)));
    let mem = super::idle::state_dir(home).join("mem").join(format!("task__{}__{}.json", super::idle::safe(&team), super::idle::safe(task_id)));
    let holds = super::idle::read_json(&mem).and_then(|m| m["holds"].as_u64()).unwrap_or(0) as u32;
    let (verdict, n) = decide(&label, edit.as_deref(), is_dirty, holds);
    match verdict {
        Verdict::Hold(msg) => {
            super::idle::write_json(&mem, &json!({ "holds": n, "reason": msg }));
            Some(msg)
        }
        Verdict::Pass => {
            if holds > 0 {
                // Held, then passed: one lesson worth keeping. The hook never writes KNOWLEDGE itself.
                super::idle::write_json(&learn_path(home, &team, &me), &json!({ "task": label, "holds": holds }));
                let _ = std::fs::remove_file(&mem);
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asst(tool: &str, input: Value) -> String {
        json!({ "type": "assistant", "message": { "content": [{ "type": "tool_use", "name": tool, "input": input }] } }).to_string()
    }

    #[test]
    fn an_edit_after_the_last_check_is_unchecked() {
        let edit = asst("Edit", json!({ "file_path": "/r/src/a.rs" }));
        let test = asst("Bash", json!({ "command": "nice -n 19 cargo test -p x -j2" }));
        let doc = asst("Write", json!({ "file_path": "/r/CHANGELOG.md" }));
        let other = asst("Bash", json!({ "command": "git diff --stat" }));
        assert_eq!(unchecked_edit(&[edit.clone(), other.clone()].join("\n")).as_deref(), Some("/r/src/a.rs"));
        assert_eq!(unchecked_edit(&[edit.clone(), test.clone()].join("\n")), None);
        assert_eq!(unchecked_edit(&[test.clone(), edit.clone()].join("\n")).as_deref(), Some("/r/src/a.rs"));
        assert_eq!(unchecked_edit(&[edit, test, doc].join("\n")), None, "docs need no check");
        for c in ["pnpm vitest run", "8sync ccc loop ev s C1 -- 'x'", "go vet ./...", "nice -n 19 ionice -c3 cargo test -j2", "cd x && FOO=1 pnpm run lint", "bash scripts/uat/no-idle-hook.sh", "npx tsc --noEmit", "8sync run test"] {
            assert!(is_check(c), "{c}");
        }
        for c in ["git status", "ls tests", "mkdir test", "git check-ignore x", "echo cargo test", "8sync ccc loop status"] {
            assert!(!is_check(c), "{c}");
        }
    }

    #[test]
    fn a_teammate_is_judged_by_its_own_transcript_or_passes() {
        let d = sandbox("agent");
        let main = d.join("abcd.jsonl");
        assert_eq!(transcript(&json!({ "transcript_path": main })), Some(main.clone()));
        let v = json!({ "transcript_path": main, "agent_id": "a07f" });
        assert_eq!(transcript(&v), None, "no agent transcript → pass, never the lead's edits");
        let own = d.join("abcd/subagents/agent-a07f.jsonl");
        std::fs::create_dir_all(own.parent().unwrap()).unwrap();
        std::fs::write(&own, "").unwrap();
        assert_eq!(transcript(&v), Some(own));
        assert_eq!(transcript(&json!({ "transcript_path": main, "agent_id": "../x" })), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn holds_twice_at_most_and_only_on_a_dirty_tree() {
        assert!(matches!(decide("#1", Some("a.rs"), true, 0), (Verdict::Hold(m), 1) if m.contains("a.rs")));
        assert!(matches!(decide("#1", Some("a.rs"), true, 1), (Verdict::Hold(_), 2)));
        assert_eq!(decide("#1", Some("a.rs"), true, 2), (Verdict::Pass, 2), "cap: never trap the agent");
        assert_eq!(decide("#1", Some("a.rs"), false, 0), (Verdict::Pass, 0), "committed work passes");
        assert_eq!(decide("#1", None, true, 0), (Verdict::Pass, 0));
    }

    fn sandbox(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-taskdone-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Both triggers (TaskUpdate by any agent; a teammate ending its turn with the task in
    /// progress) carry the same input shape; the teammate one names the teammate.
    #[test]
    fn hook_holds_then_passes_and_leaves_one_learning_nudge_for_both_triggers() {
        for (tag, teammate) in [("update", None), ("turn-end", Some("be"))] {
            let home = sandbox(&format!("{tag}-home"));
            crate::verbs::harness::cbm::write_flag_key(&home, super::super::idle::KEY, true).unwrap();
            let repo = sandbox(&format!("{tag}-repo"));
            let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&repo).output().unwrap().status.success(), "git {args:?}");
            git(&["init", "-q"]);
            std::fs::write(repo.join("a.rs"), "fn a() {}\n").unwrap();
            git(&["add", "a.rs"]);
            git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
            std::fs::write(repo.join("a.rs"), "fn a() { 1; }\n").unwrap();
            let tp = repo.join("t.jsonl");
            std::fs::write(&tp, asst("Edit", json!({ "file_path": repo.join("a.rs") }))).unwrap();
            let mut input = json!({ "hook_event_name": "TaskCompleted", "session_id": "abcdefgh-1", "transcript_path": tp, "cwd": repo, "task_id": "7", "task_subject": "fix a" });
            if let Some(t) = teammate {
                input["teammate_name"] = json!(t);
                input["team_name"] = json!("session-abcdefgh");
            }
            let me = teammate.unwrap_or("lead");
            let run = |input: &Value| hook(&input.to_string(), &home);
            let held = run(&input);
            assert!(held.as_deref().is_some_and(|m| m.contains("#7 (fix a)") && m.contains("a.rs")), "{tag}: {held:?}");
            assert!(!learn_path(&home, "session-abcdefgh", me).exists());
            // the agent runs the tests → passes, and one lesson is queued for its next idle
            let mut t = std::fs::read_to_string(&tp).unwrap();
            t.push('\n');
            t.push_str(&asst("Bash", json!({ "command": "cargo test" })));
            std::fs::write(&tp, t).unwrap();
            assert_eq!(run(&input), None, "{tag}");
            assert!(learn_path(&home, "session-abcdefgh", me).exists(), "{tag}: held then passed → learning nudge");
            // a task that passes straight away leaves nothing
            let _ = std::fs::remove_file(learn_path(&home, "session-abcdefgh", me));
            input["task_id"] = json!("8");
            assert_eq!(run(&input), None);
            assert!(!learn_path(&home, "session-abcdefgh", me).exists(), "{tag}: passed at once → no nudge");
            let _ = std::fs::remove_dir_all(&home);
            let _ = std::fs::remove_dir_all(&repo);
        }
    }
}
