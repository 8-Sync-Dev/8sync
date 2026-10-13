//! `8sync harness cbm [on|off|status]` — codebase-memory-mcp is strictly OPT-IN.
//!
//! Why: its index worker + one MCP server per agent session + a systemd --user
//! daemon pegged CPU (one worker at ~283% / 850 MB) and grew a ~1.2 GB cache, so
//! 8sync no longer installs/registers it unless the owner turns it on.
//! Setting lives in `<config_dir>/features.toml` (`codebase_memory_mcp = false`
//! by default); `EIGHTSYNC_CBM=1|0` overrides the file.
use anyhow::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::{env_detect, ui};

pub(crate) const NAME: &str = "codebase-memory-mcp";
const KEY: &str = "codebase_memory_mcp";

fn features_path(home: &Path) -> PathBuf {
    crate::brand::config_dir(home).join("features.toml")
}

/// Pure: env override (`1/0/true/false/on/off`) wins over the file value; default off.
pub(crate) fn resolve(env: Option<&str>, file: Option<bool>) -> bool {
    match env.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
        Some("1" | "true" | "on" | "yes") => true,
        Some("0" | "false" | "off" | "no") => false,
        _ => file.unwrap_or(false),
    }
}

fn read_file_flag(home: &Path) -> Option<bool> {
    let s = std::fs::read_to_string(features_path(home)).ok()?;
    s.parse::<toml::Table>().ok()?.get(KEY)?.as_bool()
}

pub(crate) fn enabled(home: &Path) -> bool {
    resolve(std::env::var("EIGHTSYNC_CBM").ok().as_deref(), read_file_flag(home))
}

/// Same opt-in mechanism for any feature key in `features.toml` (used by `harness serena`).
pub(crate) fn flag_enabled(home: &Path, key: &str, env_var: &str) -> bool {
    resolve(std::env::var(env_var).ok().as_deref(), read_flag_key(home, key))
}

pub(crate) fn read_flag_key(home: &Path, key: &str) -> Option<bool> {
    let s = std::fs::read_to_string(features_path(home)).ok()?;
    s.parse::<toml::Table>().ok()?.get(key)?.as_bool()
}

pub(crate) fn write_flag_key(home: &Path, key: &str, on: bool) -> Result<()> {
    let p = features_path(home);
    let mut t = std::fs::read_to_string(&p).ok().and_then(|s| s.parse::<toml::Table>().ok()).unwrap_or_default();
    t.insert(key.into(), toml::Value::Boolean(on));
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(&p, toml::to_string_pretty(&t)?)?;
    Ok(())
}

/// Pure: resolve feature-gated lines in an embedded asset. A line starting with
/// `@cbm ` / `@serena ` is kept (prefix stripped) only when that feature is on,
/// otherwise dropped. Unprefixed lines pass through untouched.
pub(crate) fn gate_with(s: &str, cbm: bool, serena: bool) -> String {
    let mut out = String::with_capacity(s.len());
    for l in s.split_inclusive('\n') {
        if let Some(r) = l.strip_prefix("@cbm ") {
            if cbm {
                out.push_str(r);
            }
        } else if let Some(r) = l.strip_prefix("@serena ") {
            if serena {
                out.push_str(r);
            }
        } else {
            out.push_str(l);
        }
    }
    out
}

/// [`gate_with`] using the live feature flags (`features.toml` / env).
pub(crate) fn gate(home: &Path, s: &str) -> String {
    gate_with(s, enabled(home), super::serena::enabled(home))
}

/// Pure: drop inline ` / mcp__codebase_memory_mcp_*` / ` / mcp__serena_*` suggestions from a
/// one-line message when the matching feature is off (bashInterceptor messages).
pub(crate) fn strip_mcp_mentions(msg: &str, cbm: bool, serena: bool) -> String {
    let mut m = msg.to_string();
    if !cbm {
        m = m.replace(" / mcp__codebase_memory_mcp_search_graph", "");
    }
    if !serena {
        m = m.replace(" / mcp__serena_find_symbol", "");
    }
    m
}

/// `claude mcp remove <name> -s user`; false when absent / no `claude`.
pub(crate) fn remove_from_claude_named(name: &str) -> bool {
    let Ok(claude) = which::which("claude") else { return false };
    Command::new(claude)
        .args(["mcp", "remove", name, "-s", "user"])
        .stdin(Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn write_flag(home: &Path, on: bool) -> Result<()> {
    let p = features_path(home);
    let mut t = std::fs::read_to_string(&p).ok().and_then(|s| s.parse::<toml::Table>().ok()).unwrap_or_default();
    t.insert(KEY.into(), toml::Value::Boolean(on));
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(&p, toml::to_string_pretty(&t)?)?;
    Ok(())
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum Install {
    Missing,
    Stub,
    Real,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Action {
    Skip,
    Install,
    Register,
}

/// Pure: a `--version` output of the placeholder binary ("... disabled (stub)").
pub(crate) fn is_stub_output(v: &str) -> bool {
    let l = v.to_ascii_lowercase();
    l.contains("(stub)") || l.contains("disabled")
}

/// Pure decision: off → never touch anything; on → install if missing/stub, else register.
pub(crate) fn decide(enabled: bool, inst: Install) -> Action {
    match (enabled, inst) {
        (false, _) => Action::Skip,
        (true, Install::Real) => Action::Register,
        (true, _) => Action::Install,
    }
}

pub(crate) fn detect_install() -> Install {
    if which::which(NAME).is_err() {
        return Install::Missing;
    }
    let out = Command::new(NAME).arg("--version").stdin(Stdio::null()).output();
    match out {
        Ok(o) if is_stub_output(&format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))) => {
            Install::Stub
        }
        Ok(_) => Install::Real,
        Err(_) => Install::Missing,
    }
}

/// The exact entry 8sync writes into omp's mcp.json — an entry equal to this is "managed".
fn managed_entry() -> Value {
    serde_json::json!({ "type": "stdio", "command": NAME, "args": [] })
}

/// Pure: drop ONLY the codebase-memory-mcp entry, and only if it is the one 8sync wrote.
/// Returns true when something was removed.
pub(crate) fn strip_omp_entry(root: &mut Value) -> bool {
    let Some(m) = root.get_mut("mcpServers").and_then(Value::as_object_mut) else { return false };
    if m.get(NAME) == Some(&managed_entry()) {
        m.remove(NAME);
        return true;
    }
    false
}

fn remove_from_omp(home: &Path) -> Result<bool> {
    let p = home.join(".omp/agent/mcp.json");
    let Ok(s) = std::fs::read_to_string(&p) else { return Ok(false) };
    let Ok(mut root) = serde_json::from_str::<Value>(&s) else { return Ok(false) };
    if !strip_omp_entry(&mut root) {
        return Ok(false);
    }
    std::fs::write(&p, serde_json::to_string_pretty(&root)?)?;
    Ok(true)
}

fn remove_from_claude() -> bool {
    remove_from_claude_named(NAME)
}

pub(crate) fn harness_cbm(env: &env_detect::Env, args: &[String]) -> Result<()> {
    match args.first().map(String::as_str) {
        Some("on") => {
            write_flag(&env.home, true)?;
            ui::header("8sync harness cbm on");
            ui::ok(&format!("enabled → {}", features_path(&env.home).display()));
            crate::verbs::skill::deploy::ensure_codebase_memory_mcp(env)?;
            ui::info("Claude Code: run `8sync ccc kit` to mirror it · indexing is on demand only (CPU)");
            Ok(())
        }
        Some("off") => {
            write_flag(&env.home, false)?;
            ui::header("8sync harness cbm off");
            ui::ok(&format!("disabled → {}", features_path(&env.home).display()));
            if remove_from_omp(&env.home)? {
                ui::ok("removed codebase-memory-mcp from ~/.omp/agent/mcp.json");
            } else {
                ui::skip("omp mcp.json", "no 8sync-managed entry");
            }
            if remove_from_claude() {
                ui::ok("removed codebase-memory-mcp from Claude Code (user scope)");
            } else {
                ui::skip("Claude Code MCP", "not registered (or `claude` missing)");
            }
            ui::info("nothing was killed; to stop a running one: `systemctl --user disable --now codebase-memory-mcp` / `pkill -f codebase-memory-mcp`; cache: ~/.cache/codebase-memory-mcp");
            if std::env::var_os("EIGHTSYNC_CBM").is_some() {
                ui::warn("EIGHTSYNC_CBM is set in this shell and overrides the file");
            }
            Ok(())
        }
        _ => {
            ui::header("8sync harness cbm — status");
            ui::info(&format!("file flag : {:?}", read_file_flag(&env.home)));
            ui::info(&format!("env       : {:?}", std::env::var("EIGHTSYNC_CBM").ok()));
            ui::info(&format!("effective : {}", if enabled(&env.home) { "ON" } else { "off (default)" }));
            ui::info(&format!("binary    : {:?}", detect_install()));
            ui::info("toggle: 8sync harness cbm on|off");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_off_and_env_override() {
        assert!(!resolve(None, None));
        assert!(!resolve(None, Some(false)));
        assert!(resolve(None, Some(true)));
        assert!(resolve(Some("1"), Some(false)));
        assert!(!resolve(Some("0"), Some(true)));
        assert!(!resolve(Some("garbage"), None));
    }

    #[test]
    fn decide_is_noop_when_off() {
        for i in [Install::Missing, Install::Stub, Install::Real] {
            assert_eq!(decide(false, i), Action::Skip);
        }
        assert_eq!(decide(true, Install::Real), Action::Register);
        assert_eq!(decide(true, Install::Stub), Action::Install);
        assert_eq!(decide(true, Install::Missing), Action::Install);
    }

    #[test]
    fn stub_detection() {
        assert!(is_stub_output("codebase-memory-mcp disabled (stub)"));
        assert!(!is_stub_output("codebase-memory-mcp 0.8.1"));
    }

    #[test]
    fn flag_roundtrip_default_off() {
        let d = std::env::temp_dir().join(format!("cbm-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(read_file_flag(&d), None);
        write_flag(&d, true).unwrap();
        assert_eq!(read_file_flag(&d), Some(true));
        write_flag(&d, false).unwrap();
        assert_eq!(read_file_flag(&d), Some(false));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn strip_removes_only_managed_cbm_key() {
        let mut v = serde_json::json!({"mcpServers": {
            "codebase-memory-mcp": {"type":"stdio","command":"codebase-memory-mcp","args":[]},
            "serena": {"type":"stdio","command":"serena","args":[]}}});
        assert!(strip_omp_entry(&mut v));
        assert!(v["mcpServers"].get("codebase-memory-mcp").is_none());
        assert!(v["mcpServers"].get("serena").is_some());
        let mut w = serde_json::json!({"mcpServers": {"codebase-memory-mcp": {"command":"/opt/x"}}});
        assert!(!strip_omp_entry(&mut w));
        assert!(w["mcpServers"].get("codebase-memory-mcp").is_some());
    }

    #[test]
    fn gated_assets_omit_cbm_serena_when_off() {
        let raw = "a\n@cbm cbm-line\n@serena serena-line\nz\n";
        assert_eq!(gate_with(raw, false, false), "a\nz\n");
        assert_eq!(gate_with(raw, true, false), "a\ncbm-line\nz\n");
        assert_eq!(gate_with(raw, false, true), "a\nserena-line\nz\n");
        // every shipped rule/prompt asset renders without cbm/serena mentions when both off
        for a in ["rules/code-intel-first.md", "configs/omp/APPEND_SYSTEM.md", "skills/00-force-load.md", "claude/CLAUDE.md"] {
            let out = gate_with(&crate::assets::read(a).unwrap(), false, false);
            for w in ["codebase_memory", "mcp__serena", "serena enabled"] {
                assert!(!out.contains(w), "{a} leaks `{w}` while off");
            }
        }
        let on = gate_with(&crate::assets::read("rules/code-intel-first.md").unwrap(), true, true);
        assert!(on.contains("mcp__serena_find_symbol") && on.contains("mcp__codebase_memory_mcp_search_graph"));
    }

    #[test]
    fn interceptor_messages_drop_mcp_when_off() {
        let m = "use `codegraph query` / mcp__codebase_memory_mcp_search_graph / mcp__serena_find_symbol — not rg";
        let off = strip_mcp_mentions(m, false, false);
        assert!(!off.contains("mcp__") && off.contains("codegraph query"));
        assert!(strip_mcp_mentions(m, true, true).contains("mcp__serena_find_symbol"));
    }
}
