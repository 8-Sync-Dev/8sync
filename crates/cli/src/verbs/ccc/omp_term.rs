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
//!   `--takeover` starts the host with `--restore`: the host itself ends exactly the omp processes
//!   that have that session open (matched by the session dir, never by image name) and their own
//!   children, one pid at a time, leaving omp's shared worker daemons alone ([`kill_order`]).
use super::term::{parse_line, size_ok, Ctl, Pty};
use crate::env_detect::Env;
use anyhow::{bail, Context, Result};
use portable_pty::{CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use ccc_core::transcript::ProcEntry;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{sync_channel, SyncSender};
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
/// A start lock older than this was left by a start that died (a takeover takes up to EXIT_WAIT + START_WAIT).
const LOCK_STALE: Duration = Duration::from_secs(START_WAIT.as_secs() + EXIT_WAIT.as_secs() + 10);

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

/// Where a viewer's bytes go. Never blocks (the hub calls it under its lock); `false` drops the viewer.
pub(super) trait Viewer {
    fn send(&self, b: Arc<[u8]>) -> bool;
}

impl<T: Viewer + ?Sized> Viewer for Box<T> {
    fn send(&self, b: Arc<[u8]>) -> bool {
        (**self).send(b)
    }
}

/// Chunks a socket viewer may fall behind before it is dropped.
const QUEUE: usize = 512;

/// A socket viewer: its own thread writes a bounded queue out, so a slow client never holds the
/// hub (another client's ACK, the terminal's output) while its socket is full.
pub(super) struct Queue(SyncSender<Arc<[u8]>>);

/// The socket end of a [`Queue`]: closed when its writer ends.
pub(super) trait Sink: Write + Send + 'static {
    fn close(&mut self);
}

impl Sink for TcpStream {
    fn close(&mut self) {
        let _ = self.shutdown(Shutdown::Both);
    }
}

impl Queue {
    /// When the writer ends (the hub dropped this viewer, e.g. its queue was full, or a write
    /// failed) the socket is shut down, so a dropped client sees its terminal end, not a frozen one.
    pub(super) fn spawn<W: Sink>(mut w: W) -> Queue {
        let (tx, rx) = sync_channel::<Arc<[u8]>>(QUEUE);
        std::thread::spawn(move || {
            for b in rx {
                if w.write_all(&b).and_then(|_| w.flush()).is_err() {
                    break;
                }
            }
            w.close();
        });
        Queue(tx)
    }
}

impl Viewer for Queue {
    fn send(&self, b: Arc<[u8]>) -> bool {
        self.0.try_send(b).is_ok()
    }
}

/// Output of the room's terminal: the last [`KEEP`] bytes, and the viewers it streams to.
pub(super) struct Hub<V> {
    kept: VecDeque<u8>,
    viewers: Vec<(u64, V)>,
    next: u64,
}

impl<V: Viewer> Hub<V> {
    pub(super) fn new() -> Self {
        Hub { kept: VecDeque::new(), viewers: Vec::new(), next: 0 }
    }

    /// New output: kept, and queued to every viewer; one that cannot take it is dropped.
    pub(super) fn push(&mut self, b: &[u8]) {
        self.kept.extend(b);
        let over = self.kept.len().saturating_sub(KEEP);
        self.kept.drain(..over);
        let chunk: Arc<[u8]> = b.into();
        self.viewers.retain(|(_, v)| v.send(chunk.clone()));
    }

    /// A viewer gets [`ACK`], then the kept screen without its queries, then live output.
    pub(super) fn join(&mut self, v: V) -> Option<u64> {
        let (a, b) = self.kept.as_slices();
        let replay = strip_queries(&[a, b].concat());
        (v.send(ACK.into()) && v.send(replay.into())).then_some(())?;
        self.next += 1;
        self.viewers.push((self.next, v));
        Some(self.next)
    }

    pub(super) fn leave(&mut self, id: u64) {
        self.viewers.retain(|(v, _)| *v != id);
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// One client connection (`reader` and its `viewer`): the hello (token + size), then its control
/// lines into the terminal until it disconnects. A wrong token gets nothing at all.
pub(super) fn serve<R: Read, V: Viewer>(reader: R, viewer: V, token: &str, hub: &Mutex<Hub<V>>, after_hello: impl FnOnce(), mut to_term: impl FnMut(Ctl)) {
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
/// From the client's spawn on, the host owns the client's [`StartLock`]: it goes once the host is
/// up or has failed, also when the client was killed meanwhile.
pub(super) fn host_logged(env: &Env, id: &str, restore: bool, cols: u16, rows: u16) -> Result<()> {
    let r = if std::env::var_os(SECOND_STAGE).is_none() {
        std::env::set_var(SECOND_STAGE, "1");
        std::env::current_exe()
            .context("không thấy đường dẫn 8sync")
            .and_then(|exe| super::awake::spawn_detached(&exe, &std::env::args().skip(1).collect::<Vec<_>>()).map(drop))
    } else {
        std::env::remove_var(SECOND_STAGE);
        host(env, id, restore, cols, rows)
    };
    if let Err(e) = &r {
        let state = state_path(&env.home, id);
        if let Some(dir) = state.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(state.with_extension("log"), format!("{e:#}\n"));
        let _ = std::fs::remove_file(lock_path(&state));
    }
    r
}

/// ConPTY opens with a cursor position query (inherit-cursor mode) and holds the output until it
/// is answered: the host answers it, so omp starts with no viewer and no viewer answers it twice.
const OPENING_QUERY: &[u8] = b"\x1b[6n";

/// `restore` (a takeover): first end the omp that has the session open elsewhere, here in the
/// detached host, so a client killed meanwhile never leaves the room without omp.
fn host(env: &Env, id: &str, restore: bool, cols: u16, rows: u16) -> Result<()> {
    let room = resolve(env, id)?;
    if restore {
        end_session(&room.session_dir)?;
    }
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
    let _ = std::fs::remove_file(lock_path(&state));
    let hub: Arc<Mutex<Hub<Queue>>> = Arc::new(Mutex::new(Hub::new()));
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
            let Ok(out) = s.try_clone() else { return };
            let _ = out.set_write_timeout(Some(Duration::from_secs(10)));
            serve(
                &s,
                Queue::spawn(out),
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

/// What a client does when no host answers: start one, wait for ours, or not while another omp has the session.
#[derive(Debug, PartialEq)]
pub(super) enum Plan {
    Start,
    /// The session's omp is our own host's (busy, or still starting): connect again, never report or take it over.
    Wait,
    Elsewhere(u32),
    Takeover,
}

/// `live`: omp pids that have the session open; `host_omp`: the omp of this room's host record
/// (only from a host that is alive and runs this 8sync, see [`host_is_ours`]).
pub(super) fn plan(live: &[u32], host_omp: Option<u32>, takeover: bool) -> Plan {
    if host_omp.is_some_and(|p| live.contains(&p)) {
        return Plan::Wait;
    }
    match (live.first(), takeover) {
        (None, _) => Plan::Start,
        (Some(&p), false) => Plan::Elsewhere(p),
        (Some(_), true) => Plan::Takeover,
    }
}

/// Pids of the omp processes that have this session open (its dir, or a transcript in it, as an argument).
pub(super) fn session_pids(procs: &[(u32, Vec<u8>)], session_dir: &Path) -> Vec<u32> {
    let dir = session_dir.to_string_lossy();
    procs.iter().filter(|(_, argv)| ccc_core::transcript::proc_match(argv, &dir)).map(|(p, _)| *p).collect()
}

/// An image that is 8sync: this executable, a file named `8sync`/`8sync.exe`, or the name `8sync up`
/// gives the running binary when it swaps a new one in (`.8sync.old.<pid>`, selfup.rs); on Linux a
/// replaced binary reads `… (deleted)`.
pub(super) fn eightsync_image(img: &Path) -> bool {
    let name = img.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let name = name.strip_suffix(" (deleted)").unwrap_or(&name);
    name == "8sync" || name == "8sync.exe" || name.starts_with(".8sync.old.")
        || std::env::current_exe().ok().and_then(|me| std::fs::canonicalize(me).ok()).is_some_and(|me| std::fs::canonicalize(img).is_ok_and(|i| i == me))
}

/// The record's omp is alive as the host's own child (parent = host pid, started after it): the
/// host is this record's, whatever its image is called now.
pub(super) fn hosts_its_omp(procs: &[ProcEntry], rec: &HostState) -> bool {
    let Some(host) = procs.iter().find(|p| p.pid == rec.pid && p.started != 0) else { return false };
    rec.omp_pid.is_some_and(|o| procs.iter().any(|p| p.pid == o && p.ppid == rec.pid && p.started >= host.started))
}

/// `rec`'s process is our host, not whatever got its pid: the live parent of the record's omp
/// ([`hosts_its_omp`]) and an 8sync image. A name alone never suffices (any 8sync that got a dead
/// host's pid, with anything listening on the old port, would get the token and the keys).
fn host_is_ours(rec: &HostState) -> bool {
    ccc_core::transcript::process_image(rec.pid).is_some_and(|i| eightsync_image(&i)) && hosts_its_omp(&ccc_core::transcript::processes(), rec)
}

/// The live host of room `id`, the hello sent. A record whose host is gone (or whose pid now runs
/// another program) gets no token; it is deleted unless its omp still has the session open (then
/// the client waits for it, never reports it as another terminal or takes it over).
fn connect(state: &Path, id: &str, session_dir: &Path, cols: u16, rows: u16) -> Option<TcpStream> {
    let s = read_state(state, id)?;
    if !host_is_ours(&s) {
        if !s.omp_pid.is_some_and(|o| session_pids(&ccc_core::transcript::agent_procs(), session_dir).contains(&o)) {
            let _ = std::fs::remove_file(state);
        }
        return None;
    }
    let mut c = TcpStream::connect_timeout(&SocketAddr::from((Ipv4Addr::LOCALHOST, s.port)), Duration::from_secs(2)).ok()?;
    c.set_read_timeout(Some(Duration::from_secs(3))).ok()?;
    c.write_all(hello(&s.token, cols, rows).as_bytes()).ok()?;
    let mut ack = [0u8; ACK.len()];
    c.read_exact(&mut ack).ok()?;
    c.set_read_timeout(None).ok()?;
    let _ = c.set_nodelay(true);
    (ack == ACK).then_some(c)
}

fn wait_host(state: &Path, id: &str, session_dir: &Path, cols: u16, rows: u16, wait: Duration) -> Result<TcpStream> {
    let until = Instant::now() + wait;
    loop {
        if let Some(c) = connect(state, id, session_dir, cols, rows) {
            return Ok(c);
        }
        if Instant::now() > until {
            bail!("omp chưa lên sau {} s (xem {})", wait.as_secs(), state.with_extension("log").display());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn lock_path(state: &Path) -> PathBuf {
    state.with_extension("lock")
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
                    if age.is_some_and(|a| a < LOCK_STALE) {
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

/// Takeover kill order for `root` (an omp that has the session open): `root` first (so it cannot
/// start a new worker between kills), then its descendants in `procs`, parents before children.
/// omp's shared worker daemons (`omp __omp_worker_daemon…`, which the owner's other omp sessions
/// use too) and everything under them are left alone. A "child" started before its parent is not
/// one (its dead parent's pid was reused) and is skipped.
pub(super) fn kill_order(procs: &[ProcEntry], root: u32) -> Vec<ProcEntry> {
    fn daemon(p: &ProcEntry) -> bool {
        p.argv.get(1).is_some_and(|a| a.starts_with("__omp_worker_daemon"))
    }
    fn walk(procs: &[ProcEntry], p: &ProcEntry, out: &mut Vec<ProcEntry>) {
        out.push(p.clone());
        for c in procs.iter().filter(|c| c.ppid == p.pid && c.started != 0 && c.started >= p.started && !daemon(c)) {
            if !out.iter().any(|q| q.pid == c.pid) {
                walk(procs, c, out);
            }
        }
    }
    let mut out = Vec::new();
    if let Some(r) = procs.iter().find(|p| p.pid == root).filter(|r| !daemon(r)) {
        walk(procs, r, &mut out);
    }
    out
}

/// `b` is still the process `a` was: same pid, start time and argv (its parent may differ: an
/// orphan is re-parented on Linux once the root is gone).
fn same_proc(a: &ProcEntry, b: &ProcEntry) -> bool {
    a.pid == b.pid && a.started == b.started && a.argv == b.argv
}

/// Ends one process, never its tree and never by image name.
fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
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

/// Takeover (in the host, before its own omp starts): ends every omp that has the session open,
/// with its own children ([`kill_order`]), one pid at a time, each only while a fresh snapshot still
/// shows that very process ([`same_proc`]); then waits until none is left.
fn end_session(session_dir: &Path) -> Result<()> {
    let live = session_pids(&ccc_core::transcript::agent_procs(), session_dir);
    let snap = ccc_core::transcript::processes();
    let mut order: Vec<ProcEntry> = Vec::new();
    for &root in &live {
        for p in kill_order(&snap, root) {
            if !order.iter().any(|q| q.pid == p.pid) {
                order.push(p);
            }
        }
    }
    for p in &order {
        if ccc_core::transcript::processes().iter().any(|q| same_proc(p, q)) {
            kill_pid(p.pid);
        }
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
    if let Some(s) = connect(&state, id, &room.session_dir, cols, rows) {
        return relay(s);
    }
    let Some(lock) = StartLock::take(&lock_path(&state))? else {
        return relay(wait_host(&state, id, &room.session_dir, cols, rows, LOCK_STALE)?);
    };
    if let Some(s) = connect(&state, id, &room.session_dir, cols, rows) {
        drop(lock);
        return relay(s);
    }
    // `connect` already dropped a record whose host is gone; one left is a live host of ours that did not answer in time.
    let host_omp = read_state(&state, id).and_then(|r| r.omp_pid);
    let live = session_pids(&ccc_core::transcript::agent_procs(), &room.session_dir);
    let restore = match plan(&live, host_omp, takeover) {
        Plan::Wait => {
            drop(lock);
            return relay(wait_host(&state, id, &room.session_dir, cols, rows, START_WAIT)?);
        }
        Plan::Start => false,
        Plan::Elsewhere(pid) => {
            drop(lock);
            let mut out = std::io::stdout().lock();
            let _ = write!(out, "phiên đang mở ở terminal khác trên máy (pid {pid}) — bấm 'Chuyển sang HQ' để mở ở đây\r\n");
            let _ = out.flush();
            std::process::exit(ELSEWHERE);
        }
        // The host ends the other omp itself (see [`host`]).
        Plan::Takeover => true,
    };
    let _ = std::fs::remove_file(&state);
    let exe = std::env::current_exe().context("không thấy đường dẫn 8sync")?;
    let mut args: Vec<String> = ["ccc", "term", "--host", id, "--cols", &cols.to_string(), "--rows", &rows.to_string()].map(String::from).to_vec();
    if restore {
        args.push("--restore".into());
    }
    super::awake::spawn_detached(&exe, &args).context("không chạy được host terminal omp")?;
    // From here the host owns the lock (see [`host_logged`]), also if this client is killed.
    std::mem::forget(lock);
    relay(wait_host(&state, id, &room.session_dir, cols, rows, LOCK_STALE)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    /// A viewer whose bytes the test reads after `serve` moved it into the hub.
    #[derive(Clone, Default)]
    struct Seen(Arc<Mutex<Vec<u8>>>);
    impl Viewer for Seen {
        fn send(&self, b: Arc<[u8]>) -> bool {
            lock(&self.0).extend_from_slice(&b);
            true
        }
    }

    struct Broken;
    impl Viewer for Broken {
        fn send(&self, _: Arc<[u8]>) -> bool {
            false
        }
    }

    /// A socket that never takes a byte (a client that stopped reading); `closed` once its writer ends.
    struct Stuck(std::sync::mpsc::Receiver<()>, Arc<std::sync::atomic::AtomicBool>);
    impl Write for Stuck {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            let _ = self.0.recv();
            Err(std::io::ErrorKind::BrokenPipe.into())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    impl Sink for Stuck {
        fn close(&mut self) {
            self.1.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    fn proc(pid: u32, ppid: u32, started: u64, argv: &[&str]) -> ProcEntry {
        ProcEntry { pid, ppid, started, argv: argv.iter().map(|s| s.to_string()).collect() }
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
        let mut hub: Hub<Box<dyn Viewer>> = Hub::new();
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
    fn a_stuck_client_never_holds_the_hub_and_another_client_still_gets_its_ack_at_once() {
        let (_hold, rx) = std::sync::mpsc::channel();
        let mut hub: Hub<Box<dyn Viewer>> = Hub::new();
        hub.join(Box::new(Queue::spawn(Stuck(rx, Arc::default())))).unwrap();
        let t = Instant::now();
        for _ in 0..QUEUE + 4 {
            hub.push(b"chunk");
        }
        assert!(t.elapsed() < Duration::from_secs(1), "pushing never waits on a socket");
        assert!(hub.viewers.is_empty(), "the stuck client is dropped once its queue is full");
        let seen = Seen::default();
        hub.join(Box::new(seen.clone())).unwrap();
        assert!(lock(&seen.0).starts_with(ACK));
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
        // This test binary is its own "8sync" host, and a child it starts is its omp.
        let mut omp = if cfg!(windows) { std::process::Command::new("ping") } else { std::process::Command::new("sleep") };
        omp.args(if cfg!(windows) { ["-n", "30", "127.0.0.1"].as_slice() } else { ["30"].as_slice() });
        let mut omp = omp.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
        write_state(&p, &HostState { pid: std::process::id(), omp_pid: Some(omp.id()), port, token: TOKEN.into(), room: id.into() }).unwrap();
        let fake = std::thread::spawn(move || {
            for _ in 0..2 {
                let (s, _) = l.accept().unwrap();
                let hub: Mutex<Hub<Queue>> = Mutex::new(Hub::new());
                lock(&hub).push(b"omp ready");
                let mut got = Vec::new();
                serve(s.try_clone().unwrap(), Queue::spawn(s.try_clone().unwrap()), TOKEN, &hub, || {}, |c| got.push(c));
                assert_eq!(got.first(), Some(&Ctl::Resize(80, 24)));
            }
        });
        let mut c = connect(&p, id, &dir, 80, 24).expect("host answers");
        let mut buf = [0u8; 9];
        c.read_exact(&mut buf).unwrap();
        assert_eq!(&buf, b"omp ready", "the ack is not part of the terminal output");
        drop(c);
        // Same pid, port and token on reconnect: it is the same host.
        assert!(connect(&p, id, &dir, 80, 24).is_some());
        fake.join().unwrap();
        assert!(connect(&p, id, &dir, 80, 24).is_none(), "nothing listens any more");
        assert!(p.exists(), "a host of ours that does not answer keeps its record (it may be busy)");
        assert!(connect(&p, "omp-0000000000000004", &dir, 80, 24).is_none());
        let _ = omp.kill();
        let _ = omp.wait();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_record_whose_pid_is_gone_or_runs_another_program_gets_no_token_and_is_deleted() {
        let dir = std::env::temp_dir().join(format!("omp-term-stale-{}", std::process::id()));
        let id = "omp-0000000000000005";
        let p = state_path(&dir, id);
        let l = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        l.set_nonblocking(true).unwrap();
        let port = l.local_addr().unwrap().port();
        let quiet = |c: &mut std::process::Command| {
            c.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        };
        let mut gone = if cfg!(windows) { std::process::Command::new("cmd") } else { std::process::Command::new("true") };
        if cfg!(windows) {
            gone.args(["/c", "exit"]);
        }
        quiet(&mut gone);
        let mut gone = gone.spawn().unwrap();
        let gone_pid = gone.id();
        gone.wait().unwrap();
        let mut other = if cfg!(windows) { std::process::Command::new("ping") } else { std::process::Command::new("sleep") };
        other.args(if cfg!(windows) { ["-n", "30", "127.0.0.1"].as_slice() } else { ["30"].as_slice() });
        quiet(&mut other);
        let mut other = other.spawn().unwrap();
        // Gone, another program, and an 8sync image (this test binary) whose record's omp is not its live child.
        for (pid, omp) in [(gone_pid, Some(gone_pid)), (other.id(), Some(other.id())), (std::process::id(), Some(gone_pid)), (std::process::id(), None)] {
            write_state(&p, &HostState { pid, omp_pid: omp, port, token: TOKEN.into(), room: id.into() }).unwrap();
            assert!(connect(&p, id, &dir, 80, 24).is_none(), "pid {pid}");
            assert!(!p.exists(), "the stale record is deleted (its omp does not have the session open)");
            assert!(l.accept().is_err(), "nothing connected to the port, so no token was sent");
        }
        let _ = other.kill();
        let _ = other.wait();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_open_elsewhere_is_reported_and_our_own_busy_host_is_waited_for() {
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
        assert_eq!(plan(&live, None, false), Plan::Elsewhere(10));
        assert_eq!(plan(&live, None, true), Plan::Takeover);
        assert_eq!(plan(&[], None, false), Plan::Start, "idle: the host starts");
        assert_eq!(plan(&[], None, true), Plan::Start, "a takeover with nothing to take over just starts");
        // The omp holding the session is our own host's (it did not answer in time): wait for it, never report or kill it.
        assert_eq!(plan(&[11], Some(11), false), Plan::Wait);
        assert_eq!(plan(&[11], Some(11), true), Plan::Wait);
        assert_eq!(plan(&[10], Some(11), false), Plan::Elsewhere(10), "a record whose omp is gone does not count");
    }

    #[test]
    fn a_takeover_kills_the_sessions_omp_and_its_own_children_but_never_the_shared_worker_daemons() {
        let procs = vec![
            proc(1, 0, 1, &["explorer.exe"]),
            proc(5, 1, 50, &["pwsh.exe"]),
            proc(18480, 5, 100, &["omp", "--resume", "core.jsonl"]),
            proc(34212, 18480, 110, &["omp.exe", "__omp_worker_daemon_broker"]),
            proc(37764, 34212, 120, &["omp.exe", "__omp_worker_text_predict"]),
            proc(39676, 18480, 130, &["omp.exe", "__omp_worker_js_eval_process"]),
            proc(40000, 39676, 140, &["node.exe", "tool.js"]),
            proc(41000, 18480, 150, &["bash.exe", "-c", "cargo test"]),
            // Started before omp: its dead parent had omp's pid (reused), so it is not omp's child.
            proc(222, 18480, 90, &["sshd.exe"]),
            proc(31884, 5, 160, &["omp", "--resume", "other.jsonl"]),
        ];
        let order: Vec<u32> = kill_order(&procs, 18480).iter().map(|p| p.pid).collect();
        assert_eq!(order, [18480, 39676, 40000, 41000], "the root first (no worker respawns between kills), then parents before children");
        for spared in [34212, 37764, 222, 31884, 5, 1] {
            assert!(!order.contains(&spared), "{spared}");
        }
        assert!(kill_order(&procs, 34212).is_empty(), "a worker daemon is never a takeover root");
        assert!(kill_order(&procs, 99).is_empty(), "a pid that is gone");
        let mut cycle = procs.clone();
        cycle.push(proc(18480, 41000, 100, &["omp"]));
        assert!(kill_order(&cycle, 18480).len() <= cycle.len(), "a parent loop ends");
    }

    #[test]
    fn after_8sync_up_renames_the_running_exe_the_host_is_still_known_by_its_name_and_its_omp_child() {
        let bin = std::env::temp_dir().join("bin");
        for ok in [".8sync.old.4242", "8sync.exe", "8sync", "8sync (deleted)"] {
            assert!(eightsync_image(&bin.join(ok)), "{ok}");
        }
        for bad in ["PING.EXE", "nc", "8sync-evil.exe"] {
            assert!(!eightsync_image(&bin.join(bad)), "{bad}");
        }
        let rec = |pid, omp| HostState { pid, omp_pid: Some(omp), port: 4000, token: TOKEN.into(), room: "omp-0000000000000006".into() };
        let procs = vec![proc(70, 5, 100, &[".8sync.old.70", "ccc", "term", "--host"]), proc(71, 70, 101, &["omp"]), proc(72, 9, 102, &["omp"]), proc(73, 70, 99, &["omp"])];
        assert!(hosts_its_omp(&procs, &rec(70, 71)), "its omp is its child, started after it");
        assert!(!hosts_its_omp(&procs, &rec(70, 72)), "an omp that is not its child");
        assert!(!hosts_its_omp(&procs, &rec(70, 73)), "a 'child' older than the host: the pid was reused");
        assert!(!hosts_its_omp(&procs, &rec(70, 99)) && !hosts_its_omp(&procs, &rec(98, 71)), "gone");
        // Real processes: this test is the host, a child it starts is its omp.
        let mut child = if cfg!(windows) { std::process::Command::new("ping") } else { std::process::Command::new("sleep") };
        child.args(if cfg!(windows) { ["-n", "30", "127.0.0.1"].as_slice() } else { ["30"].as_slice() });
        let mut child = child.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
        let snap = ccc_core::transcript::processes();
        assert!(hosts_its_omp(&snap, &rec(std::process::id(), child.id())));
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn a_viewer_the_hub_drops_has_its_socket_closed() {
        let (hold, rx) = std::sync::mpsc::channel();
        let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut hub: Hub<Queue> = Hub::new();
        hub.join(Queue::spawn(Stuck(rx, closed.clone()))).unwrap();
        for _ in 0..QUEUE + 4 {
            hub.push(b"chunk");
        }
        assert!(hub.viewers.is_empty());
        drop(hold);
        let until = Instant::now() + Duration::from_secs(5);
        while !closed.load(std::sync::atomic::Ordering::SeqCst) && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(closed.load(std::sync::atomic::Ordering::SeqCst), "a dropped client's socket is shut down, not left frozen");
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
