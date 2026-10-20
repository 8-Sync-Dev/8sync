//! Leftover dev/preview servers of a project. Rooms start `npx vite preview --port 41xx` for a UAT
//! screenshot and kill only the `npx` wrapper; on Windows the `node …/vite.js` child lives on.
//! Seen live 2026-10-20: 73 of them (6 GB) plus 10 tsserver of long-closed worktrees (5.6 GB) on
//! the 3d-game team. `auto revive` (HQ, every 2 min) patrols each project once per [`EVERY_S`],
//! sooner (every [`PRESSURE_EVERY_S`], servers from [`PRESSURE_SERVER_AGE_S`] old) while RAM is at
//! [`PRESSURE_PCT`] or more ("RAM ăn cao quá", owner 2026-10-20).

use std::path::Path;

use serde_json::{json, Value};

use super::idle;
use super::team::Row;
use crate::verbs::hq_core::sampler::{Sample, Sampler};

/// A project is patrolled at most this often.
const EVERY_S: u64 = 600;
/// A dev/preview server younger than this may still be in use.
const SERVER_AGE_S: u64 = 30 * 60;
/// A language server of a worktree that still exists goes only after this long.
const TS_AGE_S: u64 = 6 * 3600;
/// RAM in use (%) from which a project is swept right away …
const PRESSURE_PCT: u32 = 85;
/// … at most this often …
const PRESSURE_EVERY_S: u64 = 120;
/// … taking dev/preview servers from this age.
const PRESSURE_SERVER_AGE_S: u64 = 10 * 60;

/// A node process as the OS lists it.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Proc {
    pub pid: u32,
    pub ppid: u32,
    /// Start time (unix seconds), 0 when the OS did not say.
    pub started: u64,
    /// Resident memory (bytes), 0 when unknown.
    pub rss: u64,
    pub cmd: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Sweep {
    /// The regular pass, once per [`EVERY_S`].
    Patrol,
    /// RAM at [`PRESSURE_PCT`] or more.
    Pressure,
}

impl Sweep {
    fn server_age(self) -> u64 {
        match self {
            Sweep::Patrol => SERVER_AGE_S,
            Sweep::Pressure => PRESSURE_SERVER_AGE_S,
        }
    }
}

/// RAM in use (%) of a sample's `(total, used)` MiB.
fn ram_pct(mem: Option<(u64, u64)>) -> Option<u32> {
    mem.filter(|(t, _)| *t > 0).map(|(t, u)| (u.min(t) * 100 / t) as u32)
}

/// Whether `root` (`key` in the stamps) is swept now: under pressure once per
/// [`PRESSURE_EVERY_S`] (the patrol stamp ignored), else once per [`EVERY_S`].
fn due(stamps: &Value, key: &str, now: u64, ram: Option<u32>) -> Option<Sweep> {
    let since = |k: &str| stamps[k].as_u64().map_or(u64::MAX, |at| now.saturating_sub(at));
    if ram.is_some_and(|r| r >= PRESSURE_PCT) && since(&format!("{key}|pressure")) >= PRESSURE_EVERY_S {
        Some(Sweep::Pressure)
    } else if since(key) >= EVERY_S {
        Some(Sweep::Patrol)
    } else {
        None
    }
}

/// `RAM 88% · CPU 40% · GPU 35% (6120/16303 MB)`; parts the OS did not give are left out.
fn machine_line(s: &Sample) -> String {
    let mut parts = Vec::new();
    if let Some(r) = ram_pct(s.mem) {
        parts.push(format!("RAM {r}%"));
    }
    if let Some(c) = s.cpu_pct {
        parts.push(format!("CPU {c}%"));
    }
    for g in s.gpus.iter().flatten() {
        parts.push(format!("GPU {}% ({}/{} MB)", g.util, g.mem_used, g.mem_total));
    }
    parts.join(" · ")
}

/// RAM in use (%) once `freed` bytes went back.
fn pct_after(mem: (u64, u64), freed: u64) -> Option<u32> {
    let (t, u) = mem;
    ram_pct(Some((t, u.saturating_sub(freed / (1024 * 1024)))))
}

/// `auto revive`'s pass for `root`: a machine row, then one row per leftover server killed
/// ([`pick`]); under RAM pressure also a summary row. Nothing when the sweep is not [`due`].
pub(super) fn tick(home: &Path, root: &Path, now: u64) -> Vec<Row> {
    let sample = Sampler::new().map(|s| s.get(std::time::Duration::ZERO));
    let ram = sample.as_ref().and_then(|s| ram_pct(s.mem));
    let file = idle::state_dir(home).join("reap.json");
    let mut stamps = idle::read_json(&file).filter(Value::is_object).unwrap_or_else(|| json!({}));
    let key = root.to_string_lossy().into_owned();
    let Some(sweep) = due(&stamps, &key, now, ram) else { return Vec::new() };
    stamps[&key] = json!(now);
    if sweep == Sweep::Pressure {
        stamps[format!("{key}|pressure")] = json!(now);
    }
    idle::write_json(&file, &stamps);
    let row = |role: String, state: String| Row { name: "máy".into(), role, model: String::new(), state, short: String::new() };
    let mut rows = Vec::new();
    if let Some(line) = sample.as_ref().map(machine_line).filter(|l| !l.is_empty()) {
        rows.push(row("trạng thái".into(), line));
    }
    let picked = stale_servers(root, now, sweep.server_age());
    let pids: Vec<u32> = picked.iter().map(|p| p.pid).collect();
    let mut freed = (0, 0u64);
    for (p, ok) in picked.iter().zip(kill(&pids)) {
        let what = describe(p, now);
        if ok {
            freed = (freed.0 + 1, freed.1 + p.rss);
        }
        let state = if ok { format!("dọn server cũ: {what}") } else { format!("không dọn được server cũ: {what}") };
        rows.push(row(format!("pid {}", p.pid), state));
    }
    if let (Sweep::Pressure, Some(r), Some(mem)) = (sweep, ram, sample.and_then(|s| s.mem)) {
        let after = pct_after(mem, freed.1).unwrap_or(r);
        rows.push(row("RAM".into(), format!("RAM {r}%: dọn {} server cũ, còn {after}%", freed.0)));
    }
    rows
}

/// `root`'s leftover servers on this machine right now ([`pick`] over the OS listing).
pub(super) fn stale_servers(root: &Path, now: u64, server_age: u64) -> Vec<Proc> {
    let procs = list(now);
    let pids = pick(&procs, root, now, server_age, std::process::id(), &|p| p.exists());
    procs.into_iter().filter(|p| pids.contains(&p.pid)).collect()
}

/// Which of `procs` to kill for `root` at `now`: a node process whose command line names `root`
/// (case-insensitive for a Windows path, `\` = `/`) and that is
/// - a dev/preview server ([`kind`]: `vite` but never `vitest`, `next dev|start`, `webpack serve`,
///   `http-server`, `serve -s`, `live-server`) at least `server_age` old ([`SERVER_AGE_S`],
///   [`PRESSURE_SERVER_AGE_S`] under RAM pressure), or
/// - `tsserver` / `typescript-language-server` of `<root>/.claude/worktrees/<dir>` where `<dir>` is
///   gone (`exists` false) or that is at least [`TS_AGE_S`] old.
///
/// Never `me` or its ancestors (HQ runs `auto revive`), never HQ's own app (`hq-ui`, `hq-channel`),
/// never a process with no start time; a pick whose ancestor is also picked is left to the tree kill.
pub(super) fn pick(procs: &[Proc], root: &Path, now: u64, server_age: u64, me: u32, exists: &dyn Fn(&Path) -> bool) -> Vec<u32> {
    let root_s = root.to_string_lossy();
    let fold = windows_path(&root_s);
    let rootn = norm(&root_s, fold);
    let rootn = rootn.strip_prefix("//?/").unwrap_or(&rootn).trim_end_matches('/');
    if rootn.is_empty() {
        return Vec::new();
    }
    let mut keep = vec![me];
    let mut cur = me;
    while let Some(p) = procs.iter().find(|p| p.pid == cur && p.ppid != 0 && !keep.contains(&p.ppid)) {
        keep.push(p.ppid);
        cur = p.ppid;
    }
    let mut out = Vec::new();
    for p in procs {
        if keep.contains(&p.pid) || p.started == 0 {
            continue;
        }
        let c = norm(&p.cmd, fold);
        if c.contains("hq-ui") || c.contains("hq-channel") || !names(&c, rootn) {
            continue;
        }
        let age = now.saturating_sub(p.started);
        let stale = if kind(&p.cmd).is_some() {
            age >= server_age
        } else if c.contains("tsserver") || c.contains("typescript-language-server") {
            worktree(&c, rootn).is_some_and(|dir| age >= TS_AGE_S || !exists(&root.join(".claude").join("worktrees").join(dir)))
        } else {
            false
        };
        if stale {
            out.push(p.pid);
        }
    }
    // `taskkill /T` on a parent takes its children: killing them again would only fail.
    let parent_of = |pid: u32| procs.iter().find(|p| p.pid == pid).map(|p| p.ppid);
    let picked = out.clone();
    out.retain(|&pid| {
        let mut seen = vec![pid];
        let mut cur = pid;
        while let Some(pp) = parent_of(cur).filter(|pp| *pp != 0 && !seen.contains(pp)) {
            if picked.contains(&pp) {
                return false;
            }
            seen.push(pp);
            cur = pp;
        }
        true
    });
    out
}

/// `C:\…` / `c:/…`: matched case-insensitively.
fn windows_path(s: &str) -> bool {
    let b = s.trim_start_matches(r"\\?\").as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

fn norm(s: &str, fold: bool) -> String {
    let s = s.replace('\\', "/");
    if fold {
        s.to_lowercase()
    } else {
        s
    }
}

/// `c` names `root` as a whole path (not `<root>-2`, not `/x<root>`).
fn names(c: &str, root: &str) -> bool {
    c.match_indices(root).any(|(i, _)| {
        let before = c[..i].chars().next_back();
        let after = c[i + root.len()..].chars().next();
        matches!(before, None | Some('"' | '\'' | ' ' | '=' | '\t')) && matches!(after, None | Some('/' | '"' | '\'' | ' ' | '\t'))
    })
}

/// `<dir>` of the first `<root>/.claude/worktrees/<dir>` in `c` (as `c` spells it).
fn worktree<'a>(c: &'a str, root: &str) -> Option<&'a str> {
    let marker = format!("{root}/.claude/worktrees/");
    let i = c.find(&marker)? + marker.len();
    let dir = c[i..].split(['/', '"', '\'', ' ', '\t']).next()?;
    (!dir.is_empty()).then_some(dir)
}

/// The dev/preview server `cmd` runs (`vite preview`, `next dev`, …), None for anything else.
pub(super) fn kind(cmd: &str) -> Option<String> {
    let c = cmd.to_lowercase().replace('\\', "/");
    if c.contains("vitest") {
        return None;
    }
    let toks: Vec<&str> = c.split_whitespace().map(|t| t.trim_matches(['"', '\''])).collect();
    let stem = |t: &str| {
        let b = t.rsplit('/').next().unwrap_or(t);
        [".js", ".mjs", ".cjs", ".cmd", ".exe"].iter().find_map(|x| b.strip_suffix(x)).unwrap_or(b).to_string()
    };
    for (i, t) in toks.iter().enumerate() {
        let s = stem(t);
        let next = toks.get(i + 1).copied().unwrap_or("");
        let rest = &toks[i + 1..];
        match s.as_str() {
            "vite" if next == "build" => return None,
            "vite" if matches!(next, "preview" | "dev" | "serve") => return Some(format!("vite {next}")),
            "vite" => return Some("vite".into()),
            "next" if matches!(next, "dev" | "start") => return Some(format!("next {next}")),
            "http-server" => return Some("http-server".into()),
            "live-server" => return Some("live-server".into()),
            _ => {}
        }
        if t.contains("webpack") && rest.contains(&"serve") {
            return Some("webpack serve".into());
        }
        if (s == "serve" || t.contains("/serve/build/")) && rest.contains(&"-s") {
            return Some("serve -s".into());
        }
    }
    None
}

/// `--port 4197` / `--port=4197` / `-p 4197`.
fn port(cmd: &str) -> Option<&str> {
    let toks: Vec<&str> = cmd.split_whitespace().map(|t| t.trim_matches(['"', '\''])).collect();
    toks.iter().enumerate().find_map(|(i, t)| {
        let v = t.strip_prefix("--port=").or_else(|| matches!(*t, "--port" | "-p").then(|| toks.get(i + 1).copied()).flatten())?;
        v.chars().all(|c| c.is_ascii_digit()).then_some(v)
    })
}

/// `vite preview :4197 (2h 10m, 120 MB)`.
fn describe(p: &Proc, now: u64) -> String {
    let what = kind(&p.cmd).unwrap_or_else(|| if p.cmd.contains("typescript-language-server") { "typescript-language-server".into() } else { "tsserver".into() });
    let port = port(&p.cmd).map(|x| format!(" :{x}")).unwrap_or_default();
    let m = now.saturating_sub(p.started) / 60;
    let age = if m >= 60 { format!("{}h {}m", m / 60, m % 60) } else { format!("{m}m") };
    let mem = if p.rss > 0 { format!(", {} MB", p.rss / (1024 * 1024)) } else { String::new() };
    format!("{what}{port} ({age}{mem})")
}

/// Kills each pid with its tree; `true` where the kill went through. Never by image name.
fn kill(pids: &[u32]) -> Vec<bool> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        pids.iter()
            .map(|pid| {
                std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                    .status()
                    .is_ok_and(|s| s.success())
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        let sig = |s: &str, pid: u32| {
            std::process::Command::new("kill")
                .args([s, &pid.to_string()])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|x| x.success())
        };
        let sent: Vec<bool> = pids.iter().map(|&p| sig("-TERM", p)).collect();
        if sent.iter().any(|&s| s) {
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
        pids.iter().zip(sent).map(|(&p, ok)| ok && (!sig("-0", p) || sig("-KILL", p))).collect()
    }
}

/// Node processes on this machine (empty when the OS listing fails).
fn list(now: u64) -> Vec<Proc> {
    #[cfg(windows)]
    {
        let _ = now;
        use std::os::windows::process::CommandExt;
        let ps = "Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' | Select ProcessId,ParentProcessId,WorkingSetSize,CommandLine,@{n='Started';e={if($_.CreationDate){([DateTimeOffset]$_.CreationDate).ToUnixTimeSeconds()}else{0}}} | ConvertTo-Json -Compress";
        let mut c = std::process::Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-Command", ps])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        crate::verbs::hq_core::agents::run_bounded(c, std::time::Duration::from_secs(15))
            .map(|o| parse_windows(&String::from_utf8_lossy(&o)))
            .unwrap_or_default()
    }
    #[cfg(target_os = "linux")]
    {
        let _ = now;
        list_linux()
    }
    #[cfg(target_os = "macos")]
    {
        let mut c = std::process::Command::new("ps");
        c.args(["-axo", "pid=,ppid=,etime=,rss=,command="])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        crate::verbs::hq_core::agents::run_bounded(c, std::time::Duration::from_secs(15))
            .map(|o| parse_ps(&String::from_utf8_lossy(&o), now))
            .unwrap_or_default()
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = now;
        Vec::new()
    }
}

/// `ConvertTo-Json` of the `Win32_Process` rows: an array, or one object for a single process.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn parse_windows(s: &str) -> Vec<Proc> {
    let v: Value = serde_json::from_str(s.trim()).unwrap_or(Value::Null);
    let rows = match v {
        Value::Array(a) => a,
        o @ Value::Object(_) => vec![o],
        _ => Vec::new(),
    };
    rows.iter()
        .filter_map(|r| {
            Some(Proc {
                pid: u32::try_from(r["ProcessId"].as_u64()?).ok()?,
                ppid: r["ParentProcessId"].as_u64().and_then(|x| u32::try_from(x).ok()).unwrap_or(0),
                started: r["Started"].as_u64().unwrap_or(0),
                rss: r["WorkingSetSize"].as_u64().unwrap_or(0),
                cmd: r["CommandLine"].as_str()?.to_string(),
            })
        })
        .collect()
}

/// `ps -axo pid=,ppid=,etime=,rss=,command=` (macOS: `etime` is `[[dd-]hh:]mm:ss`, `rss` KB),
/// node processes only.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
fn parse_ps(s: &str, now: u64) -> Vec<Proc> {
    s.lines()
        .filter_map(|l| {
            let mut f = l.split_whitespace();
            let pid = f.next()?.parse().ok()?;
            let ppid = f.next()?.parse().ok()?;
            let etime = f.next()?;
            let rss: u64 = f.next()?.parse().ok()?;
            let cmd = f.collect::<Vec<_>>().join(" ");
            let argv0 = cmd.split_whitespace().next()?;
            if !argv0.rsplit('/').next()?.starts_with("node") {
                return None;
            }
            let (days, hms) = etime.split_once('-').map_or((0, etime), |(d, r)| (d.parse().unwrap_or(0), r));
            let secs = hms.split(':').try_fold(0u64, |acc, x| x.parse::<u64>().ok().map(|n| acc * 60 + n))?;
            Some(Proc { pid, ppid, started: now.saturating_sub(days * 86_400 + secs), rss: rss * 1024, cmd })
        })
        .collect()
}

/// `/proc/<pid>/{cmdline,stat,statm}` of node processes; start = boot time + field 22 (USER_HZ 100).
#[cfg(target_os = "linux")]
fn list_linux() -> Vec<Proc> {
    let Some(btime) = std::fs::read_to_string("/proc/stat")
        .ok()
        .and_then(|s| s.lines().find_map(|l| l.strip_prefix("btime ").and_then(|x| x.trim().parse::<u64>().ok())))
    else {
        return Vec::new();
    };
    let Ok(dir) = std::fs::read_dir("/proc") else { return Vec::new() };
    dir.flatten()
        .filter_map(|e| {
            let pid: u32 = e.file_name().to_str()?.parse().ok()?;
            let raw = std::fs::read(e.path().join("cmdline")).ok()?;
            let argv: Vec<String> = raw.split(|b| *b == 0).filter(|a| !a.is_empty()).map(|a| String::from_utf8_lossy(a).into_owned()).collect();
            if !argv.first()?.rsplit('/').next()?.starts_with("node") {
                return None;
            }
            let stat = std::fs::read_to_string(e.path().join("stat")).ok()?;
            let f: Vec<&str> = stat.rsplit_once(')')?.1.split_whitespace().collect();
            let ppid = f.get(1)?.parse().ok()?;
            let ticks: u64 = f.get(19)?.parse().ok()?;
            let rss = std::fs::read_to_string(e.path().join("statm"))
                .ok()
                .and_then(|s| s.split_whitespace().nth(1).and_then(|x| x.parse::<u64>().ok()))
                .map_or(0, |pages| pages * 4096);
            Some(Proc { pid, ppid, started: btime + ticks / 100, rss, cmd: argv.join(" ") })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const NOW: u64 = 1_000_000;

    fn p(pid: u32, ppid: u32, age_min: u64, cmd: &str) -> Proc {
        Proc { pid, ppid, started: NOW - age_min * 60, rss: 120 * 1024 * 1024, cmd: cmd.into() }
    }

    fn all_exist(_: &Path) -> bool {
        true
    }

    #[test]
    fn windows_picks_only_old_servers_of_this_project() {
        let root = PathBuf::from(r"C:\Users\Projects\startup\8sync-startup\game\3d-game");
        let procs = vec![
            // HQ: runs `auto revive` (me = 2), its own next start in hq-ui.
            p(1, 0, 900, r#""C:\Program Files\nodejs\node.exe" C:\Users\Admin\AppData\Local\8sync\hq-ui\server.js"#),
            p(3, 0, 900, r#"node C:\users\projects\startup\8sync-startup\game\3d-game\node_modules\next\dist\bin\next start"#),
            // old vite preview in the root, path cased and slashed differently: picked.
            p(10, 0, 130, r#""C:\Program Files\nodejs\node.exe" "c:/users/projects/startup/8sync-startup/game/3D-GAME/node_modules/vite/bin/vite.js" preview --port 4197 --strictPort"#),
            // old vite in a card worktree: picked.
            p(11, 0, 45, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-46\node_modules\vite\bin\vite.js preview --port 4120"#),
            // young vite: kept.
            p(12, 0, 10, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\node_modules\vite\bin\vite.js preview --port 4121"#),
            // vitest worker: kept.
            p(13, 0, 300, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\node_modules\vitest\dist\workers\forks.js"#),
            // old vite of another project (and a sibling sharing the prefix): kept.
            p(14, 0, 300, r#"node C:\Users\Projects\startup\8sync-startup\game\other\node_modules\vite\bin\vite.js preview"#),
            p(15, 0, 300, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game-2\node_modules\vite\bin\vite.js"#),
            // tsserver of a deleted worktree: picked; of a live young worktree: kept; of the root: kept.
            p(16, 0, 60, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-12\node_modules\typescript\lib\tsserver.js --useNodeIpc"#),
            p(17, 0, 60, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-50\node_modules\typescript\lib\tsserver.js"#),
            p(18, 0, 900, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\node_modules\typescript\lib\tsserver.js"#),
            // tsserver of a live worktree older than 6 h: picked.
            p(19, 0, 400, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\.claude\worktrees\card-50\node_modules\.bin\typescript-language-server --stdio"#),
            // a node script in the root that is no server: kept.
            p(20, 0, 900, r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\scripts\watch-assets.js"#),
            // no start time: kept.
            Proc { pid: 21, ppid: 0, started: 0, rss: 0, cmd: r#"node C:\Users\Projects\startup\8sync-startup\game\3d-game\node_modules\vite\bin\vite.js"#.into() },
        ];
        let me_tree = vec![Proc { pid: 2, ppid: 3, started: NOW, rss: 0, cmd: String::new() }];
        let procs: Vec<Proc> = procs.into_iter().chain(me_tree).collect();
        let exists = |d: &Path| !d.to_string_lossy().contains("card-12");
        assert_eq!(pick(&procs, &root, NOW, SERVER_AGE_S, 2, &exists), vec![10, 11, 16, 19]);
        // Under RAM pressure the 10-min-old vite goes too; nothing else changes.
        assert_eq!(pick(&procs, &root, NOW, PRESSURE_SERVER_AGE_S, 2, &exists), vec![10, 11, 12, 16, 19]);
        assert_eq!(describe(&procs[2], NOW), "vite preview :4197 (2h 10m, 120 MB)");
    }

    #[test]
    fn unix_paths_are_case_sensitive_and_children_go_with_their_parent() {
        let root = PathBuf::from("/home/dev/game");
        let procs = vec![
            p(30, 1, 200, "node /home/dev/game/node_modules/.bin/next dev -p 3000"),
            p(31, 30, 200, "node /home/dev/game/node_modules/next/dist/server/lib/start-server.js /home/dev/game/node_modules/vite/bin/vite.js"),
            p(32, 1, 200, "node /home/dev/Game/node_modules/vite/bin/vite.js"),
            p(33, 1, 200, "node /home/dev/game/node_modules/http-server/bin/http-server dist -p 8080"),
            p(34, 1, 200, "node /home/dev/game/node_modules/serve/build/main.js -s dist"),
            p(35, 1, 200, "node /home/dev/game/node_modules/webpack-cli/bin/cli.js serve --port=9000"),
            p(36, 1, 200, "node /home/dev/game/node_modules/vite/bin/vite.js build --watch"),
            p(37, 1, 200, "node /home/dev/game/node_modules/live-server/live-server.js"),
        ];
        assert_eq!(pick(&procs, &root, NOW, SERVER_AGE_S, 99, &all_exist), vec![30, 33, 34, 35, 37]);
        assert_eq!(describe(&procs[0], NOW), "next dev :3000 (3h 20m, 120 MB)");
        assert_eq!(describe(&procs[5], NOW).split(' ').take(3).collect::<Vec<_>>(), ["webpack", "serve", ":9000"]);
    }

    #[test]
    fn parses_the_os_listings() {
        let one = r#"{"ProcessId":7,"ParentProcessId":1,"WorkingSetSize":2048,"CommandLine":"node a.js","Started":123}"#;
        assert_eq!(parse_windows(one), vec![Proc { pid: 7, ppid: 1, started: 123, rss: 2048, cmd: "node a.js".into() }]);
        let many = r#"[{"ProcessId":7,"ParentProcessId":1,"WorkingSetSize":1,"CommandLine":null,"Started":0},{"ProcessId":8,"ParentProcessId":7,"WorkingSetSize":1,"CommandLine":"node b","Started":5}]"#;
        assert_eq!(parse_windows(many).iter().map(|p| p.pid).collect::<Vec<_>>(), vec![8]);
        assert!(parse_windows("").is_empty());
        let ps = "  41     1 1-02:03:04  2048 /usr/local/bin/node /x/vite.js preview\n  42 1 05:06 10 /bin/zsh -l\n 43 1 07 1 node y.js\n";
        let got = parse_ps(ps, NOW);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], Proc { pid: 41, ppid: 1, started: NOW - (86_400 + 2 * 3600 + 3 * 60 + 4), rss: 2048 * 1024, cmd: "/usr/local/bin/node /x/vite.js preview".into() });
        assert_eq!(got[1].started, NOW - 7);
    }

    #[test]
    fn sweeps_every_ten_minutes_and_every_two_under_ram_pressure() {
        let k = "C:/p";
        let none = json!({});
        assert_eq!(due(&none, k, NOW, None), Some(Sweep::Patrol));
        assert_eq!(due(&none, k, NOW, Some(90)), Some(Sweep::Pressure));
        let patrolled = json!({ k: NOW - 60 });
        assert_eq!(due(&patrolled, k, NOW, Some(84)), None);
        assert_eq!(due(&patrolled, k, NOW, Some(85)), Some(Sweep::Pressure), "pressure ignores the 10-min stamp");
        let pressed = json!({ k: NOW - 60, "C:/p|pressure": NOW - 60 });
        assert_eq!(due(&pressed, k, NOW, Some(95)), None, "at most once per 2 min");
        let pressed = json!({ k: NOW - 130, "C:/p|pressure": NOW - 130 });
        assert_eq!(due(&pressed, k, NOW, Some(95)), Some(Sweep::Pressure));
        assert_eq!(due(&pressed, k, NOW, Some(50)), None);
        assert_eq!(due(&json!({ k: NOW - 600 }), k, NOW, Some(50)), Some(Sweep::Patrol));
        assert_eq!(due(&json!({ "C:/other": NOW }), k, NOW, None), Some(Sweep::Patrol), "stamps are per project");
        assert_eq!((Sweep::Patrol.server_age(), Sweep::Pressure.server_age()), (1800, 600));
    }

    #[test]
    fn machine_numbers() {
        assert_eq!(ram_pct(Some((65_536, 57_672))), Some(88));
        assert_eq!(ram_pct(Some((0, 0))), None);
        assert_eq!(ram_pct(None), None);
        assert_eq!(pct_after((65_536, 57_672), 6 * 1024 * 1024 * 1024), Some(78));
        let gpu = crate::verbs::hq_core::sampler::Gpu { name: "RTX".into(), util: 35, mem_used: 6120, mem_total: 16303, temp: None, watts: None };
        let s = Sample { mem: Some((65_536, 57_672)), cpu_pct: Some(40), gpus: Some(vec![gpu]), ..Sample::default() };
        assert_eq!(machine_line(&s), "RAM 88% · CPU 40% · GPU 35% (6120/16303 MB)");
        assert_eq!(machine_line(&Sample { cpu_pct: Some(3), ..Sample::default() }), "CPU 3%");
    }
}
