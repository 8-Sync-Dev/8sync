//! `8sync ccc hook verify` / `hook verify-stop` — the project check behind the kit.
//!
//! PostToolUse runs `verify` with `asyncRewake`, so Claude keeps working while
//! the check runs; a failure exits 2 and Claude Code hands the error tail to
//! Claude as a reminder. One check per project runs at a time and the latest
//! edit wins: a check whose edit was superseded stands down, so a burst of
//! edits costs one check, not one each. Before Claude ends a turn,
//! `verify-stop` waits for a running check, reuses a current result or checks
//! once, and blocks the stop while the build is broken. Edits never wait for
//! the compiler; a turn never ends on a broken build.
use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// A project check picked from the edited file's language and nearest manifest.
#[derive(Debug, PartialEq)]
pub(super) struct Check {
    pub(super) dir: PathBuf,
    pub(super) program: String,
    pub(super) args: Vec<&'static str>,
}

impl Check {
    fn cmd(&self) -> String {
        std::iter::once(self.program.as_str()).chain(self.args.iter().copied()).collect::<Vec<_>>().join(" ")
    }

    /// `Err` carries the last 40 non-empty output lines. A check that cannot
    /// start (toolchain missing) passes: no signal beats a false alarm.
    fn run(&self) -> Result<(), String> {
        let Ok(out) = Command::new(&self.program).args(&self.args).current_dir(&self.dir).stdin(Stdio::null()).output() else {
            return Ok(());
        };
        if out.status.success() {
            return Ok(());
        }
        let text = strip_ansi(&format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)));
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        Err(lines[lines.len().saturating_sub(40)..].join("\n"))
    }
}

/// PostToolUse (async). Returns the process exit code: 2 reports a failure.
pub(super) fn post_tool_use(input: &str) -> i32 {
    let Ok(v) = serde_json::from_str::<Value>(input) else { return 0 };
    let Some(file) = v.pointer("/tool_input/file_path").and_then(Value::as_str).map(PathBuf::from) else { return 0 };
    let Some(check) = plan_check(&file) else { return 0 };
    if let Some(id) = v["session_id"].as_str() {
        note_session(id, &file, &check.dir);
    }
    let state = State::new(&check.dir);
    let token = state.bump();
    let Some(_lock) = state.lock(Some(&token)) else { return 0 };
    let outcome = check.run();
    if state.gen() != token {
        return 0; // a newer edit's check reports instead
    }
    state.record(&token, outcome.is_ok());
    match outcome {
        Ok(()) => 0,
        Err(tail) => {
            eprintln!(
                "8sync verify: `{}` failed in {} after editing {} — fix these before moving on:\n{tail}",
                check.cmd(),
                check.dir.display(),
                file.display()
            );
            2
        }
    }
}

/// Stop: `Some(hook JSON)` blocks the stop while a project this session
/// edited does not pass its check. One block per broken state: if Claude was
/// already shown these errors and made no edit since, it is leaving the build
/// broken on purpose (or cannot fix it), and blocking again would only loop
/// to Claude Code's cap of 8 continuations. With the build fine, the native
/// Stop gate (`gate`) gets its say.
/// The Stop-hook block carrying the owner's pending HQ messages for this session, if any.
fn owner_inbox(v: &Value, home: &Path) -> Option<String> {
    let msg = crate::verbs::hq::take_inbox(home, v["session_id"].as_str()?, v["cwd"].as_str().filter(|c| !c.is_empty()))?;
    Some(json!({ "decision": "block", "reason": msg }).to_string())
}

pub(super) fn stop(input: &str) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    // The owner's messages from `hq ui` first: delivered once (the file is consumed), so even a
    // second stop in a row (`stop_hook_active`) cannot loop on them.
    if let Some(out) = dirs::home_dir().and_then(|h| owner_inbox(&v, &h)) {
        return Some(out);
    }
    let edited = v["session_id"].as_str().and_then(|id| std::fs::read_to_string(session_file(id)).ok()).unwrap_or_default();
    let mut failures = Vec::new();
    for check in edited.lines().filter_map(|f| plan_check(Path::new(f))) {
        let state = State::new(&check.dir);
        let Some(_lock) = state.lock(None) else { continue };
        let gen = state.gen();
        if state.result() == Some((gen.clone(), true)) {
            continue;
        }
        let outcome = check.run();
        state.record(&gen, outcome.is_ok());
        if let Err(tail) = outcome {
            if std::fs::read_to_string(state.file("blocked")).is_ok_and(|g| g == gen) {
                continue;
            }
            let _ = std::fs::write(state.file("blocked"), &gen);
            failures.push(format!("`{}` in {}:\n{tail}", check.cmd(), check.dir.display()));
        }
    }
    let reason = if failures.is_empty() {
        super::gate::check(&v)?
    } else {
        format!("8sync verify: the build is broken — fix it before finishing.\n{}", failures.join("\n\n"))
    };
    Some(json!({ "decision": "block", "reason": reason }).to_string())
}

pub(super) fn plan_check(file: &Path) -> Option<Check> {
    let ext = file.extension()?.to_str()?;
    let up = |marker: &str| file.ancestors().skip(1).find(|d| d.join(marker).is_file()).map(Path::to_path_buf);
    match ext {
        "rs" => Some(Check { dir: up("Cargo.toml")?, program: "cargo".into(), args: vec!["check", "--quiet", "--message-format=short"] }),
        "go" => Some(Check { dir: up("go.mod")?, program: "go".into(), args: vec!["vet", "./..."] }),
        "ts" | "tsx" | "mts" | "cts" => {
            let dir = up("package.json")?;
            let pkg: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).ok()?).ok()?;
            if pkg["scripts"]["typecheck"].is_string() {
                let pm = package_manager(&dir);
                let program = which::which(pm).ok()?.display().to_string();
                return Some(Check { dir, program, args: vec!["run", "typecheck"] });
            }
            if !dir.join("tsconfig.json").is_file() {
                return None;
            }
            let tsc = if cfg!(windows) { "tsc.cmd" } else { "tsc" };
            let program = dir.ancestors().map(|d| d.join("node_modules").join(".bin").join(tsc)).find(|p| p.is_file())?;
            Some(Check { dir, program: program.display().to_string(), args: vec!["--noEmit"] })
        }
        _ => None,
    }
}

/// The package manager owning `dir`, from the nearest lockfile (monorepo root included).
fn package_manager(dir: &Path) -> &'static str {
    for d in dir.ancestors() {
        for (lock, pm) in [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lock", "bun"), ("bun.lockb", "bun"), ("package-lock.json", "npm")] {
            if d.join(lock).is_file() {
                return pm;
            }
        }
    }
    "npm"
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

// ── shared state (temp dir) ─────────────────────────────────────────────────

fn state_root() -> PathBuf {
    std::env::temp_dir().join("8sync-verify")
}

fn session_file(id: &str) -> PathBuf {
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    state_root().join(format!("session-{safe}"))
}

/// Remember one edited file per checked project for the session's Stop check.
fn note_session(id: &str, file: &Path, dir: &Path) {
    let path = session_file(id);
    let seen = std::fs::read_to_string(&path).unwrap_or_default();
    if seen.lines().filter_map(|f| plan_check(Path::new(f))).any(|c| c.dir == dir) {
        return;
    }
    let _ = std::fs::create_dir_all(state_root());
    let _ = std::fs::write(&path, format!("{seen}{}\n", file.display()));
}

/// A lock older than this belongs to a check that was killed (a `claude -p`
/// teardown, Ctrl+C); the next check takes it over.
const STALE: Duration = Duration::from_secs(180);

/// One project's check state: `gen` (latest edit's token), `lock`, `result`.
struct State {
    base: PathBuf,
}

struct Lock(PathBuf);

impl Drop for Lock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl State {
    fn new(dir: &Path) -> Self {
        let key = dir.display().to_string().bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3));
        let _ = std::fs::create_dir_all(state_root());
        Self { base: state_root().join(format!("{key:016x}")) }
    }

    fn file(&self, ext: &str) -> PathBuf {
        self.base.with_extension(ext)
    }

    fn gen(&self) -> String {
        std::fs::read_to_string(self.file("gen")).unwrap_or_default()
    }

    /// Mark a new latest edit; returns its token.
    fn bump(&self) -> String {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
        let token = format!("{}-{nanos}", std::process::id());
        let _ = std::fs::write(self.file("gen"), &token);
        token
    }

    /// Take the project's check lock, waiting while another check runs.
    /// With `token`, give up (`None`) as soon as a newer edit supersedes it.
    fn lock(&self, token: Option<&str>) -> Option<Lock> {
        let path = self.file("lock");
        let superseded = || token.is_some_and(|t| self.gen() != t);
        let deadline = Instant::now() + Duration::from_secs(600);
        loop {
            if superseded() {
                return None;
            }
            if OpenOptions::new().write(true).create_new(true).open(&path).is_ok() {
                let lock = Lock(path);
                return (!superseded()).then_some(lock);
            }
            let stale = std::fs::metadata(&path).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > STALE);
            if stale {
                let _ = std::fs::remove_file(&path);
            } else if Instant::now() > deadline {
                return None;
            } else {
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }

    fn record(&self, gen: &str, ok: bool) {
        let _ = std::fs::write(self.file("result"), format!("{gen}\n{}", if ok { "ok" } else { "fail" }));
    }

    fn result(&self) -> Option<(String, bool)> {
        let s = std::fs::read_to_string(self.file("result")).ok()?;
        let (gen, status) = s.split_once('\n')?;
        Some((gen.to_string(), status == "ok"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-verify-test-{tag}-{}", crate::verbs::uuid_sessions::new_uuid()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn picks_the_check_from_the_nearest_manifest() {
        let tmp = temp("plan");
        let crate_dir = tmp.join("crates").join("cli");
        std::fs::create_dir_all(crate_dir.join("src")).unwrap();
        std::fs::write(tmp.join("Cargo.toml"), "[workspace]").unwrap();
        std::fs::write(crate_dir.join("Cargo.toml"), "[package]").unwrap();
        let web = tmp.join("web");
        std::fs::create_dir_all(web.join("src")).unwrap();
        std::fs::write(web.join("package.json"), r#"{"scripts":{"build":"vite build"}}"#).unwrap();

        let rs = plan_check(&crate_dir.join("src").join("main.rs")).unwrap();
        assert_eq!(rs.dir, crate_dir, "member crate, not the workspace root");
        assert_eq!(rs.program, "cargo");
        assert_eq!(plan_check(&tmp.join("README.md")), None);
        assert_eq!(plan_check(&web.join("src").join("app.ts")), None, "no typecheck script, no tsconfig: skip");

        std::fs::write(tmp.join("pnpm-lock.yaml"), "").unwrap();
        assert_eq!(package_manager(&web), "pnpm", "monorepo root lockfile decides");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_check_superseded_by_a_newer_edit_stands_down() {
        let tmp = temp("gen");
        let state = State::new(&tmp);
        let older = state.bump();
        let newer = state.bump();
        assert!(state.lock(Some(&older)).is_none(), "older edit must not run a check");
        let held = state.lock(Some(&newer));
        assert!(held.is_some(), "latest edit runs");
        drop(held);
        assert!(state.lock(None).is_some(), "lock released on drop");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn stop_blocks_while_the_build_is_broken_and_passes_once_fixed() {
        let tmp = temp("stop");
        std::fs::create_dir_all(tmp.join("src")).unwrap();
        std::fs::write(tmp.join("Cargo.toml"), "[package]\nname = \"probe\"\nversion = \"0.1.0\"\nedition = \"2021\"\n").unwrap();
        let lib = tmp.join("src").join("lib.rs");
        std::fs::write(&lib, "pub fn f() -> u8 { \"text\" }\n").unwrap();
        let session = crate::verbs::uuid_sessions::new_uuid();
        let edit = json!({ "session_id": session, "tool_input": { "file_path": lib } }).to_string();
        let stop_input = json!({ "session_id": session }).to_string();

        assert_eq!(post_tool_use(&edit), 2, "the async check reports the type error");
        assert!(stop(&stop_input).is_some_and(|o| o.contains("\"block\"") && o.contains("E0308")));
        assert!(stop(&stop_input).is_none(), "same broken state, already shown: no second block (no 8× loop)");
        assert_eq!(post_tool_use(&edit), 2, "a new edit is a new state");
        assert!(stop(&stop_input).is_some(), "new broken state blocks again");

        std::fs::write(&lib, "pub fn f() -> u8 { 1 }\n").unwrap();
        assert_eq!(post_tool_use(&edit), 0);
        assert!(stop(&stop_input).is_none(), "fixed build: the turn may end");
        assert!(stop(&json!({ "session_id": "no-edits" }).to_string()).is_none(), "a session without edits never blocks");
        let _ = std::fs::remove_file(session_file(&session));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn stop_runs_the_native_gate_when_the_build_is_fine() {
        let plan = json!({ "session_id": "no-edits", "last_assistant_message": "Next I'll add the tests." }).to_string();
        assert!(stop(&plan).is_some_and(|o| o.contains("\"block\"") && o.contains("announces more work")));
        let done = json!({ "session_id": "no-edits", "last_assistant_message": "Done. All tests pass." }).to_string();
        assert!(stop(&done).is_none());
    }

    #[test]
    fn stop_hands_over_the_owner_inbox_even_on_a_second_stop() {
        let home = temp("inbox");
        let sid = "77cb0a68-ba5e-424e-bf43-15de95ed35fb";
        let f = crate::verbs::hq::inbox_file(&home, sid).unwrap();
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, "{\"ts\":1,\"text\":\"dừng lại, review PR #24\"}
").unwrap();
        let v = json!({ "session_id": sid, "stop_hook_active": true, "last_assistant_message": "Done." });
        let out = owner_inbox(&v, &home).unwrap();
        assert!(out.contains("\"block\"") && out.contains("review PR #24"), "{out}");
        assert!(owner_inbox(&v, &home).is_none(), "consumed: no loop");
        let _ = std::fs::remove_dir_all(&home);
    }
}
