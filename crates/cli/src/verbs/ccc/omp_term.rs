//! omp rooms in HQ's web terminal (owner 2026-10-21: "omp vẫn sài được chứ"). omp has no `attach`,
//! so the room's omp runs in a host that outlives HQ and every viewer:
//! - `ccc term --host <id> [--restore]` (started detached by a client) runs omp in a pseudo-terminal
//!   in the room's folder, resuming its transcript (`--restore` after a takeover: the interrupted
//!   turn and its subagents go on), keeps the last 256 KB of output and serves 127.0.0.1 on a random
//!   port to clients that send its random token. `~/.local/state/8sync/ccc/term/<id>.json` =
//!   `{pid, omp_pid, port, token, room}`; it goes when omp exits, and so does the host.
//! - `ccc term <id>` (what HQ runs) joins that host, starting it when no omp has the session open,
//!   and relays it with term.rs's protocol: raw terminal bytes out, JSON lines in. Its exit only
//!   disconnects: omp keeps running in the host.
//! - The session open in another omp (the owner's own terminal): one line, exit [`ELSEWHERE`].
//!   `--takeover` ends exactly that process tree (matched by the session dir, never by image name),
//!   then starts the host with `--restore`.
use super::term::{parse_line, size_ok, Ctl, Pty};
use crate::env_detect::Env;
use anyhow::{bail, Context, Result};
use portable_pty::{CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// Exit code of a client whose session is open in another process (HQ offers "Chuyển sang HQ").
pub(super) const ELSEWHERE: i32 = 3;
/// Output a late viewer gets replayed.
const KEEP: usize = 256 * 1024;
/// The host's first bytes to a client that sent its token: anything else on that port is not our host.
const ACK: &[u8] = b"8sync-term ok\n";
const HELLO_WAIT: Duration = Duration::from_secs(5);
const START_WAIT: Duration = Duration::from_secs(20);
const EXIT_WAIT: Duration = Duration::from_secs(15);

/// `omp-` + 16 lowercase hex, as `ccc_core::room_id` makes and `8sync ls` prints (`inbox_id`).
pub(super) fn valid_room_id(s: &str) -> bool {
    s.len() == 20 && s.starts_with("omp-") && s[4..].bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

struct Room {
    name: String,
    root: PathBuf,
    cwd: PathBuf,
    session_dir: PathBuf,
    transcript: Option<PathBuf>,
}

/// The room behind `id`, from `8sync ls` data (never a path from the caller).
fn resolve(env: &Env, id: &str) -> Result<Room> {
    let (root, s, transcript) = crate::verbs::session_cmds::omp_room(env, id).with_context(|| format!("không thấy phòng omp {id} trong `8sync ls`"))?;
    let cwd = crate::verbs::session::session_cwd(&s, &root).to_path_buf();
    Ok(Room { name: s.name, root, cwd, session_dir: s.session_dir, transcript })
}

// ── host record ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub(super) struct HostState {
    pub pid: u32,
    pub omp_pid: Option<u32>,
    pub port: u16,
    pub token: String,
    pub room: String,
}

pub(super) fn state_path(home: &Path, id: &str) -> PathBuf {
    home.join(".local/state").join(crate::brand::NS).join("ccc").join("term").join(format!("{id}.json"))
}

/// The host record of room `id`, when well formed and for that room.
fn read_state(p: &Path, id: &str) -> Option<HostState> {
    let s: HostState = serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()?;
    (s.room == id && valid_token(&s.token) && s.port != 0).then_some(s)
}

fn write_state(p: &Path, s: &HostState) -> Result<()> {
    std::fs::create_dir_all(p.parent().context("state dir")?)?;
    let tmp = p.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_vec(s)?)?;
    std::fs::rename(&tmp, p).context("ghi trạng thái host terminal")
}

/// Removes the record only while it is still this host's.
fn clear_state(p: &Path, token: &str) {
    if std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str::<HostState>(&s).ok()).is_some_and(|s| s.token == token) {
        let _ = std::fs::remove_file(p);
    }
}

fn new_token() -> Result<String> {
    let mut b = [0u8; 16];
    getrandom::getrandom(&mut b).map_err(|e| anyhow::anyhow!("getrandom: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

fn valid_token(t: &str) -> bool {
    t.len() == 32 && t.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Compares without stopping at the first different byte.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// A client's first line: the host's token and the client's terminal size.
pub(super) fn hello(token: &str, cols: u16, rows: u16) -> String {
    format!("{}\n", serde_json::json!({ "t": token, "r": [cols, rows] }))
}

/// `Some(size)` when `line` carries `token` (the size is optional), else `None`: the connection is dropped.
pub(super) fn check_hello(line: &str, token: &str) -> Option<Option<(u16, u16)>> {
    let v: serde_json::Value = serde_json::from_str(line.trim_end()).ok()?;
    if !same(v["t"].as_str()?, token) {
        return None;
    }
    Some(v["r"].as_array().and_then(|r| size_ok(r.first()?.as_u64()?, r.get(1)?.as_u64()?)))
}

// ── replay ──────────────────────────────────────────────────────────────────

/// Kept output for a viewer who joins later, without the terminal queries in it (cursor position,
/// device attributes, modes, colors…): they were answered, or timed out, when they were live, and
/// a second answer would be typed into omp as junk.
pub(super) fn strip_queries(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == 0x1b {
            if let Some(end) = query_end(b, i) {
                i = end;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    out
}

/// End (exclusive) of the query sequence starting at `b[i] == ESC`, if it is one.
fn query_end(b: &[u8], i: usize) -> Option<usize> {
    match *b.get(i + 1)? {
        b'[' => {
            let p0 = i + 2;
            let mut j = p0;
            while b.get(j).is_some_and(|c| (0x30..=0x3f).contains(c)) {
                j += 1;
            }
            let i0 = j;
            while b.get(j).is_some_and(|c| (0x20..=0x2f).contains(c)) {
                j += 1;
            }
            let fin = *b.get(j).filter(|c| (0x40..=0x7e).contains(*c))?;
            let (params, inter) = (&b[p0..i0], &b[i0..j]);
            let first = params.split(|c| *c == b';').next().unwrap_or_default();
            let query = match (inter, fin) {
                (b"", b'n' | b'c') => true,
                (b"", b'u') => params == b"?",
                (b"$", b'p') => true,
                (b"", b't') => matches!(first, b"11" | b"13" | b"14" | b"15" | b"16" | b"18" | b"19" | b"20" | b"21"),
                _ => false,
            };
            query.then_some(j + 1)
        }
        b']' | b'P' => {
            let start = i + 2;
            let (body_end, end) = (start..b.len()).find_map(|j| match b[j] {
                0x07 => Some((j, j + 1)),
                0x1b if b.get(j + 1) == Some(&b'\\') => Some((j, j + 2)),
                _ => None,
            })?;
            let body = &b[start..body_end];
            let query = if b[i + 1] == b']' { body.windows(2).any(|w| w == b";?") } else { body.starts_with(b"+q") || body.starts_with(b"$q") };
            query.then_some(end)
        }
        _ => None,
    }
}

/// Output of the room's terminal: the last [`KEEP`] bytes, and the viewers it streams to.
pub(super) struct Hub<W> {
    kept: VecDeque<u8>,
    viewers: Vec<(u64, W)>,
    next: u64,
}

impl<W: Write> Hub<W> {
    pub(super) fn new() -> Self {
        Hub { kept: VecDeque::new(), viewers: Vec::new(), next: 0 }
    }

    /// New output: kept, and sent to every viewer; one that cannot take it is dropped.
    pub(super) fn push(&mut self, b: &[u8]) {
        self.kept.extend(b);
        let over = self.kept.len().saturating_sub(KEEP);
        self.kept.drain(..over);
        self.viewers.retain_mut(|(_, w)| w.write_all(b).and_then(|_| w.flush()).is_ok());
    }

    /// A viewer gets [`ACK`], then the kept screen without its queries, then live output.
    pub(super) fn join(&mut self, mut w: W) -> Option<u64> {
        let (a, b) = self.kept.as_slices();
        let replay = strip_queries(&[a, b].concat());
        w.write_all(ACK).and_then(|_| w.write_all(&replay)).and_then(|_| w.flush()).ok()?;
        self.next += 1;
        self.viewers.push((self.next, w));
        Some(self.next)
    }

    pub(super) fn leave(&mut self, id: u64) {
        self.viewers.retain(|(v, _)| *v != id);
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One client connection (`reader`/`viewer` are its halves): the hello (token + size), then its
/// control lines into the terminal until it disconnects. A wrong token gets nothing at all.
pub(super) fn serve<R: Read, W: Write>(reader: R, viewer: W, token: &str, hub: &Mutex<Hub<W>>, after_hello: impl FnOnce(), mut to_term: impl FnMut(Ctl)) {
    let mut rd = BufReader::new(reader);
    let mut first = String::new();
    if (&mut rd).take(4096).read_line(&mut first).is_err() {
        return;
    }
    let Some(size) = check_hello(&first, token) else { return };
    after_hello();
    if let Some((c, r)) = size {
        to_term(Ctl::Resize(c, r));
    }
    let Some(id) = lock(hub).join(viewer) else { return };
    for line in rd.lines() {
        let Ok(l) = line else { break };
        if let Some(c) = parse_line(&l) {
            to_term(c);
        }
    }
    lock(hub).leave(id);
}

// ── host ────────────────────────────────────────────────────────────────────

/// `cmd` for [`Pty::spawn`]: the program found on PATH, its args, env changes and folder.
fn pty_command(cmd: &std::process::Command) -> Result<CommandBuilder> {
    let prog = cmd.get_program();
    let exe = which::which(prog).with_context(|| format!("không thấy `{}` trong PATH", prog.to_string_lossy()))?;
    let mut b = CommandBuilder::new(exe);
    b.args(cmd.get_args());
    for (k, v) in cmd.get_envs() {
        match v {
            Some(v) => b.env(k, v),
            None => b.env_remove(k),
        }
    }
    if let Some(d) = cmd.get_current_dir() {
        b.cwd(d);
    }
    Ok(b)
}

/// Set in the host's second stage (see [`host_logged`]).
const SECOND_STAGE: &str = "EIGHTSYNC_TERM_HOST";

/// [`host`], its error kept next to the record (the host has no console to print it on). The first
/// stage only starts a detached copy of itself and exits, so the host is out of the process tree of
/// the client that started it (a tree kill of HQ, `taskkill /T`, must not take omp with it).
pub(super) fn host_logged(env: &Env, id: &str, restore: bool, cols: u16, rows: u16) -> Result<()> {
    if std::env::var_os(SECOND_STAGE).is_none() {
        std::env::set_var(SECOND_STAGE, "1");
        let exe = std::env::current_exe().context("không thấy đường dẫn 8sync")?;
        super::awake::spawn_detached(&exe, &std::env::args().skip(1).collect::<Vec<_>>())?;
        return Ok(());
    }
    std::env::remove_var(SECOND_STAGE);
    let r = host(env, id, restore, cols, rows);
    if let Err(e) = &r {
        let log = state_path(&env.home, id).with_extension("log");
        if let Some(dir) = log.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(log, format!("{e:#}\n"));
    }
    r
}

/// ConPTY opens with a cursor position query (inherit-cursor mode) and holds the output until it
/// is answered: the host answers it, so omp starts with no viewer and no viewer answers it twice.
const OPENING_QUERY: &[u8] = b"\x1b[6n";

fn host(env: &Env, id: &str, restore: bool, cols: u16, rows: u16) -> Result<()> {
    let room = resolve(env, id)?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).context("không mở được cổng trên 127.0.0.1")?;
    let port = listener.local_addr()?.port();
    let token = new_token()?;
    let mut cmd = crate::verbs::session::omp_command(&room.cwd, &room.session_dir, (&room.root, &room.name), None);
    if let Some(t) = &room.transcript {
        cmd.arg(if restore { "--restore" } else { "--resume" }).arg(t);
    }
    let Pty { master, mut child, mut reader, writer } = Pty::spawn(pty_command(&cmd)?, cols, rows)?;
    let state = state_path(&env.home, id);
    let rec = HostState { pid: std::process::id(), omp_pid: child.process_id(), port, token: token.clone(), room: id.to_string() };
    if let Err(e) = write_state(&state, &rec) {
        let _ = child.kill();
        return Err(e);
    }
    let hub: Arc<Mutex<Hub<TcpStream>>> = Arc::new(Mutex::new(Hub::new()));
    let writer = Arc::new(Mutex::new(writer));
    let master = Arc::new(Mutex::new(master));

    {
        let (hub, writer) = (hub.clone(), writer.clone());
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let (mut opened, mut seen) = (!cfg!(windows), 0usize);
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                if !opened {
                    if let Some(at) = buf[..n].windows(OPENING_QUERY.len()).position(|w| w == OPENING_QUERY) {
                        let mut w = lock(&writer);
                        let _ = w.write_all(b"\x1b[1;1R").and_then(|_| w.flush());
                        drop(w);
                        let mut b = buf[..n].to_vec();
                        b.drain(at..at + OPENING_QUERY.len());
                        lock(&hub).push(&b);
                        opened = true;
                        continue;
                    }
                    seen += n;
                    opened = seen > 4096;
                }
                lock(&hub).push(&buf[..n]);
            }
        });
    }
    // ConPTY keeps the output pipe open after the child exits: the host ends with omp itself.
    {
        let (state, token) = (state.clone(), token.clone());
        std::thread::spawn(move || {
            let code = child.wait().map_or(1, |s| s.exit_code() as i32);
            std::thread::sleep(Duration::from_millis(300));
            clear_state(&state, &token);
            std::process::exit(code);
        });
    }
    for conn in listener.incoming() {
        let Ok(s) = conn else { continue };
        let (hub, writer, master, token) = (hub.clone(), writer.clone(), master.clone(), token.clone());
        std::thread::spawn(move || {
            let _ = s.set_nodelay(true);
            // Socket timeouts are per handle on Windows (a `try_clone` does not follow a later change):
            // the hello is read from `s` itself, whose timeout `after_hello` clears.
            let _ = s.set_read_timeout(Some(HELLO_WAIT));
            let Ok(viewer) = s.try_clone() else { return };
            let _ = viewer.set_write_timeout(Some(Duration::from_secs(2)));
            serve(
                &s,
                viewer,
                &token,
                &hub,
                || {
                    let _ = s.set_read_timeout(None);
                },
                |c| match c {
                    Ctl::Input(k) => {
                        let mut w = lock(&writer);
                        let _ = w.write_all(k.as_bytes()).and_then(|_| w.flush());
                    }
                    Ctl::Resize(c, r) => {
                        let _ = lock(&master).resize(PtySize { rows: r, cols: c, pixel_width: 0, pixel_height: 0 });
                    }
                },
            );
            let _ = s.shutdown(Shutdown::Both);
        });
    }
    Ok(())
}

// ── client ──────────────────────────────────────────────────────────────────

/// What a client does when no host answers: start one, or not while another omp has the session.
#[derive(Debug, PartialEq)]
pub(super) enum Plan {
    Start,
    Elsewhere(u32),
    Takeover(Vec<u32>),
}

pub(super) fn plan(live: &[u32], takeover: bool) -> Plan {
    match (live.first(), takeover) {
        (None, _) => Plan::Start,
        (Some(&p), false) => Plan::Elsewhere(p),
        (Some(_), true) => Plan::Takeover(live.to_vec()),
    }
}

/// Pids of the omp processes that have this session open (its dir, or a transcript in it, as an argument).
pub(super) fn session_pids(procs: &[(u32, Vec<u8>)], session_dir: &Path) -> Vec<u32> {
    let dir = session_dir.to_string_lossy();
    procs.iter().filter(|(_, argv)| ccc_core::transcript::proc_match(argv, &dir)).map(|(p, _)| *p).collect()
}

/// The live host of room `id` (its record, its port, its token taken), the hello sent.
fn connect(state: &Path, id: &str, cols: u16, rows: u16) -> Option<TcpStream> {
    let s = read_state(state, id)?;
    let mut c = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, s.port)), Duration::from_secs(2)).ok()?;
    c.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    c.write_all(hello(&s.token, cols, rows).as_bytes()).ok()?;
    let mut ack = [0u8; ACK.len()];
    c.read_exact(&mut ack).ok()?;
    c.set_read_timeout(None).ok()?;
    let _ = c.set_nodelay(true);
    (ack == ACK).then_some(c)
}

fn wait_host(state: &Path, id: &str, cols: u16, rows: u16) -> Result<TcpStream> {
    let until = Instant::now() + START_WAIT;
    loop {
        if let Some(c) = connect(state, id, cols, rows) {
            return Ok(c);
        }
        if Instant::now() > until {
            bail!("omp chưa lên sau {} s (xem {})", START_WAIT.as_secs(), state.with_extension("log").display());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// Held while a client starts the host, so two clients never start two.
struct StartLock(PathBuf);

impl StartLock {
    /// `None`: another client is starting it right now.
    fn take(p: &Path) -> Result<Option<StartLock>> {
        std::fs::create_dir_all(p.parent().context("state dir")?)?;
        for _ in 0..2 {
            match std::fs::OpenOptions::new().write(true).create_new(true).open(p) {
                Ok(_) => return Ok(Some(StartLock(p.to_path_buf()))),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let age = std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok());
                    if age.is_some_and(|a| a < START_WAIT + EXIT_WAIT) {
                        return Ok(None);
                    }
                    let _ = std::fs::remove_file(p);
                }
                Err(e) => return Err(e).context("khóa khởi động terminal omp"),
            }
        }
        Ok(None)
    }
}

impl Drop for StartLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Ends `pid` with its tree (never by image name).
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).status();
    }
}

/// Takeover: ends the processes that hold the session and waits until none is left.
fn end_session(pids: &[u32], session_dir: &Path) -> Result<()> {
    for &p in pids {
        kill_tree(p);
    }
    let until = Instant::now() + EXIT_WAIT;
    loop {
        let left = session_pids(&ccc_core::transcript::agent_procs(), session_dir);
        if left.is_empty() {
            return Ok(());
        }
        if Instant::now() > until {
            bail!("omp (pid {left:?}) chưa thoát sau {} s", EXIT_WAIT.as_secs());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// HQ's side of a connection: the host's bytes to stdout, stdin's control lines to the host. Ends
/// when the host does (omp exited) or when stdin closes (HQ let go: only this connection ends).
fn relay(sock: TcpStream) -> Result<()> {
    let mut from = sock.try_clone()?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut out = std::io::stdout().lock();
        while let Ok(n) = from.read(&mut buf) {
            if n == 0 || out.write_all(&buf[..n]).and_then(|_| out.flush()).is_err() {
                break;
            }
        }
        std::process::exit(0);
    });
    let mut to = sock;
    for line in std::io::stdin().lock().lines() {
        let Ok(mut l) = line else { break };
        if parse_line(&l).is_some() {
            l.push('\n');
            if to.write_all(l.as_bytes()).is_err() {
                break;
            }
        }
    }
    let _ = to.shutdown(Shutdown::Both);
    Ok(())
}

pub(super) fn client(env: &Env, id: &str, cols: u16, rows: u16, takeover: bool) -> Result<()> {
    let room = resolve(env, id)?;
    let state = state_path(&env.home, id);
    if let Some(s) = connect(&state, id, cols, rows) {
        return relay(s);
    }
    let Some(lock) = StartLock::take(&state.with_extension("lock"))? else {
        return relay(wait_host(&state, id, cols, rows)?);
    };
    if let Some(s) = connect(&state, id, cols, rows) {
        drop(lock);
        return relay(s);
    }
    let _ = std::fs::remove_file(&state);
    let live = session_pids(&ccc_core::transcript::agent_procs(), &room.session_dir);
    let restore = match plan(&live, takeover) {
        Plan::Start => false,
        Plan::Elsewhere(pid) => {
            drop(lock);
            let mut out = std::io::stdout().lock();
            let _ = write!(out, "phiên đang mở ở terminal khác trên máy (pid {pid}) — bấm 'Chuyển sang HQ' để mở ở đây\r\n");
            let _ = out.flush();
            std::process::exit(ELSEWHERE);
        }
        Plan::Takeover(pids) => {
            end_session(&pids, &room.session_dir)?;
            true
        }
    };
    let exe = std::env::current_exe().context("không thấy đường dẫn 8sync")?;
    let mut args: Vec<String> = ["ccc", "term", "--host", id, "--cols", &cols.to_string(), "--rows", &rows.to_string()].map(String::from).to_vec();
    if restore {
        args.push("--restore".into());
    }
    super::awake::spawn_detached(&exe, &args).context("không chạy được host terminal omp")?;
    let s = wait_host(&state, id, cols, rows)?;
    drop(lock);
    relay(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    /// A viewer whose bytes the test reads after `serve` moved it into the hub.
    #[derive(Clone, Default)]
    struct Seen(Arc<Mutex<Vec<u8>>>);
    impl Write for Seen {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            lock(&self.0).extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct Broken;
    impl Write for Broken {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::ErrorKind::BrokenPipe.into())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn room_ids_are_exactly_what_ls_prints() {
        assert!(valid_room_id("omp-00000000000000a1"));
        for bad in ["omp-00000000000000A1", "omp-00000000000000a", "omp-00000000000000a10", "omp-../../etc/hosts", "3698e3a6-9b73-4b37-ab3a-368b169d0508", "omp-00000000000000é"] {
            assert!(!valid_room_id(bad), "{bad}");
        }
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let id = "omp-00000000000000a1";
        let uuid = "3698e3a6-9b73-4b37-ab3a-368b169d0508";
        use super::super::term::{parse, Target};
        assert_eq!(parse(&a(&[id, "--cols", "80", "--rows", "24"])).unwrap(), (Target::Omp { id: id.into(), takeover: false }, 80, 24));
        assert_eq!(parse(&a(&[id, "--takeover"])).unwrap().0, Target::Omp { id: id.into(), takeover: true });
        assert_eq!(parse(&a(&["--host", id, "--restore"])).unwrap().0, Target::Host { id: id.into(), restore: true });
        assert!(parse(&a(&[uuid, "--takeover"])).is_err(), "a Claude room is never taken over");
        assert!(parse(&a(&["--shell", "--host"])).is_err() && parse(&a(&[id, "--restore"])).is_err() && parse(&a(&["--host", id, "--takeover"])).is_err());
    }

    #[test]
    fn host_record_and_token_are_checked_before_use() {
        let dir = std::env::temp_dir().join(format!("omp-term-state-{}", std::process::id()));
        let id = "omp-0000000000000001";
        let p = state_path(&dir, id);
        assert!(p.ends_with(Path::new("ccc/term/omp-0000000000000001.json")) && !p.starts_with(dir.join(".local/state/8sync/hq")), "{}", p.display());
        let rec = HostState { pid: 1, omp_pid: Some(2), port: 4000, token: TOKEN.into(), room: id.into() };
        write_state(&p, &rec).unwrap();
        assert_eq!(read_state(&p, id), Some(rec));
        assert_eq!(read_state(&p, "omp-0000000000000002"), None, "another room's record");
        clear_state(&p, "ffffffffffffffffffffffffffffffff");
        assert!(p.exists(), "a newer host's record stays");
        clear_state(&p, TOKEN);
        assert!(!p.exists());
        std::fs::write(&p, r#"{"pid":1,"omp_pid":null,"port":4000,"token":"short","room":"omp-0000000000000001"}"#).unwrap();
        assert_eq!(read_state(&p, id), None, "malformed token");
        let t = new_token().unwrap();
        assert!(valid_token(&t) && t != new_token().unwrap());
        assert_eq!(check_hello(&hello(TOKEN, 100, 30), TOKEN), Some(Some((100, 30))));
        assert_eq!(check_hello(r#"{"t":"0123456789abcdef0123456789abcdef"}"#, TOKEN), Some(None));
        for bad in [hello("ffffffffffffffffffffffffffffffff", 100, 30), hello("0123", 1, 1), "{}".into(), "nope".into()] {
            assert_eq!(check_hello(&bad, TOKEN), None, "{bad}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_late_viewer_gets_the_screen_without_its_terminal_queries() {
        let raw = b"a\x1b[6nb\x1b[cc\x1b[>0cd\x1b[?ue\x1b[?2026$pf\x1b]11;?\x07g\x1b]10;?\x1b\\h\x1bP+q544e\x1b\\i\x1b[14tj\x1b[1;31mk\x1b]0;title\x07l\x1b[>1um";
        assert_eq!(strip_queries(raw), b"abcdefghij\x1b[1;31mk\x1b]0;title\x07l\x1b[>1um".to_vec());
        assert_eq!(strip_queries(b"cut \x1b[6"), b"cut \x1b[6".to_vec(), "a sequence cut at the end is kept as is");
    }

    #[test]
    fn the_hub_keeps_256_kb_and_drops_a_viewer_that_cannot_keep_up() {
        let mut hub: Hub<Box<dyn Write>> = Hub::new();
        hub.push(&vec![b'x'; KEEP + 10]);
        assert_eq!(hub.kept.len(), KEEP);
        let seen = Seen::default();
        hub.join(Box::new(seen.clone())).unwrap();
        assert!(hub.join(Box::new(Broken)).is_none(), "a viewer that cannot take the replay is not added");
        assert_eq!(hub.viewers.len(), 1);
        assert_eq!(lock(&seen.0).len(), ACK.len() + KEEP);
        hub.push(b"live");
        assert!(lock(&seen.0).ends_with(b"live"));
    }

    #[test]
    fn a_client_with_the_token_gets_ack_replay_and_live_output_and_types_into_the_terminal() {
        let hub: Mutex<Hub<Seen>> = Mutex::new(Hub::new());
        lock(&hub).push(b"screen\x1b[6n ");
        let seen = Seen::default();
        let mut sent = Vec::new();
        let mut hello_ok = false;
        let lines = format!("{}{}\n{}\nnot json\n", hello(TOKEN, 100, 30), r#"{"i":"1\r"}"#, r#"{"r":[90,20]}"#);
        serve(Cursor::new(lines), seen.clone(), TOKEN, &hub, || hello_ok = true, |c| sent.push(c));
        assert!(hello_ok);
        assert_eq!(sent, [Ctl::Resize(100, 30), Ctl::Input("1\r".into()), Ctl::Resize(90, 20)]);
        assert_eq!(*lock(&seen.0), [ACK, b"screen ".as_slice()].concat());
        assert!(lock(&hub).viewers.is_empty(), "a disconnected client leaves");

        let wrong = Seen::default();
        let mut sent = Vec::new();
        serve(Cursor::new(format!("{}{}\n", hello("ffffffffffffffffffffffffffffffff", 100, 30), r#"{"i":"rm -rf\r"}"#)), wrong.clone(), TOKEN, &hub, || panic!("no hello"), |c| sent.push(c));
        assert!(sent.is_empty() && lock(&wrong.0).is_empty(), "a wrong token gets no byte and types nothing");
    }

    #[test]
    fn a_client_joins_a_live_host_and_a_dead_record_is_not_a_host() {
        let dir = std::env::temp_dir().join(format!("omp-term-conn-{}", std::process::id()));
        let id = "omp-0000000000000003";
        let p = state_path(&dir, id);
        let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        write_state(&p, &HostState { pid: 1, omp_pid: None, port, token: TOKEN.into(), room: id.into() }).unwrap();
        let fake = std::thread::spawn(move || {
            for _ in 0..2 {
                let (s, _) = l.accept().unwrap();
                let hub: Mutex<Hub<TcpStream>> = Mutex::new(Hub::new());
                lock(&hub).push(b"omp ready");
                let mut got = Vec::new();
                serve(s.try_clone().unwrap(), s.try_clone().unwrap(), TOKEN, &hub, || {}, |c| got.push(c));
                assert_eq!(got.first(), Some(&Ctl::Resize(80, 24)));
            }
        });
        let mut c = connect(&p, id, 80, 24).expect("host answers");
        let mut buf = [0u8; 9];
        c.read_exact(&mut buf).unwrap();
        assert_eq!(&buf, b"omp ready", "the ack is not part of the terminal output");
        drop(c);
        // Same pid, port and token on reconnect: it is the same host.
        assert!(connect(&p, id, 80, 24).is_some());
        fake.join().unwrap();
        assert!(connect(&p, id, 80, 24).is_none(), "nothing listens any more");
        assert!(connect(&p, "omp-0000000000000004", 80, 24).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_open_elsewhere_is_reported_and_only_its_own_processes_are_taken_over() {
        let sd = if cfg!(windows) { r"C:\Users\A\.config\8sync\sessions\C--r\core" } else { "/home/a/.config/8sync/sessions/-r/core" };
        let argv = |v: &[&str]| v.join("\0").into_bytes();
        let jsonl = format!("{sd}{}2026_x.jsonl", std::path::MAIN_SEPARATOR);
        let procs = vec![
            (10, argv(&["omp", "--cwd", "r", "--session-dir", sd, "--continue"])),
            (11, argv(&["omp", "--resume", &jsonl])),
            (12, argv(&["omp", "--session-dir", &format!("{sd}2")])),
            (13, argv(&["notepad.exe", sd])),
            (14, argv(&["omp", "__omp_worker_daemon_broker"])),
        ];
        let live = session_pids(&procs, Path::new(sd));
        assert_eq!(live, [10, 11]);
        assert_eq!(plan(&live, false), Plan::Elsewhere(10));
        assert_eq!(plan(&live, true), Plan::Takeover(vec![10, 11]));
        assert_eq!(plan(&[], false), Plan::Start, "idle: the host starts");
        assert_eq!(plan(&[], true), Plan::Start, "a takeover with nothing to take over just starts");
    }

    #[test]
    fn rooms_resolve_from_the_ls_registry_to_their_repo_session_and_transcript() {
        let tmp = std::env::temp_dir().join(format!("omp-term-room-{}", std::process::id()));
        let repo = tmp.join("work").join("app");
        let sd = tmp.join("sd");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::create_dir_all(&sd).unwrap();
        std::fs::write(sd.join("2026-10-21_x.jsonl"), "{\"type\":\"session\",\"version\":3,\"id\":\"x\"}\n").unwrap();
        let env = Env { home: tmp.clone(), xdg_config: tmp.join("cfg"), os_id: String::new(), os_id_like: String::new() };
        let reg = env.xdg_config.join("8sync").join("sessions").join(crate::verbs::session::project_key(&repo));
        std::fs::create_dir_all(&reg).unwrap();
        let index = serde_json::json!({ "root": repo, "sessions": [{ "name": "smoke", "session_dir": sd, "created": 0, "last_active": 0 }] });
        std::fs::write(reg.join("index.json"), index.to_string()).unwrap();
        let id = ccc_core::room_id(&repo, "smoke");
        let r = resolve(&env, &id).unwrap();
        assert_eq!((r.name.as_str(), r.root.as_path(), r.cwd.as_path(), r.session_dir.as_path()), ("smoke", repo.as_path(), repo.as_path(), sd.as_path()));
        assert_eq!(r.transcript.as_deref(), Some(sd.join("2026-10-21_x.jsonl").as_path()));
        assert!(resolve(&env, "omp-0000000000000000").is_err(), "an id ls does not know");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
