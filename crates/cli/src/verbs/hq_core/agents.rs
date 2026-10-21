//! `claude agents --json` behind a fingerprint cache. The listing is Claude Code's own (it merges
//! `~/.claude/sessions/<pid>.json`, background-job state and name rules that change between
//! releases), so the core never re-implements it: it re-runs claude only when what the listing is
//! made of changed — a session file or a job state file (name, size, mtime), or a session's pid
//! died or was reused — and at least every [`MAX_AGE`] for anything else.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, UNIX_EPOCH};

pub const MAX_AGE: Duration = Duration::from_secs(30);
/// A listing this young is served even when the fingerprint moved: busy rooms rewrite their session
/// and job files every second or so, and with a fresh run per poll the polls of every HQ client
/// queued on the mutex behind one claude run each, timed out in node (5 s) and fell back to one
/// `claude agents` per request — 15 at once, rooms shown as ids and stale "Đang làm" (2026-10-21).
pub const MIN_GAP: Duration = Duration::from_secs(3);
/// A failed run serves the last good listing while it is this young (a slow `claude` under load is
/// not "no room is running").
pub const KEEP_GOOD: Duration = Duration::from_secs(120);
const TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUT: u64 = 4 * 1024 * 1024;
/// Entries per directory folded into the fingerprint; past it the TTL alone refreshes.
const MAX_ENTRIES: usize = 256;

/// Env the HQ server never hands a child (`apps/hq-ui/lib/server/child-env.ts` DROP + `HQ_*`).
pub const DROP_ENV: [&str; 6] = ["PORT", "HOSTNAME", "NODE_ENV", "CLAUDE_CODE_SESSION_ID", "EIGHTSYNC_ROOM", "EIGHTSYNC_ROOM_ID"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub len: u64,
    pub mtime_ns: u128,
    /// Session files only: the start time of the pid in the file name (None = not running).
    pub start: Option<u64>,
}

/// What the listing depends on, in a stable order.
pub type Fingerprint = Vec<Entry>;

fn mtime_ns(m: &std::fs::Metadata) -> u128 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos())
}

/// `<claude>/sessions/*.json` (with pid liveness) then `<claude>/jobs/*/state.json`.
pub fn fingerprint(claude: &Path, alive: impl Fn(u32) -> Option<u64>) -> Fingerprint {
    let mut out = Vec::new();
    let mut sessions: Vec<(String, std::fs::Metadata)> = std::fs::read_dir(claude.join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().into_owned();
            n.ends_with(".json").then_some(())?;
            Some((n, e.metadata().ok()?))
        })
        .take(MAX_ENTRIES)
        .collect();
    sessions.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, m) in sessions {
        let start = name.strip_suffix(".json").and_then(|p| p.parse::<u32>().ok()).and_then(&alive);
        out.push(Entry { len: m.len(), mtime_ns: mtime_ns(&m), start, name });
    }
    let mut jobs: Vec<Entry> = std::fs::read_dir(claude.join("jobs"))
        .into_iter()
        .flatten()
        .flatten()
        .take(MAX_ENTRIES)
        .filter_map(|e| {
            let m = std::fs::metadata(e.path().join("state.json")).ok()?;
            Some(Entry { name: format!("jobs/{}", e.file_name().to_string_lossy()), len: m.len(), mtime_ns: mtime_ns(&m), start: None })
        })
        .collect();
    jobs.sort_by(|a, b| a.name.cmp(&b.name));
    out.extend(jobs);
    out
}

/// Claude Code's config dir: `CLAUDE_CONFIG_DIR`, else `~/.claude`.
pub fn claude_dir() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".claude")))
}

pub struct Cache {
    fp: Option<Fingerprint>,
    at: Option<Instant>,
    /// Claude's stdout when it was valid JSON; `null` when claude failed (callers trust the journal).
    body: std::sync::Arc<[u8]>,
    /// When `body` last came from a run that worked.
    good_at: Option<Instant>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache { fp: None, at: None, body: std::sync::Arc::from(&b"null"[..]), good_at: None }
    }
}

impl Cache {
    /// Whether a cached answer may be served for `fp` at `now`.
    pub fn fresh(&self, fp: &Fingerprint, now: Instant) -> bool {
        let age = |t: Instant| now.saturating_duration_since(t);
        self.at.is_some_and(|t| age(t) < MIN_GAP) || (self.fp.as_ref() == Some(fp) && self.at.is_some_and(|t| age(t) < MAX_AGE))
    }

    pub fn store(&mut self, fp: Fingerprint, now: Instant, body: Option<Vec<u8>>) {
        self.fp = Some(fp);
        self.at = Some(now);
        match body {
            Some(b) => {
                self.body = std::sync::Arc::from(b);
                self.good_at = Some(now);
            }
            None if self.good_at.is_some_and(|t| now.saturating_duration_since(t) < KEEP_GOOD) => {}
            None => self.body = std::sync::Arc::from(&b"null"[..]),
        }
    }
    pub fn body(&self) -> std::sync::Arc<[u8]> {
        self.body.clone()
    }
}

/// The listing, from cache when nothing it depends on changed. Callers serialise on the mutex,
/// so concurrent polls share one claude run.
pub fn get(cache: &std::sync::Mutex<Cache>) -> std::sync::Arc<[u8]> {
    let mut c = cache.lock().unwrap_or_else(|p| p.into_inner());
    let Some(dir) = claude_dir() else { return c.body() };
    let fp = fingerprint(&dir, super::sys::proc_start);
    let now = Instant::now();
    if !c.fresh(&fp, now) {
        let out = run_claude();
        c.store(fp, Instant::now(), out);
    }
    c.body()
}

/// `claude agents --json`, scrubbed env, 5 s timeout, stdout only when it is JSON.
fn run_claude() -> Option<Vec<u8>> {
    let bin = which::which("claude").ok()?;
    let mut cmd = Command::new(bin);
    cmd.args(["agents", "--json"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    for k in DROP_ENV {
        cmd.env_remove(k);
    }
    for (k, _) in std::env::vars_os() {
        if k.to_string_lossy().to_ascii_uppercase().starts_with("HQ_") {
            cmd.env_remove(k);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = run_bounded(cmd, TIMEOUT)?;
    serde_json::from_slice::<serde::de::IgnoredAny>(&out).ok()?;
    Some(out)
}

/// Runs `cmd`, reading at most [`MAX_OUT`] bytes of stdout; killed after `timeout`. None on failure.
pub fn run_bounded(mut cmd: Command, timeout: Duration) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = (&mut stdout).take(MAX_OUT).read_to_end(&mut buf);
        buf
    });
    let end = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let buf = reader.join().ok()?;
    status.filter(|s| s.success()).map(|_| buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("hq-core-agents-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("sessions")).unwrap();
        std::fs::create_dir_all(d.join("jobs/abc")).unwrap();
        d
    }

    #[test]
    fn fingerprint_moves_with_files_and_pid_liveness() {
        let d = tmp("fp");
        std::fs::write(d.join("sessions/42.json"), "{}").unwrap();
        std::fs::write(d.join("sessions/notes.txt"), "x").unwrap();
        std::fs::write(d.join("jobs/abc/state.json"), "{}").unwrap();
        let live = |pid: u32| (pid == 42).then_some(7u64);
        let a = fingerprint(&d, live);
        assert_eq!(a.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["42.json", "jobs/abc"]);
        assert_eq!(a[0].start, Some(7));
        assert_eq!(fingerprint(&d, live), a, "nothing changed");
        // the room died (or its pid now names another process)
        assert_ne!(fingerprint(&d, |_| None), a);
        assert_ne!(fingerprint(&d, |_| Some(8)), a);
        // a status write grows the file
        std::fs::write(d.join("sessions/42.json"), "{\"status\":\"idle\"}").unwrap();
        assert_ne!(fingerprint(&d, live), a);
        // a new job
        let b = fingerprint(&d, live);
        std::fs::create_dir_all(d.join("jobs/def")).unwrap();
        std::fs::write(d.join("jobs/def/state.json"), "{}").unwrap();
        assert_ne!(fingerprint(&d, live), b);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn cache_serves_same_fingerprint_until_max_age() {
        let fp = vec![Entry { name: "1.json".into(), len: 2, mtime_ns: 3, start: Some(4) }];
        let t0 = Instant::now();
        let mut c = Cache::default();
        assert!(!c.fresh(&fp, t0), "empty cache");
        assert_eq!(&*c.body(), b"null");
        c.store(fp.clone(), t0, Some(b"[]".to_vec()));
        assert!(c.fresh(&fp, t0 + Duration::from_secs(1)));
        assert!(!c.fresh(&fp, t0 + MAX_AGE), "too old");
        assert!(c.fresh(&vec![], t0 + Duration::from_secs(1)), "a moved fingerprint waits MIN_GAP: one run serves every poll");
        assert!(!c.fresh(&vec![], t0 + MIN_GAP), "something changed, past MIN_GAP");
        // A failed run under load keeps the last good listing (rooms keep their names) …
        c.store(vec![], t0 + MIN_GAP, None);
        assert_eq!(&*c.body(), b"[]");
        // … not for ever: past KEEP_GOOD with no good run it says null (HQ trusts its journal).
        c.store(vec![], t0 + KEEP_GOOD, None);
        assert_eq!(&*c.body(), b"null", "a failed run is served as null, not retried per poll");
        assert!(c.fresh(&vec![], t0 + KEEP_GOOD + Duration::from_secs(1)), "and not retried per poll either");
    }
}
