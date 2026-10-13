//! `8sync harness serena [on|off|status]` — serena (Python, via uvx) is OPT-IN, default off.
//! 8sync prefers native/Rust tooling (codegraph CLI, Claude Code's LSP plugins); Python/JS
//! MCP servers cost a process per agent session, so they are enabled only on request.
//! Setting: `serena = false` in `<config_dir>/features.toml`; `EIGHTSYNC_SERENA=1|0` overrides.
use anyhow::Result;
use serde_json::Value;
use std::path::Path;

use super::cbm::{flag_enabled, read_flag_key, remove_from_claude_named, write_flag_key};
use crate::{env_detect, ui};

pub(crate) const NAME: &str = "serena";
const KEY: &str = "serena";
const ENV: &str = "EIGHTSYNC_SERENA";

pub(crate) fn enabled(home: &Path) -> bool {
    flag_enabled(home, KEY, ENV)
}

/// Pure: drop the `serena` entry only if it is the uvx launcher 8sync registers.
pub(crate) fn strip_omp_entry(root: &mut Value) -> bool {
    let Some(m) = root.get_mut("mcpServers").and_then(Value::as_object_mut) else { return false };
    let managed = m.get(NAME).is_some_and(|e| {
        e["command"] == "uvx" && e["args"].as_array().is_some_and(|a| a.iter().any(|x| x == "start-mcp-server"))
    });
    if managed {
        m.remove(NAME);
    }
    managed
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

pub(crate) fn harness_serena(env: &env_detect::Env, args: &[String]) -> Result<()> {
    match args.first().map(String::as_str) {
        Some("on") => {
            write_flag_key(&env.home, KEY, true)?;
            ui::header("8sync harness serena on");
            crate::verbs::skill::deploy::ensure_serena_mcp(env)?;
            ui::info("Claude Code: run `8sync ccc kit` to mirror it");
        }
        Some("off") => {
            write_flag_key(&env.home, KEY, false)?;
            ui::header("8sync harness serena off");
            if remove_from_omp(&env.home)? {
                ui::ok("removed serena from ~/.omp/agent/mcp.json");
            } else {
                ui::skip("omp mcp.json", "no 8sync-managed serena entry");
            }
            if remove_from_claude_named(NAME) {
                ui::ok("removed serena from Claude Code (user scope)");
            } else {
                ui::skip("Claude Code MCP", "not registered (or `claude` missing)");
            }
            ui::info("nothing was killed; stop running ones: `pkill -f start-mcp-server`");
        }
        _ => {
            ui::header("8sync harness serena — status");
            ui::info(&format!("file flag : {:?}", read_flag_key(&env.home, KEY)));
            ui::info(&format!("effective : {}", if enabled(&env.home) { "ON" } else { "off (default)" }));
            ui::info("toggle: 8sync harness serena on|off  (env EIGHTSYNC_SERENA=1|0)");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_off_and_flag() {
        let d = std::env::temp_dir().join(format!("serena-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(read_flag_key(&d, KEY), None);
        write_flag_key(&d, KEY, true).unwrap();
        assert_eq!(read_flag_key(&d, KEY), Some(true));
        // independent of the cbm key
        assert_eq!(read_flag_key(&d, "codebase_memory_mcp"), None);
        let _ = std::fs::remove_dir_all(&d);
        assert!(super::super::cbm::resolve(Some("1"), Some(false)));
    }

    #[test]
    fn strip_only_uvx_serena() {
        let mut v = serde_json::json!({"mcpServers": {
            "serena": {"type":"stdio","command":"uvx","args":["--from","x","serena","start-mcp-server"]},
            "headroom": {"command":"headroom"}}});
        assert!(strip_omp_entry(&mut v));
        assert!(v["mcpServers"].get("serena").is_none() && v["mcpServers"].get("headroom").is_some());
        let mut w = serde_json::json!({"mcpServers": {"serena": {"command":"/opt/serena"}}});
        assert!(!strip_omp_entry(&mut w));
    }
}
