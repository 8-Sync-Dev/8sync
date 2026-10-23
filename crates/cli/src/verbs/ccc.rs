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

mod auto;
pub(crate) mod awake;
mod cancel;
mod ci;
mod compact;
mod danger;
mod delegate;
mod fence;
mod gate;
mod grant;
mod guard;
mod help;
mod hint;
mod idle;
mod looper;
mod meet;
mod merge;
mod output_budget;
mod msg;
mod omp_team;
mod permit;
mod term;
pub(crate) mod report;
mod risk;
mod secret;
pub(crate) mod resume;
mod room;
mod statusline;
mod taskdone;
mod urgent;
mod goal;
mod target;
mod team;
mod standup;
mod wake;
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
      8sync ccc help                 every ccc verb on one screen (Vietnamese)
      8sync ccc compact [--at N|--reset|--window N|--window-reset|--json]   auto-compact threshold (kit default 65% of the model window; needs a new session)
      8sync ccc kit [--force]        install/refresh the 8sync kit in ~/.claude
      8sync ccc . <name> --offline   no network step at all: no auto-update, installer, `claude mcp add` or download
                                     (also `EIGHTSYNC_OFFLINE=1`; works on `new`, `.`, `kit`; `claude` must already be installed)
      8sync ccc kit --remove         take 8sync's hooks out of ~/.claude/settings.json (run before uninstalling)
      8sync ccc loop <init|tick|status|done|ls> <slug>   bounded-loop state for /ship-loop (su-code/ship/<slug>/loop.json)
      8sync ccc statusline [--agents|--install|--uninstall]   Claude Code status line (usage, branch, PR, tasks, loop, grant); chains an existing one
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
               /harden (Claude Code security posture) ·
               /do · /ship-auto · /ship-loop · /autopilot (graded auto levels) · deep-research + every bundled 8sync skill (linked to ~/.omp/skills)
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
               serena / codebase-memory-mcp ONLY if opted in (`8sync harness serena|cbm on`) from omp's MCP config when on PATH
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
        self.rest.first().is_some_and(|v| v == "hook" || v == "statusline")
    }
}

pub fn run(a: Args) -> Result<()> {
    // `8sync ccc . <name>`: the dot means "this repo"; `8sync ccc <name>` works too.
    let args = match a.rest.split_first() {
        Some((dot, rest)) if dot == "." => rest,
        _ => &a.rest[..],
    };
    // `--offline` (or EIGHTSYNC_OFFLINE=1) is ours, never passed on to `claude`.
    let (offline, args) = take_offline(args, std::env::var("EIGHTSYNC_OFFLINE").ok().as_deref());
    let args = &args[..];
    let (verb, rest) = args.split_first().map(|(v, r)| (v.as_str(), r)).unwrap_or(("", &[][..]));
    if verb == "hook" {
        return hook(rest);
    }
    if verb == "statusline" {
        return statusline::run(rest); // before Env::detect: runs every few seconds, must stay fast
    }
    if verb == "awake" {
        // Before Env::detect: HQ polls `status` every ~30 s and flips `on`/`off` from its switch.
        match rest.first().map(String::as_str) {
            Some("status") => return awake::status(&rest[1..]),
            Some("on") => return awake::on(&rest[1..], &dirs::home_dir().context("no HOME")?),
            Some("off") => return awake::off(&dirs::home_dir().context("no HOME")?),
            _ => {}
        }
    }
    if verb == "help" {
        print!("{}", help::TEXT);
        return Ok(());
    }
    let env = Env::detect()?;
    let cwd = std::env::current_dir().context("no cwd")?;
    let root = crate::verbs::here::repo_of(&cwd).or_else(|| crate::verbs::here::detect_project_root(&cwd)).unwrap_or(cwd);
    match verb {
        "kit" if rest.iter().any(|a| a == "--remove") => remove_kit_hooks(&env),
        "kit" if rest.first().map(String::as_str) == Some("status") => {
            let v = kit_status_json(&env, &claude_dir(&env));
            println!("{}", serde_json::to_string_pretty(&v)?);
            Ok(())
        }
        "login-kind" => {
            let k = login_kind(&env);
            if rest.iter().any(|a| a == "--json") {
                println!("{}", serde_json::to_string_pretty(&login_kind_json(&k))?);
            } else {
                println!("{}", login_kind_line(&k));
            }
            Ok(())
        }
        "show" => {
            let name = rest.iter().find(|a| !a.starts_with('-')).context("usage: 8sync ccc . show <name> [--json]")?;
            super::session_cmds::run_show(super::session_cmds::ShowArgs { name: name.clone(), engine: Some("ccc".into()), json: rest.iter().any(|a| a == "--json") })
        }
        "kit" => {
            if let Some(i) = rest.iter().position(|a| a == "--skills-from") {
                let dir = rest.get(i + 1).context("--skills-from needs a directory (e.g. ~/startup/8sync-startup/su-code/skills)")?;
                let dir = PathBuf::from(dir.strip_prefix("~/").map_or_else(|| dir.clone(), |r| env.home.join(r).to_string_lossy().into_owned()));
                if deploy::add_skill_library(&env.home, &dir)? {
                    ui::ok(&format!("skill library registered → {}", dir.display()));
                }
            }
            let res = install_kit(&env, rest.iter().any(|a| a == "--force"), offline);
            refresh_ancestor_claude_md(&env, &root);
            res
        }
        "compact" => compact::run(rest, &claude_dir(&env), &env.home),
        "delegate" => delegate::run(rest, &env.home),
        "idle" => idle::run(rest, &env.home, login_kind_at(&env.home).kind == "subscription"),
        "secret" => secret::run(rest),
        "status" => status(&env, &root),
        "policy" => policy(rest),
        "loop" => looper::run(rest, &std::env::current_dir().context("no cwd")?),
        "cancel" => {
            let id = std::env::var("CLAUDE_CODE_SESSION_ID").ok();
            let cwd = std::env::current_dir().context("no cwd")?;
            if !cancel::run(&sessions(&env, &root), rest, id.as_deref(), &cwd, &env.home, view_now())? {
                std::process::exit(1);
            }
            Ok(())
        }
        // One team per git repo: a subfolder with its own package.json is not a project, a nested
        // repo is (ai-game-studio inside 8sync-startup), and a worktree belongs to its repo.
        "auto" => {
            let repo = std::env::current_dir().ok().and_then(|c| crate::verbs::here::repo_of(&c)).unwrap_or_else(|| root.clone());
            if rest.first().is_some_and(|a| a == "revive") {
                // Only the roots `auto up` brought a team up in (HQ calls this without a cwd), one
                // revive at a time (HQ and a boot hook can both fire it).
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
                let Some(_lock) = team::revive_lock(&env.home, now)? else { return Ok(()) };
                for r in team::team_roots(&env.home) {
                    let r = PathBuf::from(r);
                    if let Err(e) = auto_team(&env, &r, rest) {
                        eprintln!("{}: {e:#}", r.display());
                    }
                }
                Ok(())
            } else if team::wants(rest) {
                auto_team(&env, &repo, rest)
            } else {
                auto::run(rest, &env.home, login_kind_at(&env.home).kind == "subscription", &repo, || {
                    sessions(&env, &repo).load().sessions.into_iter().map(|s| (s.name, s.conversation_id)).collect()
                })
            }
        }
        "meet" => {
            let id = std::env::var("CLAUDE_CODE_SESSION_ID").ok();
            meet::run(&sessions(&env, &root), rest, id.as_deref(), &std::env::current_dir().context("no cwd")?, view_now())
        }
        "risk" => risk::run(rest, &std::env::current_dir().context("no cwd")?),
        "term" => term::run(rest, &env),
        "awake" => {
            let o = awake::parse(rest)?;
            // `claude` is only needed to watch the rooms; never with a console window (a detached hold).
            let bin = if o.while_rooms { Some(awake::Quiet { exe: ensure_claude(true)?, root: env.home.clone() }) } else { None };
            awake::run(&o, bin.as_ref().map(|b| b as &dyn team::Claude), login_kind_at(&env.home).kind == "subscription", &env.home)
        }
        "hint" => {
            let cwd = std::env::current_dir().context("no cwd")?;
            let id = std::env::var("CLAUDE_CODE_SESSION_ID").ok();
            let reg = sessions(&env, &root).load();
            let cd = claude_dir(&env);
            hint::run(rest, &hint::Ctx { cwd: &cwd, home: &env.home, claude_dir: &cd, registry: Some(&reg), session_id: id.as_deref(), now: view_now(), git: true })
        }
        "inbox" => {
            let id = std::env::var("CLAUDE_CODE_SESSION_ID").ok();
            crate::verbs::hq::run_inbox(&env.home, rest, id.as_deref())
        }
        "msg" => {
            let ccc = sessions(&env, &root).load().sessions.into_iter().map(|s| (s.name, s.conversation_id)).collect();
            let omp = crate::verbs::session::load(&env, &root).sessions.into_iter().map(|s| s.name).collect();
            msg::run(rest, &env.home, &root, &msg::rooms(&root, ccc, omp))
        }
        "ls" | "list" => {
            print_sessions(&env, &root, rest.iter().any(|a| a == "--json"))
        }
        "report" => report::run(&env.home, &root, &session_rows_json(&env, &root), rest.iter().any(|a| a == "--json")),
        "urgent" => {
            let id = std::env::var("CLAUDE_CODE_SESSION_ID").ok();
            ui::ok(&urgent::run(&sessions(&env, &root), rest, id.as_deref(), view_now())?);
            Ok(())
        }
        "goal" => {
            let id = std::env::var("CLAUDE_CODE_SESSION_ID").ok();
            ui::ok(&goal::run(&sessions(&env, &root), rest, id.as_deref(), view_now())?);
            Ok(())
        }
        "standup" => {
            // Other rooms = every registered session of this repo except the caller's own, with
            // the goal/files it declared (`ccc . goal`), so the board can flag file overlaps.
            // Only rooms active within a week (as the SessionStart block): a dead session's old
            // claim must not raise overlap warnings forever.
            let me = std::env::var("CLAUDE_CODE_SESSION_ID").unwrap_or_default();
            let now = view_now();
            let peers: Vec<standup::Peer> = sessions(&env, &root)
                .load()
                .sessions
                .into_iter()
                .filter(|s| s.conversation_id != me && now.saturating_sub(s.last_active) < 7 * 86400)
                .map(|s| standup::Peer { name: s.name, goal: s.goal.as_ref().map(|g| g.text.clone()), files: s.goal.map(|g| g.files).unwrap_or_default() })
                .collect();
            // Exit 3 = a role is idle (1 stays "error"), so loops can tell the two apart.
            if !standup::run(rest, &std::env::current_dir().context("no cwd")?, &peers)? {
                std::process::exit(3);
            }
            Ok(())
        }
        "rm" => cmd_rm(&env, &root, rest.first().context("usage: 8sync ccc . rm <name>")?),
        "new" => {
            let name = rest.first().context("usage: 8sync ccc . new <name>")?;
            prepare(&env, &root, offline);
            open(&env, &root, name, true, &rest[1..], offline)
        }
        "" => {
            prepare(&env, &root, offline);
            match sessions(&env, &root).load().last_used {
                Some(name) => open(&env, &root, &name, false, &[], offline),
                None => launch(Command::new(ensure_claude(offline)?).current_dir(&root)),
            }
        }
        _ if verb.starts_with('-') && args.iter().any(|a| a == "--team" || a == "--panes") => {
            prepare(&env, &root, offline);
            match sessions(&env, &root).load().last_used {
                Some(name) => open(&env, &root, &name, false, args, offline),
                None => bail!("no session in this repo yet: start one with `8sync ccc . <name> --team`"),
            }
        }
        _ if verb.starts_with('-') => {
            prepare(&env, &root, offline);
            launch(Command::new(ensure_claude(offline)?).args(args).current_dir(&root))
        }
        // Verb-like words never start a claude session (old binaries launched one for unknown verbs).
        name if help::RESERVED.contains(&name) => {
            print!("{}", help::TEXT);
            bail!("`8sync ccc {name}` không phải verb ở dạng này — xem trợ giúp ở trên (hook chạy qua `8sync ccc hook <tên>`)")
        }
        name => {
            prepare(&env, &root, offline);
            open(&env, &root, name, false, rest, offline)
        }
    }
}

/// Every launch brings the environment up to date, with no network on the
/// critical path: a newer 8sync release (found by the 6-hourly background
/// probe) is installed and the launch re-runs on it; after an update the kit
/// and the bundled skills are refreshed; a git repo gets the 8sync harness.
/// Never blocks the launch — a failed step is reported and skipped.
/// `SUSYNC_NO_AUTO_UPDATE=1` keeps the installed binary.
fn prepare(env: &Env, root: &Path, offline: bool) {
    if std::env::var_os("SUSYNC_NO_AUTO_UPDATE").is_none() && selfup::update_cached() {
        if let Some(code) = auto_update(offline, update_and_rerun) {
            std::process::exit(code);
        }
    }
    if kit_version(env).as_deref() != Some(env!("CARGO_PKG_VERSION")) {
        if let Err(e) = deploy::install_bundled_global(env).and_then(|()| install_kit(env, false, offline)) {
            ui::warn(&format!("kit refresh failed: {e:#} — `8sync ccc kit` retries"));
        }
    }
    refresh_ancestor_claude_md(env, root);
    if root.join(".git").exists() {
        if let Err(e) = project_harness(env, root) {
            ui::warn(&format!("project harness: {e:#} — `8sync harness` repairs it"));
        }
    }
}

/// `--offline` / `EIGHTSYNC_OFFLINE=1`: split our flag out of the args and
/// resolve it (flag or env value `1`/`true`).
fn take_offline(args: &[String], env: Option<&str>) -> (bool, Vec<String>) {
    let flag = args.iter().any(|a| a == "--offline");
    let on = flag || env.is_some_and(|v| matches!(v.trim(), "1" | "true"));
    (on, args.iter().filter(|a| *a != "--offline").cloned().collect())
}

/// The one gate before any step that spawns curl / an installer / `claude mcp`
/// / a release download. Offline: refuse with a `skip` line, never spawn.
fn net_allowed(offline: bool, step: &str) -> Result<()> {
    if offline {
        ui::skip(step, "offline (--offline / EIGHTSYNC_OFFLINE=1)");
        bail!("offline: `{step}` needs the network");
    }
    Ok(())
}

/// Run the self-update (`update`) unless offline; `Some(code)` = re-ran on the new binary.
fn auto_update(offline: bool, update: impl FnOnce() -> Option<i32>) -> Option<i32> {
    net_allowed(offline, "auto-update").ok()?;
    update()
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

/// Bring the 8sync block in CLAUDE.md files above `dir` (up to $HOME, git repo or not) to the
/// current compact block; a failure is reported, never blocks.
fn refresh_ancestor_claude_md(env: &Env, dir: &Path) {
    match crate::verbs::skill::inject::refresh_ancestor_blocks(&env.home, dir) {
        Ok(files) => files.iter().for_each(|f| ui::ok(&format!("refreshed 8sync block in {} (backup: .bak-8sync)", f.display()))),
        Err(e) => ui::warn(&format!("ancestor CLAUDE.md refresh: {e:#}")),
    }
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

/// Whether a kit was ever installed on this machine (what `8sync up` uses to decide on a refresh).
pub(crate) fn kit_installed() -> bool {
    Env::detect().is_ok_and(|e| kit_version(&e).is_some())
}

/// The 8sync version that last wrote the kit (`None` before any kit).
fn kit_version(env: &Env) -> Option<String> {
    let stamps: BTreeMap<String, String> = serde_json::from_str(&std::fs::read_to_string(claude_dir(env).join(KIT_STAMP)).ok()?).ok()?;
    stamps.get(KIT_VERSION_KEY).cloned()
}

fn sessions(env: &Env, root: &Path) -> Store {
    Store::new(&env.xdg_config, root, "claude-sessions", "ccc .")
}

/// `8sync ccc . ls`: per session — running?, last request, last action, task
/// progress (rendering shared with `8sync . ls` in `session_view.rs`).
/// This repo's sessions as `ls --json` rows (also the input of `ccc . report`).
fn session_rows_json(env: &Env, root: &Path) -> Vec<Value> {
    use super::session_view as view;
    let reg = sessions(env, root).load();
    let rows = view::uuid_rows(env, "ccc", &reg, &view::agent_cmdlines(), false);
    debug_assert_eq!(rows.len(), reg.sessions.len(), "one row per registry entry (zip below)");
    let order = urgent::newest_first(&rows.iter().map(|r| r.last_active).collect::<Vec<_>>());
    order
        .into_iter()
        .map(|i| {
            let mut v = view::row_json(&rows[i]);
            v["id"] = json!(reg.sessions[i].conversation_id);
            v["urgency"] = urgent::json(&reg.sessions[i]);
            v["goal"] = goal::json(reg.sessions[i].goal.as_ref());
            v
        })
        .collect()
}

fn view_now() -> u64 {
    super::session_view::now_secs()
}

fn print_sessions(env: &Env, root: &Path, json: bool) -> Result<()> {
    use super::session_view as view;
    if json {
        println!("{}", serde_json::to_string_pretty(&session_rows_json(env, root))?);
        return Ok(());
    }
    let reg = sessions(env, root).load();
    let rows = view::uuid_rows(env, "ccc", &reg, &view::agent_cmdlines(), false);
    if rows.is_empty() {
        ui::info("no sessions yet — create one with `8sync ccc . <name>`");
        return Ok(());
    }
    ui::header(&format!("Claude Code sessions · {}", root.display()));
    let (now, width, color) = (view::now_secs(), view::term_width(), view::use_color());
    debug_assert_eq!(rows.len(), reg.sessions.len(), "one row per registry entry");
    for i in urgent::newest_first(&rows.iter().map(|r| r.last_active).collect::<Vec<_>>()) {
        let mut lines = view::render(&rows[i], width, now, color);
        urgent::decorate(&mut lines, reg.sessions[i].urgency.as_ref(), width, now, color);
        if let Some(g) = &reg.sessions[i].goal {
            lines.insert(1.min(lines.len()), goal::line(g, width));
        }
        // Which sessions take HQ work the moment they are idle (mod loaded) vs. at the next turn end:
        // only sessions HQ can address through an inbox (a session id), active in the last day.
        let cid = &reg.sessions[i].conversation_id;
        if now.saturating_sub(rows[i].last_active) < 86_400 && super::hq::inbox_file(&env.home, cid).is_some() {
            let live = super::hq::inbox_live(&env.home, cid, std::time::SystemTime::now());
            lines.push(format!("      {}", super::hq::inbox_line(live)));
        }
        for l in lines {
            println!("{l}");
        }
    }
    println!("\n  8sync ccc . <name> resume  ·  8sync ccc . urgent <high|med|low|clear> [note]  ·  8sync ccc . goal <mục tiêu> [--files a,b]  ·  8sync ccc . new <name>  ·  8sync show <name> --engine ccc  ·  8sync ls --all");
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

/// `8sync ccc auto up|down` ([`team`]): the project's role rooms as Claude Code background sessions.
fn auto_team(env: &Env, root: &Path, rest: &[String]) -> Result<()> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let subscription = login_kind_at(&env.home).kind == "subscription";
    let store = sessions(env, root);
    let bin = team::Bin { exe: ensure_claude(true)?, root };
    let has = |id: &str| transcripts(env, id).next().is_some();
    let sessions_dir = claude_dir(env).join("sessions");
    let title = |n: &str| display_name(&sessions_dir, n, root);
    // The kit writes its hooks into settings.json: rooms that started before that run old hooks.
    let kit_at = std::fs::metadata(claude_dir(env).join("settings.json"))
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    let t = team::Team { home: &env.home, root, store: &store, subscription, claude: &bin, has_transcript: &has, title: &title, kit_at };
    if rest[0] == "revive" {
        let rows = team::revive(&t, auto::DEFAULT_LOOP_MIN, now)?;
        for r in &rows {
            println!("{} ({}): {} {}", r.name, r.role, r.state, r.short);
        }
        return Ok(());
    }
    if rest[0] == "down" {
        if let Some(x) = rest.get(1) {
            bail!("không rõ `{x}`\n{}", team::USAGE);
        }
        let stopped = team::down(&t, now)?;
        if stopped.is_empty() {
            println!("không có phòng nền nào của dự án này đang chạy.");
        } else {
            println!("đã dừng {} phòng nền: {} (hội thoại giữ nguyên; mở lại: `8sync ccc auto up`).", stopped.len(), stopped.join(", "));
        }
        omp_team::print_down(&omp_team::down(env, root)?);
        println!("auto: TẠM DỪNG (owner). Phòng mở trong terminal không bị đóng.");
        return Ok(());
    }
    // `--omp-model <provider/model>` (team omp's model) is ours; team::parse sees the rest.
    let mut args = rest[1..].to_vec();
    let team_model = match args.iter().position(|a| a == "--omp-model") {
        Some(i) => {
            let m = args.get(i + 1).filter(|v| !v.starts_with("--")).cloned().ok_or_else(|| anyhow::anyhow!("--omp-model cần một giá trị\n{}", team::USAGE))?;
            args.drain(i..i + 2);
            Some(auto::checked_model("--omp-model", &m)?)
        }
        None => None,
    };
    let o = team::parse(&args)?;
    if team_model.is_some() && !o.omp {
        bail!("--omp-model đi cùng --omp\n{}", team::USAGE);
    }
    // `--omp` = `auto omp on` first, so `up`'s auto on keeps it in `teams`; refused only for omp.
    let blocked = if o.omp {
        auto::omp_on(&env.home, team_model.as_deref(), now).err().map(|e| e.to_string())
    } else {
        auto::omp_blocked(&env.home)
    };
    // One resumer at a time: HQ's revive and this `up` must not fork the same dead room twice.
    let Some(_lock) = team::revive_lock(&env.home, now)? else {
        bail!("đang có `auto revive` / `auto up` khác mở phòng (HQ tự mở lại phòng chết) — chờ ít phút rồi chạy lại");
    };
    let (status, gone, rows) = team::up(&t, &o, now)?;
    team::print_up(&status, &gone, &rows, o.every, subscription);
    // Team omp: `--omp`, or omp already in auto.json's teams (turned on from HQ).
    if omp_team::wanted(o.omp, &status) {
        match blocked {
            Some(why) => println!("đội omp: không mở — {why}"),
            None => {
                let model = auto::omp_model(&env.home);
                omp_team::print_up(&omp_team::up(env, root, &o.roles, model.as_deref()), model.as_deref());
            }
        }
    }
    Ok(())
}

/// Create-or-resume `name`: a fresh session takes the registry UUID and the
/// name as its display title; once Claude Code has a transcript, resume by UUID.
fn open(env: &Env, root: &Path, name: &str, refuse_existing: bool, extra: &[String], offline: bool) -> Result<()> {
    let (team, panes, extra) = team_flags(extra)?;
    let extra = &extra[..];
    let s = sessions(env, root).touch(name, refuse_existing)?;
    let claude = ensure_claude(offline)?;
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
        let title = display_name(&claude_dir(env).join("sessions"), &s.name, root);
        if title != s.name {
            ui::info(&format!("\"{}\" đang là tên một session ở dự án khác: đặt tên \"{title}\" (cố định, `8sync ccc . {}` vẫn mở đúng phòng này)", s.name, s.name));
        }
        cmd.args(["--session-id", &s.conversation_id, "--name", &title]);
    }
    cmd.args(extra).current_dir(root);
    match fence::wrap(&cmd, &env.home) {
        Some(mut fenced) => {
            ui::info(&format!("fence: {} (RAM soft cap 70%, CPU/IO weight 50) · off: EIGHTSYNC_FENCE=0", fence::SLICE));
            launch(&mut fenced)
        }
        None => launch(&mut cmd),
    }
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
/// Claude Code session names are machine-wide: when a session in another folder already goes by
/// `name`, Claude Code appends a random suffix ("rd-crispy-sutton"), a different one at every new
/// launch. Take a stable `<name>-<repo dir>` then (the name stays first, so `room::role` and the
/// R&D detection still see it). Reads Claude Code's `sessions/<pid>.json` records (undocumented,
/// 2.1.29x; never the `.key` files beside them); a stale record only costs the stable rename.
fn display_name(sessions_dir: &Path, name: &str, root: &Path) -> String {
    let norm = |p: &str| p.replace('\\', "/").trim_end_matches('/').to_lowercase();
    let here = norm(&root.to_string_lossy());
    let taken_elsewhere = std::fs::read_dir(sessions_dir).into_iter().flatten().flatten().any(|e| {
        let p = e.path();
        p.extension().is_some_and(|x| x == "json")
            && std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).is_some_and(|r| {
                // Same repo, not just a path inside it: a nested repo's "lead" is another room.
                let raw = r["cwd"].as_str().unwrap_or_default();
                let cwd = norm(raw);
                let same = match crate::verbs::here::repo_of(Path::new(raw)) {
                    Some(repo) => norm(&repo.to_string_lossy()) == here,
                    None => cwd == here || cwd.starts_with(&format!("{here}/")),
                };
                r["name"].as_str() == Some(name) && !same
            })
    });
    let repo: String = root.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let repo = repo.trim_matches('-');
    if taken_elsewhere && !repo.is_empty() {
        format!("{name}-{repo}")
    } else {
        name.to_string()
    }
}

/// `8sync ccc auto board --json` as if run with `cwd` as the working directory (the HQ core's
/// `/v1/board`): same repo resolution as the `auto` verb, same object.
pub(crate) fn board_json_at(home: &Path, cwd: &Path) -> Result<serde_json::Value> {
    let root = crate::verbs::here::detect_project_root(cwd).unwrap_or_else(|| cwd.to_path_buf());
    let repo = crate::verbs::here::repo_of(cwd).unwrap_or(root);
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
    auto::board_value(home, &repo, now)
}

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
/// (`~/.local/bin/claude`, self-updating). Offline: only look, never install.
pub(crate) fn ensure_claude(offline: bool) -> Result<PathBuf> {
    ensure_claude_with(offline, find_claude, install_claude)
}

fn ensure_claude_with(offline: bool, find: impl Fn() -> Option<PathBuf>, install: impl FnOnce() -> Result<()>) -> Result<PathBuf> {
    if let Some(p) = find() {
        return Ok(p);
    }
    net_allowed(offline, "Claude Code installer").context("`claude` is not on PATH: install Claude Code first, then retry")?;
    install()?;
    find().context("Claude Code installed but `claude` was not found in ~/.local/bin")
}

fn install_claude() -> Result<()> {
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
    Ok(())
}

// ── the kit ─────────────────────────────────────────────────────────────────

/// Kit files: (asset path, path under Claude Code's config dir). The shared
/// skills come from omp's bundled tree, so both harnesses read one source.
const KIT_FILES: [(&str, &str); 40] = [
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
    ("claude/agents/critic.md", "agents/critic.md"),
    ("claude/skills/ship/SKILL.md", "skills/ship/SKILL.md"),
    ("claude/skills/planning/SKILL.md", "skills/planning/SKILL.md"),
    ("claude/skills/ui-ux/SKILL.md", "skills/ui-ux/SKILL.md"),
    ("claude/skills/remember/SKILL.md", "skills/remember/SKILL.md"),
    ("claude/skills/consolidate/SKILL.md", "skills/consolidate/SKILL.md"),
    ("claude/skills/rules/SKILL.md", "skills/rules/SKILL.md"),
    ("claude/skills/sec/SKILL.md", "skills/sec/SKILL.md"),
    ("claude/skills/harden/SKILL.md", "skills/harden/SKILL.md"),
    ("claude/skills/do/SKILL.md", "skills/do/SKILL.md"),
    ("claude/skills/ship-auto/SKILL.md", "skills/ship-auto/SKILL.md"),
    ("claude/skills/ship-loop/SKILL.md", "skills/ship-loop/SKILL.md"),
    ("claude/skills/autopilot/SKILL.md", "skills/autopilot/SKILL.md"),
    ("claude/skills/ship-tick/SKILL.md", "skills/ship-tick/SKILL.md"),
    ("claude/skills/sysdesign/SKILL.md", "skills/sysdesign/SKILL.md"),
    ("claude/skills/sprint/SKILL.md", "skills/sprint/SKILL.md"),
    ("skills/aup-audit/SKILL.md", "skills/aup-audit/SKILL.md"),
    ("skills/aup-audit/RULES.md", "skills/aup-audit/RULES.md"),
    // The org's rules: summarised in the kit's CLAUDE.md block, full text opened on demand (/aup-audit).
    ("skills/aup-audit/8sync-anthropic-rules.md", "skills/aup-audit/8sync-anthropic-rules.md"),
    ("skills/deep-research/SKILL.md", "skills/deep-research/SKILL.md"),
    ("skills/deep-research/references/binary-weight-audit.md", "skills/deep-research/references/binary-weight-audit.md"),
    // Mod `8sync-hints` (Claude Code function hooks): a plugin folder under ~/.claude/skills is
    // auto-loaded, so this is all it takes for ghost text + typeahead + the band above the prompt.
    ("configs/claude/mods/8sync-hints/.claude-plugin/plugin.json", "skills/8sync-hints/.claude-plugin/plugin.json"),
    ("configs/claude/mods/8sync-hints/hooks/hooks.json", "skills/8sync-hints/hooks/hooks.json"),
    ("configs/claude/mods/8sync-hints/hooks/register.tsx", "skills/8sync-hints/hooks/register.tsx"),
    ("configs/claude/mods/8sync-hints/hooks/hint.ts", "skills/8sync-hints/hooks/hint.ts"),
    ("configs/claude/mods/8sync-hints/types/index.d.ts", "skills/8sync-hints/types/index.d.ts"),
    // Mod `8sync-inbox`: hands the owner's HQ tasks to an idle session (`8sync ccc inbox`); the
    // Stop hook alone only delivered them when a turn ended, so an idle session never got them.
    ("configs/claude/mods/8sync-inbox/.claude-plugin/plugin.json", "skills/8sync-inbox/.claude-plugin/plugin.json"),
    ("configs/claude/mods/8sync-inbox/hooks/hooks.json", "skills/8sync-inbox/hooks/hooks.json"),
    ("configs/claude/mods/8sync-inbox/hooks/register.ts", "skills/8sync-inbox/hooks/register.ts"),
    ("configs/claude/mods/8sync-inbox/hooks/inbox.ts", "skills/8sync-inbox/hooks/inbox.ts"),
];

/// Files an earlier kit installed and this one dropped: deleted while they are
/// still exactly what 8sync wrote (the `plan` agent: the main agent plans in
/// its own context instead of paying a second Opus context for it).
const RETIRED: [&str; 1] = ["agents/plan.md"];

/// Hashes of the files as 8sync last wrote them: a file whose current content
/// no longer matches was edited by the user and is left alone.
const KIT_STAMP: &str = ".8sync-kit.json";

/// The kit's Claude Code mods (function-hook plugins): every `skills/<name>/` holding a manifest.
fn kit_mods() -> Vec<&'static str> {
    KIT_FILES
        .iter()
        .filter_map(|(_, rel)| rel.strip_prefix("skills/")?.strip_suffix("/.claude-plugin/plugin.json"))
        .collect()
}

/// A running session loads a mod once, at start: after the kit rewrote any file of a mod, the
/// owner's open sessions keep the old one until `/reload-plugins` (no restart needed —
/// code.claude.com/docs/en/plugins/loading). `rewritten`: kit files that existed before and
/// changed (a first install has no session holding an old copy). None when no mod file changed.
pub(crate) const RELOAD_HINT: &str = "phiên Claude Code đang mở gõ /reload-plugins để nhận (không cần restart)";

fn reload_hint(rewritten: &[&str]) -> Option<String> {
    let mods: Vec<&str> = kit_mods().into_iter().filter(|m| rewritten.iter().any(|w| w.starts_with(&format!("skills/{m}/")))).collect();
    (!mods.is_empty()).then(|| format!("mod {} đổi: {RELOAD_HINT}", mods.join(", ")))
}
/// Stamp entry holding the 8sync version that wrote the kit: a launch on a
/// newer binary refreshes the kit once.
const KIT_VERSION_KEY: &str = "8sync";
const CLAUDE_MD_BEGIN: &str = "<!-- 8sync:kit:begin -->";
const CLAUDE_MD_END: &str = "<!-- 8sync:kit:end -->";

/// Rules merged into `permissions.deny` (`**/` covers monorepo sub-packages).
/// Path rules only work as `Read(...)` / `Edit(...)`: Claude Code accepts a
/// `Write(...)` path rule but never consults it.
/// No `Edit(**/.env*)`: Claude Code applies Edit deny rules to `rm`/`sed`/redirects in Bash,
/// so it blocked deleting a stray `.env` copy; the guard still denies printing a credential
/// file and writing a real secret anywhere (see RETIRED_DENY).
/// The HQ owner files (UI token, public-link key, Discord secrets, usage snapshots, permit
/// answers, inbox) back the guard's Bash/Write check for the Read tool, which the guard does not see.
const DENY: [&str; 22] = [
    "Read(**/.env)",
    "Read(**/.env.*)",
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
    "Read(~/.config/8sync/hq/ui-token)",
    "Read(~/.config/8sync/hq/public.json)",
    "Edit(~/.config/8sync/hq/public.json)",
    "Read(~/.config/8sync/hq/secrets.json)",
    "Edit(~/.config/8sync/hq/secrets.json)",
    "Edit(~/.local/state/8sync/ccc/permit/**)",
    "Edit(~/.local/state/8sync/hq/inbox/**)",
    "Edit(~/.local/state/8sync/hq/usage/**)",
];

/// Deny rules earlier kits wrote and this one takes back (owner decision 2026-10-14).
const RETIRED_DENY: [&str; 2] = ["Edit(**/.env)", "Edit(**/.env.*)"];

/// Tag on the `autoMode.environment` entries the kit owns: re-running the kit replaces them,
/// entries the owner wrote are never touched.
const AUTO_ENV_TAG: &str = "(8sync kit)";

/// What the auto mode classifier should know about 8 Sync's infrastructure
/// (https://code.claude.com/docs/en/auto-mode-config). Prose, read as rules by the classifier;
/// `$defaults` keeps Anthropic's built-in entries, and no allow/soft_deny/hard_deny is changed.
const AUTO_ENV: [&str; 5] = [
    "Organization (8sync kit): 8 Sync, a small product team. Primary use: software development of its own products (Next.js on Vercel, Encore Go/TypeScript backends on Encore Cloud, Tauri 2 + Rust desktop apps, Postgres).",
    "Source control (8sync kit): the GitHub orgs github.com/8-Sync-Dev and github.com/8syncdev and every repository under them.",
    "Trusted internal domains (8sync kit): 8syncdev.com and its subdomains.",
    "CI/CD deploy targets (8sync kit): the owner's Vercel projects and Encore Cloud apps (a push to the `encore` git remote deploys). Production deploys still need the owner's explicit request in the conversation.",
    "Secrets management (8sync kit): Encore secrets, Vercel env vars and GitHub Actions secrets are set with `8sync ccc secret set`, which pipes a value from the owner's local env file, or a freshly generated random value, straight into the provider CLI's stdin; the value never appears in the transcript, in argv, in a file the agent writes, or in git. Printing, copying or committing secret values remains forbidden.",
];

/// Rules merged into `permissions.allow`: the build/test/lint commands the
/// verify hook already runs for these stacks, plus `git add` (the guard hook
/// still inspects it). In auto mode every non-read-only shell command
/// otherwise waits for a classifier review — measured ~0.65 s per
/// `cargo check` (5 runs: 14.9 s auto, 12.0 s with an allow rule, 11.4 s
/// bypass). Narrow prefixes only: Claude Code matches each part of a compound
/// command (`&&`, `;`, `|`) separately; commits, pushes and anything that
/// discards work stay reviewed. `EnterWorktree`/`ExitWorktree` only add or leave a
/// worktree inside the repo (room playbook: one per card); in the UAT 2026-10-17 a
/// background dev room sat on a permission prompt for it until the owner attached.
const ALLOW: [&str; 17] = [
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
    "EnterWorktree",
    "ExitWorktree",
];

/// The ask gate's prompt starts with this, which is how a re-merge finds it.
const GATE_MARKER: &str = "8sync gate";

/// The bar for interrupting the user. A numbered checklist, because Haiku given a
/// prose rule refused credential and pricing questions. Kept short on purpose:
/// when the gate denies, Claude Code prints the WHOLE prompt in the error line
/// (`PreToolUse:AskUserQuestion hook error: [<prompt>]: <reason>`), so every
/// extra sentence is noise in the owner's terminal. The native Stop gate
/// (`gate.rs`) applies the same bar to a turn's last line.
const ASK_POLICY: &str = "1. Secret or access (key, token, login, account) → JUSTIFIED.\n\
2. Destructive, irreversible, paid or outward action (delete, prod deploy, force-push, message people, \
spend money) → JUSTIFIED.\n\
3. Product direction, scope, or loosening a safety/compliance rail → JUSTIFIED.\n\
4. Anything else (repo facts, naming, wording, minor technical choice, \"continue?\") → NOT JUSTIFIED.";

/// Hook roles earlier kits installed and this one dropped: (event, role). The
/// Haiku `Stop` prompt gate re-sent the whole transcript at every turn end
/// (~2.6 s and ~30k Haiku tokens per turn end, ~48k per bench run); `verify-stop` now runs the gate natively.
const RETIRED_HOOKS: [(&str, &str); 1] = [("Stop", "8sync gate: stop")];

/// Hook-matcher for the guard: Windows without Git Bash only has `PowerShell`,
/// whose commands no `Bash(...)` rule or `Bash` matcher sees.
const GUARD_MATCHER: &str = "Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit";
/// Prompt hook on `PreToolUse` for `AskUserQuestion`: unjustified questions are
/// returned to Claude as a tool error (`continueOnBlock`), so it decides and goes on.
const ASK_GATE: &str = "8sync gate: ask. Input: $ARGUMENTS\n\
First match: 1-3 → {\"ok\": true}; 4 → {\"ok\": false, \"reason\": \"Don't ask: go with <option>, <why>.\"}\n";

/// A hook `model` must be a full id — an alias fails as `unrecognized_model` and
/// the hook then fails open. The ASK gate stays on Sonnet: on the same prompt
/// Haiku misjudged 2 of 6 labelled questions, Sonnet none. Evidence measured on
/// the previous pair (Sonnet 5 vs Haiku 4.5); not re-measured on 5.5.
const ASK_GATE_MODEL: &str = "claude-sonnet-5-5";

/// Skills the kit itself relies on: never demoted by `skillOverrides`.
/// Includes the repo-rule skills (always-on or required for UI), whose trigger
/// text must not be dropped.
const CORE_SKILLS: [&str; 16] =
    ["ship", "ship-loop", "ship-tick", "autopilot", "sprint", "ui-ux", "planning", "remember", "aup-audit", "deep-research", "sysdesign", "8sync-cli", "codegraph", "karpathy-guidelines", "ponytail", "impeccable"];

/// Install or refresh the kit in Claude Code's user config. Idempotent.
pub(crate) fn install_kit(env: &Env, force: bool, offline: bool) -> Result<()> {
    install_kit_at(env, &claude_dir(env), force, offline)
}

/// Offline: every file write and the local skill linking still happen; only the
/// MCP mirroring (`claude mcp add-json`) is skipped.
fn install_kit_at(env: &Env, dir: &Path, force: bool, offline: bool) -> Result<()> {
    ui::step("Claude Code kit → ~/.claude (agents · skills · verify hook · guard · stop + ask gates)");
    let dir = dir.to_path_buf();
    let stamp_path = dir.join(KIT_STAMP);
    let mut stamps: BTreeMap<String, String> = std::fs::read_to_string(&stamp_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let mut kept = Vec::new();
    let mut rewritten = Vec::new();
    for (asset, rel) in KIT_FILES {
        let body = crate::verbs::harness::cbm::gate(
            &env.home,
            &assets::read(asset).with_context(|| format!("asset missing: {asset}"))?,
        );
        let target = dir.join(rel);
        match std::fs::read_to_string(&target) {
            Ok(cur) if cur == body => {}
            Ok(cur) if !force && stamps.get(rel) != Some(&fnv1a(&cur)) => {
                kept.push(rel);
                continue;
            }
            existed => {
                std::fs::create_dir_all(target.parent().unwrap_or(&dir))?;
                std::fs::write(&target, &body).with_context(|| format!("write {}", target.display()))?;
                if existed.is_ok() {
                    rewritten.push(rel);
                }
            }
        }
        stamps.insert(rel.to_string(), fnv1a(&body));
    }
    if let Some(hint) = reload_hint(&rewritten) {
        ui::info(&hint);
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
    match deploy::link_library_skills(&env.home, &dir.join("skills")) {
        Ok(0) => {}
        Ok(n) => ui::ok(&format!("{n} workspace skill(s) linked from {} (listed by name only)", deploy::skill_libraries(&env.home).iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", "))),
        Err(e) => ui::warn(&format!("workspace skills not linked: {e:#}")),
    }
    let skills = linked_bundled_skills(&env.home, &dir.join("skills"));
    for rel in &kept {
        ui::info(&format!("kept your edited {} (`8sync ccc kit --force` overwrites)", dir.join(rel).display()));
    }

    let rules = crate::verbs::harness::cbm::gate(
        &env.home,
        &assets::read("configs/claude/CLAUDE.md").context("asset missing: configs/claude/CLAUDE.md")?,
    );
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
    for m in statusline::kit_apply(&mut v, &exe, &statusline::features(&env.home))? {
        ui::ok(&m);
    }
    let out = serde_json::to_string_pretty(&v)? + "\n";
    if out != raw {
        std::fs::write(&settings, out).with_context(|| format!("write {}", settings.display()))?;
    }
    let agents = KIT_FILES.iter().filter(|(_, rel)| rel.starts_with("agents/")).count();
    ui::ok(&format!(
        "kit: {agents} agents · /ship · /aup-audit · deep-research · verify hook · guard · stop + ask gates · auto mode · CLAUDE.md rules ({})",
        dir.display()
    ));

    let mcp_ok = net_allowed(offline, "MCP mirror (`claude mcp add-json`)").is_ok();
    if let Some(claude) = find_claude().filter(|_| mcp_ok) {
        mirror_mcp(env, &claude);
    } else if mcp_ok {
        ui::info("MCP: run `8sync ccc kit` again after `claude` is installed to add opted-in MCP servers (harness serena|cbm on)");
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
/// `env`, `defaultMode`, `disableBypassPermissionsMode`, `effortLevel`, `disableClaudeAiConnectors` and `autoContinueAtUsageLimit` defaults
/// (a user value wins), `permissions` rules, and 8sync's hooks (replaced in
/// place on re-run, retired ones removed, so the file only changes when the kit does).
fn apply_kit_settings(v: &mut Value, exe: &str, skills: &[String]) -> Result<()> {
    // Auto-compact at 65% of the model window unless the owner chose a value (`8sync ccc compact --at N`).
    compact::kit_default(v)?;
    // Tool-output budget (Bash 20k chars, Read 15k tokens), only when absent; see output_budget.rs.
    output_budget::kit_default(v)?;
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
    // A claude.ai usage limit mid-task: wait in the open session and continue after the reset
    // (Claude Code v2.1.234+, on by default; https://code.claude.com/docs/en/interactive-mode
    // "Wait for a usage limit to reset"). Pinned so a long task never stalls on a changed
    // default; an owner's `false` (/config) wins. Same account, same plan: no account switching.
    obj.entry("autoContinueAtUsageLimit").or_insert_with(|| json!(true));
    let Some(perms) = obj.entry("permissions").or_insert_with(|| json!({})).as_object_mut() else {
        bail!("settings.json `permissions` is not an object");
    };
    perms.entry("defaultMode").or_insert_with(|| json!("auto"));
    // A launcher flag beats `defaultMode`: Orca's default args for claude are
    // `--dangerously-skip-permissions`, so its sessions opened in bypass (owner 2026-10-17).
    // With this key Claude Code rejects the flag and starts in `defaultMode` (seen on 2.1.296:
    // `"permissionMode":"auto"`); works from user settings (code.claude.com/docs/en/permissions).
    perms.entry("disableBypassPermissionsMode").or_insert_with(|| json!("disable"));
    for (key, rules) in [("deny", &DENY[..]), ("allow", &ALLOW[..])] {
        if let Some(list) = perms.entry(key).or_insert_with(|| json!([])).as_array_mut() {
            if key == "deny" {
                list.retain(|r| !r.as_str().is_some_and(|s| RETIRED_DENY.contains(&s)));
            }
            for rule in rules {
                if !list.iter().any(|r| r == rule) {
                    list.push(json!(rule));
                }
            }
        }
    }
    apply_auto_env(obj);
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
            "matcher": "startup|resume|clear|compact",
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
    // Owner-delegated questions (`8sync ccc delegate on`): a no-op unless the owner turned it on;
    // then product/technical AskUserQuestion calls are denied with "let the critic pick".
    upsert_hook_group(
        hooks,
        "PreToolUse",
        json!({ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "delegate"], "timeout": 5 }] }),
    );
    // A permission prompt in a room the owner is away from: wait for the owner's HQ click, then deny
    // with a "skip it, note the card, go on" message. A no-op unless auto + delegate are on.
    upsert_hook_group(
        hooks,
        "PermissionRequest",
        json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "permit"], "timeout": permit::HOOK_TIMEOUT_S }] }),
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
    // Watchdog alerts -> additionalContext (shape per https://code.claude.com/docs/en/hooks:
    // `hookSpecificOutput.{hookEventName, additionalContext}`). Synchronous: it must land before the
    // next model turn; a no-op (no output) unless `8sync watchdog` wrote something new.
    for event in ["UserPromptSubmit", "PostToolUse"] {
        upsert_hook_group(
            hooks,
            event,
            json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "watchdog"], "timeout": 5 }] }),
        );
    }
    // The owner's one-time ship approval (AskUserQuestion header "Ship") → per-session grant
    // the guard honours for merge/tag/release/publish/deploy steps.
    upsert_hook_group(
        hooks,
        "PostToolUse",
        json!({ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "ship-grant"], "timeout": 5 }] }),
    );
    // A turn that dies on an API error fires StopFailure, not Stop: record it, and remind
    // Claude on the next prompt (https://code.claude.com/docs/en/hooks, StopFailure).
    upsert_hook_group(
        hooks,
        "StopFailure",
        json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "stop-failure"], "timeout": 5 }] }),
    );
    upsert_hook_group(
        hooks,
        "UserPromptSubmit",
        json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "resume-note"], "timeout": 5 }] }),
    );
    // Scheduled HQ prompts (`[8sync:wake]`): skip a fire while the session is busy or just ran one,
    // before it reaches Claude (UserPromptSubmit also fires on CronCreate / /loop prompts).
    upsert_hook_group(
        hooks,
        "UserPromptSubmit",
        json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "wake"], "timeout": 5 }] }),
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
    // "Không ai rảnh" (`ccc idle on`): sync, so TeammateIdle exit 2 / Stop block can keep the
    // team working. A no-op while the feature is off (default). Separate groups from `hq hook`.
    upsert_hook_group(hooks, "TeammateIdle", json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "idle"], "timeout": 10 }] }));
    upsert_hook_group(hooks, "Stop", json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "idle"], "timeout": 10 }] }));
    // Its quality gate: exit 2 keeps a task open when code was edited after the last check.
    upsert_hook_group(hooks, "TaskCompleted", json!({ "hooks": [{ "type": "command", "command": exe, "args": ["ccc", "hook", "task-done"], "timeout": 10 }] }));
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

const HQ_EVENTS: [&str; 8] = ["TaskCreated", "TaskCompleted", "TeammateIdle", "Notification", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop"];

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

/// Put the kit's `autoMode.environment` entries in (replacing older kit entries, keeping the
/// owner's). A list the kit creates starts with `$defaults`; an existing list is never given
/// `$defaults` by us, since leaving it out was the owner's choice.
fn apply_auto_env(obj: &mut serde_json::Map<String, Value>) {
    let Some(auto) = obj.entry("autoMode").or_insert_with(|| json!({})).as_object_mut() else { return };
    let Some(list) = auto.entry("environment").or_insert_with(|| json!(["$defaults"])).as_array_mut() else { return };
    list.retain(|e| !e.as_str().is_some_and(|s| s.contains(AUTO_ENV_TAG)));
    list.extend(AUTO_ENV.iter().map(|e| json!(e)));
}

/// `kit --remove`: take the kit's environment entries out; an environment left as just
/// `$defaults` (what the kit created) goes too, so is an empty `autoMode`.
fn strip_auto_env(v: &mut Value) -> bool {
    let Some(auto) = v.get_mut("autoMode").and_then(Value::as_object_mut) else { return false };
    let Some(list) = auto.get_mut("environment").and_then(Value::as_array_mut) else { return false };
    let before = list.len();
    list.retain(|e| !e.as_str().is_some_and(|s| s.contains(AUTO_ENV_TAG)));
    let changed = list.len() != before;
    if changed && list.iter().all(|e| e == "$defaults") {
        auto.remove("environment");
    }
    if auto.is_empty() {
        v.as_object_mut().map(|o| o.remove("autoMode"));
    }
    changed
}

/// Replace `path` with `new` by tmp+rename, after saving `old` (its current content) to
/// `<name>.bak-8sync`. Keeps the file's permissions; a crash never leaves a half-written file.
pub(super) fn write_atomic_bak(path: &Path, old: &str, new: &str) -> Result<()> {
    let name = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    std::fs::write(path.with_file_name(format!("{name}.bak-8sync")), old).context("write backup")?;
    let tmp = path.with_file_name(format!("{name}.tmp-8sync"));
    std::fs::write(&tmp, new)?;
    if let Ok(m) = std::fs::metadata(path) {
        let _ = std::fs::set_permissions(&tmp, m.permissions());
    }
    std::fs::rename(&tmp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(())
}

/// Strip 8sync hooks from the settings file at `path`. Nothing removed: nothing
/// written. Otherwise the original goes to `settings.json.bak-8sync` and the new
/// file replaces it by rename (a crash never leaves a half-written settings.json).
#[cfg(test)]
fn remove_kit_hooks_at(path: &Path) -> Result<usize> {
    let raw = std::fs::read_to_string(path)?;
    remove_kit_hooks_from(path, &raw)
}

/// Strip hooks from the current content of `path`; `orig` is the content from before this run
/// (the backup source, so a statusLine step that already wrote the backup is not clobbered).
fn remove_kit_hooks_from(path: &Path, orig: &str) -> Result<usize> {
    let raw = std::fs::read_to_string(path)?;
    let mut v: Value = serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))?;
    let n = strip_kit_hooks(&mut v);
    let compact = compact::strip_kit_default(&mut v) | output_budget::strip_kit_default(&mut v);
    let auto = strip_auto_env(&mut v);
    if n == 0 && !compact && !auto {
        return Ok(0);
    }
    write_atomic_bak(path, orig, &(serde_json::to_string_pretty(&v)? + "\n"))?;
    Ok(n)
}

/// `8sync ccc kit --remove`: take 8sync's hooks out of ~/.claude/settings.json before
/// uninstalling 8sync. The guard fails closed (`onFailure: "block"`), so a hook left
/// pointing at a missing binary would block every Bash/Edit call.
fn remove_kit_hooks(env: &Env) -> Result<()> {
    remove_kit_hooks_in(&claude_dir(env).join("settings.json"), &statusline::features(&env.home))
}

fn remove_kit_hooks_in(path: &Path, fp: &Path) -> Result<()> {
    // Read the original before any write: the .bak-8sync must hold it, whichever step writes first.
    let orig = std::fs::read_to_string(path).unwrap_or_default();
    match statusline::uninstall_at(path, fp) {
        Ok(msgs) => {
            for m in msgs {
                ui::ok(&m);
            }
        }
        // Non-fatal: a broken features.toml or statusLine must not keep the guard hooks in place.
        Err(e) => ui::warn(&format!("statusline not restored: {e:#}")),
    }
    if !path.is_file() {
        ui::info("no ~/.claude/settings.json — nothing to remove");
        return Ok(());
    }
    match remove_kit_hooks_from(path, &orig)? {
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
/// links (symlink / Windows junction) resolving under omp's bundled tree or a
/// registered workspace skill library, i.e. the ones `link_bundled_skills` /
/// `link_library_skills` manage. Plain user directories are skipped.
fn linked_bundled_skills(home: &Path, skills_dir: &Path) -> Vec<String> {
    let roots: Vec<PathBuf> = std::iter::once(home.join(".omp/skills")).chain(deploy::skill_libraries(home)).filter_map(|p| p.canonicalize().ok()).collect();
    if roots.is_empty() {
        return Vec::new();
    }
    let mut out: Vec<String> = std::fs::read_dir(skills_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let Ok(meta) = std::fs::symlink_metadata(e.path()) else { return false };
            is_link(&meta) && e.path().canonicalize().is_ok_and(|t| roots.iter().any(|r| t.starts_with(r)))
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

/// A KNOWLEDGE.md lesson line: `- failure:` / `- validated:` / `- decision:` (what `/remember`
/// writes), optionally bold (`- **failure:`).
fn is_lesson(l: &str) -> bool {
    let Some(rest) = l.strip_prefix("- ") else { return false };
    let rest = rest.strip_prefix("**").unwrap_or(rest);
    rest.starts_with("failure:") || rest.starts_with("validated:") || rest.starts_with("decision:")
}

/// Stable digest for `hook session-start`: head of `su-code/STATE.md`, then the
/// last failure/validated lines of `su-code/KNOWLEDGE.md`. No timestamps, so the
/// prompt prefix stays cache-stable. Empty when the repo has no `su-code/STATE.md`.
fn session_digest(root: &Path) -> String {
    const CAP: usize = 6000;
    let Ok(state) = std::fs::read_to_string(root.join("su-code/STATE.md")) else { return String::new() };
    // The running `/ship` (su-code/ship/ACTIVE → su-code/ship/<slug>/STATE.md) comes first.
    let mut out = active_ship(root).unwrap_or_default();
    out.push_str(&state.lines().take(60).collect::<Vec<_>>().join("\n"));
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

/// `hook session-start`: repo digest, plus this session's thread on compact/resume.
fn session_start_output(input: &str, home: Option<&Path>) -> Option<String> {
    let v = serde_json::from_str::<Value>(input).unwrap_or(Value::Null);
    let start = v["cwd"].as_str().map(PathBuf::from).or_else(|| std::env::current_dir().ok()).unwrap_or_default();
    let root = find_state_root(&start, home);
    let mut out = root.map(|r| session_digest(&r)).unwrap_or_default();
    // The room this session is (its registry name → role, recall, what other rooms are doing).
    if let Some(h) = home {
        let claude = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| h.join(".claude"));
        let cfg = dirs::config_dir().unwrap_or_else(|| h.join(".config"));
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        // shared 10,000-char hook limit: the room gets what the digest (and, on compact/resume,
        // the ~3,000-char thread block) leaves, up to room::CAP
        let reserve = if matches!(v["source"].as_str(), Some("compact" | "resume")) { 3_200 } else { 200 };
        let left = 10_000usize.saturating_sub(reserve + out.chars().count() + 2).min(room::CAP);
        let r = if left >= 300 { room::for_session(&v, &claude, &cfg, now, left) } else { String::new() };
        if !r.is_empty() {
            if !out.is_empty() {
                out.push_str("

");
            }
            out.push_str(&r);
        }
    }
    // After /compact or on --resume, give back this session's own thread:
    // the owner's latest asks, the task checklist, files touched.
    if matches!(v["source"].as_str(), Some("compact" | "resume")) {
        if let Some(t) = v["transcript_path"].as_str().filter(|t| !t.is_empty()) {
            let d = crate::verbs::session_view::scan_file(Path::new(t), crate::verbs::session_view::Fmt::Claude, true);
            let block = session_block(&d);
            if !block.is_empty() {
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
                out.push_str(&block);
            }
        }
    }
    Some(out).filter(|d| !d.is_empty())
}

/// Head of the active `/ship` state, if `su-code/ship/ACTIVE` names a slug that has one.
fn active_ship(root: &Path) -> Option<String> {
    let slug = std::fs::read_to_string(root.join("su-code/ship/ACTIVE")).ok()?;
    let slug = slug.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#'))?.to_string();
    if slug.is_empty() || slug.len() > 64 || !slug.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return None;
    }
    let st = std::fs::read_to_string(root.join("su-code/ship").join(&slug).join("STATE.md")).ok()?;
    let head = st.lines().take(40).collect::<Vec<_>>().join("\n");
    Some(format!("## Active /ship: {slug} (su-code/ship/{slug}/)\n{head}\n\n"))
}

/// Pure: this session's thread for `hook session-start` on compact/resume — latest
/// owner asks, the task checklist and recent files, masked and capped (~3 KB) so
/// digest + block stay under Claude Code's 10,000-char hook output limit.
fn session_block(d: &crate::verbs::session_view::Digest) -> String {
    use crate::verbs::session_view::{clean, TaskState};
    const CAP: usize = 3000;
    if d.last_users.is_empty() && d.tasks.is_empty() {
        return String::new();
    }
    let mut out = String::from("## This session (8sync: restored after /compact or resume)\n");
    if !d.last_users.is_empty() {
        out.push_str("Owner's latest requests, oldest → newest:\n");
        for u in &d.last_users {
            out.push_str(&format!("- {}\n", clean(u, 300)));
        }
    }
    if !d.tasks.is_empty() {
        out.push_str(&format!("Task list ({}/{} done{}):\n", d.tasks_done(), d.tasks.len(), if d.partial { ", from the transcript tail" } else { "" }));
        // open work first (it is what must survive), then only the last few done
        let open = d.tasks.iter().filter(|t| t.state != TaskState::Done);
        let done: Vec<_> = d.tasks.iter().filter(|t| t.state == TaskState::Done).collect();
        for t in open.chain(done[done.len().saturating_sub(5)..].iter().copied()).take(25) {
            let mark = match t.state {
                TaskState::Done => "[x]",
                TaskState::InProgress => "[~]",
                TaskState::Pending => "[ ]",
            };
            out.push_str(&format!("- {mark} {}\n", clean(&t.title, 160)));
        }
    }
    if !d.files.is_empty() {
        let files: Vec<String> = d.files.iter().take(8).map(|f| clean(f, 120)).collect();
        out.push_str(&format!("Recently edited: {}\n", files.join(", ")));
    }
    const FOOTER: &str = "Continue the unfinished tasks; re-read files before editing them.";
    let room = CAP - FOOTER.len() - 1;
    if out.len() > room {
        let mut end = room;
        while !out.is_char_boundary(end) {
            end -= 1;
        }
        out.truncate(end);
        out.push('\n');
    }
    out.push_str(FOOTER);
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
    let cbm_on = crate::verbs::harness::cbm::enabled(&env.home);
    for name in ["codebase-memory-mcp", "serena"] {
        if name == "serena" && !crate::verbs::harness::serena::enabled(&env.home) {
            ui::skip("MCP serena", "opt-in, off (8sync harness serena on)");
            continue;
        }
        if name == "codebase-memory-mcp" && !cbm_on {
            ui::skip("MCP codebase-memory-mcp", "opt-in, off (8sync harness cbm on)");
            continue;
        }
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
const POLICY_MARKETPLACES: [&str; 3] = ["anthropics/claude-plugins-official", "8-Sync-Dev/8sync", "8-Sync-Dev/su-code"];
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

/// Which kit hooks `settings.json` text registers (same substring tests `status` uses).
fn kit_hook_flags(settings: &str) -> [(&'static str, bool); 6] {
    let has = |n: &str| settings.contains(&format!("\"{n}\""));
    [
        ("guard", has("guard")),
        ("verify", has("verify")),
        ("stop_gate", settings.contains(GATE_MARKER) || has("verify-stop")),
        ("watchdog", has("watchdog")),
        ("ship_grant", has("ship-grant")),
        ("session_start", has("session-start")),
    ]
}

/// `8sync ccc kit status --json` — machine-readable twin of the kit line of `status`.
fn kit_status_json(env: &Env, dir: &Path) -> Value {
    let missing: Vec<&str> = KIT_FILES.iter().map(|(_, r)| *r).filter(|r| !dir.join(r).exists()).collect();
    let settings = std::fs::read_to_string(dir.join("settings.json")).unwrap_or_default();
    let hooks: serde_json::Map<String, Value> = kit_hook_flags(&settings).iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
    let claude = find_claude();
    let version = claude.as_ref().and_then(|c| crate::env_detect::cmd_version(&c.display().to_string(), &["--version"])).unwrap_or_default();
    let onoff = |b: bool| if b { "on" } else { "off" };
    json!({
        "schema": 1,
        "kit_version": kit_version(env),
        "files": { "present": KIT_FILES.len() - missing.len(), "total": KIT_FILES.len(), "missing": missing },
        "hooks": hooks,
        "skills": {
            "linked": linked_bundled_skills(&env.home, &dir.join("skills")).len(),
            "libraries": deploy::skill_libraries(&env.home).iter().map(|p| p.display().to_string()).collect::<Vec<_>>(),
        },
        "mcp": {
            "cbm": onoff(crate::verbs::harness::cbm::enabled(&env.home)),
            "serena": onoff(crate::verbs::harness::serena::enabled(&env.home)),
        },
        "claude": { "found": claude.is_some(), "version": version },
    })
}

/// How the user is logged in. Presence checks only: no value is read into output.
#[derive(Debug, PartialEq, Eq)]
struct LoginKind {
    kind: &'static str,
    source: &'static str,
}

fn login_kind_with(api_key_env_set: bool, claude_json: Option<&Value>) -> LoginKind {
    if api_key_env_set {
        return LoginKind { kind: "api-key", source: "env" };
    }
    if claude_json.is_some_and(|v| v["oauthAccount"].is_object()) {
        return LoginKind { kind: "subscription", source: "claude-config" };
    }
    LoginKind { kind: "none", source: "unknown" }
}

fn login_kind(env: &Env) -> LoginKind {
    login_kind_at(&env.home)
}

fn login_kind_at(home: &Path) -> LoginKind {
    let path = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(d) => PathBuf::from(d).join(".claude.json"),
        None => home.join(".claude.json"),
    };
    let cfg: Option<Value> = std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok());
    login_kind_with(std::env::var_os("ANTHROPIC_API_KEY").is_some_and(|v| !v.is_empty()), cfg.as_ref())
}

fn login_kind_json(k: &LoginKind) -> Value {
    json!({ "schema": 1, "kind": k.kind, "source": k.source })
}

fn login_kind_line(k: &LoginKind) -> String {
    format!("{} ({})", k.kind, k.source)
}

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
        // Fast path: no alerts file / nothing new = no output (sync hook, timeout 5 s).
        Some("watchdog") => crate::verbs::watchdog::run_hook(&input),
        // StopFailure (no decision control): record + notify; resume-note says it once next prompt.
        // PostToolUse(AskUserQuestion): the owner's answer to a `Ship` question → session grant.
        Some("ship-grant") => {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            if let Some(d) = grant::default_dir() {
                let _ = grant::record(&input, &d, now);
            }
            None
        }
        Some(h @ ("stop-failure" | "resume-note")) => {
            // Same home as `env.home` / `8sync ccc inbox` and ccc-core's reader: `$HOME` on unix,
            // the profile folder on Windows (hooks there often run without HOME).
            let home = dirs::home_dir();
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            resume::state_dir(home.as_deref()).and_then(|dir| {
                if h == "resume-note" {
                    return resume::note(&input, &dir, now);
                }
                if let Some(msg) = resume::record(&input, &dir, home.as_deref(), now) {
                    resume::notify(&msg);
                }
                None
            })
        }
        // Sync: TeammateIdle exits 2 itself; the lead's Stop gets a block decision on stdout.
        Some("idle") => {
            // dirs: $HOME on unix, the profile folder on Windows.
            let home = dirs::home_dir().filter(|h| h.is_absolute());
            home.and_then(|h| idle::hook(&input, &h, login_kind_at(&h).kind == "subscription"))
        }
        // Sync TaskCompleted quality gate (same switch as idle): exit 2 + stderr keeps the task open.
        Some("task-done") => {
            if let Some(msg) = dirs::home_dir().filter(|h| h.is_absolute()).and_then(|h| taskdone::hook(&input, &h)) {
                eprintln!("{msg}");
                std::process::exit(2);
            }
            None
        }
        Some("wake") => {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            dirs::home_dir().filter(|h| h.is_absolute()).and_then(|h| {
                let sub = login_kind_at(&h).kind == "subscription";
                wake::hook(&input, &h, now, sub)
            })
        }
        Some("delegate") => dirs::home_dir().filter(|h| h.is_absolute()).and_then(|h| delegate::hook(&input, &h)),
        // PermissionRequest: an away owner's room gets the owner's HQ click, or a deny that keeps it working.
        Some("permit") => dirs::home_dir().filter(|h| h.is_absolute()).and_then(|h| permit::hook(&input, &h)),
        Some("session-start") => {
            let home = std::env::var_os("HOME").map(PathBuf::from).or_else(dirs::home_dir);
            session_start_output(&input, home.as_deref())
        }

        _ => bail!("usage: 8sync ccc hook verify|verify-stop|guard|watchdog|session-start|stop-failure|resume-note|ship-grant|idle|task-done|delegate|permit|wake   (run by the kit's Claude Code hooks)"),
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
    fn a_name_live_in_another_folder_gets_a_stable_repo_suffix() {
        let d = std::env::temp_dir().join(format!("8sync-names-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let rec = |pid: u32, name: &str, cwd: &str| std::fs::write(d.join(format!("{pid}.json")), json!({ "pid": pid, "name": name, "cwd": cwd }).to_string()).unwrap();
        // Native paths on every OS; records write them the way Claude Code does (the OS separator).
        let projects = d.join("Projects");
        let p = |rel: &str| projects.join(rel).to_string_lossy().into_owned();
        let root = projects.join("su-code");
        let root = root.as_path();
        assert_eq!(display_name(&d, "rd", root), "rd", "no records");
        assert_eq!(display_name(&d.join("missing"), "rd", root), "rd");
        rec(1, "rd", &p("su-code/apps"));
        rec(2, "lead", &p("other"));
        assert_eq!(display_name(&d, "rd", root), "rd", "same project (subfolder) is Claude Code's own duplicate, not ours to rename");
        rec(3, "rd", &p("tools/content-post-agency"));
        assert_eq!(display_name(&d, "rd", root), "rd-su-code");
        assert_eq!(display_name(&d, "rd", root), "rd-su-code", "stable across launches");
        assert_eq!(display_name(&d, "lead", root), "lead-su-code");
        rec(4, "core", &format!("{}/su-code-2", projects.to_string_lossy()));
        assert_eq!(display_name(&d, "core", root), "core-su-code", "a sibling sharing a prefix is another project");
        std::fs::write(d.join("5.abc.key"), "not json").unwrap();
        assert_eq!(room::role(&display_name(&d, "rd", root)).0, room::role("rd").0, "role survives the suffix");
        // A repo nested in this one is another project (seen live 2026-10-18: 8sync-startup took
        // ai-game-studio's "lead"); its worktrees too. A subfolder of this repo is still this one.
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("game/.git")).unwrap();
        rec(6, "qa", &p("su-code/apps/hq-ui"));
        assert_eq!(display_name(&d, "qa", root), "qa");
        rec(7, "ba", &p("su-code/game"));
        assert_eq!(display_name(&d, "ba", root), "ba-su-code");
        rec(8, "ui", &p("su-code/game/.claude/worktrees/card-26"));
        assert_eq!(display_name(&d, "ui", root), "ui-su-code");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// `/ship-tick` is the cron prompt the owner-only loops schedule, so it must stay
    /// model-invocable (a `disable-model-invocation` skill never runs from a scheduled
    /// task), be a kit file, and every loop skill must schedule and delete it.
    #[test]
    fn ship_tick_is_model_invocable_and_scheduled_by_every_loop_skill() {
        let tick = assets::read("claude/skills/ship-tick/SKILL.md").unwrap();
        let front = tick.split("---").nth(1).unwrap();
        assert!(front.contains("name: ship-tick") && !front.contains("disable-model-invocation"), "{front}");
        assert!(KIT_FILES.iter().any(|(_, rel)| *rel == "skills/ship-tick/SKILL.md"));
        assert!(CORE_SKILLS.contains(&"ship-tick"));
        for name in ["ship-loop", "autopilot", "ship-auto", "ship"] {
            let body = assets::read(&format!("claude/skills/{name}/SKILL.md")).unwrap();
            assert!(body.contains("`CronCreate`") && body.contains("/ship-tick <slug>"), "{name}: no cron");
        }
        for name in ["ship-loop", "autopilot", "ship-auto"] {
            let body = assets::read(&format!("claude/skills/{name}/SKILL.md")).unwrap();
            assert!(body.contains("disable-model-invocation: true"), "{name} must stay owner-only");
            assert!(body.contains("`CronDelete`"), "{name}: never deletes its tick cron");
        }
        assert!(help::TEXT.contains("/ship-tick [slug]"));
    }

    /// Owner (2026-10-16): the System Design Primer as a skill "quy trình đọc" — a reading map
    /// plus the 4-step method, never a copy of the primer (CC BY 4.0, ~110 KB, kit size gate).
    #[test]
    fn sysdesign_skill_points_at_the_primer_without_copying_it() {
        let body = assets::read("claude/skills/sysdesign/SKILL.md").unwrap();
        let front = body.split("---").nth(1).unwrap();
        assert!(front.contains("name: sysdesign") && !front.contains("disable-model-invocation"), "{front}");
        assert!(KIT_FILES.iter().any(|(_, rel)| *rel == "skills/sysdesign/SKILL.md"));
        assert!(CORE_SKILLS.contains(&"sysdesign"));
        assert!(body.contains("github.com/donnemartin/system-design-primer") && body.contains("CC BY 4.0"));
        assert!(body.contains("git clone --depth 1") && body.contains("~/.cache/8sync/system-design-primer"));
        for step in ["Use cases, constraints, assumptions", "High level design", "Core components", "Scale", "Back-of-the-envelope"] {
            assert!(body.contains(step), "missing step {step}");
        }
        assert!(body.contains("solutions/system_design/") && body.contains("docs/adr/"));
        assert!(body.len() < 8 * 1024, "keep the skill small: {} bytes", body.len());
        assert!(help::TEXT.contains("/sysdesign"));
    }

    #[test]
    fn login_kind_detects_without_values() {
        let acct = json!({ "oauthAccount": { "emailAddress": "x@y.z" } });
        assert_eq!(login_kind_with(true, Some(&acct)), LoginKind { kind: "api-key", source: "env" });
        assert_eq!(login_kind_with(false, Some(&acct)), LoginKind { kind: "subscription", source: "claude-config" });
        assert_eq!(login_kind_with(false, Some(&json!({}))), LoginKind { kind: "none", source: "unknown" });
        assert_eq!(login_kind_with(false, None).kind, "none");
        let out = login_kind_json(&login_kind_with(false, Some(&acct))).to_string();
        assert!(!out.contains("x@y.z"));
        assert_eq!(login_kind_json(&login_kind_with(true, None)), json!({"schema": 1, "kind": "api-key", "source": "env"}));
        assert_eq!(login_kind_line(&login_kind_with(false, None)), "none (unknown)");
    }

    #[test]
    fn kit_status_json_shape() {
        let d = std::env::temp_dir().join(format!("8sync-ks-{}-{}", std::process::id(), line!()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("settings.json"), r#"{"hooks":{"x":[{"args":["ccc","hook","guard"]}]}}"#).unwrap();
        let env = Env { home: d.clone(), xdg_config: d.join("cfg"), os_id: "x".into(), os_id_like: String::new() };
        let v = kit_status_json(&env, &d);
        assert_eq!(v["schema"], 1);
        assert_eq!(v["files"]["total"], KIT_FILES.len());
        assert_eq!(v["files"]["present"], 0);
        assert_eq!(v["files"]["missing"].as_array().unwrap().len(), KIT_FILES.len());
        for k in ["guard", "verify", "stop_gate", "watchdog", "ship_grant", "session_start"] {
            assert!(v["hooks"][k].is_boolean(), "{k}");
        }
        assert_eq!(v["hooks"]["guard"], true);
        assert_eq!(v["hooks"]["watchdog"], false);
        assert!(v["skills"]["libraries"].is_array());
        assert!(matches!(v["mcp"]["cbm"].as_str(), Some("on" | "off")));
        assert!(matches!(v["mcp"]["serena"].as_str(), Some("on" | "off")));
        assert!(v["claude"]["found"].is_boolean());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn kit_takes_back_the_env_edit_deny_and_teaches_auto_mode_once() {
        let mut v = json!({
            "permissions": { "deny": ["Edit(**/.env)", "Edit(**/.env.*)", "Read(**/.env)", "Bash(rm -rf /)"] },
            "autoMode": { "environment": ["Source control: my own GitLab", "Old (8sync kit) entry"] }
        });
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        let once = v.clone();
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        assert_eq!(v, once, "idempotent");
        let deny: Vec<&str> = v["permissions"]["deny"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert!(!deny.iter().any(|r| r.starts_with("Edit(**/.env")), "{deny:?}");
        assert!(deny.contains(&"Read(**/.env)") && deny.contains(&"Read(**/.env.*)") && deny.contains(&"Bash(rm -rf /)"));
        let env: Vec<&str> = v["autoMode"]["environment"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
        assert_eq!(env[0], "Source control: my own GitLab", "owner entry kept, no $defaults forced into an owner list");
        assert!(!env.contains(&"Old (8sync kit) entry"));
        assert_eq!(env.iter().filter(|e| e.contains(AUTO_ENV_TAG)).count(), AUTO_ENV.len());
        assert!(v["autoMode"].get("allow").is_none() && v["autoMode"].get("soft_deny").is_none(), "classifier rules untouched");

        let mut fresh = json!({});
        apply_kit_settings(&mut fresh, "/x/8sync", &[]).unwrap();
        assert_eq!(fresh["autoMode"]["environment"][0], "$defaults", "a list the kit creates keeps Anthropic's defaults");
        assert!(strip_auto_env(&mut fresh) && fresh.get("autoMode").is_none(), "kit --remove leaves no autoMode it created");
        assert!(strip_auto_env(&mut v));
        assert_eq!(v["autoMode"]["environment"], json!(["Source control: my own GitLab"]));
    }

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
        assert_eq!(post.len(), 5, "user hook kept, ours replaced in place, watchdog + hq SendMessage + ship-grant appended");
        assert!(post.iter().any(|g| g["matcher"] == "AskUserQuestion" && g["hooks"][0]["args"] == json!(["ccc", "hook", "ship-grant"])));
        // An away owner's room never sits on a permission prompt; the wait for the HQ click fits the timeout.
        let permit = &v["hooks"]["PermissionRequest"][0]["hooks"][0];
        assert_eq!(permit["args"], json!(["ccc", "hook", "permit"]));
        assert!(permit["timeout"].as_u64().unwrap() > permit::WAIT_MAX_S);
        assert_eq!(post[0]["hooks"][0]["command"], "prettier");
        assert_eq!(post[1]["hooks"][0]["command"], "/new/8sync");
        assert_eq!(post[1]["hooks"][0]["asyncRewake"], true, "edits never wait for the check");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 3, "retired Haiku stop gate removed; verify-stop + idle + hq Stop appended");
        assert_eq!(stop[0]["hooks"][0]["args"], json!(["ccc", "hook", "verify-stop"]));
        assert_eq!(v["disableClaudeAiConnectors"], true);
        let mut keep = json!({ "disableClaudeAiConnectors": false });
        apply_kit_settings(&mut keep, "/new/8sync", &[]).unwrap();
        assert_eq!(keep["disableClaudeAiConnectors"], false, "a user choice wins");
        assert_eq!(v["autoContinueAtUsageLimit"], true, "long tasks continue after a usage-limit reset");
        let mut off = json!({ "autoContinueAtUsageLimit": false });
        apply_kit_settings(&mut off, "/new/8sync", &[]).unwrap();
        assert_eq!(off["autoContinueAtUsageLimit"], false, "an owner who turned it off in /config stays off");
        let allow = v["permissions"]["allow"].as_array().unwrap();
        assert!(allow.iter().any(|r| r == "Bash(make*)") && allow.iter().any(|r| r == "Bash(cargo check*)"));
        assert!(allow.iter().any(|r| r == "EnterWorktree"), "rooms open a card worktree without stopping on a prompt");
        assert!(!allow.iter().any(|r| r.as_str().is_some_and(|s| s.contains("git push"))), "pushes stay reviewed");
        let pre = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(pre.len(), 4, "ask gate replaced in place, user hook kept, delegate + guard appended");
        assert_eq!(pre[0]["hooks"][0]["prompt"], format!("{ASK_GATE}{ASK_POLICY}"));
        // Claude Code echoes the whole prompt in the hook-error line when the gate denies
        // (owner 2026-10-16: "chữ vỡ"); keep it short enough to read in a terminal.
        let prompt = format!("{ASK_GATE}{ASK_POLICY}");
        assert!(prompt.len() <= 520, "ask gate prompt is {} bytes (was 1,374, then ~880)", prompt.len());
        assert!(prompt.starts_with(GATE_MARKER) && prompt.contains("$ARGUMENTS"));
        // Owner 2026-10-16: a question about loosening the owner-present rail was denied as "minor".
        for rule in ["1. ", "2. ", "3. ", "4. ", "JUSTIFIED", "NOT JUSTIFIED", "{\"ok\": true}", "{\"ok\": false", "compliance rail"] {
            assert!(prompt.contains(rule), "missing {rule}");
        }
        assert_eq!(pre[1]["hooks"][0]["command"], "my-linter");
        assert_eq!(pre[2]["hooks"][0]["args"], json!(["ccc", "hook", "delegate"]));
        assert_eq!(pre[3]["hooks"][0]["args"], json!(["ccc", "hook", "guard"]));
        assert_eq!(pre[3]["hooks"][0]["onFailure"], "block", "guard fails closed");
        assert!(deny.iter().any(|r| r == "Read(**/.env)") && !deny.iter().any(|r| r.as_str().is_some_and(|s| s.starts_with("Write(") || s.starts_with("Edit(**/.env"))));
        assert_eq!(v["permissions"]["defaultMode"], "auto");
        assert_eq!(v["permissions"]["disableBypassPermissionsMode"], "disable", "a launcher's bypass flag must not win");
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
        assert_eq!(stop.len(), 3);
        assert_eq!(stop[0]["hooks"][0]["args"], json!(["ccc", "hook", "verify-stop"]));
        assert_eq!(v["hooks"]["PreToolUse"][0]["hooks"][0]["model"], ASK_GATE_MODEL);
        assert_eq!(v["hooks"]["SessionStart"][0]["hooks"][0]["args"], json!(["ccc", "hook", "session-start"]));
        let o = &v["skillOverrides"];
        assert_eq!(o["impeccable"], "off", "user value kept");
        assert_eq!(o["taste"], "name-only");
        assert!(o.get("ship").is_none() && o.get("codegraph").is_none() && o.get("ponytail").is_none(), "core skills untouched");
        assert_eq!(v["hooks"]["SessionStart"][0]["matcher"], "startup|resume|clear|compact");
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
        // "không ai rảnh": sync (no `async`) so exit 2 / block can keep the team working.
        for ev in ["Stop", "TeammateIdle"] {
            let idle: Vec<&Value> = v["hooks"][ev].as_array().unwrap().iter().filter(|g| g["hooks"][0]["args"] == json!(["ccc", "hook", "idle"])).collect();
            assert_eq!(idle.len(), 1, "{ev} idle hook once");
            assert!(idle[0]["hooks"][0]["async"].is_null(), "{ev} idle hook is sync");
        }
        let td: Vec<&Value> = v["hooks"]["TaskCompleted"].as_array().unwrap().iter().filter(|g| g["hooks"][0]["args"] == json!(["ccc", "hook", "task-done"])).collect();
        assert!(td.len() == 1 && td[0]["hooks"][0]["async"].is_null(), "task-done gate once, sync");
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
    fn session_start_gates_on_source_and_stays_under_cap() {
        let d = std::env::temp_dir().join(format!("8sync-ss-{}-{}", std::process::id(), line!()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("su-code/ship/fix-login")).unwrap();
        std::fs::write(d.join("su-code/STATE.md"), format!("# repo state\n{}", "s".repeat(9000))).unwrap();
        let lessons: String = (0..40).map(|i| format!("- decision: d{i} {}\n", "k".repeat(200))).collect();
        std::fs::write(d.join("su-code/KNOWLEDGE.md"), lessons).unwrap();
        std::fs::write(d.join("su-code/ship/ACTIVE"), "fix-login\n").unwrap();
        std::fs::write(d.join("su-code/ship/fix-login/STATE.md"), "## Goal\nfix the login loop\n").unwrap();
        let t = d.join("t.jsonl");
        let mut tr = String::from(r#"{"type":"user","message":{"role":"user","content":"sửa đăng nhập Zalo"},"origin":{"kind":"human"}}"#);
        tr.push('\n');
        tr.push_str(r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"TaskCreate","input":{"subject":"viết test"}}]}}"#);
        tr.push('\n');
        std::fs::write(&t, tr).unwrap();
        let input = |src: &str, tp: &str| json!({"source": src, "cwd": d, "transcript_path": tp}).to_string();
        let tp = t.to_string_lossy().to_string();
        for src in ["compact", "resume"] {
            let o = session_start_output(&input(src, &tp), None).unwrap();
            assert!(o.starts_with("## Active /ship: fix-login") && o.contains("fix the login loop"), "{src}");
            assert!(o.contains("- sửa đăng nhập Zalo") && o.contains("- [ ] viết test"), "{src}: {o}");
            assert!(o.chars().count() < 10_000, "hook cap");
        }
        for src in ["startup", "clear"] {
            let o = session_start_output(&input(src, &tp), None).unwrap();
            assert!(!o.contains("This session"), "{src}");
        }
        // a bad transcript path or garbage input never panics and adds nothing
        let o = session_start_output(&input("compact", "/nonexistent/x.jsonl"), None).unwrap();
        assert!(!o.contains("This session"));
        let _ = session_start_output("not json", None);
        // an ACTIVE slug that tries to leave su-code/ship is ignored
        std::fs::write(d.join("su-code/ship/ACTIVE"), "../../etc\n").unwrap();
        assert!(active_ship(&d).is_none());
        assert!(is_lesson("- decision: x") && is_lesson("- **failure: y") && !is_lesson("- note: z"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn session_block_restores_thread_masked_and_capped() {
        use crate::verbs::session_view::{Digest, Task, TaskState};
        assert_eq!(session_block(&Digest::default()), "");
        let t = |id: &str, title: &str, state| Task { id: id.into(), title: title.into(), state };
        let d = Digest {
            last_users: vec!["fix login".into(), "deploy với token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA".into()],
            tasks: vec![t("1", "explore", TaskState::Done), t("2", "implement", TaskState::InProgress), t("3", "review", TaskState::Pending)],
            files: vec!["src/a.rs".into()],
            ..Default::default()
        };
        let b = session_block(&d);
        assert!(b.contains("- fix login") && b.contains("Task list (1/3 done)") && b.contains("- [~] implement") && b.contains("- [ ] review"));
        assert!(b.contains("Recently edited: src/a.rs"));
        assert!(!b.contains("AAAAAAAAAAAAAAAAAAAAAAAA"), "secrets masked: {b}");
        let many = Digest { tasks: (0..200).map(|i| t(&i.to_string(), &"ừ".repeat(150), TaskState::Pending)).collect(), ..Default::default() };
        let b = session_block(&many);
        assert!(b.len() <= 3000 && b.ends_with("re-read files before editing them."), "footer survives the cut");
        let done = Digest { tasks: (0..9).map(|i| t(&i.to_string(), &format!("done{i}"), TaskState::Done)).collect(), partial: true, ..Default::default() };
        let b = session_block(&done);
        assert!(b.contains("(9/9 done, from the transcript tail)") && !b.contains("done3") && b.contains("done4") && b.contains("done8"));
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
        for r in ["Edit(~/.config/8sync/hq/public.json)", "Read(~/.config/8sync/hq/secrets.json)", "Edit(~/.config/8sync/hq/secrets.json)", "Edit(~/.local/state/8sync/hq/usage/**)"] {
            assert!(deny.contains(&r), "{r}");
        }
        assert_eq!(p["forceLoginMethod"], "claudeai");
        assert_eq!(p["sandbox"]["enabled"], true);
        assert_eq!(p["channelsEnabled"], true);
        let markets = p["strictKnownMarketplaces"].as_array().unwrap();
        // The old repo name stays allowed so machines that added the marketplace before the rename keep working.
        assert!(["8-Sync-Dev/8sync", "8-Sync-Dev/su-code"].iter().all(|r| markets.iter().any(|m| m["repo"] == *r)));
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
    fn kit_registers_stop_failure_and_resume_note_and_removes_them() {
        let mut v = json!({});
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap(); // idempotent
        let args = |ev: &str| -> Vec<Value> { v["hooks"][ev].as_array().unwrap().iter().map(|g| g["hooks"][0]["args"].clone()).collect() };
        assert_eq!(args("StopFailure"), vec![json!(["ccc", "hook", "stop-failure"])]);
        let ups = args("UserPromptSubmit");
        assert!(ups.contains(&json!(["ccc", "hook", "resume-note"])) && ups.contains(&json!(["ccc", "hook", "watchdog"])), "both coexist: {ups:?}");
        assert!(ups.contains(&json!(["ccc", "hook", "wake"])), "scheduled-prompt gate: {ups:?}");
        assert_eq!(ups.len(), 3);
        strip_kit_hooks(&mut v);
        assert!(v["hooks"].get("StopFailure").is_none() && v["hooks"].get("UserPromptSubmit").is_none());
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
    fn kit_remove_survives_corrupt_features_toml() {
        let d = std::env::temp_dir().join(format!("kit-rm-corrupt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (p, fp) = (d.join("settings.json"), d.join("features.toml"));
        let mut v = json!({"theme": "dark", "statusLine": {"type": "command", "command": "/x/8sync ccc statusline"}});
        apply_kit_settings(&mut v, "/x/8sync", &[]).unwrap();
        let before = serde_json::to_string_pretty(&v).unwrap() + "\n";
        std::fs::write(&p, &before).unwrap();
        std::fs::write(&fp, "this is = [not toml").unwrap();
        remove_kit_hooks_in(&p, &fp).expect("statusline failure must not abort the run");
        let after: Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert!(strip_kit_hooks(&mut after.clone()) == 0, "hooks removed");
        assert_eq!(after["theme"], "dark");
        assert_eq!(std::fs::read_to_string(&fp).unwrap(), "this is = [not toml", "corrupt features left alone");
        assert_eq!(std::fs::read_to_string(d.join("settings.json.bak-8sync")).unwrap(), before, "backup holds the original");
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


    #[test]
    fn offline_parses_from_flag_and_env_and_is_not_passed_to_claude() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(take_offline(&a(&["core", "--offline", "-p", "x"]), None), (true, a(&["core", "-p", "x"])));
        assert_eq!(take_offline(&a(&["core"]), Some("1")), (true, a(&["core"])));
        assert!(!take_offline(&a(&["core"]), None).0);
        assert!(!take_offline(&a(&["core"]), Some("0")).0);
    }

    #[test]
    fn offline_never_calls_the_installer_or_updater() {
        let calls = std::cell::Cell::new(0);
        let r = ensure_claude_with(true, || None, || { calls.set(calls.get() + 1); Ok(()) });
        assert!(r.is_err());
        assert_eq!(calls.get(), 0, "installer spawned while offline");
        // an installed claude is returned untouched, online or not
        assert!(ensure_claude_with(true, || Some(PathBuf::from("/x/claude")), || unreachable!()).is_ok());
        assert_eq!(auto_update(true, || { calls.set(calls.get() + 1); Some(0) }), None);
        assert_eq!(calls.get(), 0, "updater ran while offline");
        // online still reaches the installer / updater
        let _ = ensure_claude_with(false, || None, || { calls.set(calls.get() + 1); Ok(()) });
        assert_eq!(auto_update(false, || { calls.set(calls.get() + 1); Some(7) }), Some(7));
        assert_eq!(calls.get(), 2);
        assert!(net_allowed(true, "x").is_err() && net_allowed(false, "x").is_ok());
    }

    #[test]
    fn offline_kit_install_writes_files_without_mcp_mirroring() {
        let tmp = std::env::temp_dir().join(format!("8sync-offline-kit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let home = tmp.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let env = Env { home: home.clone(), xdg_config: home.join(".config"), os_id: String::new(), os_id_like: String::new() };
        let dir = tmp.join("claude");
        install_kit_at(&env, &dir, false, true).unwrap();
        assert!(dir.join("settings.json").exists() && dir.join("CLAUDE.md").exists());
        assert!(dir.join("agents/explore.md").exists());
        assert!(!home.join(".claude.json").exists(), "offline kit must not touch MCP config");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Rewriting a mod file tells the owner to `/reload-plugins` in open sessions; other kit
    /// files (agents, skills without a manifest) do not.
    #[test]
    fn kit_reload_hint_names_changed_mods() {
        assert_eq!(kit_mods(), ["8sync-hints", "8sync-inbox"]);
        assert_eq!(reload_hint(&[]), None, "nothing rewritten (first install included)");
        assert_eq!(reload_hint(&["agents/task.md", "skills/ship/SKILL.md"]), None);
        let h = reload_hint(&["skills/8sync-inbox/hooks/inbox.ts", "agents/task.md"]).unwrap();
        assert!(h.starts_with("mod 8sync-inbox đổi") && h.contains("/reload-plugins") && h.contains("không cần restart"), "{h}");
        let both = reload_hint(&["skills/8sync-inbox/hooks/inbox.ts", "skills/8sync-hints/hooks/hint.ts", "skills/8sync-hints/hooks/register.tsx"]).unwrap();
        assert!(both.starts_with("mod 8sync-hints, 8sync-inbox đổi"), "{both}");
    }

    /// The `8sync-inbox` mod ships in the kit: four files under `skills/8sync-inbox`.
    #[test]
    fn kit_installs_the_inbox_mod() {
        let mod_files: Vec<&str> = KIT_FILES.iter().map(|(_, r)| *r).filter(|r| r.starts_with("skills/8sync-inbox/")).collect();
        assert_eq!(mod_files, ["skills/8sync-inbox/.claude-plugin/plugin.json", "skills/8sync-inbox/hooks/hooks.json", "skills/8sync-inbox/hooks/register.ts", "skills/8sync-inbox/hooks/inbox.ts"]);
        let tmp = std::env::temp_dir().join(format!("8sync-inbox-kit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let home = tmp.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let env = Env { home: home.clone(), xdg_config: home.join(".config"), os_id: String::new(), os_id_like: String::new() };
        let dir = tmp.join("claude");
        install_kit_at(&env, &dir, false, true).unwrap();
        let reg = std::fs::read_to_string(dir.join("skills/8sync-inbox/hooks/register.ts")).unwrap();
        assert_eq!(reg, assets::read("configs/claude/mods/8sync-inbox/hooks/register.ts").unwrap());
        assert!(reg.contains("'8sync', 'ccc', 'inbox'") && reg.contains("$.prompt.submit"), "the mod takes the inbox and submits it");
        let manifest: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("skills/8sync-inbox/.claude-plugin/plugin.json")).unwrap()).unwrap();
        assert_eq!(manifest["name"], "8sync-inbox");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// The `8sync-hints` mod ships in the kit: five files under `skills/8sync-hints`, written
    /// byte-for-byte from the repo assets (the cbm gate leaves non-markdown alone).
    #[test]
    fn kit_installs_the_hints_mod() {
        let mod_files: Vec<&str> = KIT_FILES.iter().map(|(_, r)| *r).filter(|r| r.starts_with("skills/8sync-hints/")).collect();
        assert_eq!(mod_files.len(), 5, "{mod_files:?}");
        for f in ["skills/8sync-hints/.claude-plugin/plugin.json", "skills/8sync-hints/hooks/hooks.json", "skills/8sync-hints/hooks/register.tsx", "skills/8sync-hints/hooks/hint.ts", "skills/8sync-hints/types/index.d.ts"] {
            assert!(mod_files.contains(&f), "{f}");
        }
        let tmp = std::env::temp_dir().join(format!("8sync-hints-kit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let home = tmp.join("home");
        std::fs::create_dir_all(&home).unwrap();
        let env = Env { home: home.clone(), xdg_config: home.join(".config"), os_id: String::new(), os_id_like: String::new() };
        let dir = tmp.join("claude");
        install_kit_at(&env, &dir, false, true).unwrap();
        let reg = std::fs::read_to_string(dir.join("skills/8sync-hints/hooks/register.tsx")).unwrap();
        assert_eq!(reg, assets::read("configs/claude/mods/8sync-hints/hooks/register.tsx").unwrap());
        assert!(reg.contains("'8sync', 'ccc', 'hint'"), "the mod calls the Rust side");
        let manifest: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("skills/8sync-hints/.claude-plugin/plugin.json")).unwrap()).unwrap();
        assert_eq!(manifest["name"], "8sync-hints");
        assert_eq!(manifest["types"], "./types/index.d.ts");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
