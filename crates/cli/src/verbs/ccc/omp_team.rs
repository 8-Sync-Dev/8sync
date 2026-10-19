//! Team omp of `8sync ccc auto up|down` ([`super::team`]): next to every Claude Code role room, one
//! omp room per role named `omp-<role>`, an `8sync . <name>` named session of this repo
//! ([`crate::verbs::session`]; inbox id = [`ccc_core::room_id`], the `8sync-team.ts` extension
//! delivers inbox, target nudges and `8sync ccc msg`). `up` makes sure the session exists (created,
//! never launched here), then runs `8sync . omp-<role>` in a detached terminal so the room outlives
//! the owner's shell:
//! - Linux/macOS with `tmux`: `tmux new-session -d -s 8sync-omp-<role>-<6 hex of the room id>`; left
//!   alone when that tmux session exists or `/proc` shows omp on the room's session dir;
//! - Windows with `wt.exe`: a tab of the Windows Terminal window `8sync-omp`; left alone when an omp
//!   process carries the room's session dir;
//! - otherwise: the exact command per room, for the owner to run.
//!
//! `down` stops only this repo's `omp-<role>` rooms: `tmux kill-session`, or on Windows the omp
//! processes whose command line carries the room's session dir (that process only: omp's worker
//! daemons may serve other sessions). The conversation stays in the session dir; `up` continues it.
//! The team runs on omp's default model; [`super::auto::omp_blocked`] keeps it off on `anthropic/…`.
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{bail, Result};
use serde_json::Value;

use super::room;
use crate::env_detect::Env;
use crate::verbs::{session, session_view};

const PREFIX: &str = "omp-";
/// The Windows Terminal window the omp rooms open in (`wt -w <name>` reuses it).
const WT_WINDOW: &str = "8sync-omp";

pub(super) fn room_name(role: &str) -> String {
    format!("{PREFIX}{role}")
}

/// `auto up` brings team omp up: `--omp` given, or omp already in auto.json's teams (the owner
/// turned it on from HQ or `auto omp on`). `status` = what `auto status --json` reports.
pub(super) fn wanted(flag: bool, status: &Value) -> bool {
    flag || status["teams"].as_array().is_some_and(|a| a.iter().any(|t| t == "omp"))
}

/// The role of a team room: `omp-<role>`. Every other omp session (`core`, `omp`, the owner's own
/// names) is not the team's and `down` never touches it.
pub(super) fn role_of(name: &str) -> Option<&str> {
    name.strip_prefix(PREFIX).filter(|r| !r.is_empty())
}

/// tmux session of a room: `8sync-omp-<role>-<first 6 hex of the room id>`. The id hashes the repo
/// root, so the `lead` rooms of two repos never share a session. tmux turns `.` and `:` of a
/// session name into `_`: done here so `has-session` / `kill-session` find what `new-session` made.
pub(super) fn tmux_session(role: &str, room_id: &str) -> String {
    let hex: String = room_id.strip_prefix("omp-").unwrap_or(room_id).chars().take(6).collect();
    let role: String = role.chars().map(|c| if matches!(c, '.' | ':') { '_' } else { c }).collect();
    format!("8sync-omp-{role}-{hex}")
}

/// Where a room runs detached.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Host {
    Tmux(PathBuf),
    Wt(PathBuf),
    /// No detached terminal: the owner runs the printed command.
    Manual,
}

/// Windows uses `wt.exe`, Linux/macOS `tmux`; the other one does not count on that platform.
pub(super) fn host(windows: bool, tmux: Option<PathBuf>, wt: Option<PathBuf>) -> Host {
    match (windows, tmux, wt) {
        (true, _, Some(w)) => Host::Wt(w),
        (false, Some(t), _) => Host::Tmux(t),
        _ => Host::Manual,
    }
}

/// Argv (program first) that starts the room of `role` detached: `<exe> . omp-<role>` in `root`.
/// None on [`Host::Manual`].
pub(super) fn spawn_argv(host: &Host, role: &str, sess: &str, root: &Path, exe: &Path) -> Option<Vec<OsString>> {
    let room = room_name(role);
    let head: Vec<OsString> = match host {
        Host::Tmux(t) => vec![t.into(), "new-session".into(), "-d".into(), "-s".into(), sess.into(), "-c".into(), root.into()],
        Host::Wt(w) => vec![w.into(), "-w".into(), WT_WINDOW.into(), "new-tab".into(), "--title".into(), room.clone().into(), "-d".into(), root.into()],
        Host::Manual => return None,
    };
    Some(head.into_iter().chain([exe.into(), ".".into(), room.into()]).collect())
}

/// `tmux <verb> -t =<sess>`: `=` is an exact match (a bare name also matches a longer one).
pub(super) fn tmux_argv(tmux: &Path, verb: &str, sess: &str) -> Vec<OsString> {
    vec![tmux.into(), verb.into(), "-t".into(), format!("={sess}").into()]
}

/// Ends one omp process, not its tree: omp's worker daemons can serve other omp sessions.
pub(super) fn taskkill_argv(pid: u32) -> Vec<OsString> {
    vec!["taskkill".into(), "/PID".into(), pid.to_string().into(), "/F".into()]
}

/// The command the owner runs for a room when no detached terminal is there (PowerShell on Windows).
/// Paths are single-quoted (nothing expands inside): PowerShell doubles a `'`, POSIX closes,
/// escapes and reopens it (`'\''`).
pub(super) fn manual(windows: bool, root: &Path, exe: &Path, role: &str) -> String {
    let room = room_name(role);
    let q = |p: &Path| {
        let s = p.display().to_string();
        if windows {
            format!("'{}'", s.replace('\'', "''"))
        } else {
            format!("'{}'", s.replace('\'', r"'\''"))
        }
    };
    if windows {
        format!("cd {}; & {} . {room}", q(root), q(exe))
    } else {
        format!("cd {} && {} . {room}", q(root), q(exe))
    }
}

/// `wt.exe` splits its whole command line on `;` (its sub-command separator), even inside quotes:
/// a `;` in the repo root or the exe path would run the rest as another wt command.
pub(super) fn wt_safe(root: &Path, exe: &Path) -> bool {
    ![root, exe].iter().any(|p| p.as_os_str().to_string_lossy().contains(';'))
}

/// A Windows command line split like `CommandLineToArgvW`: 2n backslashes + `"` = n backslashes and
/// a quote toggle, 2n+1 = n backslashes and a literal quote, other backslashes are literal.
pub(super) fn win_args(cmdline: &str) -> Vec<String> {
    let mut out = Vec::new();
    let (mut cur, mut quoted, mut started, mut slashes) = (String::new(), false, false, 0usize);
    for c in cmdline.chars() {
        if c == '\\' {
            slashes += 1;
            started = true;
            continue;
        }
        if c == '"' {
            cur.push_str(&"\\".repeat(slashes / 2));
            if slashes % 2 == 1 {
                cur.push('"');
            } else {
                quoted = !quoted;
            }
            started = true;
        } else if c.is_whitespace() && !quoted {
            cur.push_str(&"\\".repeat(slashes));
            if started {
                out.push(std::mem::take(&mut cur));
                started = false;
            }
        } else {
            cur.push_str(&"\\".repeat(slashes));
            cur.push(c);
            started = true;
        }
        slashes = 0;
    }
    cur.push_str(&"\\".repeat(slashes));
    if started {
        out.push(cur);
    }
    out
}

/// `cmdline` is omp itself (`omp`, `…\omp.exe`) with an argument that is exactly `session_dir`
/// (any case and slash direction, as Windows paths): `omp-lead2` is not `omp-lead`, and an editor,
/// `grep` or the `8sync . omp-lead` parent never counts.
pub(super) fn carries(cmdline: &str, session_dir: &Path) -> bool {
    let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase();
    let want = norm(&session_dir.to_string_lossy());
    let args = win_args(cmdline);
    let Some((first, rest)) = args.split_first() else {
        return false;
    };
    let base = first.rsplit(['\\', '/']).next().unwrap_or(first).to_ascii_lowercase();
    !want.is_empty() && (base == "omp" || base == "omp.exe") && rest.iter().any(|a| norm(a) == want)
}

/// `<pid>\t<command line>` lines of the Windows process scan.
pub(super) fn parse_procs(out: &str) -> Vec<(u32, String)> {
    out.lines()
        .filter_map(|l| {
            let (pid, cmd) = l.split_once('\t')?;
            Some((pid.trim().parse().ok()?, cmd.trim().to_string()))
        })
        .collect()
}

/// Pids of the omp processes running the room whose session dir is `dir`.
pub(super) fn room_pids(procs: &[(u32, String)], dir: &Path) -> Vec<u32> {
    procs.iter().filter(|(_, c)| carries(c, dir)).map(|(p, _)| *p).collect()
}

/// Live `omp.exe` processes (pid, command line). Windows only; empty when the scan fails.
fn win_procs() -> Vec<(u32, String)> {
    const PS: &str = "Get-CimInstance Win32_Process -Filter \"Name='omp.exe'\" | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
    Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", PS])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map(|o| parse_procs(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

/// Runs `argv` (program first), no shell; Err carries the program's stderr.
fn run(argv: &[OsString]) -> Result<()> {
    let Some((prog, args)) = argv.split_first() else {
        bail!("argv rỗng");
    };
    let out = Command::new(prog).args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).output()?;
    if !out.status.success() {
        bail!("`{}` thoát {}: {}", Path::new(prog).display(), out.status, session_view::truncate(String::from_utf8_lossy(&out.stderr).trim(), 200));
    }
    Ok(())
}

/// One omp room in `up`'s report.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Row {
    pub name: String,
    pub role: String,
    pub state: String,
}

struct Ctx<'a> {
    env: &'a Env,
    root: &'a Path,
    exe: &'a Path,
    host: &'a Host,
    windows: bool,
    win: &'a [(u32, String)],
    unix: &'a [Vec<u8>],
}

fn open(c: &Ctx, role: &str) -> Result<String> {
    let name = room_name(role);
    let dir = session::ensure(c.env, c.root, &name)?;
    let sess = tmux_session(role, &ccc_core::room_id(c.root, &name));
    let running = if c.windows {
        !room_pids(c.win, &dir).is_empty()
    } else {
        session_view::proc_matches(c.unix, &dir.to_string_lossy()) || matches!(c.host, Host::Tmux(t) if run(&tmux_argv(t, "has-session", &sess)).is_ok())
    };
    if running {
        return Ok("đang chạy".into());
    }
    let Some(argv) = spawn_argv(c.host, role, &sess, c.root, c.exe) else {
        return Ok(format!("chạy tay: {}", manual(c.windows, c.root, c.exe, role)));
    };
    if matches!(c.host, Host::Wt(_)) && !wt_safe(c.root, c.exe) {
        return Ok(format!(
            "bỏ qua: đường dẫn có `;` (wt.exe coi là tách lệnh) — chạy tay: {}",
            manual(c.windows, c.root, c.exe, role)
        ));
    }
    run(&argv)?;
    Ok(match c.host {
        Host::Tmux(_) => format!("mở trong tmux `{sess}` (vào: `tmux attach -t {sess}`)"),
        _ => format!("mở tab Windows Terminal (cửa sổ `{WT_WINDOW}`)"),
    })
}

/// `auto up`: every role's omp room of this repo running detached. A room that cannot open is
/// reported, the others still open.
pub(super) fn up(env: &Env, root: &Path, roles: &[String]) -> Vec<Row> {
    let windows = cfg!(windows);
    let host = host(windows, which::which("tmux").ok(), if windows { which::which("wt").ok() } else { None });
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("8sync"));
    let win = if windows { win_procs() } else { Vec::new() };
    let unix = if windows { Vec::new() } else { session_view::agent_cmdlines() };
    let c = Ctx { env, root, exe: &exe, host: &host, windows, win: &win, unix: &unix };
    roles
        .iter()
        .map(|role| {
            let name = room_name(role);
            let state = open(&c, role).unwrap_or_else(|e| format!("không mở được: {e}"));
            Row { role: room::role(&name).0, name, state }
        })
        .collect()
}

pub(super) fn print_up(rows: &[Row]) {
    println!("đội omp: {} phòng (`8sync . omp-<vai>`, model mặc định của omp; nhắn nhau: `8sync ccc msg <phòng> \"…\"`)", rows.len());
    for r in rows {
        println!("  {:<14} {:<12} {}", r.name, r.role, r.state);
    }
}

/// What `down` did to team omp.
pub(super) struct Down {
    pub stopped: Vec<String>,
    /// Why nothing could be stopped here (no tmux on Linux/macOS).
    pub note: Option<&'static str>,
}

/// `auto down`: stop this repo's `omp-<role>` rooms; nothing else, nothing deleted.
pub(super) fn down(env: &Env, root: &Path) -> Result<Down> {
    let reg = session::load(env, root);
    let rooms: Vec<(&str, &session::Session)> = reg.sessions.iter().filter_map(|s| role_of(&s.name).map(|r| (r, s))).collect();
    let mut stopped = Vec::new();
    if rooms.is_empty() {
        return Ok(Down { stopped, note: None });
    }
    if cfg!(windows) {
        let procs = win_procs();
        for (_, s) in &rooms {
            let pids = room_pids(&procs, &s.session_dir);
            let mut hit = false;
            for pid in pids {
                hit |= run(&taskkill_argv(pid)).is_ok();
            }
            if hit {
                stopped.push(s.name.clone());
            }
        }
        return Ok(Down { stopped, note: None });
    }
    let Ok(tmux) = which::which("tmux") else {
        return Ok(Down { stopped, note: Some("không có tmux: phòng omp mở tay không tự dừng — đóng terminal của phòng đó") });
    };
    for (role, s) in &rooms {
        let sess = tmux_session(role, &ccc_core::room_id(root, &s.name));
        if run(&tmux_argv(&tmux, "kill-session", &sess)).is_ok() {
            stopped.push(s.name.clone());
        }
    }
    Ok(Down { stopped, note: None })
}

pub(super) fn print_down(d: &Down) {
    if !d.stopped.is_empty() {
        println!("đội omp: đã dừng {} phòng: {} (hội thoại omp giữ nguyên trong session dir; mở lại: `8sync ccc auto up`).", d.stopped.len(), d.stopped.join(", "));
    } else if let Some(n) = d.note {
        println!("đội omp: {n}.");
    } else {
        println!("đội omp: không có phòng omp nào của dự án này đang chạy.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn os(v: &[&str]) -> Vec<OsString> {
        v.iter().map(OsString::from).collect()
    }

    #[test]
    fn room_names_follow_the_roles() {
        let roles: Vec<String> = room::DEFAULT_TEAM.iter().map(|s| s.to_string()).collect();
        let names: Vec<String> = roles.iter().map(|r| room_name(r)).collect();
        assert_eq!(names, ["omp-lead", "omp-dev", "omp-qa", "omp-review", "omp-rd"]);
        for (n, r) in names.iter().zip(&roles) {
            assert_eq!(role_of(n), Some(r.as_str()));
            assert_eq!(room::role(n).0, room::role(r).0, "omp-{r} keeps the role of {r}");
        }
    }

    #[test]
    fn tmux_session_name_carries_role_and_repo() {
        assert_eq!(tmux_session("lead", "omp-0123456789abcdef"), "8sync-omp-lead-012345");
        assert_eq!(tmux_session("v1.2", "omp-abcdef0123456789"), "8sync-omp-v1_2-abcdef", "tmux turns `.` into `_`");
        let a = tmux_session("lead", &ccc_core::room_id(Path::new("/r/one"), "omp-lead"));
        let b = tmux_session("lead", &ccc_core::room_id(Path::new("/r/two"), "omp-lead"));
        assert_ne!(a, b, "same role in two repos");
        assert_eq!(a.len(), "8sync-omp-lead-".len() + 6);
    }

    #[test]
    fn omp_in_teams_brings_the_team_up_without_the_flag() {
        assert!(wanted(true, &json!({"teams": ["ccc"]})));
        assert!(wanted(false, &json!({"teams": ["ccc", "omp"]})));
        assert!(!wanted(false, &json!({"teams": ["ccc"]})));
        assert!(!wanted(false, &json!({})), "absent teams = ccc only");
    }

    #[test]
    fn host_per_platform() {
        let (t, w) = (Some(PathBuf::from("/usr/bin/tmux")), Some(PathBuf::from("C:/wt.exe")));
        assert_eq!(host(false, t.clone(), None), Host::Tmux("/usr/bin/tmux".into()));
        assert_eq!(host(false, None, w.clone()), Host::Manual, "no wt outside Windows");
        assert_eq!(host(true, None, w.clone()), Host::Wt("C:/wt.exe".into()));
        assert_eq!(host(true, t, None), Host::Manual, "no tmux on Windows");
    }

    #[test]
    fn spawn_argv_per_platform() {
        let (root, exe) = (Path::new("/home/a/my repo"), Path::new("/opt/8sync"));
        let t = spawn_argv(&Host::Tmux("/usr/bin/tmux".into()), "dev", "8sync-omp-dev-abc123", root, exe).unwrap();
        assert_eq!(t, os(&["/usr/bin/tmux", "new-session", "-d", "-s", "8sync-omp-dev-abc123", "-c", "/home/a/my repo", "/opt/8sync", ".", "omp-dev"]));
        let w = spawn_argv(&Host::Wt("wt.exe".into()), "qa", "x", root, exe).unwrap();
        assert_eq!(w, os(&["wt.exe", "-w", "8sync-omp", "new-tab", "--title", "omp-qa", "-d", "/home/a/my repo", "/opt/8sync", ".", "omp-qa"]));
        assert_eq!(spawn_argv(&Host::Manual, "qa", "x", root, exe), None);
        assert_eq!(manual(false, root, exe, "qa"), "cd '/home/a/my repo' && '/opt/8sync' . omp-qa");
        assert_eq!(manual(true, root, exe, "qa"), "cd '/home/a/my repo'; & '/opt/8sync' . omp-qa");
        let odd = Path::new("/r/it's $(x) `y`");
        assert_eq!(manual(false, odd, exe, "qa"), r#"cd '/r/it'\''s $(x) `y`' && '/opt/8sync' . omp-qa"#);
        assert_eq!(manual(true, odd, exe, "qa"), "cd '/r/it''s $(x) `y`'; & '/opt/8sync' . omp-qa");
        assert!(wt_safe(root, exe));
        assert!(!wt_safe(Path::new(r"C:\r\a;calc"), exe), "`;` in the root is a wt command separator");
        assert!(!wt_safe(root, Path::new(r"C:\b;x\8sync.exe")));
        assert_eq!(tmux_argv(Path::new("tmux"), "kill-session", "8sync-omp-dev-abc123"), os(&["tmux", "kill-session", "-t", "=8sync-omp-dev-abc123"]));
        assert_eq!(taskkill_argv(42), os(&["taskkill", "/PID", "42", "/F"]));
    }

    #[test]
    fn windows_command_lines_split_like_argv() {
        assert_eq!(win_args(r#""omp" --cwd C:\r --session-dir C:\s\omp-lead --continue"#), ["omp", "--cwd", r"C:\r", "--session-dir", r"C:\s\omp-lead", "--continue"]);
        assert_eq!(win_args(r#""C:\a b\omp.exe"  "C:\x y\" a\\\"b"#), [r"C:\a b\omp.exe", r#"C:\x y" a\"b"#]);
        assert_eq!(win_args(r#"x "" y"#), ["x", "", "y"]);
        assert!(win_args("   ").is_empty());
    }

    #[test]
    fn down_never_matches_foreign_sessions() {
        let dir = Path::new(r"C:\Users\A\AppData\Roaming\8sync\sessions\C--r-one\omp-lead");
        let procs = parse_procs(&[
            r#"10	"omp" --cwd C:\r\one --session-dir C:\Users\A\AppData\Roaming\8sync\sessions\C--r-one\omp-lead --continue"#,
            r#"11	"omp" --cwd C:\r\one --session-dir C:\Users\A\AppData\Roaming\8sync\sessions\C--r-one\omp-lead2"#,
            r#"12	"omp" --cwd C:\r\two --session-dir C:\Users\A\AppData\Roaming\8sync\sessions\C--r-two\omp-lead"#,
            r#"13	C:\bin\8sync.exe . omp-lead"#,
            r#"14	notepad.exe C:\Users\A\AppData\Roaming\8sync\sessions\C--r-one\omp-lead"#,
            r#"15	C:\Users\A\AppData\Local\omp\omp.exe __omp_worker_daemon_broker"#,
            r#"16	"C:\Users\A\AppData\Local\omp\omp.exe" --session-dir c:/users/a/appdata/roaming/8sync/sessions/c--r-one/omp-lead/"#,
            "garbage line",
        ]
        .join("\n"));
        assert_eq!(procs.len(), 7);
        assert_eq!(room_pids(&procs, dir), [10, 16], "only omp on exactly this room's session dir");
        for n in ["core", "omp", "omp-", "ompx-lead", "lead", "my-omp-lead"] {
            assert_eq!(role_of(n), None, "{n} is not a team room");
        }
        assert_eq!(role_of("omp-lead"), Some("lead"));
    }
}
