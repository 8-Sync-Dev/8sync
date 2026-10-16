//! `8sync hq` — the Discord "Agent HQ" for a solo owner whose Claude Code agent
//! team works on a repo.
//!
//! Scope: HQ is ONE-WAY reporting + server layout. Owner <-> session two-way chat is the
//! official Claude Code Channels plugin (`discord@claude-plugins-official`) — HQ never
//! touches Claude credentials and only talks to Discord.
//!
//! * Secrets (bot token, webhook URLs): `~/.config/8sync/hq/secrets.json`, mode 0600, dir 0700.
//!   Never printed unmasked, never in curl argv (curl `--config -` over stdin).
//! * Non-secret config: `~/.config/8sync/hq/config.toml`. State (task_id -> forum thread):
//!   `~/.local/state/8sync/hq/tasks.json` — ids/status/short title only, no message content
//!   (Discord Developer Terms: keep only what is needed).
//! * HTTP: shells out to `curl` (no reqwest). `EIGHTSYNC_HQ_API_BASE` overrides the API base.
//!
//! Sources (checked 2026-10):
//! * Discord API fields: docs.discord.com/developers/resources/{guild,channel,webhook}
//!   (channel types 4/0/15, `available_tags`, `default_forum_layout=1`, `default_sort_order=0`,
//!   REQUIRE_TAG = 1<<4, webhook `thread_name`/`applied_tags`/`thread_id`/`wait`).
//!   NOT verified in the docs: that `wait=true` on a forum-thread-creating webhook returns the
//!   thread id as `channel_id`, and the pin endpoint `PUT /channels/{id}/pins/{message}`.
//! * Hook payloads: code.claude.com/docs/en/hooks — TaskCreated/TaskCompleted carry
//!   `task_id`, `task_subject`, `task_description`, `teammate_name`, `team_name`; TeammateIdle
//!   carries `teammate_name`, `team_name`; Notification carries `message`, `title`,
//!   `notification_type` (`permission_prompt`, `agent_needs_input`, `agent_completed`, ...).
use std::collections::BTreeMap;
use std::io::{IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use clap::{Args as ClapArgs, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::ui;
use super::secret_mask;

const DEFAULT_API: &str = "https://discord.com/api/v10";
const WEBHOOK_NAME: &str = "8sync HQ";
const CONTENT_MAX: usize = 2000;
const EMBED_DESC_MAX: usize = 4096;
const EMBED_TITLE_MAX: usize = 256;
const THREAD_NAME_MAX: usize = 100;
const LOG_KEEP: usize = 500;
const BOARD: &str = "task-board";
const STATUSES: [&str; 5] = ["todo", "doing", "review", "blocked", "done"];
const PRIOS: [&str; 3] = ["p0", "p1", "p2"];
const AI_ROLE: &str = "AI-Agent";
const REQUIRE_TAG: u64 = 1 << 4;

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      printf %s \"$BOT_TOKEN\" | 8sync hq setup --guild <id> --token-stdin
      8sync hq setup --guild <id> --dry-run       show planned requests, send nothing
      8sync hq post --as backend --to eng-backend 'migration done'
      8sync hq task new 'Add login' --role backend --prio p1
      8sync hq task status <task_id> doing
      8sync hq standup                            daily standup thread (no model call)
      8sync hq doctor                             config / perms / webhooks (masked)
      8sync hq up --repo . --install              systemd user unit (Channels session) + standup timer

    NOTES
      HQ is one-way reporting. Two-way owner<->session chat = the official Claude Code
      Channels plugin `discord@claude-plugins-official`. HQ never touches Claude credentials.
      Hooks: `8sync hq hook <TaskCreated|TaskCompleted|TeammateIdle|Notification>` (stdin JSON).
"})]
pub struct Args {
    /// Print planned requests (secrets masked) and send nothing
    #[arg(long, global = true)]
    pub dry_run: bool,
    #[command(subcommand)]
    pub cmd: Sub,
}

impl Args {
    /// Hook calls skip the auto-update notice in `main` (must stay fast and silent).
    pub fn is_hook(&self) -> bool {
        matches!(self.cmd, Sub::Hook { .. })
    }
}

#[derive(Subcommand, Debug)]
pub enum Sub {
    /// Create the server layout (idempotent, by name) + webhooks
    Setup {
        /// Guild (server) id
        #[arg(long)]
        guild: String,
        /// Read the bot token from stdin (one line) and save it to secrets.json
        #[arg(long)]
        token_stdin: bool,
        /// Owner user id (alerts mention this user)
        #[arg(long)]
        owner: Option<String>,
    },
    /// Post as a persona to a channel via its webhook
    Post {
        /// pm|architect|backend|frontend|qa|reviewer|researcher|hq
        #[arg(long = "as")]
        persona: String,
        /// channel key, e.g. eng-backend, logs, alerts, standup
        #[arg(long)]
        to: String,
        /// embed title (forces embed)
        #[arg(long)]
        title: Option<String>,
        /// read the text from stdin
        #[arg(long)]
        stdin: bool,
        text: Vec<String>,
    },
    /// task-board forum: new | status | comment
    #[command(subcommand)]
    Task(TaskCmd),
    /// Map a Claude Code hook event (JSON on stdin); always exits 0
    Hook { event: String },
    /// Post the daily standup thread from local state
    Standup,
    /// Run the local HQ web UI (turns the event journal on); `--off` turns it off
    Ui {
        #[arg(long, default_value_t = 8740)]
        port: u16,
        /// hq-ui app directory for development (else $EIGHTSYNC_HQ_UI_APP, the installed release asset, or a built repo checkout)
        #[arg(long)]
        app: Option<PathBuf>,
        #[arg(long)]
        no_open: bool,
        /// turn the local event journal off (local = false) and exit
        #[arg(long)]
        off: bool,
        /// download and install the UI release asset again (ignores the installed copy)
        #[arg(long)]
        update: bool,
    },
    /// Delete the local HQ data: events*.jsonl, hq.db*, channel-*.json (asks with no --yes: only lists)
    Purge {
        #[arg(long)]
        yes: bool,
    },
    /// Config presence, secret perms, channels/webhooks (masked), last errors
    #[command(alias = "doctor")]
    Status,
    /// Print (or --install) the systemd user unit + standup timer
    Up {
        #[arg(long)]
        repo: Option<PathBuf>,
        /// tmux session name
        #[arg(long, default_value = "8sync-hq")]
        name: String,
        /// write the unit files and enable them (does not start anything)
        #[arg(long)]
        install: bool,
        /// with --install: also start now
        #[arg(long)]
        now: bool,
    },
}

#[derive(Subcommand, Debug)]
pub enum TaskCmd {
    /// New forum post (tag todo)
    New {
        title: String,
        #[arg(long)]
        id: Option<String>,
        #[arg(long)]
        role: Option<String>,
        /// p0|p1|p2
        #[arg(long)]
        prio: Option<String>,
        #[arg(long)]
        body: Option<String>,
    },
    /// Change status tag (needs bot token) + comment
    Status { id: String, status: String },
    /// Comment on the task thread
    Comment {
        id: String,
        #[arg(long = "as", default_value = "hq")]
        persona: String,
        text: Vec<String>,
    },
}

// ── personas ────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Persona {
    Pm,
    Architect,
    Backend,
    Frontend,
    Qa,
    Reviewer,
    Researcher,
    Hq,
}

const PERSONAS: [Persona; 8] = [
    Persona::Pm,
    Persona::Architect,
    Persona::Backend,
    Persona::Frontend,
    Persona::Qa,
    Persona::Reviewer,
    Persona::Researcher,
    Persona::Hq,
];

impl Persona {
    fn key(self) -> &'static str {
        match self {
            Persona::Pm => "pm",
            Persona::Architect => "architect",
            Persona::Backend => "backend",
            Persona::Frontend => "frontend",
            Persona::Qa => "qa",
            Persona::Reviewer => "reviewer",
            Persona::Researcher => "researcher",
            Persona::Hq => "hq",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Persona::Pm => "PM",
            Persona::Architect => "Architect",
            Persona::Backend => "Backend",
            Persona::Frontend => "Frontend",
            Persona::Qa => "QA",
            Persona::Reviewer => "Reviewer",
            Persona::Researcher => "Researcher",
            Persona::Hq => "HQ",
        }
    }
    fn username(self) -> String {
        format!("{} · 8sync", self.label())
    }
    /// task-board forum tag for this role.
    fn tag(self) -> Option<&'static str> {
        Some(match self {
            Persona::Pm => "pm",
            Persona::Architect => "arch",
            Persona::Backend => "be",
            Persona::Frontend => "fe",
            Persona::Qa => "qa",
            Persona::Reviewer => "rev",
            Persona::Researcher => "research",
            Persona::Hq => return None,
        })
    }
    fn parse(s: &str) -> Option<Persona> {
        let s = s.trim().to_lowercase();
        PERSONAS.iter().copied().find(|p| p.key() == s)
    }
    /// Find a role word (whole token) in free text such as a teammate name or task subject.
    fn from_text(text: &str) -> Option<Persona> {
        let lower = text.to_lowercase();
        for tok in lower.split(|c: char| !c.is_alphanumeric()) {
            let p = match tok {
                "pm" | "manager" => Persona::Pm,
                "architect" | "arch" => Persona::Architect,
                "backend" | "be" => Persona::Backend,
                "frontend" | "fe" => Persona::Frontend,
                "qa" | "tester" => Persona::Qa,
                "reviewer" | "review" => Persona::Reviewer,
                "researcher" | "research" => Persona::Researcher,
                _ => continue,
            };
            return Some(p);
        }
        None
    }
}

// ── layout ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Text,
    Forum,
}
impl Kind {
    fn ty(self) -> i64 {
        match self {
            Kind::Text => 0,
            Kind::Forum => 15,
        }
    }
}

struct ChanSpec {
    key: &'static str,
    name: &'static str,
    kind: Kind,
    topic: &'static str,
    tags: &'static [&'static str],
    /// task-board: REQUIRE_TAG + list layout + latest-activity sort
    board: bool,
}

struct CatSpec {
    name: &'static str,
    chans: &'static [ChanSpec],
}

const fn text(key: &'static str, topic: &'static str) -> ChanSpec {
    ChanSpec { key, name: key, kind: Kind::Text, topic, tags: &[], board: false }
}

const BOARD_TAGS: &[&str] = &[
    "todo", "doing", "review", "blocked", "done", "pm", "arch", "be", "fe", "qa", "rev",
    "research", "p0", "p1", "p2",
];

const LAYOUT: &[CatSpec] = &[
    CatSpec {
        name: "📌 HQ",
        chans: &[
            text("readme", "Charter and AI disclosure"),
            text("owner-desk", "Owner <-> lead session chat (Claude Code Channels plugin)"),
            text("announcements", "Releases and milestones"),
        ],
    },
    CatSpec {
        name: "🗂 WORK",
        chans: &[
            ChanSpec { key: "task-board", name: "task-board", kind: Kind::Forum, topic: "One post per task", tags: BOARD_TAGS, board: true },
            ChanSpec { key: "rfcs", name: "rfcs", kind: Kind::Forum, topic: "Design proposals", tags: &["proposed", "accepted", "rejected"], board: false },
        ],
    },
    CatSpec {
        name: "🗓 RITUALS",
        chans: &[
            text("standup", "Daily standup threads"),
            ChanSpec { key: "notes", name: "notes", kind: Kind::Forum, topic: "Working notes", tags: &[], board: false },
        ],
    },
    CatSpec {
        name: "🤖 TEAM ROOMS",
        chans: &[
            text("eng-backend", "Backend persona"),
            text("eng-frontend", "Frontend persona"),
            text("qa-review", "QA and review"),
            text("research", "Research persona"),
        ],
    },
    CatSpec {
        name: "⚙ OPS",
        chans: &[
            text("logs", "Teammate activity"),
            text("alerts", "Needs input / permission / completed"),
            text("audit", "Audit trail"),
        ],
    },
];

const ROLE_NAMES: [&str; 8] =
    ["PM", "Architect", "Backend", "Frontend", "QA", "Reviewer", "Researcher", AI_ROLE];

const CHARTER: &str = "**8 Sync Agent HQ**\n\n\
Every persona here (PM, Architect, Backend, Frontend, QA, Reviewer, Researcher) is an AI agent run by Claude Code. \
There are no human teammates behind these names; the owner is the only human.\n\n\
- #task-board: one post per task, status via tags\n\
- #standup: daily summary built from local task state\n\
- #alerts: needs input / permission / completed\n\
- #owner-desk: talk to the lead session (Claude Code Channels plugin)\n\n\
(VI) Mọi persona ở đây là AI agent chạy bằng Claude Code; chỉ owner là người thật.";

// Permission bits (docs.discord.com/developers/topics/permissions). No Administrator.
const PERMS: [(&str, u32); 13] = [
    ("View Channels", 10),
    ("Send Messages", 11),
    ("Send Messages in Threads", 38),
    ("Create Public Threads", 35),
    ("Manage Threads", 34),
    ("Manage Channels (setup only)", 4),
    ("Manage Webhooks", 29),
    ("Manage Roles (setup only)", 28),
    ("Embed Links", 14),
    ("Attach Files", 15),
    ("Read Message History", 16),
    ("Add Reactions", 6),
    // PIN_MESSAGES 1<<51 (docs.discord.com/developers/topics/permissions): pin the charter
    ("Pin Messages", 51),
];

fn perm_bits() -> u64 {
    PERMS.iter().fold(0u64, |a, (_, b)| a | (1u64 << b))
}

// ── paths / config / secrets / state ────────────────────────────────────────

struct Paths {
    cfg_dir: PathBuf,
    state_dir: PathBuf,
}

impl Paths {
    fn new() -> Result<Self> {
        let home = dirs::home_dir().ok_or_else(|| anyhow!("cannot resolve home directory"))?;
        Ok(Self::under(&home))
    }
    fn under(home: &Path) -> Self {
        Paths {
            cfg_dir: crate::brand::config_dir(home).join("hq"),
            state_dir: home.join(".local/state").join(crate::brand::NS).join("hq"),
        }
    }
    fn config(&self) -> PathBuf {
        self.cfg_dir.join("config.toml")
    }
    fn secrets(&self) -> PathBuf {
        self.cfg_dir.join("secrets.json")
    }
    fn tasks(&self) -> PathBuf {
        self.state_dir.join("tasks.json")
    }
    fn events(&self) -> PathBuf {
        self.state_dir.join("events.jsonl")
    }
    fn log(&self) -> PathBuf {
        self.state_dir.join("hq.log")
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
struct Config {
    enabled: bool,
    /// write the local event journal (`events.jsonl`) for `8sync hq ui`
    local: bool,
    guild_id: String,
    owner_id: Option<String>,
    charter_message_id: Option<String>,
    channels: BTreeMap<String, String>,
    roles: BTreeMap<String, String>,
    avatars: BTreeMap<String, String>,
    tags: BTreeMap<String, BTreeMap<String, String>>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
struct Secrets {
    bot_token: Option<String>,
    webhooks: BTreeMap<String, String>,
}

impl Secrets {
    fn values(&self) -> Vec<String> {
        let mut v: Vec<String> = self.webhooks.values().cloned().collect();
        if let Some(t) = &self.bot_token {
            v.push(t.clone());
        }
        v
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
struct Task {
    thread_id: String,
    status: String,
    role: Option<String>,
    prio: Option<String>,
    /// short title only (needed for standup); no message content
    title: String,
    updated: u64,
    done_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
#[serde(default)]
struct State {
    tasks: BTreeMap<String, Task>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Write a file with mode 0600 (parent dir 0700), atomically via temp + rename.
fn write_private(path: &Path, data: &[u8]) -> Result<()> {
    let dir = path.parent().ok_or_else(|| anyhow!("no parent dir"))?;
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(&tmp)?;
    f.write_all(data)?;
    f.sync_all().ok();
    drop(f);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(unix)]
fn mode_of(p: &Path) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).ok().map(|m| m.permissions().mode() & 0o777)
}
#[cfg(not(unix))]
fn mode_of(_p: &Path) -> Option<u32> {
    None
}

fn load_config(p: &Paths) -> Option<Config> {
    toml::from_str(&std::fs::read_to_string(p.config()).ok()?).ok()
}
fn save_config(p: &Paths, c: &Config) -> Result<()> {
    write_private(&p.config(), toml::to_string_pretty(c)?.as_bytes())
}
fn load_secrets(p: &Paths) -> Secrets {
    std::fs::read_to_string(p.secrets())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
fn save_secrets(p: &Paths, s: &Secrets) -> Result<()> {
    write_private(&p.secrets(), serde_json::to_string_pretty(s)?.as_bytes())
}
fn load_state(p: &Paths) -> State {
    std::fs::read_to_string(p.tasks())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Run `f` while holding a crude lock file `name` in the state dir. Waits up to ~1.5 s;
/// returns None (without running `f`) when the lock cannot be taken. Also stops waiting once
/// `deadline` (the hook budget) has passed.
fn with_lock<R>(p: &Paths, name: &str, deadline: Option<std::time::Instant>, f: impl FnOnce() -> R) -> Option<R> {
    std::fs::create_dir_all(&p.state_dir).ok()?;
    let lock = p.state_dir.join(name);
    for _ in 0..30 {
        if deadline.is_some_and(|d| std::time::Instant::now() >= d) {
            return None;
        }
        if std::fs::OpenOptions::new().write(true).create_new(true).open(&lock).is_ok() {
            let r = f();
            let _ = std::fs::remove_file(&lock);
            return Some(r);
        }
        // stale lock (> 10 s) from a crashed hook
        if let Ok(m) = std::fs::metadata(&lock) {
            if m.modified().ok().and_then(|t| t.elapsed().ok()).map(|e| e.as_secs() > 10).unwrap_or(false) {
                let _ = std::fs::remove_file(&lock);
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    None
}

/// Drop done tasks older than `DONE_KEEP` and thread-less `pending` reservations older than
/// `PENDING_KEEP`. (`pending-done` retries are kept: they carry a completion.)
fn prune_state(st: &mut State, now: u64) {
    st.tasks.retain(|_, t| {
        let age = now.saturating_sub(t.done_at.unwrap_or(t.updated));
        !(t.status == "done" && age > DONE_KEEP) && !(t.status == PENDING && t.thread_id.is_empty() && now.saturating_sub(t.updated) > PENDING_KEEP)
    });
}

/// Resolve a user-typed task id: the full key, else a suffix at a `:` boundary (so a bare `<n>`),
/// else a `:`-containing suffix; it must match exactly one task.
fn resolve_task_id(st: &State, q: &str) -> Result<String> {
    if st.tasks.contains_key(q) {
        return Ok(q.to_string());
    }
    let tail = format!(":{q}");
    let hits: Vec<&String> = st.tasks.keys().filter(|k| k.ends_with(&tail) || (q.contains(':') && k.ends_with(q))).collect();
    match hits.as_slice() {
        [] => bail!("unknown task '{q}'"),
        [one] => Ok((*one).clone()),
        many => bail!("task '{q}' is ambiguous; use the full id: {}", many.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", ")),
    }
}

/// Newest `n` tasks by last update (ties by id).
fn recent_tasks(st: &State, n: usize) -> Vec<(&String, &Task)> {
    let mut v: Vec<_> = st.tasks.iter().collect();
    v.sort_by(|a, b| b.1.updated.cmp(&a.1.updated).then_with(|| a.0.cmp(b.0)));
    v.truncate(n);
    v
}

fn task_line(id: &str, t: &Task) -> String {
    format!("  {id}  {}  {}  {}", t.status, t.role.as_deref().unwrap_or("-"), truncate_chars(&t.title.replace('\n', " "), 60))
}

/// Read-modify-write the state under the lock (hooks may run in parallel).
/// Lock not acquired -> Err and nothing is written.
fn update_state_with<R>(p: &Paths, deadline: Option<std::time::Instant>, f: impl FnOnce(&mut State) -> R) -> Result<R> {
    with_lock(p, "tasks.lock", deadline, || -> Result<R> {
        let mut st = load_state(p);
        prune_state(&mut st, now());
        let r = f(&mut st);
        write_private(&p.tasks(), serde_json::to_string_pretty(&st)?.as_bytes())?;
        Ok(r)
    })
    .unwrap_or_else(|| bail!("state lock busy; write skipped"))
}

#[cfg(test)]
fn update_state(p: &Paths, f: impl FnOnce(&mut State)) -> Result<()> {
    update_state_with(p, None, f)
}

/// Like `update_state_with` but retried up to 3x (a post already happened; losing the write
/// would cause a duplicate thread). Stops early once `deadline` passes.
fn update_state_retry<R>(p: &Paths, deadline: Option<std::time::Instant>, f: impl Fn(&mut State) -> R) -> Result<R> {
    let mut last = anyhow!("state write not attempted");
    for i in 0..3 {
        if i > 0 {
            if deadline.is_some_and(|d| std::time::Instant::now() >= d) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        match update_state_with(p, deadline, &f) {
            Ok(r) => return Ok(r),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Append to the 0600 log, keep the last `LOG_KEEP` lines. Secrets are scrubbed.
/// Takes its own lock; if busy the line is dropped (never blocks a hook).
fn log_err(p: &Paths, secrets: &Secrets, msg: &str) {
    let clean = scrub(msg, &secrets.values()).replace('\n', " ");
    let path = p.log();
    let _ = with_lock(p, "hq.log.lock", None, || {
        let mut lines: Vec<String> = std::fs::read_to_string(&path)
            .map(|s| s.lines().map(String::from).collect())
            .unwrap_or_default();
        lines.push(format!("[{}] {}", now(), clean));
        let skip = lines.len().saturating_sub(LOG_KEEP);
        let body = lines[skip..].join("\n") + "\n";
        let _ = write_private(&path, body.as_bytes());
    });
}

// ── text helpers ────────────────────────────────────────────────────────────

/// Truncate to at most `max` chars (char-boundary safe), ending with `…` when cut.
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// Mask a secret: never more than the last 4 chars.
fn mask(s: &str) -> String {
    let n = s.chars().count();
    if n >= 12 {
        format!("****{}", s.chars().skip(n - 4).collect::<String>())
    } else {
        "****".into()
    }
}

/// `https://…/webhooks/<id>/<token>?q` -> token replaced by `****`.
fn mask_webhook_url(u: &str) -> String {
    match u.split_once("/webhooks/") {
        Some((head, rest)) => {
            let (path, query) = rest.split_once('?').map(|(a, b)| (a, Some(b))).unwrap_or((rest, None));
            let id = path.split('/').next().unwrap_or("");
            let mut out = format!("{head}/webhooks/{id}/****");
            if let Some(q) = query {
                out.push('?');
                out.push_str(q);
            }
            out
        }
        None => u.to_string(),
    }
}

fn scrub(text: &str, secrets: &[String]) -> String {
    let mut t = text.to_string();
    for s in secrets.iter().filter(|s| s.len() >= 8) {
        t = t.replace(s.as_str(), "****");
        // webhook token alone
        if let Some((_, rest)) = s.split_once("/webhooks/") {
            if let Some(tok) = rest.split('/').nth(1) {
                let tok = tok.split('?').next().unwrap_or("");
                if tok.len() >= 8 {
                    t = t.replace(tok, "****");
                }
            }
        }
    }
    t
}

/// Quote for a curl config file value (`\\`, `\"`, `\n`, `\r`, `\t`).
fn cq(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '"' => o.push_str("\\\""),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

// ── requests (pure builders) + transport ────────────────────────────────────

#[derive(Clone, Debug)]
enum Target {
    /// path under the API base, authenticated with the bot token
    Api(String),
    /// full webhook URL (contains the secret token), no auth header
    Webhook(String),
}

#[derive(Clone, Debug)]
struct Req {
    method: &'static str,
    target: Target,
    body: Option<Value>,
}

fn api(method: &'static str, path: impl Into<String>, body: Option<Value>) -> Req {
    Req { method, target: Target::Api(path.into()), body }
}

fn req_create_role(guild: &str, name: &str) -> Req {
    api("POST", format!("/guilds/{guild}/roles"), Some(json!({"name": name, "mentionable": true, "permissions": "0"})))
}

fn req_create_category(guild: &str, name: &str) -> Req {
    api("POST", format!("/guilds/{guild}/channels"), Some(json!({"name": name, "type": 4})))
}

fn tag_objs(names: &[&str]) -> Vec<Value> {
    names.iter().map(|n| json!({"name": n, "moderated": false})).collect()
}

fn req_create_channel(guild: &str, spec: &ChanSpec, parent: &str) -> Req {
    let mut b = json!({"name": spec.name, "type": spec.kind.ty(), "parent_id": parent, "topic": spec.topic});
    if spec.kind == Kind::Forum {
        if !spec.tags.is_empty() {
            b["available_tags"] = Value::Array(tag_objs(spec.tags));
        }
        if spec.board {
            b["default_forum_layout"] = json!(1); // LIST_VIEW
            b["default_sort_order"] = json!(0); // LATEST_ACTIVITY
            b["flags"] = json!(REQUIRE_TAG);
        }
    }
    api("POST", format!("/guilds/{guild}/channels"), Some(b))
}

/// PATCH available_tags: keep existing (with ids), append the missing names.
fn req_add_tags(channel: &str, existing: &[Tag], missing: &[&str]) -> Req {
    let mut v: Vec<Value> = existing.iter().map(|t| json!({"id": t.id, "name": t.name})).collect();
    v.extend(tag_objs(missing));
    api("PATCH", format!("/channels/{channel}"), Some(json!({"available_tags": v})))
}

fn req_create_webhook(channel: &str) -> Req {
    api("POST", format!("/channels/{channel}/webhooks"), Some(json!({"name": WEBHOOK_NAME})))
}

fn req_patch_thread_tags(thread: &str, tags: &[String]) -> Req {
    api("PATCH", format!("/channels/{thread}"), Some(json!({"applied_tags": tags, "archived": false})))
}

/// Current Pin Message endpoint (docs.discord.com/developers/resources/message).
fn req_pin(channel: &str, msg: &str) -> Req {
    api("PUT", format!("/channels/{channel}/messages/pins/{msg}"), None)
}

/// Deprecated pin path, only used as a fallback on 404.
fn req_pin_legacy(channel: &str, msg: &str) -> Req {
    api("PUT", format!("/channels/{channel}/pins/{msg}"), None)
}

fn pin_message(ctx: &Ctx, channel: &str, msg: &str) -> Result<()> {
    match ctx.send(&req_pin(channel, msg)) {
        Err(e) if e.to_string().contains("HTTP 404") => ctx.send(&req_pin_legacy(channel, msg)).map(|_| ()),
        r => r.map(|_| ()),
    }
}

fn req_start_thread(channel: &str, msg: &str, name: &str) -> Req {
    api(
        "POST",
        format!("/channels/{channel}/messages/{msg}/threads"),
        Some(json!({"name": truncate_chars(name, THREAD_NAME_MAX)})),
    )
}

fn req_webhook(url: &str, body: Value, thread_id: Option<&str>, wait: bool) -> Req {
    let mut q = vec![];
    if wait {
        q.push("wait=true".to_string());
    }
    if let Some(t) = thread_id {
        q.push(format!("thread_id={t}"));
    }
    let sep = if url.contains('?') { '&' } else { '?' };
    let full = if q.is_empty() { url.to_string() } else { format!("{url}{sep}{}", q.join("&")) };
    Req { method: "POST", target: Target::Webhook(full), body: Some(body) }
}

struct Msg<'a> {
    persona: Persona,
    avatar: Option<&'a str>,
    title: Option<&'a str>,
    text: &'a str,
    mention_user: Option<&'a str>,
    thread_name: Option<&'a str>,
    tags: &'a [String],
}

/// Webhook execute body. Short plain text -> `content`; titled or > 2000 chars -> embed.
/// Content is cut to 2000 chars, embed description to 4096, title to 256.
fn webhook_body(m: &Msg) -> Value {
    let mut b = json!({"username": m.persona.username()});
    if let Some(a) = m.avatar.filter(|a| !a.is_empty()) {
        b["avatar_url"] = json!(a);
    }
    let mention = m.mention_user.map(|u| format!("<@{u}>"));
    let embed = m.title.is_some() || m.text.chars().count() > CONTENT_MAX;
    if embed {
        let mut e = json!({"description": truncate_chars(m.text, EMBED_DESC_MAX), "color": 0x5865F2});
        if let Some(t) = m.title {
            e["title"] = json!(truncate_chars(t, EMBED_TITLE_MAX));
        }
        b["embeds"] = json!([e]);
        if let Some(mn) = &mention {
            b["content"] = json!(mn);
        }
    } else {
        let t = match &mention {
            Some(mn) => format!("{mn} {}", m.text),
            None => m.text.to_string(),
        };
        b["content"] = json!(truncate_chars(&t, CONTENT_MAX));
    }
    b["allowed_mentions"] = match m.mention_user {
        Some(u) => json!({"parse": [], "users": [u]}),
        None => json!({"parse": []}),
    };
    if let Some(n) = m.thread_name {
        b["thread_name"] = json!(truncate_chars(n, THREAD_NAME_MAX));
    }
    if !m.tags.is_empty() {
        b["applied_tags"] = json!(m.tags);
    }
    b
}

/// Dry-run rendering: secrets masked, nothing sent.
fn render_dry(req: &Req, base: &str) -> String {
    let (url, auth) = match &req.target {
        Target::Api(p) => (format!("{base}{p}"), "\n  Authorization: Bot ****"),
        Target::Webhook(u) => (mask_webhook_url(u), ""),
    };
    let mut s = format!("{} {}{}", req.method, url, auth);
    if let Some(b) = &req.body {
        s.push_str("\n  body: ");
        s.push_str(&b.to_string());
    }
    s
}

/// curl config text (fed over stdin: neither the token nor webhook URL reaches argv).
fn curl_config(method: &str, url: &str, token: Option<&str>, body: Option<&str>, max_time: u64) -> String {
    let mut c = String::new();
    c.push_str("silent\nshow-error\n");
    c.push_str(&format!("max-time = {max_time}\n"));
    c.push_str(&format!("url = {}\n", cq(url)));
    c.push_str(&format!("request = {}\n", cq(method)));
    c.push_str(&format!("user-agent = {}\n", cq("DiscordBot (https://8syncdev.com, 0.1)")));
    c.push_str("header = \"Content-Type: application/json\"\n");
    if let Some(t) = token {
        c.push_str(&format!("header = {}\n", cq(&format!("Authorization: Bot {t}"))));
    }
    match body {
        Some(b) => c.push_str(&format!("data-raw = {}\n", cq(b))),
        None if method != "GET" => c.push_str("data-raw = \"\"\n"),
        None => {}
    }
    // Status from the response headers, not `write-out`: the stock Windows curl.exe 8.8.0
    // fails every `-w` with error 43.
    c.push_str("include\n");
    c
}

struct Ctx {
    base: String,
    token: Option<String>,
    dry: bool,
    /// cap on a single 429 sleep (seconds)
    retry_cap: f64,
    max_time: u64,
    /// hook wall-clock budget (registered hook timeout is 15 s)
    deadline: Option<std::time::Instant>,
    seq: std::cell::Cell<u32>,
}

/// Hook wall-clock budget (registered timeout 15 s). Network calls and state-lock waits both stop
/// at this deadline; the final log write (<= ~1.5 s lock wait) fits in the remainder.
const HOOK_BUDGET_SECS: u64 = 8;

/// True when `base` points at a loopback host (the only override allowed, for tests).
fn is_loopback_base(base: &str) -> bool {
    let rest = base.strip_prefix("http://").or_else(|| base.strip_prefix("https://")).unwrap_or("");
    let auth = rest.split(['/', '?', '#']).next().unwrap_or("");
    if auth.contains('@') {
        return false;
    }
    let host = if let Some(h) = auth.strip_prefix('[') {
        h.split(']').next().unwrap_or("")
    } else {
        auth.split(':').next().unwrap_or("")
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// API base: `EIGHTSYNC_HQ_API_BASE` is honored only for loopback hosts, so the bot token
/// cannot be redirected to an arbitrary host.
fn api_base(env: Option<&str>) -> String {
    match env.filter(|s| !s.is_empty()) {
        Some(b) if is_loopback_base(b) => b.trim_end_matches('/').to_string(),
        Some(_) => {
            eprintln!("hq: ignoring EIGHTSYNC_HQ_API_BASE (not a loopback host)");
            DEFAULT_API.into()
        }
        None => DEFAULT_API.into(),
    }
}

impl Ctx {
    fn new(token: Option<String>, dry: bool, hook: bool) -> Self {
        Ctx {
            base: api_base(std::env::var("EIGHTSYNC_HQ_API_BASE").ok().as_deref()),
            token,
            dry,
            retry_cap: if hook { 3.0 } else { 30.0 },
            max_time: if hook { 8 } else { 30 },
            deadline: hook.then(|| std::time::Instant::now() + Duration::from_secs(HOOK_BUDGET_SECS)),
            seq: std::cell::Cell::new(0),
        }
    }

    fn send(&self, req: &Req) -> Result<Value> {
        if self.dry {
            return Ok(self.fake(req));
        }
        let (url, tok) = match &req.target {
            Target::Api(p) => {
                let t = self.token.as_deref().ok_or_else(|| anyhow!("no bot token (secrets.json or --token-stdin)"))?;
                (format!("{}{}", self.base, p), Some(t))
            }
            Target::Webhook(u) => (u.clone(), None),
        };
        let body = req.body.as_ref().map(|b| b.to_string());
        let body_s = body.as_deref();
        for attempt in 0..4 {
            let mut max_time = self.max_time;
            if let Some(d) = self.deadline {
                let left = d.saturating_duration_since(std::time::Instant::now()).as_secs();
                if left < 1 {
                    bail!("hook time budget exhausted");
                }
                max_time = max_time.min(left);
            }
            let cfg = curl_config(req.method, &url, tok, body_s, max_time);
            let (code, text) = run_curl(&cfg)?;
            if code == 429 && attempt < 3 {
                let ra = serde_json::from_str::<Value>(&text)
                    .ok()
                    .and_then(|v| v["retry_after"].as_f64())
                    .unwrap_or(1.0);
                let mut nap = ra.clamp(0.0, self.retry_cap) + 0.05;
                if let Some(d) = self.deadline {
                    nap = nap.min(d.saturating_duration_since(std::time::Instant::now()).as_secs_f64());
                }
                std::thread::sleep(Duration::from_secs_f64(nap));
                continue;
            }
            if !(200..300).contains(&code) {
                bail!("discord {} {} -> HTTP {code}: {}", req.method, mask_path(&req.target), truncate_chars(&text, 300));
            }
            return Ok(serde_json::from_str(&text).unwrap_or(Value::Null));
        }
        bail!("rate limited (429) after 3 retries")
    }

    /// Synthetic reply for --dry-run so the same code path can run end to end.
    fn fake(&self, req: &Req) -> Value {
        println!("{}", render_dry(req, &self.base));
        if req.method == "GET" {
            return json!([]);
        }
        let n = self.seq.get() + 1;
        self.seq.set(n);
        let mut v = json!({"id": format!("DRY{n}"), "token": "DRYTOKEN", "channel_id": format!("DRYTHREAD{n}")});
        for k in ["name", "type"] {
            if let Some(x) = req.body.as_ref().and_then(|b| b.get(k)) {
                v[k] = x.clone();
            }
        }
        if let Some(tags) = req.body.as_ref().and_then(|b| b["available_tags"].as_array()) {
            v["available_tags"] = Value::Array(
                tags.iter()
                    .map(|t| {
                        let name = t["name"].as_str().unwrap_or("");
                        json!({"id": t["id"].as_str().map(String::from).unwrap_or_else(|| format!("DRYTAG-{name}")), "name": name})
                    })
                    .collect(),
            );
        }
        v
    }
}

fn mask_path(t: &Target) -> String {
    match t {
        Target::Api(p) => p.clone(),
        Target::Webhook(u) => mask_webhook_url(u),
    }
}

/// Run curl with the config on stdin; returns (status, body).
fn run_curl(cfg: &str) -> Result<(u16, String)> {
    let mut child = Command::new("curl")
        .args(["--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("curl not found on PATH")?;
    child.stdin.take().context("curl stdin")?.write_all(cfg.as_bytes())?;
    let out = child.wait_with_output()?;
    if !out.status.success() {
        // stderr may echo the URL: only report the first line, scrubbed of webhook tokens.
        let e = String::from_utf8_lossy(&out.stderr);
        let first = e.lines().next().unwrap_or("curl failed");
        bail!("curl: {}", mask_webhook_url(first));
    }
    split_included(&String::from_utf8_lossy(&out.stdout)).ok_or_else(|| anyhow!("malformed curl output"))
}

/// `include` output → (status, body); interim `1xx` header blocks (`100 Continue`) are skipped.
fn split_included(s: &str) -> Option<(u16, String)> {
    let mut rest = s;
    loop {
        let (head, body) = rest.split_once("\r\n\r\n").or_else(|| rest.split_once("\n\n"))?;
        let code: u16 = head.lines().next()?.split_whitespace().nth(1)?.parse().ok()?;
        if !(100..200).contains(&code) {
            return Some((code, body.to_string()));
        }
        rest = body;
    }
}

// ── setup ───────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct Tag {
    id: String,
    name: String,
}

#[derive(Clone, Debug)]
struct Chan {
    id: String,
    name: String,
    ty: i64,
    tags: Vec<Tag>,
}

fn parse_chan(v: &Value) -> Option<Chan> {
    Some(Chan {
        id: v["id"].as_str()?.to_string(),
        name: v["name"].as_str()?.to_string(),
        ty: v["type"].as_i64().unwrap_or(0),
        tags: v["available_tags"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|t| Some(Tag { id: t["id"].as_str()?.into(), name: t["name"].as_str()?.into() }))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

fn find_chan<'a>(ex: &'a [Chan], name: &str, ty: i64) -> Option<&'a Chan> {
    ex.iter().find(|c| c.ty == ty && c.name.to_lowercase() == name.to_lowercase())
}

#[derive(Debug, PartialEq)]
struct PlanItem {
    what: &'static str,
    name: String,
    exists: bool,
}

/// Setup diff: which layout items already exist (by name + type) and which are missing.
fn plan(roles: &[String], chans: &[Chan]) -> Vec<PlanItem> {
    let mut out = vec![];
    for r in ROLE_NAMES {
        out.push(PlanItem { what: "role", name: r.into(), exists: roles.iter().any(|x| x.eq_ignore_ascii_case(r)) });
    }
    for cat in LAYOUT {
        out.push(PlanItem { what: "category", name: cat.name.into(), exists: find_chan(chans, cat.name, 4).is_some() });
        for c in cat.chans {
            out.push(PlanItem { what: "channel", name: c.name.into(), exists: find_chan(chans, c.name, c.kind.ty()).is_some() });
        }
    }
    out
}

fn missing_tags<'a>(have: &[Tag], want: &'a [&'a str]) -> Vec<&'a str> {
    want.iter().copied().filter(|w| !have.iter().any(|t| t.name.eq_ignore_ascii_case(w))).collect()
}

fn invite_hint() -> String {
    format!(
        "https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot&permissions={}",
        perm_bits()
    )
}

fn read_stdin_line() -> Result<String> {
    let mut s = String::new();
    std::io::stdin().read_line(&mut s)?;
    Ok(s.trim().to_string())
}

fn cmd_setup(guild: &str, token_stdin: bool, owner: Option<String>, dry: bool) -> Result<()> {
    let paths = Paths::new()?;
    let mut sec = load_secrets(&paths);
    if token_stdin {
        let t = read_stdin_line()?;
        if t.is_empty() {
            bail!("empty token on stdin");
        }
        sec.bot_token = Some(t);
    }
    let token = sec.bot_token.clone().ok_or_else(|| anyhow!("no bot token: use --token-stdin"))?;
    let ctx = Ctx::new(Some(token), dry, false);
    let mut cfg = load_config(&paths).unwrap_or_default();
    cfg.guild_id = guild.to_string();
    if owner.is_some() {
        cfg.owner_id = owner;
    }
    ui::header("8sync hq setup");
    let (mut created, mut existing) = (0u32, 0u32);
    let mut note = |c: bool, what: &str, name: &str| {
        if c {
            created += 1;
            ui::ok(&format!("created {what} {name}"));
        } else {
            existing += 1;
            ui::skip(&format!("{what} {name}"), "exists");
        }
    };

    // roles
    let rv = ctx.send(&api("GET", format!("/guilds/{guild}/roles"), None))?;
    let have: Vec<(String, String)> = rv
        .as_array()
        .map(|a| a.iter().filter_map(|r| Some((r["id"].as_str()?.into(), r["name"].as_str()?.into()))).collect())
        .unwrap_or_default();
    for r in ROLE_NAMES {
        let key = r.to_lowercase();
        if let Some((id, _)) = have.iter().find(|(_, n)| n.eq_ignore_ascii_case(r)) {
            cfg.roles.insert(key, id.clone());
            note(false, "role", r);
        } else {
            let v = ctx.send(&req_create_role(guild, r))?;
            cfg.roles.insert(key, v["id"].as_str().unwrap_or("").to_string());
            note(true, "role", r);
        }
    }

    // categories + channels
    let cv = ctx.send(&api("GET", format!("/guilds/{guild}/channels"), None))?;
    let chans: Vec<Chan> = cv.as_array().map(|a| a.iter().filter_map(parse_chan).collect()).unwrap_or_default();
    let have_roles: Vec<String> = have.iter().map(|(_, n)| n.clone()).collect();
    let todo = plan(&have_roles, &chans).iter().filter(|i| !i.exists).count();
    ui::info(&format!("plan: {todo} role/category/channel item(s) missing (webhooks and tags checked below)"));
    for cat in LAYOUT {
        let cat_id = match find_chan(&chans, cat.name, 4) {
            Some(c) => {
                note(false, "category", cat.name);
                c.id.clone()
            }
            None => {
                let v = ctx.send(&req_create_category(guild, cat.name))?;
                note(true, "category", cat.name);
                v["id"].as_str().unwrap_or("").to_string()
            }
        };
        for spec in cat.chans {
            let chan = match find_chan(&chans, spec.name, spec.kind.ty()) {
                Some(c) => {
                    note(false, "channel", spec.name);
                    c.clone()
                }
                None => {
                    let v = ctx.send(&req_create_channel(guild, spec, &cat_id))?;
                    note(true, "channel", spec.name);
                    parse_chan(&v).ok_or_else(|| anyhow!("unexpected channel reply for {}", spec.name))?
                }
            };
            cfg.channels.insert(spec.key.into(), chan.id.clone());
            if spec.kind == Kind::Forum && !spec.tags.is_empty() {
                let miss = missing_tags(&chan.tags, spec.tags);
                let tags = if miss.is_empty() {
                    chan.tags.clone()
                } else {
                    let v = ctx.send(&req_add_tags(&chan.id, &chan.tags, &miss))?;
                    note(true, "tags", &format!("{} (+{})", spec.name, miss.len()));
                    parse_chan(&v).map(|c| c.tags).unwrap_or_default()
                };
                let m = cfg.tags.entry(spec.key.into()).or_default();
                for t in tags {
                    m.insert(t.name.to_lowercase(), t.id);
                }
            }
        }
    }

    // one webhook per channel/forum HQ posts to (owner-desk belongs to the Channels plugin)
    for cat in LAYOUT {
        for spec in cat.chans.iter().filter(|c| c.key != "owner-desk") {
            if sec.webhooks.contains_key(spec.key) {
                note(false, "webhook", spec.key);
                continue;
            }
            let ch = cfg.channels.get(spec.key).cloned().unwrap_or_default();
            let list = ctx.send(&api("GET", format!("/channels/{ch}/webhooks"), None))?;
            let found = list.as_array().and_then(|a| {
                a.iter().find(|w| w["name"] == WEBHOOK_NAME && w["token"].is_string()).cloned()
            });
            let (w, was_new) = match found {
                Some(w) => (w, false),
                None => (ctx.send(&req_create_webhook(&ch))?, true),
            };
            let url = format!("{}/webhooks/{}/{}", ctx.base, w["id"].as_str().unwrap_or(""), w["token"].as_str().unwrap_or(""));
            sec.webhooks.insert(spec.key.into(), url);
            note(was_new, "webhook", spec.key);
        }
    }

    // charter (once), pinned
    if cfg.charter_message_id.is_none() {
        if let Some(url) = sec.webhooks.get("readme") {
            let body = webhook_body(&Msg { persona: Persona::Hq, avatar: None, title: Some("Charter"), text: CHARTER, mention_user: None, thread_name: None, tags: &[] });
            let v = ctx.send(&req_webhook(url, body, None, true))?;
            if let (Some(id), Some(ch)) = (v["id"].as_str(), cfg.channels.get("readme")) {
                if let Err(e) = pin_message(&ctx, ch, id) {
                    ui::warn(&format!("pin failed: {e}"));
                }
                cfg.charter_message_id = Some(id.to_string());
                note(true, "message", "charter");
            }
        }
    } else {
        note(false, "message", "charter");
    }

    println!();
    ui::info(&format!("created: {created} · existing: {existing}"));
    if dry {
        ui::info("dry-run: nothing sent, nothing saved");
    } else {
        cfg.enabled = true;
        save_secrets(&paths, &sec)?;
        save_config(&paths, &cfg)?;
        ui::ok(&format!("saved {} (0600) and {}", paths.secrets().display(), paths.config().display()));
    }
    ui::info("Invite the bot (no Administrator). Manage Channels / Manage Roles are for setup only: remove them after.");
    ui::info(&format!("  {}", invite_hint()));
    Ok(())
}

// ── posting / tasks ─────────────────────────────────────────────────────────

fn avatar(cfg: &Config, p: Persona) -> Option<&str> {
    cfg.avatars.get(p.key()).map(String::as_str)
}

fn exec_webhook(ctx: &Ctx, sec: &Secrets, key: &str, body: Value, thread: Option<&str>, wait: bool) -> Result<Value> {
    let url = sec.webhooks.get(key).ok_or_else(|| anyhow!("no webhook for '{key}' (run `8sync hq setup`)"))?;
    ctx.send(&req_webhook(url, body, thread, wait))
}

/// Task-board tag ids for status + role + priority (unknown names skipped).
fn applied_tags(cfg: &Config, status: &str, role: Option<&str>, prio: Option<&str>) -> Vec<String> {
    let Some(m) = cfg.tags.get(BOARD) else { return vec![] };
    let role_tag = role.and_then(Persona::parse).and_then(Persona::tag);
    [Some(status), role_tag, prio]
        .into_iter()
        .flatten()
        .filter_map(|n| m.get(n).cloned())
        .collect()
}

const PENDING: &str = "pending";
const PENDING_DONE: &str = "pending-done";
/// a TaskCompleted hook is PATCHing this task to done right now (a second one must not repeat it)
const DONE_SENDING: &str = "done-sending";
/// prune: finished tasks older than this are dropped from tasks.json
const DONE_KEEP: u64 = 14 * 86_400;
/// prune: reservations that never got a thread and are older than this are dropped
const PENDING_KEEP: u64 = 86_400;
/// a reservation older than this is treated as a crashed hook and may be taken over
const PENDING_TTL: u64 = 120;

fn is_pending(status: &str) -> bool {
    status == PENDING || status == PENDING_DONE
}

#[derive(Debug, PartialEq)]
enum Claim {
    /// caller reserved the id and must post the thread
    Created,
    /// another hook is posting it right now
    InFlight,
    /// already posted; carries the thread id
    Exists(String),
    /// a completion was asked for and the task is already done or another hook is marking it
    /// done: nothing to PATCH or comment
    Done,
}

/// The post failed. A plain reservation is dropped; one that already absorbed a TaskCompleted
/// (`pending-done`) stays, marked stale (updated=0) so the next claim takes it at once and
/// posts it as done. Returns true when the entry was kept for retry.
fn release_failed_claim(st: &mut State, id: &str) -> bool {
    match st.tasks.get_mut(id) {
        Some(t) if t.status == PENDING_DONE && t.thread_id.is_empty() => {
            t.updated = 0;
            true
        }
        Some(t) if is_pending(&t.status) => {
            st.tasks.remove(id);
            false
        }
        _ => false,
    }
}

/// Thread id of a task that already has one; errors for unknown or still-being-created tasks.
fn posted_thread(st: &State, id: &str) -> Result<String> {
    let t = st.tasks.get(id).ok_or_else(|| anyhow!("unknown task '{id}'"))?;
    if t.thread_id.is_empty() {
        bail!("task '{id}' is still being created");
    }
    Ok(t.thread_id.clone())
}

/// Idempotency core for TaskCreated/TaskCompleted racing each other. Runs under the state lock:
/// unknown id -> insert a `pending` entry (caller posts); pending (fresh) -> in flight, and a
/// completion upgrades it to `pending-done`; a completion for a posted task claims the PATCH
/// (`done-sending`) so a parallel duplicate gets `Claim::Done`; otherwise it already exists.
/// A stale `pending-done` (failed post, kept for retry) is retried when the next event or
/// `hq task new --id` for that task arrives, and is taken over still as `pending-done` so the
/// post-success path patches it to done.
fn claim_task(st: &mut State, id: &str, title: &str, role: Option<String>, prio: Option<String>, want_done: bool, now: u64) -> Claim {
    if let Some(t) = st.tasks.get_mut(id) {
        if !is_pending(&t.status) {
            if want_done {
                let fresh = now.saturating_sub(t.updated) <= PENDING_TTL;
                if t.status == "done" || (t.status == DONE_SENDING && fresh) {
                    return Claim::Done;
                }
                t.status = DONE_SENDING.into();
                t.updated = now;
            }
            return Claim::Exists(t.thread_id.clone());
        }
        if now.saturating_sub(t.updated) <= PENDING_TTL {
            if want_done {
                t.status = PENDING_DONE.into();
            }
            return Claim::InFlight;
        }
        // stale, but a thread was already recorded: never repost
        if !t.thread_id.is_empty() {
            if t.status == PENDING_DONE {
                t.status = "done".into();
                t.done_at = Some(now);
            } else {
                t.status = "todo".into();
            }
            t.updated = now;
            return Claim::Exists(t.thread_id.clone());
        }
    }
    let folded = st.tasks.get(id).is_some_and(|t| t.status == PENDING_DONE);
    let status = if want_done || folded { PENDING_DONE } else { PENDING };
    st.tasks.insert(id.to_string(), Task { thread_id: String::new(), status: status.into(), role, prio, title: title.to_string(), updated: now, done_at: None });
    Claim::Created
}

struct Env {
    paths: Paths,
    cfg: Config,
    sec: Secrets,
    ctx: Ctx,
}

impl Env {
    fn load(dry: bool, hook: bool) -> Result<Env> {
        let paths = Paths::new()?;
        let cfg = load_config(&paths).ok_or_else(|| anyhow!("HQ not configured: run `8sync hq setup --guild <id>`"))?;
        let sec = load_secrets(&paths);
        let ctx = Ctx::new(sec.bot_token.clone(), dry, hook);
        Ok(Env { paths, cfg, sec, ctx })
    }

    fn post(&self, p: Persona, key: &str, title: Option<&str>, text: &str, mention: bool) -> Result<Value> {
        let m = Msg {
            persona: p,
            avatar: avatar(&self.cfg, p),
            title,
            text,
            mention_user: if mention { self.cfg.owner_id.as_deref() } else { None },
            thread_name: None,
            tags: &[],
        };
        exec_webhook(&self.ctx, &self.sec, key, webhook_body(&m), None, false)
    }

    /// Forum webhook post: starts a new thread named `thread_name`.
    fn post_forum(&self, p: Persona, key: &str, thread_name: &str, text: &str) -> Result<()> {
        let m = Msg { persona: p, avatar: avatar(&self.cfg, p), title: None, text, mention_user: None, thread_name: Some(thread_name), tags: &[] };
        exec_webhook(&self.ctx, &self.sec, key, webhook_body(&m), None, false).map(|_| ())
    }

    /// Reserve `id` in the local state before posting (parallel hooks must not double-post).
    fn claim(&self, id: &str, title: &str, role: Option<&str>, prio: Option<&str>, want_done: bool) -> Result<Claim> {
        if self.ctx.dry {
            return Ok(Claim::Created);
        }
        let (title, role, prio) = (truncate_chars(title, THREAD_NAME_MAX), role.map(String::from), prio.map(String::from));
        update_state_with(&self.paths, self.ctx.deadline, |st| claim_task(st, id, &title, role, prio, want_done, now()))
    }

    /// Post the task thread. The caller must hold a `Claim::Created` for `id`.
    fn task_new(&self, id: &str, title: &str, body: &str, role: Option<Persona>, prio: Option<&str>, status: &str) -> Result<()> {
        let role_key = role.filter(|r| r.tag().is_some()).map(|r| r.key());
        let tags = applied_tags(&self.cfg, status, role_key, prio);
        let p = role.unwrap_or(Persona::Hq);
        let text = if body.trim().is_empty() { title } else { body };
        let m = Msg { persona: p, avatar: avatar(&self.cfg, p), title: None, text, mention_user: None, thread_name: Some(title), tags: &tags };
        let posted = exec_webhook(&self.ctx, &self.sec, BOARD, webhook_body(&m), None, true).and_then(|v| {
            v["channel_id"].as_str().map(String::from).ok_or_else(|| anyhow!("webhook reply has no channel_id (thread id not verified)"))
        });
        if self.ctx.dry {
            return posted.map(|_| ());
        }
        let thread = match posted {
            Ok(t) => t,
            Err(e) => {
                // release the reservation so a later hook can retry; a folded-in completion is kept
                let kept = update_state_with(&self.paths, self.ctx.deadline, |st| release_failed_claim(st, id)).unwrap_or(false);
                if kept {
                    log_err(&self.paths, &self.sec, &format!("task {id}: post failed with completion pending; kept pending-done for retry"));
                }
                return Err(e);
            }
        };
        let status_s = status.to_string();
        let upgrade = update_state_retry(&self.paths, self.ctx.deadline, |st| {
            let t = st.tasks.entry(id.to_string()).or_default();
            let upgrade = t.status == PENDING_DONE && status_s != "done";
            t.thread_id = thread.clone();
            t.status = status_s.clone();
            t.updated = now();
            t.done_at = (status_s == "done").then(now);
            upgrade
        });
        let upgrade = match upgrade {
            Ok(u) => u,
            Err(e) => {
                log_err(&self.paths, &self.sec, &format!("task {id}: thread {thread} posted but state write failed ({e}); reconcile manually"));
                return Err(e);
            }
        };
        if upgrade {
            // a TaskCompleted arrived while we were posting
            self.task_status(id, "done", "Completed")?;
        }
        Ok(())
    }

    fn task_status(&self, id: &str, status: &str, comment: &str) -> Result<()> {
        if !STATUSES.contains(&status) {
            bail!("status must be one of {}", STATUSES.join("|"));
        }
        let st = load_state(&self.paths);
        let id = resolve_task_id(&st, id)?;
        let id = id.as_str();
        let thread = posted_thread(&st, id)?;
        let t = &st.tasks[id];
        let tags = applied_tags(&self.cfg, status, t.role.as_deref(), t.prio.as_deref());
        // un-archive the thread together with the tag change, then post the comment (keeps it active)
        self.ctx.send(&req_patch_thread_tags(&thread, &tags))?;
        if !comment.is_empty() {
            let m = Msg { persona: Persona::Hq, avatar: avatar(&self.cfg, Persona::Hq), title: None, text: comment, mention_user: None, thread_name: None, tags: &[] };
            exec_webhook(&self.ctx, &self.sec, BOARD, webhook_body(&m), Some(&thread), false)?;
        }
        if !self.ctx.dry {
            let s = status.to_string();
            update_state_with(&self.paths, self.ctx.deadline, |st| {
                if let Some(t) = st.tasks.get_mut(id) {
                    t.status = s.clone();
                    t.updated = now();
                    t.done_at = (s == "done").then(now);
                }
            })?;
        }
        Ok(())
    }

    fn task_comment(&self, id: &str, p: Persona, text: &str) -> Result<()> {
        let st = load_state(&self.paths);
        let id = resolve_task_id(&st, id)?;
        let thread = posted_thread(&st, &id)?;
        let m = Msg { persona: p, avatar: avatar(&self.cfg, p), title: None, text, mention_user: None, thread_name: None, tags: &[] };
        exec_webhook(&self.ctx, &self.sec, BOARD, webhook_body(&m), Some(&thread), false)?;
        Ok(())
    }
}

fn read_text(stdin: bool, words: &[String]) -> Result<String> {
    let t = if stdin || words.first().map(String::as_str) == Some("-") {
        let mut b = Vec::new();
        std::io::stdin().take(1 << 20).read_to_end(&mut b)?;
        String::from_utf8_lossy(&b).into_owned() // the 1 MiB cut may split a char
    } else {
        words.join(" ")
    };
    if t.trim().is_empty() {
        bail!("no text (pass text or --stdin)");
    }
    Ok(t)
}

/// Forum channels (rfcs, notes, task-board) only accept webhook posts that start a thread,
/// which needs `thread_name`. Returns it for forum keys; None for plain text channels.
fn forum_thread_name(to: &str, title: Option<&str>) -> Result<Option<String>> {
    let forum = LAYOUT.iter().flat_map(|c| c.chans.iter()).any(|c| c.key == to && c.kind == Kind::Forum);
    if !forum {
        return Ok(None);
    }
    if to == "task-board" {
        // REQUIRE_TAG is set on the board: an untagged post is rejected, and tasks need state.
        bail!("#task-board posts are tasks: use `8sync hq task new <title> --role <role> [--prio p1]`");
    }
    match title.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => Ok(Some(t.to_string())),
        None => bail!("#{to} is a forum channel: pass --title (it becomes the thread name)"),
    }
}

fn persona_arg(s: &str) -> Result<Persona> {
    Persona::parse(s).ok_or_else(|| anyhow!("unknown persona '{s}' (pm|architect|backend|frontend|qa|reviewer|researcher|hq)"))
}

// ── hooks ───────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
enum Action {
    TaskNew { id: String, title: String, body: String, role: Option<Persona> },
    TaskDone { id: String, title: String, body: String, role: Option<Persona>, by: String },
    Log { persona: Persona, text: String },
    Alert { persona: Persona, title: String, text: String, mention: bool },
}

/// A task event from a teammate without `team_name`: its id is scoped by session only, so the
/// lead's and the teammate's sessions would not share a key.
fn lacks_team_scope(event: &str, v: &Value) -> bool {
    matches!(event.to_lowercase().as_str(), "taskcreated" | "taskcompleted") && !s(v, "task_id").is_empty() && !s(v, "teammate_name").is_empty() && s(v, "team_name").is_empty()
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}

/// Claude Code numbers tasks per task list ("1", "2", … again in every new session),
/// so a bare id collides with yesterday's tasks and the new ones were silently skipped
/// (found in UAT). Scope by `team_name` (lead + teammates share one list across
/// sessions), else `session_id`.
fn scoped_task_id(v: &Value, id: &str) -> String {
    let scope = [s(v, "team_name"), s(v, "session_id")].into_iter().find(|x| !x.is_empty());
    match scope {
        Some(sc) => format!("{sc}:{id}"),
        None => id.to_string(),
    }
}

/// Map a Claude Code hook payload to an HQ action (field names: see module docs).
fn map_hook(event: &str, v: &Value) -> Option<Action> {
    let role = || Persona::from_text(s(v, "teammate_name")).or_else(|| Persona::from_text(s(v, "task_subject")));
    match event.to_lowercase().as_str() {
        "taskcreated" | "taskcompleted" => {
            let id = s(v, "task_id");
            if id.is_empty() {
                return None;
            }
            let title = if s(v, "task_subject").is_empty() { id } else { s(v, "task_subject") }.to_string();
            let body = s(v, "task_description").to_string();
            let id = scoped_task_id(v, id);
            Some(if event.eq_ignore_ascii_case("taskcreated") {
                Action::TaskNew { id, title, body, role: role() }
            } else {
                Action::TaskDone { id, title, body, role: role(), by: s(v, "teammate_name").to_string() }
            })
        }
        "teammateidle" => {
            let n = s(v, "teammate_name");
            Some(Action::Log { persona: Persona::from_text(n).unwrap_or(Persona::Hq), text: format!("{} is idle{}", if n.is_empty() { "teammate" } else { n }, if s(v, "team_name").is_empty() { String::new() } else { format!(" (team {})", s(v, "team_name")) }) })
        }
        "notification" => {
            let ty = s(v, "notification_type");
            let (label, mention) = match ty {
                "agent_needs_input" => ("needs input", true),
                "agent_completed" => ("completed", false),
                "permission_prompt" | "permission" => ("permission", false),
                _ => return None,
            };
            let msg = s(v, "message");
            Some(Action::Alert {
                persona: Persona::Hq,
                title: if s(v, "title").is_empty() { label.to_string() } else { format!("{label}: {}", s(v, "title")) },
                text: if msg.is_empty() { label.to_string() } else { msg.to_string() },
                mention,
            })
        }
        _ => None,
    }
}

fn run_action(env: &Env, a: Action) -> Result<()> {
    match a {
        Action::TaskNew { id, title, body, role } => {
            let rk = role.filter(|r| r.tag().is_some()).map(|r| r.key());
            if env.claim(&id, &title, rk, None, false)? != Claim::Created {
                return Ok(());
            }
            env.task_new(&id, &title, &body, role, None, "todo")
        }
        Action::TaskDone { id, title, body, role, by } => {
            let note = if by.is_empty() { "Completed".to_string() } else { format!("Completed by {by}") };
            let rk = role.filter(|r| r.tag().is_some()).map(|r| r.key());
            match env.claim(&id, &title, rk, None, true)? {
                Claim::Created => env.task_new(&id, &title, &format!("{note}\n\n{body}"), role, None, "done"),
                Claim::Done => Ok(()), // finished or being finished by a parallel hook
                Claim::Exists(_) => {
                    let r = env.task_status(&id, "done", &note);
                    if r.is_err() && !env.ctx.dry {
                        // release the done-sending claim so a retry is not skipped
                        let _ = update_state_with(&env.paths, env.ctx.deadline, |st| {
                            if let Some(t) = st.tasks.get_mut(&id).filter(|t| t.status == DONE_SENDING) {
                                t.status = "todo".into();
                            }
                        });
                    }
                    r
                }
                Claim::InFlight => Ok(()), // creator upgrades it to done after posting
            }
        }
        Action::Log { persona, text } => env.post(persona, "logs", None, &text, false).map(|_| ()),
        Action::Alert { persona, title, text, mention } => env.post(persona, "alerts", Some(&title), &text, mention).map(|_| ()),
    }
}

/// Never fails, never blocks Claude: errors go to the 0600 log.
fn cmd_hook(event: &str, dry: bool) {
    let Ok(paths) = Paths::new() else { return };
    // fast silent no-op: not configured / nothing enabled -> no stdin read, no writes, no network
    let Some(cfg) = load_config(&paths) else { return };
    if !cfg.enabled && !cfg.local {
        return;
    }
    let sec = load_secrets(&paths);
    let r = (|| -> Result<()> {
        let mut buf = Vec::new();
        if !std::io::stdin().is_terminal() {
            std::io::stdin().take(1 << 20).read_to_end(&mut buf)?;
        }
        let raw = String::from_utf8_lossy(&buf); // the 1 MiB cut may split a char
        let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
        if cfg.local && !dry {
            let sid = std::env::var("EIGHTSYNC_HQ_SESSION").ok();
            if let Some(e) = journal_entry(event, &v, sid.as_deref(), now() * 1000, claude_sessions_dir().as_deref()) {
                if let Err(e) = append_journal(&paths.events(), &e.to_string(), JOURNAL_MAX) {
                    log_err(&paths, &sec, &format!("journal {event}: {e}"));
                }
            }
        }
        if !cfg.enabled {
            return Ok(());
        }
        let Some(a) = map_hook(event, &v) else { return Ok(()) };
        if lacks_team_scope(event, &v) {
            log_err(&paths, &sec, "no team_name; scoped by session");
        }
        let env = Env { ctx: Ctx::new(sec.bot_token.clone(), dry, true), paths: Paths::new()?, cfg: cfg.clone(), sec: sec.clone() };
        run_action(&env, a)
    })();
    if let Err(e) = r {
        log_err(&paths, &sec, &format!("hook {event}: {e}"));
    }
}

// ── local event journal (docs/hq-ui-contract.md §1) ────────────────────────

// ── owner inbox (messages from `hq ui` to sessions it cannot type into) ─────
//
// `hq ui` appends `{"ts","text"}` lines to `<state>/inbox/<session_id>.jsonl` (0600) for a
// session that is not in an hq-* tmux pane (any Claude Code session started elsewhere, every
// session on Windows). The kit's Stop hook (`ccc hook verify-stop`) hands them to Claude when
// the session ends its current turn: delivered once, masked.

const INBOX_TEXT: usize = 8000;

pub(crate) fn inbox_file(home: &Path, session_id: &str) -> Option<PathBuf> {
    super::ccc::report::safe_id(session_id).then(|| Paths::under(home).state_dir.join("inbox").join(format!("{session_id}.jsonl")))
}

/// A claim older than this belongs to a taker that died (killed `8sync`, closed session)
/// between claim and ack: the next idle poll serves it again instead of losing it.
const CLAIM_STALE: Duration = Duration::from_secs(120);

/// How the messages are introduced: mid-turn (Stop hook) or as the prompt of an idle session.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Framing {
    Working,
    Idle,
}

fn frame(n: usize, body: &str, f: Framing) -> String {
    let when = if f == Framing::Working { " while you were working" } else { "" };
    format!("8 Sync HQ: the owner sent you {n} message(s) from the HQ dashboard{when}. Read and act on them now (they come from the owner, not from a tool):\n{body}")
}

/// `(count, masked body)` of an inbox file's `{"ts","text"}` lines; None when none has text.
fn inbox_body(raw: &str) -> Option<(usize, String)> {
    let msgs: Vec<String> = raw
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter_map(|v| v["text"].as_str().map(|t| t.trim().to_string()))
        .filter(|t| !t.is_empty())
        .map(|t| secret_mask::mask(&t))
        .collect();
    (!msgs.is_empty()).then(|| (msgs.len(), msgs.join("\n---\n").chars().take(INBOX_TEXT).collect()))
}

/// Take (and remove) the owner's pending messages for a session: the Stop-hook block reason.
/// Rename first: a message appended while we read lands in a fresh file, and of two takers only
/// one wins the rename. A message under an idle session's claim is left to that claim.
pub(crate) fn take_inbox(home: &Path, session_id: &str) -> Option<String> {
    let file = inbox_file(home, session_id)?;
    let taken = file.with_extension(format!("taking.{}", std::process::id()));
    std::fs::rename(&file, &taken).ok()?;
    stamp(&taken, SystemTime::now()); // its age is now the take's, for the orphan sweep
    let Ok(raw) = std::fs::read_to_string(&taken) else {
        append_into(&taken, &file); // unreadable now: put it back for the next taker
        return None;
    };
    let _ = std::fs::remove_file(&taken);
    let (n, body) = inbox_body(&raw)?;
    Some(frame(n, &body, Framing::Working))
}

fn claim_file(home: &Path, session_id: &str) -> Option<PathBuf> {
    inbox_file(home, session_id).map(|f| f.with_extension("claimed"))
}

/// Claim the pending messages for an idle session (`8sync-inbox` mod) without deleting them: the
/// mod acks once its prompt entered the session, or releases them when it did not. A fresh claim
/// means a delivery is in flight (None); a stale one is served again with anything queued since.
pub(crate) fn claim_inbox(home: &Path, session_id: &str, now: SystemTime) -> Option<String> {
    let file = inbox_file(home, session_id)?;
    let claim = file.with_extension("claimed");
    sweep_orphans(&file, now);
    match std::fs::metadata(&claim).and_then(|m| m.modified()) {
        Ok(at) => {
            if now.duration_since(at).unwrap_or_default() < CLAIM_STALE {
                return None;
            }
            let newer = file.with_extension(format!("taking.{}", std::process::id()));
            if std::fs::rename(&file, &newer).is_ok() {
                append_into(&newer, &claim);
            }
        }
        Err(_) => {
            // A link never replaces a claim another poller made meanwhile (rename would, on Unix);
            // messages appended between link and unlink land in the same file, now the claim.
            match std::fs::hard_link(&file, &claim) {
                Ok(()) => {
                    let _ = std::fs::remove_file(&file);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => return None,
                Err(_) => {
                    // No hard links here (FAT, some network drives): rename, still atomic.
                    std::fs::metadata(&file).ok()?;
                    std::fs::rename(&file, &claim).ok()?;
                }
            }
        }
    }
    // The claim's age is the claim's, not the last queued message's (rename/link keep the mtime).
    stamp(&claim, now);
    let raw = std::fs::read_to_string(&claim).ok()?;
    match inbox_body(&raw) {
        Some((n, body)) => Some(frame(n, &body, Framing::Idle)),
        None => {
            let _ = std::fs::remove_file(&claim); // nothing deliverable in it
            None
        }
    }
}

/// Set a file's mtime without touching its content (a rewrite would truncate it first).
fn stamp(p: &Path, at: SystemTime) {
    if let Ok(f) = std::fs::OpenOptions::new().append(true).open(p) {
        let _ = f.set_modified(at);
    }
}

/// `<id>.taking.<pid>` files older than CLAIM_STALE belong to a taker that died between rename and
/// remove: hand them back to the inbox.
fn sweep_orphans(file: &Path, now: SystemTime) {
    let (Some(dir), Some(stem)) = (file.parent(), file.file_stem().and_then(|s| s.to_str())) else { return };
    let prefix = format!("{stem}.taking.");
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name();
        if !name.to_str().is_some_and(|n| n.starts_with(&prefix)) {
            continue;
        }
        let old = e.metadata().and_then(|m| m.modified()).is_ok_and(|at| now.duration_since(at).unwrap_or_default() >= CLAIM_STALE);
        if old {
            append_into(&e.path(), file);
        }
    }
}

/// The claimed messages entered the session: drop them. Acks carry no claim token: a late or
/// retried ack after a stale claim was re-served drops that claim (a duplicate at worst is the
/// price of never losing one; one owner, one session per id).
pub(crate) fn ack_inbox(home: &Path, session_id: &str) -> bool {
    claim_file(home, session_id).is_some_and(|c| std::fs::remove_file(c).is_ok())
}

/// The claimed messages did not enter: hand them back to the inbox for the next taker (after any
/// message queued meanwhile).
pub(crate) fn release_inbox(home: &Path, session_id: &str) -> bool {
    match (claim_file(home, session_id), inbox_file(home, session_id)) {
        (Some(c), Some(f)) if c.exists() => append_into(&c, &f),
        _ => false,
    }
}

/// Append `src` to `dst` (created 0600 when missing) and remove `src`; `src` stays when any step
/// fails, so a message is never dropped on the way.
fn append_into(src: &Path, dst: &Path) -> bool {
    let Ok(mut raw) = std::fs::read(src) else { return false };
    if !raw.is_empty() && !raw.ends_with(b"\n") {
        raw.push(b'\n');
    }
    // A torn last line in `dst` (crash, disk full) must not swallow the first appended one.
    if std::fs::read(dst).is_ok_and(|d| !d.is_empty() && !d.ends_with(b"\n")) {
        raw.insert(0, b'\n');
    }
    let mut o = std::fs::OpenOptions::new();
    o.create(true).append(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    let ok = o.open(dst).and_then(|mut f| f.write_all(&raw)).is_ok();
    ok && std::fs::remove_file(src).is_ok()
}

/// `8sync ccc inbox [--session <id>] [--ack|--release] [--json]` as a value: a claim answers
/// `{"text": string|null}`, `--ack`/`--release` answer `{"ok": bool}`. The id is `--session`, else
/// `CLAUDE_CODE_SESSION_ID`; no id or a bad one is "nothing pending".
pub(crate) fn inbox_cmd(home: &Path, rest: &[String], env_session: Option<&str>, now: SystemTime) -> Value {
    let flag = rest.iter().position(|a| a == "--session").and_then(|i| rest.get(i + 1)).filter(|v| !v.starts_with("--"));
    let id = flag.map(String::as_str).or(env_session);
    if rest.iter().any(|a| a == "--ack") {
        return json!({ "ok": id.is_some_and(|id| ack_inbox(home, id)) });
    }
    if rest.iter().any(|a| a == "--release") {
        return json!({ "ok": id.is_some_and(|id| release_inbox(home, id)) });
    }
    json!({ "text": id.and_then(|id| claim_inbox(home, id, now)) })
}

pub(crate) fn run_inbox(home: &Path, rest: &[String], env_session: Option<&str>) -> Result<()> {
    let v = inbox_cmd(home, rest, env_session, SystemTime::now());
    if rest.iter().any(|a| a == "--json") {
        println!("{v}");
    } else if let Some(t) = v["text"].as_str() {
        println!("{t}");
    }
    Ok(())
}

const JOURNAL_MAX: u64 = 5 << 20;
const JOURNAL_TEXT: usize = 4000;
/// A message to another Claude Code session keeps only this much (its summary or first line).
const PEER_TEXT: usize = 80;

/// `hq-[a-z0-9][a-z0-9-]{0,31}`
fn hq_session_ok(s: &str) -> bool {
    let b = s.as_bytes();
    s.strip_prefix("hq-").is_some_and(|r| (1..=32).contains(&r.len()) && !r.starts_with('-') && r.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')) && b.len() > 3
}

/// `~/.claude/sessions` (or under `CLAUDE_CONFIG_DIR`): Claude Code's live-session records.
fn claude_sessions_dir() -> Option<PathBuf> {
    let base = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".claude")))?;
    Some(base.join("sessions"))
}

/// The (session id, name) a SendMessage `to` points at: a `uds:<socket>` address matched against
/// `messagingSocketPath`, `id:<session id>` (a session's own name), or a session name used by exactly one record. Reads only `<pid>.json`
/// records (Claude Code 2.1.299 layout, not documented; never the `.key` files beside them).
fn resolve_peer(dir: &Path, to: &str) -> Option<(String, String)> {
    let recs: Vec<Value> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .filter_map(|p| serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok())
        .collect();
    let id = |r: &Value| Some((r["sessionId"].as_str().filter(|x| !x.is_empty())?.to_string(), r["name"].as_str().unwrap_or_default().to_string()));
    if let Some(sid) = to.strip_prefix("id:") {
        return recs.iter().find(|r| r["sessionId"].as_str() == Some(sid)).and_then(id);
    }
    if let Some(sock) = to.strip_prefix("uds:") {
        return recs.iter().find(|r| r["messagingSocketPath"].as_str() == Some(sock)).and_then(id);
    }
    let mut named = recs.iter().filter(|r| r["name"].as_str() == Some(to));
    match (named.next(), named.next()) {
        (Some(r), None) => id(r),
        _ => None,
    }
}

/// One journal line for a hook payload, or None for events the UI does not show.
/// `peers`: Claude Code's session records dir (`None` in tests: no lookup).
fn journal_entry(event: &str, v: &Value, session_env: Option<&str>, ts_ms: u64, peers: Option<&Path>) -> Option<Value> {
    let sess = s(v, "session_id");
    let hq_session = session_env.filter(|x| hq_session_ok(x));
    let (mut subject, mut from, mut to, mut text) = (None, None, None, None);
    let (mut peer, mut to_name, mut from_name): (Option<String>, Option<String>, Option<String>) = (None, None, None);
    let mut task_id = None;
    let kind = match event.to_lowercase().as_str() {
        k @ ("taskcreated" | "taskcompleted") => {
            let id = s(v, "task_id");
            if id.is_empty() {
                return None;
            }
            task_id = Some(scoped_task_id(v, id));
            subject = Some(if s(v, "task_subject").is_empty() { id } else { s(v, "task_subject") }.to_string());
            from = Some(s(v, "teammate_name").to_string()).filter(|x| !x.is_empty());
            if k == "taskcreated" { "task_created" } else { "task_completed" }
        }
        "teammateidle" => {
            from = Some(s(v, "teammate_name").to_string()).filter(|x| !x.is_empty());
            "teammate_idle"
        }
        // Bodies of Notification / Stop only for sessions started by `hq ui` (hq-*).
        "notification" if hq_session.is_some() => {
            text = Some(format!("{}: {}", s(v, "notification_type"), s(v, "message")));
            "notification"
        }
        "sessionstart" => "session_start",
        "sessionend" => "session_end",
        "stop" if hq_session.is_some() => {
            // Stop input `last_assistant_message`: https://code.claude.com/docs/en/hooks (Stop), read in ccc/gate.rs
            text = Some(v["last_assistant_message"].as_str().filter(|m| !m.trim().is_empty())?.to_string());
            "session_reply"
        }
        // A specialist (kit agent) entering or leaving the session's room: agent_type is a
        // name (explore, task, reviewer…), agent_id an opaque id kept in `task_id`.
        k @ ("subagentstart" | "subagentstop") => {
            let id = s(v, "agent_id");
            if !super::ccc::report::safe_id(id) {
                return None;
            }
            task_id = Some(id.to_string());
            subject = Some(s(v, "agent_type").to_string()).filter(|x| !x.is_empty());
            if k == "subagentstart" { "subagent_start" } else { "subagent_stop" }
        }
        "posttooluse" if s(v, "tool_name") == "SendMessage" => {
            let i = &v["tool_input"];
            from = session_env.filter(|x| !x.is_empty()).or(Some(sess)).map(String::from);
            to = i["to"].as_str().map(String::from);
            // A message to another session (`uds:…` address or its name) is filed under that
            // session's id, so HQ can pair it with the reply and show "answered".
            from_name = peers.and_then(|d| resolve_peer(d, &format!("id:{sess}"))).map(|(_, n)| n).filter(|n| !n.is_empty());
            if let Some((sid, name)) = to.as_deref().and_then(|t| resolve_peer(peers?, t)) {
                peer = Some(sid.clone());
                to_name = Some(name);
                to = Some(sid);
            }
            text = Some(i["message"].as_str().map_or_else(|| i["message"].to_string(), String::from));
            // Another session may belong to another project or client: keep only its summary (≤80
            // chars), never the message body (8 Sync data minimisation).
            if peer.is_some() || to.as_deref().is_some_and(|t| t.starts_with("uds:")) {
                let sum = i["summary"].as_str().filter(|x| !x.trim().is_empty()).map_or_else(|| text.clone().unwrap_or_default(), String::from);
                text = Some(sum.lines().next().unwrap_or_default().chars().take(PEER_TEXT).collect());
            }
            "session_message"
        }
        _ => return None,
    };
    let role = Persona::from_text(s(v, "teammate_name")).or_else(|| Persona::from_text(s(v, "task_subject"))).map(|p| p.key());
    let team = Some(s(v, "team_name")).filter(|x| !x.is_empty());
    // every free-text field goes through the shared masker before it is stored
    let text = text.map(|t| secret_mask::mask(&t).chars().take(JOURNAL_TEXT).collect::<String>());
    let subject = subject.map(|t| secret_mask::mask(&t).chars().take(JOURNAL_TEXT).collect::<String>());
    // The sender is often this session's own id (a uuid, already stored unmasked as session_id): the masker
    // would turn it into "***" and every handoff would lose its sender, so only foreign names are masked.
    let keep = |t: String| if t == sess || peer.as_deref() == Some(t.as_str()) { t } else { secret_mask::mask(&t) };
    let (from, to) = (from.map(keep), to.map(keep));
    let (to_name, from_name) = (to_name.map(|n| secret_mask::mask(&n)), from_name.map(|n| secret_mask::mask(&n)));
    Some(json!({"v":1,"ts":ts_ms,"kind":kind,"session_id":sess,"hq_session":hq_session,"team":team,"cwd":s(v,"cwd"),
        "task_id":task_id,"subject":subject,"role":role,"from":from,"to":to,"from_name":from_name,"to_name":to_name,"text":text}))
}

/// Append one line (0600, dir 0700); rotate to `events.1.jsonl` once the file reaches `max`.
fn append_journal(path: &Path, line: &str, max: u64) -> Result<()> {
    let dir = path.parent().ok_or_else(|| anyhow!("no parent dir"))?;
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    if std::fs::metadata(path).is_ok_and(|m| m.len() >= max) {
        std::fs::rename(path, path.with_file_name("events.1.jsonl"))?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.append(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)?.write_all(format!("{line}\n").as_bytes())?;
    Ok(())
}

// ── ui ──────────────────────────────────────────────────────────────────────

/// Where the UI comes from.
#[derive(Debug, PartialEq)]
enum AppSrc {
    /// `--app` / env / repo checkout: a Next app dir, run with its `start` script
    Dev(PathBuf),
    /// the release asset extracted by `install_hq_ui`: `<dir>/hq-ui/server.js` + `<dir>/hq-channel/server.mjs`
    Installed(PathBuf),
}

/// What to run per source. Only the installed release asset has `server.js` next to its static files;
/// a repo checkout / --app / env dir runs the app's own `start` script (`next start`), because
/// `.next/standalone/server.js` there has no `.next/static` and would 404 every asset.
fn ui_argv(src: &AppSrc, have_pnpm: bool) -> (&'static str, Vec<String>) {
    match src {
        AppSrc::Installed(dir) => ("node", vec![dir.join("hq-ui/server.js").display().to_string()]),
        AppSrc::Dev(app) => {
            let dir = app.display().to_string();
            if have_pnpm { ("pnpm", vec!["--dir".into(), dir, "start".into()]) } else { ("npm", vec!["--prefix".into(), dir, "start".into()]) }
        }
    }
}

fn hq_ui_installed(dir: &Path) -> bool {
    dir.join("hq-ui/server.js").is_file() && dir.join("hq-channel/server.mjs").is_file()
}

/// `--app` > `EIGHTSYNC_HQ_UI_APP` > installed `<dir>` > `~/tools/su-code/apps/hq-ui` (only if built).
/// `None` = nothing usable: the caller installs the release asset.
fn resolve_app(flag: Option<PathBuf>, env: Option<PathBuf>, installed: &Path, home: &Path) -> Result<Option<AppSrc>> {
    if let Some(p) = flag.or(env) {
        return if p.is_dir() { Ok(Some(AppSrc::Dev(p))) } else { bail!("hq-ui app dir not found: {}", p.display()) };
    }
    if hq_ui_installed(installed) {
        return Ok(Some(AppSrc::Installed(installed.to_path_buf())));
    }
    let dev = home.join("tools/su-code/apps/hq-ui");
    Ok(dev.join(".next").is_dir().then_some(AppSrc::Dev(dev)))
}

const HQ_UI_REPO: &str = "8-Sync-Dev/su-code";

fn hq_ui_asset(ver: &str) -> String {
    format!("8sync-hq-ui-v{ver}.tar.gz")
}

fn hq_ui_url(ver: &str, suffix: &str) -> String {
    format!("https://github.com/{HQ_UI_REPO}/releases/download/v{ver}/{}{suffix}", hq_ui_asset(ver))
}

/// `<platform data dir>/8sync/hq-ui` (`~/.local/share/8sync/hq-ui` on Linux).
fn hq_ui_data_dir() -> Result<PathBuf> {
    Ok(dirs::data_dir().ok_or_else(|| anyhow!("cannot resolve data directory"))?.join(crate::brand::NS).join("hq-ui"))
}

/// The hash out of a `sha256sum` file (`<hex>  <name>`); anything but 64 hex chars is None.
fn parse_sha256_file(text: &str) -> Option<String> {
    super::selfup::parse_digest(text.split_whitespace().next()?)
}

/// Refuse unless `tarball`'s sha256 equals the one in `sha_text`. No hasher = refuse (the asset is code we run).
fn verify_tarball(tarball: &Path, sha_text: &str) -> Result<String> {
    let want = parse_sha256_file(sha_text).ok_or_else(|| anyhow!("malformed .sha256 file (want sha256sum format)"))?;
    let got = super::selfup::sha256_file(tarball).ok_or_else(|| anyhow!("no working sha256sum, shasum or certutil: cannot verify, refusing to install"))?;
    if got != want {
        bail!("checksum mismatch for {} - refusing to install\n  expected sha256:{want}\n  actual   sha256:{got}", tarball.display());
    }
    Ok(got)
}

/// Map curl's HTTP status to an error (pure, so it is testable without a network).
fn download_status(code: u16, url: &str, ver: &str) -> Result<()> {
    match code {
        200 => Ok(()),
        404 => bail!("download failed (HTTP 404): {url}\n  the release or asset for v{ver} may not exist yet (a dev or unreleased build?) - use --app <dir> or wait for the release"),
        _ => bail!("download failed (HTTP {code}): {url}"),
    }
}

/// The HTTP status in curl's `--fail` message (`curl: (22) The requested URL returned error: 404`).
fn failed_status(stderr: &str) -> Option<u16> {
    stderr.split("returned error:").nth(1)?.trim().split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

/// No `write-out`: the stock Windows `curl.exe` (8.8.0) fails every `-w` with error 43, so the
/// status comes from `fail` (exit 22 + "returned error: <code>") instead.
fn curl_download(url: &str, dest: &Path, ver: &str) -> Result<()> {
    let cfg = format!(
        "silent\nshow-error\nfail\nlocation\nproto = \"=https\"\ntlsv1.2\nmax-time = 300\nurl = {}\noutput = {}\n",
        cq(url),
        cq(&dest.display().to_string())
    );
    let mut child = Command::new("curl")
        .args(["--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("curl not found on PATH")?;
    child.stdin.take().context("curl stdin")?.write_all(cfg.as_bytes())?;
    let out = child.wait_with_output()?;
    if out.status.success() {
        return Ok(());
    }
    let _ = std::fs::remove_file(dest);
    let e = String::from_utf8_lossy(&out.stderr);
    match failed_status(&e) {
        Some(code) => download_status(code, url, ver),
        None => bail!("download failed: {url}\n  curl: {}", e.lines().next().unwrap_or("curl failed")),
    }
}

const INSTALL_LOCK_STALE: Duration = Duration::from_secs(600);
const INSTALL_LEFTOVER_AGE: Duration = Duration::from_secs(3600);

fn age_of(p: &Path) -> Duration {
    std::fs::symlink_metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).unwrap_or_default()
}

/// `<base>/.install.lock` (create_new), stale after 10 min; removed on drop.
struct InstallLock(PathBuf);

impl InstallLock {
    fn acquire(base: &Path) -> Result<Self> {
        let f = base.join(".install.lock");
        for _ in 0..2 {
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&f) {
                Ok(mut h) => {
                    let _ = write!(h, "{}", std::process::id());
                    return Ok(Self(f));
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    if age_of(&f) < INSTALL_LOCK_STALE {
                        bail!("another 8sync is installing the HQ UI ({} exists); retry in a minute", f.display());
                    }
                    let _ = std::fs::remove_file(&f);
                }
                Err(e) => return Err(e).with_context(|| format!("lock {}", f.display())),
            }
        }
        bail!("cannot take {}", f.display())
    }
}

impl Drop for InstallLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Remove `.tmp-*` / `.dl-*` / `.old-*` older than 1 h (crashed installs).
fn cleanup_leftovers(base: &Path) {
    let Ok(rd) = std::fs::read_dir(base) else { return };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if [".tmp-", ".dl-", ".old-"].iter().any(|p| n.starts_with(p)) && age_of(&e.path()) >= INSTALL_LEFTOVER_AGE {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// Keep `keep` and the newest other version dir (rollback); delete the rest. Dot-dirs are not versions.
fn prune_versions(base: &Path, keep: &Path) {
    let Ok(rd) = std::fs::read_dir(base) else { return };
    let mut others: Vec<(Duration, PathBuf)> = rd
        .flatten()
        .filter(|e| !e.file_name().to_string_lossy().starts_with('.') && e.path() != keep && e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| (age_of(&e.path()), e.path()))
        .collect();
    others.sort();
    for (_, p) in others.into_iter().skip(1) {
        let _ = std::fs::remove_dir_all(p);
    }
}

/// Entry names from `tar -t`: refuse absolute paths and `..` components before extracting anything.
fn check_entry_names(listing: &str) -> Result<()> {
    for l in listing.lines() {
        let p = Path::new(l.trim_end_matches('\r'));
        if p.is_absolute() || l.starts_with('/') || l.contains(":\\") || p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            bail!("unsafe path in tarball (absolute or ..): {l:?}");
        }
    }
    Ok(())
}

/// `tar -tv` listing: refuse symlink (`l`) and hard-link (`h`) entries.
fn check_no_links(verbose: &str) -> Result<()> {
    if let Some(l) = verbose.lines().find(|l| l.starts_with('l') || l.starts_with('h')) {
        bail!("link entry in the hq-ui tarball (refused): {l:?}");
    }
    Ok(())
}

/// Walk the extracted tree (never following links): any symlink or file whose resolved path
/// leaves `root` is an error.
fn check_tree_confined(root: &Path) -> Result<()> {
    use std::path::Component;
    let croot = std::fs::canonicalize(root)?;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir)?.flatten() {
            let p = e.path();
            let md = std::fs::symlink_metadata(&p)?;
            if md.file_type().is_symlink() {
                let tgt = std::fs::read_link(&p)?;
                let mut lex = dir.clone();
                if tgt.is_absolute() {
                    bail!("symlink with absolute target in tarball: {} -> {}", p.display(), tgt.display());
                }
                for c in tgt.components() {
                    match c {
                        Component::ParentDir => {
                            lex.pop();
                        }
                        Component::Normal(x) => lex.push(x),
                        _ => {}
                    }
                }
                if !lex.starts_with(root) {
                    bail!("symlink escapes the install dir: {} -> {}", p.display(), tgt.display());
                }
            }
            // resolved path (follows links, incl. chains); a dangling link has none and passed the lexical check
            if let Ok(real) = std::fs::canonicalize(&p) {
                if !real.starts_with(&croot) {
                    bail!("{} resolves outside the install dir: {}", p.display(), real.display());
                }
            }
            if md.is_dir() {
                stack.push(p);
            }
        }
    }
    Ok(())
}

/// Extract a verified tarball into `<base>/.tmp-<pid>`, validate, then swap it into `target`
/// (`<base>/<ver>`): existing -> `.old-<ver>-<pid>`, tmp -> target, delete old; any failure restores old.
fn extract_install(tarball: &Path, target: &Path) -> Result<()> {
    let base = target.parent().ok_or_else(|| anyhow!("bad install path"))?;
    std::fs::create_dir_all(base)?;
    let _lock = InstallLock::acquire(base)?;
    cleanup_leftovers(base);
    let pid = std::process::id();
    let ver = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = base.join(format!(".tmp-{pid}"));
    let old = base.join(format!(".old-{ver}-{pid}"));
    let _ = std::fs::remove_dir_all(&tmp);
    let _ = std::fs::remove_dir_all(&old);
    std::fs::create_dir_all(&tmp)?;
    let res = (|| -> Result<()> {
        let ls = Command::new("tar").arg("-tzf").arg(tarball).output().context("tar not found on PATH")?;
        if !ls.status.success() {
            bail!("tar -tzf failed ({})", ls.status);
        }
        check_entry_names(&String::from_utf8_lossy(&ls.stdout))?;
        // The release asset ships no links; refuse them before extraction so a link can't
        // redirect a later entry's write (check_tree_confined only runs afterwards).
        let lv = Command::new("tar").arg("-tvzf").arg(tarball).output().context("tar not found on PATH")?;
        if !lv.status.success() {
            bail!("tar -tvzf failed ({})", lv.status);
        }
        check_no_links(&String::from_utf8_lossy(&lv.stdout))?;
        let st = Command::new("tar").arg("-xzf").arg(tarball).arg("-C").arg(&tmp).status().context("tar not found on PATH")?;
        if !st.success() {
            bail!("tar -xzf failed ({st})");
        }
        check_tree_confined(&tmp)?;
        if !hq_ui_installed(&tmp) {
            bail!("asset is missing hq-ui/server.js or hq-channel/server.mjs");
        }
        let had_old = target.exists();
        if had_old {
            std::fs::rename(target, &old).with_context(|| format!("move aside {}", target.display()))?;
        }
        if let Err(e) = std::fs::rename(&tmp, target) {
            if had_old {
                let _ = std::fs::rename(&old, target);
            }
            return Err(e).with_context(|| format!("install {}", target.display()));
        }
        let _ = std::fs::remove_dir_all(&old);
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    if res.is_ok() {
        prune_versions(base, target);
    }
    res
}

/// Optional second check: the digest GitHub's API lists for the asset (same helper selfup uses for the
/// binary). A listed digest that differs is fatal; none (offline, throttled) is a warning, not a pass.
fn check_api_digest(got: &str, api: Option<&str>) -> Result<()> {
    match api {
        Some(d) if d != got => bail!("checksum mismatch vs the GitHub API asset digest - refusing to install\n  api    sha256:{d}\n  actual sha256:{got}"),
        Some(_) => Ok(()),
        None => {
            ui::warn("GitHub API digest not available: integrity is checked against the release's .sha256 only");
            Ok(())
        }
    }
}

/// Get the release asset for `ver` (download, or `EIGHTSYNC_HQ_UI_TARBALL` for tests), verify, install into `target`.
fn install_hq_ui(target: &Path, ver: &str) -> Result<()> {
    let parent = target.parent().ok_or_else(|| anyhow!("bad install path"))?;
    std::fs::create_dir_all(parent)?;
    if let Some(local) = std::env::var_os("EIGHTSYNC_HQ_UI_TARBALL").map(PathBuf::from) {
        ui::info(&format!("installing hq-ui from {}", local.display()));
        let mut sha = local.clone().into_os_string();
        sha.push(".sha256");
        let sha_text = std::fs::read_to_string(&sha).with_context(|| format!("read {}", PathBuf::from(&sha).display()))?;
        verify_tarball(&local, &sha_text)?;
        return extract_install(&local, target);
    }
    let dl = parent.join(format!(".dl-{}-{}", std::process::id(), now()));
    std::fs::create_dir_all(&dl)?;
    let res = (|| -> Result<()> {
        let (tgz, sha) = (dl.join(hq_ui_asset(ver)), dl.join("asset.sha256"));
        ui::info(&format!("downloading the HQ UI (~4 MB, first run only): {}", hq_ui_url(ver, "")));
        curl_download(&hq_ui_url(ver, ""), &tgz, ver)?;
        curl_download(&hq_ui_url(ver, ".sha256"), &sha, ver)?;
        let got = verify_tarball(&tgz, &std::fs::read_to_string(&sha)?)?;
        check_api_digest(&got, super::selfup::fetch_asset_digest(&format!("v{ver}"), &hq_ui_asset(ver)).as_deref())?;
        ui::info("checksum ok");
        extract_install(&tgz, target)
    })();
    let _ = std::fs::remove_dir_all(&dl);
    res
}

/// The `--mcp-config` file for `claude` (same shape as apps/hq-channel/src/mcp-config.ts).
fn channel_mcp_json(node: &str, server: &Path) -> Value {
    json!({"mcpServers": {"8sync-hq": {"command": node, "args": [server.display().to_string()], "env": {"MCP_PROTOCOL_NEGOTIATION": "legacy"}}}})
}

fn write_channel_mcp(paths: &Paths, server: &Path, node: &str) -> Result<PathBuf> {
    let f = paths.cfg_dir.join("channel-mcp.json");
    write_private(&f, format!("{}\n", serde_json::to_string_pretty(&channel_mcp_json(node, server))?).as_bytes())?;
    Ok(f)
}

/// Default `HQ_CHANNEL_FLAGS` for the UI process. None when the path would not pass the UI's flag
/// allow-list (no spaces, plain characters): the UI then falls back to its own default lookup.
fn channel_flags(cfg: &Path) -> Option<String> {
    let c = cfg.to_str()?;
    c.bytes().all(|b| b.is_ascii_alphanumeric() || b"@:/._=,~-".contains(&b)).then(|| format!("--mcp-config {c} --dangerously-load-development-channels server:8sync-hq"))
}

/// `v22.5.1` -> true when >= 22.5.
fn node_ok(ver: &str) -> bool {
    let mut n = ver.trim().trim_start_matches('v').split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    (n.next().unwrap_or(0), n.next().unwrap_or(0)) >= (22, 5)
}

const LOCAL_ON_NOTICE: &str = "HQ local journal on: hq-* sessions' messages are stored in ~/.local/state/8sync/hq (0600). Turn off: 8sync hq ui --off";

/// `8sync hq ui --off`: stop writing the journal (existing files stay; `hq purge` deletes them).
fn cmd_ui_off() -> Result<()> {
    let paths = Paths::new()?;
    let mut cfg = load_config(&paths).unwrap_or_default();
    if cfg.local {
        cfg.local = false;
        save_config(&paths, &cfg)?;
    }
    ui::ok("HQ local journal off (local = false). Existing data stays until `8sync hq purge`.");
    Ok(())
}

/// Local HQ data files under the state dir: `events*.jsonl`, `hq.db*`, `channel-*.json`.
fn purge_targets(state_dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(state_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            (n.starts_with("events") && n.ends_with(".jsonl")) || n.starts_with("hq.db") || (n.starts_with("channel-") && n.ends_with(".json"))
        })
        .map(|e| e.path())
        .collect();
    v.sort();
    v
}

fn cmd_purge(yes: bool) -> Result<()> {
    let paths = Paths::new()?;
    let files = purge_targets(&paths.state_dir);
    if files.is_empty() {
        ui::info(&format!("nothing to delete in {}", paths.state_dir.display()));
        return Ok(());
    }
    for f in &files {
        println!("{}{}", if yes { "delete " } else { "would delete " }, f.display());
    }
    if !yes {
        ui::info("nothing deleted; stop `8sync hq ui`, then re-run with --yes");
        return Ok(());
    }
    for f in &files {
        std::fs::remove_file(f).with_context(|| format!("delete {}", f.display()))?;
    }
    ui::ok(&format!("deleted {} file(s)", files.len()));
    Ok(())
}

fn cmd_ui(port: u16, app: Option<PathBuf>, no_open: bool, update: bool, dry: bool) -> Result<()> {
    let paths = Paths::new()?;
    let home = dirs::home_dir().ok_or_else(|| anyhow!("cannot resolve home directory"))?;
    let ver = env!("CARGO_PKG_VERSION");
    let installed = hq_ui_data_dir()?.join(ver);
    let env_app = std::env::var_os("EIGHTSYNC_HQ_UI_APP").map(PathBuf::from);
    if !dry {
        let out = Command::new("node").arg("--version").output().map_err(|_| anyhow!("node not found on PATH (need >= 22.5)"))?;
        let nv = String::from_utf8_lossy(&out.stdout);
        if !node_ok(&nv) {
            bail!("node {} is too old (need >= 22.5)", nv.trim());
        }
    }
    let explicit = app.is_some() || env_app.is_some();
    let src = if update && !explicit { None } else { resolve_app(app, env_app, &installed, &home)? };
    let src = match src {
        Some(s) => s,
        None if dry => AppSrc::Installed(installed.clone()),
        None => {
            install_hq_ui(&installed, ver)?;
            ui::ok(&format!("HQ UI installed in {}", installed.display()));
            AppSrc::Installed(installed.clone())
        }
    };
    if update && explicit {
        ui::warn("--update ignored: --app / EIGHTSYNC_HQ_UI_APP is set, so nothing is downloaded");
    }
    let mut flags = None;
    let (prog, args): (&str, Vec<String>) = match &src {
        AppSrc::Installed(dir) => {
            let cfg = paths.cfg_dir.join("channel-mcp.json");
            if !dry {
                let node = which::which("node").map(|p| p.display().to_string()).unwrap_or_else(|_| "node".into());
                write_channel_mcp(&paths, &dir.join("hq-channel/server.mjs"), &node)?;
            }
            flags = std::env::var_os("HQ_CHANNEL_FLAGS").is_none().then(|| channel_flags(&cfg)).flatten();
            ("node", vec![dir.join("hq-ui/server.js").display().to_string()])
        }
        AppSrc::Dev(_) => ui_argv(&src, Command::new("pnpm").arg("--version").output().is_ok()),
    };
    let url = format!("http://127.0.0.1:{port}");
    if dry {
        if let AppSrc::Installed(d) = &src {
            if !hq_ui_installed(d) || update {
                println!("download {} (+ .sha256), verify, extract to {}", hq_ui_url(ver, ""), d.display());
            }
            println!("write {}", paths.cfg_dir.join("channel-mcp.json").display());
        }
        println!("set local = true in {}\nHOSTNAME=127.0.0.1 PORT={port} {prog} {}\nopen {url}{}", paths.config().display(), args.join(" "), if no_open { " (skipped)" } else { "" });
        return Ok(());
    }
    let mut cmd = Command::new(prog);
    cmd.args(&args).env("HOSTNAME", "127.0.0.1").env("PORT", port.to_string());
    if let Some(f) = &flags {
        cmd.env("HQ_CHANNEL_FLAGS", f);
    }
    let mut child = cmd.spawn().with_context(|| format!("start {prog}"))?;
    // journal on only once the UI process exists
    let mut cfg = load_config(&paths).unwrap_or_default();
    if !cfg.local {
        cfg.local = true;
        if let Err(e) = save_config(&paths, &cfg) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
        ui::info(LOCAL_ON_NOTICE);
    }
    if !no_open {
        std::thread::spawn(move || {
            for _ in 0..60 {
                if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                    let (o, a): (&str, &[&str]) = if cfg!(target_os = "macos") { ("open", &[]) } else if cfg!(windows) { ("cmd", &["/c", "start", ""]) } else { ("xdg-open", &[]) };
                    let _ = Command::new(o).args(a).arg(&url).stdout(Stdio::null()).stderr(Stdio::null()).status();
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
    }
    let st = child.wait()?;
    if st.success() { Ok(()) } else { bail!("{prog} exited with {st}") }
}

// ── standup ─────────────────────────────────────────────────────────────────

fn civil_ymd(secs: u64) -> String {
    // days since epoch -> y-m-d (Howard Hinnant's algorithm), UTC
    let z = (secs / 86400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn today() -> String {
    Command::new("date")
        .arg("+%F")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| civil_ymd(now()))
}

/// One embed per role: doing / review / blocked / done in the last 24 h. No model call.
fn standup_embeds(st: &State, now: u64) -> Vec<Value> {
    let mut by: BTreeMap<String, Vec<&Task>> = BTreeMap::new();
    for t in st.tasks.values() {
        by.entry(t.role.clone().unwrap_or_else(|| "hq".into())).or_default().push(t);
    }
    let mut out = vec![];
    for p in PERSONAS {
        let Some(ts) = by.get(p.key()) else { continue };
        let mut sections = vec![];
        for (label, f) in [
            ("Doing", Box::new(|t: &Task| t.status == "doing") as Box<dyn Fn(&Task) -> bool>),
            ("In review", Box::new(|t: &Task| t.status == "review")),
            ("Blocked", Box::new(|t: &Task| t.status == "blocked")),
            ("Done (24h)", Box::new(move |t: &Task| t.status == "done" && t.done_at.map(|d| now.saturating_sub(d) <= 86_400).unwrap_or(false))),
        ] {
            let lines: Vec<String> = ts.iter().filter(|t| f(t)).map(|t| format!("• {}", t.title)).collect();
            if !lines.is_empty() {
                sections.push(format!("**{label}**\n{}", lines.join("\n")));
            }
        }
        if sections.is_empty() {
            continue;
        }
        out.push(json!({"title": truncate_chars(&format!("{} · standup", p.label()), EMBED_TITLE_MAX), "description": truncate_chars(&sections.join("\n\n"), EMBED_DESC_MAX), "color": 0x5865F2}));
    }
    if out.is_empty() {
        out.push(json!({"title": "Standup", "description": "No active or recently completed tracked tasks.", "color": 0x5865F2}));
    }
    out.truncate(10);
    out
}

fn cmd_standup(dry: bool) -> Result<()> {
    let env = Env::load(dry, false)?;
    let day = today();
    let embeds = standup_embeds(&load_state(&env.paths), now());
    let hq = Persona::Hq;
    let head = webhook_body(&Msg { persona: hq, avatar: avatar(&env.cfg, hq), title: None, text: &format!("Daily standup {day}"), mention_user: None, thread_name: None, tags: &[] });
    let v = exec_webhook(&env.ctx, &env.sec, "standup", head, None, true)?;
    let thread = match (v["id"].as_str(), env.cfg.channels.get("standup"), env.sec.bot_token.is_some()) {
        (Some(m), Some(ch), true) => env.ctx.send(&req_start_thread(ch, m, &format!("Standup {day}"))).ok().and_then(|t| t["id"].as_str().map(String::from)),
        _ => None,
    };
    let mut body = json!({"username": hq.username(), "embeds": embeds, "allowed_mentions": {"parse": []}});
    if let Some(a) = avatar(&env.cfg, hq) {
        body["avatar_url"] = json!(a);
    }
    exec_webhook(&env.ctx, &env.sec, "standup", body, thread.as_deref(), false)?;
    ui::ok(&format!("standup {day} posted ({} embed(s))", embeds.len()));
    Ok(())
}

// ── status / doctor ─────────────────────────────────────────────────────────

fn cmd_status() -> Result<()> {
    let paths = Paths::new()?;
    ui::header("8sync hq status");
    let cfg = load_config(&paths);
    match &cfg {
        Some(c) => ui::ok(&format!("config {} · enabled={} · guild={} · owner_id={}", paths.config().display(), c.enabled, if c.guild_id.is_empty() { "-" } else { &c.guild_id }, if c.owner_id.is_some() { "set" } else { "unset" })),
        None => ui::warn(&format!("no config at {} (run `8sync hq setup --guild <id>`)", paths.config().display())),
    }
    let sec = load_secrets(&paths);
    match mode_of(&paths.secrets()) {
        Some(0o600) => ui::ok("secrets.json mode 0600"),
        Some(m) => ui::warn(&format!("secrets.json mode {m:o} (want 600): chmod 600 {}", paths.secrets().display())),
        None if paths.secrets().exists() => ui::info("secrets.json present (perms not checked on this OS)"),
        None => ui::warn("no secrets.json"),
    }
    if let Some(m) = mode_of(&paths.cfg_dir) {
        if m != 0o700 {
            ui::warn(&format!("{} mode {m:o} (want 700)", paths.cfg_dir.display()));
        }
    }
    ui::info(&format!("bot token: {}", sec.bot_token.as_deref().map(mask).unwrap_or_else(|| "missing".into())));
    if let Some(c) = &cfg {
        for (k, id) in &c.channels {
            let wh = sec.webhooks.get(k).map(|u| mask_webhook_url(u)).unwrap_or_else(|| "no webhook".into());
            println!("  #{k:<14} {id}  {wh}");
        }
    }
    let st = load_state(&paths);
    ui::info(&format!("tracked tasks: {} (newest 15: id status role title)", st.tasks.len()));
    for (id, t) in recent_tasks(&st, 15) {
        println!("{}", task_line(id, t));
    }
    if let Ok(l) = std::fs::read_to_string(paths.log()) {
        let lines: Vec<&str> = l.lines().collect();
        ui::info(&format!("last errors ({} in log):", lines.len()));
        for x in lines.iter().rev().take(5).rev() {
            println!("  {}", scrub(x, &sec.values()));
        }
    }
    Ok(())
}

// ── up (systemd user unit + standup timer) ──────────────────────────────────

const CHANNELS_CMD: &str = "--channels plugin:discord@claude-plugins-official";

/// Escape a value for a systemd unit: `%` -> `%%` (specifiers) and `$` -> `$$` (env expansion).
/// WorkingDirectory= does not expand `$`: only `%` specifiers need escaping there.
fn sd_escape_pct(s: &str) -> String {
    s.replace('%', "%%")
}

fn sd_escape(s: &str) -> String {
    s.replace('%', "%%").replace('$', "$$")
}

/// Quote one word for a POSIX shell (single quotes).
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn unit_text(repo: &str, name: &str, tmux: &str, claude: &str) -> Result<String> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') || name.is_empty() {
        bail!("--name must be [A-Za-z0-9_-]");
    }
    if repo.contains(['"', '\n', '\\']) || tmux.contains(['"', '\n', '\\']) || claude.contains(['"', '\n', '\\', '\'']) {
        bail!("path has unsupported characters");
    }
    // tmux runs this string through `sh -c`: the claude path must be quoted there. The shell
    // string is then wrapped in "..." for systemd, so escape that layer too.
    let shell = format!("env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 {} {CHANNELS_CMD}", sh_quote(claude));
    let shell = sd_escape(&shell);
    let (repo_e, tmux_e) = (sd_escape(repo), sd_escape(tmux));
    let repo_wd = sd_escape_pct(repo);
    Ok(format!(
        "[Unit]\nDescription=8sync HQ lead session ({name}): Claude Code Channels in tmux\nAfter=network-online.target\nWants=network-online.target\n\n\
         [Service]\nType=oneshot\nRemainAfterExit=yes\nWorkingDirectory={repo_wd}\n\
         ExecStart=-\"{tmux_e}\" new-session -d -s {name} -c \"{repo_e}\" \"{shell}\"\n\
         ExecStop=-\"{tmux_e}\" kill-session -t {name}\n\n[Install]\nWantedBy=default.target\n"
    ))
}

fn standup_service_text(exe: &str) -> String {
    format!("[Unit]\nDescription=8sync HQ daily standup\n\n[Service]\nType=oneshot\nExecStart=\"{}\" hq standup\n", sd_escape(exe))
}

const TIMER_TEXT: &str = "[Unit]\nDescription=8sync HQ standup at 09:00 local\n\n[Timer]\nOnCalendar=*-*-* 09:00:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n";

fn cmd_up(repo: Option<PathBuf>, name: &str, install: bool, now_: bool) -> Result<()> {
    let repo = match repo {
        Some(r) => std::fs::canonicalize(r)?,
        None => {
            let cwd = std::env::current_dir()?;
            crate::verbs::here::detect_project_root(&cwd).unwrap_or(cwd)
        }
    };
    let which_or = |bin: &str, fb: &str| which::which(bin).map(|p| p.display().to_string()).unwrap_or_else(|_| fb.to_string());
    let tmux = which_or("tmux", "/usr/bin/tmux");
    let claude = which_or("claude", "claude");
    let exe = std::env::current_exe()?.display().to_string();
    let unit = unit_text(&repo.display().to_string(), name, &tmux, &claude)?;
    let svc = standup_service_text(&exe);
    ui::header("8sync hq up");
    println!("# ~/.config/systemd/user/8sync-hq.service\n{unit}\n# ~/.config/systemd/user/8sync-hq-standup.service\n{svc}\n# ~/.config/systemd/user/8sync-hq-standup.timer\n{TIMER_TEXT}");
    ui::info("Channels needs an open session, so the lead runs inside tmux; attach with `tmux attach -t <name>`.");
    ui::info("Install the plugin once inside Claude Code: /plugin install discord@claude-plugins-official (HQ never touches Claude credentials).");
    ui::info("Team/Enterprise plans: the org Owner must set `channelsEnabled`.");
    ui::info("Keep the session alive after logout: `loginctl enable-linger $USER` (not run by HQ).");
    if !install {
        ui::info("print-only. Use --install to write the files (--install --now to also start).");
        return Ok(());
    }
    if !cfg!(target_os = "linux") {
        bail!("--install is systemd (Linux) only");
    }
    let dir = dirs::home_dir().ok_or_else(|| anyhow!("no home"))?.join(".config/systemd/user");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("8sync-hq.service"), unit)?;
    std::fs::write(dir.join("8sync-hq-standup.service"), svc)?;
    std::fs::write(dir.join("8sync-hq-standup.timer"), TIMER_TEXT)?;
    let sysctl = |args: &[&str]| -> Result<()> {
        let st = Command::new("systemctl").arg("--user").args(args).status().context("systemctl not found")?;
        if !st.success() {
            bail!("systemctl --user {} failed", args.join(" "));
        }
        Ok(())
    };
    sysctl(&["daemon-reload"])?;
    let mut en = vec!["enable"];
    if now_ {
        en.push("--now");
    }
    en.extend(["8sync-hq.service", "8sync-hq-standup.timer"]);
    sysctl(&en)?;
    ui::ok(if now_ { "installed, enabled and started" } else { "installed and enabled (not started)" });
    Ok(())
}

// ── entry ───────────────────────────────────────────────────────────────────

pub fn run(a: Args) -> Result<()> {
    let dry = a.dry_run;
    match a.cmd {
        Sub::Hook { event } => {
            cmd_hook(&event, dry);
            Ok(())
        }
        Sub::Setup { guild, token_stdin, owner } => cmd_setup(&guild, token_stdin, owner, dry),
        Sub::Post { persona, to, title, stdin, text } => {
            let p = persona_arg(&persona)?;
            let t = read_text(stdin, &text)?;
            let thread = forum_thread_name(&to, title.as_deref())?;
            let env = Env::load(dry, false)?;
            match thread {
                Some(n) => env.post_forum(p, &to, &n, &t)?,
                None => {
                    env.post(p, &to, title.as_deref(), &t, false)?;
                }
            }
            ui::ok(&format!("posted as {} to #{to}", p.username()));
            Ok(())
        }
        Sub::Task(c) => {
            let env = Env::load(dry, false)?;
            match c {
                TaskCmd::New { title, id, role, prio, body } => {
                    let role = role.as_deref().map(persona_arg).transpose()?;
                    if let Some(p) = prio.as_deref() {
                        if !PRIOS.contains(&p) {
                            bail!("prio must be p0|p1|p2");
                        }
                    }
                    let id = id.unwrap_or_else(|| format!("t{}", now()));
                    let rk = role.filter(|r| r.tag().is_some()).map(|r| r.key());
                    if env.claim(&id, &title, rk, prio.as_deref(), false)? != Claim::Created {
                        bail!("task '{id}' already exists");
                    }
                    env.task_new(&id, &title, body.as_deref().unwrap_or(""), role, prio.as_deref(), "todo")?;
                    ui::ok(&format!("task {id} created"));
                }
                TaskCmd::Status { id, status } => {
                    env.task_status(&id, &status, &format!("Status: {status}"))?;
                    ui::ok(&format!("task {id} -> {status}"));
                }
                TaskCmd::Comment { id, persona, text } => {
                    env.task_comment(&id, persona_arg(&persona)?, &read_text(false, &text)?)?;
                    ui::ok("comment posted");
                }
            }
            Ok(())
        }
        Sub::Standup => cmd_standup(dry),
        Sub::Ui { off: true, .. } => cmd_ui_off(),
        Sub::Ui { port, app, no_open, off: false, update } => cmd_ui(port, app, no_open, update, dry),
        Sub::Purge { yes } => cmd_purge(yes),
        Sub::Status => cmd_status(),
        Sub::Up { repo, name, install, now } => cmd_up(repo, &name, install, now),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        // unique per call: tests run in parallel and may share a tag within one second
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("hq-test-{tag}-{}-{}-{n}", std::process::id(), now()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn journal_maps_subagent_start_and_stop() {
        let e = |ev: &str, v: Value| journal_entry(ev, &v, None, 7, None);
        let s = e("SubagentStart", json!({"session_id":"s1","cwd":"/r","agent_id":"a3f9c2","agent_type":"reviewer"})).unwrap();
        assert_eq!((s["kind"].as_str(), s["task_id"].as_str(), s["subject"].as_str(), s["session_id"].as_str()), (Some("subagent_start"), Some("a3f9c2"), Some("reviewer"), Some("s1")));
        assert_eq!(e("SubagentStop", json!({"session_id":"s1","agent_id":"a3f9c2","agent_type":"reviewer","last_assistant_message":"secret body"})).unwrap()["kind"], "subagent_stop");
        assert!(e("SubagentStop", json!({"session_id":"s1","agent_id":"../x"})).is_none(), "unsafe agent id dropped");
        let stop = e("SubagentStop", json!({"session_id":"s1","agent_id":"a1","agent_type":"task","last_assistant_message":"secret body"})).unwrap();
        assert!(stop["text"].is_null(), "the subagent's output is never journaled");
    }

    #[test]
    fn inbox_delivers_once_masked_and_never_for_unsafe_ids() {
        let home = tmp("inbox");
        let sid = "1eb79553-8369-4a90-b428-2dedb50e18db";
        assert!(take_inbox(&home, sid).is_none(), "no file: nothing to deliver");
        let f = inbox_file(&home, sid).unwrap();
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        // A synthetic key-shaped fixture, built at run time so no scanner sees a literal key.
        let key = format!("sk-ant-api03-{}", "Zq8vR2xLk9pW4mN7tB1cY6hJ3sD5fG0aQe".repeat(2));
        std::fs::write(&f, format!("{}\n{}\n\n{{bad json\n", json!({"ts":1,"text":"chạy test giúp"}), json!({"ts":2,"text":format!("key là {key}")}))).unwrap();
        let msg = take_inbox(&home, sid).unwrap();
        assert!(msg.contains("2 message(s)") && msg.contains("chạy test giúp"), "{msg}");
        assert!(!msg.contains("Zq8vR2xLk9pW4mN7tB1cY6hJ3sD5fG0aQe"), "secret masked: {msg}");
        assert!(take_inbox(&home, sid).is_none(), "delivered once");
        assert!(!f.exists());
        assert!(inbox_file(&home, "../../etc/passwd").is_none() && take_inbox(&home, "a/b").is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    /// The HQ UI's producer line (`queueInbox`: `{"ts","text"}`) reaches an idle session through a
    /// claim; ack drops it, release hands it back, the Stop hook never repeats a claimed message,
    /// and a claim whose taker died is served again after CLAIM_STALE.
    #[test]
    fn inbox_claim_ack_release_and_stale_claims() {
        let home = tmp("inbox-claim");
        let sid = "2fc89664-9479-4b01-b539-3eefc61f29ec";
        let t0 = SystemTime::now();
        let line = |ts: u64, t: &str| format!("{}\n", json!({"ts":ts,"text":t}));
        assert!(claim_inbox(&home, sid, t0).is_none(), "nothing pending");
        let f = inbox_file(&home, sid).unwrap();
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, line(1, "New task: sửa nút Giao (prio: P1)")).unwrap();
        let msg = claim_inbox(&home, sid, t0).unwrap();
        assert!(msg.starts_with("8 Sync HQ: the owner sent you 1 message(s) from the HQ dashboard. Read"), "idle framing: {msg}");
        assert!(msg.ends_with("New task: sửa nút Giao (prio: P1)"), "{msg}");
        assert!(claim_inbox(&home, sid, t0).is_none(), "in flight: not served twice");
        assert!(take_inbox(&home, sid).is_none(), "the Stop hook leaves a claimed message alone");
        // Not entered: released back; a message queued meanwhile stays too.
        std::fs::write(&f, line(2, "thêm một việc")).unwrap();
        assert!(release_inbox(&home, sid));
        let msg = take_inbox(&home, sid).unwrap();
        assert!(msg.contains("2 message(s)") && msg.contains("while you were working") && msg.contains("sửa nút Giao") && msg.contains("thêm một việc"), "{msg}");
        // Entered: ack drops it for good.
        std::fs::write(&f, line(3, "việc ba")).unwrap();
        assert!(claim_inbox(&home, sid, t0).is_some());
        assert!(ack_inbox(&home, sid));
        assert!(claim_inbox(&home, sid, t0).is_none() && take_inbox(&home, sid).is_none(), "delivered once");
        assert!(!ack_inbox(&home, sid) && !release_inbox(&home, sid), "no claim: nothing to ack or release");
        // The taker died after claiming: a later poll serves it again, with newer messages folded in.
        std::fs::write(&f, line(4, "việc bốn")).unwrap();
        assert!(claim_inbox(&home, sid, t0).is_some());
        std::fs::write(&f, line(5, "việc năm")).unwrap();
        assert!(claim_inbox(&home, sid, t0 + Duration::from_secs(30)).is_none(), "fresh claim");
        let msg = claim_inbox(&home, sid, t0 + CLAIM_STALE + Duration::from_secs(5)).unwrap();
        assert!(msg.contains("2 message(s)") && msg.contains("việc bốn") && msg.contains("việc năm"), "{msg}");
        assert!(ack_inbox(&home, sid));
        // A task queued long ago (the session was busy) is claimed fresh: not re-served at once.
        std::fs::write(&f, line(6, "việc cũ")).unwrap();
        let file = std::fs::OpenOptions::new().append(true).open(&f).unwrap();
        file.set_modified(t0 - Duration::from_secs(3600)).unwrap();
        drop(file);
        assert!(claim_inbox(&home, sid, t0).is_some());
        assert!(claim_inbox(&home, sid, t0 + Duration::from_secs(5)).is_none(), "claim age is the claim's");
        assert!(release_inbox(&home, sid));
        // A taker that died mid-take left `<id>.taking.<pid>`: swept back once it is stale.
        let orphan = f.with_extension("taking.999999");
        std::fs::write(&orphan, r#"{"ts":7,"text":"việc mồ côi"}"#).unwrap(); // torn: no newline
        let file = std::fs::OpenOptions::new().append(true).open(&orphan).unwrap();
        file.set_modified(t0 - Duration::from_secs(3600)).unwrap();
        drop(file);
        let msg = claim_inbox(&home, sid, t0 + CLAIM_STALE * 2).unwrap();
        assert!(msg.contains("2 message(s)") && msg.contains("việc cũ") && msg.contains("việc mồ côi"), "{msg}");
        assert!(!orphan.exists());
        assert!(ack_inbox(&home, sid));
        assert!(claim_inbox(&home, "not-an-id/../x", t0).is_none());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn inbox_cmd_parses_flags_and_falls_back_to_the_env_session() {
        let home = tmp("inbox-cmd");
        let sid = "3ad90775-0000-4b01-b539-3eefc61f29ec";
        let f = inbox_file(&home, sid).unwrap();
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        let now = SystemTime::now();
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(inbox_cmd(&home, &a(&["--json"]), None, now), json!({ "text": null }), "no id");
        assert_eq!(inbox_cmd(&home, &a(&["--session", "--json"]), None, now), json!({ "text": null }), "--session without a value");
        std::fs::write(&f, format!("{}\n", json!({"ts":1,"text":"x"}))).unwrap();
        let v = inbox_cmd(&home, &a(&["--json"]), Some(sid), now);
        assert!(v["text"].as_str().unwrap().ends_with("\nx"), "env fallback: {v}");
        assert_eq!(inbox_cmd(&home, &a(&["--session", sid, "--release", "--json"]), None, now), json!({ "ok": true }));
        assert!(inbox_cmd(&home, &a(&["--session", sid, "--json"]), None, now)["text"].is_string());
        assert_eq!(inbox_cmd(&home, &a(&["--session", sid, "--ack"]), None, now), json!({ "ok": true }));
        assert_eq!(inbox_cmd(&home, &a(&["--session", sid, "--ack"]), None, now), json!({ "ok": false }));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn journal_maps_each_event() {
        let ts = 7;
        let e = |ev: &str, v: Value, env: Option<&str>| journal_entry(ev, &v, env, ts, None);
        let c = e("TaskCreated", json!({"session_id":"s1","team_name":"t","cwd":"/r","task_id":"3","task_subject":"[be] x","teammate_name":"backend"}), None).unwrap();
        assert_eq!((c["kind"].as_str(), c["task_id"].as_str(), c["subject"].as_str(), c["team"].as_str(), c["role"].as_str(), c["v"].as_u64()), (Some("task_created"), Some("t:3"), Some("[be] x"), Some("t"), Some("backend"), Some(1)));
        assert_eq!(e("TaskCompleted", json!({"task_id":"3"}), None).unwrap()["kind"], "task_completed");
        assert!(e("TaskCreated", json!({}), None).is_none(), "no task id");
        assert_eq!(e("TeammateIdle", json!({"teammate_name":"qa"}), None).unwrap()["kind"], "teammate_idle");
        let n = e("Notification", json!({"notification_type":"agent_needs_input","message":"hi"}), Some("hq-a")).unwrap();
        assert_eq!((n["kind"].as_str(), n["text"].as_str()), (Some("notification"), Some("agent_needs_input: hi")));
        assert_eq!(e("SessionStart", json!({"session_id":"s"}), None).unwrap()["kind"], "session_start");
        assert_eq!(e("SessionEnd", json!({"session_id":"s"}), None).unwrap()["kind"], "session_end");
        let m = json!({"session_id":"s9","tool_name":"SendMessage","tool_input":{"to":"hq-b","message":"yo"}});
        let a = e("PostToolUse", m.clone(), None).unwrap();
        assert_eq!((a["kind"].as_str(), a["from"].as_str(), a["to"].as_str(), a["text"].as_str()), (Some("session_message"), Some("s9"), Some("hq-b"), Some("yo")));
        assert_eq!(e("PostToolUse", m, Some("hq-a")).unwrap()["from"], "hq-a");
        // A uuid session id is the sender's identity, not a secret: it must survive the masker.
        let uuid = "a2830544-0719-4d6f-aaa3-644783ddb0b3";
        let u = e("PostToolUse", json!({"session_id":uuid,"tool_name":"SendMessage","tool_input":{"to":"rd","message":"hi"}}), None).unwrap();
        assert_eq!((u["from"].as_str(), u["to"].as_str()), (Some(uuid), Some("rd")));
        assert!(e("PostToolUse", json!({"tool_name":"Bash"}), None).is_none());
        // Another session's address resolves to its id + name from Claude Code's session records.
        let d = std::env::temp_dir().join(format!("8sync-peer-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("6063.json"), r#"{"pid":6063,"sessionId":"6de1efc8-68cb-45aa-9999-000000000001","name":"rd","messagingSocketPath":"/run/user/1000/cc-socks/6063.sock"}"#).unwrap();
        std::fs::write(d.join("6063.abc.key"), "not json, never read").unwrap();
        std::fs::write(d.join("7000.json"), r#"{"sessionId":"s-7000","name":"twin"}"#).unwrap();
        std::fs::write(d.join("7001.json"), r#"{"sessionId":"s-7001","name":"twin"}"#).unwrap();
        let rd = Some(("6de1efc8-68cb-45aa-9999-000000000001".to_string(), "rd".to_string()));
        assert_eq!(resolve_peer(&d, "uds:/run/user/1000/cc-socks/6063.sock"), rd);
        assert_eq!(resolve_peer(&d, "rd"), rd);
        assert_eq!(resolve_peer(&d, "twin"), None, "ambiguous name");
        assert_eq!(resolve_peer(&d, "uds:/nope.sock"), None);
        std::fs::write(d.join("5405.json"), r#"{"sessionId":"s9","name":"core"}"#).unwrap();
        let j = journal_entry("PostToolUse", &json!({"session_id":"s9","tool_name":"SendMessage","tool_input":{"to":"uds:/run/user/1000/cc-socks/6063.sock","message":"giúp?"}}), None, 1, Some(&d)).unwrap();
        assert_eq!((j["to"].as_str(), j["to_name"].as_str()), (Some("6de1efc8-68cb-45aa-9999-000000000001"), Some("rd")), "peer id survives the masker");
        assert_eq!(j["from_name"], "core");
        assert_eq!(j["text"], "giúp?");
        let long = json!({"session_id":"s9","tool_name":"SendMessage","tool_input":{"to":"uds:/run/user/1000/cc-socks/6063.sock","message":"x".repeat(500)}});
        assert_eq!(journal_entry("PostToolUse", &long, None, 1, Some(&d)).unwrap()["text"].as_str().unwrap().chars().count(), 80, "body cut to 80");
        let sum = json!({"session_id":"s9","tool_name":"SendMessage","tool_input":{"to":"rd","summary":"T6 xong","message":"client data …"}});
        assert_eq!(journal_entry("PostToolUse", &sum, None, 1, Some(&d)).unwrap()["text"], "T6 xong", "summary preferred");
        let unknown = json!({"session_id":"s9","tool_name":"SendMessage","tool_input":{"to":"uds:/gone.sock","message":"y".repeat(200)}});
        assert_eq!(journal_entry("PostToolUse", &unknown, None, 1, Some(&d)).unwrap()["text"].as_str().unwrap().len(), 80, "unresolved uds address: still cut");
        let _ = std::fs::remove_dir_all(&d);
        let long = e("Notification", json!({"message":"é".repeat(5000)}), Some("hq-a")).unwrap();
        assert_eq!(long["text"].as_str().unwrap().chars().count(), 4000);
        let r = e("Stop", json!({"session_id":"s","last_assistant_message":"hi\nkey sk-ant-api03-abcdefgh\nbye"}), Some("hq-a")).unwrap();
        assert_eq!((r["kind"].as_str(), r["text"].as_str(), r["hq_session"].as_str()), (Some("session_reply"), Some("hi\nkey ***\nbye"), Some("hq-a")));
        assert!(e("Stop", json!({"session_id":"s"}), None).is_none(), "no message");
        assert!(e("SessionStart", json!({}), Some("hq-a")).unwrap()["hq_session"] == "hq-a");
        for bad in ["hq-", "hq--a", "HQ-a", "hq-A", "x", &format!("hq-{}", "a".repeat(33))] {
            assert!(e("SessionStart", json!({}), Some(bad)).unwrap()["hq_session"].is_null(), "{bad}");
        }
        assert!(e("SessionStart", json!({}), Some(&format!("hq-{}", "a".repeat(32)))).unwrap()["hq_session"].is_string());
    }

    #[test]
    fn journal_masks_every_text_field_and_gates_bodies_on_hq_session() {
        let e = |ev: &str, v: Value, env: Option<&str>| journal_entry(ev, &v, env, 1, None);
        // non-hq sessions: no Stop / Notification body at all
        assert!(e("Stop", json!({"last_assistant_message":"hello"}), None).is_none());
        assert!(e("Stop", json!({"last_assistant_message":"hello"}), Some("not-hq")).is_none());
        assert!(e("Notification", json!({"notification_type":"x","message":"hello"}), None).is_none());
        // hq sessions: stored, masked (secret on its own line after "Here:")
        let r = e("Stop", json!({"last_assistant_message":"Here:\nsk-ant-api03-abcdefghijkl\npassword: hunter2"}), Some("hq-a")).unwrap();
        assert_eq!(r["text"], "Here:\n***\npassword: ***");
        let n = e("Notification", json!({"notification_type":"t","message":"token: abc123def456"}), Some("hq-a")).unwrap();
        assert_eq!(n["text"], "t: token: ***");
        // SendMessage body and task subjects are masked for everyone
        let m = e("PostToolUse", json!({"session_id":"s","tool_name":"SendMessage","tool_input":{"to":"hq-b","message":"{\"api_key\":\"hunter2abc\"}"}}), None).unwrap();
        assert_eq!(m["text"], "{\"api_key\":\"***\"}");
        let t = e("TaskCreated", json!({"task_id":"1","task_subject":"deploy with ghp_abcdefghijklmnop"}), None).unwrap();
        assert_eq!(t["subject"], "deploy with ***");
        // metadata events survive without a body
        assert!(e("SessionEnd", json!({"session_id":"s"}), None).is_some());
    }

    #[test]
    fn purge_targets_only_hq_data_files() {
        let d = tmp("purge");
        std::fs::create_dir_all(&d).unwrap();
        for f in ["events.jsonl", "events.1.jsonl", "hq.db", "hq.db-wal", "hq.db-shm", "channel-hq-a.json", "tasks.json", "hq.log", "notes.txt"] {
            std::fs::write(d.join(f), "x").unwrap();
        }
        let got: Vec<String> = purge_targets(&d).iter().map(|p| p.file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(got, ["channel-hq-a.json", "events.1.jsonl", "events.jsonl", "hq.db", "hq.db-shm", "hq.db-wal"]);
        assert!(purge_targets(&d.join("missing")).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn journal_appends_private_and_rotates() {
        let d = tmp("journal");
        let p = d.join("hq/events.jsonl");
        append_journal(&p, "{\"a\":1}", 30).unwrap();
        append_journal(&p, "{\"a\":2}", 30).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap().lines().count(), 2);
        append_journal(&p, "{\"a\":3}", 10).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{\"a\":3}\n");
        assert_eq!(std::fs::read_to_string(d.join("hq/events.1.jsonl")).unwrap().lines().count(), 2);
        #[cfg(unix)]
        assert_eq!((mode_of(&p), mode_of(p.parent().unwrap())), (Some(0o600), Some(0o700)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hook_is_a_noop_unless_local_or_enabled() {
        // cmd_hook gates on exactly this predicate before any read or write
        let off = Config::default();
        assert!(!off.enabled && !off.local, "default config writes nothing");
        let on: Config = toml::from_str("local = true").unwrap();
        assert!(on.local && !on.enabled);
    }

    #[test]
    fn ui_app_dir_resolution_and_config() {
        let d = tmp("ui");
        let (flag, env, inst, dev) = (d.join("flag"), d.join("env"), d.join("inst"), d.join("tools/su-code/apps/hq-ui"));
        for x in [&flag, &env, &inst.join("hq-ui"), &inst.join("hq-channel")] {
            std::fs::create_dir_all(x).unwrap();
        }
        std::fs::create_dir_all(&dev).unwrap();
        // flag > env
        assert_eq!(resolve_app(Some(flag.clone()), Some(env.clone()), &inst, &d).unwrap(), Some(AppSrc::Dev(flag.clone())));
        assert_eq!(resolve_app(None, Some(env.clone()), &inst, &d).unwrap(), Some(AppSrc::Dev(env)));
        assert!(resolve_app(Some(d.join("nope")), None, &inst, &d).is_err());
        // half-extracted install does not count; an unbuilt checkout does not count
        assert_eq!(resolve_app(None, None, &inst, &d).unwrap(), None);
        std::fs::write(inst.join("hq-ui/server.js"), "").unwrap();
        std::fs::write(inst.join("hq-channel/server.mjs"), "").unwrap();
        // installed > repo checkout (even a built one)
        std::fs::create_dir_all(dev.join(".next")).unwrap();
        assert_eq!(resolve_app(None, None, &inst, &d).unwrap(), Some(AppSrc::Installed(inst.clone())));
        assert_eq!(resolve_app(None, None, &d.join("none"), &d).unwrap(), Some(AppSrc::Dev(dev)));
        assert_eq!(resolve_app(None, None, &d.join("none"), &d.join("empty")).unwrap(), None);
        assert!(node_ok("v22.5.0") && node_ok("v24.1.2\n") && !node_ok("v22.4.9") && !node_ok("v20.0.0"));
        let p = Paths::under(&d);
        let mut c = load_config(&p).unwrap_or_default();
        c.local = true;
        save_config(&p, &c).unwrap();
        assert!(load_config(&p).unwrap().local);
        #[cfg(unix)]
        assert_eq!(mode_of(&p.config()), Some(0o600));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hq_ui_asset_naming_and_sha_verify() {
        assert_eq!(hq_ui_asset("0.67.1"), "8sync-hq-ui-v0.67.1.tar.gz");
        assert_eq!(hq_ui_url("0.67.1", ".sha256"), "https://github.com/8-Sync-Dev/su-code/releases/download/v0.67.1/8sync-hq-ui-v0.67.1.tar.gz.sha256");
        let hex = "ab".repeat(32);
        assert_eq!(parse_sha256_file(&format!("{}  8sync-hq-ui-v1.tar.gz\n", hex.to_uppercase())), Some(hex.clone()));
        assert_eq!(parse_sha256_file("deadbeef  x"), None);
        assert_eq!(parse_sha256_file(""), None);
        let d = tmp("sha");
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("a.tgz");
        std::fs::write(&f, b"hello\n").unwrap();
        // sha256("hello\n")
        let good = "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03";
        if super::super::selfup::sha256_file(&f).is_none() {
            return; // no hasher on this box: verify_tarball refuses by design
        }
        verify_tarball(&f, &format!("{good}  a.tgz\n")).unwrap();
        let e = verify_tarball(&f, &format!("{}  a.tgz\n", "0".repeat(64))).unwrap_err().to_string();
        assert!(e.contains("checksum mismatch") && e.contains("refusing"), "{e}");
        assert!(verify_tarball(&f, "not a hash").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn ui_argv_per_source() {
        let inst = AppSrc::Installed(PathBuf::from("/d/0.1.0"));
        let want = PathBuf::from("/d/0.1.0").join("hq-ui/server.js").display().to_string();
        assert_eq!(ui_argv(&inst, true), ("node", vec![want]));
        let dev = AppSrc::Dev(PathBuf::from("/r/apps/hq-ui"));
        // never standalone/server.js for a checkout: its static assets are not next to it
        assert_eq!(ui_argv(&dev, true), ("pnpm", vec!["--dir".into(), "/r/apps/hq-ui".into(), "start".into()]));
        assert_eq!(ui_argv(&dev, false), ("npm", vec!["--prefix".into(), "/r/apps/hq-ui".into(), "start".into()]));
    }

    #[test]
    fn download_status_hints() {
        assert_eq!(failed_status("curl: (22) The requested URL returned error: 404\n"), Some(404));
        assert_eq!(failed_status("curl: (22) The requested URL returned error: 503 Service Unavailable"), Some(503));
        assert_eq!(failed_status("curl: (6) Could not resolve host: github.com"), None);
        assert!(download_status(200, "u", "1.2.3").is_ok());
        let e = download_status(404, "https://x/y", "1.2.3").unwrap_err().to_string();
        assert!(e.contains("HTTP 404") && e.contains("release or asset for v1.2.3 may not exist yet"), "{e}");
        assert!(download_status(500, "u", "1").unwrap_err().to_string().contains("HTTP 500"));
        assert!(check_api_digest("aa", Some("aa")).is_ok() && check_api_digest("aa", None).is_ok());
        assert!(check_api_digest("aa", Some("bb")).unwrap_err().to_string().contains("API asset digest"));
    }

    #[test]
    fn entry_names_refuse_absolute_and_dotdot() {
        assert!(check_entry_names("hq-ui/server.js\nhq-ui/.next/a..b\nVERSION\n").is_ok());
        assert!(check_entry_names("/etc/passwd\n").is_err());
        assert!(check_entry_names("hq-ui/../../x\n").is_err());
    }

    /// Tarball whose tree is built by `f` in a scratch dir; None when `tar` is missing.
    fn mk_tar(d: &Path, name: &str, f: impl Fn(&Path)) -> Option<PathBuf> {
        Command::new("tar").arg("--version").output().ok()?;
        let src = d.join(format!("src-{name}"));
        std::fs::create_dir_all(src.join("hq-ui")).unwrap();
        std::fs::create_dir_all(src.join("hq-channel")).unwrap();
        f(&src);
        let out = d.join(format!("{name}.tgz"));
        assert!(Command::new("tar").arg("-czf").arg(&out).arg("-C").arg(&src).arg(".").status().unwrap().success());
        Some(out)
    }

    fn good(src: &Path) {
        std::fs::write(src.join("hq-ui/server.js"), "// ok").unwrap();
        std::fs::write(src.join("hq-channel/server.mjs"), "// ok").unwrap();
        std::fs::write(src.join("VERSION"), "1.0.0").unwrap();
    }

    fn leftovers(base: &Path) -> Vec<String> {
        std::fs::read_dir(base).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with(".tmp-") || n.starts_with(".old-") || n == ".install.lock").collect()
    }

    #[test]
    fn extract_install_good_and_rejections() {
        let d = tmp("ext");
        std::fs::create_dir_all(&d).unwrap();
        let base = d.join("hq-ui");
        let target = base.join("1.0.0");
        let Some(ok) = mk_tar(&d, "ok", good) else { return };
        extract_install(&ok, &target).unwrap();
        assert!(hq_ui_installed(&target));
        assert!(leftovers(&base).is_empty(), "tmp + lock cleaned: {:?}", leftovers(&base));

        // missing server.js -> rejected, existing install survives
        let bad = mk_tar(&d, "noserver", |s| {
            good(s);
            std::fs::remove_file(s.join("hq-ui/server.js")).unwrap();
        })
        .unwrap();
        let e = extract_install(&bad, &target).unwrap_err().to_string();
        assert!(e.contains("missing hq-ui/server.js"), "{e}");
        assert!(hq_ui_installed(&target) && leftovers(&base).is_empty());

        // escaping symlink -> rejected, existing install survives, tmp gone
        #[cfg(unix)]
        {
            let esc = mk_tar(&d, "esc", |s| {
                good(s);
                std::os::unix::fs::symlink("../../../../etc", s.join("hq-ui/evil")).unwrap();
            })
            .unwrap();
            let e = extract_install(&esc, &target).unwrap_err().to_string();
            assert!(e.contains("link entry"), "refused before extraction: {e}");
            assert!(hq_ui_installed(&target) && leftovers(&base).is_empty());
            // policy: the release asset ships no links at all, so an in-tree link is refused too
            let inner = mk_tar(&d, "inner", |s| {
                good(s);
                std::os::unix::fs::symlink("server.js", s.join("hq-ui/alias.js")).unwrap();
            })
            .unwrap();
            assert!(extract_install(&inner, &target).unwrap_err().to_string().contains("link entry"));
            assert!(hq_ui_installed(&target) && !target.join("hq-ui/alias.js").exists());
        }

        // fresh lock blocks, stale lock is taken over
        std::fs::write(base.join(".install.lock"), "1").unwrap();
        assert!(extract_install(&ok, &target).unwrap_err().to_string().contains("another 8sync"));
        let old = std::time::SystemTime::now() - Duration::from_secs(700);
        std::fs::File::options().write(true).open(base.join(".install.lock")).unwrap().set_modified(old).unwrap();
        extract_install(&ok, &target).unwrap();
        assert!(leftovers(&base).is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    // Unix only: the test back-dates directory mtimes through File::open(dir), which
    // Windows refuses ("Access is denied"). The pruning code itself only reads mtimes.
    #[cfg(unix)]
    #[test]
    fn install_prunes_old_versions_and_stale_leftovers() {
        let d = tmp("prune");
        let base = d.join("hq-ui");
        let Some(ok) = mk_tar(&d.clone(), "ok", good) else { return };
        for (v, age) in [("0.1.0", 5000u64), ("0.2.0", 3000), ("0.3.0", 1000)] {
            std::fs::create_dir_all(base.join(v)).unwrap();
            std::fs::File::open(base.join(v)).unwrap().set_modified(std::time::SystemTime::now() - Duration::from_secs(age)).unwrap();
        }
        let stale = base.join(".tmp-999");
        let fresh = base.join(".old-x-1");
        for p in [&stale, &fresh] {
            std::fs::create_dir_all(p).unwrap();
        }
        std::fs::File::open(&stale).unwrap().set_modified(std::time::SystemTime::now() - Duration::from_secs(7200)).unwrap();
        extract_install(&ok, &base.join("0.4.0")).unwrap();
        assert!(base.join("0.4.0").is_dir() && base.join("0.3.0").is_dir(), "current + previous kept");
        assert!(!base.join("0.2.0").exists() && !base.join("0.1.0").exists(), "older pruned");
        assert!(!stale.exists() && fresh.exists(), "only >1h leftovers removed");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn channel_mcp_config_shape_perms_and_flags() {
        let d = tmp("mcp");
        let p = Paths::under(&d);
        let server = d.join("share/inst/hq-channel/server.mjs");
        let f = write_channel_mcp(&p, &server, "/usr/bin/node").unwrap();
        assert_eq!(f, p.cfg_dir.join("channel-mcp.json"));
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        let s = &v["mcpServers"]["8sync-hq"];
        assert_eq!(s["command"], "/usr/bin/node");
        assert_eq!(s["args"][0], server.display().to_string());
        assert_eq!(s["env"]["MCP_PROTOCOL_NEGOTIATION"], "legacy");
        #[cfg(unix)]
        {
            assert_eq!(mode_of(&f), Some(0o600));
            assert_eq!(mode_of(&p.cfg_dir), Some(0o700));
        }
        // Backslash paths (Windows) fail the allow-list on purpose: the UI then uses its own
        // default lookup of channel-mcp.json, so only unix gets explicit flags.
        #[cfg(unix)]
        assert_eq!(channel_flags(&f).unwrap(), format!("--mcp-config {} --dangerously-load-development-channels server:8sync-hq", f.display()));
        #[cfg(windows)]
        assert_eq!(channel_flags(&f), None);
        assert_eq!(channel_flags(Path::new("/home/a b/x.json")), None);
        let _ = std::fs::remove_dir_all(&d);
    }


    fn cfg_with_tags() -> Config {
        let mut c = Config::default();
        let m = c.tags.entry(BOARD.into()).or_default();
        for t in BOARD_TAGS {
            m.insert((*t).into(), format!("id-{t}"));
        }
        c
    }

    #[cfg(unix)]
    #[test]
    fn secrets_and_config_are_private() {
        let home = tmp("perm");
        let p = Paths::under(&home);
        let s = Secrets { bot_token: Some("tok-123456789012".into()), webhooks: BTreeMap::new() };
        save_secrets(&p, &s).unwrap();
        save_config(&p, &Config::default()).unwrap();
        assert_eq!(mode_of(&p.secrets()), Some(0o600));
        assert_eq!(mode_of(&p.config()), Some(0o600));
        assert_eq!(mode_of(&p.cfg_dir), Some(0o700));
        // re-save over a loosened file restores 0600
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(p.secrets(), std::fs::Permissions::from_mode(0o644)).unwrap();
        save_secrets(&p, &s).unwrap();
        assert_eq!(mode_of(&p.secrets()), Some(0o600));
        assert_eq!(load_secrets(&p).bot_token.as_deref(), Some("tok-123456789012"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn masking_hides_secrets() {
        assert_eq!(mask("short"), "****");
        assert_eq!(mask("abcdefghijklmnop"), "****mnop");
        let u = "https://discord.com/api/v10/webhooks/123/SECRETTOKEN?wait=true&thread_id=9";
        let m = mask_webhook_url(u);
        assert!(!m.contains("SECRETTOKEN"));
        assert!(m.contains("/webhooks/123/****?wait=true&thread_id=9"));
        let s = scrub("curl failed for https://x/webhooks/1/SECRETTOKEN and SECRETTOKEN", &["https://x/webhooks/1/SECRETTOKEN".into()]);
        assert!(!s.contains("SECRETTOKEN"));
    }

    #[test]
    fn truncation_is_char_safe() {
        let s = "ế".repeat(2500);
        let t = truncate_chars(&s, CONTENT_MAX);
        assert_eq!(t.chars().count(), 2000);
        assert!(t.ends_with('…'));
        assert_eq!(truncate_chars("ngắn", 10), "ngắn");
        let emoji = "😀".repeat(5000);
        assert_eq!(truncate_chars(&emoji, EMBED_DESC_MAX).chars().count(), 4096);
    }

    #[test]
    fn webhook_body_shapes() {
        let m = |text: &'static str, title| Msg { persona: Persona::Qa, avatar: Some("https://a/x.png"), title, text, mention_user: None, thread_name: None, tags: &[] };
        let b = webhook_body(&m("hi", None));
        assert_eq!(b["username"], "QA · 8sync");
        assert_eq!(b["content"], "hi");
        assert_eq!(b["avatar_url"], "https://a/x.png");
        assert!(b.get("embeds").is_none());
        assert_eq!(b["allowed_mentions"], json!({"parse": []}));
        let long = "é".repeat(3000);
        let b = webhook_body(&Msg { text: &long, ..m("", None) });
        assert!(b.get("content").is_none());
        assert_eq!(b["embeds"][0]["description"].as_str().unwrap().chars().count(), 3000);
        let b = webhook_body(&m("x", Some("T")));
        assert_eq!(b["embeds"][0]["title"], "T");
        let tags = vec!["a".to_string()];
        let b = webhook_body(&Msg { thread_name: Some("Thread"), tags: &tags, mention_user: Some("42"), ..m("go", None) });
        assert_eq!(b["thread_name"], "Thread");
        assert_eq!(b["applied_tags"], json!(["a"]));
        assert_eq!(b["content"], "<@42> go");
        assert_eq!(b["allowed_mentions"], json!({"parse": [], "users": ["42"]}));
    }

    #[test]
    fn tag_mapping() {
        let c = cfg_with_tags();
        assert_eq!(applied_tags(&c, "todo", Some("backend"), Some("p1")), vec!["id-todo", "id-be", "id-p1"]);
        assert_eq!(applied_tags(&c, "done", Some("hq"), None), vec!["id-done"]);
        assert_eq!(applied_tags(&c, "doing", Some("architect"), None), vec!["id-doing", "id-arch"]);
        assert!(applied_tags(&Config::default(), "todo", None, None).is_empty());
        assert_eq!(BOARD_TAGS.len(), 15);
        assert!(BOARD_TAGS.len() <= 20);
        // thread limit is 5 applied tags; we use at most 3
        assert!(applied_tags(&c, "todo", Some("qa"), Some("p0")).len() <= 5);
    }

    #[test]
    fn role_detection() {
        assert_eq!(Persona::from_text("backend-dev"), Some(Persona::Backend));
        assert_eq!(Persona::from_text("Add QA tests"), Some(Persona::Qa));
        assert_eq!(Persona::from_text("implementer"), None);
        assert_eq!(Persona::from_text("unbackended"), None);
    }

    // Fixtures copied from https://code.claude.com/docs/en/hooks
    #[test]
    fn hook_payloads_map() {
        let created: Value = serde_json::from_str(r#"{"session_id":"abc123","cwd":"/x","hook_event_name":"TaskCreated","task_id":"task-001","task_subject":"Implement user authentication","task_description":"Add login and signup endpoints","teammate_name":"implementer","team_name":"session-a1b2c3d4"}"#).unwrap();
        assert_eq!(
            map_hook("TaskCreated", &created),
            Some(Action::TaskNew { id: "session-a1b2c3d4:task-001".into(), title: "Implement user authentication".into(), body: "Add login and signup endpoints".into(), role: None })
        );
        let done: Value = serde_json::from_str(r#"{"hook_event_name":"TaskCompleted","task_id":"task-001","task_subject":"QA pass on auth","task_description":"d","teammate_name":"implementer","team_name":"t"}"#).unwrap();
        match map_hook("taskcompleted", &done) {
            Some(Action::TaskDone { id, role, by, .. }) => {
                assert_eq!(id, "t:task-001");
                assert_eq!(role, Some(Persona::Qa)); // from subject
                assert_eq!(by, "implementer");
            }
            o => panic!("{o:?}"),
        }
        let idle: Value = serde_json::from_str(r#"{"hook_event_name":"TeammateIdle","teammate_name":"researcher","team_name":"session-a1b2c3d4"}"#).unwrap();
        assert_eq!(
            map_hook("TeammateIdle", &idle),
            Some(Action::Log { persona: Persona::Researcher, text: "researcher is idle (team session-a1b2c3d4)".into() })
        );
        let n = |t: &str| serde_json::from_str::<Value>(&format!(r#"{{"hook_event_name":"Notification","message":"m","title":"T","notification_type":"{t}"}}"#)).unwrap();
        assert!(matches!(map_hook("Notification", &n("agent_needs_input")), Some(Action::Alert { mention: true, .. })));
        assert!(matches!(map_hook("Notification", &n("agent_completed")), Some(Action::Alert { mention: false, .. })));
        assert!(matches!(map_hook("Notification", &n("permission_prompt")), Some(Action::Alert { mention: false, .. })));
        assert_eq!(map_hook("Notification", &n("idle_prompt")), None);
        assert_eq!(map_hook("PreToolUse", &created), None);
        assert_eq!(map_hook("TaskCreated", &json!({})), None);
    }

    #[test]
    fn setup_plan_diff() {
        let chans = vec![
            Chan { id: "1".into(), name: "📌 HQ".into(), ty: 4, tags: vec![] },
            Chan { id: "2".into(), name: "readme".into(), ty: 0, tags: vec![] },
            // same name, wrong type -> still missing
            Chan { id: "3".into(), name: "task-board".into(), ty: 0, tags: vec![] },
            Chan { id: "4".into(), name: "Rfcs".into(), ty: 15, tags: vec![] },
        ];
        let p = plan(&["pm".into(), "AI-Agent".into()], &chans);
        let ex = |what: &str, name: &str| p.iter().find(|i| i.what == what && i.name == name).unwrap().exists;
        assert!(ex("role", "PM") && ex("role", "AI-Agent") && !ex("role", "QA"));
        assert!(ex("category", "📌 HQ") && !ex("category", "⚙ OPS"));
        assert!(ex("channel", "readme") && !ex("channel", "owner-desk"));
        assert!(!ex("channel", "task-board"));
        assert!(ex("channel", "rfcs"));
        assert_eq!(p.iter().filter(|i| i.what == "channel").count(), 14);
        let have = vec![Tag { id: "9".into(), name: "Todo".into() }];
        assert_eq!(missing_tags(&have, BOARD_TAGS).len(), 14);
    }

    #[test]
    fn setup_request_bodies() {
        let board = LAYOUT[1].chans.iter().find(|c| c.key == "task-board").unwrap();
        let r = req_create_channel("G", board, "CAT");
        let b = r.body.unwrap();
        assert_eq!(b["type"], 15);
        assert_eq!(b["parent_id"], "CAT");
        assert_eq!(b["default_forum_layout"], 1);
        assert_eq!(b["default_sort_order"], 0);
        assert_eq!(b["flags"], 16);
        assert_eq!(b["available_tags"].as_array().unwrap().len(), 15);
        assert_eq!(b["available_tags"][0], json!({"name": "todo", "moderated": false}));
        let rfcs = LAYOUT[1].chans.iter().find(|c| c.key == "rfcs").unwrap();
        let b = req_create_channel("G", rfcs, "CAT").body.unwrap();
        assert!(b.get("flags").is_none());
        let t = LAYOUT[0].chans.iter().find(|c| c.key == "readme").unwrap();
        assert_eq!(req_create_channel("G", t, "C").body.unwrap()["type"], 0);
        assert_eq!(req_create_category("G", "x").body.unwrap()["type"], 4);
        let r = req_create_role("G", "PM");
        assert_eq!(r.body.unwrap(), json!({"name": "PM", "mentionable": true, "permissions": "0"}));
        assert_eq!(req_create_webhook("C").body.unwrap(), json!({"name": "8sync HQ"}));
        let r = req_patch_thread_tags("T", &["a".into()]);
        assert_eq!(r.method, "PATCH");
        assert_eq!(r.body.unwrap(), json!({"applied_tags": ["a"], "archived": false}));
        let r = req_add_tags("C", &[Tag { id: "1".into(), name: "x".into() }], &["y"]);
        assert_eq!(r.body.unwrap()["available_tags"], json!([{"id": "1", "name": "x"}, {"name": "y", "moderated": false}]));
        match req_webhook("https://h/webhooks/1/t", json!({}), Some("9"), true).target {
            Target::Webhook(u) => assert_eq!(u, "https://h/webhooks/1/t?wait=true&thread_id=9"),
            _ => panic!(),
        }
    }

    #[test]
    fn invite_has_no_administrator() {
        let bits = perm_bits();
        assert_eq!(bits & (1 << 3), 0);
        for b in [10, 11, 38, 35, 34, 29, 14, 15, 16, 6, 51] {
            assert_ne!(bits & (1u64 << b), 0);
        }
        assert!(invite_hint().ends_with(&bits.to_string()));
    }

    #[test]
    fn pin_endpoints_and_thread_patch_body() {
        let r = req_pin("C", "M");
        assert!(matches!(&r.target, Target::Api(p) if p == "/channels/C/messages/pins/M"));
        assert!(matches!(&req_pin_legacy("C", "M").target, Target::Api(p) if p == "/channels/C/pins/M"));
        let b = req_patch_thread_tags("T", &["a".into(), "b".into()]).body.unwrap();
        assert_eq!(b, json!({"applied_tags": ["a", "b"], "archived": false}));
    }

    #[test]
    fn claim_is_idempotent_across_parallel_hooks() {
        let mut st = State::default();
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, false, 100), Claim::Created);
        // second TaskCreated and a TaskCompleted while the first is posting: no second post
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, false, 101), Claim::InFlight);
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, true, 102), Claim::InFlight);
        assert_eq!(st.tasks["t1"].status, PENDING_DONE);
        // stale reservation is taken over
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, false, 100 + PENDING_TTL + 5), Claim::Created);
        // posted -> Exists
        st.tasks.get_mut("t1").unwrap().status = "todo".into();
        st.tasks.get_mut("t1").unwrap().thread_id = "TH".into();
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, true, 500), Claim::Exists("TH".into()));
        // unknown task completed: created once with the done reservation, then in flight
        assert_eq!(claim_task(&mut st, "t2", "T", None, None, true, 10), Claim::Created);
        assert_eq!(claim_task(&mut st, "t2", "T", None, None, true, 11), Claim::InFlight);
    }

    #[test]
    fn busy_lock_skips_write() {
        let home = tmp("lock");
        let p = Paths::under(&home);
        std::fs::create_dir_all(&p.state_dir).unwrap();
        std::fs::write(p.state_dir.join("tasks.lock"), "").unwrap();
        let r = update_state(&p, |s| {
            s.tasks.insert("a".into(), Task::default());
        });
        assert!(r.is_err());
        assert!(!p.tasks().exists());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn api_base_only_loopback() {
        assert_eq!(api_base(None), DEFAULT_API);
        assert_eq!(api_base(Some("http://127.0.0.1:8080/")), "http://127.0.0.1:8080");
        assert_eq!(api_base(Some("http://localhost:1/api")), "http://localhost:1/api");
        assert_eq!(api_base(Some("http://[::1]:9")), "http://[::1]:9");
        for bad in ["https://evil.example", "http://127.0.0.1.evil.com", "http://localhost@evil.com", "ftp://localhost", "localhost"] {
            assert_eq!(api_base(Some(bad)), DEFAULT_API, "{bad}");
        }
    }

    #[test]
    fn forum_posts_need_title() {
        for k in ["rfcs", "notes"] {
            assert!(forum_thread_name(k, None).is_err());
            assert!(forum_thread_name(k, Some("  ")).is_err());
            assert_eq!(forum_thread_name(k, Some("My RFC")).unwrap().as_deref(), Some("My RFC"));
        }
        assert_eq!(forum_thread_name("logs", None).unwrap(), None);
        let m = Msg { persona: Persona::Hq, avatar: None, title: None, text: "x", mention_user: None, thread_name: Some("My RFC"), tags: &[] };
        assert_eq!(webhook_body(&m)["thread_name"], "My RFC");
    }

    #[test]
    fn curl_status_comes_from_headers_not_write_out() {
        // Windows curl.exe 8.8.0 fails every `write-out` with error 43.
        assert!(!curl_config("GET", "https://x", None, None, 5).contains("write-out"));
        assert!(curl_config("GET", "https://x", None, None, 5).contains("include"));
        assert_eq!(split_included("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"id\":\"1\"}"), Some((200, "{\"id\":\"1\"}".into())));
        assert_eq!(split_included("HTTP/1.1 100 Continue\r\n\r\nHTTP/2 429 \r\nretry-after: 1\r\n\r\n{\"retry_after\":0.5}"), Some((429, "{\"retry_after\":0.5}".into())));
        assert_eq!(split_included("HTTP/2 204\r\n\r\n"), Some((204, String::new())));
        assert_eq!(split_included("garbage"), None);
    }

    #[test]
    fn dry_run_and_curl_config_hold_no_secret_in_output() {
        let url = "https://discord.com/api/v10/webhooks/55/WEBHOOKSECRET?wait=true";
        let r = req_webhook(url, json!({"content": "hi"}), None, false);
        let out = render_dry(&r, DEFAULT_API);
        assert!(!out.contains("WEBHOOKSECRET"));
        let r = req_pin("C", "M");
        let out = render_dry(&r, DEFAULT_API);
        assert!(out.contains("Bot ****") && !out.contains("BOTSECRET"));
        // curl config carries the secrets (stdin), quoting is safe
        let cfg = curl_config("POST", url, Some("BOTSECRET"), Some(r#"{"a":"q\"\n"}"#), 8);
        assert!(cfg.contains("Authorization: Bot BOTSECRET"));
        assert!(cfg.contains(r#"data-raw = "{\"a\":\"q\\\"\\n\"}""#));
        assert!(curl_config("PUT", "https://x", None, None, 5).contains("data-raw = \"\""));
        assert!(!curl_config("GET", "https://x", None, None, 5).contains("data-raw"));
        assert_eq!(cq("a\"b\\c\n"), "\"a\\\"b\\\\c\\n\"");
    }

    #[test]
    fn dry_run_setup_path_fakes_ids_without_network() {
        let ctx = Ctx::new(Some("t".into()), true, false);
        let board = LAYOUT[1].chans.iter().find(|c| c.key == "task-board").unwrap();
        let v = ctx.send(&req_create_channel("G", board, "P")).unwrap();
        let ch = parse_chan(&v).unwrap();
        assert_eq!(ch.tags.len(), 15);
        assert!(ch.tags[0].id.starts_with("DRYTAG-"));
        assert_eq!(ctx.send(&api("GET", "/x", None)).unwrap(), json!([]));
    }

    #[test]
    fn state_roundtrip_and_log_cap() {
        let home = tmp("state");
        let p = Paths::under(&home);
        update_state(&p, |s| {
            s.tasks.insert("a".into(), Task { thread_id: "T".into(), status: "todo".into(), title: "x".into(), ..Default::default() });
        })
        .unwrap();
        update_state(&p, |s| s.tasks.get_mut("a").unwrap().status = "done".into()).unwrap();
        assert_eq!(load_state(&p).tasks["a"].status, "done");
        assert!(!p.state_dir.join("tasks.lock").exists());
        let sec = Secrets { bot_token: Some("SECRETSECRET1".into()), ..Default::default() };
        for i in 0..520 {
            log_err(&p, &sec, &format!("e{i} SECRETSECRET1"));
        }
        let l = std::fs::read_to_string(p.log()).unwrap();
        assert_eq!(l.lines().count(), LOG_KEEP);
        assert!(!l.contains("SECRETSECRET1") && l.contains("e519"));
        #[cfg(unix)]
        assert_eq!(mode_of(&p.log()), Some(0o600));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn failed_post_keeps_folded_completion_retryable() {
        let mut st = State::default();
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, false, 100), Claim::Created);
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, true, 101), Claim::InFlight);
        assert!(release_failed_claim(&mut st, "t1"));
        assert_eq!(st.tasks["t1"].status, PENDING_DONE);
        assert_eq!(st.tasks["t1"].updated, 0);
        // next hook takes it immediately, still carrying the folded completion
        assert_eq!(claim_task(&mut st, "t1", "T", None, None, false, 1_000_000), Claim::Created);
        assert_eq!(st.tasks["t1"].status, PENDING_DONE);
        st.tasks.get_mut("t1").unwrap().status = PENDING.into();
        // plain reservation is dropped
        assert!(!release_failed_claim(&mut st, "t1"));
        assert!(!st.tasks.contains_key("t1"));
    }

    #[test]
    fn stale_takeover_with_thread_does_not_repost() {
        let mut st = State::default();
        st.tasks.insert("t".into(), Task { thread_id: "TH".into(), status: PENDING.into(), updated: 1, ..Default::default() });
        assert_eq!(claim_task(&mut st, "t", "T", None, None, false, 1 + PENDING_TTL + 5), Claim::Exists("TH".into()));
        assert_eq!(st.tasks["t"].thread_id, "TH");
        assert!(!is_pending(&st.tasks["t"].status));
    }

    #[test]
    fn stale_takeover_with_thread_keeps_folded_done() {
        let mut st = State::default();
        st.tasks.insert("t".into(), Task { thread_id: "TH".into(), status: PENDING_DONE.into(), updated: 1, ..Default::default() });
        assert_eq!(claim_task(&mut st, "t", "T", None, None, false, 1 + PENDING_TTL + 5), Claim::Exists("TH".into()));
        assert_eq!(st.tasks["t"].status, "done");
    }

    #[test]
    fn parallel_completions_patch_once() {
        let mut st = State::default();
        st.tasks.insert("t".into(), Task { thread_id: "TH".into(), status: "doing".into(), updated: 1, ..Default::default() });
        assert_eq!(claim_task(&mut st, "t", "T", None, None, true, 100), Claim::Exists("TH".into()));
        assert_eq!(st.tasks["t"].status, DONE_SENDING);
        assert_eq!(claim_task(&mut st, "t", "T", None, None, true, 101), Claim::Done);
        // a crashed sender goes stale and is taken over
        assert_eq!(claim_task(&mut st, "t", "T", None, None, true, 101 + PENDING_TTL + 5), Claim::Exists("TH".into()));
        st.tasks.get_mut("t").unwrap().status = "done".into();
        assert_eq!(claim_task(&mut st, "t", "T", None, None, true, 999), Claim::Done);
    }

    #[test]
    fn prune_drops_old_done_and_orphan_pending() {
        let t = |status: &str, thread: &str, updated: u64, done_at: Option<u64>| Task { status: status.into(), thread_id: thread.into(), updated, done_at, ..Default::default() };
        let now = 100 * 86_400;
        let mut st = State::default();
        st.tasks.insert("old-done".into(), t("done", "T", 1, Some(now - DONE_KEEP - 1)));
        st.tasks.insert("new-done".into(), t("done", "T", 1, Some(now - DONE_KEEP + 10)));
        st.tasks.insert("old-pending".into(), t(PENDING, "", now - PENDING_KEEP - 1, None));
        st.tasks.insert("new-pending".into(), t(PENDING, "", now - 10, None));
        st.tasks.insert("old-doing".into(), t("doing", "T", 1, None));
        st.tasks.insert("retry".into(), t(PENDING_DONE, "", 0, None));
        prune_state(&mut st, now);
        let keys: Vec<_> = st.tasks.keys().map(String::as_str).collect();
        assert_eq!(keys, ["new-done", "new-pending", "old-doing", "retry"]);
        // and through the locked write path
        let home = tmp("prune");
        let p = Paths::under(&home);
        update_state(&p, |s| {
            s.tasks.insert("x".into(), t("done", "T", 1, Some(1)));
        })
        .unwrap();
        update_state(&p, |_| {}).unwrap();
        assert!(load_state(&p).tasks.is_empty());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn task_id_lookup_and_status_list() {
        let mut st = State::default();
        for (k, u) in [("team-a:1", 5), ("team-a:2", 9), ("s9:1", 7)] {
            st.tasks.insert(k.into(), Task { thread_id: "T".into(), status: "todo".into(), title: "x\ny".into(), updated: u, ..Default::default() });
        }
        assert_eq!(resolve_task_id(&st, "team-a:1").unwrap(), "team-a:1");
        assert_eq!(resolve_task_id(&st, "2").unwrap(), "team-a:2");
        assert_eq!(resolve_task_id(&st, "a:2").unwrap(), "team-a:2");
        let e = resolve_task_id(&st, "1").unwrap_err().to_string();
        assert!(e.contains("ambiguous") && e.contains("team-a:1") && e.contains("s9:1"), "{e}");
        assert!(resolve_task_id(&st, "7").is_err());
        let ids: Vec<_> = recent_tasks(&st, 2).iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(ids, ["team-a:2", "s9:1"]);
        let line = task_line("s9:1", &st.tasks["s9:1"]);
        assert!(line.contains("s9:1") && line.contains("todo") && line.contains("x y") && !line.contains('\n'));
    }

    #[test]
    fn posted_thread_guards_pending_and_unknown() {
        let mut st = State::default();
        assert!(posted_thread(&st, "x").is_err());
        claim_task(&mut st, "x", "T", None, None, false, 1);
        assert!(posted_thread(&st, "x").unwrap_err().to_string().contains("still being created"));
        st.tasks.get_mut("x").unwrap().thread_id = "TH".into();
        assert_eq!(posted_thread(&st, "x").unwrap(), "TH");
    }

    #[test]
    fn lock_wait_respects_deadline_and_retry_gives_up() {
        let home = tmp("lockdl");
        let p = Paths::under(&home);
        std::fs::create_dir_all(&p.state_dir).unwrap();
        std::fs::write(p.state_dir.join("tasks.lock"), "").unwrap(); // held, fresh
        let t0 = std::time::Instant::now();
        let past = Some(std::time::Instant::now());
        assert!(with_lock(&p, "tasks.lock", past, || ()).is_none());
        assert!(update_state_retry(&p, past, |_| ()).is_err());
        assert!(t0.elapsed() < Duration::from_millis(500));
        std::fs::remove_file(p.state_dir.join("tasks.lock")).unwrap();
        assert!(update_state_retry(&p, None, |s| s.tasks.insert("a".into(), Task::default()).is_none()).unwrap());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn hook_budget_leaves_room_under_registered_timeout() {
        const { assert!(HOOK_BUDGET_SECS <= 8) };
    }

    #[test]
    fn working_directory_does_not_double_dollar() {
        let u = unit_text("/home/a/r$x%y", "lead", "/usr/bin/tmux", "/usr/bin/claude").unwrap();
        assert!(u.contains("WorkingDirectory=/home/a/r$x%%y\n"));
        assert!(u.contains("-c \"/home/a/r$$x%%y\""));
    }

    #[test]
    fn standup_groups_by_role() {
        let mut st = State::default();
        let t = |role: Option<&str>, status: &str, title: &str, done_at: Option<u64>| Task { role: role.map(Into::into), status: status.into(), title: title.into(), done_at, ..Default::default() };
        st.tasks.insert("1".into(), t(Some("backend"), "doing", "API", None));
        st.tasks.insert("2".into(), t(Some("backend"), "done", "Old", Some(1_000)));
        st.tasks.insert("3".into(), t(Some("backend"), "done", "Fresh", Some(1_000_000)));
        st.tasks.insert("4".into(), t(Some("qa"), "blocked", "Flaky", None));
        let e = standup_embeds(&st, 1_000_100);
        assert_eq!(e.len(), 2);
        let be = e[0]["description"].as_str().unwrap();
        assert!(be.contains("API") && be.contains("Fresh") && !be.contains("Old"));
        assert!(e[1]["description"].as_str().unwrap().contains("Blocked"));
        assert_eq!(standup_embeds(&State::default(), 0).len(), 1);
        assert_eq!(civil_ymd(0), "1970-01-01");
        assert_eq!(civil_ymd(1_782_000_000), "2026-06-21");
    }

    #[test]
    fn unit_files() {
        let u = unit_text("/home/a/repo", "8sync-hq", "/usr/bin/tmux", "/home/a/.local/bin/claude").unwrap();
        assert!(u.contains("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1"));
        assert!(u.contains("--channels plugin:discord@claude-plugins-official"));
        assert!(u.contains("WantedBy=default.target"));
        assert!(unit_text("/r", "bad name", "t", "c").is_err());
        assert!(unit_text("/r\"x", "n", "t", "c").is_err());
        assert!(unit_text("/r", "n", "t", "/a'b").is_err());
        assert!(TIMER_TEXT.contains("09:00:00"));
        assert!(standup_service_text("/bin/8sync").contains("hq standup"));
    }
    #[test]
    fn exec_start_quotes_and_escapes() {
        let u = unit_text("/home/a b/r$x", "lead", "/opt/t mux/tmux", "/home/$u/50%/claude bin").unwrap();
        assert!(u.contains("ExecStart=-\"/opt/t mux/tmux\" new-session"));
        assert!(u.contains("ExecStop=-\"/opt/t mux/tmux\" kill-session"));
        assert!(u.contains("'/home/$$u/50%%/claude bin' --channels"));
        assert!(u.contains("-c \"/home/a b/r$$x\""));
        assert!(u.contains("\nWorkingDirectory=/home/a b/r$x\n"));
    }

    #[test]
    fn working_directory_is_unquoted_absolute_path() {
        // systemd rejects a quoted WorkingDirectory ("path is not absolute"); found in UAT
        // with `systemd-analyze --user verify`.
        let u = unit_text("/home/a b/repo", "lead", "/usr/bin/tmux", "/usr/bin/claude").unwrap();
        assert!(u.contains("\nWorkingDirectory=/home/a b/repo\n"));
    }

    #[test]
    fn task_board_post_points_to_task_new() {
        let e = forum_thread_name("task-board", Some("x")).unwrap_err().to_string();
        assert!(e.contains("hq task new"));
        assert_eq!(forum_thread_name("rfcs", Some("ADR 1")).unwrap().as_deref(), Some("ADR 1"));
    }

    #[test]
    fn task_ids_are_scoped_per_team_or_session() {
        let a: Value = serde_json::from_str(r#"{"session_id":"s1","task_id":"1","task_subject":"x"}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"session_id":"s2","task_id":"1","task_subject":"x"}"#).unwrap();
        let t: Value = serde_json::from_str(r#"{"session_id":"s3","team_name":"team-a","task_id":"1"}"#).unwrap();
        let bare: Value = serde_json::from_str(r#"{"task_id":"1"}"#).unwrap();
        assert_ne!(scoped_task_id(&a, "1"), scoped_task_id(&b, "1"));
        assert_eq!(scoped_task_id(&t, "1"), "team-a:1");
        assert_eq!(scoped_task_id(&bare, "1"), "1");
        assert_eq!(scoped_task_id(&a, "1"), "s1:1");
    }

    #[test]
    fn lead_and_teammate_share_a_key_via_team_name() {
        let lead: Value = serde_json::from_str(r#"{"session_id":"lead1","team_name":"tm","task_id":"3","task_subject":"x"}"#).unwrap();
        let mate: Value = serde_json::from_str(r#"{"session_id":"mate1","team_name":"tm","teammate_name":"backend","task_id":"3","task_subject":"x"}"#).unwrap();
        let (Some(Action::TaskNew { id: a, .. }), Some(Action::TaskDone { id: b, .. })) = (map_hook("TaskCreated", &lead), map_hook("TaskCompleted", &mate)) else { panic!("mapping") };
        assert_eq!(a, "tm:3");
        assert_eq!(a, b);
        assert!(!lacks_team_scope("TaskCompleted", &mate));
        let no_team: Value = serde_json::from_str(r#"{"session_id":"m","teammate_name":"backend","task_id":"3"}"#).unwrap();
        assert!(lacks_team_scope("TaskCompleted", &no_team));
        assert!(!lacks_team_scope("TaskCompleted", &lead));
        assert!(!lacks_team_scope("Notification", &no_team));
    }

    #[test]
    fn tarball_link_entries_refused() {
        let ok = "-rw-r--r-- u/u 12 2026-10-13 00:00 hq-ui/server.js\ndrwxr-xr-x u/u 0 2026-10-13 00:00 hq-ui/\n";
        assert!(check_no_links(ok).is_ok());
        assert!(check_no_links("lrwxrwxrwx u/u 0 2026-10-13 00:00 hq-ui/x -> /etc\n").is_err());
        assert!(check_no_links("hrw-r--r-- u/u 0 2026-10-13 00:00 hq-ui/y link to hq-ui/z\n").is_err());
    }

}
