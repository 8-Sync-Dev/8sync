//! `8sync harness gateway` — deploy & verify the omp model-gateway config
//! (`~/.omp/agent/models.yml`): the 9router provider, models, API key, and the
//! non-Claude (GPT/Codex) models. Claude is NOT routed here: a third-party proxy for
//! Claude conflicts with Anthropic's Usage Policy, so `apply` removes any old
//! `9router-cc` provider. `apply`/`key`/`verify` are opt-in (`EIGHTSYNC_GATEWAY_ACCEPT=1`).
//!
//! This file is the ONLY place omp learns the provider URL, models, and how to
//! serialize thinking. Model ROLE routing (which model for code/plan/smol) is a
//! separate layer — that lives in `~/.config/8sync/models.toml` via
//! `8sync harness model`.
//!
//! Parsing is line-based (no serde_yaml dep): the template format is fixed and
//! simple, so a `key: value` scan is robust and keeps the binary lean.
use anyhow::{bail, Result};
use std::path::Path;
use std::process::Command;

use crate::{assets, env_detect, ui};

/// Placeholder substituted at apply time. Must match the template asset.
const PLACEHOLDER: &str = "__NINE_ROUTER_KEY__";
/// Env var read for the key (keeps secrets out of shell history / git).
const ENV_KEY: &str = "NINE_ROUTER_KEY";
/// Opt-in env var for every action except `status`.
const ENV_ACCEPT: &str = "EIGHTSYNC_GATEWAY_ACCEPT";
/// Removed Claude provider (fake-client / proxy pattern, forbidden).
const CC_PROVIDER: &str = "9router-cc";
/// The only provider block this module reads or rewrites.
const GW_PROVIDER: &str = "9router-cx";

/// Anthropic keys never go to a third-party router.
fn reject_anthropic_key(key: &str) -> Result<()> {
    if key.starts_with("sk-ant-") {
        bail!("refusing an Anthropic key (sk-ant-…) for the 9router gateway: Anthropic keys must never be sent to a third-party router. Keep it only in the `anthropic` provider (`8sync harness claude-code`).");
    }
    Ok(())
}

/// True for a managed-section sentinel line (`  # >>> ...` / `  # <<< ...`).
fn is_sentinel(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("# >>>") || t.starts_with("# <<<")
}

/// Header `  <name>:` matched by the key before any `#` comment.
fn is_header(line: &str, head: &str) -> bool {
    line.trim_end().split('#').next().unwrap_or("").trim_end() == head
}

/// Byte range of the `  <name>:` provider block: from its header line until the next
/// sentinel line or line indented <= 2 (next provider / top-level key) or EOF.
/// Trailing blank and comment-only lines are not part of the block.
fn provider_block_range(raw: &str, name: &str) -> Option<(usize, usize)> {
    let head = format!("  {}:", name);
    let mut pos = 0;
    let mut start = None;
    let mut last = 0;
    for line in raw.split_inclusive('\n') {
        let bare = line.trim_end();
        match start {
            None => {
                if is_header(line, &head) {
                    start = Some(pos);
                    last = pos + line.len();
                }
            }
            Some(s) => {
                let indent = line.len() - line.trim_start().len();
                let comment = bare.trim_start().starts_with('#');
                if is_sentinel(line) || (!bare.is_empty() && indent <= 2 && !comment) {
                    return Some((s, last));
                }
                if !bare.is_empty() && !(comment && indent <= 2) {
                    last = pos + line.len();
                }
            }
        }
        pos += line.len();
    }
    start.map(|s| (s, last))
}

/// Byte offset just after the `providers:` section (before the next top-level key or EOF),
/// excluding trailing blank lines. None when there is no `providers:` key.
fn providers_end(raw: &str) -> Option<usize> {
    let mut pos = 0;
    let mut in_sec = false;
    let mut end = 0;
    for line in raw.split_inclusive('\n') {
        let bare = line.trim_end();
        if !in_sec {
            if bare.split('#').next().unwrap_or("").trim_end() == "providers:" {
                in_sec = true;
                end = pos + line.len();
            }
        } else if !bare.is_empty() && !line.starts_with(' ') && !bare.starts_with('#') {
            break;
        } else if !bare.is_empty() {
            end = pos + line.len();
        }
        pos += line.len();
    }
    in_sec.then_some(end)
}

/// Names of the 2-space-indented providers under `providers:`.
fn provider_names(raw: &str) -> Vec<String> {
    let Some(end) = providers_end(raw) else { return Vec::new() };
    raw[..end]
        .lines()
        .filter(|l| l.len() - l.trim_start().len() == 2 && !l.trim_start().starts_with('#'))
        .filter_map(|l| l.split('#').next()?.trim().strip_suffix(':').map(|n| n.trim().to_string()))
        .filter(|n| !n.is_empty())
        .collect()
}

/// Append `block` (header included) at the end of the `providers:` section, creating the
/// section when absent. Other content is untouched.
fn append_provider(raw: &str, block: &str) -> String {
    let block = if block.ends_with('\n') { block.to_string() } else { format!("{block}\n") };
    match providers_end(raw) {
        Some(i) => {
            let nl = if raw[..i].ends_with('\n') { "" } else { "\n" };
            format!("{}{}{}{}", &raw[..i], nl, block, &raw[i..])
        }
        None => {
            let sep = if raw.is_empty() || raw.ends_with('\n') { "" } else { "\n" };
            format!("{raw}{sep}providers:\n{block}")
        }
    }
}

/// The text of provider block `name` (header line included).
fn provider_block<'a>(raw: &'a str, name: &str) -> Option<&'a str> {
    provider_block_range(raw, name).map(|(a, b)| &raw[a..b])
}

/// Value of a provider-level (4-space-indented) `key:` inside provider `provider`.
fn provider_field<'a>(raw: &'a str, provider: &str, key: &str) -> Option<&'a str> {
    let prefix = format!("{}:", key);
    provider_block(raw, provider)?.lines().skip(1).find_map(|line| {
        let indent = line.len() - line.trim_start().len();
        let rest = line.trim_start().strip_prefix(&prefix)?;
        (indent == 4 && (rest.is_empty() || rest.starts_with(' '))).then(|| rest.trim().trim_matches('"'))
    })
}

/// Rewrite provider-level `key:` inside `provider` only; other providers untouched.
fn set_provider_field(raw: &str, provider: &str, key: &str, value: &str) -> String {
    let Some((a, b)) = provider_block_range(raw, provider) else {
        return raw.to_string();
    };
    let prefix = format!("{}:", key);
    let block: String = raw[a..b]
        .split_inclusive('\n')
        .map(|line| {
            let t = line.trim_start();
            let indent = line.len() - t.len();
            if indent == 4 && t.starts_with(&prefix) {
                let nl = if line.ends_with('\n') { "\n" } else { "" };
                format!("    {} {}{}", prefix, value, nl)
            } else {
                line.to_string()
            }
        })
        .collect();
    format!("{}{}{}", &raw[..a], block, &raw[b..])
}

/// True only when the opt-in env var is exactly "1".
fn opted_in(env_value: Option<&str>) -> bool {
    env_value == Some("1")
}

/// Remove the `9router-cc` provider block (2-space-indented key under `providers:`)
/// from a models.yml string. Returns (new content, whether something was removed).
fn strip_cc_provider(raw: &str) -> (String, bool) {
    let head = format!("  {}:", CC_PROVIDER);
    let mut out: Vec<&str> = Vec::new();
    let mut skipping = false;
    let mut removed = false;
    for line in raw.lines() {
        if skipping {
            let indent = line.len() - line.trim_start().len();
            if line.trim().is_empty() || indent > 2 {
                continue;
            }
            skipping = false;
        }
        if is_header(line, &head) {
            skipping = true;
            removed = true;
            continue;
        }
        out.push(line);
    }
    let mut s = out.join("\n");
    if raw.ends_with('\n') {
        s.push('\n');
    }
    (s, removed)
}

pub(crate) fn harness_gateway(env: &env_detect::Env, args: &[String]) -> Result<()> {
    let path = env.home.join(".omp/agent/models.yml");
    let sub = args.first().map(String::as_str);
    if matches!(sub, Some("apply") | Some("key") | Some("verify"))
        && !opted_in(std::env::var(ENV_ACCEPT).ok().as_deref())
    {
        ui::warn("gateway apply/key/verify are OPT-IN and were NOT run.");
        ui::info("This routes a ChatGPT/Codex subscription through a third-party router (9router) into omp; OpenAI's terms for that are not verified, and 8 Sync rules forbid routing subscriptions into third-party clients.");
        ui::info("Claude is never routed here (Anthropic Usage Policy): use a Console API key via `8sync harness claude-code`.");
        ui::info(&format!("To proceed at your own risk: {}=1 8sync harness gateway {}", ENV_ACCEPT, sub.unwrap_or("")));
        bail!("gateway requires {}=1 (opt-in, at your own risk)", ENV_ACCEPT);
    }
    match sub {
        Some("apply") => apply(&path),
        Some("key") => match args.get(1).map(|s| s.trim()).filter(|s| !s.is_empty()) {
            Some(k) => set_key(&path, k),
            None => {
                ui::warn("usage: 8sync harness gateway key <KEY>");
                ui::info("or set the $NINE_ROUTER_KEY env var and run `8sync harness gateway apply`");
                Ok(())
            }
        },
        Some("verify") => verify(&path),
        Some("status") | None => status(&path),
        Some(other) => {
            ui::warn(&format!("unknown gateway subcommand: {}", other));
            ui::info("try: 8sync harness gateway apply | key <KEY> | verify | status");
            Ok(())
        }
    }
}

/// Append top-level blocks of `old` (e.g. `modelRoles:`) whose key is absent from `new`.
/// `providers:` is handled separately and never copied here.
fn keep_top_level_extras(old: &str, new: &str) -> String {
    let key_of = |l: &str| -> Option<String> {
        (!l.starts_with([' ', '\t', '#', '-']) && l.contains(':'))
            .then(|| l.split(':').next().unwrap_or("").trim().to_string())
            .filter(|k| !k.is_empty())
    };
    let have: Vec<String> = new.lines().filter_map(key_of).collect();
    let mut out = new.to_string();
    let mut keep = false;
    for line in old.lines() {
        if let Some(k) = key_of(line) {
            keep = k != "providers" && !have.contains(&k);
        } else if !line.starts_with([' ', '\t']) && !line.trim().is_empty() && !line.starts_with('#') {
            keep = false;
        }
        if keep {
            if !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Show the current gateway config: provider URL, masked key, model count, and
/// whether the thinking-fix (`anthropic-budget-effort`) is in place.
fn status(path: &Path) -> Result<()> {
    ui::header("8sync harness gateway — omp model-gateway config");
    println!("  file: {}", path.display());
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    if raw.is_empty() {
        println!();
        ui::warn("not deployed — omp has no 9router provider configured");
        ui::info("run: 8sync harness gateway apply");
        return Ok(());
    }
    let url = provider_field(&raw, GW_PROVIDER, "baseUrl").unwrap_or("(missing)");
    let key = provider_field(&raw, GW_PROVIDER, "apiKey").unwrap_or("(missing)");
    if raw.contains(&format!("{}:", CC_PROVIDER)) {
        ui::warn("legacy 9router-cc (Claude via proxy) provider present — run `gateway apply` to remove it (Anthropic Usage Policy)");
    }
    let n_models = raw.lines().filter(|l| l.trim_start().starts_with("- id:")).count();
    let fixed = raw.contains("anthropic-budget-effort");
    println!();
    println!("  provider : {}", url);
    println!("  apiKey   : {}", mask(key));
    println!("  models   : {}", n_models);
    if fixed {
        println!("  thinking : anthropic-budget-effort present");
    }
    println!();
    ui::info("apply : 8sync harness gateway apply      (re-deploy from bundled template)");
    ui::info("key   : 8sync harness gateway key <KEY>  (rotate the API key in place)");
    ui::info("check : 8sync harness gateway verify     (ping the first gateway model)");
    ui::info("route : 8sync harness model              (which model for code/plan/smol)");
    Ok(())
}

/// Deploy `~/.omp/agent/models.yml` from the embedded template, substituting the
/// API key. Idempotent: identical content is a no-op; a differing file is backed
/// up to `models.yml.bak` before overwrite. Key resolution: `$NINE_ROUTER_KEY`
/// env var first, then the key already in the existing file (preserve on refresh).
fn apply(path: &Path) -> Result<()> {
    let tmpl = assets::read("configs/omp/gateway-models.yml")
        .ok_or_else(|| anyhow::anyhow!("embedded gateway template (configs/omp/gateway-models.yml) missing"))?;

    let preserved = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| provider_field(&raw, GW_PROVIDER, "apiKey").filter(|k| !k.is_empty() && *k != PLACEHOLDER).map(str::to_string));
    let key = std::env::var(ENV_KEY)
        .ok()
        .filter(|s| !s.is_empty())
        .or(preserved)
        .ok_or_else(|| anyhow::anyhow!(
            "no API key: set $NINE_ROUTER_KEY or run `8sync harness gateway key <KEY>` first"
        ))?;
    if key == PLACEHOLDER {
        bail!("resolved key is still the placeholder — set $NINE_ROUTER_KEY");
    }
    reject_anthropic_key(&key)?;

    let rendered = tmpl.replace(PLACEHOLDER, &key);
    let rendered = strip_cc_provider(&rendered).0;
    // Preserve managed provider blocks (local GGUF via `add-local-model`, remote
    // custom models via `add-model`) across a gateway re-deploy — each sentinel
    // block is re-attached under `providers:`.
    let old = std::fs::read_to_string(path).unwrap_or_default();
    let rendered = super::local_model::insert_block(
        &rendered,
        &super::local_model::extract_block(&old).unwrap_or_default(),
    );
    let mut rendered = super::local_model::insert_block(
        &rendered,
        &super::custom_model::extract_block(&old).unwrap_or_default(),
    );

    // Keep providers we do not manage (e.g. `anthropic`); drop only 9router-cc.
    for name in provider_names(&old) {
        if name == CC_PROVIDER || name == GW_PROVIDER || provider_names(&rendered).contains(&name) {
            continue;
        }
        if let Some(b) = provider_block(&old, &name) {
            rendered = append_provider(&rendered, b.trim_end_matches('\n'));
            ui::info(&format!("preserved provider `{name}` from the existing models.yml"));
        }
    }

    rendered = keep_top_level_extras(&old, &rendered);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if path.exists() {
        let old = std::fs::read_to_string(path).unwrap_or_default();
        if strip_cc_provider(&old).1 {
            ui::warn("removed provider `9router-cc` (Claude via third-party proxy) from models.yml: it routes Claude outside Claude Code/Console API, which Anthropic's Usage Policy (\"Do Not Abuse Our Platform\") forbids. Use `8sync harness claude-code` with a Console API key.");
        }
        if old == rendered {
            ui::ok(&format!("gateway config already up to date → {}", path.display()));
            return Ok(());
        }
        let bak = path.with_extension("yml.bak");
        std::fs::write(&bak, &old).ok();
        ui::info(&format!("backed up existing config → {}", bak.display()));
    }
    std::fs::write(path, &rendered)?;
    ui::ok(&format!("deployed omp gateway config → {}", path.display()));
    ui::info("verify: 8sync harness gateway verify");
    Ok(())
}

/// Rotate just the API key in an already-deployed config (the `apiKey:` of the
/// `9router-cx` provider only), preserving comments, layout and other providers. Creates the file from the template if absent.
fn set_key(path: &Path, key: &str) -> Result<()> {
    reject_anthropic_key(key)?;
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    if provider_block(&raw, GW_PROVIDER).is_some() {
        std::fs::write(path, set_provider_field(&raw, GW_PROVIDER, "apiKey", key))?;
        ui::ok(&format!("API key updated → {}", path.display()));
        Ok(())
    } else if path.exists() && !raw.trim().is_empty() {
        // File exists without our block: append it, keep every other provider.
        let tmpl = assets::read("configs/omp/gateway-models.yml")
            .ok_or_else(|| anyhow::anyhow!("embedded gateway template (configs/omp/gateway-models.yml) missing"))?;
        let block = provider_block(&tmpl, GW_PROVIDER)
            .ok_or_else(|| anyhow::anyhow!("template has no {GW_PROVIDER} block"))?;
        let out = append_provider(&raw, block.trim_end_matches('\n'));
        std::fs::write(path.with_extension("yml.bak"), &raw).ok();
        std::fs::write(path, set_provider_field(&out, GW_PROVIDER, "apiKey", key))?;
        ui::ok(&format!("added {GW_PROVIDER} provider with the new key → {}", path.display()));
        Ok(())
    } else {
        // No config yet: create it from the template with this key.
        std::env::set_var(ENV_KEY, key);
        apply(path)
    }
}

/// Ping the gateway through the first model with a 1-token OpenAI-style request.
/// The auth header goes via stdin so the key stays out of the process list.
fn verify(path: &Path) -> Result<()> {
    let raw = std::fs::read_to_string(path)
        .ok()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("no gateway config — run `8sync harness gateway apply` first"))?;
    let url = provider_field(&raw, GW_PROVIDER, "baseUrl").ok_or_else(|| anyhow::anyhow!("baseUrl not found in {}", path.display()))?;
    let key = provider_field(&raw, GW_PROVIDER, "apiKey").ok_or_else(|| anyhow::anyhow!("apiKey not found in {}", path.display()))?;
    reject_anthropic_key(key)?;
    let Some(model) = verify_model(&raw) else {
        ui::warn("verify skipped: no non-Claude model found to test (Claude is never routed through the gateway)");
        return Ok(());
    };

    ui::header(&format!("8sync harness gateway verify — pinging {}", model));
    let endpoint = format!("{}/chat/completions", url.trim_end_matches('/'));
    let body = format!(
        "{{\"model\":\"{}\",\"max_tokens\":16,\"messages\":[{{\"role\":\"user\",\"content\":\"hi\"}}]}}",
        model
    );
    // curl appends the HTTP code on its own line via -w.
    use std::io::Write;
    use std::process::Stdio;
    let mut child = Command::new("curl")
        .args([
            "-sS", "-m", "30", "-w", "\n%{http_code}",
            "-H", "@-",
            "-H", "content-type: application/json",
            "-d", &body,
            &endpoint,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()?;
    if let Some(mut si) = child.stdin.take() {
        let _ = writeln!(si, "Authorization: Bearer {}", key);
    }
    let out = child.wait_with_output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let (body_txt, code) = match text.rfind('\n') {
        Some(i) => (text[..i].to_string(), text[i + 1..].trim().to_string()),
        None => (text.to_string(), String::from("?")),
    };
    match code.as_str() {
        "200" => {
            ui::ok(&format!("gateway healthy — {} → HTTP 200", model));
            Ok(())
        }
        c => {
            ui::warn(&format!("gateway returned HTTP {}", c));
            // Show a compact slice of the error so the cause is visible.
            let snip: String = body_txt.chars().take(240).collect();
            println!("  {}", snip);
            bail!("gateway verify failed (HTTP {})", c);
        }
    }
}

/// The model to verify with: the first non-Claude model id (`cc/` and `claude`
/// ids are never used).
fn verify_model(raw: &str) -> Option<String> {
    raw.lines().find_map(|line| {
        let t = line.trim_start();
        let v = t.strip_prefix("- id:").or_else(|| t.strip_prefix("id:"))?;
        let id = v.trim().trim_matches('"');
        (!id.starts_with("cc/") && !id.to_ascii_lowercase().contains("claude")).then(|| id.to_string())
    })
}

/// Mask a secret for display (`…` + last 4, char-safe).
fn mask(k: &str) -> String {
    super::claude_code::mask_token(k)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_template_has_no_claude_proxy() {
        let t = assets::read("configs/omp/gateway-models.yml").unwrap();
        assert!(!t.contains("cc/"));
        assert!(!t.contains("9router-cc"));
        assert!(!t.to_lowercase().contains("masquerad"));
    }

    #[test]
    fn strips_cc_block_keeps_others() {
        let raw = "providers:\n  9router-cc:\n    baseUrl: https://x/v1\n    models:\n      - id: cc/claude-a\n\n  9router-cx:\n    baseUrl: https://x/v1\n    models:\n      - id: cx/gpt-5.5\n";
        let (out, removed) = strip_cc_provider(raw);
        assert!(removed);
        assert!(!out.contains("cc/") && !out.contains("9router-cc"));
        assert!(out.contains("9router-cx:") && out.contains("cx/gpt-5.5"));
        assert!(out.ends_with('\n'));
        let (same, removed2) = strip_cc_provider(&out);
        assert!(!removed2);
        assert_eq!(same, out);
    }

    #[test]
    fn opt_in_only_for_one() {
        assert!(opted_in(Some("1")));
        assert!(!opted_in(None));
        assert!(!opted_in(Some("")));
        assert!(!opted_in(Some("true")));
    }

    #[test]
    fn verify_model_skips_claude() {
        let raw = "- id: cc/claude-sonnet-5\n- id: cx/gpt-5.5\n";
        assert_eq!(verify_model(raw).as_deref(), Some("cx/gpt-5.5"));
        assert_eq!(verify_model("- id: cc/claude-x\n"), None);
    }

    const MIXED: &str = "providers:\n  anthropic:\n    baseUrl: https://api.anthropic.com\n    apiKey: sk-ant-api03-test\n    models:\n      - id: claude-x\n\n  9router-cx:\n    baseUrl: https://9router.example/v1\n    apiKey: nr-test\n    models:\n      - id: cx/gpt-5.5\n        apiKey: nested\n";

    #[test]
    fn fields_are_block_scoped() {
        assert_eq!(provider_field(MIXED, "9router-cx", "apiKey"), Some("nr-test"));
        assert_eq!(provider_field(MIXED, "9router-cx", "baseUrl"), Some("https://9router.example/v1"));
        assert_eq!(provider_field(MIXED, "anthropic", "apiKey"), Some("sk-ant-api03-test"));
        assert_eq!(provider_field(MIXED, "nope", "apiKey"), None);
        assert!(!provider_block(MIXED, "anthropic").unwrap().contains("9router"));
    }

    #[test]
    fn set_provider_field_leaves_other_blocks() {
        let out = set_provider_field(MIXED, "9router-cx", "apiKey", "nr-new");
        assert_eq!(provider_field(&out, "9router-cx", "apiKey"), Some("nr-new"));
        assert_eq!(provider_field(&out, "anthropic", "apiKey"), Some("sk-ant-api03-test"));
        assert!(out.contains("        apiKey: nested"));
        assert_eq!(out.ends_with('\n'), MIXED.ends_with('\n'));
    }

    #[test]
    fn set_key_file_keeps_anthropic_key_and_refuses_sk_ant() {
        let dir = std::env::temp_dir().join(format!("gw-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("models.yml");
        std::fs::write(&p, MIXED).unwrap();
        assert!(set_key(&p, "sk-ant-api03-test").is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), MIXED);
        set_key(&p, "nr-new").unwrap();
        let out = std::fs::read_to_string(&p).unwrap();
        assert_eq!(provider_field(&out, "anthropic", "apiKey"), Some("sk-ant-api03-test"));
        assert_eq!(provider_field(&out, "9router-cx", "apiKey"), Some("nr-new"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn reject_anthropic_key_only_sk_ant() {
        assert!(reject_anthropic_key("sk-ant-api03-test").is_err());
        assert!(reject_anthropic_key("nr-test").is_ok());
    }

    const ONLY_ANTHROPIC: &str = "providers:\n  anthropic:\n    baseUrl: https://api.anthropic.com\n    apiKey: sk-ant-api03-test\n    models:\n      - id: claude-x\n";

    #[test]
    fn key_appends_block_when_missing_and_keeps_anthropic() {
        let dir = std::env::temp_dir().join(format!("gw-append-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("models.yml");
        std::fs::write(&p, ONLY_ANTHROPIC).unwrap();
        set_key(&p, "nr-new").unwrap();
        let out = std::fs::read_to_string(&p).unwrap();
        assert_eq!(provider_field(&out, "anthropic", "apiKey"), Some("sk-ant-api03-test"));
        assert_eq!(provider_field(&out, "9router-cx", "apiKey"), Some("nr-new"));
        assert!(out.starts_with(ONLY_ANTHROPIC));
        assert_eq!(provider_names(&out), vec!["anthropic", "9router-cx"]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_preserves_unmanaged_providers() {
        let dir = std::env::temp_dir().join(format!("gw-apply-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("models.yml");
        std::fs::write(&p, ONLY_ANTHROPIC).unwrap();
        std::env::set_var(ENV_KEY, "nr-apply");
        apply(&p).unwrap();
        let out = std::fs::read_to_string(&p).unwrap();
        assert_eq!(provider_field(&out, "anthropic", "apiKey"), Some("sk-ant-api03-test"));
        assert_eq!(provider_field(&out, "9router-cx", "apiKey"), Some("nr-apply"));
        assert!(dir.join("models.yml.bak").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn provider_header_may_carry_comment() {
        let raw = "providers:\n  9router-cx: # managed\n    apiKey: a\n  other:\n    apiKey: b\n";
        assert_eq!(provider_field(raw, "9router-cx", "apiKey"), Some("a"));
        assert!(!provider_block(raw, "9router-cx").unwrap().contains("other"));
    }

    #[test]
    fn block_stops_at_sentinel_and_apply_keeps_single_section() {
        let (bg, en) = (super::super::custom_model::BLOCK_BEGIN, super::super::custom_model::BLOCK_END);
        let raw = format!("providers:\n  9router-cx:\n    apiKey: nr-sent\n  anthropic:\n    apiKey: sk-ant-api03-test\n    models:\n      - id: claude-x\n  # comment\n{bg}\n  my-prov:\n    baseUrl: https://m.example/v1\n{en}\n");
        let b = provider_block(&raw, "anthropic").unwrap();
        assert!(!b.contains(">>>") && !b.contains("my-prov") && !b.contains("# comment"));
        assert!(b.ends_with("claude-x\n"));
        let dir = std::env::temp_dir().join(format!("gw-sent-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("models.yml");
        std::fs::write(&p, &raw).unwrap();
        apply(&p).unwrap();
        let out = std::fs::read_to_string(&p).unwrap();
        assert_eq!(out.matches("# >>> 8sync:custom-models").count(), 1);
        assert_eq!(out.matches("# <<< 8sync:custom-models").count(), 1);
        assert!(out.contains("my-prov:") && out.contains("https://m.example/v1"));
        assert_eq!(provider_field(&out, "anthropic", "apiKey"), Some("sk-ant-api03-test"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn top_level_extras_kept() {
        let out = keep_top_level_extras("modelRoles:\n  default: a\nproviders:\n  x:\n    y: 1\n", "providers:\n  z:\n");
        assert!(out.contains("modelRoles:\n  default: a\n"));
        assert_eq!(out.matches("providers:").count(), 1);
    }

    #[test]
    fn mask_is_char_safe() {
        assert_eq!(mask("nr-abcdef1234"), "…1234");
        assert_eq!(mask("é0123456789"), "…6789");
        assert_eq!(mask("ab"), "…");
    }

    #[test]
    fn strip_cc_header_with_comment() {
        let (out, removed) = strip_cc_provider("providers:\n  9router-cc: # old\n    baseUrl: x\n  keep:\n    a: 1\n");
        assert!(removed && !out.contains("9router-cc") && out.contains("keep:"));
    }
}
