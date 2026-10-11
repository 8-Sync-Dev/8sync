//! `8sync ccc` — Claude Code CLI (`claude`) with named per-repo sessions plus the
//! 8sync kit: subagents, skills, a native verify hook + guard, and stop/ask gates.
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
use crate::verbs::skill::deploy;
use crate::verbs::uuid_sessions::{self, Store};
use crate::verbs::selfup;
use crate::{assets, pkg, ui};

mod guard;
mod verify;

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

    EVERY LAUNCH (no network on the launch path; SUSYNC_NO_AUTO_UPDATE=1 skips the update)
      newer 8sync release → install + re-run · after an update: bundled skills + kit refresh ·
      git repo → harness: su-code/ memory, AGENTS.md/CLAUDE.md blocks, .claude/skills → su-code/skills

    THE KIT (installed by `8sync setup`; edited files are kept unless --force)
      rules    the 8 Sync Anthropic rules (aup-audit/8sync-anthropic-rules.md) load in every session
      agents   explore (haiku) · task · quick-task · reviewer · designer
      skills   /ship · /aup-audit · deep-research + every bundled 8sync skill (linked to ~/.omp/skills)
      verify   after every Edit/Write, in the background: cargo check · package typecheck/tsc · go vet;
               errors wake Claude; a turn cannot end on a broken build (`hook verify` / `verify-stop`)
      guard    before Bash/Edit/Write: no credential files, real secrets, `git add` of
               secrets, or Claude-subscription routing (`8sync ccc hook guard`)
      gates    stop: a Haiku check keeps the turn going while work is visibly unfinished;
               ask: questions without a real need go back to Claude to decide itself
      also     auto permission mode · medium effort · task list (each only if unset) · build/test
               commands skip the classifier · deny .env / keys / *.session / *.pkl and force-push ·
               codebase-memory-mcp + serena from omp's MCP config
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
            prepare(&env, &root);
            open(&env, &root, name, true, &rest[1..])
        }
        "" => {
            prepare(&env, &root);
            match sessions(&env, &root).load().last_used {
                Some(name) => open(&env, &root, &name, false, &[]),
                None => launch(Command::new(ensure_claude()?).current_dir(&root)),
            }
        }
        _ if verb.starts_with('-') => {
            prepare(&env, &root);
            launch(Command::new(ensure_claude()?).args(args).current_dir(&root))
        }
        name => {
            prepare(&env, &root);
            open(&env, &root, name, false, rest)
        }
    }
}

/// Every launch brings the environment up to date, with no network on the
/// critical path: a newer 8sync release (found by the 6-hourly background
/// probe) is installed and the launch re-runs on it; after an update the kit
/// and the bundled skills are refreshed; a git repo gets the 8sync harness.
/// Never blocks the launch — a failed step is reported and skipped.
/// `SUSYNC_NO_AUTO_UPDATE=1` keeps the installed binary.
fn prepare(env: &Env, root: &Path) {
    if std::env::var_os("SUSYNC_NO_AUTO_UPDATE").is_none() && selfup::update_cached() {
        if let Some(code) = update_and_rerun() {
            std::process::exit(code);
        }
    }
    if kit_version(env).as_deref() != Some(env!("CARGO_PKG_VERSION")) {
        if let Err(e) = deploy::install_bundled_global(env).and_then(|()| install_kit(env, false)) {
            ui::warn(&format!("kit refresh failed: {e:#} — `8sync ccc kit` retries"));
        }
    }
    if root.join(".git").exists() {
        if let Err(e) = project_harness(env, root) {
            ui::warn(&format!("project harness: {e:#} — `8sync harness` repairs it"));
        }
    }
}

/// Install the newer release, then run this same command on it. `None`: stay
/// on the current binary (the update failed or there was nothing to do).
fn update_and_rerun() -> Option<i32> {
    let exe = selfup::installed_path().ok()?;
    match selfup::run_self_update(false) {
        Ok(true) => {}
        Ok(false) => return None,
        Err(e) => {
            ui::warn(&format!("auto-update skipped: {e:#}"));
            return None;
        }
    }
    let status = Command::new(&exe).args(std::env::args_os().skip(1)).env("SUSYNC_NO_AUTO_UPDATE", "1").status().ok()?;
    Some(status.code().unwrap_or(1))
}

/// The repo side of the harness, the same files `8sync .` gives omp: the
/// su-code memory + AGENTS.md / CLAUDE.md blocks, every skill under
/// `su-code/skills/` (bundled ones vendored in when missing), `.claude/skills/`
/// linked to that tree, and on-demand skills listed by name only.
fn project_harness(env: &Env, root: &Path) -> Result<()> {
    deploy::vendor_missing_skills(&env.home, root)?;
    crate::verbs::here::seed_project_context(env, root, &crate::verbs::here::detect_stack(root))?;
    deploy::ensure_claude_skills(root)?;
    if deploy::claude_skills_is_ours(root) {
        crate::verbs::skill::inject::claude_skill_overrides(&env.home, root)?;
    }
    crate::verbs::harness::memory::seed_gitignore(root)
}

/// The 8sync version that last wrote the kit (`None` before any kit).
fn kit_version(env: &Env) -> Option<String> {
    let stamps: BTreeMap<String, String> = serde_json::from_str(&std::fs::read_to_string(claude_dir(env).join(KIT_STAMP)).ok()?).ok()?;
    stamps.get(KIT_VERSION_KEY).cloned()
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

/// Kit files: (asset path, path under Claude Code's config dir). The shared
/// skills come from omp's bundled tree, so both harnesses read one source.
const KIT_FILES: [(&str, &str); 11] = [
    ("claude/agents/explore.md", "agents/explore.md"),
    ("claude/agents/task.md", "agents/task.md"),
    ("claude/agents/quick-task.md", "agents/quick-task.md"),
    ("claude/agents/reviewer.md", "agents/reviewer.md"),
    ("claude/agents/designer.md", "agents/designer.md"),
    ("claude/skills/ship/SKILL.md", "skills/ship/SKILL.md"),
    ("skills/aup-audit/SKILL.md", "skills/aup-audit/SKILL.md"),
    ("skills/aup-audit/RULES.md", "skills/aup-audit/RULES.md"),
    // The org's rules, imported by the kit's CLAUDE.md block into every session.
    ("skills/aup-audit/8sync-anthropic-rules.md", "skills/aup-audit/8sync-anthropic-rules.md"),
    ("skills/deep-research/SKILL.md", "skills/deep-research/SKILL.md"),
    ("skills/deep-research/references/binary-weight-audit.md", "skills/deep-research/references/binary-weight-audit.md"),
];

/// Files an earlier kit installed and this one dropped: deleted while they are
/// still exactly what 8sync wrote (the `plan` agent: the main agent plans in
/// its own context instead of paying a second Opus context for it).
const RETIRED: [&str; 1] = ["agents/plan.md"];

/// Hashes of the files as 8sync last wrote them: a file whose current content
/// no longer matches was edited by the user and is left alone.
const KIT_STAMP: &str = ".8sync-kit.json";
/// Stamp entry holding the 8sync version that wrote the kit: a launch on a
/// newer binary refreshes the kit once.
const KIT_VERSION_KEY: &str = "8sync";
const CLAUDE_MD_BEGIN: &str = "<!-- 8sync:kit:begin -->";
const CLAUDE_MD_END: &str = "<!-- 8sync:kit:end -->";

/// Rules merged into `permissions.deny` (`**/` covers monorepo sub-packages).
/// Path rules only work as `Read(...)` / `Edit(...)`: Claude Code accepts a
/// `Write(...)` path rule but never consults it.
const DENY: [&str; 16] = [
    "Read(**/.env)",
    "Read(**/.env.*)",
    "Edit(**/.env)",
    "Edit(**/.env.*)",
    "Read(**/*.pem)",
    "Edit(**/*.pem)",
    "Read(**/id_rsa*)",
    "Read(**/id_ed25519*)",
    "Read(**/*.session)",
    "Edit(**/*.session)",
    "Read(**/*.pkl)",
    "Edit(**/*.pkl)",
    "Bash(git push --force*)",
    "Bash(git push -f*)",
    "Bash(git push * --force*)",
    "Bash(git push * -f*)",
];

/// Rules merged into `permissions.allow`: the build/test/lint commands the
/// verify hook already runs for these stacks, plus `git add` (the guard hook
/// still inspects it). In auto mode every non-read-only shell command
/// otherwise waits for a classifier review — measured ~0.65 s per
/// `cargo check` (5 runs: 14.9 s auto, 12.0 s with an allow rule, 11.4 s
/// bypass). Narrow prefixes only: Claude Code matches each part of a compound
/// command (`&&`, `;`, `|`) separately; commits, pushes and anything that
/// discards work stay reviewed.
const ALLOW: [&str; 15] = [
    "Bash(cargo check*)",
    "Bash(cargo build*)",
    "Bash(cargo test*)",
    "Bash(cargo clippy*)",
    "Bash(cargo fmt*)",
    "Bash(cargo nextest*)",
    "Bash(go build*)",
    "Bash(go test*)",
    "Bash(go vet*)",
    "Bash(npx tsc*)",
    "Bash(npm test*)",
    "Bash(pnpm test*)",
    "Bash(pnpm typecheck*)",
    "Bash(bun test*)",
    "Bash(git add*)",
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
    ui::step("Claude Code kit → ~/.claude (agents · skills · verify hook · guard · stop + ask gates)");
    let dir = claude_dir(env);
    let stamp_path = dir.join(KIT_STAMP);
    let mut stamps: BTreeMap<String, String> = std::fs::read_to_string(&stamp_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let mut kept = Vec::new();
    for (asset, rel) in KIT_FILES {
        let body = assets::read(asset).with_context(|| format!("asset missing: {asset}"))?;
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
    for rel in RETIRED {
        let target = dir.join(rel);
        match std::fs::read_to_string(&target) {
            Ok(cur) if stamps.get(rel) == Some(&fnv1a(&cur)) => {
                std::fs::remove_file(&target).with_context(|| format!("remove {}", target.display()))?;
                ui::ok(&format!("removed retired {}", target.display()));
            }
            Ok(_) if stamps.contains_key(rel) => ui::info(&format!("kept your edited {} (no longer part of the kit)", target.display())),
            _ => {}
        }
        stamps.remove(rel);
    }
    stamps.insert(KIT_VERSION_KEY.to_string(), env!("CARGO_PKG_VERSION").to_string());
    std::fs::create_dir_all(&dir)?;
    std::fs::write(&stamp_path, serde_json::to_string_pretty(&stamps)?)?;
    match deploy::link_bundled_skills(&env.home, &dir.join("skills")) {
        Ok(0) => {}
        Ok(n) => ui::ok(&format!("{n} bundled skill(s) linked → {} (always the current ~/.omp/skills copy)", dir.join("skills").display())),
        Err(e) => ui::warn(&format!("bundled skills not linked into Claude Code: {e:#}")),
    }
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
    let agents = KIT_FILES.iter().filter(|(_, rel)| rel.starts_with("agents/")).count();
    ui::ok(&format!(
        "kit: {agents} agents · /ship · /aup-audit · deep-research · verify hook · guard · stop + ask gates · auto mode · CLAUDE.md rules ({})",
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
/// `env`, `defaultMode` and `effortLevel` defaults (a user value wins),
/// `permissions` rules, and 8sync's hooks (replaced in place on re-run, so the
/// file only changes when the kit does).
fn apply_kit_settings(v: &mut Value, exe: &str) -> Result<()> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    if let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() {
        env.entry("CLAUDE_CODE_ENABLE_TODO_TOOLS").or_insert_with(|| json!("1"));
    }
    // Sonnet 5 / Opus 5 default to `high`; Opus 5.5 already runs at `medium` and
    // ignores this key. On the calc bench (Sonnet 5, 11 hidden tests) `medium`
    // passed 11/11 in 100 and 161 s (9.4k / 15.3k output tokens) vs 179-209 s
    // and 17.6-20.6k at `high` (omp: 124-155 s). `/effort high` for hard reasoning.
    obj.entry("effortLevel").or_insert_with(|| json!("medium"));
    let Some(perms) = obj.entry("permissions").or_insert_with(|| json!({})).as_object_mut() else {
        bail!("settings.json `permissions` is not an object");
    };
    perms.entry("defaultMode").or_insert_with(|| json!("auto"));
    for (key, rules) in [("deny", &DENY[..]), ("allow", &ALLOW[..])] {
        if let Some(list) = perms.entry(key).or_insert_with(|| json!([])).as_array_mut() {
            for rule in rules {
                if !list.iter().any(|r| r == rule) {
                    list.push(json!(rule));
                }
            }
        }
    }
    let hooks = obj.entry("hooks").or_insert_with(|| json!({})).as_object_mut().context("settings.json `hooks` is not an object")?;
    // Async: edits never wait for the compiler. Latest edit wins; a failure
    // wakes Claude (exit 2). `verify-stop` keeps a turn from ending broken.
    upsert_hook_group(
        hooks,
        "PostToolUse",
        json!({
            "matcher": "Edit|Write|MultiEdit",
            "hooks": [{
                "type": "command",
                "command": exe,
                "args": ["ccc", "hook", "verify"],
                "asyncRewake": true,
                "timeout": 600
            }]
        }),
    );
    upsert_hook_group(hooks, "Stop", json!({ "hooks": [{ "type": "prompt", "prompt": format!("{STOP_GATE}{ASK_POLICY}"), "timeout": 30 }] }));
    upsert_hook_group(
        hooks,
        "Stop",
        json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "verify-stop"], "timeout": 600 }] }),
    );
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
    upsert_hook_group(
        hooks,
        "PreToolUse",
        json!({
            "matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit",
            "hooks": [{
                "type": "command",
                "command": exe,
                "args": ["ccc", "hook", "guard"],
                "timeout": 30
            }]
        }),
    );
    Ok(())
}

/// Which 8sync hook a matcher group carries: `hook verify` / `hook guard` for
/// the native commands, the first sentence of a gate prompt (`8sync gate: stop`).
fn hook_role(g: &Value) -> Option<String> {
    g["hooks"].as_array()?.iter().find_map(|h| {
        if let Some(a) = h["args"].as_array().filter(|a| a.len() >= 3 && a[0] == "ccc" && a[1] == "hook") {
            return a[2].as_str().map(|r| format!("hook {r}"));
        }
        let p = h["prompt"].as_str().filter(|p| p.starts_with(GATE_MARKER))?;
        Some(p.split('.').next().unwrap_or(p).to_string())
    })
}

/// Replace 8sync's group with the same role for `event` in place (or append
/// it), dropping duplicates; user groups are never touched.
fn upsert_hook_group(hooks: &mut serde_json::Map<String, Value>, event: &str, group: Value) {
    let Some(groups) = hooks.entry(event).or_insert_with(|| json!([])).as_array_mut() else {
        return;
    };
    let role = hook_role(&group);
    let ours = |g: &Value| role.is_some() && hook_role(g) == role;
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
    let present = KIT_FILES.iter().filter(|(_, r)| dir.join(r).exists()).count();
    let settings = std::fs::read_to_string(dir.join("settings.json")).unwrap_or_default();
    let hooks = settings.contains("\"verify\"") && settings.contains("\"guard\"") && settings.contains(GATE_MARKER);
    if present == KIT_FILES.len() && hooks {
        ui::ok(&format!("kit: {present}/{} files · verify hook · guard · stop + ask gates ({})", KIT_FILES.len(), dir.display()));
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
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let out = match rest.first().map(String::as_str) {
        // Async (asyncRewake): exit code 2 + stderr is how a failure reaches Claude.
        Some("verify") => std::process::exit(verify::post_tool_use(&input)),
        Some("verify-stop") => verify::stop(&input),
        Some("guard") => guard::check(&input),
        _ => bail!("usage: 8sync ccc hook verify|verify-stop|guard   (run by the kit's Claude Code hooks)"),
    };
    if let Some(out) = out {
        println!("{out}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kit_settings_merge_keeps_user_config_and_is_idempotent() {
        let mut v = json!({
            "model": "opus",
            "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "0" },
            "permissions": { "deny": ["Read(**/.env)", "WebFetch"], "allow": ["Bash(make*)"] },
            "hooks": {
                "PostToolUse": [
                    { "matcher": "Write", "hooks": [{ "type": "command", "command": "prettier" }] },
                    { "matcher": "Edit", "hooks": [{ "type": "command", "command": "/old/8sync", "args": ["ccc", "hook", "verify"] }] }
                ],
                "Stop": [{ "hooks": [{ "type": "prompt", "prompt": "8sync gate: stop. old wording" }] }],
                "PreToolUse": [
                    { "matcher": "AskUserQuestion", "hooks": [{ "type": "prompt", "prompt": "8sync gate: ask. old wording" }] },
                    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "my-linter" }] }
                ]
            }
        });
        apply_kit_settings(&mut v, "/new/8sync").unwrap();
        let once = v.clone();
        apply_kit_settings(&mut v, "/new/8sync").unwrap();
        assert_eq!(v, once, "second merge must not change anything");

        assert_eq!(v["model"], "opus");
        assert_eq!(v["effortLevel"], "medium", "effort defaults to medium when unset");
        let mut mine = json!({ "effortLevel": "xhigh" });
        apply_kit_settings(&mut mine, "/new/8sync").unwrap();
        assert_eq!(mine["effortLevel"], "xhigh", "a user-set effort wins");
        assert_eq!(v["env"]["CLAUDE_CODE_ENABLE_TODO_TOOLS"], "0", "a user-set env value wins");
        let deny = v["permissions"]["deny"].as_array().unwrap();
        assert_eq!(deny.iter().filter(|r| *r == "Read(**/.env)").count(), 1);
        assert!(deny.iter().any(|r| r == "WebFetch") && deny.iter().any(|r| r == "Bash(git push -f*)"));

        let post = v["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post.len(), 2, "user hook kept, ours replaced in place");
        assert_eq!(post[0]["hooks"][0]["command"], "prettier");
        assert_eq!(post[1]["hooks"][0]["command"], "/new/8sync");
        assert_eq!(post[1]["hooks"][0]["asyncRewake"], true, "edits never wait for the check");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "stop gate replaced in place, verify-stop appended");
        assert_eq!(stop[0]["hooks"][0]["prompt"], format!("{STOP_GATE}{ASK_POLICY}"));
        assert_eq!(stop[1]["hooks"][0]["args"], json!(["ccc", "hook", "verify-stop"]));
        let allow = v["permissions"]["allow"].as_array().unwrap();
        assert!(allow.iter().any(|r| r == "Bash(make*)") && allow.iter().any(|r| r == "Bash(cargo check*)"));
        assert!(!allow.iter().any(|r| r.as_str().is_some_and(|s| s.contains("git push"))), "pushes stay reviewed");
        let pre = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 3, "ask gate replaced in place, user hook kept, guard appended");
        assert_eq!(pre[0]["hooks"][0]["prompt"], format!("{ASK_GATE}{ASK_POLICY}"));
        assert_eq!(pre[1]["hooks"][0]["command"], "my-linter");
        assert_eq!(pre[2]["hooks"][0]["args"], json!(["ccc", "hook", "guard"]));
        assert!(deny.iter().any(|r| r == "Edit(**/.env)") && !deny.iter().any(|r| r.as_str().is_some_and(|s| s.starts_with("Write("))));
        assert_eq!(v["permissions"]["defaultMode"], "auto");
    }
}
