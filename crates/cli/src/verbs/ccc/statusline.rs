//! `8sync ccc statusline`: a Claude Code `statusLine` command (1–2 ANSI rows, plus a chained
//! third row) and `--agents` for `subagentStatusLine`. Reads the stdin JSON Claude Code sends
//! (https://code.claude.com/docs/en/statusline) plus a few cheap local reads; no network, no `gh`.
//! The renderer is pure (`render`, `agents_lines`); `gather` does the I/O. Render modes always
//! exit 0; unparseable stdin prints a bare `8sync` row so the bar is never blank.
//!
//! Setup: `--install` / `--uninstall`. A foreign `statusLine` command is parked as
//! `statusLine_prev` in `~/.config/8sync/features.toml` and chained (same stdin, output appended
//! as the last row), so e.g. the Orca statusline keeps working. The watchdog alert shown is the latest line of `alerts.jsonl` younger than 10 minutes (the
//! alerts file has no per-viewer "seen" cursor).
use crate::verbs::session_view::{scan_tail, truncate, Fmt};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const RST: &str = "\x1b[0m";
const PREV_KEY: &str = "statusLine_prev";
const ALERT_FRESH_S: u64 = 600;
const TAIL_BYTES: u64 = 256 * 1024;

/// Everything `gather` reads from disk or git; `render` only formats it.
#[derive(Default, Debug)]
pub(super) struct Extras {
    pub branch: Option<String>,
    pub dirty: bool,
    /// (done, total, current task title)
    pub tasks: Option<(usize, usize, Option<String>)>,
    pub alert: Option<String>,
    /// (iter, max_iter)
    pub looping: Option<(u64, u64)>,
    pub grant: bool,
    pub chained: Vec<String>,
    /// Where this session auto-compacts, in % of its context window ([`super::compact::point`] over
    /// the env Claude Code started it with): the kit pair (80 % x 250K) shows `ctx 12%→nén 20%` on 1M.
    pub compact: Option<u64>,
}

fn paint(color: bool, code: &str, s: &str) -> String {
    if color {
        format!("\x1b[{code}m{s}{RST}")
    } else {
        s.to_string()
    }
}

fn sep(color: bool) -> String {
    paint(color, "2", " · ")
}

fn pct_color(p: u64) -> &'static str {
    match p {
        0..=49 => "32",
        50..=80 => "33",
        _ => "31",
    }
}

fn bar(p: u64, color: bool) -> String {
    let filled = ((p.min(100) as usize) * 10).div_ceil(100).min(10);
    let s = format!("{}{}", "▓".repeat(filled), "░".repeat(10 - filled));
    paint(color, pct_color(p), &s)
}

/// `1h23m`, `2d4h`, `5m`.
fn until(resets_at: u64, now: u64) -> String {
    let s = resets_at.saturating_sub(now);
    match s {
        0 => "now".into(),
        1..=3599 => format!("{}m", s.div_ceil(60)),
        3600..=86399 => format!("{}h{:02}m", s / 3600, s % 3600 / 60),
        _ => format!("{}d{}h", s / 86400, s % 86400 / 3600),
    }
}

/// `40s`, `3m12s`, `1h02m`.
fn elapsed(s: u64) -> String {
    match s {
        0..=59 => format!("{s}s"),
        60..=3599 => format!("{}m{:02}s", s / 60, s % 60),
        _ => format!("{}h{:02}m", s / 3600, s % 3600 / 60),
    }
}

fn pct_of(v: &Value) -> Option<u64> {
    v.as_f64().filter(|f| f.is_finite()).map(|f| f.round().max(0.0) as u64)
}

/// Cut to `cols` visible chars (ANSI escapes cost 0), always on a char boundary; ends with a reset.
pub(super) fn clip(s: &str, cols: usize) -> String {
    let mut out = String::new();
    let (mut n, mut cut, mut it) = (0usize, false, s.chars().peekable());
    while let Some(c) = it.next() {
        if c == '\x1b' {
            out.push(c);
            if it.peek() == Some(&'[') {
                while let Some(&d) = it.peek() {
                    out.push(d);
                    it.next();
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        if n >= cols {
            cut = true;
            break;
        }
        out.push(c);
        n += 1;
    }
    if cut || out.contains('\x1b') {
        out.push_str(RST);
    }
    out
}

/// `Opus 5.5 (1M context)` → `Opus 5.5 · 1M`; names without a trailing `(..)` are kept.
fn short_model(name: &str) -> String {
    match name.trim().strip_suffix(')').and_then(|n| n.rsplit_once(" (")) {
        Some((base, inner)) if !base.is_empty() && !inner.is_empty() => format!("{base} · {}", inner.trim_end_matches(" context")),
        _ => name.to_string(),
    }
}

fn short_effort(e: &str) -> &str {
    match e {
        "medium" => "med",
        other => other,
    }
}

fn row1(v: &Value, x: &Extras, now: u64, color: bool) -> String {
    let mut seg = vec![paint(color, "1;35", "8sync")];
    if let Some(m) = v["model"]["display_name"].as_str().or_else(|| v["model"]["id"].as_str()) {
        let eff = v["effort"]["level"].as_str().map(|e| format!(" {}", paint(color, "2", short_effort(e)))).unwrap_or_default();
        seg.push(format!("{}{eff}", paint(color, "36", &short_model(m))));
    }
    if v["context_window"].is_object() {
        let p = pct_of(&v["context_window"]["used_percentage"]).unwrap_or(0);
        let at = x.compact.map(|c| paint(color, "2", &format!("→nén {c}%"))).unwrap_or_default();
        seg.push(format!("ctx {} {}{at}", bar(p, color), paint(color, pct_color(p), &format!("{p}%"))));
    }
    for (key, label) in [("five_hour", "5h"), ("seven_day", "7d")] {
        let w = &v["rate_limits"][key];
        if let Some(p) = pct_of(&w["used_percentage"]) {
            let r = w["resets_at"].as_u64().map(|r| format!(" ↻ {}", until(r, now))).unwrap_or_default();
            seg.push(format!("{label} {}{}", paint(color, pct_color(p), &format!("{p}%")), paint(color, "2", &r)));
        }
    }
    if let Some(c) = v["cost"]["total_cost_usd"].as_f64() {
        seg.push(format!("${c:.2}"));
    }
    let (a, d) = (v["cost"]["total_lines_added"].as_u64(), v["cost"]["total_lines_removed"].as_u64());
    if a.is_some() || d.is_some() {
        seg.push(format!("{}/{}", paint(color, "32", &format!("+{}", a.unwrap_or(0))), paint(color, "31", &format!("-{}", d.unwrap_or(0)))));
    }
    seg.join(&sep(color))
}

fn row2(v: &Value, x: &Extras, color: bool) -> String {
    let mut seg = Vec::new();
    if let Some(b) = &x.branch {
        seg.push(paint(color, "34", &format!("⎇ {b}{}", if x.dirty { "*" } else { "" })));
    } else if let Some(d) = cwd_of(v).and_then(|c| Path::new(c).file_name()).and_then(|n| n.to_str()) {
        seg.push(paint(color, "2", &plain(d)));
    }
    if let Some(n) = v["pr"]["number"].as_u64() {
        let mark = if v["pr"]["kind"] == "mr" { "!" } else { "#" };
        let (sym, code) = match v["pr"]["review_state"].as_str() {
            Some("approved") => (" ✓", "32"),
            Some("pending") => (" ●", "33"),
            Some("changes_requested") => (" ✗", "31"),
            Some("draft") => (" ○", "2"),
            _ => ("", "0"),
        };
        seg.push(paint(color, code, &format!("{mark}{n}{sym}")));
    }
    if let Some((done, total, cur)) = &x.tasks {
        let cur = cur.as_deref().map(|t| format!(" ▸ {}", truncate(&plain(t), 40))).unwrap_or_default();
        seg.push(format!("tasks {done}/{total}{cur}"));
    }
    if let Some(a) = &x.alert {
        seg.push(paint(color, "1;33", &format!("⚠ {a}")));
    }
    if let Some((i, m)) = x.looping {
        seg.push(format!("loop {i}/{m}"));
    }
    if x.grant {
        seg.push(paint(color, "32", "🚢 grant"));
    }
    seg.join(&sep(color))
}

/// Pure renderer: rows already clipped to `cols`.
pub(super) fn render(v: &Value, x: &Extras, now: u64, cols: usize, color: bool) -> Vec<String> {
    let mut rows = vec![row1(v, x, now, color)];
    let r2 = row2(v, x, color);
    if !r2.is_empty() {
        rows.push(r2);
    }
    rows.extend(x.chained.iter().cloned());
    rows.iter().map(|r| clip(r, cols)).collect()
}

/// Pure: one summary row for `subagentStatusLine` input, or `None` with no tasks.
pub(super) fn agents_row(v: &Value, now_ms: u64, color: bool) -> Option<String> {
    let tasks = v["tasks"].as_array().filter(|t| !t.is_empty())?;
    let mut running = Vec::new();
    let mut idle = 0;
    for t in tasks {
        match t["status"].as_str().unwrap_or("") {
            "running" => {
                let name = plain(t["name"].as_str().or_else(|| t["agentType"].as_str()).unwrap_or("agent"));
                let s = t["startTime"].as_u64().map(|st| now_ms.saturating_sub(st) / 1000).unwrap_or(0);
                running.push(format!("{} {}", truncate(&name, 20), elapsed(s)));
            }
            "completed" | "failed" | "killed" => {}
            _ => idle += 1,
        }
    }
    let mut s = format!("⚙ {} running", running.len());
    if !running.is_empty() {
        s += &format!(" ({})", running.iter().take(3).cloned().collect::<Vec<_>>().join(" · "));
    }
    if idle > 0 {
        s += &format!(" · {idle} idle");
    }
    Some(paint(color, "36", &s))
}

/// `{"id","content"}` lines: the summary on the first row, the others hidden.
pub(super) fn agents_lines(v: &Value, now_ms: u64, cols: usize, color: bool) -> Vec<String> {
    let Some(row) = agents_row(v, now_ms, color) else { return vec![] };
    let ids: Vec<&str> = v["tasks"].as_array().into_iter().flatten().filter_map(|t| t["id"].as_str()).collect();
    ids.iter().enumerate().map(|(i, id)| json!({ "id": id, "content": if i == 0 { clip(&row, cols) } else { String::new() } }).to_string()).collect()
}

// ── I/O ─────────────────────────────────────────────────────────────────────

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Drop control characters (a task title or a chained row must not move the cursor or set the
/// window title). With `keep_sgr`, colour sequences `ESC [ digits/; m` survive.
fn sanitize(s: &str, keep_sgr: bool) -> String {
    let c: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < c.len() {
        if keep_sgr && c[i] == '\x1b' && c.get(i + 1) == Some(&'[') {
            let mut j = i + 2;
            while j < c.len() && (c[j].is_ascii_digit() || c[j] == ';') {
                j += 1;
            }
            if c.get(j) == Some(&'m') {
                out.extend(&c[i..=j]);
                i = j + 1;
                continue;
            }
        }
        if !c[i].is_control() {
            out.push(c[i]);
        }
        i += 1;
    }
    out
}

fn plain(s: &str) -> String {
    sanitize(s, false)
}

fn kill_group(pgid: u32) {
    let _ = Command::new("kill").args(["-KILL", "--", &format!("-{pgid}")]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
}

/// Run `cmd` in its own process group, give it `budget`; on timeout kill the whole group (a
/// `sh -c 'a | b'` chain included) and return `None`. stdin is fed and stdout drained on threads,
/// so neither a full pipe nor a child that ignores stdin can stall us past the budget.
pub(super) fn run_budget(mut cmd: Command, stdin: Option<&str>, budget: Duration) -> Option<String> {
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let mut c = cmd.spawn().ok()?;
    let pgid = c.id();
    if let (Some(inp), Some(mut si)) = (stdin, c.stdin.take()) {
        let inp = inp.to_string();
        std::thread::spawn(move || {
            let _ = si.write_all(inp.as_bytes());
        });
    }
    let mut so = c.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = so.read_to_end(&mut b);
        let _ = tx.send(b);
    });
    match rx.recv_timeout(budget) {
        Ok(b) => {
            let _ = c.try_wait();
            Some(String::from_utf8_lossy(&b).into_owned())
        }
        Err(_) => {
            kill_group(pgid);
            let _ = c.kill();
            let _ = c.wait();
            None
        }
    }
}

fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let mut c = Command::new("git");
    c.arg("-C").arg(cwd).args(args).env("GIT_OPTIONAL_LOCKS", "0");
    run_budget(c, None, Duration::from_millis(50)).map(|s| s.trim().to_string())
}

fn cwd_of(v: &Value) -> Option<&str> {
    v["workspace"]["current_dir"].as_str().or_else(|| v["cwd"].as_str()).filter(|c| !c.is_empty())
}

/// Parse the content of a `HEAD` file: branch name, or the first 7 hex chars when detached.
fn parse_head(head: &str) -> Option<String> {
    let h = head.trim();
    if let Some(r) = h.strip_prefix("ref:") {
        let r = r.trim();
        return Some(r.strip_prefix("refs/heads/").unwrap_or(r).to_string()).filter(|b| !b.is_empty());
    }
    (h.len() >= 7 && h.chars().all(|c| c.is_ascii_hexdigit())).then(|| h[..7].to_string())
}

/// Branch of the repo containing `cwd`, read straight from `.git/HEAD` (no process). A `.git`
/// file (worktree / submodule) points at the real git dir via `gitdir: <path>`.
fn read_head(cwd: &Path) -> Option<String> {
    let dot = cwd.ancestors().map(|d| d.join(".git")).find(|p| p.exists())?;
    let gitdir = if dot.is_dir() {
        dot
    } else {
        let raw = std::fs::read_to_string(&dot).ok()?;
        let g = Path::new(raw.trim().strip_prefix("gitdir:")?.trim());
        if g.is_absolute() { g.to_path_buf() } else { dot.parent()?.join(g) }
    };
    parse_head(&std::fs::read_to_string(gitdir.join("HEAD")).ok()?)
}

fn ship_active(cwd: &Path) -> Option<(u64, u64)> {
    let dir = cwd.ancestors().map(|d| d.join("su-code/ship")).find(|d| d.is_dir())?;
    let active = std::fs::read_to_string(dir.join("ACTIVE")).ok()?;
    for slug in active.lines().map(str::trim) {
        if slug.is_empty() || slug.starts_with('.') || !slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(dir.join(slug).join("loop.json")) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else { continue };
        if !v["stopped"].is_null() {
            continue;
        }
        return Some((v["iter"].as_u64().unwrap_or(0), v["max_iter"].as_u64().unwrap_or(0)));
    }
    None
}

fn last_line(p: &Path) -> Option<String> {
    use std::io::{Seek, SeekFrom};
    let mut f = std::fs::File::open(p).ok()?;
    let len = f.metadata().ok()?.len();
    f.seek(SeekFrom::Start(len.saturating_sub(8192))).ok()?;
    let mut b = Vec::new();
    f.read_to_end(&mut b).ok()?;
    String::from_utf8_lossy(&b).lines().rev().find(|l| !l.trim().is_empty()).map(str::to_string)
}

fn fresh_alert(home: &Path, now: u64) -> Option<String> {
    let l = last_line(&home.join(".local/state/8sync/watchdog/alerts.jsonl"))?;
    let v: Value = serde_json::from_str(&l).ok()?;
    (now.saturating_sub(v["ts"].as_u64()?) <= ALERT_FRESH_S).then(|| plain(v["kind"].as_str().unwrap_or("alert")))
}

pub(super) fn features(home: &Path) -> PathBuf {
    crate::brand::config_dir(home).join("features.toml")
}

fn prev_cmd(home: &Path) -> Option<String> {
    let t = std::fs::read_to_string(features(home)).ok()?.parse::<toml::Table>().ok()?;
    let c = prev_object(t.get(PREV_KEY)?.as_str()?)?["command"].as_str()?.to_string();
    (!c.trim().is_empty() && !is_ours(&c)).then_some(c)
}

fn gather(v: &Value, input: &str, home: &Path, now: u64) -> Extras {
    let mut x = Extras::default();
    let cwd = cwd_of(v).unwrap_or("");
    let sid = v["session_id"].as_str();
    x.branch = v["worktree"]["branch"].as_str().map(str::to_string).or_else(|| if cwd.is_empty() { None } else { read_head(Path::new(cwd)) });
    if x.branch.is_some() && !cwd.is_empty() {
        x.dirty = git(cwd, &["status", "--porcelain", "-uno"]).is_some_and(|s| !s.is_empty());
    }
    if let Some(tp) = v["transcript_path"].as_str() {
        let d = scan_tail(Path::new(tp), Fmt::Claude, TAIL_BYTES);
        if !d.tasks.is_empty() {
            x.tasks = Some((d.tasks_done(), d.tasks.len(), d.current_task().map(|t| t.title.clone())));
        }
    }
    x.alert = fresh_alert(home, now);
    if !cwd.is_empty() {
        x.looping = ship_active(Path::new(cwd));
    }
    x.grant = super::grant::allows(&super::grant::dir(home), sid, false, now);
    // The status line inherits the session's env (settings `env` applied at start), so this is the
    // point this session uses, not what settings.json says now.
    let var = |k: &str| std::env::var(k).ok();
    x.compact = v["context_window"]["context_window_size"]
        .as_u64()
        .and_then(|n| super::compact::point(n, var(super::compact::VAR).as_deref(), var(super::compact::WIN_VAR).as_deref()));
    if std::env::var_os("EIGHTSYNC_STATUSLINE_CHAIN").is_none() {
        if let Some(prev) = prev_cmd(home) {
            let mut c = Command::new("sh");
            c.arg("-c").arg(prev).env("EIGHTSYNC_STATUSLINE_CHAIN", "1");
            if let Some(out) = run_budget(c, Some(input), Duration::from_millis(400)) {
                x.chained = out.lines().map(|l| sanitize(l, true)).map(|l| l.trim_end().to_string()).filter(|l| !l.trim().is_empty()).collect();
            }
        }
    }
    x
}

fn cols() -> usize {
    std::env::var("COLUMNS").ok().and_then(|c| c.trim().parse::<usize>().ok()).filter(|&c| c >= 10).unwrap_or(200)
}

fn read_stdin() -> String {
    let mut s = String::new();
    let _ = std::io::stdin().read_to_string(&mut s);
    s
}

fn statusline(input: &str) -> Vec<String> {
    let color = std::env::var_os("NO_COLOR").is_none();
    let Ok(v) = serde_json::from_str::<Value>(input) else { return vec![paint(color, "1;35", "8sync")] };
    let (home, now) = (dirs::home_dir().unwrap_or_default(), now_s());
    render(&v, &gather(&v, input, &home, now), now, cols(), color)
}

// ── install ─────────────────────────────────────────────────────────────────

const CMD_TAIL: &str = " ccc statusline";
const AGENTS_TAIL: &str = " ccc statusline --agents";

/// Our `statusLine` command: ends with exactly `<exe> ccc statusline` (a foreign command that
/// merely mentions it, or the `--agents` variant, is not ours).
pub(super) fn is_ours(cmd: &str) -> bool {
    cmd.trim_end().ends_with(CMD_TAIL)
}

fn is_agents_ours(cmd: &str) -> bool {
    cmd.trim_end().ends_with(AGENTS_TAIL)
}

/// Shell-safe: bare when only safe chars, else single-quoted with `'` written as `'\''`.
fn quote(exe: &str) -> String {
    if !exe.is_empty() && exe.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+:@%=,".contains(c)) {
        exe.to_string()
    } else {
        format!("'{}'", exe.replace('\'', "'\\''"))
    }
}

fn status_value(exe: &str) -> Value {
    json!({ "type": "command", "command": format!("{}{CMD_TAIL}", quote(exe)), "padding": 0, "refreshInterval": 5 })
}

fn agents_value(exe: &str) -> Value {
    json!({ "type": "command", "command": format!("{}{AGENTS_TAIL}", quote(exe)) })
}

fn cmd_of(v: &Value) -> Option<&str> {
    v["command"].as_str()
}

/// The parked previous `statusLine` object (stored JSON-serialized; a bare command string from an
/// older build is accepted too).
fn prev_object(stored: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(stored) {
        Ok(v) if v.is_object() => Some(v),
        _ => Some(json!({ "type": "command", "command": stored })).filter(|_| !stored.trim().is_empty()),
    }
}

/// `features.toml` key: `statusline = false` records that the user ran `--uninstall`, so the kit
/// never reinstalls the 8sync status line (`--install` clears it).
const OPT_OUT_KEY: &str = "statusline";

fn opted_out(f: &toml::Table) -> bool {
    f.get(OPT_OUT_KEY).and_then(toml::Value::as_bool) == Some(false)
}

/// Kit side: install the 8sync status lines by default (a foreign `statusLine` is parked and
/// chained like `--install`), refresh our command to the current exe path, honour the opt-out.
/// Writes `features.toml` (`fp`) only when it changed; the caller writes `settings`.
/// Returns human lines — empty when nothing changed.
pub(super) fn kit_apply(settings: &mut Value, exe: &str, fp: &Path) -> Result<Vec<String>> {
    require_object(settings)?;
    let fraw = read_or_empty(fp)?;
    let mut f: toml::Table = fraw.parse().map_err(|e| anyhow::anyhow!("{} is not valid TOML ({e}); fix it first", fp.display()))?;
    if opted_out(&f) {
        return Ok(vec![]);
    }
    let (s0, f0) = (settings.clone(), f.clone());
    let msgs = install_into(settings, exe, &mut f)?;
    if f != f0 {
        write_file(fp, &fraw, &toml::to_string_pretty(&f)?)?;
    }
    Ok(if *settings == s0 && f == f0 { vec![] } else { msgs })
}

/// Writing into a non-object (array, number, `null`) would panic on indexing; refuse instead.
fn require_object(settings: &Value) -> Result<()> {
    if settings.is_object() {
        Ok(())
    } else {
        bail!("settings.json is not a JSON object — fix it first")
    }
}

/// `--install` on parsed settings + features. Returns human lines.
pub(super) fn install_into(settings: &mut Value, exe: &str, feats: &mut toml::Table) -> Result<Vec<String>> {
    require_object(settings)?;
    let mut msg = Vec::new();
    feats.remove(OPT_OUT_KEY);
    match settings.get("statusLine").cloned() {
        Some(old) if cmd_of(&old).is_some_and(|c| !is_ours(c)) => {
            let c = cmd_of(&old).unwrap_or_default().to_string();
            msg.push(format!("statusLine: kept your command as {PREV_KEY} and chained it as the last row ({c})"));
            feats.insert(PREV_KEY.into(), toml::Value::String(old.to_string()));
        }
        Some(old) if cmd_of(&old).is_none() => {
            msg.push("statusLine: existing entry has no command, left as is".into());
            return Ok(msg);
        }
        _ => msg.push("statusLine: installed".into()),
    }
    settings["statusLine"] = status_value(exe);
    match settings.get("subagentStatusLine") {
        Some(s) if !cmd_of(s).is_some_and(is_agents_ours) => msg.push("subagentStatusLine: yours kept (not replaced)".into()),
        _ => {
            settings["subagentStatusLine"] = agents_value(exe);
            msg.push("subagentStatusLine: installed".into());
        }
    }
    Ok(msg)
}

/// `--uninstall`: drop ours, restore the whole previous `statusLine` object.
pub(super) fn uninstall_from(settings: &mut Value, feats: &mut toml::Table) -> Vec<String> {
    let mut msg = Vec::new();
    if cmd_of(&settings["statusLine"]).is_some_and(is_ours) {
        let prev = feats.remove(PREV_KEY).and_then(|p| p.as_str().and_then(prev_object));
        match prev {
            Some(p) => {
                settings["statusLine"] = p;
                msg.push("statusLine: restored your previous statusLine".into());
            }
            None => {
                settings.as_object_mut().map(|o| o.remove("statusLine"));
                msg.push("statusLine: removed".into());
            }
        }
    }
    if cmd_of(&settings["subagentStatusLine"]).is_some_and(is_agents_ours) {
        settings.as_object_mut().map(|o| o.remove("subagentStatusLine"));
        msg.push("subagentStatusLine: removed".into());
    }
    msg
}

fn claude_dir(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude"))
}

/// Missing file = empty; any other read error aborts (never overwrite what we could not read).
fn read_or_empty(p: &Path) -> Result<String> {
    match std::fs::read_to_string(p) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e).with_context(|| format!("read {}", p.display())),
    }
}

fn write_file(p: &Path, old: &str, new: &str) -> Result<()> {
    std::fs::create_dir_all(p.parent().context("no parent")?)?;
    if old.is_empty() {
        std::fs::write(p, new).with_context(|| format!("write {}", p.display()))
    } else {
        super::write_atomic_bak(p, old, new)
    }
}

/// Install (`exe = Some`) or uninstall (`None`) against explicit files. Writes only what changed.
fn setup_at(sp: &Path, fp: &Path, exe: Option<&str>, opt_out: bool) -> Result<Vec<String>> {
    let raw = read_or_empty(sp)?;
    let mut s: Value = if raw.trim().is_empty() { json!({}) } else { serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", sp.display()))? };
    require_object(&s).with_context(|| sp.display().to_string())?;
    let s0 = s.clone();
    let fraw = read_or_empty(fp)?;
    let mut f: toml::Table = fraw.parse().map_err(|e| anyhow::anyhow!("{} is not valid TOML ({e}); fix it first", fp.display()))?;
    let f0 = f.clone();
    let msgs = match exe {
        Some(e) => install_into(&mut s, e, &mut f)?,
        None => {
            let m = uninstall_from(&mut s, &mut f);
            if opt_out {
                f.insert(OPT_OUT_KEY.into(), toml::Value::Boolean(false));
            }
            m
        }
    };
    // Compare parsed values, not text: a no-op must not rewrite the file (formatting kept) or leave a .bak.
    let write_settings = || -> Result<()> {
        if s != s0 {
            write_file(sp, &raw, &(serde_json::to_string_pretty(&s)? + "\n"))?;
        }
        Ok(())
    };
    let write_feats = || -> Result<()> {
        if f != f0 {
            write_file(fp, &fraw, &toml::to_string_pretty(&f)?)?;
        }
        Ok(())
    };
    // Never lose the parked statusLine: install saves it first, uninstall removes it last.
    if exe.is_some() {
        write_feats()?;
        write_settings()?;
    } else {
        write_settings()?;
        write_feats()?;
    }
    Ok(msgs)
}

/// `ccc kit --remove` entry: restore the previous statusLine, drop ours.
pub(super) fn uninstall_at(sp: &Path, fp: &Path) -> Result<Vec<String>> {
    setup_at(sp, fp, None, false)
}

fn setup(home: &Path, uninstall: bool) -> Result<()> {
    let (sp, fp) = (claude_dir(home).join("settings.json"), features(home));
    let msgs = if uninstall { setup_at(&sp, &fp, None, true)? } else { setup_at(&sp, &fp, Some(&super::hook_exe()?), false)? };
    for m in msgs {
        crate::ui::ok(&m);
    }
    Ok(())
}

/// Entry point: never fails the status bar (always exit 0 for render modes).
pub(super) fn run(rest: &[String]) -> Result<()> {
    let has = |f: &str| rest.iter().any(|a| a == f);
    if has("--install") || has("--uninstall") {
        let home = dirs::home_dir().context("no home dir")?;
        return setup(&home, has("--uninstall"));
    }
    if rest.iter().any(|a| a.starts_with('-') && !matches!(a.as_str(), "--agents")) {
        bail!("usage: 8sync ccc statusline [--agents | --install | --uninstall]");
    }
    let input = read_stdin();
    let color = std::env::var_os("NO_COLOR").is_none();
    let lines = if has("--agents") {
        let v: Value = serde_json::from_str(&input).unwrap_or(Value::Null);
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        agents_lines(&v, ms, v["columns"].as_u64().map_or(cols(), |c| c as usize), color)
    } else {
        // Keep Claude Code's own cost/usage numbers for `ccc . report` and `hq ui` (ccc/report.rs).
        if let (Ok(v), Some(home)) = (serde_json::from_str::<Value>(&input), dirs::home_dir()) {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            super::report::write_snapshot(&home, &v, now);
        }
        statusline(&input)
    };
    let mut out = std::io::stdout().lock();
    for l in lines {
        let _ = writeln!(out, "{l}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn strip(s: &str) -> String {
        let mut o = String::new();
        let mut it = s.chars();
        while let Some(c) = it.next() {
            if c == '\x1b' {
                for d in it.by_ref() {
                    if d.is_ascii_alphabetic() {
                        break;
                    }
                }
            } else {
                o.push(c);
            }
        }
        o
    }

    const NOW: u64 = 1_000_000;

    fn full() -> Value {
        json!({
            "model": {"display_name": "Opus 5"}, "effort": {"level": "high"},
            "context_window": {"used_percentage": 42.4},
            "rate_limits": {"five_hour": {"used_percentage": 23.5, "resets_at": NOW + 4980}, "seven_day": {"used_percentage": 85.0, "resets_at": NOW + 2 * 86400 + 4 * 3600}},
            "cost": {"total_cost_usd": 0.01234, "total_lines_added": 156, "total_lines_removed": 23},
            "pr": {"number": 12, "review_state": "approved"}
        })
    }

    fn extras() -> Extras {
        Extras { branch: Some("feat/x".into()), dirty: true, tasks: Some((2, 5, Some("viết test".into()))), alert: Some("mem".into()), looping: Some((3, 12)), grant: true, chained: vec![], compact: Some(65) }
    }

    #[test]
    fn full_fields() {
        let r = render(&full(), &extras(), NOW, 400, true);
        assert_eq!(r.len(), 2);
        let (a, b) = (strip(&r[0]), strip(&r[1]));
        assert_eq!(a, "8sync · Opus 5 high · ctx ▓▓▓▓▓░░░░░ 42%→nén 65% · 5h 24% ↻ 1h23m · 7d 85% ↻ 2d4h · $0.01 · +156/-23");
        assert_eq!(b, "⎇ feat/x* · #12 ✓ · tasks 2/5 ▸ viết test · ⚠ mem · loop 3/12 · 🚢 grant");
        assert!(r[0].contains("\x1b[31m85%"), "7d over 80 is red");
    }

    #[test]
    fn the_kit_compaction_point_on_1m_shows_20_dim() {
        let v = json!({"model": {"display_name": "Opus 5.5 (1M context)"}, "context_window": {"used_percentage": 12, "context_window_size": 1_000_000}});
        // the kit pair: 80 % of a 250K window on a 1M model = 200K, deliberate (not an alarm)
        let at = crate::verbs::ccc::compact::point(1_000_000, Some("80"), Some("250000"));
        assert_eq!(at, Some(20));
        let r = render(&v, &Extras { compact: at, ..Default::default() }, NOW, 200, true);
        assert!(r[0].contains("\x1b[2m→nén 20%"), "{:?}", r[0]);
        assert_eq!(strip(&render(&v, &Extras::default(), NOW, 200, true)[0]), "8sync · Opus 5.5 · 1M · ctx ▓▓░░░░░░░░ 12%");
    }

    #[test]
    fn missing_rate_limits_and_pr() {
        let v = json!({"model": {"display_name": "Haiku"}, "context_window": {"used_percentage": 90}});
        let r = render(&v, &Extras { branch: Some("main".into()), ..Default::default() }, NOW, 200, false);
        assert_eq!(r[0], "8sync · Haiku · ctx ▓▓▓▓▓▓▓▓▓░ 90%");
        assert_eq!(r[1], "⎇ main");
        assert!(!r[0].contains("5h") && !r[0].contains('$'));
    }

    #[test]
    fn no_row2_when_empty() {
        let r = render(&json!({"model": {"display_name": "X"}}), &Extras::default(), NOW, 80, false);
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn truncates_on_char_boundary_utf8() {
        let x = Extras { branch: Some("nhánh-tiếng-Việt-rất-dài-ệ".into()), ..Default::default() };
        let r = render(&json!({"model": {"display_name": "Ô"}}), &x, NOW, 12, true);
        for row in &r {
            assert!(strip(row).chars().count() <= 12, "{row:?}");
        }
        assert_eq!(strip(&r[1]), "⎇ nhánh-tiến");
        assert!(r[1].ends_with(RST));
    }

    #[test]
    fn chained_row_appended() {
        let x = Extras { chained: vec!["orca: ok".into()], ..Default::default() };
        let r = render(&json!({"model": {"display_name": "X"}}), &x, NOW, 80, false);
        assert_eq!(r.last().unwrap(), "orca: ok");
    }

    #[test]
    fn agents_row_and_lines() {
        let now_ms = 10_000_000u64;
        let v = json!({"columns": 100, "tasks": [
            {"id": "a", "name": "task", "status": "running", "startTime": now_ms - 192_000},
            {"id": "b", "agentType": "reviewer", "status": "running", "startTime": now_ms - 40_000},
            {"id": "c", "name": "x", "status": "idle"},
            {"id": "d", "name": "y", "status": "completed"}
        ]});
        assert_eq!(strip(&agents_row(&v, now_ms, true).unwrap()), "⚙ 2 running (task 3m12s · reviewer 40s) · 1 idle");
        let l = agents_lines(&v, now_ms, 100, false);
        assert_eq!(l.len(), 4);
        let first: Value = serde_json::from_str(&l[0]).unwrap();
        assert_eq!(first["id"], "a");
        assert!(first["content"].as_str().unwrap().starts_with("⚙ 2 running"));
        assert_eq!(serde_json::from_str::<Value>(&l[1]).unwrap()["content"], "");
        assert!(agents_lines(&json!({"tasks": []}), now_ms, 100, false).is_empty());
    }

    #[test]
    fn bad_input_still_prints() {
        for i in ["not json", "", "null", "[]", "42", "{\"model\": 5}"] {
            assert!(!statusline(i).is_empty(), "{i:?}");
        }
    }

    #[test]
    fn install_uninstall_roundtrip_with_chain() {
        let prev = json!({"type": "command", "command": "orca-status --x", "padding": 2});
        let mut s = json!({"theme": "dark", "statusLine": prev});
        let mut f = toml::Table::new();
        f.insert("other_flag".into(), toml::Value::Boolean(true));
        install_into(&mut s, "/bin/8sync", &mut f).unwrap();
        assert_eq!(s["statusLine"]["command"], "/bin/8sync ccc statusline");
        assert_eq!(s["statusLine"]["refreshInterval"], 5);
        assert_eq!(s["subagentStatusLine"]["command"], "/bin/8sync ccc statusline --agents");
        let stored = f[PREV_KEY].as_str().unwrap().to_string();
        assert_eq!(serde_json::from_str::<Value>(&stored).unwrap(), prev);
        // idempotent: a second install must not park our own command as prev
        install_into(&mut s, "/bin/8sync", &mut f).unwrap();
        assert_eq!(f[PREV_KEY].as_str(), Some(stored.as_str()));
        uninstall_from(&mut s, &mut f);
        assert_eq!(s["statusLine"], prev, "whole object restored");
        assert!(s.get("subagentStatusLine").is_none());
        assert!(f.get(PREV_KEY).is_none() && f["other_flag"].as_bool() == Some(true));
        assert_eq!(s["theme"], "dark");
    }

    #[test]
    fn install_fresh_then_remove_and_foreign_subagent_kept() {
        let mut s = json!({"subagentStatusLine": {"type": "command", "command": "mine"}});
        let mut f = toml::Table::new();
        install_into(&mut s, "/opt/my dir/8sync", &mut f).unwrap();
        assert_eq!(s["statusLine"]["command"], "'/opt/my dir/8sync' ccc statusline");
        assert_eq!(s["subagentStatusLine"]["command"], "mine");
        assert!(f.is_empty());
        uninstall_from(&mut s, &mut f);
        assert!(s.get("statusLine").is_none());
        assert_eq!(s["subagentStatusLine"]["command"], "mine");
    }

    #[test]
    fn quote_and_is_ours() {
        assert_eq!(quote("/a/it's here/8sync"), "'/a/it'\\''s here/8sync'");
        assert!(is_ours(&format!("{} ccc statusline", quote("/a/it's/8sync"))));
        assert!(!is_ours("orca --note 'ccc statusline docs'"));
        assert!(!is_ours("/bin/8sync ccc statusline --agents"));
        assert!(is_agents_ours("/bin/8sync ccc statusline --agents"));
    }

    #[test]
    fn sanitize_strips_controls_keeps_sgr() {
        assert_eq!(sanitize("a\x1b[31mred\x1b[0m\x1b]0;title\x07b\r", true), "a\x1b[31mred\x1b[0m]0;titleb");
        assert_eq!(plain("x\x1b[31m\ny"), "x[31my");
    }

    #[test]
    fn chained_timeout_kills_group() {
        let t = Instant::now();
        let mut c = Command::new("sh");
        c.arg("-c").arg("sleep 5 | cat");
        assert!(run_budget(c, Some("{}"), Duration::from_millis(400)).is_none());
        assert!(t.elapsed() < Duration::from_millis(1500), "{:?}", t.elapsed());
        let mut c = Command::new("sh");
        c.arg("-c").arg("cat");
        assert_eq!(run_budget(c, Some("hi"), Duration::from_secs(2)).as_deref(), Some("hi"));
    }

    #[test]
    fn ship_active_takes_first_slug_with_loop_json() {
        let d = std::env::temp_dir().join(format!("sl-ship-{}", std::process::id()));
        let ship = d.join("su-code/ship");
        std::fs::create_dir_all(ship.join("b")).unwrap();
        std::fs::write(ship.join("ACTIVE"), "ghost\nb\n").unwrap();
        std::fs::write(ship.join("b/loop.json"), r#"{"iter":2,"max_iter":9}"#).unwrap();
        assert_eq!(ship_active(&d), Some((2, 9)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn kit_remove_restores_previous_statusline() {
        let d = std::env::temp_dir().join(format!("sl-rm-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (sp, fp) = (d.join("settings.json"), d.join("features.toml"));
        let prev = json!({"type": "command", "command": "orca"});
        std::fs::write(&sp, json!({"statusLine": prev}).to_string()).unwrap();
        setup_at(&sp, &fp, Some("/bin/8sync"), false).unwrap();
        assert!(is_ours(cmd_of(&serde_json::from_str::<Value>(&std::fs::read_to_string(&sp).unwrap()).unwrap()["statusLine"]).unwrap()));
        assert!(d.join("settings.json.bak-8sync").exists());
        uninstall_at(&sp, &fp).unwrap();
        let s: Value = serde_json::from_str(&std::fs::read_to_string(&sp).unwrap()).unwrap();
        assert_eq!(s["statusLine"], prev);
        assert!(s.get("subagentStatusLine").is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    fn tmpd(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sl-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn kit_chains_foreign_by_default_and_is_idempotent() {
        // Behaviour change (was: foreign statusLine kept, hint only).
        let d = tmpd("kitchain");
        let fp = d.join("features.toml");
        let mut s = json!({"statusLine": {"type": "command", "command": "orca"}});
        assert!(!kit_apply(&mut s, "/bin/8sync", &fp).unwrap().is_empty());
        assert!(is_ours(s["statusLine"]["command"].as_str().unwrap()));
        assert!(std::fs::read_to_string(&fp).unwrap().contains("orca"), "parked in features.toml");
        let raw = std::fs::read_to_string(&fp).unwrap();
        let s1 = s.clone();
        assert!(kit_apply(&mut s, "/bin/8sync", &fp).unwrap().is_empty(), "second run is silent");
        assert_eq!(s, s1);
        assert_eq!(std::fs::read_to_string(&fp).unwrap(), raw, "features.toml not rewritten");
        let mut e = json!({});
        kit_apply(&mut e, "/bin/8sync", &d.join("f2.toml")).unwrap();
        assert!(is_ours(e["statusLine"]["command"].as_str().unwrap()));
        assert!(!d.join("f2.toml").exists(), "no features file when nothing to park");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn kit_refreshes_exe_path() {
        let d = tmpd("kitpath");
        let fp = d.join("features.toml");
        let mut s = json!({});
        kit_apply(&mut s, "/old/8sync", &fp).unwrap();
        kit_apply(&mut s, "/new/8sync", &fp).unwrap();
        assert_eq!(s["statusLine"]["command"], "/new/8sync ccc statusline");
        assert_eq!(s["subagentStatusLine"]["command"], "/new/8sync ccc statusline --agents");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn uninstall_opts_out_and_install_clears() {
        let d = tmpd("optout");
        let (sp, fp) = (d.join("settings.json"), d.join("features.toml"));
        std::fs::write(&sp, json!({"statusLine": {"type": "command", "command": "orca"}}).to_string()).unwrap();
        setup_at(&sp, &fp, Some("/bin/8sync"), false).unwrap();
        setup_at(&sp, &fp, None, true).unwrap();
        let mut s: Value = serde_json::from_str(&std::fs::read_to_string(&sp).unwrap()).unwrap();
        assert_eq!(s["statusLine"]["command"], "orca", "previous restored");
        assert!(kit_apply(&mut s, "/bin/8sync", &fp).unwrap().is_empty());
        assert_eq!(s["statusLine"]["command"], "orca", "kit respects the opt-out");
        assert!(s.get("subagentStatusLine").is_none());
        setup_at(&sp, &fp, Some("/bin/8sync"), false).unwrap();
        let t: toml::Table = std::fs::read_to_string(&fp).unwrap().parse().unwrap();
        assert!(!opted_out(&t));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn head_parsing() {
        assert_eq!(parse_head("ref: refs/heads/feat/x\n").as_deref(), Some("feat/x"));
        assert_eq!(parse_head("0123456789abcdef0123456789abcdef01234567\n").as_deref(), Some("0123456"));
        assert_eq!(parse_head("garbage"), None);
        let d = tmpd("head");
        std::fs::create_dir_all(d.join("repo/.git")).unwrap();
        std::fs::create_dir_all(d.join("repo/sub")).unwrap();
        std::fs::write(d.join("repo/.git/HEAD"), "ref: refs/heads/main\n").unwrap();
        assert_eq!(read_head(&d.join("repo/sub")).as_deref(), Some("main"));
        // worktree: `.git` file → gitdir (relative and absolute)
        std::fs::create_dir_all(d.join("wt")).unwrap();
        std::fs::create_dir_all(d.join("gitdirs/wt")).unwrap();
        std::fs::write(d.join("gitdirs/wt/HEAD"), "ref: refs/heads/topic\n").unwrap();
        std::fs::write(d.join("wt/.git"), "gitdir: ../gitdirs/wt\n").unwrap();
        assert_eq!(read_head(&d.join("wt")).as_deref(), Some("topic"));
        std::fs::write(d.join("wt/.git"), format!("gitdir: {}\n", d.join("gitdirs/wt").display())).unwrap();
        assert_eq!(read_head(&d.join("wt")).as_deref(), Some("topic"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn model_label_shortened_and_effort_dim() {
        assert_eq!(short_model("Opus 5.5 (1M context)"), "Opus 5.5 · 1M");
        assert_eq!(short_model("Opus 5"), "Opus 5");
        let v = json!({"model": {"display_name": "Opus 5.5 (1M context)"}, "effort": {"level": "medium"}});
        let r = render(&v, &Extras::default(), NOW, 200, true);
        assert_eq!(strip(&r[0]), "8sync · Opus 5.5 · 1M med");
        assert!(r[0].contains("\x1b[2mmed"), "effort is dim");
    }

    #[test]
    fn row2_shows_cwd_basename_outside_git_and_no_color_is_plain() {
        let v = json!({"model": {"display_name": "X"}, "workspace": {"current_dir": "/home/a/proj"}});
        let x = Extras { grant: true, ..Default::default() };
        let r = render(&v, &x, NOW, 200, false);
        assert_eq!(r[1], "proj · 🚢 grant");
        assert!(r.iter().all(|l| !l.contains('\x1b')), "NO_COLOR: no escapes");
        let g = render(&v, &Extras { branch: Some("main".into()), ..Default::default() }, NOW, 200, false);
        assert_eq!(g[1], "⎇ main", "branch wins over basename");
    }

    #[test]
    fn until_and_elapsed() {
        assert_eq!((until(100, 100), until(190, 100), until(4980 + 100, 100)), ("now".to_string(), "2m".to_string(), "1h23m".to_string()));
        assert_eq!((elapsed(40), elapsed(192), elapsed(3720)), ("40s".to_string(), "3m12s".to_string(), "1h02m".to_string()));
    }

    #[test]
    fn noop_uninstall_keeps_bytes_and_writes_no_bak() {
        let d = std::env::temp_dir().join(format!("sl-noop-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (sp, fp) = (d.join("settings.json"), d.join("features.toml"));
        let raw = "{\n    \"theme\": \"dark\",\n    \"env\": {\n        \"X\": \"1\"\n    }\n}\n";
        std::fs::write(&sp, raw).unwrap();
        uninstall_at(&sp, &fp).unwrap();
        assert_eq!(std::fs::read_to_string(&sp).unwrap(), raw, "byte-identical");
        assert!(!d.join("settings.json.bak-8sync").exists(), "no backup when nothing changed");
        assert!(!fp.exists(), "no features file created");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn non_object_settings_is_err() {
        let mut s = json!([1, 2]);
        assert!(install_into(&mut s, "/bin/8sync", &mut toml::Table::new()).is_err());
        assert!(kit_apply(&mut s, "/bin/8sync", Path::new("/nonexistent/f.toml")).is_err());
        assert_eq!(s, json!([1, 2]), "left untouched");
        let d = std::env::temp_dir().join(format!("sl-nonobj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (sp, fp) = (d.join("settings.json"), d.join("features.toml"));
        for raw in ["[]", "42", "null"] {
            std::fs::write(&sp, raw).unwrap();
            assert!(setup_at(&sp, &fp, Some("/bin/8sync"), false).is_err(), "{raw}");
            assert!(uninstall_at(&sp, &fp).is_err(), "{raw}");
            assert_eq!(std::fs::read_to_string(&sp).unwrap(), raw);
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn ship_active_skips_stopped_and_broken_loops() {
        let d = std::env::temp_dir().join(format!("sl-ship2-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let ship = d.join("su-code/ship");
        for s in ["stopped-one", "broken", "live"] {
            std::fs::create_dir_all(ship.join(s)).unwrap();
        }
        std::fs::write(ship.join("ACTIVE"), "stopped-one\nbroken\nlive\n").unwrap();
        std::fs::write(ship.join("stopped-one/loop.json"), r#"{"iter":1,"max_iter":9,"stopped":"done"}"#).unwrap();
        std::fs::write(ship.join("broken/loop.json"), "{not json").unwrap();
        std::fs::write(ship.join("live/loop.json"), r#"{"iter":4,"max_iter":9}"#).unwrap();
        assert_eq!(ship_active(&d), Some((4, 9)));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn agent_names_are_sanitized() {
        let v = json!({"tasks": [{"id": "a", "name": "evil\x1b]0;x\x07name", "status": "running", "startTime": 0}]});
        let row = agents_row(&v, 1000, false).unwrap();
        assert!(!row.chars().any(|c| c.is_control()), "{row:?}");
    }
}
