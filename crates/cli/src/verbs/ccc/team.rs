//! `8sync ccc auto up [--roles lead,dev,qa,review] [--loop 10m] [--hours N] [--usd-per-hour X]`
//! and `auto down`: the whole team in one command, no terminal per room.
//!
//! `up` turns `auto on --here` for the project, then makes sure every role room runs as a Claude
//! Code background session (`claude --bg`, Claude Code 2.1.296: prints `backgrounded · <8-char id>
//! · <name>`; `claude agents --json` lists it; `attach`/`logs`/`stop` take the short id). A room:
//! - already live in `claude agents --json --cwd <root>` (by id, or a background session with the
//!   room's name) only gets the loop message in its inbox, like `auto on --loop`;
//! - stopped with a transcript resumes in the background under the same id (`--resume <id> --bg`);
//! - new starts with `--bg --name <room>`, the room's model ([`super::room::Role::model`]) and the
//!   loop prompt ([`super::auto::loop_prompt`]) as its first message. `--bg` ignores `--session-id`,
//!   so the registry is pointed at the id Claude Code picked ([`ccc_core::registry::Store::rebind`]);
//!   inbox, HQ and the room hook then find it.
//!
//! Auto mode needs a trusted workspace: Claude Code then prints "Workspace not trusted …" and `up`
//! stops and says to open `claude` there once. Rooms run with `--permission-mode auto`, never
//! bypass. `down` stops this project's background rooms (`claude stop`, the conversation is kept)
//! and pauses auto. Progress: `8sync hq ui`, `claude agents`, `8sync ccc auto board`.
//!
//! `up --clear-ss` first deletes this project's junk background sessions (`claude rm`, finished
//! ones included): every background session no team room keeps, i.e. duplicates of a room and
//! leftovers of old runs or dropped rooms, and their registry entries. Interactive sessions (the
//! owner's terminals) are never touched; `claude rm` keeps a worktree with unpushed commits.
use std::path::Path;

use anyhow::{bail, Result};
use ccc_core::registry::Store;
use serde_json::Value;

use super::{auto, idle, room};

pub(super) const USAGE: &str = "usage: 8sync ccc auto up [--roles lead,dev,qa,review] [--loop 10m] [--hours N] [--usd-per-hour X] [--clear-ss] | down";

/// `auto up …` / `auto down`: the verbs this module owns.
pub(super) fn wants(rest: &[String]) -> bool {
    matches!(rest.first().map(String::as_str), Some("up" | "down"))
}

/// Runs `claude <args>` in the project root and returns stdout + stderr.
pub(super) trait Claude {
    fn run(&self, args: &[String]) -> Result<String>;
}

/// The real `claude` binary.
pub(super) struct Bin<'a> {
    pub exe: std::path::PathBuf,
    pub root: &'a Path,
}

impl Claude for Bin<'_> {
    fn run(&self, args: &[String]) -> Result<String> {
        let out = std::process::Command::new(&self.exe)
            .args(args)
            .current_dir(self.root)
            .stdin(std::process::Stdio::null())
            .output()?;
        Ok(format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
    }
}

/// What `up` needs from the outside world; [`Bin`] and the registry in production, fakes in tests.
pub(super) struct Team<'a> {
    pub home: &'a Path,
    pub root: &'a Path,
    pub store: &'a Store,
    pub subscription: bool,
    pub claude: &'a dyn Claude,
    /// Claude Code has a transcript for this conversation id.
    pub has_transcript: &'a dyn Fn(&str) -> bool,
    /// The display name a new room gets (machine-wide clash → `<name>-<repo>`).
    pub title: &'a dyn Fn(&str) -> String,
}

/// A session from `claude agents --json`.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Live {
    pub id: String,
    pub name: String,
    pub background: bool,
}

pub(super) fn live(json: &str) -> Result<Vec<Live>> {
    let v: Value = serde_json::from_str(json.trim()).map_err(|_| {
        anyhow::anyhow!("`claude agents --json` không trả JSON ({}): cần Claude Code ≥ 2.1.29x", crate::verbs::session_view::truncate(json.trim(), 120))
    })?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| {
            // ids go back to `claude stop|rm` as an argument: only the UUID alphabet passes.
            let id = a["sessionId"].as_str().filter(|s| (8..=64).contains(&s.len()) && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))?;
            Some(Live {
                id: id.to_string(),
                name: a["name"].as_str().unwrap_or_default().to_string(),
                background: a["kind"].as_str() == Some("background"),
            })
        })
        .collect())
}

/// The short id in `claude --bg` output (`backgrounded · 3698e3a6 · name`).
pub(super) fn short_id(out: &str) -> Option<String> {
    out.lines().filter(|l| l.contains("backgrounded")).find_map(|l| {
        let id = l.split('·').nth(1)?.trim();
        (6..=36).contains(&id.len()).then_some(())?;
        id.chars().all(|c| c.is_ascii_hexdigit() || c == '-').then(|| id.to_string())
    })
}

pub(super) fn untrusted(out: &str) -> bool {
    out.to_lowercase().contains("not trusted")
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Plan {
    /// Live already: id of the live session (may differ from the registry's).
    Running(String),
    Resume,
    Start,
}

/// `here`: live sessions started in this project; `all`: every live session on the machine. The
/// room's own id counts wherever it runs (a terminal in another folder): resuming it would run
/// one conversation in two processes. A background session with the room's name only counts here.
pub(super) fn plan(reg_id: &str, title: &str, here: &[Live], all: &[Live], has_transcript: bool) -> Plan {
    if let Some(l) = all.iter().chain(here).find(|l| l.id == reg_id).or_else(|| here.iter().find(|l| l.background && l.name == title)) {
        return Plan::Running(l.id.clone());
    }
    if has_transcript {
        Plan::Resume
    } else {
        Plan::Start
    }
}

/// Claude Code caps a `/goal` condition at 4,000 characters (https://code.claude.com/docs/en/goal).
pub(super) const GOAL_MAX: usize = 4000;

/// The first message of a room with a board lane: `/goal <condition>`. Setting a goal starts a turn
/// with the condition as the directive, and Claude Code's evaluator starts the next turn until the
/// condition holds (checked live: `claude --bg … "/goal …"` → "Goal set" … "Goal achieved"). The
/// condition only holds when auto stops, so the room never idles while auto is on: an empty lane
/// is spent in `auto wait`, which blocks without tokens until a card arrives.
pub(super) fn goal_prompt(name: &str, lane: &str, every_min: u64) -> String {
    let (role, duty) = room::role(name);
    let g = format!(
        "/goal Phòng `{name}` (vai {role}: {duty}) làm việc liên tục cho dự án này qua board `8sync ccc auto`. \
         Lượt đầu, đặt loop dự phòng: {setup} \
         Mỗi lượt: (1) `8sync ccc auto status --json`; (2) `8sync ccc auto claim --json` (cột {lane}); có card thì làm đúng việc cột đó: {playbook}; \
         (3) không có card thì `8sync ccc auto wait --json` (chờ tới khi cột {lane} có card, tối đa 9 phút, không tốn token) rồi quay lại (1). \
         Rail: không merge/push main/tag/deploy khi owner chưa trả lời câu Ship; giữ file trước khi sửa (`8sync ccc . goal \"…\" --files a,b`); \
         `8sync ccc meet --say \"done|doing|blocked: …\"` sau mỗi card. \
         Điều kiện đạt (dừng): trong lượt gần nhất, `auto status --json` cho `on` false hoặc `paused` true hoặc `cap` khác null \
         hoặc `gate` nhắc tới lease (lease subscription hết hạn/chưa có), hoặc `auto wait --json` trả `\"wake\":\"off\"` hay `\"wake\":\"cap\"`.",
        setup = auto::loop_setup(name, every_min),
        playbook = auto::lane_playbook(lane),
    );
    g.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `claude` arguments for a room that is not live. One line: a `.cmd` shim cannot pass newlines.
pub(super) fn argv(plan: &Plan, id: &str, title: &str, model: Option<&str>, prompt: &str) -> Vec<String> {
    let mut a: Vec<String> = match plan {
        Plan::Resume => vec!["--resume".into(), id.into(), "--bg".into()],
        _ => vec!["--bg".into(), "--name".into(), title.into()],
    };
    a.extend(["--permission-mode".into(), "auto".into()]);
    if let Some(m) = model {
        a.extend(["--model".into(), m.into()]);
    }
    a.push(prompt.split_whitespace().collect::<Vec<_>>().join(" "));
    a
}

/// One room in `up`'s report.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Row {
    pub name: String,
    pub role: String,
    pub model: String,
    pub state: String,
    pub short: String,
}

pub(super) struct Opts {
    pub roles: Vec<String>,
    pub every: u64,
    pub hours: f64,
    pub rate: Option<f64>,
    /// `--clear-ss`: delete junk background sessions first.
    pub clear: bool,
}

pub(super) fn parse(rest: &[String]) -> Result<Opts> {
    let mut o = Opts { roles: room::DEFAULT_TEAM.iter().map(|s| s.to_string()).collect(), every: auto::DEFAULT_LOOP_MIN, hours: idle::DEFAULT_HOURS as f64, rate: None, clear: false };
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        let mut value = || it.next().filter(|v| !v.starts_with("--")).cloned().ok_or_else(|| anyhow::anyhow!("{a} cần một giá trị\n{USAGE}"));
        match a.as_str() {
            "--roles" => {
                let mut v: Vec<String> = Vec::new();
                for r in value()?.split(',').map(str::trim).filter(|r| !r.is_empty()) {
                    if !v.iter().any(|x| x == r) {
                        v.push(r.to_string());
                    }
                }
                if v.is_empty() || v.len() > 8 {
                    bail!("--roles: 1..8 phòng, vd lead,dev,qa,review\n{USAGE}");
                }
                o.roles = v;
            }
            "--loop" => o.every = auto::parse_every(&value()?)?,
            "--hours" => o.hours = value()?.parse().map_err(|_| anyhow::anyhow!("--hours cần một số\n{USAGE}"))?,
            "--usd-per-hour" => o.rate = Some(value()?.parse().map_err(|_| anyhow::anyhow!("--usd-per-hour cần một số\n{USAGE}"))?),
            "--clear-ss" | "--clean" => o.clear = true,
            x => bail!("không rõ `{x}`\n{USAGE}"),
        }
    }
    Ok(o)
}

/// This project's sessions in `claude agents --json`; `all` adds finished background ones.
fn agents(t: &Team, all: bool) -> Result<Vec<Live>> {
    let mut a: Vec<String> = vec!["agents".into(), "--json".into()];
    if all {
        a.push("--all".into());
    }
    a.extend(["--cwd".into(), t.root.to_string_lossy().into_owned()]);
    live(&t.claude.run(&a)?)
}

/// The background sessions no room keeps. `keep` is (registry id, title) per team room: a room keeps
/// its registry id, else the first background session with its title (`up` rebinds to it).
pub(super) fn junk<'a>(all: &'a [Live], keep: &[(String, String)]) -> Vec<&'a Live> {
    let mut kept: Vec<&str> = Vec::new();
    for (id, title) in keep {
        let hit = all.iter().find(|l| l.id == *id).or_else(|| all.iter().find(|l| l.background && l.name == *title && !kept.contains(&l.id.as_str())));
        if let Some(l) = hit {
            kept.push(&l.id);
        }
    }
    all.iter().filter(|l| l.background && !kept.contains(&l.id.as_str())).collect()
}

/// A junk session `--clear-ss` deleted, or kept with Claude Code's reason (unpushed worktree …).
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Gone {
    pub name: String,
    pub short: String,
    pub kept: Option<String>,
}

/// `--clear-ss`: stop and `claude rm` every junk background session of the project, then drop the
/// registry rooms that pointed at the deleted ones. Gone or not is read back from `claude agents`.
fn clear(t: &Team, roles: &[String]) -> Result<Vec<Gone>> {
    let all = agents(t, true)?;
    let reg = t.store.load();
    let keep: Vec<(String, String)> = roles
        .iter()
        .map(|n| (reg.sessions.iter().find(|s| &s.name == n).map(|s| s.conversation_id.clone()).unwrap_or_default(), (t.title)(n)))
        .collect();
    let junk = junk(&all, &keep);
    if junk.is_empty() {
        return Ok(Vec::new());
    }
    let running = agents(t, false)?;
    let mut tried = Vec::new();
    for l in junk {
        let short: String = l.id.chars().take(8).collect();
        if running.iter().any(|r| r.id == l.id) {
            t.claude.run(&["stop".into(), short.clone()])?;
        }
        let out = t.claude.run(&["rm".into(), short.clone()])?;
        tried.push((l, short, out));
    }
    let left = agents(t, true)?;
    let mut gone = Vec::new();
    for (l, short, out) in tried {
        let kept = left.iter().any(|x| x.id == l.id).then(|| crate::verbs::session_view::truncate(out.trim().lines().next().unwrap_or("không rõ lý do"), 200));
        if kept.is_none() {
            for s in reg.sessions.iter().filter(|s| s.conversation_id == l.id) {
                t.store.remove(&s.name)?;
            }
        }
        gone.push(Gone { name: l.name.clone(), short, kept });
    }
    Ok(gone)
}

/// `auto up`: auto on for this project, then every room live. Fails on the first room Claude Code
/// refuses (untrusted workspace, not logged in): what started stays up, a re-run picks up the rest.
pub(super) fn up(t: &Team, o: &Opts, now: u64) -> Result<(Value, Vec<Gone>, Vec<Row>)> {
    // Validate every name before anything changes.
    for n in &o.roles {
        if n.is_empty() || n.len() > 64 || !n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) || n.starts_with('.') {
            bail!("tên phòng không hợp lệ: `{n}` (chữ, số, '-', '_', '.')");
        }
    }
    let gone = if o.clear { clear(t, &o.roles)? } else { Vec::new() };
    let before = agents(t, false)?;
    let everywhere = live(&t.claude.run(&["agents".into(), "--json".into()])?)?;
    // On first: a room's first tick reads `auto status --json` and drops its loop while auto is off.
    let status = auto::set(t.home, auto::Mode::On { hours: o.hours, after: auto::DEFAULT_AFTER_S, rate: o.rate, repo: Some(t.root.to_path_buf()) }, t.subscription, now)?;
    auto::write_loop_md(t.root)?;
    let mut rows = Vec::new();
    let mut started = Vec::new();
    for name in &o.roles {
        let s = t.store.touch(name, false)?;
        let title = (t.title)(name);
        let r = room::find(name);
        let (role, _) = room::role(name);
        let model = r.and_then(|r| r.model);
        // A room with a lane opens on Claude Code's own `/goal`: it keeps taking turns (claim → work →
        // move, `auto wait` while the lane is empty) until auto stops; the others get the loop prompt.
        let prompt = match r.and_then(|r| r.lane) {
            Some(lane) => goal_prompt(name, lane, o.every),
            None => auto::loop_prompt(name, o.every, false),
        };
        let p = plan(&s.conversation_id, &title, &before, &everywhere, (t.has_transcript)(&s.conversation_id));
        let (state, short) = match &p {
            Plan::Running(id) => {
                if *id != s.conversation_id {
                    t.store.rebind(name, id)?;
                }
                let sent = auto::queue_loops(t.home, &[(name.clone(), id.clone())], o.every, false, now);
                let when = if sent.first().is_some_and(|(_, l)| *l) { "vào ngay" } else { "vào khi xong lượt" };
                (format!("đang chạy · gửi loop ({when})"), id.chars().take(8).collect())
            }
            _ => {
                let out = t.claude.run(&argv(&p, &s.conversation_id, &title, model, &prompt))?;
                if untrusted(&out) {
                    bail!("Claude Code chưa trust thư mục {}: mở `claude` ở đó một lần, chấp nhận câu hỏi trust, rồi chạy lại `8sync ccc auto up` (phòng đã mở vẫn chạy)", t.root.display());
                }
                let Some(short) = short_id(&out) else {
                    bail!("`claude --bg` cho phòng {name} không mở được: {}", crate::verbs::session_view::truncate(out.trim(), 300));
                };
                if p == Plan::Start {
                    started.push((name.clone(), short.clone()));
                }
                ((if p == Plan::Resume { "chạy lại nền" } else { "mở nền" }).to_string(), short)
            }
        };
        rows.push(Row { name: name.clone(), role, model: model.unwrap_or("mặc định").into(), state, short });
    }
    // Point the registry at the ids Claude Code picked for new rooms (the list can lag a moment).
    for attempt in 0..5 {
        if started.is_empty() {
            break;
        }
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
        let now_live = agents(t, false)?;
        started.retain(|(name, short)| match now_live.iter().find(|l| l.id.starts_with(short.as_str())) {
            Some(l) => t.store.rebind(name, &l.id).is_err(),
            None => true,
        });
    }
    for (name, _) in &started {
        if let Some(row) = rows.iter_mut().find(|r| &r.name == name) {
            row.state.push_str(" (chưa thấy trong `claude agents`: inbox/HQ chưa nối, chạy lại `auto up`)");
        }
    }
    Ok((status, gone, rows))
}

/// `auto down`: stop this project's background rooms, pause auto. Returns the stopped room names.
pub(super) fn down(t: &Team, now: u64) -> Result<Vec<String>> {
    let reg = t.store.load();
    let live = agents(t, false)?;
    let mut stopped = Vec::new();
    for s in &reg.sessions {
        if live.iter().any(|l| l.background && l.id == s.conversation_id) {
            let short: String = s.conversation_id.chars().take(8).collect();
            t.claude.run(&["stop".into(), short])?;
            stopped.push(s.name.clone());
        }
    }
    auto::set(t.home, auto::Mode::Pause, t.subscription, now)?;
    Ok(stopped)
}

pub(super) fn print_up(status: &Value, gone: &[Gone], rows: &[Row], every: u64, subscription: bool) {
    println!("{}", auto::text(status));
    let (kept, deleted): (Vec<&Gone>, Vec<&Gone>) = gone.iter().partition(|g| g.kept.is_some());
    if !deleted.is_empty() {
        let names: Vec<String> = deleted.iter().map(|g| format!("{} {}", if g.name.is_empty() { "(không tên)" } else { &g.name }, g.short)).collect();
        println!("đã xoá {} session nền rác: {}", deleted.len(), names.join(", "));
    }
    for g in kept {
        println!("  giữ {} {}: {}", g.name, g.short, g.kept.as_deref().unwrap_or_default());
    }
    println!("team: {} phòng · loop {every} phút mỗi phòng", rows.len());
    for r in rows {
        println!("  {:<10} {:<12} {:<9} {:<9} {}", r.name, r.role, r.model, r.short, r.state);
    }
    println!("Xem tiến độ: `8sync hq ui` (web) · `8sync ccc auto board` (card theo cột) · `claude agents`.");
    println!("Vào một phòng: `claude attach <id>` · log: `claude logs <id>` · dừng cả team: `8sync ccc auto down`.");
    println!("Giao việc: `8sync ccc auto add \"<việc>\" [--check \"<lệnh>\"]` → lead viết AC, dev/qa/review kéo card theo cột.");
    for l in auto::loop_notes(subscription).into_iter().skip(1) {
        println!("{l}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;

    /// Records every call; answers `agents --json` from `agents` (one entry per call, last one
    /// repeats) and `--bg` with `bg`.
    struct Fake {
        calls: RefCell<Vec<Vec<String>>>,
        agents: RefCell<Vec<String>>,
        bg: String,
    }

    impl Claude for Fake {
        fn run(&self, args: &[String]) -> Result<String> {
            self.calls.borrow_mut().push(args.to_vec());
            if args.first().map(String::as_str) == Some("agents") {
                let mut a = self.agents.borrow_mut();
                return Ok(if a.len() > 1 { a.remove(0) } else { a[0].clone() });
            }
            if args.iter().any(|a| a == "--bg") {
                let name = args.iter().position(|a| a == "--name").map(|i| args[i + 1].clone()).unwrap_or_else(|| "resumed".into());
                return Ok(self.bg.replace("{name}", &name));
            }
            if args[0] == "rm" {
                return Ok(format!("cannot remove {}: worktree has unpushed commits\npass --discard-unpushed x@w", args[1]));
            }
            Ok(String::new())
        }
    }

    fn tmp(tag: &str) -> (PathBuf, PathBuf) {
        let h = std::env::temp_dir().join(format!("8sync-team-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&h);
        let root = h.join("proj");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        (h, root)
    }

    fn agent(id: &str, name: &str, kind: &str) -> String {
        format!(r#"{{"pid":1,"cwd":"x","kind":"{kind}","sessionId":"{id}","name":"{name}","status":"idle","startedAt":1}}"#)
    }

    const DEV_BG: &str = "3698e3a6-9b73-4b37-ab3a-368b169d0508";

    #[test]
    fn parses_claude_code_output() {
        assert_eq!(short_id("\u{1b}[2mbackgrounded · 3698e3a6 · 8sync-bgprobe\u{1b}[0m\n").as_deref(), Some("3698e3a6"));
        assert_eq!(short_id("Workspace not trusted. Run `claude` in C:\\x once"), None);
        assert!(untrusted("Workspace not trusted. Run `claude` in C:\\x once and accept the trust prompt"));
        let l = live(&format!("[{},{}]", agent(DEV_BG, "dev", "background"), agent("11111111-1111-4111-8111-111111111111", "core", "interactive"))).unwrap();
        assert_eq!(l[0], Live { id: DEV_BG.into(), name: "dev".into(), background: true });
        assert!(!l[1].background);
        assert!(live("error: unknown option '--json'").unwrap_err().to_string().contains("không trả JSON"));
        assert!(live(&format!("[{}]", agent("--discard-unpushed", "x", "background"))).unwrap().is_empty(), "never an id that reads as a flag");
    }

    #[test]
    fn plan_skips_live_rooms_and_resumes_stopped_ones() {
        let l = vec![Live { id: DEV_BG.into(), name: "dev".into(), background: true }, Live { id: "x".into(), name: "qa".into(), background: false }];
        assert_eq!(plan(DEV_BG, "dev", &l, &l, true), Plan::Running(DEV_BG.into()));
        assert_eq!(plan("other", "dev", &l, &l, false), Plan::Running(DEV_BG.into()), "a background room with the name counts");
        assert_eq!(plan("other", "qa", &l, &l, true), Plan::Resume, "an interactive session elsewhere with the same name does not");
        assert_eq!(plan("other", "qa", &l, &l, false), Plan::Start);
        // the room's id open in a terminal in another folder: never resumed a second time
        let rd = "ff3e2a54-0000-4000-8000-000000000001";
        let elsewhere = vec![Live { id: rd.into(), name: "rd-game".into(), background: false }];
        assert_eq!(plan(rd, "rd", &[], &elsewhere, true), Plan::Running(rd.into()));
        let bg_elsewhere = vec![Live { id: "e1".into(), name: "dev".into(), background: true }];
        assert_eq!(plan("other", "dev", &[], &bg_elsewhere, false), Plan::Start, "a same-named room of another project is not ours");
        let a = argv(&Plan::Start, "id-1", "dev", Some("sonnet"), "line one\nline  two");
        assert_eq!(a, ["--bg", "--name", "dev", "--permission-mode", "auto", "--model", "sonnet", "line one line two"]);
        let a = argv(&Plan::Resume, "id-1", "dev", None, "p");
        assert_eq!(a, ["--resume", "id-1", "--bg", "--permission-mode", "auto", "p"]);
        assert!(!a.iter().any(|x| x.contains("dangerously") || x == "bypassPermissions"));
    }

    #[test]
    fn options_default_to_the_four_lane_team() {
        let o = parse(&[]).unwrap();
        assert_eq!((o.roles.join(","), o.every, o.rate), ("lead,dev,qa,review".into(), 10, None));
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let o = parse(&v(&["--roles", "lead, ba,dev,dev2,qc,dev", "--loop", "2m", "--usd-per-hour", "3"])).unwrap();
        assert_eq!((o.roles.join(","), o.every, o.rate), ("lead,ba,dev,dev2,qc".into(), 2, Some(3.0)));
        assert!(parse(&v(&["--roles"])).is_err());
        assert!(parse(&v(&["--roles", ","])).is_err());
        assert!(parse(&v(&["--loop", "90m"])).is_err());
        assert!(parse(&v(&["--team"])).is_err());
        assert!(!o.clear);
        assert!(parse(&v(&["--clear-ss"])).unwrap().clear && parse(&v(&["--clean"])).unwrap().clear);
    }

    #[test]
    fn lane_rooms_open_on_a_goal_that_only_ends_when_auto_stops() {
        for name in ["lead", "ba", "dev", "dev2", "qa", "qc", "review", "critic", "ui", "api", "core"] {
            let lane = room::find(name).and_then(|r| r.lane).unwrap_or_else(|| panic!("{name} has a lane"));
            let g = goal_prompt(name, lane, 10);
            assert!(g.starts_with(&format!("/goal Phòng `{name}`")), "{g}");
            assert!(g.chars().count() <= GOAL_MAX, "{name}: {} chars over Claude Code's /goal cap", g.chars().count());
            assert!(!g.contains('\n'), "one line through a .cmd shim");
            for want in ["auto claim --json", "auto wait --json", "\"wake\":\"off\"", "`cap` khác null", "CronCreate", "câu Ship", &format!("cột {lane}")] {
                assert!(g.contains(want), "{name} misses {want}: {g}");
            }
        }
        // rooms without a lane keep the loop message, no goal
        assert!(room::find("rd").and_then(|r| r.lane).is_none());
    }

    #[test]
    fn junk_is_every_background_session_no_room_keeps() {
        let bg = |id: &str, name: &str| Live { id: id.into(), name: name.into(), background: true };
        let all = vec![
            bg("d1", "dev"),
            bg("d2", "dev"),
            Live { id: "l1".into(), name: "lead".into(), background: false },
            bg("l2", "lead"),
            bg("q1", "qa"),
            bg("u1", "ui"),
            Live { id: "n1".into(), name: "notes".into(), background: false },
        ];
        // dev: registry id gone → first background "dev" kept; lead: registry id is the terminal;
        // qa: registry id itself. Duplicates, other names and nothing interactive are junk.
        let keep = [("old".to_string(), "dev".to_string()), ("l1".into(), "lead".into()), ("q1".into(), "qa".into())];
        let ids: Vec<&str> = junk(&all, &keep).iter().map(|l| l.id.as_str()).collect();
        assert_eq!(ids, ["d2", "l2", "u1"]);
        assert!(junk(&all[..1], &keep).is_empty());
    }

    #[test]
    fn clear_ss_deletes_junk_then_opens_the_team() {
        let (h, root) = tmp("clear");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let lead = store.touch("lead", false).unwrap();
        let ui = store.touch("ui", false).unwrap();
        let (dup, stuck, notes) = ("aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003");
        let row = |id: &str, n: &str, k: &str| agent(id, n, k);
        let (l, d, x, o, s, i) = (
            row(&lead.conversation_id, "lead", "interactive"),
            row(DEV_BG, "dev", "background"),
            row(dup, "dev", "background"),
            row(&ui.conversation_id, "ui", "background"),
            row(stuck, "x", "background"),
            row(notes, "notes", "interactive"),
        );
        let fake = Fake {
            calls: RefCell::new(vec![]),
            agents: RefCell::new(vec![
                format!("[{l},{d},{x},{o},{s},{i}]"), // --all: finished ones too
                format!("[{l},{d},{x},{i}]"),         // running
                format!("[{l},{d},{s},{i}]"),         // --all after rm: `x` refused
                format!("[{l},{d},{i}]"),
            ]),
            bg: String::new(),
        };
        let t = Team { home: &h, root: &root, store: &store, subscription: true, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string() };
        let o = Opts { roles: vec!["lead".into(), "dev".into()], every: 10, hours: 2.0, rate: None, clear: true };
        let (_, gone, rows) = up(&t, &o, 1).unwrap();
        let g: Vec<_> = gone.iter().map(|g| (g.name.as_str(), g.short.as_str(), g.kept.is_some())).collect();
        assert_eq!(g, [("dev", "aaaaaaaa", false), ("ui", &ui.conversation_id[..8], false), ("x", "bbbbbbbb", true)]);
        assert!(gone[2].kept.as_deref().unwrap().contains("unpushed"));
        let calls = fake.calls.borrow();
        let did = |verb: &str| calls.iter().filter(|c| c[0] == verb).map(|c| c[1].clone()).collect::<Vec<_>>();
        assert_eq!(did("stop"), ["aaaaaaaa"], "only the running junk is stopped first");
        assert_eq!(did("rm"), ["aaaaaaaa", &ui.conversation_id[..8], "bbbbbbbb"]);
        assert!(!calls.iter().any(|c| c.iter().any(|a| a == "--bg")), "both rooms were live");
        let reg = store.load();
        let names: Vec<_> = reg.sessions.iter().map(|s| s.name.as_str()).collect();
        assert!(!names.contains(&"ui"), "the deleted room left the registry: {names:?}");
        assert_eq!(reg.sessions.iter().find(|s| s.name == "dev").unwrap().conversation_id, DEV_BG);
        assert!(rows.iter().all(|r| r.state.starts_with("đang chạy")));
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn up_opens_missing_rooms_in_the_background_and_rebinds_the_registry() {
        let (h, root) = tmp("up");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let lead = store.touch("lead", false).unwrap();
        let qa = store.touch("qa", false).unwrap();
        // lead is live (interactive, owner's terminal); qa stopped with a transcript; dev, review new.
        let first = format!("[{}]", agent(&lead.conversation_id, "lead", "interactive"));
        let after = format!("[{},{}]", agent(&lead.conversation_id, "lead", "interactive"), agent(DEV_BG, "dev", "background"));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![first, after]), bg: "backgrounded · 3698e3a6 · {name}\n".into() };
        let qa_id = qa.conversation_id.clone();
        let has = move |id: &str| id == qa_id;
        let t = Team { home: &h, root: &root, store: &store, subscription: true, claude: &fake, has_transcript: &has, title: &|n: &str| n.to_string() };
        let o = Opts { roles: vec!["lead".into(), "dev".into(), "qa".into()], every: 10, hours: 2.0, rate: None, clear: false };
        let (status, _, rows) = up(&t, &o, 1_000).unwrap();
        assert_eq!(status["on"], true);
        assert!(status["repo"].as_str().is_some(), "auto is scoped to the project");
        assert!(root.join(".claude/loop.md").is_file());
        let states: Vec<_> = rows.iter().map(|r| (r.name.as_str(), r.model.as_str(), r.state.split(' ').next().unwrap())).collect();
        assert_eq!(states, [("lead", "opus", "đang"), ("dev", "sonnet", "mở"), ("qa", "haiku", "chạy")]);
        let calls = fake.calls.borrow();
        let bg: Vec<_> = calls.iter().filter(|c| c.iter().any(|a| a == "--bg")).collect();
        assert_eq!(bg.len(), 2, "lead is live: no second session");
        assert_eq!(&bg[0][..7], ["--bg", "--name", "dev", "--permission-mode", "auto", "--model", "sonnet"]);
        assert!(bg[0][7].starts_with("/goal Phòng `dev`"), "a lane room opens on /goal: {}", bg[0][7]);
        assert!(bg[0][7].contains("8sync-auto-loop dev (vai Dev/Builder)"), "{}", bg[0][7]);
        assert_eq!(&bg[1][..3], ["--resume", qa.conversation_id.as_str(), "--bg"]);
        let reg = store.load();
        let id_of = |n: &str| reg.sessions.iter().find(|s| s.name == n).unwrap().conversation_id.clone();
        assert_eq!(id_of("dev"), DEV_BG, "registry follows the id Claude Code picked");
        assert_eq!(id_of("lead"), lead.conversation_id);
        assert_eq!(id_of("qa"), qa.conversation_id);
        let _ = std::fs::remove_dir_all(&h);
    }

    #[test]
    fn up_stops_on_an_untrusted_workspace_and_down_stops_only_background_rooms() {
        let (h, root) = tmp("trust");
        let store = Store::new(&h.join("cfg"), &root, "claude-sessions", "ccc .");
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec!["[]".into()]), bg: "Workspace not trusted. Run `claude` in C:\\proj once and accept the trust prompt".into() };
        let t = Team { home: &h, root: &root, store: &store, subscription: false, claude: &fake, has_transcript: &|_: &str| false, title: &|n: &str| n.to_string() };
        let o = Opts { roles: vec!["dev".into(), "qa".into()], every: 10, hours: 2.0, rate: None, clear: false };
        let e = up(&t, &o, 1).unwrap_err().to_string();
        assert!(e.contains("chưa trust") && e.contains("8sync ccc auto up"), "{e}");
        assert_eq!(fake.calls.borrow().iter().filter(|c| c.iter().any(|a| a == "--bg")).count(), 1, "stops at the first room");
        assert!(up(&t, &Opts { roles: vec!["../x".into()], every: 10, hours: 2.0, rate: None, clear: false }, 1).is_err());

        let dev = store.touch("dev", false).unwrap();
        let mine = store.touch("lead", false).unwrap();
        let other = "22222222-2222-4222-8222-222222222222";
        let list = format!("[{},{},{}]", agent(&dev.conversation_id, "dev", "background"), agent(&mine.conversation_id, "lead", "interactive"), agent(other, "x", "background"));
        let fake = Fake { calls: RefCell::new(vec![]), agents: RefCell::new(vec![list]), bg: String::new() };
        let t = Team { claude: &fake, ..t };
        assert_eq!(down(&t, 2).unwrap(), ["dev"]);
        let stops: Vec<_> = fake.calls.borrow().iter().filter(|c| c[0] == "stop").cloned().collect();
        assert_eq!(stops, [vec!["stop".to_string(), dev.conversation_id[..8].to_string()]]);
        assert_eq!(auto::status(&h, false, 3)["paused"], true);
        let _ = std::fs::remove_dir_all(&h);
    }
}
