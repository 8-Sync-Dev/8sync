//! `8sync feynman auth-omp` — bridge Feynman (companion-inc/feynman, a Pi-based
//! research agent) to omp's already-authenticated providers, so Feynman shows and
//! uses the SAME models — reusing omp's Claude Pro/Max OAuth (and API keys) without
//! a second login. omp is a fast-moving Pi fork with a fresh model catalog + a
//! credential vault; Feynman is base pi-ai. Both read `<home>/agent/auth.json` in
//! the SAME schema, so we mirror omp's live credentials into `~/.feynman/agent/auth.json`.
//!
//! Mechanism (verified live against feynman 0.3.5 + omp 16.4.6):
//! - OAuth providers (e.g. anthropic Claude Pro/Max) → `{type:oauth, access:<omp token>}`
//!   WITHOUT the refresh token, so Feynman never rotates omp's OAuth (no dueling
//!   refresher). omp stays the sole refresher; re-run `auth-omp` when the token expires.
//! - API-key providers → `{type:api_key, key:"!omp token <p> --raw"}` so the key is
//!   fetched live from omp at request time — no secret copied into Feynman's file.
//!
//! `status` shows the bridge; `off` removes only the entries we manage (a sidecar
//! records them; Feynman's own `feynman model login` creds are never touched).
use std::path::Path;
use std::process::Command;

use anyhow::{anyhow, Result};
use clap::Args as ClapArgs;
use serde_json::{Map, Value};

use crate::ui;

/// Sidecar recording which auth.json providers WE wrote (so `off` removes only ours).
const MANAGED: &str = ".8sync-omp.json";

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync feynman auth-omp    mirror omp's authed providers -> Feynman (reuse Claude OAuth + keys)
      8sync feynman             same as `auth-omp` (default)
      8sync feynman status      show which providers are bridged from omp
      8sync feynman off         remove the omp-managed entries from Feynman's auth.json

    WHAT IT DOES
      Feynman (Pi research agent) and omp both read `<home>/agent/auth.json` in the same
      schema. This copies omp's LIVE credentials into `~/.feynman/agent/auth.json`:
        - OAuth (Claude Pro/Max) -> access token only (NO refresh) so omp stays the sole
          refresher; re-run when it expires. Uses your Claude subscription's extra usage
          (billed per token), same as any third-party harness.
        - API keys -> `!omp token <p>` (fetched live from omp; no secret duplicated).
      Then `feynman model list` shows the same providers/models omp is authed for -
      handy because omp's catalog updates faster than Feynman's.
"})]
pub struct Args {
    /// auth-omp (default) | status | off
    pub sub: Option<String>,
}

pub fn run(a: Args) -> Result<()> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("cannot resolve home directory"))?;
    let agent_dir = home.join(".feynman/agent");
    match a.sub.as_deref() {
        None | Some("auth-omp") | Some("auth") | Some("sync") => auth_omp(&home, &agent_dir),
        Some("status") => status(&agent_dir),
        Some("off") | Some("remove") | Some("clear") => off(&agent_dir),
        Some(other) => {
            ui::warn(&format!("unknown subcommand: {other}"));
            ui::info("try: 8sync feynman [auth-omp|status|off]");
            Ok(())
        }
    }
}

fn auth_omp(home: &Path, agent_dir: &Path) -> Result<()> {
    ui::header("8sync feynman auth-omp");

    let omp_bin = which::which("omp")
        .map_err(|_| anyhow!("omp not found on PATH - run `8sync setup` first"))?;
    let db = home.join(".omp/agent/agent.db");
    if !db.exists() {
        return Err(anyhow!(
            "omp credential store not found ({}). Authenticate in omp first (`/login` in an omp session).",
            db.display()
        ));
    }
    if which::which("feynman").is_err() {
        ui::warn("feynman not on PATH - writing config anyway (install: curl -fsSL https://feynman.is/install | bash)");
    }

    // Provider + type only — never the secret `data` blob (stable columns, version-safe).
    let creds = omp_active_credentials(&db)?;
    if creds.is_empty() {
        return Err(anyhow!(
            "omp has no active credentials. Authenticate in omp first (`/login`)."
        ));
    }

    std::fs::create_dir_all(agent_dir)?;
    let auth_path = agent_dir.join("auth.json");
    let mut root: Map<String, Value> = match std::fs::read_to_string(&auth_path) {
        Ok(s) if !s.trim().is_empty() => serde_json::from_str(&s).unwrap_or_default(),
        _ => Map::new(),
    };

    let mut managed: Vec<String> = Vec::new();
    for (provider, ctype) in &creds {
        let key = pi_key(provider);
        let entry = if ctype == "oauth" {
            // Live access token from omp (omp refreshes as needed). No refresh token
            // copied -> Feynman uses it read-only and never rotates omp's OAuth.
            let access = omp_token(&omp_bin, provider);
            if access.is_empty() {
                ui::skip(&key, "omp returned no token");
                continue;
            }
            let mut m = Map::new();
            m.insert("type".into(), Value::String("oauth".into()));
            m.insert("access".into(), Value::String(access));
            Value::Object(m)
        } else {
            // API key: resolved live from omp at request time via `!command`.
            let mut m = Map::new();
            m.insert("type".into(), Value::String("api_key".into()));
            m.insert("key".into(), Value::String(format!("!omp token {provider} --raw")));
            Value::Object(m)
        };
        root.insert(key.clone(), entry);
        ui::step(&format!("bridged {key} ({ctype})"));
        managed.push(key);
    }

    if managed.is_empty() {
        return Err(anyhow!("no providers bridged (omp returned no usable tokens)"));
    }

    std::fs::write(&auth_path, serde_json::to_string_pretty(&Value::Object(root))?)?;
    set_600(&auth_path);

    let side = agent_dir.join(MANAGED);
    std::fs::write(&side, serde_json::to_string_pretty(&serde_json::json!({ "providers": managed }))?)?;

    ui::ok(&format!("bridged {} provider(s) -> {}", managed.len(), auth_path.display()));
    ui::info("verify: `feynman model list` (shows the same providers/models omp is authed for)");
    ui::info("Claude Pro/Max OAuth draws from subscription extra-usage (billed per token). Re-run `8sync feynman auth-omp` when the OAuth token expires - omp stays the sole refresher.");
    Ok(())
}

fn status(agent_dir: &Path) -> Result<()> {
    ui::header("8sync feynman - status");
    let auth_path = agent_dir.join("auth.json");
    if !auth_path.exists() {
        ui::info(&format!("no Feynman auth.json yet ({}). Run `8sync feynman auth-omp`.", auth_path.display()));
        return Ok(());
    }
    let managed = read_managed(&agent_dir.join(MANAGED));
    if managed.is_empty() {
        ui::info("no omp-managed providers recorded here. Run `8sync feynman auth-omp`.");
    } else {
        for p in &managed {
            ui::ok(&format!("bridged from omp: {p}"));
        }
    }
    if which::which("feynman").is_ok() {
        ui::info("live check: `feynman model list`");
    }
    Ok(())
}

fn off(agent_dir: &Path) -> Result<()> {
    ui::header("8sync feynman - off");
    let auth_path = agent_dir.join("auth.json");
    let side = agent_dir.join(MANAGED);
    let managed = read_managed(&side);
    if managed.is_empty() {
        ui::info("nothing to remove (no omp-managed providers recorded).");
        return Ok(());
    }
    if let Ok(s) = std::fs::read_to_string(&auth_path) {
        let mut root: Map<String, Value> = serde_json::from_str(&s).unwrap_or_default();
        let mut removed = 0;
        for p in &managed {
            if root.remove(p).is_some() {
                removed += 1;
            }
        }
        std::fs::write(&auth_path, serde_json::to_string_pretty(&Value::Object(root))?)?;
        set_600(&auth_path);
        ui::ok(&format!("removed {removed} omp-managed provider(s) from {}", auth_path.display()));
    }
    let _ = std::fs::remove_file(&side);
    ui::info("Feynman's own `feynman model login` credentials (if any) were left untouched.");
    Ok(())
}

/// Read omp's active credentials as (provider, credential_type). Reads ONLY the
/// stable metadata columns — never the secret `data` blob.
/// Tries multiple sqlite runners for cross-platform resilience:
/// 1. `sqlite3` CLI (standard on Linux/macOS)
/// 2. `python3` / `python` / `py` (standard library `sqlite3` module)
/// 3. `bun` (built-in `bun:sqlite` module)
/// 4. `node` (built-in `node:sqlite` in Node 22+)
fn omp_active_credentials(db: &Path) -> Result<Vec<(String, String)>> {
    let sql = "SELECT DISTINCT provider, credential_type FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY provider;";

    // 1. sqlite3 CLI
    if let Ok(sqlite) = which::which("sqlite3") {
        if let Ok(out) = Command::new(sqlite).arg(db).arg(sql).output() {
            if out.status.success() {
                return parse_credentials_pipe(&String::from_utf8_lossy(&out.stdout));
            }
        }
    }

    // 2. Python (built-in sqlite3 in stdlib)
    for py_name in &["python3", "python", "py"] {
        if let Ok(py) = which::which(py_name) {
            let py_code = "import sqlite3, sys; con = sqlite3.connect(sys.argv[1]); [print(f'{r[0]}|{r[1]}') for r in con.execute('SELECT DISTINCT provider, credential_type FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY provider')]";
            if let Ok(out) = Command::new(py).arg("-c").arg(py_code).arg(db).output() {
                if out.status.success() {
                    return parse_credentials_pipe(&String::from_utf8_lossy(&out.stdout));
                }
            }
        }
    }

    // 3. Bun (built-in bun:sqlite)
    if let Ok(bun) = which::which("bun") {
        let bun_code = "import { Database } from 'bun:sqlite'; const db = new Database(process.argv[1], { readonly: true }); for (const r of db.query('SELECT DISTINCT provider, credential_type FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY provider').all()) console.log(r.provider + '|' + r.credential_type);";
        if let Ok(out) = Command::new(bun).arg("-e").arg(bun_code).arg(db).output() {
            if out.status.success() {
                return parse_credentials_pipe(&String::from_utf8_lossy(&out.stdout));
            }
        }
    }

    // 4. Node (built-in node:sqlite in Node 22+)
    for node_name in &["node", "nodejs"] {
        if let Ok(node) = which::which(node_name) {
            let node_code = "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1], { readOnly: true }); for (const r of db.prepare('SELECT DISTINCT provider, credential_type FROM auth_credentials WHERE disabled_cause IS NULL ORDER BY provider').all()) console.log(r.provider + '|' + r.credential_type);";
            if let Ok(out) = Command::new(node).arg("-e").arg(node_code).arg(db).output() {
                if out.status.success() {
                    return parse_credentials_pipe(&String::from_utf8_lossy(&out.stdout));
                }
            }
        }
    }

    #[cfg(windows)]
    let hint = "install sqlite3 (`scoop install sqlite` or `winget install SQLite.SQLite`) or ensure Python, Bun, or Node is installed";
    #[cfg(not(windows))]
    let hint = "install it (`pacman -S sqlite` / `apt install sqlite3` / `brew install sqlite3`) or ensure Python, Bun, or Node is installed";

    Err(anyhow!("no sqlite runner found to read omp credential store ({hint})"))
}

fn parse_credentials_pipe(raw: &str) -> Result<Vec<(String, String)>> {
    let mut v = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if let Some((p, t)) = line.split_once('|') {
            let (p, t) = (p.trim(), t.trim());
            if !p.is_empty() && !t.is_empty() {
                v.push((p.to_string(), t.to_string()));
            }
        }
    }
    Ok(v)
}

/// A live token for `provider` from omp (`omp token <p> --raw`); empty on failure.
fn omp_token(omp_bin: &Path, provider: &str) -> String {
    match Command::new(omp_bin).arg("token").arg(provider).arg("--raw").output() {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            // If omp returned a JSON envelope (e.g. google-antigravity {"token":"ya29...", ...}),
            // extract the bearer token string.
            if s.starts_with('{') {
                if let Ok(v) = serde_json::from_str::<Value>(&s) {
                    if let Some(t) = v.get("token").and_then(|t| t.as_str()) {
                        return t.to_string();
                    }
                }
            }
            s
        }
        _ => String::new(),
    }
}

/// Map an omp provider id to Feynman/Pi's `auth.json` key. Identity for the common
/// ones (anthropic, zai, xai, openai, google, openrouter, ...); a couple of omp ids
/// differ from Pi's canonical keys. Unknown ids pass through — if wrong, Feynman just
/// marks that provider unavailable (harmless), while the verified ones still work.
fn pi_key(omp_provider: &str) -> String {
    match omp_provider {
        "kimi-code" => "kimi-coding",
        "gemini" | "google-gemini" | "google-antigravity" => "google",
        other => other,
    }
    .to_string()
}

fn read_managed(side: &Path) -> Vec<String> {
    std::fs::read_to_string(side)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| {
            v.get("providers")
                .and_then(|p| p.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        })
        .unwrap_or_default()
}

/// Restrict a credential file to user read/write (0600) on Unix; no-op elsewhere.
fn set_600(p: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        let _ = p;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_credentials_pipe_extracts_pairs() {
        let raw = "anthropic|oauth\ncursor|oauth\n\n  openai-codex | oauth  \nzai|api_key\n";
        let res = parse_credentials_pipe(raw).unwrap();
        assert_eq!(
            res,
            vec![
                ("anthropic".into(), "oauth".into()),
                ("cursor".into(), "oauth".into()),
                ("openai-codex".into(), "oauth".into()),
                ("zai".into(), "api_key".into()),
            ]
        );
    }

    #[test]
    fn parse_credentials_pipe_ignores_malformed() {
        let raw = "no-delimiter\n|\n|only-type\nonly-provider|\n\n";
        let res = parse_credentials_pipe(raw).unwrap();
        assert!(res.is_empty());
    }

    #[test]
    fn pi_key_mappings() {
        assert_eq!(pi_key("kimi-code"), "kimi-coding");
        assert_eq!(pi_key("gemini"), "google");
        assert_eq!(pi_key("google-gemini"), "google");
        assert_eq!(pi_key("google-antigravity"), "google");
        assert_eq!(pi_key("anthropic"), "anthropic");
        assert_eq!(pi_key("custom-llm"), "custom-llm");
    }
}
