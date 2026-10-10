//! Named Feynman sessions with omp's authenticated chat catalog.
//! Feynman retains its agent, tools and `/model` picker; a managed Pi extension
//! sends canonical contexts to `omp auth-gateway stdio`, keeping newer protocols
//! and OAuth refresh in omp. No model IDs or provider transports are hardcoded.
//! The sidecar tracks exact managed config values so user edits survive sync/off.
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use clap::Args as ClapArgs;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::env_detect::Env;
use crate::ui;
/// Sidecar recording bridge-owned config values (no credential material).
const MANAGED: &str = ".8sync-omp.json";

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync feynman core        create or resume the 'core' Feynman research session
      8sync feynman             resume latest session in this repo (or sync auth if none)
      8sync feynman ls          list Feynman sessions in this repo
      8sync feynman rm <name>   remove a Feynman session
      8sync feynman new <name>  create a new Feynman session
      8sync feynman auth-omp    sync authenticated omp models and install the native bridge
      8sync feynman status      show bridged providers and current project sessions
      8sync feynman off         remove only unmodified omp-managed config entries

    WHAT IT DOES
      Manages per-project named Feynman research sessions (`feynman --session-dir`)
      and syncs authenticated omp chat models on every launch. Inference uses omp's
      native gateway; change models with Feynman's existing /model command.
"})]
pub struct Args {
    /// Subcommand (`auth-omp`, `status`, `off`, `ls`, `rm <name>`, `new <name>`, `model ...`, `doctor`),
    /// or a bare session name (e.g. `core`) to create-or-resume. Empty = resume latest.
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub rest: Vec<String>,
}

pub fn run(a: Args) -> Result<()> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("cannot resolve home directory"))?;
    let agent_dir = home.join(".feynman/agent");
    let env = Env::detect()?;
    let cwd = std::env::current_dir().context("no cwd")?;
    let root = crate::verbs::here::detect_project_root(&cwd).unwrap_or(cwd.clone());

    let (verb, rest) = a
        .rest
        .split_first()
        .map(|(v, r)| (v.as_str(), r))
        .unwrap_or(("", &[][..]));

    match verb {
        "auth-omp" | "auth" | "sync" => auth_omp(&agent_dir),
        "status" => status(&agent_dir, &env, &root),
        "off" | "remove" | "clear" => off(&agent_dir),
        "ls" | "list" => cmd_ls(&env, &root),
        "rm" => {
            let name = rest.first().context("usage: 8sync feynman rm <name>")?;
            cmd_rm(&env, &root, name)
        }
        "new" => {
            let name = rest.first().context("usage: 8sync feynman new <name>")?;
            let extra: Vec<String> = rest.iter().skip(1).cloned().collect();
            resume_named(&env, &root, name, &agent_dir, true, &extra)
        }
        "" => {
            let kdir = feynman_key_dir(&env, &root);
            let reg = load_registry(&kdir);
            if let Some(name) = reg.last_used.clone() {
                ui::header("8sync feynman");
                ui::info(&format!("project: {}", root.display()));
                resume_named(&env, &root, &name, &agent_dir, false, &[])
            } else {
                auth_omp(&agent_dir)?;
                ui::info(&format!("project: {}", root.display()));
                ui::info("no Feynman session yet in this repo — create one with: 8sync feynman <name>");
                Ok(())
            }
        }
        "model" | "doctor" | "setup" | "alpha" | "search" | "chat" | "update" | "packages"
        | "audit" | "autoresearch" | "compare" | "deepresearch" | "draft" | "lit" | "replicate"
        | "review" | "watch" => {
            auth_omp(&agent_dir)?;
            run_feynman_passthrough(&root, &a.rest)
        }
        v if v.starts_with('-') => {
            auth_omp(&agent_dir)?;
            run_feynman_passthrough(&root, &a.rest)
        }
        name => {
            ui::header("8sync feynman");
            ui::info(&format!("project: {}", root.display()));
            let extra: Vec<String> = rest.to_vec();
            resume_named(&env, &root, name, &agent_dir, false, &extra)
        }
    }
}

fn pi_model(row: &Value) -> Result<Value> {
    let id = row.get("id").and_then(Value::as_str).context("model missing id")?;
    let mut model = Map::new();
    model.insert("id".into(), Value::String(id.into()));
    model.insert("api".into(), Value::String("8sync-omp".into()));
    for key in ["name", "reasoning", "input", "cost", "contextWindow", "maxTokens"] {
        // omp uses null for unknown limits; Pi accepts omitted limits, not null.
        if let Some(value) = row.get(key).filter(|value| !value.is_null()) {
            model.insert(key.into(), value.clone());
        }
    }
    Ok(Value::Object(model))
}

fn bash_escape(value: &str) -> std::borrow::Cow<'_, str> {
    if value.contains('\'') {
        std::borrow::Cow::Owned(value.replace('\'', "'\\''"))
    } else {
        std::borrow::Cow::Borrowed(value)
    }
}

fn auth_omp(agent_dir: &Path) -> Result<()> {
    let omp_bin = which::which("omp")
        .map_err(|_| anyhow!("omp not found on PATH - run `8sync setup` first"))?;
    let command_path = omp_bin.to_string_lossy();
    #[cfg(windows)]
    let command_path = command_path.replace('\\', "/");
    let omp_pi_agent_dir = std::env::var("PI_CODING_AGENT_DIR").ok();
    let credential_env = match omp_pi_agent_dir.as_deref() {
        Some(dir) => std::borrow::Cow::Owned(format!("PI_CODING_AGENT_DIR='{}'", bash_escape(dir))),
        None => std::borrow::Cow::Borrowed("-u PI_CODING_AGENT_DIR"),
    };
    let output = Command::new(&omp_bin).args(["models", "--json"]).output()
        .context("export omp model catalog")?;
    anyhow::ensure!(output.status.success(), "omp models --json failed");
    let catalog: Value = serde_json::from_slice(&output.stdout).context("parse omp model catalog")?;
    let rows = catalog.get("models").and_then(Value::as_array)
        .context("omp models --json did not return a models array")?;
    let mut models = Map::new();
    for row in rows {
        let provider = row.get("provider").and_then(Value::as_str).context("model missing provider")?;
        if row.get("kind").and_then(Value::as_str).unwrap_or("chat") != "chat" {
            continue;
        }
        models.entry(provider.to_string()).or_insert_with(|| serde_json::json!({
            "baseUrl": "stdio://omp",
            "apiKey": format!("!env {} '{}' token '{}' --raw", credential_env, bash_escape(&command_path), bash_escape(provider)),
            "models": []
        })).get_mut("models").and_then(Value::as_array_mut).unwrap().push(pi_model(row)?);
    }
    anyhow::ensure!(!models.is_empty(), "omp has no authenticated chat models; authenticate with `/login` first");
    std::fs::create_dir_all(agent_dir)?;
    let side_path = agent_dir.join(MANAGED);
    let previous = read_json_object(&side_path)?;
    let models_path = agent_dir.join("models.json");
    let mut config = read_json_object(&models_path)?;
    let providers = config.entry("providers").or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut().context("models.json providers must be an object")?;
    remove_managed_models(providers, previous.get("models").and_then(Value::as_object));
    let mut owned = Map::new();
    let mut count = 0;
    for (provider, additions) in &models {
        let config = providers.entry(provider.clone()).or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut().with_context(|| format!("models.json provider {provider} must be an object"))?;
        let mut managed = Map::new();
        for key in ["baseUrl", "apiKey"] {
            let old = previous.get("models").and_then(|m| m.get(provider)).and_then(|p| p.get(key));
            if !config.contains_key(key) || old.is_some_and(|value| config.get(key) == Some(value)) {
                config.insert(key.into(), additions[key].clone());
                managed.insert(key.into(), additions[key].clone());
            }
        }
        let current = config.entry("models").or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut().with_context(|| format!("models.json {provider}.models must be an array"))?;
        let mut inserted = Vec::new();
        for model in additions["models"].as_array().unwrap() {
            if !current.iter().any(|m| m.get("id") == model.get("id")) {
                current.push(model.clone());
                inserted.push(model.clone());
                count += 1;
            }
        }
        managed.insert("models".into(), Value::Array(inserted));
        owned.insert(provider.clone(), Value::Object(managed));
    }
    // Replace legacy copied credentials with live vault lookups, without
    // overwriting credentials for providers the old bridge did not own.
    let auth_path = agent_dir.join("auth.json");
    let mut auth = read_json_object(&auth_path)?;
    let mut owned_auth = Map::new();
    let previous_auth = previous.get("auth").and_then(Value::as_object);
    let legacy = if previous_auth.is_none() { read_managed(&side_path) } else { Vec::new() };
    for (provider, _) in &models {
        let unchanged = previous_auth.and_then(|m| m.get(provider))
            .map(|old| auth.get(provider) == Some(old)).unwrap_or(false);
        if !auth.contains_key(provider) || unchanged || legacy.contains(provider) {
            let credential = serde_json::json!({ "type": "api_key", "key": models[provider]["apiKey"] });
            auth.insert(provider.clone(), credential.clone());
            owned_auth.insert(provider.clone(), credential);
        }
    }
    if let Some(old) = previous_auth {
        for (provider, credential) in old {
            if !models.contains_key(provider) && auth.get(provider) == Some(credential) {
                auth.remove(provider);
            }
        }
    }
    let extension = agent_dir.join(".8sync/omp-extension.mjs");
    let source = crate::assets::read("extensions/feynman-omp.mjs").context("embedded Feynman bridge missing")?;
    std::fs::create_dir_all(extension.parent().unwrap())?;
    write_if_changed(&extension, source.as_bytes())?;
    let settings_path = agent_dir.join("settings.json");
    let mut settings = read_json_object(&settings_path)?;
    #[cfg(windows)]
    let owned_shell = {
        let mut owned = previous.get("shellSetting")
            .filter(|value| !value.is_null() && settings.get("shellPath") == Some(*value)).cloned();
        if !settings.contains_key("shellPath") || owned.is_some() {
            // Pi otherwise finds the WSL bash stub on PATH, which cannot run vault lookups.
            let git = which::which("git").context("Git for Windows is required for Feynman's Bash commands")?;
            let output = Command::new(git).arg("--exec-path").output().context("locate Git Bash")?;
            anyhow::ensure!(output.status.success(), "git --exec-path failed");
            let exec_path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
            let bash = exec_path.ancestors().nth(3).map(|root| root.join("bin/bash.exe"))
                .filter(|path| path.is_file()).context("Git Bash not found beside git --exec-path")?;
            let value = Value::String(bash.to_string_lossy().into_owned());
            settings.insert("shellPath".into(), value.clone());
            owned = Some(value);
        }
        owned
    };
    #[cfg(not(windows))]
    let owned_shell: Option<Value> = None;
    let extensions = settings.entry("extensions").or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut().context("settings.json extensions must be an array")?;
    let extension_value = Value::String(extension.to_string_lossy().into_owned());
    let mut owned_extension = previous.get("extensionSetting").filter(|v| *v == &extension_value).cloned();
    if !extensions.contains(&extension_value) {
        extensions.push(extension_value.clone());
        owned_extension = Some(extension_value);
    }
    write_if_changed(&settings_path, &serde_json::to_vec_pretty(&settings)?)?;
    write_if_changed(&models_path, &serde_json::to_vec_pretty(&config)?)?;
    write_if_changed(&auth_path, &serde_json::to_vec_pretty(&auth)?)?;
    set_600(&auth_path);
    let managed: Vec<&String> = models.keys().collect();
    write_if_changed(&side_path, &serde_json::to_vec_pretty(&serde_json::json!({
        "providers": managed, "models": owned, "auth": owned_auth, "extensionSetting": owned_extension,
        "ompBin": omp_bin, "shellSetting": owned_shell, "ompPiAgentDir": omp_pi_agent_dir
    }))?)?;
    ui::ok(&format!("synced {count} available omp chat model(s), {} configured provider(s); change with /model", models.len()));
    Ok(())
}

fn read_json_object(path: &Path) -> Result<Map<String, Value>> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).with_context(|| format!("invalid JSON object: {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(error).with_context(|| format!("read {}", path.display())),
    }
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> Result<()> {
    if std::fs::read(path).ok().as_deref() != Some(bytes) {
        std::fs::write(path, bytes).with_context(|| format!("write {}", path.display()))?;
    }
    Ok(())
}

fn remove_managed_models(providers: &mut Map<String, Value>, previous: Option<&Map<String, Value>>) {
    if let Some(previous) = previous {
        for (provider, owned) in previous {
            if let Some(current) = providers.get_mut(provider).and_then(Value::as_object_mut) {
                if let (Some(models), Some(old)) = (
                    current.get_mut("models").and_then(Value::as_array_mut),
                    owned.get("models").and_then(Value::as_array),
                ) {
                    models.retain(|model| !old.contains(model));
                    if models.is_empty() {
                        current.remove("models");
                    }
                }
                let retained_models = current.get("models").and_then(Value::as_array)
                    .is_some_and(|models| !models.is_empty());
                for key in ["baseUrl", "apiKey"] {
                    if !retained_models && owned.get(key).is_some() && current.get(key) == owned.get(key) {
                        current.remove(key);
                    }
                }
                if current.is_empty() {
                    providers.remove(provider);
                }
            }
        }
    }
}

fn status(agent_dir: &Path, env: &Env, root: &Path) -> Result<()> {
    ui::header("8sync feynman - status");
    let managed = read_managed(&agent_dir.join(MANAGED));
    if managed.is_empty() {
        ui::info("no omp-managed providers recorded. Run `8sync feynman auth-omp`.");
    } else {
        for p in &managed {
            ui::ok(&format!("bridged from omp: {p}"));
        }
    }
    if which::which("feynman").is_ok() {
        ui::info("live check: `feynman model list`");
    }
    let kdir = feynman_key_dir(env, root);
    let reg = load_registry(&kdir);
    if !reg.sessions.is_empty() {
        println!();
        ui::info(&format!("sessions in {}:", root.display()));
        let n = now();
        for s in &reg.sessions {
            let is_latest = reg.last_used.as_deref() == Some(&s.name);
            let star = if is_latest { "★ " } else { "  " };
            println!("  {}{:<16}  last active: {:<12}", star, s.name, ago(s.last_active, n));
        }
    }
    Ok(())
}

// ── session management ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Default)]
struct FeynmanRegistry {
    last_used: Option<String>,
    sessions: Vec<FeynmanSession>,
}

#[derive(Serialize, Deserialize, Clone)]
struct FeynmanSession {
    name: String,
    session_dir: PathBuf,
    created: u64,
    last_active: u64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn project_key(root: &Path) -> String {
    let s = root.to_string_lossy();
    let key: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if key.len() <= 120 {
        return key;
    }
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("h{:016x}", h.finish())
}

fn feynman_key_dir(env: &Env, root: &Path) -> PathBuf {
    env.xdg_config.join("8sync").join("feynman-sessions").join(project_key(root))
}

fn load_registry(kdir: &Path) -> FeynmanRegistry {
    std::fs::read_to_string(kdir.join("index.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_registry(kdir: &Path, reg: &FeynmanRegistry) -> Result<()> {
    std::fs::create_dir_all(kdir).with_context(|| format!("mkdir {}", kdir.display()))?;
    let json = serde_json::to_string_pretty(reg)?;
    std::fs::write(kdir.join("index.json"), json).context("write feynman session index")?;
    Ok(())
}

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn ago(secs: u64, now: u64) -> String {
    let d = now.saturating_sub(secs);
    match d {
        0..=59 => format!("{d}s ago"),
        60..=3599 => format!("{}m ago", d / 60),
        3600..=86_399 => format!("{}h ago", d / 3600),
        _ => format!("{}d ago", d / 86_400),
    }
}
#[cfg(windows)]
fn ensure_feynman_windows_esm_patch(feynman_bin: &Path) {
    if let Some(bin_dir) = feynman_bin.parent() {
        let launch_js = bin_dir.join("node_modules/@companion-ai/feynman/dist/pi/launch.js");
        if launch_js.exists() {
            if let Ok(code) = std::fs::read_to_string(&launch_js) {
                if !code.contains("pathToFileURL") {
                    let patched = code
                        .replace(
                            "import { existsSync } from \"node:fs\";",
                            "import { existsSync } from \"node:fs\";\nimport { pathToFileURL } from \"node:url\";",
                        )
                        .replace(
                            "const importArgs = useDevPolyfill\n        ? [\"--import\", tsxLoaderPath, \"--import\", promisePolyfillSourcePath]\n        : [\"--import\", promisePolyfillPath];",
                            "const toUrl = (p) => pathToFileURL(p).href;\n    const importArgs = useDevPolyfill\n        ? [\"--import\", toUrl(tsxLoaderPath), \"--import\", toUrl(promisePolyfillSourcePath)]\n        : [\"--import\", toUrl(promisePolyfillPath)];",
                        );
                    let _ = std::fs::write(&launch_js, patched);
                }
            }
        }
        let subagents_paths = [
            bin_dir.join("node_modules/@companion-ai/feynman/.feynman/npm/node_modules/pi-subagents/src/extension/index.js"),
            dirs::home_dir().map(|h| h.join(".feynman/npm-global/node_modules/pi-subagents/src/extension/index.js")).unwrap_or_default(),
        ];
        for p in subagents_paths {
            if p.exists() {
                if let Ok(code) = std::fs::read_to_string(&p) {
                    let target = "if (!event.systemPromptOptions.selectedTools.includes(\"subagent\"))";
                    let replacement = "if (!event.systemPromptOptions?.selectedTools?.includes(\"subagent\"))";
                    if code.contains(target) {
                        let _ = std::fs::write(&p, code.replace(target, replacement));
                    }
                }
            }
        }
        // Feynman's Pi 0.62 key parser drops modifiers it cannot detect, so pi-btw's
        // default `super+/` shortcut matched a bare "/" and swallowed every slash command.
        let tui_keys = [
            bin_dir.join("node_modules/@companion-ai/feynman/node_modules/@mariozechner/pi-tui/dist/keys.js"),
            bin_dir.join("node_modules/@companion-ai/feynman/.feynman/npm/node_modules/@mariozechner/pi-tui/dist/keys.js"),
        ];
        let target = "    if (!key)\n        return null;\n    return {\n        key,\n        ctrl: parts.includes(\"ctrl\"),";
        let replacement = "    if (!key)\n        return null;\n    if (parts.slice(0, -1).some((part) => part !== \"ctrl\" && part !== \"shift\" && part !== \"alt\"))\n        return null;\n    return {\n        key,\n        ctrl: parts.includes(\"ctrl\"),";
        for p in tui_keys {
            if let Ok(code) = std::fs::read_to_string(&p) {
                if code.contains(target) {
                    let _ = std::fs::write(&p, code.replacen(target, replacement, 1));
                }
            }
        }
        // Repair only the truncating renderer variant; older Pi copies deliberately
        // throw on overflow and must retain that behavior.
        let tui_renderers = [
            bin_dir.join("node_modules/@companion-ai/feynman/node_modules/@mariozechner/pi-tui/dist/tui.js"),
            bin_dir.join("node_modules/@companion-ai/feynman/.feynman/npm/node_modules/@mariozechner/pi-tui/dist/tui.js"),
        ];
        let immutable_overflow = "const line = newLines[i];\n            const isImage = isImageLine(line);\n            if (!isImage && visibleWidth(line) > width) {\n                line = truncateToWidth(line, width);";
        let mutable_overflow = "let line = newLines[i];\n            const isImage = isImageLine(line);\n            if (!isImage && visibleWidth(line) > width) {\n                line = truncateToWidth(line, width);";
        for p in tui_renderers {
            if let Ok(code) = std::fs::read_to_string(&p) {
                if !code.contains("line = truncateToWidth(line, width);") {
                    continue;
                }
                let mut patched = code.replacen(immutable_overflow, mutable_overflow, 1);
                if let Some(import_line) = code.lines().find(|line| {
                    line.starts_with("import {")
                        && line.ends_with("from \"./utils.js\";")
                        && !line.contains("truncateToWidth")
                }) {
                    let replacement = import_line.replacen("import {", "import { truncateToWidth,", 1);
                    patched = patched.replacen(import_line, &replacement, 1);
                }
                if patched != code {
                    let _ = std::fs::write(&p, patched);
                }
            }
        }
    }
}

fn get_feynman_runner(feynman_bin: &Path) -> (PathBuf, Vec<String>) {
    #[cfg(windows)]
    {
        if let Some(bin_dir) = feynman_bin.parent() {
            let feynman_js = bin_dir.join("node_modules/@companion-ai/feynman/bin/feynman.js");
            if feynman_js.exists() {
                if let Ok(node_bin) = which::which("node") {
                    return (node_bin, vec![feynman_js.to_string_lossy().to_string()]);
                }
            }
        }
        (PathBuf::from("cmd"), vec!["/C".into(), feynman_bin.to_string_lossy().to_string()])
    }
    #[cfg(not(windows))]
    {
        (feynman_bin.to_path_buf(), Vec::new())
    }
}

fn configure_omp_bridge(cmd: &mut Command, feynman_bin: &Path) -> Result<()> {
    let home = dirs::home_dir().context("cannot resolve home directory")?;
    let agent_dir = home.join(".feynman/agent");
    let canonical = std::fs::canonicalize(feynman_bin).unwrap_or_else(|_| feynman_bin.to_path_buf());
    let mut candidates = Vec::new();
    if let Some(parent) = feynman_bin.parent() {
        candidates.push(parent.join("node_modules/@companion-ai/feynman/node_modules/@mariozechner/pi-ai/dist/index.js"));
    }
    if let Some(parent) = canonical.parent().and_then(Path::parent) {
        candidates.push(parent.join("node_modules/@mariozechner/pi-ai/dist/index.js"));
    }
    let ai_entry = candidates.into_iter().find(|p| p.exists())
        .context("cannot locate Feynman's pi-ai package for the omp bridge")?;
    cmd.env("EIGHTSYNC_OMP_BIN", which::which("omp").context("omp not found")?)
        .env("EIGHTSYNC_FEYNMAN_AI", ai_entry)
        .env("EIGHTSYNC_FEYNMAN_BRIDGE", agent_dir.join(MANAGED));
    Ok(())
}

fn launch_feynman(root: &Path, session_dir: &Path, extra_args: &[String]) -> Result<()> {
    let feynman_bin = which::which("feynman")
        .map_err(|_| anyhow!("feynman not found on PATH (install: curl -fsSL https://feynman.is/install | bash)"))?;
    #[cfg(windows)]
    ensure_feynman_windows_esm_patch(&feynman_bin);
    std::fs::create_dir_all(session_dir)?;
    ui::info(&format!("feynman --cwd {} --session-dir {}", root.display(), session_dir.display()));
    let (runner, prefix_args) = get_feynman_runner(&feynman_bin);
    let mut cmd = Command::new(&runner);
    for arg in prefix_args {
        cmd.arg(arg);
    }
    configure_omp_bridge(&mut cmd, &feynman_bin)?;
    cmd.arg("--cwd")
        .arg(root)
        .arg("--session-dir")
        .arg(session_dir);
    for arg in extra_args {
        cmd.arg(arg);
    }
    let status = cmd
        .current_dir(root)
        .status()
        .context("could not exec feynman")?;
    if !status.success() {
        ui::warn("feynman exited non-zero");
    }
    Ok(())
}

fn run_feynman_passthrough(root: &Path, args: &[String]) -> Result<()> {
    let feynman_bin = which::which("feynman")
        .map_err(|_| anyhow!("feynman not found on PATH (install: curl -fsSL https://feynman.is/install | bash)"))?;
    #[cfg(windows)]
    ensure_feynman_windows_esm_patch(&feynman_bin);
    let (runner, prefix_args) = get_feynman_runner(&feynman_bin);
    let mut cmd = Command::new(&runner);
    for arg in prefix_args {
        cmd.arg(arg);
    }
    for arg in args {
        cmd.arg(arg);
    }
    if args.first().map(|a| a.as_str()) != Some("model") {
        configure_omp_bridge(&mut cmd, &feynman_bin)?;
    }
    let status = cmd
        .current_dir(root)
        .status()
        .context("could not exec feynman")?;
    if !status.success() {
        ui::warn("feynman exited non-zero");
    }
    Ok(())
}


fn cmd_ls(env: &Env, root: &Path) -> Result<()> {
    let kdir = feynman_key_dir(env, root);
    let reg = load_registry(&kdir);
    ui::header("8sync feynman sessions");
    ui::info(&format!("project: {}", root.display()));
    if reg.sessions.is_empty() {
        ui::info("no sessions yet — create one with `8sync feynman <name>`");
        return Ok(());
    }
    let n = now();
    for s in &reg.sessions {
        let is_latest = reg.last_used.as_deref() == Some(&s.name);
        let star = if is_latest { "★ " } else { "  " };
        println!(
            "{}{:<16}  last active: {:<12}  dir: {}",
            star,
            s.name,
            ago(s.last_active, n),
            s.session_dir.display()
        );
    }
    Ok(())
}

fn cmd_rm(env: &Env, root: &Path, name: &str) -> Result<()> {
    let kdir = feynman_key_dir(env, root);
    let mut reg = load_registry(&kdir);
    let idx = reg.sessions.iter().position(|s| s.name == name);
    match idx {
        Some(i) => {
            let s = reg.sessions.remove(i);
            if reg.last_used.as_deref() == Some(name) {
                reg.last_used = reg.sessions.last().map(|x| x.name.clone());
            }
            save_registry(&kdir, &reg)?;
            if s.session_dir.exists() {
                let _ = std::fs::remove_dir_all(&s.session_dir);
            }
            ui::ok(&format!("removed session '{name}'"));
        }
        None => {
            ui::warn(&format!("no session '{name}' found"));
        }
    }
    Ok(())
}

fn resume_named(
    env: &Env,
    root: &Path,
    name: &str,
    agent_dir: &Path,
    refuse_existing: bool,
    extra_args: &[String],
) -> Result<()> {
    if !valid_name(name) {
        anyhow::bail!("invalid session name '{name}' (use letters, digits, '-', '_', '.'; ≤64 chars)");
    }
    auth_omp(agent_dir)?;

    let kdir = feynman_key_dir(env, root);
    let mut reg = load_registry(&kdir);
    let session_dir = kdir.join(name);
    let t = now();

    let exists = reg.sessions.iter().any(|s| s.name == name);
    if refuse_existing && exists {
        anyhow::bail!("session '{name}' already exists — resume with `8sync feynman {name}`");
    }

    if let Some(s) = reg.sessions.iter_mut().find(|s| s.name == name) {
        s.last_active = t;
        let sdir = s.session_dir.clone();
        reg.last_used = Some(name.to_string());
        save_registry(&kdir, &reg)?;
        ui::ok(&format!("→ resume session '{name}'"));
        launch_feynman(root, &sdir, extra_args)
    } else {
        std::fs::create_dir_all(&session_dir)?;
        reg.sessions.push(FeynmanSession {
            name: name.to_string(),
            session_dir: session_dir.clone(),
            created: t,
            last_active: t,
        });
        reg.last_used = Some(name.to_string());
        save_registry(&kdir, &reg)?;
        ui::ok(&format!("created session '{name}'"));
        launch_feynman(root, &session_dir, extra_args)
    }
}

fn off(agent_dir: &Path) -> Result<()> {
    ui::header("8sync feynman - off");
    let side = agent_dir.join(MANAGED);
    let previous = read_json_object(&side)?;
    if previous.is_empty() {
        ui::info("nothing to remove (no omp-managed config recorded).");
        return Ok(());
    }
    let models_path = agent_dir.join("models.json");
    let mut models = read_json_object(&models_path)?;
    if let Some(providers) = models.get_mut("providers").and_then(Value::as_object_mut) {
        remove_managed_models(providers, previous.get("models").and_then(Value::as_object));
    }
    let auth_path = agent_dir.join("auth.json");
    let mut auth = read_json_object(&auth_path)?;
    if let Some(owned) = previous.get("auth").and_then(Value::as_object) {
        for (provider, credential) in owned {
            if auth.get(provider) == Some(credential) {
                auth.remove(provider);
            }
        }
    } else {
        for provider in read_managed(&side) {
            auth.remove(&provider);
        }
    }
    let settings_path = agent_dir.join("settings.json");
    let mut settings = read_json_object(&settings_path)?;
    if let (Some(owned), Some(extensions)) = (
        previous.get("extensionSetting").filter(|v| !v.is_null()),
        settings.get_mut("extensions").and_then(Value::as_array_mut),
    ) {
        extensions.retain(|extension| extension != owned);
    }
    if previous.get("shellSetting").filter(|v| !v.is_null())
        .is_some_and(|owned| settings.get("shellPath") == Some(owned)) {
        settings.remove("shellPath");
    }
    write_if_changed(&settings_path, &serde_json::to_vec_pretty(&settings)?)?;
    write_if_changed(&models_path, &serde_json::to_vec_pretty(&models)?)?;
    write_if_changed(&auth_path, &serde_json::to_vec_pretty(&auth)?)?;
    set_600(&auth_path);
    std::fs::remove_file(&side)?;
    let extension = agent_dir.join(".8sync/omp-extension.mjs");
    if extension.exists() {
        std::fs::remove_file(extension)?;
    }
    ui::ok("removed unmodified omp-managed models and vault lookups; user credentials/settings preserved");
    Ok(())
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
    fn unknown_model_limits_are_omitted_instead_of_invalidating_pi_catalog() {
        let unknown = pi_model(&serde_json::json!({
            "id": "unknown-limits", "contextWindow": null, "maxTokens": null
        })).unwrap();
        assert!(unknown.get("contextWindow").is_none());
        assert!(unknown.get("maxTokens").is_none());
        let known = pi_model(&serde_json::json!({
            "id": "known-limits", "contextWindow": 200000, "maxTokens": 32000
        })).unwrap();
        assert_eq!(known["contextWindow"], 200000);
        assert_eq!(known["maxTokens"], 32000);
    }

    #[test]
    fn removing_managed_models_preserves_user_edits_and_unrelated_providers() {
        let mut providers = serde_json::json!({
            "anthropic": {
                "baseUrl": "https://user.example",
                "apiKey": "!omp token anthropic --raw",
                "models": [
                    {"id": "old", "contextWindow": 100},
                    {"id": "edited", "contextWindow": 999},
                    {"id": "user"}
                ]
            },
            "custom": {"baseUrl": "https://custom.example"}
        }).as_object().unwrap().clone();
        let owned = serde_json::json!({
            "anthropic": {
                "baseUrl": "stdio://omp",
                "apiKey": "!omp token anthropic --raw",
                "models": [
                    {"id": "old", "contextWindow": 100},
                    {"id": "edited", "contextWindow": 100}
                ]
            }
        });
        remove_managed_models(&mut providers, owned.as_object());
        assert_eq!(Value::Object(providers), serde_json::json!({
            "anthropic": {
                "baseUrl": "https://user.example",
                "apiKey": "!omp token anthropic --raw",
                "models": [
                    {"id": "edited", "contextWindow": 999},
                    {"id": "user"}
                ]
            },
            "custom": {"baseUrl": "https://custom.example"}
        }));
    }

    #[test]
    fn removing_managed_models_removes_only_empty_owned_provider() {
        let owned = serde_json::json!({
            "cursor": {"baseUrl": "stdio://omp", "apiKey": "!omp token cursor --raw", "models": [{"id": "chat"}]}
        });
        let mut providers = owned.as_object().unwrap().clone();
        providers.insert("other".into(), serde_json::json!({"models": [{"id": "mine"}]}));
        remove_managed_models(&mut providers, owned.as_object());
        assert_eq!(Value::Object(providers), serde_json::json!({"other": {"models": [{"id": "mine"}]}}));
    }
    #[test]
    fn test_valid_name() {
        assert!(valid_name("core"));
        assert!(valid_name("team-1"));
        assert!(valid_name("research_v2"));
        assert!(!valid_name(""));
        assert!(!valid_name("."));
        assert!(!valid_name(".."));
        assert!(!valid_name("bad/slash"));
        assert!(!valid_name("bad\\backslash"));
    }
}
