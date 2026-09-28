//! `8sync codex-web` — bridge ChatGPT Web (miuuyy/codex-chatgpt-web) into omp CLI.
//!
//! Opens the launcher so YOU log into ChatGPT (the tool never logs in for you),
//! auto-detects the local loopback Responses server, and wires an **isolated**
//! `chatgpt-web` provider into `~/.omp/agent/models.yml` — never touching the native
//! `anthropic`/`openai` providers and never setting a global env var.
//!
//! Safe by construction: loopback-only (127.0.0.1), isolated provider slug, no secret
//! copied (the bridge is a same-user loopback listener). Browser automation of ChatGPT
//! still carries the account-risk the upstream project documents; that is inherent.
//!
//! Actions (smart first positional):
//! - `up` / `login` / `open` : launch the launcher, then poll until you finish login, then wire.
//! - (none) / `status`       : probe the server + report; auto-wire if it is ready and unwired.
//! - `wire`                  : force-detect models from `/v1/models` and (re)write the provider.
//! - `off`                   : remove the `chatgpt-web` provider from models.yml.

use anyhow::{bail, Context, Result};
use clap::Args as ClapArgs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use crate::ui;
use crate::verbs::harness::claude_code::merge_provider_blocks;

/// omp provider slug used for the isolated bridge registration.
const PROVIDER: &str = "chatgpt-web";
/// Default loopback port the upstream Responses bridge listens on.
const DEFAULT_PORT: u16 = 17841;

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
EXAMPLES
  8sync codex-web up                open launcher, log into ChatGPT, then auto-wire omp
  8sync codex-web                   probe the bridge; auto-wire omp if it is ready
  8sync codex-web status            same as bare, without auto-wiring surprises
  8sync codex-web wire              (re)detect models and write the omp provider
  8sync codex-web off               remove the chatgpt-web provider from omp

USE CASE
  Use your ChatGPT Web subscription (incl. Pro) as a model inside omp — no API key,
  no Codex. The launcher opens a private browser profile for YOUR login; the local
  loopback Responses server is then registered into omp as an isolated `chatgpt-web`
  provider (native anthropic/openai untouched).

SAFETY
  Loopback-only (127.0.0.1), isolated provider, no global env var, no secret copied.
  Browser automation of ChatGPT can risk your account per the upstream project — that
  risk is inherent, not added by this command.

LAUNCHER
  `up` launches the installed production Codex Web GPT app (the only build that serves
  omp). Not installed? It prints the one-line installer. `--dir` / CODEX_WEB_DIR opt into
  the source `bun run app` launcher — a DEV harness that CANNOT serve omp; tool-dev only.
"})]
pub struct Args {
    /// up | login | open | status | wire | off  (default: status)
    pub action: Option<String>,

    /// Loopback Responses port the bridge listens on.
    #[arg(long, default_value_t = DEFAULT_PORT)]
    pub port: u16,

    /// Source dir for the `bun run app` DEV launcher (tool-dev only; cannot serve omp).
    #[arg(long)]
    pub dir: Option<String>,

    /// Seconds to wait for login + server after launching (up only).
    #[arg(long, default_value_t = 240)]
    pub wait: u64,
}

/// Result of probing the local Responses server.
#[derive(Debug, PartialEq)]
enum Probe {
    /// Connection refused / not running.
    Down,
    /// Server answered but exposes no models (usually: not signed in / setup incomplete).
    UpNoModels,
    /// Server answered with a model catalog — logged in and ready.
    Ready(Vec<String>),
}

/// Probe `http://127.0.0.1:<port>/v1/models` via curl (no reqwest in this binary).
fn probe(port: u16) -> Probe {
    let url = format!("http://127.0.0.1:{port}/v1/models");
    let out = match Command::new("curl")
        .args(["-s", "-m", "4", &url])
        .output()
    {
        Ok(o) => o,
        Err(_) => return Probe::Down,
    };
    // curl exits non-zero (7) on connection refused → server down.
    if !out.status.success() {
        return Probe::Down;
    }
    let body = String::from_utf8_lossy(&out.stdout);
    if body.trim().is_empty() {
        return Probe::Down;
    }
    let json: serde_json::Value = match serde_json::from_str(&body) {
        Ok(j) => j,
        Err(_) => return Probe::UpNoModels,
    };
    let ids = extract_model_ids(&json);
    if ids.is_empty() {
        Probe::UpNoModels
    } else {
        Probe::Ready(ids)
    }
}

/// Pull `.data[].id` out of an OpenAI-style `/v1/models` response.
fn extract_model_ids(json: &serde_json::Value) -> Vec<String> {
    json.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Resolve an EXPLICIT codex-chatgpt-web source dir (`--dir` or `CODEX_WEB_DIR`).
/// Returns `None` unless the user opted in — the default `up` path launches the
/// installed production app, never the source tree (which builds a DEV harness).
fn resolve_explicit_source(explicit: Option<&str>) -> Option<PathBuf> {
    let has_pkg = |p: &PathBuf| p.join("package.json").is_file();
    if let Some(d) = explicit {
        let p = PathBuf::from(d);
        if has_pkg(&p) {
            return Some(p);
        }
    }
    if let Ok(d) = std::env::var("CODEX_WEB_DIR") {
        let p = PathBuf::from(d.trim());
        if has_pkg(&p) {
            return Some(p);
        }
    }
    None
}

/// Locate the installed **production** launcher (packaged app) per-OS and return a
/// spawnable command. Only this build serves a Responses listener for omp; the source
/// `bun run app` launcher is a DEV harness that is hard-blocked from serving.
fn resolve_prod_app() -> Option<Command> {
    #[cfg(target_os = "windows")]
    if let Some(local) = dirs::data_local_dir() {
        let exe = local
            .join("Programs")
            .join("Codex Web GPT")
            .join("Codex Web GPT.exe");
        if exe.is_file() {
            return Some(Command::new(exe));
        }
    }
    #[cfg(target_os = "macos")]
    if PathBuf::from("/Applications/Codex Web GPT.app").exists() {
        let mut c = Command::new("open");
        c.args(["-a", "Codex Web GPT"]);
        return Some(c);
    }
    None
}

/// Build the isolated omp provider block for the detected model ids.
fn build_provider_block(port: u16, ids: &[String]) -> String {
    let mut b = String::new();
    b.push_str(&format!("  {PROVIDER}:\n"));
    b.push_str(&format!("    baseUrl: http://127.0.0.1:{port}/v1\n"));
    b.push_str("    api: openai-responses\n");
    b.push_str("    apiKey: local-loopback\n");
    b.push_str("    models:\n");
    for id in ids {
        let label = id.rsplit('/').next().unwrap_or(id);
        b.push_str(&format!("      - id: {id}\n"));
        b.push_str(&format!("        name: ChatGPT Web ({label})\n"));
        b.push_str("        reasoning: true\n");
        b.push_str("        input: [text, image]\n");
        b.push_str("        contextWindow: 128000\n");
        b.push_str("        maxTokens: 128000\n");
    }
    b
}

/// Remove a provider block by name from a models.yml document. Returns (new_doc, removed).
fn remove_provider(existing: &str, name: &str) -> (String, bool) {
    let prefix = format!("  {name}:");
    let lines: Vec<&str> = existing.lines().collect();
    let mut start = None;
    let mut end = None;
    for (idx, line) in lines.iter().enumerate() {
        if start.is_none() {
            if line.starts_with(&prefix) {
                start = Some(idx);
            }
        } else {
            let trimmed = line.trim_start();
            let indent = line.len() - trimmed.len();
            if (indent == 2 && trimmed.contains(':') && !trimmed.starts_with('#'))
                || (indent < 2 && !trimmed.is_empty())
            {
                end = Some(idx);
                break;
            }
        }
    }
    let Some(s) = start else {
        return (existing.to_string(), false);
    };
    let e = end.unwrap_or(lines.len());
    let kept: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(i, _)| *i < s || *i >= e)
        .map(|(_, l)| *l)
        .collect();
    let mut doc = kept.join("\n");
    if existing.ends_with('\n') && !doc.ends_with('\n') {
        doc.push('\n');
    }
    (doc, true)
}

fn models_yml_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("cannot resolve home directory")?;
    Ok(home.join(".omp").join("agent").join("models.yml"))
}

/// Write the isolated provider into models.yml (create if missing), never touching others.
fn wire_omp(port: u16, ids: &[String]) -> Result<()> {
    let path = models_yml_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_else(|_| "providers:\n".to_string());
    let block = build_provider_block(port, ids);
    let updated = merge_provider_blocks(&existing, &[(PROVIDER, &block)]);
    std::fs::write(&path, &updated)
        .with_context(|| format!("failed to write {}", path.display()))?;
    ui::ok(&format!(
        "wired omp provider '{PROVIDER}' → {} model(s) in {}",
        ids.len(),
        path.display()
    ));
    for id in ids {
        ui::info(&format!("  omp model: {PROVIDER}/{id}"));
    }
    Ok(())
}

fn unwire_omp() -> Result<()> {
    let path = models_yml_path()?;
    let existing = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => {
            ui::skip(PROVIDER, "models.yml not found — nothing to remove");
            return Ok(());
        }
    };
    let (updated, removed) = remove_provider(&existing, PROVIDER);
    if !removed {
        ui::skip(PROVIDER, "provider not present in models.yml");
        return Ok(());
    }
    std::fs::write(&path, &updated)
        .with_context(|| format!("failed to write {}", path.display()))?;
    ui::ok(&format!("removed omp provider '{PROVIDER}' from {}", path.display()));
    Ok(())
}

/// Launch the ChatGPT launcher so the user can sign in.
/// Default: the installed **production** app (the only build that serves omp). An explicit
/// source dir opts into `bun run app`, a DEV harness that cannot serve a Responses listener.
fn launch(explicit_source: Option<&PathBuf>) -> Result<()> {
    if let Some(dir) = explicit_source {
        ui::step(&format!("launching source dev launcher from {}", dir.display()));
        ui::warn("source `bun run app` is a DEV harness — it cannot serve a Responses listener for omp");
        Command::new("bun")
            .args(["run", "app"])
            .current_dir(dir)
            .spawn()
            .context("failed to spawn `bun run app` — is bun on PATH? (need >= 1.4.0)")?;
        ui::info("sign into ChatGPT in the launcher window");
        return Ok(());
    }
    if let Some(mut cmd) = resolve_prod_app() {
        ui::step("launching installed Codex Web GPT (production launcher)");
        cmd.spawn().context("failed to launch the installed Codex Web GPT app")?;
        ui::info("sign into ChatGPT, run the Browser smoke test, then press Install models (browser-only is safest)");
        return Ok(());
    }
    bail!(
        "Codex Web GPT production launcher is not installed.\n\
         Install it, then rerun `8sync codex-web up`:\n\
         \u{20}\u{20}Windows:     irm https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.ps1 | iex\n\
         \u{20}\u{20}macOS/Linux: curl -fsSL https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.sh | sh\n\
         (the `bun run app` source launcher is a DEV harness that cannot serve omp — pass --dir only for tool development)"
    )
}

/// Poll until the server reports a ready model catalog, or the deadline passes.
fn wait_ready(port: u16, secs: u64) -> Option<Vec<String>> {
    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut announced_up = false;
    while Instant::now() < deadline {
        match probe(port) {
            Probe::Ready(ids) => return Some(ids),
            Probe::UpNoModels => {
                if !announced_up {
                    ui::info("server is up — waiting for you to finish ChatGPT login…");
                    announced_up = true;
                }
            }
            Probe::Down => {}
        }
        std::thread::sleep(Duration::from_secs(3));
    }
    None
}

fn print_usage_hint(ids: &[String]) {
    if let Some(first) = ids.first() {
        ui::info(&format!(
            "try it: omp --model {PROVIDER}/{first} \"ping\"   (or `8sync ai --model {PROVIDER}/{first}`)"
        ));
    }
}

pub fn run(a: Args) -> Result<()> {
    let action = a.action.as_deref().unwrap_or("status").to_lowercase();
    let port = a.port;

    match action.as_str() {
        "off" | "unwire" | "remove" => unwire_omp(),

        "wire" => match probe(port) {
            Probe::Ready(ids) => {
                wire_omp(port, &ids)?;
                print_usage_hint(&ids);
                Ok(())
            }
            Probe::UpNoModels => {
                bail!("bridge is up on :{port} but exposes no models — finish ChatGPT login + `Install models` in the launcher, then retry")
            }
            Probe::Down => {
                bail!("no bridge on :{port} — run `8sync codex-web up` first")
            }
        },

        "up" | "login" | "open" | "start" => {
            // Already ready? Skip the launch and just wire.
            if let Probe::Ready(ids) = probe(port) {
                ui::ok(&format!("bridge already ready on :{port} ({} models)", ids.len()));
                wire_omp(port, &ids)?;
                print_usage_hint(&ids);
                return Ok(());
            }
            let explicit_source = resolve_explicit_source(a.dir.as_deref());
            launch(explicit_source.as_ref())?;
            ui::step(&format!("waiting up to {}s for login + server on :{port}…", a.wait));
            match wait_ready(port, a.wait) {
                Some(ids) => {
                    ui::ok(&format!("ChatGPT session ready — {} model(s) detected", ids.len()));
                    wire_omp(port, &ids)?;
                    print_usage_hint(&ids);
                    Ok(())
                }
                None => {
                    ui::warn("timed out waiting for a ready session");
                    ui::info("finish login in the launcher, then run: 8sync codex-web wire");
                    Ok(())
                }
            }
        }

        // status (default)
        "status" | "" => {
            match probe(port) {
                Probe::Ready(ids) => {
                    ui::ok(&format!("bridge ready on :{port} — {} model(s):", ids.len()));
                    for id in &ids {
                        ui::info(&format!("  {id}"));
                    }
                    // Auto-wire for convenience (the whole point: cho lẹ).
                    wire_omp(port, &ids)?;
                    print_usage_hint(&ids);
                }
                Probe::UpNoModels => {
                    ui::warn(&format!("bridge up on :{port} but NOT signed in / no models"));
                    ui::info("open the launcher and finish ChatGPT login: 8sync codex-web up");
                }
                Probe::Down => {
                    ui::warn(&format!("no bridge on :{port}"));
                    ui::info("start it + log in: 8sync codex-web up");
                }
            }
            Ok(())
        }

        other => bail!("unknown action '{other}' — use: up | status | wire | off"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_ids_reads_openai_models_shape() {
        let j = serde_json::json!({
            "object": "list",
            "data": [
                {"id": "chatgpt-web/luna", "object": "model"},
                {"id": "chatgpt-web/high", "object": "model"}
            ]
        });
        assert_eq!(
            extract_model_ids(&j),
            vec!["chatgpt-web/luna".to_string(), "chatgpt-web/high".to_string()]
        );
    }

    #[test]
    fn extract_ids_empty_when_no_data() {
        let j = serde_json::json!({"object": "list"});
        assert!(extract_model_ids(&j).is_empty());
    }

    #[test]
    fn provider_block_is_isolated_and_openai_responses() {
        let b = build_provider_block(17841, &["chatgpt-web/luna".to_string()]);
        assert!(b.contains("  chatgpt-web:"));
        assert!(b.contains("api: openai-responses"));
        assert!(b.contains("baseUrl: http://127.0.0.1:17841/v1"));
        assert!(b.contains("- id: chatgpt-web/luna"));
        assert!(b.contains("name: ChatGPT Web (luna)"));
    }

    #[test]
    fn wire_then_off_roundtrip_leaves_other_providers_intact() {
        let base = "providers:\n  anthropic:\n    baseUrl: https://api.anthropic.com/v1\n    models:\n      - id: claude-opus-5\n";
        let block = build_provider_block(17841, &["chatgpt-web/luna".to_string()]);
        let wired = merge_provider_blocks(base, &[(PROVIDER, &block)]);
        assert!(wired.contains("  chatgpt-web:"));
        assert!(wired.contains("  anthropic:"), "native anthropic must survive wiring");

        let (unwired, removed) = remove_provider(&wired, PROVIDER);
        assert!(removed);
        assert!(!unwired.contains("  chatgpt-web:"), "provider removed");
        assert!(unwired.contains("  anthropic:"), "native anthropic must survive removal");
        assert!(unwired.contains("id: claude-opus-5"));
    }

    #[test]
    fn remove_absent_provider_is_noop() {
        let base = "providers:\n  anthropic:\n    baseUrl: https://api.anthropic.com/v1\n";
        let (doc, removed) = remove_provider(base, PROVIDER);
        assert!(!removed);
        assert_eq!(doc, base);
    }
}
