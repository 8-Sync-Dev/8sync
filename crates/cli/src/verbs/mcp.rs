//! `8sync mcp serve`: 8sync as a local MCP server (stdio, JSON-RPC 2.0, one message per line;
//! https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio), so Claude
//! Desktop (chat), Cowork and Claude Code get the harness without a terminal: what the machine
//! uses, every session, the knowledge tree, cost report, kit state; and one write (a lesson).
//! `8sync mcp install` registers it in Claude Desktop's `claude_desktop_config.json` (and, with
//! `--claude-code`, Claude Code's user scope).
//!
//! Every tool but `machine` runs this same binary with an argv array (no shell) inside the repo
//! the call names, bounded by [`CALL_TIMEOUT`] and [`OUT_MAX`]. Nothing leaves the machine; no
//! token, secret, inbox or grant file is ever read here (those stay behind the kit's guard).

use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use clap::{Args as ClapArgs, Subcommand};
use serde_json::{json, Value};

use crate::ui;

/// Protocol revisions this server speaks; a client asking for another gets the newest.
const PROTOCOLS: [&str; 3] = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// How long the output readers get once the child ended (or was killed).
const READ_GRACE: Duration = Duration::from_secs(3);
/// Characters of a tool's output handed back (the rest is cut with a note).
const OUT_MAX: usize = 40_000;
/// Longest task / lesson text a write tool takes.
const TEXT_MAX: usize = 2_000;
const NAME: &str = "8sync";

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync mcp install                 register in Claude Desktop (restart it after)
      8sync mcp install --claude-code   also Claude Code (user scope)
      8sync mcp install --print         only print the config entry
      8sync mcp uninstall               remove it again
      8sync mcp tools                   list the tools the server gives
      8sync mcp serve                   the server itself (stdio; started by the client)
"})]
pub struct Args {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Run the MCP server on stdin/stdout (the client starts this)
    Serve {
        /// The PC-control server (shell, files) instead of the harness one
        #[arg(long)]
        pc: bool,
    },
    /// Register the server in Claude Desktop (and Claude Code with --claude-code)
    Install {
        /// Also register it in Claude Code's user scope (`claude mcp add-json --scope user`)
        #[arg(long)]
        claude_code: bool,
        /// Print the config entry instead of writing it
        #[arg(long)]
        print: bool,
        /// Also give Claude Desktop control of this PC: a second server `8sync-pc` (shell, read,
        /// write, list) behind the guard, secret-path refusals and an audit log
        #[arg(long)]
        pc: bool,
    },
    /// Switch Claude Desktop's PC control on or off without editing its config
    Pc {
        /// on | off | status
        action: String,
    },
    /// Remove the server from Claude Desktop (and Claude Code)
    Uninstall,
    /// List the tools
    Tools,
}

pub fn run(a: Args) -> Result<()> {
    match a.cmd {
        Cmd::Serve { pc } => serve(pc),
        Cmd::Install { claude_code, print, pc } => install(claude_code, print, pc),
        Cmd::Pc { action } => super::mcp_pc::switch(&action),
        Cmd::Uninstall => uninstall(),
        Cmd::Tools => {
            for t in tools() {
                println!("{:<12} {}", t["name"].as_str().unwrap_or(""), t["description"].as_str().unwrap_or(""));
            }
            Ok(())
        }
    }
}

// ── tools ────────────────────────────────────────────────────────────────────────────────────

fn repo_prop() -> Value {
    json!({ "type": "string", "description": "Absolute path of the project's git repo (as `sessions` lists it)." })
}

pub(crate) fn tool(name: &str, title: &str, description: &str, props: Value, required: &[&str], read_only: bool) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": { "type": "object", "properties": props, "required": required, "additionalProperties": false },
        "annotations": { "title": title, "readOnlyHint": read_only, "destructiveHint": false, "idempotentHint": read_only, "openWorldHint": false },
    })
}

/// The tool list (`tools/list`).
pub(crate) fn tools() -> Vec<Value> {
    vec![
        tool(
            "machine",
            "Machine usage",
            "What this computer uses right now: RAM, CPU, GPU (util, VRAM, temperature, watts), CPU watts, battery, how much RAM Claude Code and node hold, and the 8sync eco mode that keeps long sessions light.",
            json!({}),
            &[],
            true,
        ),
        tool("sessions", "Sessions", "Every Claude Code / omp session 8sync knows on this machine, per repo: running or not, last request, what it is doing.", json!({}), &[], true),
        tool(
            "knowledge",
            "Knowledge",
            "Lessons learned on this machine: the project's tree, or every project with all=true.",
            json!({ "repo": repo_prop(), "all": { "type": "boolean", "description": "Every project, not only this repo." } }),
            &[],
            true,
        ),
        tool("report", "Cost report", "Per-session cost and task report for a project.", json!({ "repo": repo_prop() }), &["repo"], true),
        tool("kit", "Kit status", "Whether the 8sync kit (hooks, agents, skills, mods) is installed in Claude Code, and its version.", json!({}), &[], true),
        tool(
            "know_add",
            "Add lesson",
            "Record a lesson with evidence in the knowledge tree (`8sync ccc know add`): the repo's, or the company book with shared=true.",
            json!({
                "text": { "type": "string", "description": "The lesson and its evidence." },
                "repo": repo_prop(),
                "shared": { "type": "boolean", "description": "Company book: true for every project." },
            }),
            &["text"],
            false,
        ),
    ]
}

/// A repo argument: an existing absolute directory.
pub(crate) fn repo_arg(v: &Value, required: bool) -> Result<Option<PathBuf>> {
    let Some(r) = v["repo"].as_str().filter(|s| !s.trim().is_empty()) else {
        if required {
            bail!("`repo` is required: the absolute path of a project (see the `sessions` tool)");
        }
        return Ok(None);
    };
    let p = PathBuf::from(r.trim());
    if !p.is_absolute() {
        bail!("`repo` must be an absolute path, got {r}");
    }
    if !p.is_dir() {
        bail!("`repo` is not a directory on this machine: {r}");
    }
    // Only a git repo: any other folder would be adopted as a new project.
    if !p.join(".git").exists() {
        bail!("`repo` is not a git repo (no .git): {r}");
    }
    Ok(Some(p))
}

/// A free-text argument: present, bounded, never read as a flag.
pub(crate) fn text_arg(v: &Value, key: &str) -> Result<String> {
    let t = v[key].as_str().map(str::trim).unwrap_or("");
    if t.is_empty() {
        bail!("`{key}` is required");
    }
    if t.chars().count() > TEXT_MAX {
        bail!("`{key}` is longer than {TEXT_MAX} characters");
    }
    if t.starts_with('-') {
        bail!("`{key}` must not start with '-'");
    }
    Ok(t.to_string())
}

/// The `8sync` argv (and working directory) a tool call runs; None for in-process tools.
pub(crate) fn argv(name: &str, a: &Value) -> Result<Option<(Vec<String>, Option<PathBuf>)>> {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    Ok(Some(match name {
        "machine" => return Ok(None),
        "sessions" => (s(&["ls", "--all", "--json"]), None),
        "report" => (s(&["ccc", "report", "--json"]), repo_arg(a, true)?),
        "kit" => (s(&["ccc", "kit", "status"]), None),
        "knowledge" => {
            let mut v = s(&["ccc", "know", "ls", "--json"]);
            if a["all"].as_bool() == Some(true) {
                v.push("--all".into());
            }
            (v, repo_arg(a, false)?)
        }
        "know_add" => {
            let mut v = vec!["ccc".into(), "know".into(), "add".into(), text_arg(a, "text")?];
            if a["shared"].as_bool() == Some(true) {
                v.push("--shared".into());
            }
            (v, repo_arg(a, false)?)
        }
        _ => bail!("unknown tool `{name}`"),
    }))
}

/// Runs this binary with `args` in `cwd`; (exit ok, stdout + stderr), cut to [`OUT_MAX`].
fn run_self(args: &[String], cwd: Option<&Path>) -> Result<(bool, String)> {
    let exe = std::env::current_exe().context("current_exe")?;
    run_cmd(&exe, args, cwd, CALL_TIMEOUT)
}

/// `prog args` without a shell window, output bounded, the whole tree killed after `limit`.
pub(crate) fn run_cmd(prog: &Path, args: &[String], cwd: Option<&Path>, limit: Duration) -> Result<(bool, String)> {
    let mut c = Command::new(prog);
    c.args(args)
        .env("SUSYNC_NO_AUTO_CHECK", "1")
        .env("NO_COLOR", "1")
        .env("EIGHTSYNC_MCP", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = cwd {
        c.current_dir(d);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = c.spawn().context("could not start 8sync")?;
    // Readers report over channels: a grandchild still holding a pipe after a timeout must not
    // hang the server (the joins below wait at most READ_GRACE).
    let reader = |pipe: Option<Box<dyn Read + Send>>| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_string(&mut s);
            }
            let _ = tx.send(s);
        });
        rx
    };
    let ro = reader(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let re = reader(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let start = Instant::now();
    let status = loop {
        if let Some(st) = child.try_wait()? {
            break Some(st);
        }
        if start.elapsed() > limit {
            kill_tree(&mut child);
            break None;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut text = ro.recv_timeout(READ_GRACE).unwrap_or_default();
    let e = re.recv_timeout(READ_GRACE).unwrap_or_default();
    if !e.trim().is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(e.trim_end());
    }
    let text = strip_ansi(&text);
    let ok = status.is_some_and(|s| s.success());
    let text = match status {
        None => format!("{text}\n(stopped after {} s)", limit.as_secs()),
        Some(_) => text,
    };
    Ok((ok, cut(&text)))
}

/// The child and, on Windows, everything it started (`taskkill /T`); unix: the child.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &child.id().to_string()]).creation_flags(0x0800_0000).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\u{1b}' && it.peek() == Some(&'[') {
            it.next();
            for d in it.by_ref() {
                if d.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

pub(crate) fn cut(s: &str) -> String {
    if s.chars().count() <= OUT_MAX {
        return s.to_string();
    }
    let head: String = s.chars().take(OUT_MAX).collect();
    format!("{head}\n… (cut at {OUT_MAX} characters)")
}

fn call(name: &str, a: &Value) -> (bool, String) {
    let r = (|| -> Result<(bool, String)> {
        match argv(name, a)? {
            None => {
                let home = dirs::home_dir().context("no HOME")?;
                let s = crate::verbs::hq_core::sampler::Sampler::new().map(|s| s.get(Duration::ZERO)).unwrap_or_default();
                Ok((true, serde_json::to_string_pretty(&crate::verbs::ccc::eco_snapshot(&home, &s))?))
            }
            Some((args, cwd)) => run_self(&args, cwd.as_deref()),
        }
    })();
    match r {
        Ok(x) => x,
        Err(e) => (false, format!("{e:#}")),
    }
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────────────────────

fn ok(id: &Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn err(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// The reply to one incoming message; None for a notification (no `id`) or a response.
/// `call` runs a tool (injected in tests).
pub(crate) fn handle(msg: &Value, call: &dyn Fn(&str, &Value) -> (bool, String)) -> Option<Value> {
    handle_with(msg, &Server { name: NAME, title: "8 Sync harness", tools: tools(), instructions: "8sync harness on this machine. `machine` shows RAM/CPU/GPU/power now; `sessions` lists every Claude Code / omp session and its repo; report/knowledge read one project (pass its absolute `repo`). know_add writes; say what you add." }, call)
}

/// Who answers: the harness server or the PC-control one.
pub(crate) struct Server {
    pub name: &'static str,
    pub title: &'static str,
    pub tools: Vec<Value>,
    pub instructions: &'static str,
}

pub(crate) fn handle_with(msg: &Value, srv: &Server, call: &dyn Fn(&str, &Value) -> (bool, String)) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let Some(method) = msg["method"].as_str() else {
        // A response to something we never asked, or garbage with an id.
        return msg.get("result").or(msg.get("error")).is_none().then(|| err(&id, -32600, "invalid request"));
    };
    let p = &msg["params"];
    Some(match method {
        "initialize" => {
            let asked = p["protocolVersion"].as_str().unwrap_or("");
            let v = PROTOCOLS.iter().find(|v| **v == asked).copied().unwrap_or(PROTOCOLS[0]);
            ok(
                &id,
                json!({
                    "protocolVersion": v,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": srv.name, "title": srv.title, "version": env!("CARGO_PKG_VERSION") },
                    "instructions": srv.instructions,
                }),
            )
        }
        "ping" => ok(&id, json!({})),
        "tools/list" => ok(&id, json!({ "tools": srv.tools })),
        "tools/call" => {
            let Some(name) = p["name"].as_str() else { return Some(err(&id, -32602, "tools/call needs `name`")) };
            if !srv.tools.iter().any(|t| t["name"] == name) {
                return Some(err(&id, -32602, &format!("unknown tool `{name}`")));
            }
            let args = if p["arguments"].is_object() { p["arguments"].clone() } else { json!({}) };
            let (good, text) = call(name, &args);
            ok(&id, json!({ "content": [{ "type": "text", "text": text }], "isError": !good }))
        }
        "resources/list" => ok(&id, json!({ "resources": [] })),
        "prompts/list" => ok(&id, json!({ "prompts": [] })),
        _ => err(&id, -32601, &format!("method not found: {method}")),
    })
}

fn serve(pc: bool) -> Result<()> {
    if pc {
        super::mcp_pc::refuse_terminal()?;
    }
    let srv = if pc { Some(super::mcp_pc::server()) } else { None };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(_)) => Some(err(&Value::Null, -32600, "batches are not supported")),
            Ok(m) => match &srv {
                Some(sv) => handle_with(&m, sv, &super::mcp_pc::call),
                None => handle(&m, &call),
            },
            Err(_) => Some(err(&Value::Null, -32700, "parse error")),
        };
        if let Some(r) = reply {
            writeln!(out, "{r}")?;
            out.flush()?;
        }
    }
    Ok(())
}

// ── install ──────────────────────────────────────────────────────────────────────────────────

fn exe_path() -> Result<String> {
    let exe = std::env::current_exe().context("current_exe")?;
    Ok(exe.to_string_lossy().trim_start_matches(r"\\?\").to_string())
}

pub(crate) fn server_entry(exe: &str) -> Value {
    json!({ "command": exe, "args": ["mcp", "serve"], "env": { "SUSYNC_NO_AUTO_CHECK": "1" } })
}

/// Claude Desktop config files on this machine: the standard one (`%APPDATA%\Claude`,
/// `~/Library/Application Support/Claude`, `~/.config/Claude`) and, on Windows, a Microsoft Store
/// install's redirected copy when that package folder exists (layout not verified on every build).
fn desktop_configs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(d) = dirs::config_dir() {
        v.push(d.join("Claude").join("claude_desktop_config.json"));
    }
    if cfg!(windows) {
        if let Some(local) = dirs::data_local_dir() {
            if let Ok(rd) = std::fs::read_dir(local.join("Packages")) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                    let dir = e.path().join("LocalCache").join("Roaming").join("Claude");
                    if n.starts_with("claude_") && dir.is_dir() {
                        v.push(dir.join("claude_desktop_config.json"));
                    }
                }
            }
        }
    }
    v
}

/// `config` with `mcpServers.8sync` set to `entry` (None removes it); every other key kept.
/// Err when the file is not a JSON object (never overwritten then).
pub(crate) fn merged(config: Option<&str>, entry: Option<&Value>) -> Result<Value> {
    merged_as(config, NAME, entry)
}

pub(crate) fn merged_as(config: Option<&str>, name: &str, entry: Option<&Value>) -> Result<Value> {
    let mut v: Value = match config.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => serde_json::from_str(s).context("claude_desktop_config.json is not valid JSON: fix it first (left untouched)")?,
        None => json!({}),
    };
    let obj = v.as_object_mut().context("claude_desktop_config.json is not a JSON object (left untouched)")?;
    let servers = obj.entry("mcpServers").or_insert_with(|| json!({}));
    let servers = servers.as_object_mut().context("`mcpServers` is not an object (left untouched)")?;
    match entry {
        Some(e) => {
            servers.insert(name.into(), e.clone());
        }
        None => {
            servers.remove(name);
        }
    }
    Ok(v)
}

/// Whether `config` has `mcpServers.8sync` (uninstall leaves other files alone).
pub(crate) fn has_entry(config: &str) -> bool {
    has_entry_as(config, NAME)
}

pub(crate) fn has_entry_as(config: &str, name: &str) -> bool {
    serde_json::from_str::<Value>(config).is_ok_and(|v| v["mcpServers"].get(name).is_some())
}

fn write_config(p: &Path, entry: Option<&Value>) -> Result<bool> {
    write_config_as(p, NAME, entry)
}

fn write_config_as(p: &Path, name: &str, entry: Option<&Value>) -> Result<bool> {
    let old = std::fs::read_to_string(p).ok();
    if entry.is_none() && !old.as_deref().is_some_and(|c| has_entry_as(c, name)) {
        return Ok(false);
    }
    let v = merged_as(old.as_deref(), name, entry)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    // The first backup is the owner's own file: never overwritten by a later install.
    let bak = p.with_extension("json.bak-8sync");
    if let (Some(o), false) = (&old, bak.exists()) {
        std::fs::write(&bak, o)?;
    }
    let tmp = p.with_extension("json.tmp-8sync");
    std::fs::write(&tmp, serde_json::to_string_pretty(&v)? + "\n")?;
    std::fs::rename(&tmp, p)?;
    Ok(true)
}

fn find_claude() -> Option<PathBuf> {
    which::which("claude").ok()
}

fn install(claude_code: bool, print: bool, pc: bool) -> Result<()> {
    let exe = exe_path()?;
    let entry = server_entry(&exe);
    let pc_entry = pc.then(|| super::mcp_pc::entry(&exe));
    if print {
        let mut servers = json!({ NAME: entry });
        if let Some(e) = &pc_entry {
            servers[super::mcp_pc::NAME] = e.clone();
        }
        println!("{}", serde_json::to_string_pretty(&json!({ "mcpServers": servers }))?);
        return Ok(());
    }
    if exe.contains("/target/") || exe.contains("\\target\\") {
        ui::warn(&format!("{exe} trông như bản build tạm: Claude Desktop sẽ chạy đúng file này."));
    }
    let mut wrote = 0;
    for p in desktop_configs() {
        // A config dir that does not exist yet: Claude Desktop is not installed for that path.
        if !p.parent().is_some_and(Path::is_dir) && wrote > 0 {
            continue;
        }
        write_config(&p, Some(&entry))?;
        ui::ok(&format!("Claude Desktop: {} → mcpServers.{NAME}", p.display()));
        if let Some(e) = &pc_entry {
            write_config_as(&p, super::mcp_pc::NAME, Some(e))?;
            ui::ok(&format!("Claude Desktop: mcpServers.{} (điều khiển máy này, có guard + audit)", super::mcp_pc::NAME));
        }
        wrote += 1;
    }
    if wrote == 0 {
        bail!("không tìm thấy thư mục cấu hình của Claude Desktop");
    }
    ui::info("Thoát hẳn Claude Desktop (cả khay hệ thống) rồi mở lại: tool `8sync` hiện trong menu connector.");
    if claude_code {
        let claude = find_claude().context("không thấy `claude` trên PATH")?;
        let o = Command::new(claude).args(["mcp", "add-json", "--scope", "user", NAME, &entry.to_string()]).stdin(Stdio::null()).output()?;
        if o.status.success() {
            ui::ok("Claude Code: MCP 8sync (user scope)");
        } else {
            ui::warn(&format!("claude mcp add-json: {}", String::from_utf8_lossy(&o.stderr).trim()));
        }
    }
    Ok(())
}

fn uninstall() -> Result<()> {
    for p in desktop_configs() {
        if write_config(&p, None)? {
            ui::ok(&format!("Claude Desktop: bỏ mcpServers.{NAME} khỏi {}", p.display()));
        }
        if write_config_as(&p, super::mcp_pc::NAME, None)? {
            ui::ok(&format!("Claude Desktop: bỏ mcpServers.{} khỏi {}", super::mcp_pc::NAME, p.display()));
        }
    }
    if let Some(claude) = find_claude() {
        let _ = Command::new(claude).args(["mcp", "remove", "--scope", "user", NAME]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn none(_: &str, _: &Value) -> (bool, String) {
        (true, "called".into())
    }

    #[test]
    fn initialize_echoes_a_known_protocol_and_falls_back_to_the_newest() {
        let r = handle(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}), &none).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["name"], "8sync");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        let r = handle(&json!({"jsonrpc":"2.0","id":"a","method":"initialize","params":{"protocolVersion":"1999-01-01"}}), &none).unwrap();
        assert_eq!(r["result"]["protocolVersion"], PROTOCOLS[0]);
        assert_eq!(r["id"], "a");
    }

    #[test]
    fn notifications_get_no_reply_and_unknown_methods_an_error() {
        assert!(handle(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}), &none).is_none());
        assert_eq!(handle(&json!({"jsonrpc":"2.0","id":2,"method":"nope"}), &none).unwrap()["error"]["code"], -32601);
        assert_eq!(handle(&json!({"jsonrpc":"2.0","id":3,"method":"ping"}), &none).unwrap()["result"], json!({}));
        // A stray response with an id is not answered.
        assert!(handle(&json!({"jsonrpc":"2.0","id":4,"result":{}}), &none).is_none());
    }

    #[test]
    fn tools_list_and_call() {
        let r = handle(&json!({"jsonrpc":"2.0","id":1,"method":"tools/list"}), &none).unwrap();
        let names: Vec<&str> = r["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["machine", "sessions", "knowledge", "report", "kit", "know_add"]);
        for t in r["result"]["tools"].as_array().unwrap() {
            assert_eq!(t["inputSchema"]["type"], "object");
            let ro = t["annotations"]["readOnlyHint"].as_bool().unwrap();
            assert_eq!(ro, !t["name"].as_str().unwrap().ends_with("_add"));
        }
        let r = handle(&json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sessions","arguments":{}}}), &none).unwrap();
        assert_eq!(r["result"]["content"][0]["text"], "called");
        assert_eq!(r["result"]["isError"], false);
        let r = handle(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rm_rf"}}), &none).unwrap();
        assert_eq!(r["error"]["code"], -32602);
    }

    #[test]
    fn argv_validates_repo_and_text() {
        let dir = std::env::temp_dir().join(format!("8sync-mcp-argv-{}", std::process::id()));
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        let d = dir.to_string_lossy().to_string();
        let plain = std::env::temp_dir();
        assert!(argv("report", &json!({ "repo": plain.to_string_lossy() })).is_err(), "a folder without .git is refused");
        assert!(argv("machine", &json!({})).unwrap().is_none());
        let (a, cwd) = argv("report", &json!({ "repo": d })).unwrap().unwrap();
        assert_eq!(a, ["ccc", "report", "--json"]);
        assert_eq!(cwd.as_deref(), Some(dir.as_path()));
        assert!(argv("report", &json!({})).is_err());
        assert!(argv("report", &json!({ "repo": "relative/path" })).is_err());
        assert!(argv("report", &json!({ "repo": dir.join("no-such-dir-8sync").to_string_lossy() })).is_err());
        assert!(argv("know_add", &json!({ "text": "--force" })).is_err());
        assert!(argv("know_add", &json!({ "text": "x".repeat(TEXT_MAX + 1) })).is_err());
        let (a, cwd) = argv("know_add", &json!({ "text": "Windows paths need \\\\?\\ stripped", "shared": true })).unwrap().unwrap();
        assert_eq!((a.last().unwrap().as_str(), cwd), ("--shared", None));
        let (a, _) = argv("knowledge", &json!({ "all": true })).unwrap().unwrap();
        assert_eq!(a, ["ccc", "know", "ls", "--json", "--all"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_merge_keeps_other_servers_and_refuses_broken_files() {
        let e = server_entry("C:\\Users\\a\\.local\\bin\\8sync.exe");
        let v = merged(Some(r#"{"mcpServers":{"fs":{"command":"npx"}},"globalShortcut":"Ctrl+Space"}"#), Some(&e)).unwrap();
        assert_eq!(v["mcpServers"]["fs"]["command"], "npx");
        assert_eq!(v["mcpServers"]["8sync"]["args"], json!(["mcp", "serve"]));
        assert_eq!(v["globalShortcut"], "Ctrl+Space");
        let v = merged(Some(&v.to_string()), None).unwrap();
        assert!(v["mcpServers"].get("8sync").is_none() && v["mcpServers"]["fs"].is_object());
        assert_eq!(merged(None, Some(&e)).unwrap()["mcpServers"]["8sync"]["command"], "C:\\Users\\a\\.local\\bin\\8sync.exe");
        assert!(merged(Some("{not json"), Some(&e)).is_err());
        assert!(has_entry(r#"{"mcpServers":{"8sync":{}}}"#) && !has_entry(r#"{"mcpServers":{"fs":{}}}"#) && !has_entry("{bad"));
        assert!(merged(Some("[1]"), Some(&e)).is_err());
        assert!(merged(Some(r#"{"mcpServers":[]}"#), Some(&e)).is_err());
    }

    #[test]
    fn output_is_cleaned_and_bounded() {
        assert_eq!(strip_ansi("\u{1b}[32mok\u{1b}[0m done"), "ok done");
        let long = "x".repeat(OUT_MAX + 10);
        assert!(cut(&long).ends_with(&format!("(cut at {OUT_MAX} characters)")));
        assert_eq!(cut("short"), "short");
    }
}
