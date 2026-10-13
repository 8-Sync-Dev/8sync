//! `8sync ccc statusline`: a Claude Code `statusLine` command (1–2 ANSI rows, plus a chained
//! third row) and `--agents` for `subagentStatusLine`. Reads the stdin JSON Claude Code sends
//! (https://code.claude.com/docs/en/statusline) plus a few cheap local reads; no network, no `gh`.
//! The renderer is pure (`render`, `agents_lines`); `gather` does the I/O. It always exits 0 and
//! falls back to a minimal `8sync · <model>` row, so a broken field never blanks the bar.
//!
//! Setup: `--install` / `--uninstall`. A foreign `statusLine` command is parked as
//! `statusLine_prev` in `~/.config/8sync/features.toml` and chained (same stdin, output appended
//! as the last row), so e.g. the Orca statusline keeps working. Optional background-work count:
//! `~/.local/state/8sync/ccc/bg/<session_id>.json` (a JSON array or object; its length is shown).
//! The watchdog alert shown is the latest line of `alerts.jsonl` younger than 10 minutes (the
//! alerts file has no per-viewer "seen" cursor).
use crate::verbs::session_view::{scan_file, truncate, Fmt};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const RST: &str = "\x1b[0m";
const PREV_KEY: &str = "statusLine_prev";
const ALERT_FRESH_S: u64 = 600;

/// Everything `gather` reads from disk or git; `render` only formats it.
#[derive(Default, Debug)]
pub(super) struct Extras {
    pub branch: Option<String>,
    pub dirty: bool,
    /// (done, total, current task title)
    pub tasks: Option<(usize, usize, Option<String>)>,
    pub bg: usize,
    pub alert: Option<String>,
    /// (iter, max_iter)
    pub looping: Option<(u64, u64)>,
    pub grant: bool,
    pub chained: Vec<String>,
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

fn row1(v: &Value, now: u64, color: bool) -> String {
    let mut seg = vec![paint(color, "1;35", "8sync")];
    if let Some(m) = v["model"]["display_name"].as_str().or_else(|| v["model"]["id"].as_str()) {
        let eff = v["effort"]["level"].as_str().map(|e| format!(" {}", paint(color, "2", &format!("({e})")))).unwrap_or_default();
        seg.push(format!("{}{eff}", paint(color, "36", m)));
    }
    if v["context_window"].is_object() {
        let p = pct_of(&v["context_window"]["used_percentage"]).unwrap_or(0);
        seg.push(format!("ctx {} {}", bar(p, color), paint(color, pct_color(p), &format!("{p}%"))));
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
        let cur = cur.as_deref().map(|t| format!(" ▸ {}", truncate(t, 40))).unwrap_or_default();
        seg.push(format!("tasks {done}/{total}{cur}"));
    }
    if x.bg > 0 {
        seg.push(paint(color, "36", &format!("bg {}", x.bg)));
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
    let mut rows = vec![row1(v, now, color)];
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
                let name = t["name"].as_str().or_else(|| t["agentType"].as_str()).unwrap_or("agent");
                let s = t["startTime"].as_u64().map(|st| now_ms.saturating_sub(st) / 1000).unwrap_or(0);
                running.push(format!("{} {}", truncate(name, 20), elapsed(s)));
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

/// Run `cmd`, give it `budget`, kill it after that, return whatever it printed.
fn run_budget(mut cmd: Command, stdin: Option<&str>, budget: Duration) -> Option<String> {
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut c = cmd.spawn().ok()?;
    if let (Some(inp), Some(mut si)) = (stdin, c.stdin.take()) {
        let _ = si.write_all(inp.as_bytes());
    }
    let end = Instant::now() + budget;
    loop {
        match c.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(1)),
            _ => {
                let _ = c.kill();
                let _ = c.wait();
                break;
            }
        }
    }
    let mut out = String::new();
    c.stdout.take()?.read_to_string(&mut out).ok()?;
    Some(out)
}

fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let mut c = Command::new("git");
    c.arg("-C").arg(cwd).args(args);
    run_budget(c, None, Duration::from_millis(50)).map(|s| s.trim().to_string())
}

fn ship_active(cwd: &Path) -> Option<(u64, u64)> {
    let dir = cwd.ancestors().map(|d| d.join("su-code/ship")).find(|d| d.is_dir())?;
    let slug = std::fs::read_to_string(dir.join("ACTIVE")).ok()?.trim().to_string();
    if slug.is_empty() || slug.starts_with('.') || !slug.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return None;
    }
    let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(&slug).join("loop.json")).ok()?).ok()?;
    v["stopped"].is_null().then(|| (v["iter"].as_u64().unwrap_or(0), v["max_iter"].as_u64().unwrap_or(0)))
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
    (now.saturating_sub(v["ts"].as_u64()?) <= ALERT_FRESH_S).then(|| v["kind"].as_str().unwrap_or("alert").to_string())
}

fn features(home: &Path) -> PathBuf {
    crate::brand::config_dir(home).join("features.toml")
}

fn prev_cmd(home: &Path) -> Option<String> {
    let t = std::fs::read_to_string(features(home)).ok()?.parse::<toml::Table>().ok()?;
    t.get(PREV_KEY)?.as_str().map(str::to_string).filter(|c| !c.trim().is_empty() && !is_ours(c))
}

fn gather(v: &Value, input: &str, home: &Path, now: u64) -> Extras {
    let mut x = Extras::default();
    let cwd = v["workspace"]["current_dir"].as_str().or_else(|| v["cwd"].as_str()).unwrap_or("");
    let sid = v["session_id"].as_str();
    x.branch = v["worktree"]["branch"].as_str().map(str::to_string).or_else(|| if cwd.is_empty() { None } else { git(cwd, &["symbolic-ref", "--short", "HEAD"]).filter(|b| !b.is_empty()) });
    if x.branch.is_some() && !cwd.is_empty() {
        x.dirty = git(cwd, &["status", "--porcelain"]).is_some_and(|s| !s.is_empty());
    }
    if let Some(tp) = v["transcript_path"].as_str() {
        let d = scan_file(Path::new(tp), Fmt::Claude, false);
        if !d.tasks.is_empty() {
            x.tasks = Some((d.tasks_done(), d.tasks.len(), d.current_task().map(|t| t.title.clone())));
        }
    }
    if let Some(id) = sid.and_then(crate::verbs::watchdog::safe_id) {
        let p = home.join(".local/state/8sync/ccc/bg").join(format!("{id}.json"));
        x.bg = std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).map_or(0, |b| b.as_array().map(Vec::len).or_else(|| b.as_object().map(|o| o.len())).unwrap_or(0));
    }
    x.alert = fresh_alert(home, now);
    if !cwd.is_empty() {
        x.looping = ship_active(Path::new(cwd));
    }
    x.grant = super::grant::allows(&super::grant::dir(home), sid, false, now);
    if std::env::var_os("EIGHTSYNC_STATUSLINE_CHAIN").is_none() {
        if let Some(prev) = prev_cmd(home) {
            let mut c = Command::new("sh");
            c.arg("-c").arg(prev).env("EIGHTSYNC_STATUSLINE_CHAIN", "1");
            if let Some(out) = run_budget(c, Some(input), Duration::from_millis(400)) {
                x.chained = out.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).map(str::to_string).collect();
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
    let r = std::panic::catch_unwind(|| {
        let (home, now) = (dirs::home_dir().unwrap_or_default(), now_s());
        render(&v, &gather(&v, input, &home, now), now, cols(), color)
    });
    r.unwrap_or_else(|_| {
        let m = v["model"]["display_name"].as_str().unwrap_or("");
        vec![format!("8sync · {m}")]
    })
}

// ── install ─────────────────────────────────────────────────────────────────

pub(super) fn is_ours(cmd: &str) -> bool {
    cmd.contains("ccc statusline")
}

fn quote(exe: &str) -> String {
    if exe.chars().any(char::is_whitespace) {
        format!("'{exe}'")
    } else {
        exe.to_string()
    }
}

fn status_value(exe: &str) -> Value {
    json!({ "type": "command", "command": format!("{} ccc statusline", quote(exe)), "padding": 0, "refreshInterval": 5 })
}

fn agents_value(exe: &str) -> Value {
    json!({ "type": "command", "command": format!("{} ccc statusline --agents", quote(exe)) })
}

fn cmd_of(v: &Value) -> Option<&str> {
    v["command"].as_str()
}

/// Kit side: set both lines when absent, refresh ours, never override another. Returns whether a
/// foreign `statusLine` was left alone (the kit then prints a hint).
pub(super) fn kit_apply(settings: &mut Value, exe: &str) -> bool {
    let foreign = cmd_of(&settings["statusLine"]).is_some_and(|c| !is_ours(c)) || (settings.get("statusLine").is_some() && cmd_of(&settings["statusLine"]).is_none());
    if !foreign {
        settings["statusLine"] = status_value(exe);
    }
    if settings.get("subagentStatusLine").is_none_or(|s| cmd_of(s).is_some_and(is_ours)) {
        settings["subagentStatusLine"] = agents_value(exe);
    }
    foreign
}

/// `--install` on parsed settings + features. Returns human lines.
pub(super) fn install_into(settings: &mut Value, exe: &str, feats: &mut toml::Table) -> Vec<String> {
    let mut msg = Vec::new();
    match settings.get("statusLine").cloned() {
        Some(old) if cmd_of(&old).is_some_and(|c| !is_ours(c)) => {
            let c = cmd_of(&old).unwrap_or_default().to_string();
            msg.push(format!("statusLine: kept your command as {PREV_KEY} and chained it as the last row ({c})"));
            feats.insert(PREV_KEY.into(), toml::Value::String(c));
        }
        Some(old) if cmd_of(&old).is_none() => {
            msg.push("statusLine: existing entry has no command, left as is".into());
            return msg;
        }
        _ => msg.push("statusLine: installed".into()),
    }
    settings["statusLine"] = status_value(exe);
    match settings.get("subagentStatusLine") {
        Some(s) if !cmd_of(s).is_some_and(is_ours) => msg.push("subagentStatusLine: yours kept (not replaced)".into()),
        _ => {
            settings["subagentStatusLine"] = agents_value(exe);
            msg.push("subagentStatusLine: installed".into());
        }
    }
    msg
}

/// `--uninstall`: drop ours, restore `statusLine_prev`.
pub(super) fn uninstall_from(settings: &mut Value, feats: &mut toml::Table) -> Vec<String> {
    let mut msg = Vec::new();
    let ours = |s: &Value| cmd_of(s).is_some_and(is_ours);
    if ours(&settings["statusLine"]) {
        let prev = feats.remove(PREV_KEY).and_then(|p| p.as_str().map(str::to_string));
        match prev {
            Some(p) => {
                settings["statusLine"] = json!({ "type": "command", "command": p });
                msg.push("statusLine: restored your previous command".into());
            }
            None => {
                settings.as_object_mut().map(|o| o.remove("statusLine"));
                msg.push("statusLine: removed".into());
            }
        }
    }
    if ours(&settings["subagentStatusLine"]) {
        settings.as_object_mut().map(|o| o.remove("subagentStatusLine"));
        msg.push("subagentStatusLine: removed".into());
    }
    msg
}

fn claude_dir(home: &Path) -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home.join(".claude"))
}

fn setup(home: &Path, uninstall: bool) -> Result<()> {
    let sp = claude_dir(home).join("settings.json");
    let fp = features(home);
    let raw = std::fs::read_to_string(&sp).unwrap_or_default();
    let mut s: Value = if raw.trim().is_empty() { json!({}) } else { serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", sp.display()))? };
    let fraw = std::fs::read_to_string(&fp).unwrap_or_default();
    let mut f: toml::Table = fraw.parse().map_err(|e| anyhow::anyhow!("{} is not valid TOML ({e}); fix it first", fp.display()))?;
    let msgs = if uninstall {
        uninstall_from(&mut s, &mut f)
    } else {
        install_into(&mut s, &super::hook_exe()?, &mut f)
    };
    let out = serde_json::to_string_pretty(&s)? + "\n";
    if out != raw {
        std::fs::create_dir_all(sp.parent().context("no parent")?)?;
        std::fs::write(&sp, out)?;
    }
    let fout = toml::to_string_pretty(&f)?;
    if fout != fraw && (!f.is_empty() || !fraw.is_empty()) {
        std::fs::create_dir_all(fp.parent().context("no parent")?)?;
        std::fs::write(&fp, fout)?;
    }
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
        Extras { branch: Some("feat/x".into()), dirty: true, tasks: Some((2, 5, Some("viết test".into()))), bg: 2, alert: Some("mem".into()), looping: Some((3, 12)), grant: true, chained: vec![] }
    }

    #[test]
    fn full_fields() {
        let r = render(&full(), &extras(), NOW, 400, true);
        assert_eq!(r.len(), 2);
        let (a, b) = (strip(&r[0]), strip(&r[1]));
        assert_eq!(a, "8sync · Opus 5 (high) · ctx ▓▓▓▓▓░░░░░ 42% · 5h 24% ↻ 1h23m · 7d 85% ↻ 2d4h · $0.01 · +156/-23");
        assert_eq!(b, "⎇ feat/x* · #12 ✓ · tasks 2/5 ▸ viết test · bg 2 · ⚠ mem · loop 3/12 · 🚢 grant");
        assert!(r[0].contains("\x1b[31m85%"), "7d over 80 is red");
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
        assert!(!statusline("not json").is_empty());
    }

    #[test]
    fn install_uninstall_roundtrip_with_chain() {
        let mut s = json!({"theme": "dark", "statusLine": {"type": "command", "command": "orca-status --x"}});
        let mut f = toml::Table::new();
        f.insert("serena".into(), toml::Value::Boolean(true));
        install_into(&mut s, "/bin/8sync", &mut f);
        assert_eq!(s["statusLine"]["command"], "/bin/8sync ccc statusline");
        assert_eq!(s["statusLine"]["refreshInterval"], 5);
        assert_eq!(s["subagentStatusLine"]["command"], "/bin/8sync ccc statusline --agents");
        assert_eq!(f[PREV_KEY].as_str(), Some("orca-status --x"));
        // idempotent: a second install must not park our own command as prev
        install_into(&mut s, "/bin/8sync", &mut f);
        assert_eq!(f[PREV_KEY].as_str(), Some("orca-status --x"));
        uninstall_from(&mut s, &mut f);
        assert_eq!(s["statusLine"]["command"], "orca-status --x");
        assert!(s.get("subagentStatusLine").is_none());
        assert!(f.get(PREV_KEY).is_none() && f["serena"].as_bool() == Some(true));
        assert_eq!(s["theme"], "dark");
    }

    #[test]
    fn install_fresh_then_remove_and_foreign_subagent_kept() {
        let mut s = json!({"subagentStatusLine": {"type": "command", "command": "mine"}});
        let mut f = toml::Table::new();
        install_into(&mut s, "/opt/my dir/8sync", &mut f);
        assert_eq!(s["statusLine"]["command"], "'/opt/my dir/8sync' ccc statusline");
        assert_eq!(s["subagentStatusLine"]["command"], "mine");
        assert!(f.is_empty());
        uninstall_from(&mut s, &mut f);
        assert!(s.get("statusLine").is_none());
        assert_eq!(s["subagentStatusLine"]["command"], "mine");
    }

    #[test]
    fn kit_never_overrides_foreign() {
        let mut s = json!({"statusLine": {"type": "command", "command": "orca"}});
        assert!(kit_apply(&mut s, "/bin/8sync"));
        assert_eq!(s["statusLine"]["command"], "orca");
        let mut e = json!({});
        assert!(!kit_apply(&mut e, "/bin/8sync"));
        assert!(is_ours(e["statusLine"]["command"].as_str().unwrap()));
    }

    #[test]
    fn until_and_elapsed() {
        assert_eq!((until(100, 100), until(190, 100), until(4980 + 100, 100)), ("now".to_string(), "2m".to_string(), "1h23m".to_string()));
        assert_eq!((elapsed(40), elapsed(192), elapsed(3720)), ("40s".to_string(), "3m12s".to_string(), "1h02m".to_string()));
    }
}
