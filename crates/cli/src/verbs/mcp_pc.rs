//! `8sync mcp serve --pc`: Claude Desktop controls this PC. A second MCP server, `8sync-pc`
//! (stdio, started only by the client that `8sync mcp install --pc` registered it in), with four
//! tools: `pc_run` (PowerShell), `pc_read`, `pc_write`, `pc_list`.
//!
//! Wide on purpose (the owner trusts Claude Desktop with the whole machine), hard where it
//! counts:
//! - `pc_run` goes through the same destructive-command guard Claude Code uses
//!   (`ccc::guard_command`): a root/home/project wipe, disk format, force-push, printing a `.env`
//!   is refused. Commands the guard only doubts (delete outside the project, run-time paths)
//!   need `confirmed: true`, which Claude passes after the owner agreed in the chat.
//! - credentials are unreachable by any tool: `.env*`, SSH/AWS/GPG/kube dirs, private keys, browser
//!   `Login Data`/`Cookies`, git/npm/omp/Claude credential files, `*.pem|pfx|key|kdbx`.
//! - no network listener (stdio only); refuses to start from a terminal; one switch
//!   (`8sync mcp pc off`) shuts every tool without touching Claude Desktop's config.
//! - every call is appended to `pc-audit.jsonl` (time, tool, first 300 chars, verdict).
//!
//! Logging in, passwords and changing system or security settings stay with the owner: the
//! tools cannot type into another app and cannot read a credential.

use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Result};
use serde_json::{json, Value};

use super::mcp::{run_cmd, tool, Server};
use crate::ui;

pub(crate) const NAME: &str = "8sync-pc";
const RUN_DEFAULT: u64 = 120;
const RUN_MAX: u64 = 900;
const READ_MAX: usize = 200_000;
const WRITE_MAX: usize = 2_000_000;
const LIST_MAX: usize = 500;

pub(crate) fn entry(exe: &str) -> Value {
    json!({ "command": exe, "args": ["mcp", "serve", "--pc"], "env": { "SUSYNC_NO_AUTO_CHECK": "1" } })
}

fn state_dir() -> PathBuf {
    dirs::state_dir().or_else(dirs::data_local_dir).or_else(dirs::home_dir).unwrap_or_default().join("8sync")
}

fn off_flag() -> PathBuf {
    state_dir().join("pc-off")
}

fn audit_log() -> PathBuf {
    state_dir().join("pc-audit.jsonl")
}

/// The serve loop refuses a human at a terminal: the client owns stdin.
pub(crate) fn refuse_terminal() -> Result<()> {
    if std::io::stdin().is_terminal() {
        bail!("`8sync mcp serve --pc` is started by Claude Desktop, not from a terminal (switch: `8sync mcp pc on|off|status`)");
    }
    Ok(())
}

pub(crate) fn switch(action: &str) -> Result<()> {
    let flag = off_flag();
    match action {
        "off" => {
            std::fs::create_dir_all(state_dir())?;
            std::fs::write(&flag, "off\n")?;
            ui::ok("Điều khiển máy của Claude Desktop: TẮT (mọi tool pc_* từ chối). Bật lại: 8sync mcp pc on");
        }
        "on" => {
            let _ = std::fs::remove_file(&flag);
            ui::ok("Điều khiển máy của Claude Desktop: BẬT");
        }
        "status" => {
            ui::info(&format!("{} · nhật ký: {}", if flag.exists() { "TẮT" } else { "BẬT" }, audit_log().display()));
        }
        _ => bail!("dùng: 8sync mcp pc on|off|status"),
    }
    Ok(())
}

fn destructive(mut t: Value) -> Value {
    t["annotations"]["destructiveHint"] = json!(true);
    t["annotations"]["openWorldHint"] = json!(true);
    t
}

pub(crate) fn server() -> Server {
    let path = json!({ "type": "string", "description": "Absolute path." });
    Server {
        name: NAME,
        title: "8 Sync PC control",
        instructions: "Control the owner's Windows PC. pc_run runs PowerShell, pc_read/pc_write/pc_list use files. Credentials, SSH keys, .env files and browser cookies are refused; so are wipes of the home, a drive or a project and force-pushes. If pc_run answers NEED_CONFIRM, tell the owner what it will do and only then repeat with confirmed=true. Logging in, passwords and system/security settings are the owner's to do.",
        tools: vec![
            destructive(tool(
                "pc_run",
                "Run PowerShell",
                "Run a PowerShell command on the owner's PC (no profile, non-interactive) and return its output. `cwd` optional. Destructive-command guard applies.",
                json!({
                    "command": { "type": "string", "description": "PowerShell command line." },
                    "cwd": { "type": "string", "description": "Working directory (absolute)." },
                    "timeout_secs": { "type": "integer", "description": format!("Default {RUN_DEFAULT}, max {RUN_MAX}.") },
                    "confirmed": { "type": "boolean", "description": "Set after the owner agreed to a command that answered NEED_CONFIRM." },
                }),
                &["command"],
                false,
            )),
            tool("pc_read", "Read a file", "Read a text file (first 200 KB). Credentials and key files are refused.", json!({ "path": path }), &["path"], true),
            destructive(tool(
                "pc_write",
                "Write a file",
                "Write (or append to) a text file, creating parent folders. Credentials and key files are refused.",
                json!({ "path": path, "content": { "type": "string" }, "append": { "type": "boolean" } }),
                &["path", "content"],
                false,
            )),
            tool("pc_list", "List a folder", "List a folder's entries (name, size, kind), at most 500.", json!({ "path": path }), &["path"], true),
        ],
    }
}

/// Why a path is off limits for every tool (None = fine).
pub(crate) fn secret_path(p: &str) -> Option<&'static str> {
    let l = p.replace('\\', "/").to_ascii_lowercase();
    const DIRS: [&str; 9] = ["/.ssh/", "/.aws/", "/.gnupg/", "/.kube/", "/.docker/config", "/.config/gh/", "/.omp/agent/", "/.claude/.credentials", "/user data/default/"];
    let probe = format!("{l}/");
    if let Some(d) = DIRS.iter().find(|d| probe.contains(**d)) {
        return Some(d);
    }
    let name = l.rsplit('/').next().unwrap_or("");
    const NAMES: [&str; 12] = ["login data", "cookies", "web data", "local state", "auth.json", ".npmrc", ".git-credentials", ".netrc", "wallet.dat", "credentials", "credentials.json", "id_rsa"];
    if NAMES.contains(&name) || name == ".env" || name.starts_with(".env.") || name.starts_with("id_rsa") || name.starts_with("id_ed25519") || name.starts_with("secrets.") {
        return Some("credential file");
    }
    const EXT: [&str; 7] = [".pem", ".pfx", ".p12", ".key", ".kdbx", ".session", ".ppk"];
    EXT.iter().any(|e| name.ends_with(e)).then_some("key / secret file")
}

/// A command text that names a credential (the guard covers `.env`; this covers the rest).
fn secret_in_command(cmd: &str) -> Option<&'static str> {
    let l = cmd.replace('\\', "/").to_ascii_lowercase();
    const WORDS: [&str; 12] = ["/.ssh", "/.aws", "/.gnupg", ".git-credentials", "login data", "id_rsa", "id_ed25519", ".credentials.json", "/.omp/agent", "/.config/gh/hosts", "wallet.dat", "user data/default"];
    WORDS.iter().find(|w| l.contains(**w)).copied()
}

fn audit(tool: &str, detail: &str, verdict: &str) {
    let _ = std::fs::create_dir_all(state_dir());
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let d: String = detail.chars().take(300).collect();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(audit_log()) {
        let _ = writeln!(f, "{}", json!({ "ts": ts, "tool": tool, "detail": d, "verdict": verdict }));
    }
}

pub(crate) fn call(name: &str, a: &Value) -> (bool, String) {
    if off_flag().exists() {
        audit(name, "", "switched-off");
        return (false, "PC control is switched off (8sync mcp pc on).".into());
    }
    match name {
        "pc_run" => run(a),
        "pc_read" => read(a),
        "pc_write" => write(a),
        "pc_list" => list(a),
        _ => (false, format!("unknown tool `{name}`")),
    }
}

fn path_arg(a: &Value) -> Result<PathBuf, String> {
    let s = a["path"].as_str().filter(|s| !s.trim().is_empty()).ok_or("`path` is required")?;
    let p = PathBuf::from(s);
    if !p.is_absolute() {
        return Err("`path` must be absolute".into());
    }
    if let Some(why) = secret_path(s) {
        return Err(format!("refused: {why}"));
    }
    Ok(p)
}

fn run(a: &Value) -> (bool, String) {
    let Some(cmd) = a["command"].as_str().filter(|s| !s.trim().is_empty()) else { return (false, "`command` is required".into()) };
    let cwd = a["cwd"].as_str().map(PathBuf::from).filter(|p| p.is_dir());
    if let Some(w) = secret_in_command(cmd) {
        audit("pc_run", cmd, "refused-secret");
        return (false, format!("refused: the command touches a credential location ({w})."));
    }
    if let Some((deny, why)) = super::ccc::guard_command(cmd, cwd.as_deref()) {
        if deny {
            audit("pc_run", cmd, "denied");
            return (false, format!("refused by the 8sync guard: {why}"));
        }
        if a["confirmed"].as_bool() != Some(true) {
            audit("pc_run", cmd, "need-confirm");
            return (false, format!("NEED_CONFIRM: {why}. Ask the owner, then repeat with confirmed=true."));
        }
    }
    audit("pc_run", cmd, "run");
    let secs = a["timeout_secs"].as_u64().unwrap_or(RUN_DEFAULT).clamp(1, RUN_MAX);
    let ps = if cfg!(windows) { "powershell.exe" } else { "pwsh" };
    let args = ["-NoProfile".to_string(), "-NonInteractive".into(), "-Command".into(), cmd.to_string()];
    match run_cmd(Path::new(ps), &args, cwd.as_deref(), Duration::from_secs(secs)) {
        Ok(x) => x,
        Err(e) => (false, format!("{e:#}")),
    }
}

fn read(a: &Value) -> (bool, String) {
    let p = match path_arg(a) {
        Ok(p) => p,
        Err(e) => return (false, e),
    };
    audit("pc_read", &p.display().to_string(), "read");
    match std::fs::read(&p) {
        Ok(b) => {
            let cut = b.len() > READ_MAX;
            let mut s = String::from_utf8_lossy(&b[..b.len().min(READ_MAX)]).into_owned();
            if cut {
                s.push_str(&format!("\n(cut at {READ_MAX} of {} bytes)", b.len()));
            }
            (true, s)
        }
        Err(e) => (false, format!("{}: {e}", p.display())),
    }
}

fn write(a: &Value) -> (bool, String) {
    let p = match path_arg(a) {
        Ok(p) => p,
        Err(e) => return (false, e),
    };
    let Some(content) = a["content"].as_str() else { return (false, "`content` is required".into()) };
    if content.len() > WRITE_MAX {
        return (false, format!("content over {WRITE_MAX} bytes"));
    }
    audit("pc_write", &p.display().to_string(), "write");
    let r = (|| -> std::io::Result<()> {
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d)?;
        }
        if a["append"].as_bool() == Some(true) {
            std::fs::OpenOptions::new().create(true).append(true).open(&p)?.write_all(content.as_bytes())
        } else {
            std::fs::write(&p, content)
        }
    })();
    match r {
        Ok(()) => (true, format!("wrote {} bytes to {}", content.len(), p.display())),
        Err(e) => (false, format!("{}: {e}", p.display())),
    }
}

fn list(a: &Value) -> (bool, String) {
    let p = match path_arg(a) {
        Ok(p) => p,
        Err(e) => return (false, e),
    };
    audit("pc_list", &p.display().to_string(), "list");
    let rd = match std::fs::read_dir(&p) {
        Ok(r) => r,
        Err(e) => return (false, format!("{}: {e}", p.display())),
    };
    let mut rows: Vec<String> = rd
        .flatten()
        .map(|e| {
            let m = e.metadata().ok();
            let dir = m.as_ref().is_some_and(|m| m.is_dir());
            format!("{}\t{}\t{}", if dir { "dir" } else { "file" }, m.map_or(0, |m| m.len()), e.file_name().to_string_lossy())
        })
        .collect();
    rows.sort();
    let more = rows.len().saturating_sub(LIST_MAX);
    rows.truncate(LIST_MAX);
    let mut out = rows.join("\n");
    if more > 0 {
        out.push_str(&format!("\n(+{more} more)"));
    }
    (true, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credentials_are_refused_but_ordinary_files_are_not() {
        for p in [r"C:\Users\a\.ssh\id_ed25519", r"C:\Users\a\proj\.env", r"C:\Users\a\proj\.env.local", r"C:\Users\a\.aws\credentials", r"C:\x\cert.pem", r"C:\Users\a\AppData\Local\Microsoft\Edge\User Data\Default\Login Data", r"C:\Users\a\.omp\agent\agent.db"] {
            assert!(secret_path(p).is_some(), "{p}");
        }
        for p in [r"C:\Users\a\proj\src\main.rs", r"C:\Users\a\proj\.envrc.md", r"C:\Users\a\notes\environment.txt"] {
            assert!(secret_path(p).is_none(), "{p}");
        }
    }

    #[test]
    fn credential_commands_are_refused_and_plain_ones_pass() {
        let (ok, text) = run(&json!({ "command": "cat ~/.ssh/id_rsa" }));
        assert!(!ok && text.contains("credential"), "{text}");
        assert!(secret_in_command("Get-Content C:\\Users\\a\\proj\\README.md").is_none());
    }

    #[test]
    fn relative_and_secret_paths_are_rejected_by_every_file_tool() {
        for t in ["pc_read", "pc_write", "pc_list"] {
            assert!(!call(t, &json!({ "path": "rel/x.txt", "content": "x" })).0);
            assert!(!call(t, &json!({ "path": r"C:\Users\a\.ssh\config", "content": "x" })).0);
        }
    }
}
