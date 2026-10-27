//! The HQ native core: a loopback JSON server inside the long-running `8sync hq ui` supervisor.
//! It keeps the data the HQ web server polls warm in one process — the `claude agents` listing,
//! `8sync ls --all` rows, boards, the awake probe, a machine/energy sampler and transcript token
//! sums — so node stops starting a process per request. Node finds it through `HQ_CORE` (URL) and
//! `HQ_CORE_TOKEN`; `HQ_*` never reaches a room (`apps/hq-ui/lib/server/child-env.ts`).
//! Endpoints and caches: see each submodule; node side: `apps/hq-ui/lib/server/core.ts`.

pub mod agents;
pub mod disk;
pub mod http;
pub mod sampler;
pub mod sys;
pub mod usage;

use serde_json::{json, Value};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Connections handled at once; more get 503 (node polls a handful of routes per client).
const MAX_CONN: usize = 8;
/// `8sync ls --all` rebuilt at most this often (floor.ts caches its copy 4 s too).
const LS_TTL: Duration = Duration::from_secs(4);

pub struct Handle {
    pub url: String,
    pub token: String,
}

struct Core {
    token: String,
    home: std::path::PathBuf,
    env: crate::env_detect::Env,
    agents: Mutex<agents::Cache>,
    ls: Mutex<Option<(Instant, Arc<[u8]>)>>,
    usage: Mutex<usage::Scanner>,
    sampler: Option<sampler::Sampler>,
    /// One disk walk at a time: the disk, not the CPU, is the limit (disk.ts `startScan`).
    disk: Mutex<()>,
    busy: AtomicUsize,
}

/// Binds 127.0.0.1 on an ephemeral port and starts the core's threads. None (with the reason on
/// stderr) when it can't: node then runs its own probes as before.
pub fn start() -> Option<Handle> {
    let fail = |what: &str, e: &dyn std::fmt::Display| {
        crate::ui::warn(&format!("HQ core: {what}: {e} (HQ falls back to per-request probes)"));
        None
    };
    let mut raw = [0u8; 32];
    if let Err(e) = getrandom::getrandom(&mut raw) {
        return fail("random token", &e);
    }
    let token: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(l) => l,
        Err(e) => return fail("bind 127.0.0.1", &e),
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(e) => return fail("local addr", &e),
    };
    let env = match crate::env_detect::Env::detect() {
        Ok(e) => e,
        Err(e) => return fail("home", &e),
    };
    crate::verbs::session_view::enable_digest_cache();
    let core = Arc::new(Core {
        token: token.clone(),
        home: env.home.clone(),
        env,
        agents: Mutex::default(),
        ls: Mutex::default(),
        usage: Mutex::default(),
        sampler: sampler::Sampler::new(),
        disk: Mutex::default(),
        busy: AtomicUsize::new(0),
    });
    if core.sampler.is_some() {
        let c = core.clone();
        let _ = std::thread::Builder::new().name("hq-core-sampler".into()).spawn(move || loop {
            // Only while someone watches the Máy tab; otherwise nothing is read between requests.
            if let Some(s) = c.sampler.as_ref().filter(|s| s.wanted()) {
                s.get(sampler::EVERY / 2);
            }
            std::thread::sleep(sampler::EVERY);
        });
    }
    let c = core.clone();
    let spawned = std::thread::Builder::new().name("hq-core-http".into()).spawn(move || {
        for stream in listener.incoming().flatten() {
            if c.busy.fetch_add(1, Ordering::SeqCst) >= MAX_CONN {
                c.busy.fetch_sub(1, Ordering::SeqCst);
                let mut s = stream;
                let _ = http::write_json(&mut s, 503, br#"{"error":"busy"}"#);
                continue;
            }
            let c2 = c.clone();
            let ok = std::thread::Builder::new().name("hq-core-conn".into()).spawn(move || {
                serve(&c2, stream);
                c2.busy.fetch_sub(1, Ordering::SeqCst);
            });
            if ok.is_err() {
                c.busy.fetch_sub(1, Ordering::SeqCst);
            }
        }
    });
    if let Err(e) = spawned {
        return fail("thread", &e);
    }
    Some(Handle { url: format!("http://127.0.0.1:{port}"), token })
}

/// The whole request must arrive within this; a slot is never held longer by a slow sender.
const READ_DEADLINE: Duration = Duration::from_secs(5);

fn serve(core: &Core, s: TcpStream) {
    let _ = s.set_write_timeout(Some(Duration::from_secs(10)));
    let deadline = Instant::now() + READ_DEADLINE;
    let req = match http::read_request(&mut &s, deadline, &core.token, &mut |d| s.set_read_timeout(Some(d))) {
        Ok(r) => r,
        Err(http::Bad::Status(code)) => {
            let msg: &[u8] = if code == 401 { br#"{"error":"token"}"# } else { br#"{"error":"bad request"}"# };
            let _ = http::write_json(&mut &s, code, msg);
            return;
        }
        Err(http::Bad::Io) => return,
    };
    let (code, body) = route(core, &req);
    let _ = http::write_json(&mut &s, code, &body);
}

fn err(code: u16, msg: &str) -> (u16, Arc<[u8]>) {
    (code, Arc::from(json!({ "error": msg }).to_string().into_bytes()))
}

fn ok(v: &Value) -> (u16, Arc<[u8]>) {
    (200, Arc::from(v.to_string().into_bytes()))
}

fn route(core: &Core, req: &http::Request) -> (u16, Arc<[u8]>) {
    if !req.token.as_deref().is_some_and(|t| http::token_eq(t, &core.token)) {
        return err(401, "token");
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/v1/health") => ok(&json!({ "ok": true, "version": env!("CARGO_PKG_VERSION"), "pid": std::process::id() })),
        ("GET", "/v1/agents") => (200, agents::get(&core.agents)),
        ("GET", "/v1/ls") => (200, ls(core)),
        ("GET", "/v1/board") => {
            let Some(root) = http::query_param(&req.query, "root").filter(|r| std::path::Path::new(r).is_absolute()) else {
                return err(400, "root: absolute path required");
            };
            match crate::verbs::ccc::board_json_at(&core.home, std::path::Path::new(&root)) {
                Ok(v) => ok(&v),
                Err(e) => err(422, &format!("{e:#}")),
            }
        }
        ("GET", "/v1/awake") => match serde_json::to_vec(&crate::verbs::ccc::awake::status_now()) {
            Ok(b) => (200, Arc::from(b)),
            Err(e) => err(500, &e.to_string()),
        },
        ("GET", "/v1/machine") => match &core.sampler {
            Some(s) => {
                s.touch();
                ok(&sampler::machine_json(&s.get(sampler::STALE)))
            }
            None => err(404, "no sampler on this OS"),
        },
        ("GET", "/v1/power") => match &core.sampler {
            Some(s) => ok(&sampler::power_json(&s.get(sampler::POWER_FRESH))),
            None => err(404, "no sampler on this OS"),
        },
        ("POST", "/v1/usage") => {
            let ask: usage::Ask = match serde_json::from_slice(&req.body) {
                Ok(a) => a,
                Err(e) => return err(400, &format!("body: {e}")),
            };
            if ask.roots.len() > 512 {
                return err(413, "roots: at most 512");
            }
            let Some(claude) = agents::claude_dir() else { return err(500, "no home") };
            let projects = claude.join("projects");
            let budget = ask.budget.unwrap_or(usage::BYTES_PER_REQUEST).min(usage::BYTES_PER_REQUEST);
            let mut sc = core.usage.lock().unwrap_or_else(|p| p.into_inner());
            let r = sc.report(&ask.roots, &projects, ask.keep_from, ask.day_start, ask.window_start, budget);
            ok(&usage::scan_json(&r))
        }
        ("POST", "/v1/disk") => {
            let ask: disk::Ask = match serde_json::from_slice(&req.body) {
                Ok(a) => a,
                Err(e) => return err(400, &format!("body: {e}")),
            };
            if !std::path::Path::new(&ask.root).is_absolute() {
                return err(400, "root: absolute path required");
            }
            // One walk at a time, and a waiting caller must not sit in a connection slot: answer at
            // once; node keeps the project "scanning" and asks again.
            let _one = match core.disk.try_lock() {
                Ok(g) => g,
                Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) => return err(409, "scanning"),
            };
            ok(&disk::scan(&ask.root, &ask.name, ask.at))
        }
        (_, "/v1/health" | "/v1/agents" | "/v1/ls" | "/v1/board" | "/v1/awake" | "/v1/machine" | "/v1/power" | "/v1/usage" | "/v1/disk") => err(405, "method"),
        _ => err(404, "route"),
    }
}

/// `8sync ls --all --json`, rebuilt from warm transcript digests at most every [`LS_TTL`].
fn ls(core: &Core) -> Arc<[u8]> {
    let mut c = core.ls.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((at, body)) = c.as_ref() {
        if at.elapsed() < LS_TTL {
            return body.clone();
        }
    }
    let procs = crate::verbs::session_view::agent_cmdlines();
    let rows = crate::verbs::session_cmds::ls_all_json(&core.env, &procs, crate::verbs::session_view::SortKey::default(), false);
    let body: Arc<[u8]> = Arc::from(serde_json::to_vec(&rows).unwrap_or_else(|_| b"[]".to_vec()));
    *c = Some((Instant::now(), body.clone()));
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn core() -> Core {
        Core {
            token: "t0k".into(),
            home: std::env::temp_dir(),
            env: crate::env_detect::Env::detect().unwrap(),
            agents: Mutex::default(),
            ls: Mutex::default(),
            usage: Mutex::default(),
            sampler: None,
            disk: Mutex::default(),
            busy: AtomicUsize::new(0),
        }
    }

    fn req(method: &str, path: &str, token: Option<&str>, body: &str) -> http::Request {
        let (path, query) = path.split_once('?').unwrap_or((path, ""));
        http::Request { method: method.into(), path: path.into(), query: query.into(), token: token.map(str::to_string), body: body.as_bytes().to_vec() }
    }

    #[test]
    fn routes_need_the_token_and_known_paths() {
        let c = core();
        assert_eq!(route(&c, &req("GET", "/v1/health", None, "")).0, 401);
        assert_eq!(route(&c, &req("GET", "/v1/health", Some("t0x"), "")).0, 401);
        let (code, body) = route(&c, &req("GET", "/v1/health", Some("t0k"), ""));
        assert_eq!(code, 200);
        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap()["ok"], json!(true));
        assert_eq!(route(&c, &req("GET", "/v1/nope", Some("t0k"), "")).0, 404);
        assert_eq!(route(&c, &req("DELETE", "/v1/ls", Some("t0k"), "")).0, 405);
        assert_eq!(route(&c, &req("GET", "/v1/machine", Some("t0k"), "")).0, 404, "no sampler: node keeps its probes");
        assert_eq!(route(&c, &req("GET", "/v1/board?root=relative", Some("t0k"), "")).0, 400);
        assert_eq!(route(&c, &req("POST", "/v1/usage", Some("t0k"), "{}")).0, 400);
        let (code, body) = route(&c, &req("POST", "/v1/usage", Some("t0k"), r#"{"roots":[],"keep_from":0,"day_start":0,"window_start":0}"#));
        assert_eq!(code, 200);
        let v: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["scan"]["files"], json!(0));
        assert_eq!(v["totals"]["today"]["median_ctx"], Value::Null);
    }

    #[test]
    fn a_second_disk_walk_is_refused_at_once() {
        let c = core();
        let root = std::env::temp_dir().to_string_lossy().into_owned();
        let body = json!({ "root": root, "name": "t", "at": 1 }).to_string();
        let held = c.disk.lock().unwrap();
        let (code, b) = route(&c, &req("POST", "/v1/disk", Some("t0k"), &body));
        assert_eq!((code, serde_json::from_slice::<Value>(&b).unwrap()), (409, json!({ "error": "scanning" })));
        drop(held);
    }

    #[test]
    fn serves_over_loopback_with_the_token() {
        let h = start().expect("core starts");
        let addr = h.url.strip_prefix("http://").unwrap().to_string();
        let ask = |token: &str| {
            let mut s = TcpStream::connect(&addr).unwrap();
            write!(s, "GET /v1/health HTTP/1.1\r\nHost: x\r\nX-Core-Token: {token}\r\n\r\n").unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).unwrap();
            out
        };
        let good = ask(&h.token);
        assert!(good.starts_with("HTTP/1.1 200 OK\r\n"), "{good}");
        assert!(good.contains("\"ok\":true"));
        assert!(ask("wrong").starts_with("HTTP/1.1 401"));
        // a wrong token is refused on its head: the promised body is never waited for
        let t = Instant::now();
        let mut s = TcpStream::connect(&addr).unwrap();
        write!(s, "POST /v1/usage HTTP/1.1\r\nX-Core-Token: wrong\r\nContent-Length: 500000\r\n\r\n").unwrap();
        let mut out = String::new();
        s.read_to_string(&mut out).unwrap();
        assert!(out.starts_with("HTTP/1.1 401") && t.elapsed() < READ_DEADLINE, "{out}");
        assert_eq!(h.token.len(), 64);
    }
}
