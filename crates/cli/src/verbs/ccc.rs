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
use crate::verbs::uuid_sessions::Store;
use crate::verbs::selfup;
use crate::{assets, pkg, ui};

mod danger;
mod gate;
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
      8sync ccc . <name> --team      same session with Claude Code agent teams on (lead + teammates; interactive)
      8sync ccc . <name> --team --panes   teammates as tmux split panes (run inside tmux)
      8sync ccc kit [--force]        install/refresh the 8sync kit in ~/.claude
      8sync ccc kit --remove         take 8sync's hooks out of ~/.claude/settings.json (run before uninstalling)
      8sync ccc status               claude binary, login, kit, managed settings, MCP and sessions
      8sync ccc policy [--org-uuid <uuid>] [--out <file>] [--strict-hooks] [--lock-mcp]
                                     print a recommended managed-settings.json (never installs it)

    EVERY LAUNCH (no network on the launch path; SUSYNC_NO_AUTO_UPDATE=1 skips the update)
      newer 8sync release → install + re-run · after an update: bundled skills + kit refresh ·
      git repo → harness: su-code/ memory, AGENTS.md/CLAUDE.md blocks, .claude/skills → su-code/skills

    THE KIT (installed by `8sync setup`; edited files are kept unless --force)
      rules    a short 8 Sync/Anthropic rules block in every session; full text (aup-audit/8sync-anthropic-rules.md)
               opens on demand through /rules
      agents   explore (haiku) · task · quick-task · reviewer · designer · verifier · researcher ·
               pm (team lead) · architect (opus, writes docs/ADR/RFC only) · qa (tests only)
      skills   /ship · /rules (is X allowed?) · /aup-audit (repo vs Usage Policy) · /sec (secrets, deps, OWASP) ·
               /harden (Claude Code security posture) · deep-research + every bundled 8sync skill (linked to ~/.omp/skills)
      policy   `8sync ccc policy` prints org managed settings (bypass off, deny rules, login pinned to your
               claude.ai org, marketplace allowlist, opt-in MCP allowlist, sandbox, channels); you install it with sudo
      verify   after every Edit/Write, in the background: cargo check · package typecheck/tsc · go vet;
               errors wake Claude; a turn cannot end on a broken build (`hook verify` / `verify-stop`)
      guard    before Bash/PowerShell/Edit/Write: no credential files, real secrets, `git add` of
               secrets, Claude-subscription routing, deleting root/home/the project, disk wipes or
               force-push; deletes outside the project, `git reset --hard`, `git clean -f` ask first
      gates    stop (native, no model call): a turn that announces more work or asks to go ahead with
               routine work continues; ask: questions without a real need go back to Claude to decide
      session  SessionStart digest of su-code/STATE.md + recent failure/validated notes (<= 6 KB,
               stable for the prompt cache); non-core bundled skills load name-only (skillOverrides)
      hq hooks TaskCreated/TaskCompleted/TeammateIdle/Notification → `8sync hq hook <Event>`, async
               (no-op until `8sync hq setup`)
      also     auto permission mode · medium effort · task list · claude.ai connectors off (each only
               if unset) · build/test commands skip the classifier · deny .env / keys / *.session / *.pkl and force-push ·
               codebase-memory-mcp + serena from omp's MCP config when their command is on PATH
               (serena alwaysLoad=false; failures are reported)
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
        "kit" if rest.iter().any(|a| a == "--remove") => remove_kit_hooks(&env),
        "kit" => install_kit(&env, rest.iter().any(|a| a == "--force")),
        "status" => status(&env, &root),
        "policy" => policy(rest),
        "ls" | "list" => {
            print_sessions(&env, &root, rest.iter().any(|a| a == "--json"))
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
        _ if verb.starts_with('-') && args.iter().any(|a| a == "--team" || a == "--panes") => {
            prepare(&env, &root);
            match sessions(&env, &root).load().last_used {
                Some(name) => open(&env, &root, &name, false, args),
                None => bail!("no session in this repo yet: start one with `8sync ccc . <name> --team`"),
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

/// `8sync ccc . ls`: per session — running?, last request, last action, task
/// progress (rendering shared with `8sync . ls` in `session_view.rs`).
fn print_sessions(env: &Env, root: &Path, json: bool) -> Result<()> {
    use super::session_view as view;
    let reg = sessions(env, root).load();
    let rows = view::uuid_rows(env, "ccc", &reg, &view::agent_cmdlines(), false);
    debug_assert_eq!(rows.len(), reg.sessions.len(), "one row per registry entry (zip below)");
    if json {
        let arr: Vec<Value> = rows
            .iter()
            .zip(&reg.sessions)
            .map(|(r, s)| {
                let mut v = view::row_json(r);
                v["id"] = json!(s.conversation_id);
                v
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&arr)?);
        return Ok(());
    }
    if rows.is_empty() {
        ui::info("no sessions yet — create one with `8sync ccc . <name>`");
        return Ok(());
    }
    ui::header(&format!("Claude Code sessions · {}", root.display()));
    let (now, width, color) = (view::now_secs(), view::term_width(), view::use_color());
    for r in &rows {
        for l in view::render(r, width, now, color) {
            println!("{l}");
        }
    }
    println!("\n  8sync ccc . <name> resume  ·  8sync ccc . new <name>  ·  8sync show <name> --engine ccc  ·  8sync ls --all");
    Ok(())
}

/// 8sync's own flags on `ccc . <name>`: `--team` turns on Claude Code agent teams for
/// this launch only (env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, never written to a
/// settings file), `--panes` shows teammates as tmux split panes (`teammateMode`).
/// https://code.claude.com/docs/en/agent-teams — interactive only: `-p` spawns no teammates.
fn team_flags(extra: &[String]) -> Result<(bool, bool, Vec<String>)> {
    let team = extra.iter().any(|a| a == "--team");
    let panes = extra.iter().any(|a| a == "--panes");
    let rest: Vec<String> = extra.iter().filter(|a| *a != "--team" && *a != "--panes").cloned().collect();
    // Any short-option cluster containing `p` (`-pc`, also `-xp`) counts as print:
    // refusing too much is the safe direction for an interactive-only feature.
    let is_print = |a: &String| {
        a == "--print" || a.starts_with("--print=") || (a.starts_with('-') && !a.starts_with("--") && a.contains('p'))
    };
    if (team || panes) && rest.iter().any(is_print) {
        bail!("--team needs an interactive session: Claude Code spawns no teammates with -p/--print");
    }
    Ok((team || panes, panes, rest))
}

/// Create-or-resume `name`: a fresh session takes the registry UUID and the
/// name as its display title; once Claude Code has a transcript, resume by UUID.
fn open(env: &Env, root: &Path, name: &str, refuse_existing: bool, extra: &[String]) -> Result<()> {
    let (team, panes, extra) = team_flags(extra)?;
    let extra = &extra[..];
    let s = sessions(env, root).touch(name, refuse_existing)?;
    let claude = ensure_claude()?;
    ui::info(&format!("claude · {} · {}", s.name, root.display()));
    let mut cmd = Command::new(claude);
    if team {
        cmd.env("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1");
        if panes && std::env::var_os("TMUX").is_some() {
            cmd.args(["--settings", r#"{"teammateMode":"tmux"}"#]);
        } else if panes {
            ui::warn("--panes needs tmux (run inside a tmux session); teammates stay in-process");
        }
        ui::info("agent team on · ask the lead e.g. \"spawn 3 teammates: backend (agent task), qa (agent qa), reviewer (agent reviewer); each owns different files\"");
        ui::info("teammates: ↑/↓ select · Enter open/message · x stop · Ctrl+T task list · 3–5 teammates; cost grows per teammate");
    }
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
const KIT_FILES: [(&str, &str); 19] = [
    ("claude/agents/explore.md", "agents/explore.md"),
    ("claude/agents/task.md", "agents/task.md"),
    ("claude/agents/quick-task.md", "agents/quick-task.md"),
    ("claude/agents/reviewer.md", "agents/reviewer.md"),
    ("claude/agents/designer.md", "agents/designer.md"),
    ("claude/agents/verifier.md", "agents/verifier.md"),
    ("claude/agents/researcher.md", "agents/researcher.md"),
    ("claude/agents/pm.md", "agents/pm.md"),
    ("claude/agents/architect.md", "agents/architect.md"),
    ("claude/agents/qa.md", "agents/qa.md"),
    ("claude/skills/ship/SKILL.md", "skills/ship/SKILL.md"),
    ("claude/skills/rules/SKILL.md", "skills/rules/SKILL.md"),
    ("claude/skills/sec/SKILL.md", "skills/sec/SKILL.md"),
    ("claude/skills/harden/SKILL.md", "skills/harden/SKILL.md"),
    ("skills/aup-audit/SKILL.md", "skills/aup-audit/SKILL.md"),
    ("skills/aup-audit/RULES.md", "skills/aup-audit/RULES.md"),
    // The org's rules: summarised in the kit's CLAUDE.md block, full text opened on demand (/aup-audit).
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

/// The ask gate's prompt starts with this, which is how a re-merge finds it.
const GATE_MARKER: &str = "8sync gate";

/// The bar for interrupting the user. A checklist, because Haiku given a prose
/// rule refused credential and pricing questions. The native Stop gate
/// (`gate.rs`) applies the same bar to a turn's last line.
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

/// Hook roles earlier kits installed and this one dropped: (event, role). The
/// Haiku `Stop` prompt gate re-sent the whole transcript at every turn end
/// (~2.6 s and ~30k Haiku tokens per turn end, ~48k per bench run); `verify-stop` now runs the gate natively.
const RETIRED_HOOKS: [(&str, &str); 1] = [("Stop", "8sync gate: stop")];

/// Hook-matcher for the guard: Windows without Git Bash only has `PowerShell`,
/// whose commands no `Bash(...)` rule or `Bash` matcher sees.
const GUARD_MATCHER: &str = "Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit";
/// Prompt hook on `PreToolUse` for `AskUserQuestion`: unjustified questions are
/// returned to Claude as a tool error (`continueOnBlock`), so it decides and goes on.
const ASK_GATE: &str = "8sync gate: ask. Claude wants to interrupt the user with AskUserQuestion. Hook input: \
$ARGUMENTS\n\nWalk the question policy below from rule 1 to rule 4 and stop at the first rule that matches.\n\
Rules 1, 2 or 3 → reply exactly {\"ok\": true}.\n\
Rule 4 only → reply {\"ok\": false, \"reason\": \"Don't ask: go with <the option you would pick> because \
<one-line why>; state that assumption and continue.\"}\n\n";

/// A hook `model` must be a full id — an alias fails as `unrecognized_model` and
/// the hook then fails open. The ASK gate stays on Sonnet: on the same prompt
/// Haiku misjudged 2 of 6 labelled questions, Sonnet none. Evidence measured on
/// the previous pair (Sonnet 5 vs Haiku 4.5); not re-measured on 5.5.
const ASK_GATE_MODEL: &str = "claude-sonnet-5-5";

/// Skills the kit itself relies on: never demoted by `skillOverrides`.
/// Includes the repo-rule skills (always-on or required for UI), whose trigger
/// text must not be dropped.
const CORE_SKILLS: [&str; 8] =
    ["ship", "aup-audit", "deep-research", "8sync-cli", "codegraph", "karpathy-guidelines", "ponytail", "impeccable"];

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
    let linked = deploy::link_bundled_skills(&env.home, &dir.join("skills"));
    match linked {
        Ok(0) => {}
        Ok(n) => ui::ok(&format!("{n} bundled skill(s) linked → {} (always the current ~/.omp/skills copy)", dir.join("skills").display())),
        Err(e) => ui::warn(&format!("bundled skills not linked into Claude Code: {e:#}")),
    }
    let skills = linked_bundled_skills(&env.home, &dir.join("skills"));
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
    apply_kit_settings(&mut v, &exe, &skills)?;
    apply_lsp_plugins(&mut v, |bin| which::which(bin).is_ok());
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

/// Official LSP plugins (anthropics/claude-plugins-official, `lspServers` only)
/// and the language-server binary each one starts. Claude Code's LSP tool needs
/// no MCP schema in the prompt; serena stays as the fallback when it is present.
const LSP_PLUGINS: [(&str, &str); 4] = [
    ("rust-analyzer-lsp", "rust-analyzer"),
    ("typescript-lsp", "typescript-language-server"),
    ("gopls-lsp", "gopls"),
    ("pyright-lsp", "pyright-langserver"),
];
const OFFICIAL_MARKETPLACE: &str = "claude-plugins-official";

/// Enable an official LSP plugin only when its server is on PATH. Insert-only:
/// a value the user set (including `false`) is kept.
fn apply_lsp_plugins(v: &mut Value, on_path: impl Fn(&str) -> bool) {
    let Some(obj) = v.as_object_mut() else { return };
    let wanted: Vec<&str> = LSP_PLUGINS.iter().filter(|(_, bin)| on_path(bin)).map(|(p, _)| *p).collect();
    if wanted.is_empty() {
        return;
    }
    if let Some(m) = obj.entry("extraKnownMarketplaces").or_insert_with(|| json!({})).as_object_mut() {
        m.entry(OFFICIAL_MARKETPLACE).or_insert_with(|| {
            json!({ "source": { "source": "github", "repo": "anthropics/claude-plugins-official" } })
        });
    }
    if let Some(en) = obj.entry("enabledPlugins").or_insert_with(|| json!({})).as_object_mut() {
        for p in wanted {
            en.entry(format!("{p}@{OFFICIAL_MARKETPLACE}")).or_insert(json!(true));
        }
    }
}

/// Merge the kit into a parsed `settings.json`, leaving everything else as is:
/// `env`, `defaultMode`, `effortLevel` and `disableClaudeAiConnectors` defaults
/// (a user value wins), `permissions` rules, and 8sync's hooks (replaced in
/// place on re-run, retired ones removed, so the file only changes when the kit does).
fn apply_kit_settings(v: &mut Value, exe: &str, skills: &[String]) -> Result<()> {
    let obj = v.as_object_mut().context("settings.json is not a JSON object")?;
    if let Some(env) = obj.entry("env").or_insert_with(|| json!({})).as_object_mut() {
        env.entry("CLAUDE_CODE_ENABLE_TODO_TOOLS").or_insert_with(|| json!("1"));
    }
    // Sonnet 5 / Opus 5 default to `high`; Opus 5.5 already runs at `medium` and
    // ignores this key. On the calc bench (Sonnet 5, 11 hidden tests) `medium`
    // passed 11/11 in 100 and 161 s (9.4k / 15.3k output tokens) vs 179-209 s
    // and 17.6-20.6k at `high` (omp: 124-155 s). `/effort high` for hard reasoning.
    obj.entry("effortLevel").or_insert_with(|| json!("medium"));
    // A team/claude.ai login pulls the account's connectors (Gmail, Drive,
    // Calendar, Docs…) into every coding session: ~1.2 s more startup, ~2k tokens
    // per request, and mail/drive tools in reach of any prompt injection in the
    // code being read. `false` here brings them back.
    obj.entry("disableClaudeAiConnectors").or_insert_with(|| json!(true));
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
    // Bundled skills the kit does not rely on load name-only (listing without
    // the body), cutting the per-session prefix. Only missing keys are added.
    let over = obj.entry("skillOverrides").or_insert_with(|| json!({}));
    if let Some(over) = over.as_object_mut() {
        for name in skills.iter().filter(|n| !CORE_SKILLS.contains(&n.as_str())) {
            over.entry(name.clone()).or_insert_with(|| json!("name-only"));
        }
    }
    let hooks = obj.entry("hooks").or_insert_with(|| json!({})).as_object_mut().context("settings.json `hooks` is not an object")?;
    // Repo digest on session start (stdout becomes context).
    upsert_hook_group(
        hooks,
        "SessionStart",
        json!({
            "matcher": "startup|clear|compact",
            "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "session-start"], "timeout": 10 }]
        }),
    );
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
    for (event, role) in RETIRED_HOOKS {
        if let Some(groups) = hooks.get_mut(event).and_then(Value::as_array_mut) {
            groups.retain(|g| hook_role(g).as_deref() != Some(role));
        }
    }
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
    // The guard stays on the broad matcher with no `if`: the hook `if` field takes
    // a single permission rule, and narrowing it would let some commands/edits
    // (e.g. `git add` of secrets, credential paths) skip the check.
    upsert_hook_group(
        hooks,
        "PreToolUse",
        json!({
            "matcher": GUARD_MATCHER,
            "hooks": [{
                "type": "command",
                "command": exe,
                "args": ["ccc", "hook", "guard"],
                "timeout": 30,
                // Fail closed (Claude Code 2.1.295+, https://code.claude.com/docs/en/hooks):
                // if the guard can't start, crashes, times out or prints bad JSON, the tool
                // call is blocked instead of running unguarded. Older versions ignore the key.
                "onFailure": "block"
            }]
        }),
    );
    // Agent-team events -> `8sync hq hook <Event>`. Event names, `async` (background, never
    // blocks) and `timeout` (seconds) per https://code.claude.com/docs/en/hooks (checked
    // 2026-10-12). `hq hook` is a fast no-op until `8sync hq setup`, so always registering is safe.
    for ev in HQ_EVENTS {
        upsert_hook_group(
            hooks,
            ev,
            json!({ "hooks": [{ "type": "command", "command": exe, "args": ["hq", "hook", ev], "async": true, "timeout": 15 }] }),
        );
    }
    // Terminal-mode replies for the local journal; separate group from `ccc hook verify-stop`.
    upsert_hook_group(
        hooks,
        "Stop",
        json!({ "hooks": [{ "type": "command", "command": exe, "args": ["hq", "hook", "Stop"], "async": true, "timeout": 15 }] }),
    );
    // Agent-to-agent messages for the local journal (`hq hook` ignores other PostToolUse tools).
    upsert_hook_group(
        hooks,
        "PostToolUse",
        json!({ "matcher": "SendMessage", "hooks": [{ "type": "command", "command": exe, "args": ["hq", "hook", "PostToolUse"], "async": true, "timeout": 15 }] }),
    );
    Ok(())
}

const HQ_EVENTS: [&str; 6] = ["TaskCreated", "TaskCompleted", "TeammateIdle", "Notification", "SessionStart", "SessionEnd"];

/// Which 8sync hook one hook entry is: `hook verify` / `hook guard` for the
/// native commands, the first sentence of a gate prompt (`8sync gate: stop`).
fn entry_role(h: &Value) -> Option<String> {
    if let Some(a) = h["args"].as_array().filter(|a| a.len() >= 3 && a[0] == "ccc" && a[1] == "hook") {
        return a[2].as_str().map(|r| format!("hook {r}"));
    }
    if let Some(a) = h["args"].as_array().filter(|a| a.len() == 3 && a[0] == "hq" && a[1] == "hook") {
        return a[2].as_str().map(|r| format!("hq {r}"));
    }
    let p = h["prompt"].as_str().filter(|p| p.starts_with(GATE_MARKER))?;
    Some(p.split('.').next().unwrap_or(p).to_string())
}

/// Which 8sync hook a matcher group carries (its first 8sync entry).
fn hook_role(g: &Value) -> Option<String> {
    g["hooks"].as_array()?.iter().find_map(entry_role)
}

/// Drop every 8sync hook *entry* (`entry_role`) from a parsed `settings.json`.
/// A group left with no entries is dropped, so is an empty event; a group that
/// also holds the user's own hooks keeps them. Returns how many entries went.
fn strip_kit_hooks(v: &mut Value) -> usize {
    let Some(hooks) = v.get_mut("hooks").and_then(Value::as_object_mut) else { return 0 };
    let mut removed = 0;
    for groups in hooks.values_mut() {
        let Some(arr) = groups.as_array_mut() else { continue };
        arr.retain_mut(|g| {
            let Some(entries) = g.get_mut("hooks").and_then(Value::as_array_mut) else { return true };
            let before = entries.len();
            entries.retain(|h| entry_role(h).is_none());
            removed += before - entries.len();
            before == entries.len() || !entries.is_empty()
        });
    }
    hooks.retain(|_, g| g.as_array().is_none_or(|a| !a.is_empty()));
    removed
}

/// Strip 8sync hooks from the settings file at `path`. Nothing removed: nothing
/// written. Otherwise the original goes to `settings.json.bak-8sync` and the new
/// file replaces it by rename (a crash never leaves a half-written settings.json).
fn remove_kit_hooks_at(path: &Path) -> Result<usize> {
    let raw = std::fs::read_to_string(path)?;
    let mut v: Value = serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))?;
    let n = strip_kit_hooks(&mut v);
    if n == 0 {
        return Ok(0);
    }
    let name = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    std::fs::write(path.with_file_name(format!("{name}.bak-8sync")), &raw).context("write backup")?;
    let tmp = path.with_file_name(format!("{name}.tmp-8sync"));
    std::fs::write(&tmp, serde_json::to_string_pretty(&v)? + "\n")?;
    if let Ok(m) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp, m.permissions());
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(n)
}

/// `8sync ccc kit --remove`: take 8sync's hooks out of ~/.claude/settings.json before
/// uninstalling 8sync. The guard fails closed (`onFailure: "block"`), so a hook left
/// pointing at a missing binary would block every Bash/Edit call.
fn remove_kit_hooks(env: &Env) -> Result<()> {
    let path = claude_dir(env).join("settings.json");
    if !path.is_file() {
        ui::info("no ~/.claude/settings.json — nothing to remove");
        return Ok(());
    }
    match remove_kit_hooks_at(&path)? {
        0 => ui::info(&format!("no 8sync hooks in {} — nothing changed", path.display())),
        n => {
            ui::ok(&format!("removed {n} 8sync hook(s) from {} (your own hooks kept; backup: settings.json.bak-8sync)", path.display()));
            ui::info("agents, skills and the CLAUDE.md block stay; delete them by hand if you want them gone");
        }
    }
    Ok(())
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

/// Skill names (SKILL.md frontmatter `name:`, else the dir name — Claude Code
/// keys `skillOverrides` by name) of the entries under `skills_dir` that are
/// links (symlink / Windows junction) resolving under omp's bundled tree, i.e.
/// the ones `link_bundled_skills` manages. Plain user directories are skipped.
fn linked_bundled_skills(home: &Path, skills_dir: &Path) -> Vec<String> {
    let Ok(omp) = home.join(".omp/skills").canonicalize() else { return Vec::new() };
    let mut out: Vec<String> = std::fs::read_dir(skills_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let Ok(meta) = std::fs::symlink_metadata(e.path()) else { return false };
            is_link(&meta) && e.path().canonicalize().is_ok_and(|t| t.starts_with(&omp))
        })
        .filter_map(|e| {
            let dir_name = e.file_name().into_string().ok()?;
            Some(skill_frontmatter_name(&e.path().join("SKILL.md")).unwrap_or(dir_name))
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

fn is_link(meta: &std::fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return meta.file_attributes() & 0x400 != 0; // junction (reparse point)
    }
    #[cfg(not(windows))]
    false
}

/// `name:` from the YAML frontmatter of a SKILL.md.
fn skill_frontmatter_name(skill_md: &Path) -> Option<String> {
    let text = std::fs::read_to_string(skill_md).ok()?;
    let mut lines = text.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for l in lines {
        if l.trim() == "---" {
            break;
        }
        if let Some(v) = l.strip_prefix("name:") {
            let v = v.trim().trim_matches(|c| c == '"' || c == '\'');
            return (!v.is_empty()).then(|| v.to_string());
        }
    }
    None
}

/// A KNOWLEDGE.md lesson line: `- failure:` / `- validated:`, optionally bold (`- **failure:`).
fn is_lesson(l: &str) -> bool {
    let Some(rest) = l.strip_prefix("- ") else { return false };
    let rest = rest.strip_prefix("**").unwrap_or(rest);
    rest.starts_with("failure:") || rest.starts_with("validated:")
}

/// Stable digest for `hook session-start`: head of `su-code/STATE.md`, then the
/// last failure/validated lines of `su-code/KNOWLEDGE.md`. No timestamps, so the
/// prompt prefix stays cache-stable. Empty when the repo has no `su-code/STATE.md`.
fn session_digest(root: &Path) -> String {
    const CAP: usize = 6000;
    let Ok(state) = std::fs::read_to_string(root.join("su-code/STATE.md")) else { return String::new() };
    let mut out = state.lines().take(60).collect::<Vec<_>>().join("\n");
    if let Ok(k) = std::fs::read_to_string(root.join("su-code/KNOWLEDGE.md")) {
        let lines: Vec<&str> = k.lines().filter(|l| is_lesson(l)).collect();
        let tail = &lines[lines.len().saturating_sub(20)..];
        if !tail.is_empty() {
            out.push_str("\n\n");
            out.push_str(&tail.join("\n"));
        }
    }
    if out.len() > CAP {
        let mut end = CAP;
        while !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
    }
    out
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
        if user["mcpServers"].get(name).is_some() {
            ui::skip(&format!("MCP {name}"), "already in Claude Code");
            continue;
        }
        let mut spec = omp["mcpServers"][name].clone();
        let Some(bin) = spec["command"].as_str().map(str::to_string) else {
            ui::warn(&format!("MCP {name}: not in ~/.omp/agent/mcp.json — not registered in Claude Code"));
            continue;
        };
        if which::which(&bin).is_err() {
            ui::warn(&format!("MCP {name}: command `{bin}` not found on PATH — not registered in Claude Code"));
            continue;
        }
        if name == "serena" {
            spec["alwaysLoad"] = json!(false);
        }
        match Command::new(claude)
            .args(["mcp", "add-json", "--scope", "user", name, &spec.to_string()])
            .stdin(Stdio::null())
            .output()
        {
            Ok(o) if o.status.success() => ui::ok(&format!("MCP {name} → Claude Code (user scope)")),
            Ok(o) => ui::warn(&format!("MCP {name}: `claude mcp add-json` failed: {}", String::from_utf8_lossy(&o.stderr).trim())),
            Err(e) => ui::warn(&format!("MCP {name}: could not run `claude mcp add-json`: {e}")),
        }
    }
}

/// FNV-1a 64 — a stable content fingerprint for the kit stamp file.
fn fnv1a(s: &str) -> String {
    let h = s.bytes().fold(0xcbf2_9ce4_8422_2325_u64, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3));
    format!("{h:016x}")
}

// ── org managed-settings policy ─────────────────────────────────────────────

/// Marketplaces a managed policy lets people add: the official Anthropic one and 8sync's own
/// (the kit plugin). `github` source shape: settings-reference#strictknownmarketplaces
/// (https://code.claude.com/docs/en/settings-reference).
const POLICY_MARKETPLACES: [&str; 2] = ["anthropics/claude-plugins-official", "8-Sync-Dev/su-code"];
/// MCP servers the kit mirrors from omp's config (see `mirror_mcp`).
const POLICY_MCP: [&str; 2] = ["codebase-memory-mcp", "serena"];

/// Recommended managed settings for an org (Claude Team, solo owner, official OAuth only), built
/// only from keys checked against https://code.claude.com/docs/en/settings-reference and
/// /en/managed-settings on 2026-10-12 (Claude Code 2.1.296). Pure: no I/O, no secrets.
///   - `permissions.disableBypassPermissionsMode: "disable"` — reference § permissions-disablebypasspermissionsmode
///   - `permissions.deny` — the kit's DENY list (same rule syntax as the user file)
///   - `forceLoginMethod: "claudeai"` + `forceLoginOrgUUID` (string UUID; only a managed source enforces it)
///   - `strictKnownMarketplaces` — array of `{source:"github", repo}`; managed-only
///   - `allowManagedMcpServersOnly` + `allowedMcpServers` (`{serverName}` entries) — managed-only lock, opt-in (`lock_mcp`)
///   - `sandbox.enabled`, `sandbox.filesystem.denyRead` (`~/` prefix) — sandbox settings
///   - `channelsEnabled: true` — Team/Enterprise need it for any channel plugin; managed-only
///
/// Not set on purpose: `sandbox.failIfUnavailable` / `allowUnsandboxedCommands: false` (would stop
/// sessions where bubblewrap is missing, or block builds needing the escape hatch), `allowedChannelPlugins`
/// (replaces Anthropic's default allowlist), `allowManagedHooksOnly` (only with `strict_hooks`).
#[cfg(test)]
pub(crate) fn org_policy(org_uuid: Option<&str>) -> Value {
    org_policy_with(org_uuid, None, false)
}

/// `hooks_exe = Some(path)` adds the kit's hooks to the policy and turns `allowManagedHooksOnly` on,
/// so the kit keeps working when only managed hooks run. Off by default: the same hooks already live in
/// `~/.claude/settings.json`, and registering them twice would run each hook twice.
pub(crate) fn org_policy_with(org_uuid: Option<&str>, hooks_exe: Option<&str>, lock_mcp: bool) -> Value {
    let mut v = json!({
        "permissions": { "disableBypassPermissionsMode": "disable", "deny": DENY },
        "forceLoginMethod": "claudeai",
        "strictKnownMarketplaces": POLICY_MARKETPLACES.iter().map(|r| json!({ "source": "github", "repo": r })).collect::<Vec<_>>(),
        "sandbox": { "enabled": true, "filesystem": { "denyRead": ["~/.ssh", "~/.aws", "~/.gnupg"] } },
        "channelsEnabled": true
    });
    if lock_mcp {
        v["allowManagedMcpServersOnly"] = json!(true);
        v["allowedMcpServers"] = json!(POLICY_MCP.iter().map(|n| json!({ "serverName": n })).collect::<Vec<_>>());
    }
    if let Some(u) = org_uuid {
        v["forceLoginOrgUUID"] = json!(u);
    }
    if let Some(exe) = hooks_exe {
        let mut kit = json!({});
        // Cannot fail on a fresh object.
        let _ = apply_kit_settings(&mut kit, exe, &[]);
        v["hooks"] = kit["hooks"].take();
        v["allowManagedHooksOnly"] = json!(true);
    }
    v
}

fn is_uuid(s: &str) -> bool {
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5
        && parts.iter().zip([8, 4, 4, 4, 12]).all(|(p, n)| p.len() == n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Where a managed-settings file lives per OS (https://code.claude.com/docs/en/managed-settings,
/// "Place the file on each machine").
fn managed_settings_dir(os: &str) -> Option<&'static str> {
    match os {
        "linux" => Some("/etc/claude-code"),
        "macos" => Some("/Library/Application Support/ClaudeCode"),
        "windows" => Some(r"C:\Program Files\ClaudeCode"),
        _ => None,
    }
}

/// `8sync ccc policy [--org-uuid <uuid>] [--out <file>] [--strict-hooks] [--lock-mcp]`: print or write the
/// recommended managed settings. Never touches a system path.
fn policy(args: &[String]) -> Result<()> {
    let (mut uuid, mut out, mut strict, mut lock_mcp) = (None::<String>, None::<PathBuf>, false, false);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--strict-hooks" => strict = true,
            "--lock-mcp" => lock_mcp = true,
            "--org-uuid" => uuid = Some(it.next().context("--org-uuid needs a value")?.clone()),
            "--out" => out = Some(PathBuf::from(it.next().context("--out needs a file")?)),
            o if o.starts_with("--org-uuid=") => uuid = Some(o["--org-uuid=".len()..].to_string()),
            o if o.starts_with("--out=") => out = Some(PathBuf::from(&o["--out=".len()..])),
            o => bail!("unknown option `{o}` — usage: 8sync ccc policy [--org-uuid <uuid>] [--out <file>] [--strict-hooks] [--lock-mcp]"),
        }
    }
    if let Some(u) = &uuid {
        if !is_uuid(u) {
            bail!("--org-uuid must be a UUID like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (claude.ai > Admin settings)");
        }
    }
    let exe = if strict { Some(hook_exe()?) } else { None };
    let json = serde_json::to_string_pretty(&org_policy_with(uuid.as_deref(), exe.as_deref(), lock_mcp))? + "\n";
    match &out {
        Some(f) => {
            std::fs::write(f, &json).with_context(|| format!("write {}", f.display()))?;
            ui::ok(&format!("wrote {} (nothing installed)", f.display()));
        }
        None => print!("{json}"),
    }
    let (stderr_note, file) = (|m: &str| eprintln!("{m}"), out.as_ref().map(|f| f.display().to_string()).unwrap_or_else(|| "<file>".into()));
    stderr_note("");
    stderr_note("INSTALL (you run it; 8sync never writes system paths)");
    stderr_note(&format!("  Linux/WSL  sudo install -D -m 0644 {file} /etc/claude-code/managed-settings.json"));
    stderr_note(&format!("  macOS      sudo install -m 0644 {file} \"/Library/Application Support/ClaudeCode/managed-settings.json\""));
    stderr_note(&format!("  Windows    copy {file} to C:\\Program Files\\ClaudeCode\\managed-settings.json (admin)"));
    stderr_note("  then run /status in Claude Code: `Setting sources` must show the managed file.");
    stderr_note("");
    stderr_note("NOTES");
    stderr_note("  - Team plan alternative: the same keys can be set as server-managed settings in the claude.ai admin console");
    stderr_note("    (https://code.claude.com/docs/en/server-managed-settings) — no file on disk.");
    if uuid.is_none() {
        stderr_note("  - no --org-uuid: forceLoginOrgUUID is omitted, so any claude.ai org may log in. Re-run with your org UUID.");
    } else {
        stderr_note("  - forceLoginOrgUUID pinned: a wrong UUID locks every login out.");
    }
    stderr_note("  - forceLoginMethod refuses to start while an API key, token or apiKeyHelper is configured;");
    stderr_note("    the error names it (remove it, then `claude auth login`).");
    if lock_mcp {
        stderr_note("  - --lock-mcp: allowManagedMcpServersOnly limits MCP to codebase-memory-mcp and serena. Plugin MCP servers (e.g. the");
        stderr_note("    Discord Channels plugin) are blocked unless added to allowedMcpServers. A plugin server registers as");
        stderr_note("    `plugin:<plugin>:<server>` (https://code.claude.com/docs/en/mcp); whether allowedMcpServers `serverName` matches that");
        stderr_note("    scoped name is not verified (managed-mcp docs not confirmed) - test with /mcp after installing.");
    } else {
        stderr_note("  - MCP lock is OFF (default) so the Discord Channels plugin works; add --lock-mcp to restrict MCP to an allowlist.");
    }
    stderr_note("  - sandbox.enabled needs bubblewrap + socat on Linux; without them commands run unsandboxed (failIfUnavailable not set).");
    stderr_note("  - allowManagedHooksOnly is OFF. `--strict-hooks` adds the kit's hooks to this file and turns it on; then remove");
    stderr_note("    the kit hooks from ~/.claude/settings.json or they run twice, and re-run this after every `8sync` update.");
    Ok(())
}

/// Managed-settings files present on this machine (read-only probe), for `ccc status`.
fn managed_settings_present(os: &str) -> Vec<PathBuf> {
    let Some(dir) = managed_settings_dir(os) else { return vec![] };
    let dir = Path::new(dir);
    let mut found = vec![];
    if dir.join("managed-settings.json").is_file() {
        found.push(dir.join("managed-settings.json"));
    }
    if let Ok(rd) = std::fs::read_dir(dir.join("managed-settings.d")) {
        found.extend(rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json")));
    }
    found
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
    let managed = managed_settings_present(std::env::consts::OS);
    if managed.is_empty() {
        ui::warn("managed settings: none — org lock-down not installed (`8sync ccc policy`)");
    } else {
        let names: Vec<String> = managed.iter().map(|p| p.display().to_string()).collect();
        ui::ok(&format!("managed settings: {}", names.join(", ")));
    }
    println!();
    print_sessions(env, root, false)
}

// ── hooks ───────────────────────────────────────────────────────────────────

/// Walk up from `start` to the first dir holding `su-code/STATE.md`; stop after checking
/// `home` (inclusive) or at the filesystem root.
fn find_state_root(start: &Path, home: Option<&Path>) -> Option<PathBuf> {
    for dir in start.ancestors() {
        if dir.join("su-code/STATE.md").is_file() {
            return Some(dir.to_path_buf());
        }
        if home == Some(dir) {
            return None;
        }
    }
    None
}

fn hook(rest: &[String]) -> Result<()> {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let out = match rest.first().map(String::as_str) {
        // Async (asyncRewake): exit code 2 + stderr is how a failure reaches Claude.
        Some("verify") => std::process::exit(verify::post_tool_use(&input)),
        Some("verify-stop") => verify::stop(&input),
        Some("guard") => {
            // Release builds abort on panic, and Claude Code runs the tool when a hook dies:
            // a bug in the analyser must ask instead of waving the command through.
            std::panic::set_hook(Box::new(|_| {
                println!("{}", guard::decision("ask", "8sync could not analyse this command (internal error). Check it with the user."));
                std::process::exit(0);
            }));
            guard::check(&input)
        }
        Some("session-start") => {
            let cwd = serde_json::from_str::<Value>(&input).ok().and_then(|v| v["cwd"].as_str().map(PathBuf::from));
            let start = cwd.or_else(|| std::env::current_dir().ok()).unwrap_or_default();
            let home = std::env::var_os("HOME").map(PathBuf::from);
            let root = find_state_root(&start, home.as_deref());
            root.map(|r| session_digest(&r)).filter(|d| !d.is_empty())
        }
        _ => bail!("usage: 8sync ccc hook verify|verify-stop|guard|session-start   (run by the kit's Claude Code hooks)"),
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
        apply_kit_settings(&mut v, "/new/8sync", &[]).unwrap();
        let once = v.clone();
        apply_kit_settings(&mut v, "/new/8sync", &[]).unwrap();
        assert_eq!(v, once, "second merge must not change anything");

        assert_eq!(v["model"], "opus");
        assert_eq!(v["effortLevel"], "medium", "effort defaults to medium when unset");
        let mut mine = json!({ "effortLevel": "xhigh" });
        apply_kit_settings(&mut mine, "/new/8sync", &[]).unwrap();
        assert_eq!(mine["effortLevel"], "xhigh", "a user-set effort wins");
        assert_eq!(v["env"]["CLAUDE_CODE_ENABLE_TODO_TOOLS"], "0", "a user-set env value wins");
        let deny = v["permissions"]["deny"].as_array().unwrap();
        assert_eq!(deny.iter().filter(|r| *r == "Read(**/.env)").count(), 1);
        assert!(deny.iter().any(|r| r == "WebFetch") && deny.iter().any(|r| r == "Bash(git push -f*)"));

        let post = v["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(post.len(), 3, "user hook kept, ours replaced in place, hq SendMessage appended");
        assert_eq!(post[0]["hooks"][0]["command"], "prettier");
        assert_eq!(post[1]["hooks"][0]["command"], "/new/8sync");
        assert_eq!(post[1]["hooks"][0]["asyncRewake"], true, "edits never wait for the check");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "retired Haiku stop gate removed; verify-stop + hq Stop appended");
        assert_eq!(stop[0]["hooks"][0]["args"], json!(["ccc", "hook", "verify-stop"]));
        assert_eq!(v["disableClaudeAiConnectors"], true);
        let mut keep = json!({ "disableClaudeAiConnectors": false });
        apply_kit_settings(&mut keep, "/new/8sync", &[]).unwrap();
        assert_eq!(keep["disableClaudeAiConnectors"], false, "a user choice wins");
        let allow = v["permissions"]["allow"].as_array().unwrap();
        assert!(allow.iter().any(|r| r == "Bash(make*)") && allow.iter().any(|r| r == "Bash(cargo check*)"));
        assert!(!allow.iter().any(|r| r.as_str().is_some_and(|s| s.contains("git push"))), "pushes stay reviewed");
        let pre = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 3, "ask gate replaced in place, user hook kept, guard appended");
        assert_eq!(pre[0]["hooks"][0]["prompt"], format!("{ASK_GATE}{ASK_POLICY}"));
        assert_eq!(pre[1]["hooks"][0]["command"], "my-linter");
        assert_eq!(pre[2]["hooks"][0]["args"], json!(["ccc", "hook", "guard"]));
        assert_eq!(pre[2]["hooks"][0]["onFailure"], "block", "guard fails closed");
        assert!(deny.iter().any(|r| r == "Edit(**/.env)") && !deny.iter().any(|r| r.as_str().is_some_and(|s| s.starts_with("Write("))));
        assert_eq!(v["permissions"]["defaultMode"], "auto");
    }

    #[test]
    fn old_kit_settings_upgrade_in_place_without_duplicates() {
        let mut v = json!({
            "skillOverrides": { "impeccable": "off" },
            "hooks": {
                "Stop": [{ "hooks": [{ "type": "prompt", "prompt": "8sync gate: stop. v1 text", "timeout": 30 }] }],
                "PreToolUse": [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "prompt", "prompt": "8sync gate: ask. v1", "model": "claude-sonnet-5" }] }]
            }
        });
        let skills: Vec<String> = ["ship", "codegraph", "impeccable", "ponytail", "taste"].map(String::from).to_vec();
        apply_kit_settings(&mut v, "/x/8sync", &skills).unwrap();
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.iter().filter(|g| g["hooks"][0]["prompt"].is_string()).count(), 0, "Haiku stop gate retired");
        assert_eq!(stop.len(), 2);
        assert_eq!(stop[0]["hooks"][0]["args"], json!(["ccc", "hook", "verify-stop"]));
        assert_eq!(v["hooks"]["PreToolUse"][0]["hooks"][0]["model"], ASK_GATE_MODEL);
        assert_eq!(v["hooks"]["SessionStart"][0]["hooks"][0]["args"], json!(["ccc", "hook", "session-start"]));
        let o = &v["skillOverrides"];
        assert_eq!(o["impeccable"], "off", "user value kept");
        assert_eq!(o["taste"], "name-only");
        assert!(o.get("ship").is_none() && o.get("codegraph").is_none() && o.get("ponytail").is_none(), "core skills untouched");
        assert_eq!(v["hooks"]["SessionStart"][0]["matcher"], "startup|clear|compact");
        let once = v.clone();
        apply_kit_settings(&mut v, "/x/8sync", &skills).unwrap();
        assert_eq!(v, once);
    }

    #[test]
    fn hq_hooks_added_once_async_and_user_hooks_kept() {
        let mut v = json!({
            "hooks": {
                "Notification": [{ "hooks": [{ "type": "command", "command": "notify-send" }] }],
                "TaskCompleted": [{ "hooks": [{ "type": "command", "command": "/old/8sync", "args": ["hq", "hook", "TaskCompleted"] }] }]
            }
        });
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        let once = v.clone();
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        assert_eq!(v, once, "re-run adds nothing");
        for ev in HQ_EVENTS {
            let n = v["hooks"][ev].as_array().unwrap().iter().filter(|g| g["hooks"][0]["args"] == json!(["hq", "hook", ev])).count();
            assert_eq!(n, 1, "{ev} registered exactly once");
        }
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.iter().filter(|g| g["hooks"][0]["args"] == json!(["hq", "hook", "Stop"]) && g["hooks"][0]["async"] == true).count(), 1, "hq Stop once");
        assert_eq!(stop.iter().filter(|g| g["hooks"][0]["args"] == json!(["ccc", "hook", "verify-stop"])).count(), 1, "verify-stop kept");
        let pt = v["hooks"]["PostToolUse"].as_array().unwrap().iter().filter(|g| g["hooks"][0]["args"] == json!(["hq", "hook", "PostToolUse"]) && g["matcher"] == "SendMessage").count();
        assert_eq!(pt, 1, "SendMessage hook registered once");
        let tc = &v["hooks"]["TaskCompleted"][0]["hooks"][0];
        assert_eq!((tc["command"].as_str(), &tc["async"], &tc["timeout"]), (Some("/x/8sync"), &json!(true), &json!(15)));
        let n = v["hooks"]["Notification"].as_array().unwrap();
        assert_eq!(n.len(), 2);
        assert_eq!(n[0]["hooks"][0]["command"], "notify-send", "user hook kept");
    }

    #[cfg(unix)]
    #[test]
    fn linked_bundled_skills_only_counts_omp_symlinks_keyed_by_frontmatter_name() {
        let d = std::env::temp_dir().join(format!("8sync-linked-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let omp = d.join(".omp/skills");
        let cl = d.join(".claude/skills");
        std::fs::create_dir_all(omp.join("taste-skill")).unwrap();
        std::fs::create_dir_all(omp.join("plain")).unwrap();
        std::fs::create_dir_all(omp.join("mine")).unwrap();
        std::fs::create_dir_all(cl.join("mine")).unwrap(); // user's own dir, same name
        std::fs::write(omp.join("taste-skill/SKILL.md"), "---\nname: design-taste-frontend\ndescription: x\n---\nbody").unwrap();
        std::os::unix::fs::symlink(omp.join("taste-skill"), cl.join("taste-skill")).unwrap();
        std::os::unix::fs::symlink(omp.join("plain"), cl.join("plain")).unwrap(); // no SKILL.md → dir name
        let elsewhere = d.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, cl.join("foreign")).unwrap(); // link outside omp
        assert_eq!(linked_bundled_skills(&d, &cl), vec!["design-taste-frontend".to_string(), "plain".to_string()]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn session_digest_is_bounded_and_stable() {
        let d = std::env::temp_dir().join(format!("8sync-digest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(session_digest(&d), "", "no su-code/ prints nothing");
        std::fs::create_dir_all(d.join("su-code")).unwrap();
        let state: String = (0..100).map(|i| format!("state {i}\n")).collect();
        std::fs::write(d.join("su-code/STATE.md"), state).unwrap();
        let know: String = (0..30).map(|i| format!("- **failure:** f{i}\n- **other:** x{i}\n- validated: v{i}\n- failures: nope{i}\n")).collect();
        std::fs::write(d.join("su-code/KNOWLEDGE.md"), know).unwrap();
        let out = session_digest(&d);
        assert!(out.contains("state 59") && !out.contains("state 60"));
        assert!(out.contains("f29") && out.contains("f20") && !out.contains("f19\n") && !out.contains("other") && !out.contains("nope"));
        assert!(out.contains("- validated: v29") && out.contains("- validated: v20") && !out.contains("v19\n"), "plain form kept, last 20 only");
        assert_eq!(out, session_digest(&d), "deterministic");
        std::fs::write(d.join("su-code/STATE.md"), "é".repeat(5000)).unwrap();
        let out = session_digest(&d);
        assert!(out.len() <= 6000 && out.chars().all(|c| c == 'é' || c == '\n' || c.is_ascii()));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn state_root_found_from_nested_subdir_and_stops_at_home() {
        let d = std::env::temp_dir().join(format!("8sync-root-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let nested = d.join("proj/a/b");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(d.join("proj/su-code")).unwrap();
        std::fs::write(d.join("proj/su-code/STATE.md"), "state").unwrap();
        assert_eq!(find_state_root(&nested, Some(&d)), Some(d.join("proj")));
        assert_eq!(session_digest(&find_state_root(&nested, Some(&d)).unwrap()), "state");
        // STATE above $HOME is not reached.
        assert_eq!(find_state_root(&nested, Some(&d.join("proj/a"))), None);
        assert_eq!(find_state_root(&d.join("nope"), Some(&d)), None);
        let _ = std::fs::remove_dir_all(&d);
    }
    #[test]
    fn lsp_plugins_enabled_only_when_server_on_path_and_user_value_kept() {
        let mut v = json!({ "enabledPlugins": { "gopls-lsp@claude-plugins-official": false } });
        apply_lsp_plugins(&mut v, |bin| bin == "rust-analyzer" || bin == "gopls");
        let en = &v["enabledPlugins"];
        assert_eq!(en["rust-analyzer-lsp@claude-plugins-official"], json!(true));
        assert_eq!(en["gopls-lsp@claude-plugins-official"], json!(false));
        assert!(en.get("typescript-lsp@claude-plugins-official").is_none());
        assert_eq!(v["extraKnownMarketplaces"]["claude-plugins-official"]["source"]["repo"], json!("anthropics/claude-plugins-official"));
        let before = v.clone();
        apply_lsp_plugins(&mut v, |bin| bin == "rust-analyzer" || bin == "gopls");
        assert_eq!(v, before);
        let mut none = json!({});
        apply_lsp_plugins(&mut none, |_| false);
        assert_eq!(none, json!({}));
    }

    #[test]
    fn plugin_manifest_version_matches_crate() {
        let m: Value = serde_json::from_str(include_str!("../../../../assets/claude/.claude-plugin/plugin.json")).unwrap();
        assert_eq!(m["name"], json!("8sync-kit"));
        assert_eq!(m["version"], json!(env!("CARGO_PKG_VERSION")));
        let mk: Value = serde_json::from_str(include_str!("../../../../.claude-plugin/marketplace.json")).unwrap();
        assert_eq!(mk["plugins"][0]["source"], json!("./assets/claude"));
    }


    #[test]
    fn org_policy_is_valid_json_with_locks_and_no_secrets() {
        let p = org_policy(None);
        let text = serde_json::to_string(&p).unwrap();
        assert!(serde_json::from_str::<Value>(&text).is_ok());
        assert_eq!(p["permissions"]["disableBypassPermissionsMode"], "disable");
        let deny: Vec<&str> = p["permissions"]["deny"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
        assert!(DENY.iter().all(|r| deny.contains(r)));
        assert_eq!(p["forceLoginMethod"], "claudeai");
        assert_eq!(p["sandbox"]["enabled"], true);
        assert_eq!(p["channelsEnabled"], true);
        assert!(p["strictKnownMarketplaces"].as_array().unwrap().iter().any(|m| m["repo"] == "8-Sync-Dev/su-code"));
        // Keys that need an opt-in stay out of the default.
        assert!(p.get("allowManagedHooksOnly").is_none() && p.get("hooks").is_none());
        // MCP lock is opt-in so the Discord Channels plugin server is not blocked.
        assert!(p.get("allowManagedMcpServersOnly").is_none() && p.get("allowedMcpServers").is_none());
        let locked = org_policy_with(None, None, true);
        assert_eq!(locked["allowManagedMcpServersOnly"], true);
        assert!(locked["allowedMcpServers"].as_array().unwrap().iter().any(|m| m["serverName"] == "serena"));
        let lower = text.to_lowercase();
        assert!(["sk-ant", "ghp_", "api_key", "apikey", "bearer "].iter().all(|n| !lower.contains(n)));
    }

    #[test]
    fn org_policy_pins_org_only_when_uuid_given() {
        assert!(org_policy(None).get("forceLoginOrgUUID").is_none());
        let u = "123e4567-e89b-12d3-a456-426614174000";
        assert_eq!(org_policy(Some(u))["forceLoginOrgUUID"], u);
        assert!(is_uuid(u) && !is_uuid("nope") && !is_uuid("123e4567-e89b-12d3-a456-42661417400"));
    }

    #[test]
    fn org_policy_strict_hooks_carry_the_kit_hooks() {
        let p = org_policy_with(None, Some("/usr/bin/8sync"), false);
        assert_eq!(p["allowManagedHooksOnly"], true);
        let text = p["hooks"].to_string();
        assert!(text.contains("\"guard\"") && text.contains("\"verify\"") && text.contains("/usr/bin/8sync"));
    }

    #[test]
    fn managed_dirs_per_os() {
        assert_eq!(managed_settings_dir("linux"), Some("/etc/claude-code"));
        assert!(managed_settings_dir("macos").unwrap().ends_with("ClaudeCode"));
        assert_eq!(managed_settings_dir("freebsd"), None);
    }
    #[test]
    fn kit_remove_strips_only_8sync_hooks() {
        let mut v = json!({});
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        v["hooks"]["PreToolUse"].as_array_mut().unwrap().push(json!({"matcher": "Bash", "hooks": [{"type": "command", "command": "my-linter"}]}));
        let n = strip_kit_hooks(&mut v);
        assert!(n >= 5, "removed {n}");
        let pre = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 1);
        assert_eq!(pre[0]["hooks"][0]["command"], "my-linter");
        assert!(v["hooks"].get("TaskCreated").is_none(), "empty events dropped");
        assert_eq!(strip_kit_hooks(&mut v), 0, "idempotent");
    }

    #[test]
    fn kit_remove_strips_hq_groups_and_keeps_user_hooks_in_mixed_groups() {
        let mut v = json!({});
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        for ev in ["Stop", "PostToolUse", "SessionStart"] {
            assert!(v["hooks"][ev].as_array().unwrap().iter().any(|g| hook_role(g).is_some_and(|r| r.starts_with("hq "))), "{ev} has an hq group");
        }
        // a user hook sharing a group with an 8sync hook
        let g = v["hooks"]["Stop"].as_array_mut().unwrap().iter_mut().find(|g| hook_role(g).is_some_and(|r| r.starts_with("hq "))).unwrap();
        g["hooks"].as_array_mut().unwrap().push(json!({"type": "command", "command": "my-notify"}));
        v["hooks"]["PostToolUse"].as_array_mut().unwrap().push(json!({"matcher": "Edit", "hooks": [{"type": "command", "command": "mine"}]}));
        assert!(strip_kit_hooks(&mut v) >= 3);
        for ev in ["Stop", "PostToolUse", "SessionStart"] {
            let groups = v["hooks"].get(ev).and_then(|g| g.as_array()).cloned().unwrap_or_default();
            assert!(groups.iter().all(|g| hook_role(g).is_none()), "{ev}: no 8sync entry left");
        }
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!((stop.len(), stop[0]["hooks"].as_array().unwrap().len(), stop[0]["hooks"][0]["command"].as_str()), (1, 1, Some("my-notify")));
        assert_eq!(v["hooks"]["PostToolUse"].as_array().unwrap().len(), 1);
        assert!(v["hooks"].get("SessionStart").is_none());
    }

    #[test]
    fn kit_remove_file_is_atomic_backed_up_and_skips_when_clean() {
        let d = std::env::temp_dir().join(format!("kit-rm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("settings.json");
        let mut v = json!({"theme": "dark"});
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        let before = serde_json::to_string_pretty(&v).unwrap() + "\n";
        std::fs::write(&p, &before).unwrap();
        assert!(remove_kit_hooks_at(&p).unwrap() >= 5);
        assert_eq!(std::fs::read_to_string(d.join("settings.json.bak-8sync")).unwrap(), before);
        assert!(!d.join("settings.json.tmp-8sync").exists());
        let after: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(after["theme"], "dark");
        // nothing left to remove: no write, file bytes and mtime-independent content unchanged
        let again = std::fs::read_to_string(&p).unwrap();
        std::fs::remove_file(d.join("settings.json.bak-8sync")).unwrap();
        assert_eq!(remove_kit_hooks_at(&p).unwrap(), 0);
        assert_eq!(std::fs::read_to_string(&p).unwrap(), again);
        assert!(!d.join("settings.json.bak-8sync").exists(), "no backup when nothing changed");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn team_flags_are_consumed_and_refuse_print() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let (t, p, rest) = team_flags(&v(&["--team", "--model", "opus"])).unwrap();
        assert!(t && !p);
        assert_eq!(rest, v(&["--model", "opus"]));
        let (t, p, rest) = team_flags(&v(&["--panes"])).unwrap();
        assert!(t && p && rest.is_empty(), "--panes implies --team");
        let (t, _, rest) = team_flags(&v(&["-p", "hi"])).unwrap();
        assert!(!t && rest.len() == 2, "plain -p passes through");
        assert!(team_flags(&v(&["--team", "-p", "hi"])).is_err());
        assert!(team_flags(&v(&["--team", "--print"])).is_err());
        assert!(team_flags(&v(&["--team", "-pc"])).is_err());
        assert!(team_flags(&v(&["--team", "--print=json"])).is_err());
        assert!(team_flags(&v(&["--team", "--permission-mode", "auto"])).is_ok(), "--permission-mode is not -p");
    }

}
