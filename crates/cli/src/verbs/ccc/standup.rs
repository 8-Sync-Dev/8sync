//! `8sync ccc standup <slug> …` — scrum board so no role sits idle.
//! Board: `ship_dir/<slug>/SPRINT.md` (human-editable markdown table); log: `STANDUP.md` beside it.

use anyhow::{bail, Context, Result};
use serde_json::json;
use std::path::{Path, PathBuf};

use super::looper::ship_dir;

pub(super) const ROSTER: [&str; 7] = ["rd", "plan", "dev", "review", "qa", "quick", "critic"];
const STATUSES: [&str; 5] = ["todo", "doing", "blocked", "done", "rest"];
const ITEM_MAX: usize = 100;
const MAX_PEERS: usize = 5;
const MAX_PEER_FILES: usize = 3;

/// Another session of the same repo, supplied by the caller.
pub(super) struct Peer {
    pub name: String,
    pub goal: Option<String>,
    pub files: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct Row {
    role: String,
    agent: String,
    status: String,
    item: String,
    files: Vec<String>,
    /// Row whose status is not valid: the (sanitised) line, kept verbatim.
    raw: Option<String>,
}

#[derive(Debug, Default, PartialEq)]
struct Board {
    /// Prose lines before / after the table, preserved in order.
    pre: Vec<String>,
    rows: Vec<Row>,
    post: Vec<String>,
}

impl Board {
    fn get(&self, role: &str) -> Option<&Row> {
        self.rows.iter().find(|r| r.role == role)
    }
}

fn dir(cwd: &Path, slug: &str) -> Result<PathBuf> {
    if slug.is_empty() || slug.starts_with('.') || !slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        bail!("bad slug {slug:?}: use letters, digits, - _ .");
    }
    Ok(ship_dir(cwd).join(slug))
}

/// One table cell: sanitised by `goal::clean` (control/format chars, secrets, clip), `|` → `/`.
fn clean_cell(s: &str, max: usize) -> String {
    super::goal::clean(s, max).replace('|', "/").trim().to_string()
}

fn clean_prose(l: &str) -> String {
    if l.trim().is_empty() {
        String::new()
    } else {
        super::goal::clean(l, 2000)
    }
}

fn split_files(s: &str) -> Vec<String> {
    s.split(',').map(|f| clean_cell(f, 200)).filter(|f| !f.is_empty()).collect()
}

fn parse(text: &str) -> Board {
    let (mut pre, mut post, mut rows) = (Vec::new(), Vec::new(), Vec::new());
    let mut seen_table = false;
    for line in text.lines() {
        let l = line.trim();
        let prose = |pre: &mut Vec<String>, post: &mut Vec<String>, seen: bool| {
            let p = clean_prose(l);
            if seen { post.push(p) } else { pre.push(p) }
        };
        if !l.starts_with('|') {
            if !l.starts_with("# Sprint board:") {
                prose(&mut pre, &mut post, seen_table);
            }
            continue;
        }
        let mut cells: Vec<&str> = l.split('|').map(str::trim).collect();
        cells.remove(0); // before the leading pipe
        if cells.last() == Some(&"") {
            cells.pop();
        }
        if cells.len() < 3 {
            prose(&mut pre, &mut post, seen_table);
            continue;
        }
        seen_table = true;
        let role = clean_cell(cells[0], 40).to_lowercase();
        let status = clean_cell(cells[2], 40).to_lowercase();
        if role == "role" || role.starts_with("---") {
            continue; // header / separator: regenerated
        }
        if role.is_empty() {
            continue;
        }
        let cell = |i: usize| cells.get(i).copied().unwrap_or("");
        let (agent, item) = (clean_cell(cell(1), 40), clean_cell(cell(3), ITEM_MAX));
        let valid = STATUSES.contains(&status.as_str());
        let raw = (!valid).then(|| format!("| {role} | {agent} | {status} | {item} | {} |", split_files(cell(4)).join(", ")));
        rows.push(Row { role, agent, status, item, files: split_files(cell(4)), raw });
    }
    while post.last().is_some_and(|p| p.is_empty()) {
        post.pop();
    }
    Board { pre, rows, post }
}

fn render(slug: &str, b: &Board) -> String {
    let mut s = format!("# Sprint board: {slug}\n");
    for l in &b.pre {
        s.push_str(l);
        s.push('\n');
    }
    s.push_str("| role | agent | status | item | files |\n|---|---|---|---|---|\n");
    for r in &b.rows {
        match &r.raw {
            Some(raw) => s.push_str(&format!("{raw}\n")),
            None => s.push_str(&format!("| {} | {} | {} | {} | {} |\n", r.role, r.agent, r.status, r.item, r.files.join(", "))),
        }
    }
    for l in &b.post {
        s.push_str(l);
        s.push('\n');
    }
    s
}

fn write_atomic(p: &Path, text: &str) -> Result<()> {
    std::fs::create_dir_all(p.parent().context("no parent")?)?;
    let tmp = p.with_file_name(format!("{}.tmp.{}", p.file_name().and_then(|n| n.to_str()).unwrap_or("board"), std::process::id()));
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

/// Run `f` holding an exclusive lock on `<dir>/SPRINT.md.lock` (released when the handle drops).
fn with_lock<T>(p: &Path, f: impl FnOnce() -> Result<T>) -> Result<T> {
    std::fs::create_dir_all(p.parent().context("no parent")?)?;
    let lock = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(p.with_file_name("SPRINT.md.lock")).context("open board lock")?;
    lock.lock().context("lock board")?;
    f()
}

fn load(p: &Path, slug: &str) -> Result<Board> {
    let s = std::fs::read_to_string(p).with_context(|| format!("no board at {} (run `8sync ccc standup {slug} init`)", p.display()))?;
    Ok(parse(&s))
}

fn is_idle(r: &Row) -> bool {
    r.status == "done" || r.item.trim().is_empty()
}

/// Idle is judged only over rows on the board whose role is in ROSTER (roster order).
fn idle_roles(b: &Board) -> Vec<String> {
    ROSTER.iter().filter(|r| b.get(r).is_some_and(|row| row.raw.is_none() && is_idle(row))).map(|r| r.to_string()).collect()
}

fn norm_path(p: &str, fold_case: bool) -> String {
    let mut s = p.trim().replace('\\', "/");
    while let Some(r) = s.strip_prefix("./") {
        s = r.to_string();
    }
    let s = s.trim_end_matches('/').to_string();
    if fold_case { s.to_lowercase() } else { s }
}

fn overlaps_with(a: &str, b: &str, fold_case: bool) -> bool {
    let (a, b) = (norm_path(a, fold_case), norm_path(b, fold_case));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    a == b
        || a.ends_with(&format!("/{b}"))
        || b.ends_with(&format!("/{a}"))
        || a.starts_with(&format!("{b}/"))
        || b.starts_with(&format!("{a}/"))
}

fn overlaps(a: &str, b: &str) -> bool {
    overlaps_with(a, b, cfg!(any(windows, target_os = "macos")))
}

/// (role, file, peer) for every active row file also touched by a peer (a peer that owns the row is skipped).
fn conflicts(b: &Board, peers: &[Peer]) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    for r in b.rows.iter().filter(|r| matches!(r.status.as_str(), "doing" | "blocked" | "todo")) {
        for f in &r.files {
            for p in peers.iter().filter(|p| r.agent.is_empty() || p.name != r.agent) {
                if p.files.iter().any(|pf| overlaps(f, pf)) {
                    let c = (r.role.clone(), f.clone(), p.name.clone());
                    if !out.contains(&c) {
                        out.push(c);
                    }
                }
            }
        }
    }
    out
}

fn report(slug: &str, b: &Board, peers: &[Peer]) -> (String, Vec<String>) {
    let mut s = format!("Standup: {slug}\n");
    for st in ["doing", "blocked", "todo", "rest", "done"] {
        for r in b.rows.iter().filter(|r| r.status == st) {
            let agent = if r.agent.is_empty() { String::new() } else { format!(" ({})", r.agent) };
            let item = if r.item.is_empty() { "-" } else { &r.item };
            let files = if r.files.is_empty() { String::new() } else { format!(" · file: {}", r.files.join(", ")) };
            s.push_str(&format!("{st:<8}{}{agent}: {item}{files}\n", r.role));
        }
    }
    for r in b.rows.iter().filter(|r| r.raw.is_some()) {
        s.push_str(&format!("? {}: status '{}' không hợp lệ\n", r.role, r.status));
    }
    let idle = idle_roles(b);
    if !idle.is_empty() {
        s.push_str(&format!(
            "IDLE: {} — giao việc (8sync ccc standup {slug} set <role> doing <việc>) hoặc ghi rest <lý do>\n",
            idle.join(", ")
        ));
    }
    if !peers.is_empty() {
        s.push_str("Phòng khác:\n");
        for p in peers.iter().take(MAX_PEERS) {
            let goal = p.goal.as_deref().filter(|g| !g.trim().is_empty()).unwrap_or("(chưa đặt mục tiêu)");
            let files: Vec<&str> = p.files.iter().take(MAX_PEER_FILES).map(String::as_str).collect();
            s.push_str(&format!("- {}: {goal} · file: {}\n", p.name, files.join(", ")));
        }
    }
    for (_, file, peer) in conflicts(b, peers) {
        s.push_str(&format!("⚠ trùng file với {peer}: {file} — SendMessage cho {peer} trước khi sửa\n"));
    }
    (s, idle)
}

fn report_json(b: &Board, peers: &[Peer]) -> serde_json::Value {
    let roles: Vec<_> = b
        .rows
        .iter()
        .map(|r| json!({"role": r.role, "agent": r.agent, "status": r.status, "item": r.item, "files": r.files}))
        .collect();
    let peers_j: Vec<_> = peers.iter().take(MAX_PEERS).map(|p| json!({"name": p.name, "goal": p.goal, "files": p.files})).collect();
    let cf: Vec<_> = conflicts(b, peers).into_iter().map(|(role, file, peer)| json!({"role": role, "file": file, "peer": peer})).collect();
    json!({"roles": roles, "idle": idle_roles(b), "peers": peers_j, "conflicts": cf})
}

/// `YYYY-MM-DDTHH:MMZ` from epoch seconds (UTC, proleptic Gregorian; days→civil by H. Hinnant).
pub(super) fn utc_stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}Z", rem / 3600, rem % 3600 / 60)
}

fn append_log(p: &Path, slug: &str, b: &Board, idle: &[String], now: u64) -> Result<usize> {
    with_lock(p, || {
        let old = std::fs::read_to_string(p).unwrap_or_default();
        let n = old.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')).count() + 1;
        let k = |st: &str| b.rows.iter().filter(|r| r.status == st).count();
        let idle_s = if idle.is_empty() { "-".to_string() } else { idle.join(",") };
        let line = format!("{n} · {} · done {} · doing {} · blocked {} · idle {idle_s}\n", utc_stamp(now), k("done"), k("doing"), k("blocked"));
        let mut text = if old.is_empty() { format!("# Standups: {slug}\n") } else { old };
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&line);
        write_atomic(p, &text)?;
        Ok(n)
    })
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn empty_row(role: &str) -> Row {
    Row { role: role.to_string(), agent: String::new(), status: "todo".into(), item: String::new(), files: vec![], raw: None }
}

fn init(p: &Path, slug: &str, force: bool, roles: &[String]) -> Result<()> {
    for r in roles {
        if !ROSTER.contains(&r.as_str()) {
            bail!("unknown role '{r}' — roster: {}", ROSTER.join(", "));
        }
    }
    let mut rows: Vec<Row> = Vec::new();
    for r in roles {
        if !rows.iter().any(|x| x.role == *r) {
            rows.push(empty_row(r));
        }
    }
    with_lock(p, || {
        if p.exists() && !force {
            bail!("board exists at {} — use --force to overwrite", p.display());
        }
        write_atomic(p, &render(slug, &Board { rows, ..Default::default() }))
    })
}

fn set(p: &Path, slug: &str, args: &[String]) -> Result<()> {
    let usage = "usage: standup <slug> set <role> <status> [--agent <a>] [--files a,b] [item words…]";
    let (Some(role), Some(status)) = (args.first(), args.get(1)) else { bail!("{usage}") };
    let role = role.to_lowercase();
    let status = status.to_lowercase();
    if !ROSTER.contains(&role.as_str()) {
        bail!("unknown role '{role}' — roster: {}", ROSTER.join(", "));
    }
    if !STATUSES.contains(&status.as_str()) {
        bail!("bad status '{status}' — one of: {}", STATUSES.join("|"));
    }
    let (mut agent, mut files, mut words) = (None, None, Vec::new());
    let mut it = args[2..].iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--agent" => agent = Some(it.next().with_context(|| "--agent needs a value")?.clone()),
            "--files" => files = Some(it.next().with_context(|| "--files needs a value")?.clone()),
            _ => words.push(a.as_str()),
        }
    }
    let item_src = words.join(" ");
    let item_line = item_src.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let item = clean_cell(item_line, ITEM_MAX);
    with_lock(p, || {
        let mut b = if p.exists() { load(p, slug)? } else { Board::default() };
        if b.get(&role).is_none() {
            b.rows.push(empty_row(&role));
        }
        let r = b.rows.iter_mut().find(|r| r.role == role).expect("row just ensured");
        r.status = status;
        r.item = item;
        r.raw = None;
        if let Some(a) = agent {
            r.agent = clean_cell(&a, 40);
        }
        if let Some(f) = files {
            r.files = split_files(&f);
        }
        write_atomic(p, &render(slug, &b))
    })
}

/// Ok(true) = no idle role; Ok(false) = idle roles exist (the caller exits 3).
pub(super) fn run(args: &[String], cwd: &Path, peers: &[Peer]) -> Result<bool> {
    let Some(slug) = args.first().filter(|a| !a.starts_with("--")) else {
        bail!("usage: 8sync ccc standup <slug> [init [--force] [--roles a,b] | set <role> <status> … | --json]");
    };
    let d = dir(cwd, slug)?;
    let board = d.join("SPRINT.md");
    match args.get(1).map(String::as_str) {
        Some("init") => {
            let (mut force, mut roles) = (false, ROSTER.iter().map(|r| r.to_string()).collect::<Vec<_>>());
            let mut it = args[2..].iter();
            while let Some(a) = it.next() {
                match a.as_str() {
                    "--force" => force = true,
                    "--roles" => {
                        let v = it.next().with_context(|| "--roles needs a value (a,b,c)")?;
                        roles = v.split(',').map(|r| r.trim().to_lowercase()).filter(|r| !r.is_empty()).collect();
                        if roles.is_empty() {
                            bail!("--roles is empty — roster: {}", ROSTER.join(", "));
                        }
                    }
                    x => bail!("unknown init option '{x}' — --force | --roles a,b,c"),
                }
            }
            init(&board, slug, force, &roles)?;
            println!("{}", board.display());
            Ok(true)
        }
        Some("set") => {
            set(&board, slug, &args[2..])?;
            println!("{}", board.display());
            Ok(true)
        }
        rest => {
            let json_out = rest == Some("--json");
            if let Some(x) = rest.filter(|x| *x != "--json") {
                bail!("unknown standup subcommand '{x}' — init | set | --json");
            }
            let b = load(&board, slug)?;
            let (text, idle) = report(slug, &b, peers);
            if json_out {
                println!("{}", serde_json::to_string_pretty(&report_json(&b, peers))?);
            } else {
                if let Err(e) = append_log(&d.join("STANDUP.md"), slug, &b, &idle, now_secs()) {
                    eprintln!("8sync: cảnh báo — không ghi được STANDUP.md: {e:#}");
                }
                print!("{text}");
            }
            Ok(idle.is_empty())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-standup-{tag}-{}-{}", std::process::id(), crate::verbs::uuid_sessions::new_uuid()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }
    fn row(role: &str, status: &str, item: &str, files: &[&str]) -> Row {
        Row { role: role.into(), agent: String::new(), status: status.into(), item: item.into(), files: s(files), raw: None }
    }
    fn board(rows: Vec<Row>) -> Board {
        Board { rows, ..Default::default() }
    }
    fn peer(name: &str, files: &[&str]) -> Peer {
        Peer { name: name.into(), goal: None, files: s(files) }
    }
    fn all_roles() -> Vec<String> {
        ROSTER.iter().map(|r| r.to_string()).collect()
    }

    #[test]
    fn parse_write_round_trip_and_lenient() {
        let b = board(vec![Row { agent: "researcher".into(), ..row("rd", "doing", "đọc docs hooks", &["crates/x.rs", "docs/y.md"]) }, row("qa", "todo", "", &[])]);
        assert_eq!(parse(&render("demo", &b)), b);
        let messy = "# x\nprose\n|role|agent|status|item|files|\n|---|---|---|---|---|\n|  RD  |  a  |  Doing  |  việc  | f.rs |\n| ghost | | todo | gì đó |\n| qa | | weird | x |\n| dev | | done |\n";
        let p = parse(messy);
        assert_eq!(p.rows.len(), 4, "{:?}", p.rows);
        assert_eq!((p.rows[0].role.as_str(), p.rows[0].status.as_str(), p.rows[0].item.as_str()), ("rd", "doing", "việc"));
        assert_eq!(p.rows[1].role, "ghost");
        assert_eq!(p.rows[3].item, "");
        assert!(!idle_roles(&p).contains(&"rd".to_string()));
    }

    #[test]
    fn prose_and_unknown_status_survive_render() {
        let text = "# Sprint board: d\nghi chú đầu\n\n| role | agent | status | item | files |\n|---|---|---|---|---|\n| rd | | doing | x | |\n| qa | | weird | y | a.rs |\n\nghi chú cuối\nthêm\n";
        let b = parse(text);
        assert_eq!(b.pre, ["ghi chú đầu", ""]);
        assert_eq!(b.post, ["", "ghi chú cuối", "thêm"]);
        let out = render("d", &b);
        assert!(out.starts_with("# Sprint board: d\nghi chú đầu\n\n| role"), "{out}");
        assert!(out.ends_with("\nghi chú cuối\nthêm\n"), "{out}");
        assert!(out.contains("| qa |  | weird | y | a.rs |"), "{out}");
        assert_eq!(parse(&out), b);
        let (t, idle) = report("d", &b, &[]);
        assert!(t.contains("? qa: status 'weird' không hợp lệ"), "{t}");
        assert!(!idle.contains(&"qa".to_string()));
    }

    #[test]
    fn parse_sanitises_on_read() {
        let text = "| role | agent | status | item | files |\n|---|---|---|---|---|\n| rd | a\u{202e}b | doing | \u{1b}]0;x\u{7}evil\u{202e}gnp \u{200b}x | f\u{2066}.rs |\n";
        let (t, _) = report("d", &parse(text), &[]);
        for bad in ['\u{1b}', '\u{7}', '\u{202e}', '\u{200b}', '\u{2066}'] {
            assert!(!t.contains(bad), "{bad:?} in {t:?}");
        }
        assert!(t.contains("evil"), "{t}");
    }

    #[test]
    fn init_refuses_overwrite_without_force_and_roles() {
        let d = tmp("init");
        let p = d.join("a/SPRINT.md");
        init(&p, "a", false, &all_roles()).unwrap();
        let b = parse(&std::fs::read_to_string(&p).unwrap());
        assert_eq!(b.rows.len(), 7);
        assert!(b.rows.iter().all(|r| r.status == "todo" && r.item.is_empty()));
        assert!(init(&p, "a", false, &all_roles()).is_err());
        init(&p, "a", true, &s(&["dev", "review"])).unwrap();
        let b = load(&p, "a").unwrap();
        assert_eq!(b.rows.iter().map(|r| r.role.as_str()).collect::<Vec<_>>(), ["dev", "review"]);
        let e = init(&p, "a", true, &s(&["dev", "boss"])).unwrap_err().to_string();
        assert!(e.contains("boss") && e.contains("roster"), "{e}");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn set_upserts_validates_and_sanitises() {
        let d = tmp("set");
        let p = d.join("a/SPRINT.md");
        set(&p, "a", &s(&["rd", "doing", "--agent", "res|x", "--files", "a.rs, b|c.rs", "đọc", "A|B\u{1b}[2J"])).unwrap();
        let b = load(&p, "a").unwrap();
        let r = b.get("rd").unwrap();
        assert_eq!((r.agent.as_str(), r.item.as_str()), ("res/x", "đọc A/B[2J"));
        assert_eq!(r.files, ["a.rs", "b/c.rs"]);
        set(&p, "a", &s(&["rd", "blocked", "chờ"])).unwrap();
        let b = load(&p, "a").unwrap();
        assert_eq!(b.rows.len(), 1, "upsert, not append");
        assert_eq!(b.get("rd").unwrap().status, "blocked");
        assert_eq!(b.get("rd").unwrap().agent, "res/x", "agent kept");
        let e = set(&p, "a", &s(&["boss", "doing", "x"])).unwrap_err().to_string();
        assert!(e.contains("roster") && e.contains("critic"), "{e}");
        assert!(set(&p, "a", &s(&["rd", "nap", "x"])).is_err());
        set(&p, "a", &s(&["qa", "doing", &format!("key sk-ant-api03-{}", "A".repeat(40))])).unwrap();
        assert!(!std::fs::read_to_string(&p).unwrap().contains(&"A".repeat(40)));
        set(&p, "a", &s(&["dev", "doing", &"ư".repeat(300)])).unwrap();
        assert!(load(&p, "a").unwrap().get("dev").unwrap().item.chars().count() <= ITEM_MAX);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn concurrent_sets_keep_both_rows() {
        let d = tmp("lock");
        let p = d.join("a/SPRINT.md");
        init(&p, "a", false, &all_roles()).unwrap();
        let hs: Vec<_> = ["rd", "dev"]
            .into_iter()
            .map(|role| {
                let p = p.clone();
                std::thread::spawn(move || {
                    for i in 0..20 {
                        set(&p, "a", &s(&[role, "doing", &format!("n{i}")])).unwrap();
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        let b = load(&p, "a").unwrap();
        assert_eq!(b.get("rd").unwrap().item, "n19");
        assert_eq!(b.get("dev").unwrap().item, "n19");
        assert_eq!(b.rows.len(), 7);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn idle_rules() {
        let b = board(vec![
            row("rd", "doing", "x", &[]),
            row("plan", "todo", "", &[]),
            row("dev", "done", "xong", &[]),
            row("review", "rest", "", &[]),
            row("qa", "rest", "chờ dev", &[]),
            row("quick", "blocked", "chờ key", &[]),
            // critic absent from the board: not in this sprint, not idle
        ]);
        assert_eq!(idle_roles(&b), ["plan", "dev", "review"]);
        let b2 = board(vec![row("rd", "blocked", "", &[]), row("ghost", "todo", "", &[])]);
        assert_eq!(idle_roles(&b2), ["rd"]);
        let b3 = board(vec![row("dev", "doing", "a", &[]), row("review", "doing", "b", &[])]);
        assert!(idle_roles(&b3).is_empty());
    }

    #[test]
    fn report_lists_idle_peers_and_suffix_conflicts() {
        let b = board(vec![row("rd", "doing", "x", &["crates/a/b.rs"]), row("dev", "doing", "y", &["xb.rs"]), row("qa", "done", "z", &["a/b.rs"])]);
        let peers = [Peer { name: "core".into(), goal: Some("ship".into()), files: s(&["a/b.rs", "b.rs"]) }, peer("other", &[])];
        let (t, idle) = report("demo", &b, &peers);
        assert!(idle.contains(&"qa".to_string()) && t.contains("IDLE: qa"), "{t}");
        assert!(t.contains("Phòng khác:") && t.contains("- core: ship · file: a/b.rs, b.rs") && t.contains("- other: (chưa đặt mục tiêu)"), "{t}");
        assert!(t.contains("⚠ trùng file với core: crates/a/b.rs"), "{t}");
        assert!(!t.contains("trùng file với core: xb.rs"), "partial segment must not match: {t}");
        assert!(!t.contains("trùng file với core: a/b.rs"), "done rows are not conflicts: {t}");
        assert!(overlaps_with("b.rs", "a/b.rs", false) && !overlaps_with("a/b.rs", "xb.rs", false));
        let j = report_json(&b, &peers);
        assert_eq!(j["conflicts"].as_array().unwrap().len(), 1);
        assert_eq!(j["roles"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn overlap_normalisation() {
        assert!(overlaps_with("src\\a\\b.rs", "src/a/b.rs", false), "backslash");
        assert!(overlaps_with("./src/a.rs", "src/a.rs", false), "leading ./");
        assert!(overlaps_with("src/", "src/a.rs", false), "dir claim, trailing slash");
        assert!(overlaps_with("src/a.rs", "src", false), "dir claim, other side");
        assert!(!overlaps_with("src", "srcx/a.rs", false), "dir match needs / boundary");
        assert!(!overlaps_with("Src/A.rs", "src/a.rs", false), "case-sensitive");
        assert!(overlaps_with("Src/A.rs", "src/a.rs", true), "case-folded");
        assert!(overlaps_with("b.rs", "a/b.rs", false) && !overlaps_with("a/b.rs", "xb.rs", false), "suffix on / boundary");
        assert!(!overlaps_with("", "a", false) && !overlaps_with("./", "a", false));
    }

    #[test]
    fn conflicts_skip_peer_owning_the_row() {
        let mut r = row("dev", "doing", "y", &["a.rs"]);
        r.agent = "core".into();
        let b = board(vec![r]);
        let peers = [peer("core", &["a.rs"]), peer("other", &["a.rs"])];
        let c = conflicts(&b, &peers);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].2, "other");
    }

    #[test]
    fn standup_log_numbers_and_utc() {
        assert_eq!(utc_stamp(0), "1970-01-01T00:00Z");
        assert_eq!(utc_stamp(1_760_486_400), "2025-10-15T00:00Z");
        assert_eq!(utc_stamp(1_760_486_400 + 3600 * 13 + 60 * 7 + 59), "2025-10-15T13:07Z");
        let d = tmp("log");
        let p = d.join("a/STANDUP.md");
        let b = board(vec![row("rd", "doing", "x", &[]), row("dev", "done", "y", &[])]);
        assert_eq!(append_log(&p, "a", &b, &s(&["dev"]), 0).unwrap(), 1);
        assert_eq!(append_log(&p, "a", &b, &[], 1_760_486_400).unwrap(), 2);
        let t = std::fs::read_to_string(&p).unwrap();
        let lines: Vec<&str> = t.lines().collect();
        assert_eq!(lines[0], "# Standups: a");
        assert_eq!(lines[1], "1 · 1970-01-01T00:00Z · done 1 · doing 1 · blocked 0 · idle dev");
        assert_eq!(lines[2], "2 · 2025-10-15T00:00Z · done 1 · doing 1 · blocked 0 · idle -");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn json_does_not_append_log() {
        let d = tmp("json");
        run(&s(&["a", "init", "--roles", "dev"]), &d, &[]).unwrap();
        run(&s(&["a", "set", "dev", "doing", "x"]), &d, &[]).unwrap();
        let log = dir(&d, "a").unwrap().join("STANDUP.md");
        assert!(run(&s(&["a", "--json"]), &d, &[]).unwrap());
        assert!(!log.exists(), "--json must not write STANDUP.md");
        assert!(run(&s(&["a"]), &d, &[]).unwrap());
        assert!(log.exists());
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn bad_slug_rejected() {
        let d = tmp("slug");
        assert!(run(&s(&["../x", "init"]), &d, &[]).is_err());
        assert!(run(&s(&[".hid"]), &d, &[]).is_err());
        let _ = std::fs::remove_dir_all(d);
    }
}
