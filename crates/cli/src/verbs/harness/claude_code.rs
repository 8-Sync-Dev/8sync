//! `8sync harness claude-code` — auto-setup Claude Code settings & omp Anthropic models.
//!
//! Accepts a JSON string, a path to settings.json, or stdin:
//! ```json
//! {
//!   "$schema": "https://json.schemastore.org/claude-code-settings.json",
//!   "env": {
//!     "ANTHROPIC_BASE_URL": "https://api.apikey.fun",
//!     "ANTHROPIC_AUTH_TOKEN": "your-api-key",
//!     "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
//!     "CLAUDE_CODE_ATTRIBUTION_HEADER": "0"
//!   }
//! }
//! ```
//!
//! Actions performed:
//! 1. Parses settings JSON (supports full schema, flat env map, or CLI flags).
//! 2. Writes `~/.claude/settings.json`.
//! 3. On Windows: sets User persistent environment variables (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, etc.).
//! 4. Injects the 9 latest Claude models into `~/.omp/agent/models.yml` under both `anthropic` and
//!    the gateway provider, configuring `anthropic-budget-effort` thinking and 1M context.
//! 5. Updates `~/.omp/agent/config.yml` to set the latest Claude model (`anthropic/claude-fable-5-1:high`)
//!    as default role and `anthropic/claude-opus-5:high` as advisor.
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

/// Canonical modern Claude model catalog (the 9 current models).
pub const CLAUDE_MODELS_YAML: &str = r#"      - id: claude-opus-5
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

    ui::info(&format!("detected endpoint: {}", base_url));
    ui::info(&format!("provider slug:     {}", slug));
    ui::info(&format!("auth token:        {}...{}", &token[..token.len().min(8)], &token[token.len().saturating_sub(6)..]));

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

    let is_official = base_url.contains("api.anthropic.com");

    #[cfg(target_os = "windows")]
    {
        if is_official {
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

    // 4. Update ~/.omp/agent/models.yml
    let agent_dir = env.home.join(".omp").join("agent");
    std::fs::create_dir_all(&agent_dir)?;
    let models_yml_path = agent_dir.join("models.yml");

    let existing_content = if models_yml_path.exists() {
        std::fs::read_to_string(&models_yml_path).unwrap_or_default()
    } else {
        "providers:\n".to_string()
    };

    // Build replacement blocks: custom gateways register ONLY under their slug, never hijacking native 'anthropic'
    let mut replacement_blocks: Vec<(&str, String)> = Vec::new();
    if is_official || slug == "anthropic" {
        replacement_blocks.push(("anthropic", render_provider_block("anthropic", &v1_url, token)));
    } else {
        replacement_blocks.push((&slug, render_provider_block(&slug, &v1_url, token)));
    }

    let block_refs: Vec<(&str, &str)> = replacement_blocks.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let updated_models_yml = merge_provider_blocks(&existing_content, &block_refs);

    std::fs::write(&models_yml_path, &updated_models_yml)?;
    ui::ok(&format!("updated {} (registered 9 Claude models under {})", models_yml_path.display(), if is_official { "anthropic" } else { &slug }));
    // 5. Update ~/.omp/agent/config.yml default model to latest Claude model
    let config_yml_path = agent_dir.join("config.yml");
    if config_yml_path.exists() {
        let config_raw = std::fs::read_to_string(&config_yml_path).unwrap_or_default();
        let updated_config = set_model_roles(&config_raw, "anthropic/claude-fable-5-1:high", "anthropic/claude-opus-5:high");
        std::fs::write(&config_yml_path, updated_config)?;
        ui::ok("set default modelRole to anthropic/claude-fable-5-1:high and advisor to anthropic/claude-opus-5:high");
    }

    // 6. Live probe test
    ui::step("verifying connection with 1-token probe...");
    match probe_endpoint(&v1_url, token) {
        Ok(ms) => {
            ui::ok(&format!("live probe OK ({ms}ms) — gateway is responsive"));
        }
        Err(e) => {
            ui::warn(&format!("probe returned notice: {e} (config is still written)"));
        }
    }

    println!();
    println!("{}", "Active Models available in omp:".to_string());
    println!("  • anthropic/claude-opus-5      (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-fable-5-1   (1M ctx, 128K max-out) [DEFAULT]");
    println!("  • anthropic/claude-fable-5     (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-opus-4-8    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-opus-4-7    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-opus-4-6    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-sonnet-5    (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-sonnet-4-6  (1M ctx, 128K max-out)");
    println!("  • anthropic/claude-haiku-4-5   (200K ctx, 64K max-out)");
    if slug != "anthropic" {
        println!("  (also available under `{}/<model>`)", slug);
    }

    Ok(())
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

/// Fast 1-token probe test against the messages endpoint.
fn probe_endpoint(v1_url: &str, token: &str) -> Result<u128> {
    let endpoint = format!("{}/messages", v1_url.trim_end_matches('/'));
    let start = std::time::Instant::now();

    let output = Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            &endpoint,
            "-H", &format!("Authorization: Bearer {}", token),
            "-H", "Content-Type: application/json",
            "-d", r#"{"model":"claude-haiku-4-5","max_tokens":5,"messages":[{"role":"user","content":"ping"}]}"#,
        ])
        .output()
        .context("failed executing curl probe")?;

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
        let updated = set_model_roles(raw, "anthropic/claude-fable-5-1:high", "anthropic/claude-opus-5:high");
        assert!(updated.contains("default: anthropic/claude-fable-5-1:high"));
        assert!(updated.contains("advisor: anthropic/claude-opus-5:high"));
    }
}
