//! `8sync ccc auto close [--dry-run] [--json]` (HQ's "Đóng dự án", owner 2026-10-21: "kill hẳn luôn
//! không phải ẩn"): stop everything of a project for real, in its root (the root `auto down` uses):
//! 1. what `auto down` does: the team rooms (`claude stop`), team omp, the project out of auto and
//!    team-roots. Auto is left alone when the project was never in it: `down` there pauses auto for
//!    every project;
//! 2. every other Claude Code session running in the repo or one of its worktrees (`claude agents
//!    --json`): `claude stop <id8>` for a background one, the process tree of an interactive one;
//! 3. the project's omp sessions: omp whose command line names a session dir of one of the project's
//!    8sync registries (`<config>/8sync/sessions/<key>/…`) or runs with `--cwd` in it — process tree,
//!    never omp's worker daemon broker (it serves other sessions);
//! 4. leftovers of any age: node / python / uv whose command line names the repo (dev and preview
//!    servers, vitest, tsserver, MCP servers) and browsers with `--user-data-dir` in it.
//!
//! A path in a repo nested inside the root is that repo's, never this project's. Never this process
//! or its ancestors, never HQ (`hq-ui`, `hq-channel`), never by image name: each pid alone
//! ([`reap::kill`]). Conversations and transcripts stay (`8sync . <name>`, `8sync ccc auto up`).
use std::path::{Path, PathBuf};

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::reap::{self, Proc};
use super::team::{self, Live, Team};
use super::{auto, omp_team};
use crate::env_detect::Env;
use crate::verbs::{session, session_view};

/// One thing `close` stops.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Item {
    /// Room or session name, `vite preview :4197`, `node server.js`.
    pub label: String,
    /// Its process, 0 when unknown.
    pub pid: u32,
    /// `claude stop <id8>` (a background Claude Code session); None: kill `pids`.
    pub stop: Option<String>,
    /// The process tree killed, `pid` first (empty for `stop`).
    pub pids: Vec<u32>,
    /// An omp session that is no team room: most likely the owner's own open terminal.
    pub own: bool,
}

/// What `close` stops in a project.
#[derive(Debug, Default, PartialEq)]
pub(super) struct Plan {
    /// Team rooms, as `auto down` stops them.
    pub rooms: Vec<Item>,
    /// Other Claude Code sessions.
    pub claude: Vec<Item>,
    pub omp: Vec<Item>,
    /// Leftover processes.
    pub procs: Vec<Item>,
    /// (what, why) left running.
    pub skipped: Vec<(String, String)>,
}

/// How a project's processes are told from the rest.
pub(super) struct Scope<'a> {
    rootn: String,
    fold: bool,
    /// Normalized session dirs of the project's 8sync registries.
    dirs: Vec<String>,
    /// The path sits in a repo nested inside the root (another project).
    nested: &'a dyn Fn(&Path) -> bool,
}

impl<'a> Scope<'a> {
    pub(super) fn new(root: &Path, dirs: &[PathBuf], nested: &'a dyn Fn(&Path) -> bool) -> Self {
        let r = root.to_string_lossy();
        let fold = reap::windows_path(&r);
        let dirs = dirs.iter().map(|d| reap::norm_root(&d.to_string_lossy())).filter(|d| !d.is_empty()).collect();
        Self { rootn: reap::norm_root(&r), fold, dirs, nested }
    }

    fn norm(&self, s: &str) -> String {
        reap::norm(s, self.fold)
    }

    /// `c` (normalized) names the root, or a path in it outside any nested repo.
    fn owns(&self, c: &str) -> bool {
        let r = self.rootn.as_str();
        !r.is_empty()
            && c.match_indices(r).any(|(i, _)| {
                if !matches!(c[..i].chars().next_back(), None | Some('"' | '\'' | ' ' | '=' | '\t')) {
                    return false;
                }
                let rest = &c[i + r.len()..];
                match rest.chars().next() {
                    None | Some('"' | '\'' | ' ' | '\t') => true,
                    Some('/') => !(self.nested)(Path::new(&format!("{r}{}", rest.split(['"', '\'', ' ', '\t']).next().unwrap_or("")))),
                    _ => false,
                }
            })
    }

    /// The omp session `c` (normalized) runs: the dir under one of the project's registries
    /// (`omp-lead`, `core`), `omp` for the registry dir itself or a `--cwd` in the project.
    fn omp_session(&self, c: &str, args: &[String]) -> Option<String> {
        for d in &self.dirs {
            for (i, _) in c.match_indices(d.as_str()) {
                if !matches!(c[..i].chars().next_back(), None | Some('"' | '\'' | ' ' | '=' | '\t')) {
                    continue;
                }
                let rest = &c[i + d.len()..];
                match rest.chars().next() {
                    None | Some('"' | '\'' | ' ' | '\t') => return Some("omp".into()),
                    Some('/') => {
                        let name = rest[1..].split(['/', '"', '\'', ' ', '\t']).next().unwrap_or("");
                        return Some(if name.is_empty() { "omp".into() } else { name.to_string() });
                    }
                    _ => {}
                }
            }
        }
        let cwd = args.iter().enumerate().find_map(|(i, a)| a.strip_prefix("--cwd=").map(str::to_string).or_else(|| (a == "--cwd").then(|| args.get(i + 1).cloned()).flatten()))?;
        self.owns(&self.norm(&cwd)).then(|| "omp".into())
    }

    /// `pid` and its descendants, never `keep`, HQ or omp's worker daemon broker (nor below them).
    fn tree(&self, procs: &[Proc], pid: u32, keep: &[u32]) -> Vec<u32> {
        reap::descendants(procs, pid, &|q| keep.contains(&q.pid) || reap::is_hq(&self.norm(&q.cmd)) || q.cmd.contains("__omp_worker_daemon"))
    }
}

/// A command line split into arguments (`CommandLineToArgvW` rules on Windows).
fn args_of(cmd: &str) -> Vec<String> {
    if cfg!(windows) {
        session_view::win_args(cmd)
    } else {
        cmd.split_whitespace().map(str::to_string).collect()
    }
}

fn is_omp(p: &Proc) -> bool {
    p.image == "omp" || args_of(&p.cmd).iter().take(3).any(|a| matches!(a.rsplit(['/', '\\']).next().unwrap_or(a).to_ascii_lowercase().as_str(), "omp" | "omp.exe" | "omp.js"))
}

/// node, python, uv: what dev servers, test runners, language and MCP servers run on.
fn is_runtime(image: &str) -> bool {
    matches!(image, "node" | "uv" | "uvx") || image.starts_with("python")
}

fn is_browser(image: &str) -> bool {
    matches!(image, "chrome" | "msedge" | "chromium" | "chromium-browser" | "chrome-headless-shell" | "headless_shell" | "brave")
}

/// The `--user-data-dir=` value of a (normalized) browser command line.
fn profile(c: &str) -> Option<&str> {
    let v = &c[c.find("--user-data-dir=")? + "--user-data-dir=".len()..];
    Some(match v.strip_prefix('"') {
        Some(q) => q.split('"').next().unwrap_or(""),
        None => v.split([' ', '\t']).next().unwrap_or(""),
    })
}

/// `vite preview :4197`, `node tsserver.js`, `python serve.py`, `msedge (hồ sơ trong dự án)`.
fn describe(p: &Proc) -> String {
    if is_browser(&p.image) {
        return format!("{} (hồ sơ trình duyệt trong dự án)", p.image);
    }
    let port = reap::port(&p.cmd).map(|x| format!(" :{x}")).unwrap_or_default();
    let what = reap::kind(&p.cmd).unwrap_or_else(|| {
        let args = args_of(&p.cmd);
        let script = args.iter().skip(1).find(|a| !a.starts_with('-')).map(|a| a.rsplit(['/', '\\']).next().unwrap_or(a).to_string());
        script.map_or_else(|| p.image.clone(), |s| format!("{} {s}", p.image))
    });
    format!("{what}{port}")
}

/// What `close` stops for `live` sessions (rooms by `room_ids`) and `procs`; `me` and its ancestors
/// are never taken.
pub(super) fn plan(s: &Scope, procs: &[Proc], live: &[Live], rooms: &[(String, &Live)], me: u32) -> Plan {
    let keep = reap::lineage(procs, me);
    let mut out = Plan { rooms: rooms.iter().map(|(n, l)| room_item(n, l)).collect(), ..Plan::default() };
    for l in live {
        if l.cwd.is_empty() || rooms.iter().any(|(_, r)| r.id == l.id) || !s.owns(&s.norm(&l.cwd)) {
            continue;
        }
        let label = team::short_name(&l.name);
        if l.pid != 0 && keep.contains(&l.pid) {
            out.skipped.push((label, "phiên đang chạy lệnh này".into()));
        } else if l.background {
            out.claude.push(Item { label, pid: l.pid, stop: Some(l.id.chars().take(8).collect()), pids: Vec::new(), own: false });
        } else if l.pid == 0 {
            out.skipped.push((label, "Claude Code không cho biết pid".into()));
        } else if procs.iter().any(|q| q.pid == l.pid && (q.image == "claude" || q.cmd.to_ascii_lowercase().contains("claude"))) {
            out.claude.push(Item { label, pid: l.pid, stop: None, pids: s.tree(procs, l.pid, &keep), own: false });
        } else {
            // Gone, or the pid now names another program: never killed on Claude Code's word.
            out.skipped.push((label, "pid không còn là Claude Code".into()));
        }
    }
    for p in procs {
        if p.started == 0 || !is_omp(p) || p.cmd.contains("__omp_worker") {
            continue;
        }
        let Some(name) = s.omp_session(&s.norm(&p.cmd), &args_of(&p.cmd)) else { continue };
        if keep.contains(&p.pid) {
            out.skipped.push((name, "phiên đang chạy lệnh này".into()));
            continue;
        }
        let own = omp_team::role_of(&name).is_none();
        out.omp.push(Item { label: name, pid: p.pid, stop: None, pids: s.tree(procs, p.pid, &keep), own });
    }
    let taken: Vec<u32> = out.claude.iter().chain(&out.omp).flat_map(|i| i.pids.iter().copied()).collect();
    out.procs = leftovers(s, procs, &keep, &taken);
    out
}

fn room_item(name: &str, l: &Live) -> Item {
    Item { label: name.to_string(), pid: l.pid, stop: Some(l.id.chars().take(8).collect()), pids: Vec::new(), own: false }
}

/// node / python / uv naming the project and browsers with a profile in it, one per tree (a match
/// under another goes with that one's tree); never `keep` or `taken`, never a process with no start time.
pub(super) fn leftovers(s: &Scope, procs: &[Proc], keep: &[u32], taken: &[u32]) -> Vec<Item> {
    let hits: Vec<&Proc> = procs
        .iter()
        .filter(|p| p.started != 0 && !keep.contains(&p.pid) && !taken.contains(&p.pid))
        .filter(|p| {
            let c = s.norm(&p.cmd);
            !c.is_empty() && !reap::is_hq(&c) && (is_runtime(&p.image) && s.owns(&c) || is_browser(&p.image) && profile(&c).is_some_and(|v| s.owns(v)))
        })
        .collect();
    let trees: Vec<Vec<u32>> = hits.iter().map(|p| s.tree(procs, p.pid, keep).into_iter().filter(|q| !taken.contains(q)).collect()).collect();
    hits.iter()
        .zip(&trees)
        .filter(|(p, _)| !trees.iter().any(|t| t[0] != p.pid && t.contains(&p.pid)))
        .map(|(p, t)| Item { label: describe(p), pid: p.pid, stop: None, pids: t.clone(), own: false })
        .collect()
}

/// The project's 8sync session registries: its own key dir, plus every registry whose recorded root
/// lies in the project (`8sync .` in a subfolder with its own package.json keys it apart).
pub(super) fn session_dirs(base: &Path, own: &Path, s: &Scope) -> Vec<PathBuf> {
    let mut out = vec![own.to_path_buf()];
    for e in std::fs::read_dir(base).into_iter().flatten().flatten() {
        let d = e.path();
        if d == own {
            continue;
        }
        let root = std::fs::read_to_string(d.join("index.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v["root"].as_str().map(str::to_string));
        if root.is_some_and(|r| s.owns(&s.norm(&r))) {
            out.push(d);
        }
    }
    out
}

/// `p` lies in a git repo nested inside `root` (that repo is its own project).
fn in_nested_repo(root: &Path, p: &Path) -> bool {
    crate::verbs::here::repo_of(p).is_some_and(|r| {
        let (r, root) = (auto::canon(&r), auto::canon(root));
        r != root && r.starts_with(&root)
    })
}

/// The project ever was in auto: listed (on or paused) or a team root.
fn in_auto(home: &Path, root: &Path) -> bool {
    let r = auto::canon(root);
    auto::remembered_roots(home).into_iter().chain(team::team_roots(home)).any(|x| auto::canon(Path::new(x.trim_start_matches(r"\\?\"))) == r)
}

/// `claude stop` / kill, then whether it went through.
fn stop(t: &Team, i: &Item) -> bool {
    match &i.stop {
        Some(id) => t.claude.run(&["stop".into(), id.clone()]).is_ok(),
        None => reap::kill(&i.pids).first().copied().unwrap_or(false),
    }
}

pub(super) fn run(env: &Env, t: &Team, rest: &[String], now: u64) -> Result<()> {
    let (mut dry, mut as_json) = (false, false);
    for a in rest {
        match a.as_str() {
            "--dry-run" => dry = true,
            "--json" => as_json = true,
            x => bail!("không rõ `{x}`\n{}", team::USAGE),
        }
    }
    let root = PathBuf::from(t.root.to_string_lossy().trim_start_matches(r"\\?\"));
    let nested = |p: &Path| in_nested_repo(&root, p);
    let base = env.xdg_config.join("8sync").join("sessions");
    let dirs = session_dirs(&base, &session::key_dir(env, &root), &Scope::new(&root, &[], &nested));
    let s = Scope::new(&root, &dirs, &nested);
    let me = std::process::id();
    let all = |t: &Team| -> Result<Vec<Live>> { team::live(&t.claude.run(&["agents".into(), "--json".into()])?) };
    if dry {
        let here = team::agents(t, false)?;
        let rooms = team::rooms(t, &here);
        let p = plan(&s, &reap::list(now), &all(t)?, &rooms, me);
        return report(&root, &p, None, None, as_json);
    }
    // A project in auto: no `auto revive` reopens a room while this runs (one waits up to 20 s),
    // and the next one skips it. A project never in auto has nothing revive would touch.
    let left = in_auto(&env.home, &root);
    let mut lock = None;
    if left {
        for n in 0..=20 {
            lock = team::revive_lock(&env.home, now)?;
            if lock.is_some() || n == 20 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        auto::leave(&env.home, t.root, t.subscription, now)?;
        team::set_team_root(&env.home, t.root, false);
    }
    // `auto down` first: the team rooms, then team omp.
    let here = team::agents(t, false)?;
    let rooms = team::rooms(t, &here);
    let mut done: Vec<Done> = Vec::new();
    for (i, (name, l)) in rooms.iter().enumerate() {
        done.push(("rooms", i, stop(t, &room_item(name, l)), l.pid));
    }
    let omp_down = omp_team::down(env, t.root)?;
    let mut p = plan(&s, &reap::list(now), &all(t)?, &rooms, me);
    for (kind, items) in [("claude", &p.claude), ("omp", &p.omp)] {
        for (i, x) in items.iter().enumerate() {
            done.push((kind, i, stop(t, x), x.pid));
        }
    }
    // What the stopped sessions left behind, read again once they are gone.
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let procs = reap::list(now);
    // A kill that failed because the process had already gone (its parent took it) went through.
    for d in done.iter_mut().filter(|d| !d.2 && d.3 != 0 && d.0 != "rooms") {
        d.2 = !procs.iter().any(|q| q.pid == d.3);
    }
    p.procs = leftovers(&s, &procs, &reap::lineage(&procs, me), &[]);
    for (i, x) in p.procs.iter().enumerate() {
        done.push(("procs", i, stop(t, x), x.pid));
    }
    drop(lock);
    report(&root, &p, Some((done.as_slice(), omp_down.stopped.as_slice())), Some(left), as_json)?;
    let failed: Vec<String> = done
        .iter()
        .filter(|d| !d.2)
        .filter_map(|d| match d.0 {
            "rooms" => p.rooms.get(d.1),
            "claude" => p.claude.get(d.1),
            "omp" => p.omp.get(d.1),
            _ => p.procs.get(d.1),
        })
        .map(|i| format!("{} (pid {})", i.label, i.pid))
        .collect();
    if !failed.is_empty() {
        bail!("không dừng được: {}", failed.join(", "));
    }
    Ok(())
}

/// (kind, index in the plan's list of that kind, went through, pid).
type Done = (&'static str, usize, bool, u32);

fn item_json(i: &Item, ok: Option<bool>) -> Value {
    let mut v = json!({ "label": i.label, "pid": i.pid, "kind": if i.stop.is_some() { "background" } else { "process" }, "pids": i.pids, "own": i.own });
    if let Some(ok) = ok {
        v["ok"] = json!(ok);
    }
    v
}

/// The plan (dry run) or what was done: `--json` for HQ, else a summary per kind.
fn report(root: &Path, p: &Plan, done: Option<(&[Done], &[String])>, left: Option<bool>, as_json: bool) -> Result<()> {
    let ok = |kind: &str, i: usize| done.map(|(d, _)| d.iter().any(|x| x.0 == kind && x.1 == i && x.2));
    let omp_team_rooms: &[String] = done.map_or(&[], |(_, o)| o);
    let list = |kind: &'static str, items: &[Item]| -> Vec<Value> { items.iter().enumerate().map(|(n, i)| item_json(i, ok(kind, n))).collect() };
    let v = json!({
        "root": root,
        "dry_run": done.is_none(),
        "rooms": list("rooms", &p.rooms),
        "claude": list("claude", &p.claude),
        "omp": list("omp", &p.omp),
        "omp_rooms": omp_team_rooms,
        "procs": list("procs", &p.procs),
        "skipped": p.skipped.iter().map(|(l, w)| json!({ "label": l, "why": w })).collect::<Vec<_>>(),
        "counts": counts(p, omp_team_rooms.len()),
        "auto": left.map(|l| if l { "left" } else { "untouched" }),
        "ok": done.is_none_or(|(d, _)| d.iter().all(|x| x.2)),
    });
    if as_json {
        println!("{}", serde_json::to_string(&v)?);
        return Ok(());
    }
    print!("{}", text(root, p, &v));
    Ok(())
}

pub(super) fn counts(p: &Plan, omp_team_rooms: usize) -> Value {
    json!({ "rooms": p.rooms.len(), "claude": p.claude.len(), "omp": p.omp.len() + omp_team_rooms, "procs": p.procs.len() })
}

fn text(root: &Path, p: &Plan, v: &Value) -> String {
    let dry = v["dry_run"] == true;
    let mut out = if dry { format!("Đóng dự án {} — chạy thử, chưa dừng gì:\n", root.display()) } else { format!("Đã đóng dự án {}:\n", root.display()) };
    let row = |items: &Value, what: &str, out: &mut String| {
        let a = items.as_array().map(Vec::as_slice).unwrap_or_default();
        if a.is_empty() {
            out.push_str(&format!("  {what}: 0\n"));
            return;
        }
        let names: Vec<String> = a
            .iter()
            .map(|i| {
                let mut s = i["label"].as_str().unwrap_or_default().to_string();
                if i["pid"].as_u64().is_some_and(|x| x > 0) {
                    s.push_str(&format!(" (pid {})", i["pid"]));
                }
                if i["own"] == true {
                    s.push_str(" — phiên terminal của anh");
                }
                if i["ok"] == false {
                    s.push_str(" — KHÔNG dừng được");
                }
                s
            })
            .collect();
        out.push_str(&format!("  {what}: {} — {}\n", a.len(), names.join(", ")));
    };
    row(&v["rooms"], "phòng team", &mut out);
    row(&v["claude"], "session Claude Code khác", &mut out);
    row(&v["omp"], "phiên omp", &mut out);
    if let Some(o) = v["omp_rooms"].as_array().filter(|a| !a.is_empty()) {
        out.push_str(&format!("  phòng omp của team (auto down): {}\n", o.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(", ")));
    }
    row(&v["procs"], "tiến trình sót", &mut out);
    for (l, w) in &p.skipped {
        out.push_str(&format!("  bỏ qua {l}: {w}\n"));
    }
    match v["auto"].as_str() {
        Some("left") => out.push_str("auto: đã bỏ dự án khỏi auto và khỏi danh sách team.\n"),
        Some(_) => out.push_str("auto: không đổi (dự án không có trong auto).\n"),
        None => {}
    }
    out.push_str("Hội thoại giữ nguyên: mở lại bằng `8sync . <tên>` / `8sync ccc auto up`.\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_000_000;

    fn node(pid: u32, ppid: u32, cmd: &str) -> Proc {
        Proc { pid, ppid, started: NOW - 600, rss: 0, node: true, shell: false, image: "node".into(), cmd: cmd.into() }
    }

    fn img(image: &str, pid: u32, ppid: u32, cmd: &str) -> Proc {
        Proc { node: false, image: image.into(), ..node(pid, ppid, cmd) }
    }

    fn live(id: &str, name: &str, background: bool, cwd: &str, pid: u32) -> Live {
        Live { id: id.into(), name: name.into(), background, started: 0, busy: false, cwd: cwd.into(), pid }
    }

    const CFG: &str = r"C:\Users\a\AppData\Roaming\8sync\sessions";

    /// `C:\w\game` with a nested repo `C:\w\game\sub`; `C:\w\game-2` and `C:\w\other` are other projects.
    fn nested(p: &Path) -> bool {
        p.to_string_lossy().starts_with("c:/w/game/sub")
    }

    #[test]
    fn takes_only_the_projects_sessions_and_processes() {
        let root = PathBuf::from(r"C:\w\game");
        let dirs = [PathBuf::from(format!(r"{CFG}\C--w-game")), PathBuf::from(format!(r"{CFG}\C--w-game-apps-web"))];
        let s = Scope::new(&root, &dirs, &nested);
        let procs = vec![
            // me (8sync close) under the owner's interactive Claude Code in the repo (pid 3).
            img("8sync", 2, 3, r"8sync ccc auto close"),
            img("claude", 3, 1, "claude"),
            // A dev server in a room worktree with its node child; vitest; a python server; uv.
            node(100, 1, r#""C:\Program Files\nodejs\node.exe" C:\w\game\.claude\worktrees\card-1\node_modules\vite\bin\vite.js preview --port 4120"#),
            node(101, 100, r"node C:\w\game\.claude\worktrees\card-1\node_modules\esbuild\worker.js"),
            node(102, 1, r"node C:\W\GAME\node_modules\vitest\vitest.mjs run"),
            img("python3", 103, 1, r"python C:\w\game\tools\serve.py --port 8000"),
            img("uv", 104, 1, r"uv run --project C:\w\game pytest"),
            // Another project sharing the prefix, a nested repo, HQ inside the repo: untouched.
            node(105, 1, r"node C:\w\game-2\node_modules\vite\bin\vite.js"),
            node(106, 1, r"node C:\w\game\sub\node_modules\vite\bin\vite.js"),
            node(107, 1, r"node C:\w\game\apps\hq-ui\server.js"),
            // A headless browser with its profile in the repo, and its renderer; the owner's Edge
            // with a page of the repo open: untouched.
            img("msedge", 108, 1, r#"msedge.exe --headless --user-data-dir="C:\w\game\.cache\profile" about:blank"#),
            img("msedge", 109, 108, r#"msedge.exe --type=renderer --user-data-dir="C:\w\game\.cache\profile""#),
            img("msedge", 110, 1, r"msedge.exe --user-data-dir=C:\Users\a\Edge file:///C:/w/game/index.html"),
            // No start time; a shell naming the repo: untouched.
            Proc { started: 0, ..node(111, 1, r"node C:\w\game\x.js") },
            img("cmd", 112, 1, r"cmd /c cd C:\w\game"),
            // omp: the owner's session of this repo (MCP child; the worker broker it started and the
            // broker's child serve other sessions), a team room, a session of the sibling project, a
            // session of the subfolder registry, one by --cwd, and a lone broker.
            img("omp", 200, 1, &format!(r#""C:\Users\a\AppData\Local\omp\omp.exe" --resume {CFG}\C--w-game\core\2"#)),
            img("headroom", 201, 200, "headroom mcp serve"),
            img("omp", 202, 200, r"C:\Users\a\AppData\Local\omp\omp.exe __omp_worker_daemon_broker"),
            img("bash", 203, 202, "bash -c ls"),
            img("omp", 204, 1, &format!(r"omp --session-dir {CFG}\C--w-game\omp-lead")),
            img("omp", 205, 1, &format!(r"omp --resume {CFG}\C--w-game-2\core\1")),
            img("omp", 206, 1, &format!(r"omp --session-dir {CFG}\C--w-game-apps-web\web")),
            img("omp", 207, 1, &format!(r"omp --cwd C:\w\game\.claude\worktrees\card-2 --session-dir {CFG}\C--Users-a-tmp\s")),
            img("omp", 208, 1, r"omp --cwd C:\w\game\sub --session-dir x"),
            // An interactive Claude Code session in a worktree with a node child naming the repo.
            img("claude", 300, 1, "claude"),
            node(301, 300, r"node C:\w\game\node_modules\typescript\lib\tsserver.js"),
        ];
        let lead = live("aaaaaaaa-0000-4000-8000-000000000001", "lead", true, r"C:\w\game", 400);
        let sessions = vec![
            lead.clone(),
            live("bbbbbbbb-0000-4000-8000-000000000002", "notes", true, r"C:\w\game", 401),
            live("cccccccc-0000-4000-8000-000000000003", "core", false, r"C:\w\game\.claude\worktrees\card-1", 300),
            live("dddddddd-0000-4000-8000-000000000004", "x", false, r"C:\w\game-2", 402),
            live("eeeeeeee-0000-4000-8000-000000000005", "y", false, r"C:\w\game\sub", 403),
            live("ffffffff-0000-4000-8000-000000000006", "me", false, r"c:/W/game", 3),
            live("abababab-0000-4000-8000-000000000007", "nopid", false, r"C:\w\game", 0),
            // Its pid now names another program (reused): never killed.
            live("acacacac-0000-4000-8000-000000000008", "stale", false, r"C:\w\game", 112),
        ];
        let p = plan(&s, &procs, &sessions, &[("lead".into(), &lead)], 2);
        assert_eq!(p.rooms.iter().map(|i| (i.label.as_str(), i.stop.as_deref())).collect::<Vec<_>>(), [("lead", Some("aaaaaaaa"))]);
        let claude: Vec<_> = p.claude.iter().map(|i| (i.label.as_str(), i.stop.as_deref(), i.pids.clone())).collect();
        assert_eq!(claude, [("notes", Some("bbbbbbbb"), vec![]), ("core", None, vec![300, 301])]);
        let omp: Vec<_> = p.omp.iter().map(|i| (i.label.as_str(), i.own, i.pids.clone())).collect();
        assert_eq!(omp, [("core", true, vec![200, 201]), ("omp-lead", false, vec![204]), ("web", true, vec![206]), ("omp", true, vec![207])]);
        let procs_hit: Vec<_> = p.procs.iter().map(|i| (i.pid, i.pids.clone())).collect();
        assert_eq!(procs_hit, [(100, vec![100, 101]), (102, vec![102]), (103, vec![103]), (104, vec![104]), (108, vec![108, 109])]);
        assert_eq!(p.procs[0].label, "vite preview :4120");
        assert_eq!(p.procs[2].label, "python3 serve.py :8000");
        assert_eq!(
            p.skipped,
            [
                ("me".to_string(), "phiên đang chạy lệnh này".to_string()),
                ("nopid".into(), "Claude Code không cho biết pid".into()),
                ("stale".into(), "pid không còn là Claude Code".into())
            ]
        );
        assert_eq!(counts(&p, 0), json!({ "rooms": 1, "claude": 2, "omp": 4, "procs": 5 }));
    }

    #[test]
    fn unix_paths_keep_their_case_and_a_root_must_be_a_whole_path() {
        let root = PathBuf::from("/home/dev/game");
        let s = Scope::new(&root, &[PathBuf::from("/home/dev/.config/8sync/sessions/-home-dev-game")], &nested);
        assert!(s.owns("node /home/dev/game/x.js"));
        assert!(s.owns("uv run --directory=/home/dev/game"));
        assert!(!s.owns("node /home/dev/Game/x.js"));
        assert!(!s.owns("node /home/dev/game2/x.js"));
        assert!(!s.owns("node /x/home/dev/game/x.js"));
        assert_eq!(s.omp_session("omp --session-dir /home/dev/.config/8sync/sessions/-home-dev-game/omp-qa", &[]).as_deref(), Some("omp-qa"));
        assert_eq!(s.omp_session("omp --session-dir /home/dev/.config/8sync/sessions/-home-dev-game-2/qa", &[]), None);
        assert_eq!(profile("chrome --user-data-dir=/tmp/p --headless"), Some("/tmp/p"));
        assert_eq!(profile(r#"chrome --user-data-dir="/a b/p" x"#), Some("/a b/p"));
        assert_eq!(profile("chrome --headless"), None);
    }

    #[test]
    fn registries_of_a_subfolder_count_and_of_a_sibling_or_nested_repo_do_not() {
        let base = std::env::temp_dir().join(format!("8sync-close-reg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("proj");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("game/.git")).unwrap();
        let reg = base.join("sessions");
        let mk = |key: &str, r: Option<&Path>| {
            let d = reg.join(key);
            std::fs::create_dir_all(&d).unwrap();
            if let Some(r) = r {
                std::fs::write(d.join("index.json"), json!({ "sessions": [], "root": r }).to_string()).unwrap();
            }
            d
        };
        let own = mk("own", None);
        let web = mk("web", Some(&root.join("apps/web")));
        mk("sibling", Some(&base.join("proj-2")));
        mk("nested", Some(&root.join("game")));
        mk("plain", None);
        let n = |p: &Path| in_nested_repo(&root, p);
        let s = Scope::new(&root, &[], &n);
        let mut got = session_dirs(&reg, &own, &s);
        got.sort();
        let mut want = vec![own, web];
        want.sort();
        assert_eq!(got, want);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_report_names_what_stops() {
        let root = PathBuf::from(r"C:\w\game");
        let p = Plan {
            rooms: vec![Item { label: "lead".into(), pid: 1, stop: Some("aaaaaaaa".into()), pids: vec![], own: false }],
            omp: vec![Item { label: "core".into(), pid: 7, stop: None, pids: vec![7], own: true }],
            procs: vec![Item { label: "vite preview :4120".into(), pid: 9, stop: None, pids: vec![9], own: false }],
            ..Plan::default()
        };
        let v = json!({ "dry_run": true, "rooms": [item_json(&p.rooms[0], None)], "claude": [], "omp": [item_json(&p.omp[0], None)], "omp_rooms": [], "procs": [item_json(&p.procs[0], Some(false))], "auto": null });
        let t = text(&root, &p, &v);
        assert!(t.contains("chạy thử, chưa dừng gì"), "{t}");
        assert!(t.contains("phòng team: 1 — lead (pid 1)"), "{t}");
        assert!(t.contains("session Claude Code khác: 0"), "{t}");
        assert!(t.contains("core (pid 7) — phiên terminal của anh"), "{t}");
        assert!(t.contains("vite preview :4120 (pid 9) — KHÔNG dừng được"), "{t}");
        assert!(t.contains("Hội thoại giữ nguyên"), "{t}");
    }
}
