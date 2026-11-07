//! `8sync ccc grade`: the external grader the `/solo` Router runs on a Worker's branch before a
//! merge. It never trusts what the Worker's worktree says: the Worker's diff (`base...head`) is
//! applied to a fresh detached worktree of `base` under the OS temp dir, and the checks run there.
//! A diff that edits the referee itself (tests, test config/setup, CI workflows, git hooks) is
//! REJECTED before anything runs, unless the goal named that path (`--allow`): reward hacking by
//! rewriting the test is the failure this gate exists for. Held-out checks are written by the
//! Router at planning time and never shown to the Worker.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const HELP: &str = "\
usage: 8sync ccc grade [--base <ref>] [--head <ref>] [--check <cmd>]... [--held-out <cmd>]...
                       [--allow <glob>]... [--keep] [--json]

Applies `git diff <base>...<head>` to a clean detached worktree of <base> (OS temp dir), then:
  REJECTED (exit 3)  the diff touches tests (tests/ test/ __tests__/, *.test.*, *.spec.*, *_test.*,
                     test_*.py), conftest.py, pytest/vitest/jest config or setup, .github/workflows/
                     or git hooks, and no --allow glob covers it; nothing is run
  FAIL     (exit 1)  a --check or --held-out command failed or ran over 20 min (stops at the first)
  PASS     (exit 0)  every --check, then every --held-out, exited 0
  ERROR    (exit 2)  bad ref, empty diff, the diff does not apply on <base>, git failed
Commands run one by one in the clean worktree (Windows `cmd /S /C`, else `sh -c`); the last 40
lines of a failing command are shown (secrets masked). The temp worktree is always removed
(`git worktree remove --force` + prune) unless --keep.
A fresh worktree has no node_modules/ or target/: each check installs what it needs.
--allow: `*` stays in one path segment, `**` crosses them; a glob without `/` matches the file name.

EXAMPLES
  8sync ccc grade --head solo/fix-x --check \"cargo test -p cli grade\" --held-out \"cargo build --release\"
  8sync ccc grade --head solo/ui --check \"pnpm install --frozen-lockfile && pnpm exec vitest run\"
  8sync ccc grade --head solo/t --allow \"apps/hq-ui/tests/**\" --check \"pnpm exec vitest run\"
  8sync ccc grade --base origin/main --head HEAD --check \"git status --short\" --json
";

/// How long one check may run.
const STEP_TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// Lines of output kept from a check.
const TAIL_LINES: usize = 40;
/// Bytes of output kept while a check runs (enough for 40 long lines, bounded for `cargo test`).
const TAIL_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Verdict {
    Pass,
    Fail,
    Rejected,
    Error,
}

impl Verdict {
    pub(super) fn key(self) -> &'static str {
        match self {
            Verdict::Pass => "PASS",
            Verdict::Fail => "FAIL",
            Verdict::Rejected => "REJECTED",
            Verdict::Error => "ERROR",
        }
    }

    pub(super) fn exit_code(self) -> i32 {
        match self {
            Verdict::Pass => 0,
            Verdict::Fail => 1,
            Verdict::Error => 2,
            Verdict::Rejected => 3,
        }
    }
}

/// Why a changed path is the referee rather than the work, or None for an ordinary path.
pub(super) fn offense(path: &str) -> Option<&'static str> {
    let lower = path.replace('\\', "/").to_lowercase();
    let segs: Vec<&str> = lower.split('/').filter(|s| !s.is_empty()).collect();
    let (&name, dirs) = segs.split_last()?;
    let stem = name.split('.').next().unwrap_or(name);
    if dirs.windows(2).any(|w| w == [".github", "workflows"]) {
        return Some("CI workflow");
    }
    if dirs.first().is_some_and(|f| matches!(*f, ".husky" | ".githooks")) || matches!(name, ".pre-commit-config.yaml" | "lefthook.yml" | "lefthook.yaml" | ".lefthook.yml" | ".lefthook.yaml") {
        return Some("git hook");
    }
    if name == "conftest.py" {
        return Some("pytest conftest");
    }
    if matches!(name, "pytest.ini" | ".pytest.ini" | "tox.ini") || name.starts_with("jest.") || name.starts_with("vitest.") || matches!(stem, "setuptests" | "setup-tests" | "test-setup" | "testsetup") {
        return Some("test config/setup");
    }
    let ext_cut = name.rsplit_once('.').map_or(name, |(s, _)| s);
    if dirs.iter().any(|d| matches!(*d, "tests" | "test" | "__tests__"))
        || name.contains(".test.")
        || name.contains(".spec.")
        || (name.contains('.') && ext_cut.ends_with("_test"))
        || (name.starts_with("test_") && name.ends_with(".py"))
    {
        return Some("test file");
    }
    None
}

/// `*` = any run inside one segment, `**` = any run across segments (`**/` may match none),
/// `?` = one non-`/` byte. Case-sensitive; patterns are short, so plain recursion is fine.
fn glob(p: &[u8], s: &[u8]) -> bool {
    match p {
        [] => s.is_empty(),
        [b'*', b'*', rest @ ..] => {
            let rest_noslash = rest.strip_prefix(b"/");
            (0..=s.len()).any(|i| glob(rest, &s[i..])) || rest_noslash.is_some_and(|r| glob(r, s))
        }
        [b'*', rest @ ..] => {
            let seg = s.iter().position(|&c| c == b'/').unwrap_or(s.len());
            (0..=seg).any(|i| glob(rest, &s[i..]))
        }
        [b'?', rest @ ..] => s.first().is_some_and(|&c| c != b'/') && glob(rest, &s[1..]),
        [c, rest @ ..] => s.first() == Some(c) && glob(rest, &s[1..]),
    }
}

/// An `--allow` glob covers `path` (whole path, or the file name for a glob without `/`).
pub(super) fn allowed(path: &str, allow: &[String]) -> bool {
    let path = path.replace('\\', "/");
    let name = path.rsplit('/').next().unwrap_or(&path);
    allow.iter().any(|g| {
        let g = g.replace('\\', "/");
        let g = g.trim_start_matches("./");
        glob(g.as_bytes(), path.as_bytes()) || (!g.contains('/') && glob(g.as_bytes(), name.as_bytes()))
    })
}

/// The offending paths of a diff with their reason, after `--allow`.
pub(super) fn offenders(paths: &[String], allow: &[String]) -> Vec<(String, &'static str)> {
    paths.iter().filter_map(|p| offense(p).filter(|_| !allowed(p, allow)).map(|why| (p.clone(), why))).collect()
}

#[derive(Debug, Default)]
struct Opts {
    base: String,
    head: String,
    checks: Vec<String>,
    held: Vec<String>,
    allow: Vec<String>,
    keep: bool,
    json: bool,
}

/// None = `-h` printed.
fn parse(rest: &[String]) -> Result<Option<Opts>> {
    let mut o = Opts { base: "origin/main".into(), head: "HEAD".into(), ..Opts::default() };
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        let mut val = || it.next().cloned().with_context(|| format!("{a} needs a value"));
        match a.as_str() {
            "--base" => o.base = val()?,
            "--head" => o.head = val()?,
            "--check" => o.checks.push(val()?),
            "--held-out" => o.held.push(val()?),
            "--allow" => o.allow.push(val()?),
            "--keep" => o.keep = true,
            "--json" => o.json = true,
            "-h" | "--help" => {
                print!("{HELP}");
                return Ok(None);
            }
            s => bail!("unknown argument `{s}` (8sync ccc grade -h)"),
        }
    }
    for r in [&o.base, &o.head] {
        if r.is_empty() || r.starts_with('-') {
            bail!("--base/--head need a git ref, not {r:?}");
        }
    }
    if o.checks.iter().chain(&o.held).any(|c| c.trim().is_empty()) {
        bail!("--check/--held-out need a command");
    }
    Ok(Some(o))
}

#[derive(Debug)]
struct Step {
    held: bool,
    cmd: String,
    code: Option<i32>,
    timed_out: bool,
    secs: f64,
    tail: String,
}

impl Step {
    fn ok(&self) -> bool {
        self.code == Some(0) && !self.timed_out
    }
}

#[derive(Debug)]
struct Report {
    verdict: Verdict,
    files: usize,
    offenders: Vec<(String, &'static str)>,
    steps: Vec<Step>,
    error: Option<String>,
    kept: Option<PathBuf>,
}

fn git(cwd: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env_remove("GIT_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::null())
        .output()
        .context("cannot run git")?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = err.trim();
        let verb = args.get(if args.first() == Some(&"-c") { 2 } else { 0 }).copied().unwrap_or("");
        bail!("git {verb}{}{err}", if err.is_empty() { " failed" } else { ": " });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// The temp worktree (and patch file); removed on drop unless kept.
struct Temp {
    top: PathBuf,
    dir: PathBuf,
    keep: bool,
}

impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.dir.with_extension("patch"));
        if self.keep {
            return;
        }
        let dir = self.dir.to_string_lossy();
        let _ = git(&self.top, &["worktree", "remove", "--force", &dir]);
        let _ = std::fs::remove_dir_all(&self.dir);
        let _ = git(&self.top, &["worktree", "prune"]);
    }
}

fn grade(o: &Opts, cwd: &Path) -> Report {
    let mut r = Report { verdict: Verdict::Error, files: 0, offenders: Vec::new(), steps: Vec::new(), error: None, kept: None };
    if let Err(e) = grade_into(o, cwd, &mut r) {
        r.verdict = Verdict::Error;
        r.error = Some(format!("{e:#}"));
    }
    r
}

fn grade_into(o: &Opts, cwd: &Path, r: &mut Report) -> Result<()> {
    let top = PathBuf::from(git(cwd, &["rev-parse", "--show-toplevel"]).context("not a git repo")?);
    let sha = |rf: &str| git(&top, &["rev-parse", "--verify", "-q", &format!("{rf}^{{commit}}")]).with_context(|| format!("no such commit: {rf}"));
    let (base, head) = (sha(&o.base)?, sha(&o.head)?);
    let range = format!("{base}...{head}");
    let names = git(&top, &["diff", "--name-only", "--no-renames", "-z", &range, "--"])?;
    let files: Vec<String> = names.split('\0').filter(|l| !l.is_empty()).map(str::to_owned).collect();
    r.files = files.len();
    if files.is_empty() {
        bail!("empty diff: {}...{} changes nothing", o.base, o.head);
    }
    // The referee check needs no worktree: nothing runs when the diff edits tests/CI/hooks.
    r.offenders = offenders(&files, &o.allow);
    if !r.offenders.is_empty() {
        r.verdict = Verdict::Rejected;
        return Ok(());
    }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    let dir = std::env::temp_dir().join(format!("8sync-grade-{}-{nanos:x}", std::process::id()));
    // Hooks off for our own git calls: a Worker could have dropped one into the shared .git/hooks.
    let no_hooks = format!("core.hooksPath={}", dir.with_extension("nohooks").display());
    let dir_s = dir.to_string_lossy().into_owned();
    // Guard first: a half-made worktree is removed too.
    let temp = Temp { top: top.clone(), dir: dir.clone(), keep: o.keep };
    git(&top, &["-c", &no_hooks, "worktree", "add", "--detach", "--quiet", &dir_s, &base])?;
    let patch = dir.with_extension("patch");
    let diff = Command::new("git")
        .args(["diff", "--binary", "--no-ext-diff", "--no-color", "--no-renames", &range, "--"])
        .current_dir(&top)
        .env_remove("GIT_DIR")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::null())
        .output()
        .context("cannot run git diff")?;
    if !diff.status.success() {
        bail!("git diff failed: {}", String::from_utf8_lossy(&diff.stderr).trim());
    }
    std::fs::write(&patch, &diff.stdout).context("write patch")?;
    git(&dir, &["-c", &no_hooks, "apply", "--index", "--whitespace=nowarn", &patch.to_string_lossy()]).context("the diff does not apply on base")?;
    if o.keep {
        r.kept = Some(dir.clone());
    }
    r.verdict = Verdict::Pass;
    for (held, cmd) in o.checks.iter().map(|c| (false, c)).chain(o.held.iter().map(|c| (true, c))) {
        let step = run_step(&dir, cmd, held, STEP_TIMEOUT)?;
        let ok = step.ok();
        r.steps.push(step);
        if !ok {
            r.verdict = Verdict::Fail;
            break;
        }
    }
    drop(temp);
    Ok(())
}

fn shell(cmd: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        // `/S /C "<cmd>"`: cmd strips exactly the outer quotes, the command keeps its own.
        c.args(["/D", "/S", "/C"]).raw_arg(format!("\"{cmd}\""));
        c
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let mut c = Command::new("sh");
        c.args(["-c", cmd]).process_group(0);
        c
    }
}

fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-KILL", &format!("-{}", child.id())]).stdin(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Keeps the last `TAIL_BYTES` of a byte stream.
fn push_tail(buf: &mut Vec<u8>, chunk: &[u8]) {
    buf.extend_from_slice(chunk);
    if buf.len() > TAIL_BYTES {
        buf.drain(..buf.len() - TAIL_BYTES);
    }
}

/// The last `n` lines of `bytes`, ANSI stripped, secrets masked.
fn tail_lines(bytes: &[u8], n: usize) -> String {
    let text = crate::verbs::mcp::strip_ansi(&String::from_utf8_lossy(bytes));
    let lines: Vec<&str> = text.lines().collect();
    crate::verbs::secret_mask::mask(&lines[lines.len().saturating_sub(n)..].join("\n"))
}

fn run_step(dir: &Path, cmd: &str, held: bool, timeout: Duration) -> Result<Step> {
    let (mut reader, writer) = std::io::pipe().context("pipe")?;
    let start = Instant::now();
    let mut child = {
        // Dropped right after spawn: our copies of the write end must close for EOF.
        let mut c = shell(cmd);
        c.current_dir(dir).env_remove("GIT_DIR").env_remove("GIT_INDEX_FILE").env_remove("GIT_WORK_TREE").stdin(Stdio::null()).stdout(writer.try_clone().context("pipe")?).stderr(writer);
        c.spawn().with_context(|| format!("cannot start `{cmd}`"))?
    };
    let buf = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&buf);
    let pump = std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(n) = reader.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if let Ok(mut b) = sink.lock() {
                push_tail(&mut b, &chunk[..n]);
            }
        }
    });
    let (code, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(s)) => break (s.code(), false),
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                kill_tree(&mut child);
                break (None, true);
            }
        }
    };
    // A grandchild may still hold the pipe; never wait on it forever.
    let until = Instant::now() + Duration::from_secs(2);
    while !pump.is_finished() && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(20));
    }
    let tail = buf.lock().map(|b| tail_lines(&b, TAIL_LINES)).unwrap_or_default();
    Ok(Step { held, cmd: cmd.to_string(), code, timed_out, secs: start.elapsed().as_secs_f64(), tail })
}

impl Report {
    fn json(&self, o: &Opts) -> Value {
        json!({
            "schema": 1,
            "verdict": self.verdict.key(),
            "exit": self.verdict.exit_code(),
            "base": o.base,
            "head": o.head,
            "files": self.files,
            "rejected": self.offenders.iter().map(|(p, w)| json!({"path": p, "why": w})).collect::<Vec<_>>(),
            "steps": self.steps.iter().map(|s| json!({
                "kind": if s.held { "held-out" } else { "check" },
                "cmd": s.cmd, "ok": s.ok(), "exit": s.code, "timed_out": s.timed_out,
                "secs": (s.secs * 10.0).round() / 10.0, "tail": if s.ok() { "" } else { s.tail.as_str() },
            })).collect::<Vec<_>>(),
            "error": self.error,
            "kept": self.kept.as_ref().map(|p| p.display().to_string()),
        })
    }

    fn text(&self, o: &Opts) -> String {
        let mut out = format!("grade: {} — {} file đổi, {}...{}\n", self.verdict.key(), self.files, o.base, o.head);
        for (p, why) in &self.offenders {
            out.push_str(&format!("  ✗ {why:<18}{p}\n"));
        }
        if !self.offenders.is_empty() {
            out.push_str("  diff sửa bộ chấm (test/CI/hook): không chạy check; chuyển Critic/owner duyệt, hoặc chạy lại với --allow <glob> khi mục tiêu nói tới path đó\n");
        }
        for s in &self.steps {
            let mark = if s.ok() { '✓' } else { '✗' };
            let how = match (s.timed_out, s.code) {
                (true, _) => format!("quá {} phút", STEP_TIMEOUT.as_secs() / 60),
                (false, Some(c)) => format!("exit {c}"),
                (false, None) => "bị kill".into(),
            };
            out.push_str(&format!("  {mark} {:<9}{} ({how}, {:.1} s)\n", if s.held { "held-out" } else { "check" }, s.cmd, s.secs));
            if !s.ok() && !s.tail.is_empty() {
                for l in s.tail.lines() {
                    out.push_str(&format!("      │ {l}\n"));
                }
            }
        }
        if let Some(e) = &self.error {
            out.push_str(&format!("  lỗi: {e}\n"));
        }
        if let Some(k) = &self.kept {
            out.push_str(&format!("  giữ worktree (--keep): {} — xoá: git worktree remove --force <dir>\n", k.display()));
        }
        out
    }
}

pub(super) fn run(rest: &[String], cwd: &Path) -> Result<()> {
    let o = match parse(rest) {
        Ok(Some(o)) => o,
        Ok(None) => return Ok(()),
        Err(e) => {
            eprintln!("8sync ccc grade: {e:#}");
            std::process::exit(Verdict::Error.exit_code());
        }
    };
    let r = grade(&o, cwd); // the temp worktree is gone (or kept) once this returns
    if o.json {
        println!("{}", r.json(&o));
    } else {
        print!("{}", r.text(&o));
    }
    match r.verdict {
        Verdict::Pass => Ok(()),
        v => std::process::exit(v.exit_code()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_each_referee_category_with_its_reason() {
        for (p, why) in [
            ("apps/hq-ui/tests/x.test.ts", "test file"),
            ("crates/cli/tests/cli.rs", "test file"),
            ("src/__tests__/a.js", "test file"),
            ("src/button.test.tsx", "test file"),
            ("src/api.spec.ts", "test file"),
            ("pkg/server_test.go", "test file"),
            ("app/test_models.py", "test file"),
            ("conftest.py", "pytest conftest"),
            ("backend/conftest.py", "pytest conftest"),
            ("pytest.ini", "test config/setup"),
            ("apps/web/vitest.config.ts", "test config/setup"),
            ("jest.config.js", "test config/setup"),
            ("vitest.setup.ts", "test config/setup"),
            ("src/setupTests.ts", "test config/setup"),
            (".github/workflows/ci.yml", "CI workflow"),
            (".husky/pre-commit", "git hook"),
            (".githooks/pre-push", "git hook"),
            (".pre-commit-config.yaml", "git hook"),
            ("lefthook.yml", "git hook"),
            ("APPS\\HQ-UI\\Tests\\X.TS", "test file"),
        ] {
            assert_eq!(offense(p), Some(why), "{p}");
        }
    }

    #[test]
    fn ordinary_source_and_look_alikes_pass() {
        for p in [
            "crates/cli/src/verbs/ccc/grade.rs",
            "apps/hq-ui/lib/server/office.ts",
            "src/latest.ts",
            "src/contest.py",
            "docs/testing.md",
            "src/attest_test",
            "src/hooks/useThing.ts",
            ".github/dependabot.yml",
            "CHANGELOG.md",
            "src/testimony.rs",
        ] {
            assert_eq!(offense(p), None, "{p}");
        }
    }

    #[test]
    fn allow_globs_override_only_what_they_cover() {
        let paths: Vec<String> = ["apps/hq-ui/tests/x.test.ts", "apps/hq-ui/tests/deep/y.test.ts", ".github/workflows/ci.yml", "src/a.rs"].map(String::from).to_vec();
        let all = offenders(&paths, &[]);
        assert_eq!(all.len(), 3);
        let left = offenders(&paths, &["apps/hq-ui/tests/**".into()]);
        assert_eq!(left, vec![(".github/workflows/ci.yml".to_string(), "CI workflow")]);
        // `*` stays in one segment: deep/ is not covered.
        let left = offenders(&paths, &["apps/hq-ui/tests/*".into(), ".github/workflows/ci.yml".into()]);
        assert_eq!(left, vec![("apps/hq-ui/tests/deep/y.test.ts".to_string(), "test file")]);
        // No `/` → matches the file name anywhere.
        assert!(offenders(&paths, &["*.test.ts".into(), "ci.yml".into()]).is_empty());
        assert!(allowed("a/b/c.ts", &["**/c.ts".into()]) && allowed("c.ts", &["**/c.ts".into()]) && !allowed("a/b/c.ts", &["a/*.ts".into()]));
    }

    #[test]
    fn verdicts_map_to_distinct_exit_codes() {
        let codes: Vec<i32> = [Verdict::Pass, Verdict::Fail, Verdict::Error, Verdict::Rejected].iter().map(|v| v.exit_code()).collect();
        assert_eq!(codes, vec![0, 1, 2, 3]);
        assert_eq!(Verdict::Rejected.key(), "REJECTED");
    }

    #[test]
    fn parse_defaults_repeats_and_rejections() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let o = parse(&a(&["--check", "a", "--check", "b", "--held-out", "c", "--allow", "x/**", "--keep"])).unwrap().unwrap();
        assert_eq!((o.base.as_str(), o.head.as_str()), ("origin/main", "HEAD"));
        assert_eq!((o.checks.len(), o.held.len(), o.allow.len(), o.keep, o.json), (2, 1, 1, true, false));
        assert!(parse(&a(&["--base", "--json"])).is_err());
        assert!(parse(&a(&["--check"])).is_err());
        assert!(parse(&a(&["--check", " "])).is_err());
        assert!(parse(&a(&["--frobnicate"])).is_err());
    }

    #[test]
    fn tail_keeps_the_last_lines_and_bounds_the_buffer() {
        let mut b = Vec::new();
        for i in 0..5000 {
            push_tail(&mut b, format!("line {i}\n").as_bytes());
        }
        assert!(b.len() <= TAIL_BYTES);
        let t = tail_lines(&b, 3);
        assert_eq!(t, "line 4997\nline 4998\nline 4999");
    }

    #[test]
    fn a_step_reports_exit_code_output_and_timeout() {
        let d = std::env::temp_dir();
        let ok = run_step(&d, "echo hi", false, Duration::from_secs(30)).unwrap();
        assert!(ok.ok() && ok.tail.contains("hi"), "{ok:?}");
        let bad = run_step(&d, "echo boom && exit 7", true, Duration::from_secs(30)).unwrap();
        assert_eq!((bad.code, bad.ok(), bad.tail.contains("boom")), (Some(7), false, true));
        let slow = if cfg!(windows) { "ping -n 30 127.0.0.1 >NUL" } else { "sleep 30" };
        let t = run_step(&d, slow, false, Duration::from_millis(300)).unwrap();
        assert!(t.timed_out && !t.ok() && t.secs < 10.0, "{t:?}");
    }
}
