//! `8sync ccc` — Claude Code CLI (`claude`) with named per-repo sessions plus the
//! 8sync kit: subagents, `/ship`, a native verify hook and a stop gate.
//!
//! Claude Code accepts a caller-chosen conversation UUID (`--session-id`) and
//! resumes by UUID (`--resume`), so `8sync ccc . <name>` maps names to UUIDs in
//! the registry `8sync forge` uses (`uuid_sessions`). The kit lands in the user
//! config dir (`~/.claude`), so it applies to every repo and every `claude` run.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Context, Result};
use clap::Args as ClapArgs;
use serde_json::{json, Value};

use crate::env_detect::Env;
use crate::verbs::uuid_sessions::{self, Store};
use crate::{assets, pkg, ui};

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync ccc . core               create-or-resume the Claude Code session 'core' in this repo
      8sync ccc . core -p \"...\"      one-shot prompt in 'core' (any extra flag goes to claude)
      8sync ccc .                    resume the last-used session (plain `claude` if none)
      8sync ccc . ls                 list sessions in this repo
      8sync ccc . new <name>         create a session (refuses an existing name)
      8sync ccc . rm <name>          remove a session and its transcript
      8sync ccc kit [--force]        install/refresh the 8sync kit in ~/.claude
      8sync ccc status               claude binary, login, kit, MCP and sessions

    THE KIT (installed by `8sync setup`; edited files are kept unless --force)
      agents   explore · plan · task · quick-task · reviewer · designer
      /ship    explore → plan → implement → review → commit
      verify   after every Edit/Write: cargo check · package typecheck/tsc · go vet;
               errors go back to Claude (`8sync ccc hook verify`, no python/jq/bash)
      gates    stop: a Haiku check keeps the turn going while work is visibly unfinished;
               ask: questions without a real need go back to Claude to decide itself
      also     auto permission mode · task list on every model · deny .env reads and
               force-push · codebase-memory-mcp + serena copied from omp's MCP config
"})]
pub struct Args {
    /// `.` then a session name, or a subcommand: `ls`, `new <name>`, `rm <name>`,
    /// `kit`, `status`. Flags after the name are passed to `claude`.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub rest: Vec<String>,
}

impl Args {
    /// Hook invocations run on every edit: keep them free of side work.
    pub fn is_hook(&self) -> bool {
        self.rest.first().is_some_and(|v| v == "hook")
    }
}

pub fn run(a: Args) -> Result<()> {
    // `8sync ccc . <name>`: the dot means "this repo"; `8sync ccc <name>` works too.
    let args = match a.rest.split_first() {
        Some((dot, rest)) if dot == "." => rest,
        _ => &a.rest[..],
    };
    let (verb, rest) = args.split_first().map(|(v, r)| (v.as_str(), r)).unwrap_or(("", &[][..]));
    if verb == "hook" {
        return hook(rest);
    }
    let env = Env::detect()?;
    let cwd = std::env::current_dir().context("no cwd")?;
    let root = crate::verbs::here::detect_project_root(&cwd).unwrap_or(cwd);
    match verb {
        "kit" => install_kit(&env, rest.iter().any(|a| a == "--force")),
        "status" => status(&env, &root),
        "ls" | "list" => {
            ui::header("8sync ccc sessions");
            ui::info(&format!("project: {}", root.display()));
            print_sessions(&sessions(&env, &root));
            Ok(())
        }
        "rm" => cmd_rm(&env, &root, rest.first().context("usage: 8sync ccc . rm <name>")?),
        "new" => {
            let name = rest.first().context("usage: 8sync ccc . new <name>")?;
            open(&env, &root, name, true, &rest[1..])
        }
        "" => match sessions(&env, &root).load().last_used {
            Some(name) => open(&env, &root, &name, false, &[]),
            None => launch(Command::new(ensure_claude()?).current_dir(&root)),
        },
        _ if verb.starts_with('-') => launch(Command::new(ensure_claude()?).args(args).current_dir(&root)),
        name => open(&env, &root, name, false, rest),
    }
}

fn sessions(env: &Env, root: &Path) -> Store {
    Store::new(env, root, "claude-sessions", "ccc .")
}

fn print_sessions(store: &Store) {
    let reg = store.load();
    if reg.sessions.is_empty() {
        ui::info("no sessions yet — create one with `8sync ccc . <name>`");
    } else {
        uuid_sessions::print(&reg);
    }
}

/// Create-or-resume `name`: a fresh session takes the registry UUID and the
/// name as its display title; once Claude Code has a transcript, resume by UUID.
fn open(env: &Env, root: &Path, name: &str, refuse_existing: bool, extra: &[String]) -> Result<()> {
    let s = sessions(env, root).touch(name, refuse_existing)?;
    let claude = ensure_claude()?;
    ui::info(&format!("claude · {} · {}", s.name, root.display()));
    let mut cmd = Command::new(claude);
    if transcripts(env, &s.conversation_id).next().is_some() {
        cmd.args(["--resume", &s.conversation_id]);
    } else {
        cmd.args(["--session-id", &s.conversation_id, "--name", &s.name]);
    }
    launch(cmd.args(extra).current_dir(root))
}

fn launch(cmd: &mut Command) -> Result<()> {
    let status = cmd.status().context("could not exec claude")?;
    if !status.success() {
        std::process::exit(status.code().unwrap_or(1));
    }
    Ok(())
}

fn cmd_rm(env: &Env, root: &Path, name: &str) -> Result<()> {
    let Some(s) = sessions(env, root).remove(name)? else {
        ui::warn(&format!("no session '{name}' found"));
        return Ok(());
    };
    for p in transcripts(env, &s.conversation_id) {
        let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
    }
    ui::ok(&format!("removed session '{name}' ({})", s.conversation_id));
    Ok(())
}

/// Claude Code's config dir: `$CLAUDE_CONFIG_DIR`, else `~/.claude`.
fn claude_dir(env: &Env) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| env.home.join(".claude"))
}

/// A session's stored files: `projects/<project>/<id>.jsonl` plus the
/// `<id>/` dir holding its subagent transcripts and spilled tool output.
fn transcripts(env: &Env, id: &str) -> impl Iterator<Item = PathBuf> {
    let jsonl = format!("{id}.jsonl");
    let id = id.to_string();
    std::fs::read_dir(claude_dir(env).join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(move |d| [d.path().join(&jsonl), d.path().join(&id)])
        .filter(|p| p.exists())
}

// ── claude binary ───────────────────────────────────────────────────────────

fn find_claude() -> Option<PathBuf> {
    which::which("claude").ok().or_else(|| {
        let p = dirs::home_dir()?.join(".local").join("bin").join(if cfg!(windows) { "claude.exe" } else { "claude" });
        p.exists().then_some(p)
    })
}

/// The installed `claude`, or install it with Anthropic's native installer
/// (`~/.local/bin/claude`, self-updating).
pub(crate) fn ensure_claude() -> Result<PathBuf> {
    if let Some(p) = find_claude() {
        return Ok(p);
    }
    ui::step("Claude Code (official installer → ~/.local/bin/claude)");
    if cfg!(windows) {
        pkg::run_loud(
            "powershell",
            &[
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$ProgressPreference='SilentlyContinue'; irm https://claude.ai/install.ps1 | iex",
            ],
        )?;
    } else {
        pkg::run_loud("sh", &["-c", "curl -fsSL https://claude.ai/install.sh | bash"])?;
    }
    find_claude().context("Claude Code installed but `claude` was not found in ~/.local/bin")
}

// ── the kit ─────────────────────────────────────────────────────────────────

/// Kit files under `assets/claude/`, installed at the same path in `~/.claude`.
const KIT_FILES: [&str; 7] = [
    "agents/explore.md",
    "agents/plan.md",
    "agents/task.md",
    "agents/quick-task.md",
    "agents/reviewer.md",
    "agents/designer.md",
    "skills/ship/SKILL.md",
];

/// Hashes of the files as 8sync last wrote them: a file whose current content
/// no longer matches was edited by the user and is left alone.
const KIT_STAMP: &str = ".8sync-kit.json";
const CLAUDE_MD_BEGIN: &str = "<!-- 8sync:kit:begin -->";
const CLAUDE_MD_END: &str = "<!-- 8sync:kit:end -->";

/// Rules merged into `permissions.deny` (`**/` covers monorepo sub-packages).
const DENY: [&str; 6] = [
    "Read(**/.env)",
    "Read(**/.env.*)",
    "Bash(git push --force*)",
    "Bash(git push -f*)",
    "Bash(git push * --force*)",
    "Bash(git push * -f*)",
];

/// Both gates' prompts start with this, which is how a re-merge finds them.
const GATE_MARKER: &str = "8sync gate";

/// The one bar for interrupting the user, shared by both gates. A checklist,
/// because Haiku given a prose rule refused credential and pricing questions.
const ASK_POLICY: &str = "QUESTION POLICY — check in order; the first match decides:\n\
1. Does it ask the user for a secret or access (password, API key, token, login, account)? → JUSTIFIED. \
Asking the owner for a secret is correct; never tell Claude to guess or skip it.\n\
2. Does it ask approval for something destructive, irreversible or paid (deleting data, dropping tables, \
production deploys or migrations, force-push, messaging people, spending money)? → JUSTIFIED.\n\
3. Does it ask the user to choose product or business direction (pricing, scope, features, UX direction, \
target users) where the options lead to materially different outcomes? → JUSTIFIED. Never decide business \
questions for the user.\n\
4. Anything else — facts Claude can find in the repo or with its tools, naming, wording, style, minor technical \
choices, or confirmation to continue routine work → NOT JUSTIFIED: Claude picks the conservative, conventional \
option, states the assumption and continues.";

/// Prompt hook on `Stop` (response schema `{ok, reason, impossible}`). It sees
/// the hook input — chiefly `last_assistant_message` — not the transcript.
const STOP_GATE: &str = "8sync gate: stop. Decide whether Claude may end this turn. Hook input: $ARGUMENTS\n\n\
Judge only from `last_assistant_message`, using the question policy at the end.\n\
Reply {\"ok\": true} when the work is done, when the message is a plain answer to the user, or when it ends with \
a JUSTIFIED question.\n\
Reply {\"ok\": false, \"reason\": \"<the concrete next step Claude should take>\"} when the message shows work \
Claude can still do itself: planned tasks left undone (\"next I will…\"), code edited but build/test not run \
since, a failing build/test/lint it has not fixed, a reviewer verdict NOT MERGEABLE, or a NOT JUSTIFIED question \
(then the reason names the option to pick).\n\
If `stop_hook_active` is true and the same item is still blocked on something only the user can provide, reply \
{\"ok\": false, \"impossible\": true, \"reason\": \"<why>\"}.\n\n";

/// Prompt hook on `PreToolUse` for `AskUserQuestion`: unjustified questions are
/// returned to Claude as a tool error (`continueOnBlock`), so it decides and goes on.
const ASK_GATE: &str = "8sync gate: ask. Claude wants to interrupt the user with AskUserQuestion. Hook input: \
$ARGUMENTS\n\nWalk the question policy below from rule 1 to rule 4 and stop at the first rule that matches.\n\
Rules 1, 2 or 3 → reply exactly {\"ok\": true}.\n\
Rule 4 only → reply {\"ok\": false, \"reason\": \"Don't ask: go with <the option you would pick> because \
<one-line why>; state that assumption and continue.\"}\n\n";

/// The ask gate fires only on AskUserQuestion, so it can afford Sonnet: with the
/// same prompt Haiku misjudged 2 of 6 labelled questions, Sonnet none. A hook
/// `model` must be a full id — an alias fails as `unrecognized_model` and the
/// hook then fails open (the question goes through).
const ASK_GATE_MODEL: &str = "claude-sonnet-5";

/// Install or refresh the kit in Claude Code's user config. Idempotent.
pub(crate) fn install_kit(env: &Env, force: bool) -> Result<()> {
    ui::step("Claude Code kit → ~/.claude (agents · /ship · verify hook · stop + ask gates)");
    let dir = claude_dir(env);
    let stamp_path = dir.join(KIT_STAMP);
    let mut stamps: BTreeMap<String, String> = std::fs::read_to_string(&stamp_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let mut kept = Vec::new();
    for rel in KIT_FILES {
        let body = assets::read(&format!("claude/{rel}")).with_context(|| format!("asset missing: claude/{rel}"))?;
        let target = dir.join(rel);
        match std::fs::read_to_string(&target) {
            Ok(cur) if cur == body => {}
            Ok(cur) if !force && stamps.get(rel) != Some(&fnv1a(&cur)) => {
                kept.push(rel);
                continue;
            }
            _ => {
                std::fs::create_dir_all(target.parent().unwrap_or(&dir))?;
                std::fs::write(&target, &body).with_context(|| format!("write {}", target.display()))?;
            }
        }
        stamps.insert(rel.to_string(), fnv1a(&body));
    }
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&stamp_path, serde_json::to_string_pretty(&stamps)?)?;
    for rel in &kept {
        ui::info(&format!("kept your edited {} (`8sync ccc kit --force` overwrites)", dir.join(rel).display()));
    }

    let rules = assets::read("claude/CLAUDE.md").context("asset missing: claude/CLAUDE.md")?;
    crate::verbs::harness::memory::upsert_block(&dir.join("CLAUDE.md"), CLAUDE_MD_BEGIN, CLAUDE_MD_END, rules.trim_end())?;

    let settings = dir.join("settings.json");
    let exe = hook_exe()?;
    let raw = std::fs::read_to_string(&settings).unwrap_or_default();
    let mut v: Value = if raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON — fix it, then `8sync ccc kit`", settings.display()))?
    };
    apply_kit_settings(&mut v, &exe)?;
    let out = serde_json::to_string_pretty(&v)? + "\n";
    if out != raw {
        std::fs::write(&settings, out).with_context(|| format!("write {}", settings.display()))?;
    }
    ui::ok(&format!(
        "kit: {} agents · /ship · verify hook · stop + ask gates · auto mode · CLAUDE.md rules ({})",
        KIT_FILES.len() - 1,
        dir.display()
    ));

    if let Some(claude) = find_claude() {
        mirror_mcp(env, &claude);
    } else {
        ui::info("MCP: run `8sync ccc kit` again after `claude` is installed to add codebase-memory-mcp + serena");
    }
    Ok(())
}

/// The 8sync binary the hooks call: the one on PATH (stable across `8sync up`),
/// else this process's own path.
fn hook_exe() -> Result<String> {
    let p = which::which(crate::brand::CMD).or_else(|_| std::env::current_exe()).context("locate the 8sync binary")?;
    Ok(p.display().to_string())
}

/// Merge the kit into a parsed `settings.json`, leaving everything else as is:
/// `env` + `defaultMode` defaults (a user value wins), `permissions.deny` rules,
/// and 8sync's hooks (replaced in place on re-run, so the file only changes when
/// the kit does).
fn apply_kit_settings(v: &mut Value, exe: &str) -> Result<()> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    if let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() {
        env.entry("CLAUDE_CODE_ENABLE_TODO_TOOLS").or_insert_with(|| json!("1"));
    }
    let Some(perms) = obj.entry("permissions").or_insert_with(|| json!({})).as_object_mut() else {
        bail!("settings.json `permissions` is not an object");
    };
    perms.entry("defaultMode").or_insert_with(|| json!("auto"));
    if let Some(deny) = perms.entry("deny").or_insert_with(|| json!([])).as_array_mut() {
        for rule in DENY {
            if !deny.iter().any(|r| r == rule) {
                deny.push(json!(rule));
            }
        }
    }
    let hooks = obj.entry("hooks").or_insert_with(|| json!({})).as_object_mut().context("settings.json `hooks` is not an object")?;
    upsert_hook_group(
        hooks,
        "PostToolUse",
        json!({
            "matcher": "Edit|Write|MultiEdit",
            "hooks": [{
                "type": "command",
                "command": exe,
                "args": ["ccc", "hook", "verify"],
                "timeout": 180,
                "statusMessage": "8sync verify"
            }]
        }),
    );
    upsert_hook_group(hooks, "Stop", json!({ "hooks": [{ "type": "prompt", "prompt": format!("{STOP_GATE}{ASK_POLICY}"), "timeout": 30 }] }));
    upsert_hook_group(
        hooks,
        "PreToolUse",
        json!({
            "matcher": "AskUserQuestion",
            "hooks": [{
                "type": "prompt",
                "prompt": format!("{ASK_GATE}{ASK_POLICY}"),
                "model": ASK_GATE_MODEL,
                "timeout": 30,
                "continueOnBlock": true
            }]
        }),
    );
    Ok(())
}

/// Replace 8sync's matcher group for `event` in place (or append it), dropping duplicates.
fn upsert_hook_group(hooks: &mut serde_json::Map<String, Value>, event: &str, group: Value) {
    let Some(groups) = hooks.entry(event).or_insert_with(|| json!([])).as_array_mut() else {
        return;
    };
    let ours = |g: &Value| {
        g["hooks"].as_array().is_some_and(|hs| {
            hs.iter().any(|h| {
                h["args"].as_array().is_some_and(|a| a.len() >= 2 && a[0] == "ccc" && a[1] == "hook")
                    || h["prompt"].as_str().is_some_and(|p| p.starts_with(GATE_MARKER))
            })
        })
    };
    match groups.iter().position(&ours) {
        Some(i) => {
            groups[i] = group;
            let mut seen = 0;
            groups.retain(|g| !(ours(g) && { seen += 1; seen > 1 }));
        }
        None => groups.push(group),
    }
}

/// Copy omp's code-intelligence MCP servers into Claude Code's user scope so
/// subagents get the same graph tools. Existing registrations are left alone.
fn mirror_mcp(env: &Env, claude: &Path) {
    let read = |p: PathBuf| -> Value {
        std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
    };
    let omp = read(env.home.join(".omp").join("agent").join("mcp.json"));
    let user = read(match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(d) => PathBuf::from(d).join(".claude.json"),
        None => env.home.join(".claude.json"),
    });
    for name in ["codebase-memory-mcp", "serena"] {
        let spec = &omp["mcpServers"][name];
        let Some(bin) = spec["command"].as_str() else { continue };
        if user["mcpServers"].get(name).is_some() {
            ui::skip(&format!("MCP {name}"), "already in Claude Code");
            continue;
        }
        if which::which(bin).is_err() {
            continue;
        }
        let added = Command::new(claude)
            .args(["mcp", "add-json", "--scope", "user", name, &spec.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if added {
            ui::ok(&format!("MCP {name} → Claude Code (user scope)"));
        } else {
            ui::warn(&format!("MCP {name}: `claude mcp add-json` failed"));
        }
    }
}

/// FNV-1a 64 — a stable content fingerprint for the kit stamp file.
fn fnv1a(s: &str) -> String {
    let h = s.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3));
    format!("{h:016x}")
}

// ── status ──────────────────────────────────────────────────────────────────

fn status(env: &Env, root: &Path) -> Result<()> {
    ui::header("8sync ccc — status");
    match find_claude() {
        Some(c) => {
            let ver = crate::env_detect::cmd_version(&c.display().to_string(), &["--version"]).unwrap_or_default();
            ui::ok(&format!("claude {ver} · {}", c.display()));
            let login = Command::new(&c).args(["auth", "status"]).stdin(Stdio::null()).output().ok();
            let auth = login
                .as_ref()
                .and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok())
                .and_then(|v| v["authMethod"].as_str().map(str::to_string));
            match auth.as_deref() {
                Some("none") | None => ui::warn("login: none — run `claude auth login` (or `--console` for API billing)"),
                Some(m) => ui::ok(&format!("login: {m}")),
            }
        }
        None => ui::warn("claude: not installed — `8sync ccc . <name>` installs it"),
    }
    let dir = claude_dir(env);
    let present = KIT_FILES.iter().filter(|r| dir.join(r).exists()).count();
    let settings = std::fs::read_to_string(dir.join("settings.json")).unwrap_or_default();
    let hooks = settings.contains("\"hook\"") && settings.contains(GATE_MARKER);
    if present == KIT_FILES.len() && hooks {
        ui::ok(&format!("kit: {present}/{} files · verify hook · stop + ask gates ({})", KIT_FILES.len(), dir.display()));
    } else {
        ui::warn(&format!("kit: {present}/{} files · hooks {} — run `8sync ccc kit`", KIT_FILES.len(), if hooks { "on" } else { "off" }));
    }
    println!();
    ui::info(&format!("sessions in {}:", root.display()));
    print_sessions(&sessions(env, root));
    Ok(())
}

// ── hooks ───────────────────────────────────────────────────────────────────

fn hook(rest: &[String]) -> Result<()> {
    match rest.first().map(String::as_str) {
        Some("verify") => {
            let mut input = String::new();
            let _ = std::io::stdin().read_to_string(&mut input);
            if let Some(out) = verify(&input) {
                println!("{out}");
            }
            Ok(())
        }
        _ => bail!("usage: 8sync ccc hook verify   (run by Claude Code's PostToolUse hook)"),
    }
}

/// A project check picked from the edited file's language and nearest manifest.
#[derive(Debug, PartialEq)]
struct Check {
    dir: PathBuf,
    program: String,
    args: Vec<&'static str>,
}

/// PostToolUse: run the check for the edited file and, only when it fails,
/// return the hook JSON that hands the error tail back to Claude.
fn verify(input: &str) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let file = Path::new(v.pointer("/tool_input/file_path")?.as_str()?);
    let check = plan_check(file)?;
    let out = Command::new(&check.program)
        .args(&check.args)
        .current_dir(&check.dir)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if out.status.success() {
        return None;
    }
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let text = strip_ansi(&text);
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail = lines[lines.len().saturating_sub(40)..].join("\n");
    let cmd = std::iter::once(check.program.as_str()).chain(check.args.iter().copied()).collect::<Vec<_>>().join(" ");
    Some(
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": format!(
                    "8sync verify: `{cmd}` failed in {} after editing {} — fix these before moving on:\n{tail}",
                    check.dir.display(),
                    file.display()
                )
            }
        })
        .to_string(),
    )
}

fn plan_check(file: &Path) -> Option<Check> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kit_settings_merge_keeps_user_config_and_is_idempotent() {
        let mut v = json!({
            "model": "opus",
            "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "0" },
            "permissions": { "deny": ["Read(**/.env)", "WebFetch"] },
            "hooks": {
                "PostToolUse": [
                    { "matcher": "Write", "hooks": [{ "type": "command", "command": "prettier" }] },
                    { "matcher": "Edit", "hooks": [{ "type": "command", "command": "/old/8sync", "args": ["ccc", "hook", "verify"] }] }
                ],
                "Stop": [{ "hooks": [{ "type": "prompt", "prompt": "8sync gate: stop. old wording" }] }]
            }
        });
        apply_kit_settings(&mut v, "/new/8sync").unwrap();
        let once = v.clone();
        apply_kit_settings(&mut v, "/new/8sync").unwrap();
        assert_eq!(v, once, "second merge must not change anything");

        assert_eq!(v["model"], "opus");
        assert_eq!(v["env"]["CLAUDE_CODE_ENABLE_TODO_TOOLS"], "0", "a user-set env value wins");
        let deny = v["permissions"]["deny"].as_array().unwrap();
        assert_eq!(deny.iter().filter(|r| *r == "Read(**/.env)").count(), 1);
        assert!(deny.iter().any(|r| r == "WebFetch") && deny.iter().any(|r| r == "Bash(git push -f*)"));

        let post = v["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post.len(), 2, "user hook kept, ours replaced in place");
        assert_eq!(post[0]["hooks"][0]["command"], "prettier");
        assert_eq!(post[1]["hooks"][0]["command"], "/new/8sync");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 1);
        assert_eq!(stop[0]["hooks"][0]["prompt"], format!("{STOP_GATE}{ASK_POLICY}"));
        assert_eq!(v["hooks"]["PreToolUse"].as_array().unwrap().len(), 1);
        assert_eq!(v["permissions"]["defaultMode"], "auto");
    }

    #[test]
    fn verify_picks_the_check_from_the_nearest_manifest() {
        let tmp = std::env::temp_dir().join(format!("8sync-ccc-{}", uuid_sessions::new_uuid()));
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
}
