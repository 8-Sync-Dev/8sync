//! `8sync harness claude-code` — auto-setup Claude Code settings & omp Anthropic models.
//!
//! Accepts a JSON string, a path to settings.json, or stdin:
//! ```json
//! {
//!   "$schema": "https://json.schemastore.org/claude-code-settings.json",
//!   "env": {
//!     "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
//!     "ANTHROPIC_AUTH_TOKEN": "your-console-api-key",
//!     "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
//!     "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
//!   }
//! }
//! ```
//!
//! Actions performed:
//! 1. Parses settings JSON (supports full schema, flat env map, or CLI flags).
//! 2. Merges the env keys into `~/.claude/settings.json` (any endpoint: Claude Code's own LLM-gateway support).
//! 3. On Windows: sets User persistent environment variables (official endpoint only).
//! 4. Official endpoint only: injects the Claude 5.5 family (opus/sonnet/haiku 5.5, fable 5.1) plus older models into `~/.omp/agent/models.yml`
//!    under `anthropic`, with `anthropic-budget-effort` thinking and 1M context, and
//! 5. sets omp's default role to `anthropic/claude-fable-5-1:high`, advisor `anthropic/claude-opus-5-5:high`.
//!    The omp write needs a Console API key (`sk-ant-api…`); OAuth/subscription tokens stay in Claude Code.
//!    Base URLs outside an allowlist (Anthropic, Bedrock, Vertex, Foundry, localhost) are refused;
//!    https is required except for localhost.
//!    A third-party gateway never reaches omp: Anthropic's Usage Policy (8sync rules) lets tools
//!    other than Claude Code use Claude only through a Console API key.
//! 6. Verifies connection with a live probe.

use std::path::Path;
use std::process::Command;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{env_detect, ui};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaudeSettings {
    #[serde(rename = "$schema", skip_serializing_if = "Option::is_none")]
    pub schema: Option<String>,
    pub env: ClaudeEnv,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClaudeEnv {
    pub anthropic_base_url: String,
    pub anthropic_auth_token: String,
    #[serde(default = "default_one")]
    pub claude_code_disable_nonessential_traffic: String,
    #[serde(default = "default_zero")]
    pub claude_code_attribution_header: String,
}

fn default_one() -> String {
    "1".to_string()
}

fn default_zero() -> String {
    "0".to_string()
}

/// Parse Claude Code settings from raw JSON or flat key-value pairs.
pub fn parse_claude_settings(raw: &str) -> Result<ClaudeSettings> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        bail!("empty input: provide JSON or a file path to Claude Code settings");
    }

    let val: Value = serde_json::from_str(trimmed)
        .context("invalid JSON payload for Claude Code settings")?;

    let mut base_url = String::new();
    let mut token = String::new();
    let mut disable_traffic = "1".to_string();
    let mut attribution_header = "0".to_string();
    let mut schema = Some("https://json.schemastore.org/claude-code-settings.json".to_string());

    if let Some(s) = val.get("$schema").and_then(|v| v.as_str()) {
        schema = Some(s.to_string());
    }

    if let Some(env_obj) = val.get("env").and_then(|v| v.as_object()) {
        for (k, v) in env_obj {
            let k_upper = k.to_ascii_uppercase();
            if let Some(str_val) = v.as_str() {
                match k_upper.as_str() {
                    "ANTHROPIC_BASE_URL" | "BASE_URL" | "BASEURL" => base_url = str_val.to_string(),
                    "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY" | "API_KEY" | "TOKEN" => token = str_val.to_string(),
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" => disable_traffic = str_val.to_string(),
                    "CLAUDE_CODE_ATTRIBUTION_HEADER" => attribution_header = str_val.to_string(),
                    _ => {}
                }
            }
        }
    } else if let Some(obj) = val.as_object() {
        for (k, v) in obj {
            let k_upper = k.to_ascii_uppercase();
            if let Some(str_val) = v.as_str() {
                match k_upper.as_str() {
                    "ANTHROPIC_BASE_URL" | "BASE_URL" | "BASEURL" => base_url = str_val.to_string(),
                    "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY" | "API_KEY" | "TOKEN" => token = str_val.to_string(),
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" => disable_traffic = str_val.to_string(),
                    "CLAUDE_CODE_ATTRIBUTION_HEADER" => attribution_header = str_val.to_string(),
                    _ => {}
                }
            }
        }
    }

    if base_url.is_empty() {
        bail!("missing ANTHROPIC_BASE_URL in settings payload");
    }
    if token.is_empty() {
        bail!("missing ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY in settings payload");
    }

    base_url = base_url.trim_end_matches('/').to_string();

    Ok(ClaudeSettings {
        schema,
        env: ClaudeEnv {
            anthropic_base_url: base_url,
            anthropic_auth_token: token,
            claude_code_disable_nonessential_traffic: disable_traffic,
            claude_code_attribution_header: attribution_header,
        },
    })
}

/// Last 4 chars only (`…abcd`); never the prefix.
pub fn mask_token(token: &str) -> String {
    let n = token.chars().count();
    if n <= 4 {
        return "…".to_string();
    }
    format!("…{}", token.chars().skip(n - 4).collect::<String>())
}

/// Anthropic Console API keys start with `sk-ant-api`; OAuth/subscription tokens do not.
pub fn is_console_key(token: &str) -> bool {
    token.starts_with("sk-ant-api")
}

/// Lowercased host of a base URL: scheme, userinfo, port and path stripped.
pub fn base_url_host(base_url: &str) -> Option<String> {
    let rest = base_url.trim();
    let rest = rest.split_once("://").map_or(rest, |(_, r)| r);
    let auth = rest.split(['/', '?', '#']).next().unwrap_or("");
    let auth = auth.rsplit('@').next().unwrap_or("");
    let host = if let Some(r) = auth.strip_prefix('[') {
        r.split(']').next().unwrap_or("")
    } else {
        auth.split(':').next().unwrap_or("")
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() { None } else { Some(host) }
}

fn host_allowed_builtin(host: &str) -> bool {
    let label_ok = |l: &str| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    // exactly one region label between prefix and suffix
    let one_label = |h: &str, pre: &str, suf: &str| {
        h.strip_prefix(pre).and_then(|r| r.strip_suffix(suf)).is_some_and(label_ok)
    };
    host == "api.anthropic.com"
        || matches!(host, "localhost" | "127.0.0.1" | "::1")
        || one_label(host, "bedrock-runtime.", ".amazonaws.com")
        || host == "aiplatform.googleapis.com"
        || host.strip_suffix("-aiplatform.googleapis.com").is_some_and(label_ok)
        || host.strip_suffix(".services.ai.azure.com").is_some_and(label_ok)
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

/// `https://` is required for every host; plain `http://` only for loopback.
pub fn scheme_ok(base_url: &str, host: &str) -> bool {
    let u = base_url.trim().to_ascii_lowercase();
    u.starts_with("https://") || (is_loopback(host) && u.starts_with("http://"))
}

/// Whether the flow may write Claude credentials into omp's models.yml:
/// official host (exact) AND Console API key AND https.
pub fn omp_write_allowed(base_url: &str, token: &str) -> bool {
    base_url_host(base_url).as_deref() == Some("api.anthropic.com")
        && is_console_key(token)
        && base_url.trim().to_ascii_lowercase().starts_with("https://")
}

/// A non-Console `sk-ant-` token (subscription/OAuth) is only valid for Claude
/// Code talking to api.anthropic.com itself; never to localhost or a self-hosted proxy.
pub fn token_allowed_for_host(base_url: &str, token: &str) -> bool {
    let t = token.trim();
    !t.starts_with("sk-ant-") || is_console_key(t) || base_url_host(base_url).as_deref() == Some("api.anthropic.com")
}

/// Token safe to embed in a PowerShell command: `^[A-Za-z0-9_-]+$`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn persist_value_safe(v: &str) -> bool {
    !v.is_empty() && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Allowlist for `ANTHROPIC_BASE_URL`. Escape hatch for a self-operated gateway:
/// env `EIGHTSYNC_SELF_HOSTED_GATEWAY=<host>` must equal the URL host exactly.
pub fn gateway_allowed(base_url: &str) -> bool {
    let Some(host) = base_url_host(base_url) else { return false };
    if !scheme_ok(base_url, &host) {
        return false;
    }
    if host_allowed_builtin(&host) {
        return true;
    }
    std::env::var("EIGHTSYNC_SELF_HOSTED_GATEWAY")
        .map(|v| !v.trim().is_empty() && v.trim().to_ascii_lowercase() == host)
        .unwrap_or(false)
}

/// Derive a friendly provider name from base URL (e.g. "https://api.apikey.fun" → "apikey-fun")
pub fn provider_slug(base_url: &str) -> String {
    let clean = base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .trim_end_matches("/v1");

    let host = clean.split('/').next().unwrap_or(clean);
    let mut parts: Vec<&str> = host.split('.').collect();
    if parts.len() > 2 && parts[0] == "api" {
        parts.remove(0);
    }
    let slug = parts.join("-").to_ascii_lowercase();
    if slug.is_empty() {
        "anthropic-custom".to_string()
    } else {
        slug
    }
}

/// Canonical modern Claude model catalog (Claude 5.5 family first, then older models).
pub const CLAUDE_MODELS_YAML: &str = r#"      - id: claude-opus-5-5
        name: Claude Opus 5.5
        reasoning: true
        input: [text, image]
        contextWindow: 1000000 # not verified
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: medium
      - id: claude-sonnet-5-5
        name: Claude Sonnet 5.5
        reasoning: true
        input: [text, image]
        contextWindow: 1000000 # not verified
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: medium
      - id: claude-haiku-5-5
        name: Claude Haiku 5.5
        reasoning: true
        input: [text, image]
        contextWindow: 200000 # not verified
        maxTokens: 64000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [minimal, low, medium, high, xhigh]
          defaultLevel: minimal
      - id: claude-opus-5
        name: Claude Opus 5
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: medium
      - id: claude-fable-5-1
        name: Claude Fable 5.1
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: high
      - id: claude-fable-5
        name: Claude Fable 5
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: high
      - id: claude-opus-4-8
        name: Claude Opus 4.8
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: medium
      - id: claude-opus-4-7
        name: Claude Opus 4.7
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: medium
      - id: claude-opus-4-6
        name: Claude Opus 4.6
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, max]
          defaultLevel: medium
      - id: claude-sonnet-5
        name: Claude Sonnet 5
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high, xhigh, max]
          defaultLevel: medium
      - id: claude-sonnet-4-6
        name: Claude Sonnet 4.6
        reasoning: true
        input: [text, image]
        contextWindow: 1000000
        maxTokens: 128000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [low, medium, high]
          defaultLevel: medium
      - id: claude-haiku-4-5
        name: Claude Haiku 4.5
        reasoning: true
        input: [text, image]
        contextWindow: 200000
        maxTokens: 64000
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0}
        thinking:
          mode: anthropic-budget-effort
          efforts: [minimal, low, medium, high, xhigh]
          defaultLevel: minimal"#;

/// Render YAML provider block for models.yml
pub fn render_provider_block(provider_name: &str, v1_url: &str, token: &str) -> String {
    format!(
        "  {}:\n    baseUrl: {}\n    apiKey: {}\n    api: anthropic-messages\n    authHeader: true\n    models:\n{}\n",
        provider_name, v1_url, token, CLAUDE_MODELS_YAML
    )
}

/// Execute `8sync harness claude-code [JSON/FILE]`
pub fn harness_claude_code(env: &env_detect::Env, args: &[String]) -> Result<()> {
    ui::header("8sync harness claude-code — auto setup Claude Code & omp models");

    // 1. Resolve raw input from argument, file path, or stdin
    let raw_input = if let Some(arg) = args.first() {
        let p = Path::new(arg);
        if p.exists() && p.is_file() {
            std::fs::read_to_string(p).context("failed reading settings file")?
        } else {
            arg.clone()
        }
    } else {
        // Try reading stdin
        use std::io::Read;
        let mut buf = String::new();
        let stdin = std::io::stdin();
        let mut handle = stdin.lock();
        if let Ok(n) = handle.read_to_string(&mut buf) {
            if n > 0 {
                buf
            } else {
                bail!("no input provided: pass JSON string or file path, e.g. `8sync harness claude-code '<JSON>'`");
            }
        } else {
            bail!("no input provided: pass JSON string or file path");
        }
    };

    let settings = parse_claude_settings(&raw_input)?;
    let base_url = &settings.env.anthropic_base_url;
    let token = &settings.env.anthropic_auth_token;
    let v1_url = if base_url.ends_with("/v1") {
        base_url.clone()
    } else {
        format!("{base_url}/v1")
    };
    let slug = provider_slug(base_url);

    if !gateway_allowed(base_url) {
        bail!(
            "refusing base URL host {:?}: not on the allowlist (api.anthropic.com, Amazon Bedrock, Google Vertex, Microsoft Foundry; https required, plain http only for localhost). \
             Routing Claude through a third-party gateway/proxy conflicts with Anthropic's Usage Policy (\"Do Not Abuse Our Platform\", https://www.anthropic.com/legal/aup) \
             and would send your code and token to an undisclosed third party. localhost is allowed for a gateway you run yourself (otherwise set EIGHTSYNC_SELF_HOSTED_GATEWAY=<host>, https, host must equal the URL host exactly). \
             Local tools or proxies that re-route a Claude subscription (Pro/Max/OAuth) into other clients are still forbidden.",
            base_url_host(base_url).unwrap_or_default()
        );
    }
    if !token_allowed_for_host(base_url, token) {
        bail!(
            "refusing: a Claude subscription/OAuth token (`sk-ant-` but not a Console key) may only go to api.anthropic.com — \
             sending it to {:?} would re-route a subscription through another endpoint (Anthropic Usage Policy, https://www.anthropic.com/legal/aup). \
             Use a Console API key (`sk-ant-api…`) or the provider's own credentials.",
            base_url_host(base_url).unwrap_or_default()
        );
    }
    let console_key = is_console_key(token);

    ui::info(&format!("detected endpoint: {}", base_url));
    ui::info(&format!("provider slug:     {}", slug));
    ui::info(&format!("auth token:        {}", mask_token(token)));

    // 2. Merge into ~/.claude/settings.json: only these `env` keys change, so the
    //    8sync kit's hooks/permissions and the user's own settings survive. Claude
    //    Code reads the upper-case names; the struct's field names are not them.
    let claude_dir = env.home.join(".claude");
    std::fs::create_dir_all(&claude_dir)?;
    let settings_path = claude_dir.join("settings.json");
    let raw = std::fs::read_to_string(&settings_path).unwrap_or_default();
    let mut doc: Value = if raw.trim().is_empty() {
        serde_json::json!({ "$schema": "https://json.schemastore.org/claude-code-settings.json" })
    } else {
        serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", settings_path.display()))?
    };
    let env_map = doc
        .as_object_mut()
        .context("settings.json is not a JSON object")?
        .entry("env")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .context("settings.json `env` is not an object")?;
    for (k, v) in [
        ("ANTHROPIC_BASE_URL", base_url.as_str()),
        ("ANTHROPIC_AUTH_TOKEN", token.as_str()),
        ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", settings.env.claude_code_disable_nonessential_traffic.as_str()),
        ("CLAUDE_CODE_ATTRIBUTION_HEADER", settings.env.claude_code_attribution_header.as_str()),
    ] {
        env_map.insert(k.to_string(), Value::String(v.to_string()));
    }
    std::fs::write(&settings_path, serde_json::to_string_pretty(&doc)? + "\n")?;
    ui::ok(&format!("updated env in {}", settings_path.display()));

    // 3. Set environment variables
    std::env::set_var("ANTHROPIC_BASE_URL", base_url);
    std::env::set_var("ANTHROPIC_AUTH_TOKEN", token);
    std::env::set_var("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", &settings.env.claude_code_disable_nonessential_traffic);
    std::env::set_var("CLAUDE_CODE_ATTRIBUTION_HEADER", &settings.env.claude_code_attribution_header);

    let is_official = base_url_host(base_url).as_deref() == Some("api.anthropic.com");
    let write_omp = omp_write_allowed(base_url, token);

    #[cfg(target_os = "windows")]
    {
        let vals = [
            token.as_str(),
            settings.env.claude_code_disable_nonessential_traffic.as_str(),
            settings.env.claude_code_attribution_header.as_str(),
        ];
        if write_omp && !vals.iter().all(|v| persist_value_safe(v)) {
            ui::warn("skipping Windows env persistence: a value has characters outside [A-Za-z0-9_-]");
        } else if write_omp {
            let ps_cmd = format!(
                "[System.Environment]::SetEnvironmentVariable('ANTHROPIC_AUTH_TOKEN', '{}', [System.EnvironmentVariableTarget]::User); \
                 [System.Environment]::SetEnvironmentVariable('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', '{}', [System.EnvironmentVariableTarget]::User); \
                 [System.Environment]::SetEnvironmentVariable('CLAUDE_CODE_ATTRIBUTION_HEADER', '{}', [System.EnvironmentVariableTarget]::User);",
                token, settings.env.claude_code_disable_nonessential_traffic, settings.env.claude_code_attribution_header
            );
            let _ = Command::new("powershell").args(["-Command", &ps_cmd]).status();
            ui::ok("persisted Windows User environment variables");
        }
    }

    // A third-party gateway configures Claude Code only: Anthropic's Usage
    // Policy (8sync rules) lets tools other than Claude Code — omp here — use
    // Claude only through a Console API key, never a gateway's Claude access.
    if !is_official {
        ui::warn("endpoint is not api.anthropic.com → Claude Code configured, omp left untouched. Tools other than Claude Code (omp, Forge, Feynman) use a Console API key only.");
        report_probe(&v1_url, token, console_key);
        return Ok(());
    }
    if !write_omp {
        ui::warn("token is not a Console API key (sk-ant-api…) → Claude Code configured, omp models.yml untouched. Subscription/OAuth tokens stay in Claude Code only (and https is required).");
        report_probe(&v1_url, token, console_key);
        return Ok(());
    }

    // 4. Update ~/.omp/agent/models.yml
    let agent_dir = env.home.join(".omp").join("agent");
    std::fs::create_dir_all(&agent_dir)?;
    let models_yml_path = agent_dir.join("models.yml");

    let existing_content = if models_yml_path.exists() {
        std::fs::read_to_string(&models_yml_path).unwrap_or_default()
    } else {
        "providers:\n".to_string()
    };

    // Official endpoint: register under the native `anthropic` provider.
    let replacement_blocks: Vec<(&str, String)> = vec![("anthropic", render_provider_block("anthropic", &v1_url, token))];

    let block_refs: Vec<(&str, &str)> = replacement_blocks.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let updated_models_yml = merge_provider_blocks(&existing_content, &block_refs);

    std::fs::write(&models_yml_path, &updated_models_yml)?;
    ui::ok(&format!("updated {} (registered 9 Claude models under anthropic)", models_yml_path.display()));
    // 5. Update ~/.omp/agent/config.yml default model to latest Claude model
    let config_yml_path = agent_dir.join("config.yml");
    if config_yml_path.exists() {
        let config_raw = std::fs::read_to_string(&config_yml_path).unwrap_or_default();
        let updated_config = set_model_roles(&config_raw, "anthropic/claude-fable-5-1:high", "anthropic/claude-opus-5-5:high");
        std::fs::write(&config_yml_path, updated_config)?;
        ui::ok("set default modelRole to anthropic/claude-fable-5-1:high and advisor to anthropic/claude-opus-5-5:high");
    }

    // 6. Live probe test
    report_probe(&v1_url, token, console_key);

    println!();
    println!("Active Models available in omp:");
    println!("  • anthropic/claude-opus-5-5    (1M ctx, 128K max-out) [ADVISOR]");
    println!("  • anthropic/claude-sonnet-5-5  (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-haiku-5-5   (200K ctx, 64K max-out)");
    println!("  • anthropic/claude-opus-5      (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-fable-5-1   (1M ctx, 128K max-out) [DEFAULT]");
    println!("  • anthropic/claude-fable-5     (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-opus-4-8    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-opus-4-7    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-opus-4-6    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-sonnet-5    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-sonnet-4-6  (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-haiku-4-5   (200K ctx, 64K max-out)");

    Ok(())
}

fn report_probe(v1_url: &str, token: &str, console_key: bool) {
    if !console_key {
        ui::info("probe skipped: token is not a Console API key; a subscription token is only used inside Claude Code.");
        return;
    }
    if !probe_supported(v1_url) {
        ui::info("probe skipped: only api.anthropic.com and localhost use the Messages API header format; Bedrock/Vertex/Foundry need their own auth.");
        return;
    }
    ui::step("verifying connection with 1-token probe...");
    match probe_endpoint(v1_url, token) {
        Ok(ms) => ui::ok(&format!("live probe OK ({ms}ms) — endpoint is responsive")),
        Err(e) => ui::warn(&format!("probe returned notice: {e} (config is still written)")),
    }
}

/// Replace or insert provider blocks inside models.yml content.
pub fn merge_provider_blocks(existing: &str, blocks: &[(&str, &str)]) -> String {
    let mut doc = existing.to_string();
    if !doc.contains("providers:") {
        doc = format!("providers:\n{doc}");
    }

    for (name, block) in blocks {
        if block.trim().is_empty() {
            continue;
        }
        let prefix = format!("  {}:", name);
        let lines: Vec<&str> = doc.lines().collect();
        let mut start_line = None;
        let mut end_line = None;

        for (idx, line) in lines.iter().enumerate() {
            if start_line.is_none() {
                if line.starts_with(&prefix) {
                    start_line = Some(idx);
                }
            } else {
                // Look for next provider (starts with 2 spaces and not a 4-space property or comment)
                let trimmed = line.trim_start();
                let indent = line.len() - trimmed.len();
                if (indent == 2 && trimmed.contains(':') && !trimmed.starts_with('#')) || (indent < 2 && !trimmed.is_empty()) {
                    end_line = Some(idx);
                    break;
                }
            }
        }

        if let Some(s_idx) = start_line {
            let e_idx = end_line.unwrap_or(lines.len());
            let mut new_lines = Vec::new();
            for (idx, line) in lines.iter().enumerate() {
                if idx == s_idx {
                    new_lines.push(block.trim_end());
                } else if idx < s_idx || idx >= e_idx {
                    new_lines.push(line);
                }
            }
            doc = new_lines.join("\n") + "\n";
        } else {
            // Append under providers:
            if let Some(p_idx) = doc.find("providers:\n") {
                let insert_at = p_idx + "providers:\n".len();
                doc.insert_str(insert_at, block);
            } else {
                doc.push_str(block);
            }
        }
    }
    doc
}

/// Set default and advisor roles in config.yml.
pub fn set_model_roles(raw: &str, default_role: &str, advisor_role: &str) -> String {
    let mut lines: Vec<String> = raw.lines().map(|s| s.to_string()).collect();
    let mut in_roles = false;
    let mut roles_found = false;
    let mut default_set = false;
    let mut advisor_set = false;

    let mut i = 0;
    while i < lines.len() {
        let line = &lines[i];
        let trimmed = line.trim();
        if trimmed.starts_with("modelRoles:") {
            in_roles = true;
            roles_found = true;
            i += 1;
            continue;
        }

        if in_roles {
            if !line.starts_with(' ') && !line.starts_with('\t') && !trimmed.is_empty() {
                in_roles = false;
            } else if trimmed.starts_with("default:") {
                lines[i] = format!("  default: {}", default_role);
                default_set = true;
                i += 1;
                continue;
            } else if trimmed.starts_with("advisor:") {
                lines[i] = format!("  advisor: {}", advisor_role);
                advisor_set = true;
                i += 1;
                continue;
            }
        }
        i += 1;
    }

    if roles_found {
        if !default_set || !advisor_set {
            // Find modelRoles line and insert missing keys
            for j in 0..lines.len() {
                if lines[j].trim().starts_with("modelRoles:") {
                    if !default_set {
                        lines.insert(j + 1, format!("  default: {}", default_role));
                    }
                    if !advisor_set {
                        lines.insert(j + 1, format!("  advisor: {}", advisor_role));
                    }
                    break;
                }
            }
        }
    } else {
        lines.push("modelRoles:".to_string());
        lines.push(format!("  default: {}", default_role));
        lines.push(format!("  advisor: {}", advisor_role));
    }

    lines.join("\n") + "\n"
}

/// Probe only hosts that speak the Anthropic Messages API directly.
fn probe_supported(v1_url: &str) -> bool {
    base_url_host(v1_url).is_some_and(|h| h == "api.anthropic.com" || is_loopback(&h))
}

/// Header lines sent to curl via stdin (`-H @-`), one per line. Messages API
/// headers for Console keys: x-api-key + anthropic-version.
fn probe_header_lines(token: &str) -> String {
    format!("x-api-key: {token}\nanthropic-version: 2023-06-01\n")
}

/// Fast 1-token probe test against the messages endpoint.
fn probe_endpoint(v1_url: &str, token: &str) -> Result<u128> {
    let endpoint = format!("{}/messages", v1_url.trim_end_matches('/'));
    let start = std::time::Instant::now();

    // Auth header goes through stdin (`-H @-`) so the token never shows in argv.
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            &endpoint,
            "-H", "@-",
            "-H", "Content-Type: application/json",
            "-d", r#"{"model":"claude-haiku-5-5","max_tokens":5,"messages":[{"role":"user","content":"ping"}]}"#,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("failed executing curl probe")?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(probe_header_lines(token).as_bytes());
    }
    let output = child.wait_with_output().context("curl probe failed")?;

    let elapsed = start.elapsed().as_millis();
    let body = String::from_utf8_lossy(&output.stdout);

    if body.contains("\"type\":\"message\"") || body.contains("\"content\"") {
        Ok(elapsed)
    } else if body.contains("error") {
        bail!("{body}")
    } else {
        Ok(elapsed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_headers_use_x_api_key_and_version() {
        let h = probe_header_lines("test-key-placeholder");
        let lines: Vec<&str> = h.lines().collect();
        assert_eq!(lines, ["x-api-key: test-key-placeholder", "anthropic-version: 2023-06-01"]);
        assert!(!h.to_ascii_lowercase().contains("authorization"));
    }

    #[test]
    fn probe_only_for_anthropic_and_localhost() {
        assert!(probe_supported("https://api.anthropic.com/v1"));
        assert!(probe_supported("http://localhost:8080/v1"));
        assert!(!probe_supported("https://bedrock-runtime.us-east-1.amazonaws.com"));
        assert!(!probe_supported("https://aiplatform.googleapis.com"));
    }

    #[test]
    fn parse_full_claude_settings_json() {
        let input = r#"{
          "$schema": "https://json.schemastore.org/claude-code-settings.json",
          "env": {
            "ANTHROPIC_BASE_URL": "https://api.apikey.fun",
            "ANTHROPIC_AUTH_TOKEN": "test-dummy-token-for-unit-tests-12345",
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
            "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
          }
        }"#;

        let parsed = parse_claude_settings(input).unwrap();
        assert_eq!(parsed.env.anthropic_base_url, "https://api.apikey.fun");
        assert_eq!(parsed.env.anthropic_auth_token, "test-dummy-token-for-unit-tests-12345");
        assert_eq!(parsed.env.claude_code_disable_nonessential_traffic, "1");
        assert_eq!(parsed.env.claude_code_attribution_header, "0");
    }

    #[test]
    fn parse_flat_json_object() {
        let input = r#"{
            "ANTHROPIC_BASE_URL": "https://api.apikey.fun/",
            "ANTHROPIC_AUTH_TOKEN": "dummy-token-456"
        }"#;

        let parsed = parse_claude_settings(input).unwrap();
        assert_eq!(parsed.env.anthropic_base_url, "https://api.apikey.fun");
        assert_eq!(parsed.env.anthropic_auth_token, "dummy-token-456");
        assert_eq!(parsed.env.claude_code_disable_nonessential_traffic, "1");
        assert_eq!(parsed.env.claude_code_attribution_header, "0");
    }

    #[test]
    fn provider_slug_generation() {
        assert_eq!(provider_slug("https://api.apikey.fun"), "apikey-fun");
        assert_eq!(provider_slug("https://api.apikey.fun/v1"), "apikey-fun");
        assert_eq!(provider_slug("https://gateway.ai.corp.vn"), "gateway-ai-corp-vn");
    }

    #[test]
    fn merge_blocks_replaces_existing_provider() {
        let existing = "providers:\n  anthropic:\n    baseUrl: https://old.com\n  other:\n    key: val\n";
        let new_anthropic = "  anthropic:\n    baseUrl: https://new.com\n";
        let merged = merge_provider_blocks(existing, &[("anthropic", new_anthropic)]);
        assert!(merged.contains("baseUrl: https://new.com"));
        assert!(!merged.contains("baseUrl: https://old.com"));
        assert!(merged.contains("  other:\n    key: val"));
    }

    #[test]
    fn update_config_roles() {
        let raw = "setupVersion: 2\nmodelRoles:\n  advisor: old/opus\n  default: old/default\n";
        let updated = set_model_roles(raw, "anthropic/claude-fable-5-1:high", "anthropic/claude-opus-5-5:high");
        assert!(updated.contains("default: anthropic/claude-fable-5-1:high"));
        assert!(updated.contains("advisor: anthropic/claude-opus-5-5:high"));
    }

    #[test]
    fn gateway_allowlist() {
        // env-touching: kept in ONE test (env is process-global, tests run in parallel)
        std::env::remove_var("EIGHTSYNC_SELF_HOSTED_GATEWAY");
        for ok in [
            "https://api.anthropic.com",
            "https://API.Anthropic.com:443/v1",
            "https://bedrock-runtime.us-east-1.amazonaws.com",
            "https://us-east5-aiplatform.googleapis.com/v1",
            "https://aiplatform.googleapis.com",
            "https://myres.services.ai.azure.com/anthropic",
            "http://localhost:8080",
            "https://localhost:8080",
            "http://127.0.0.1:4000/v1",
            "http://[::1]:4000",
        ] {
            assert!(gateway_allowed(ok), "{ok}");
        }
        for bad in [
            "https://api.apikey.fun",
            "http://api.anthropic.com",
            "api.anthropic.com",
            "http://bedrock-runtime.us-east-1.amazonaws.com",
            "https://api.anthropic.com.evil.io",
            "https://evilapi.anthropic.com",
            "https://api.anthropic.com@evil.io",
            "https://bedrock-runtime.us-east-1.amazonaws.com.evil.io",
            "https://evil.io/api.anthropic.com",
            "https://x.y.services.ai.azure.com",
            "",
        ] {
            assert!(!gateway_allowed(bad), "{bad}");
        }
        std::env::set_var("EIGHTSYNC_SELF_HOSTED_GATEWAY", "gw.example.test");
        assert!(gateway_allowed("https://gw.example.test:8443/v1"));
        assert!(!gateway_allowed("https://other.example.test"));
        assert!(!gateway_allowed("https://sub.gw.example.test"));
        std::env::remove_var("EIGHTSYNC_SELF_HOSTED_GATEWAY");
        assert!(!gateway_allowed("https://gw.example.test"));
    }

    #[test]
    fn omp_write_gate() {
        assert!(omp_write_allowed("https://api.anthropic.com", "sk-ant-api03-test"));
        assert!(!omp_write_allowed("http://api.anthropic.com", "sk-ant-api03-test"));
        assert!(!omp_write_allowed("https://api.anthropic.com", "sk-ant-oat01-test"));
        assert!(!omp_write_allowed("https://bedrock-runtime.us-east-1.amazonaws.com", "sk-ant-api03-test"));
        assert!(!omp_write_allowed("http://localhost:8080", "sk-ant-api03-test"));
    }

    #[test]
    fn persist_value_validation() {
        assert!(persist_value_safe("sk-ant-api03-test_x"));
        assert!(persist_value_safe("1"));
        assert!(!persist_value_safe(""));
        assert!(!persist_value_safe("a'b"));
        assert!(!persist_value_safe("a b;c"));
        assert!(!persist_value_safe("a$(x)"));
    }

    #[test]
    fn console_key_detection() {
        assert!(is_console_key("sk-ant-api03-test"));
        assert!(!is_console_key("sk-ant-oat01-test"));
        assert!(!is_console_key("other"));
        assert!(!is_console_key(""));
    }

    #[test]
    fn mask_shows_only_last_four() {
        assert_eq!(mask_token("sk-ant-api03-abcd"), "…abcd");
        assert_eq!(mask_token("ab"), "…");
    }

    #[test]
    fn models_yaml_has_55_family() {
        for id in ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] {
            assert!(CLAUDE_MODELS_YAML.contains(&format!("id: {id}\n")), "{id}");
        }
    }
    #[test]
    fn subscription_tokens_only_to_official_host() {
        let oat = "sk-ant-oat01-test";
        assert!(token_allowed_for_host("https://api.anthropic.com", oat));
        assert!(!token_allowed_for_host("http://localhost:8080", oat));
        assert!(!token_allowed_for_host("https://my-gw.example.org", oat));
        assert!(!token_allowed_for_host("http://127.0.0.1:4000", " sk-ant-oat01-test"));
        assert!(token_allowed_for_host("http://localhost:8080", "sk-ant-api03-test"));
        assert!(token_allowed_for_host("http://localhost:8080", "local-gw-token"));
    }

}
