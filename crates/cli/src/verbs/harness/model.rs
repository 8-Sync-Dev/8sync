//! `8sync harness model` — view / edit the adaptive-model config.
//!
//! Two layers, one command:
//!   • `~/.config/8sync/models.toml` — 8sync's own per-task routing (which model
//!     `8sync ai`/`8sync .`/`/auto` steer omp toward).
//!   • `~/.omp/agent/config.yml` `modelRoles` — omp's OWN role routing (the
//!     `/model` picker: default·smol·slow·vision·plan·designer·commit·tiny·task·
//!     advisor + `task.agentModelOverrides.reviewer`). This is what actually
//!     drives every omp session.
//!
//! The **combo preset** `8sync harness model <strong>+<cheap>` (e.g.
//! `claude+glm`, or `model=claude+glm`) sets ALL roles across two providers in
//! one shot — the optimal split: the cheap model does the mechanical bulk
//! (default/task/smol/tiny/commit/advisor), the strong model does the thinking
//! (vision/slow high · plan/designer/reviewer xhigh). Keeps both layers in sync.
use anyhow::Result;

use crate::{assets, env_detect, ui};

const ROLE_KEYS: &[&str] = &["default", "plan", "smol", "slow"];

pub(crate) fn harness_model(env: &env_detect::Env, args: &[String]) -> Result<()> {
    let path = env.xdg_config.join(crate::brand::NS).join("models.toml");
    let omp_cfg = env.home.join(".omp/agent/config.yml");
    // Seed the user file from the embedded default on first touch.
    if !path.exists() {
        if let (Some(def), Some(parent)) = (assets::read("configs/models.toml"), path.parent()) {
            std::fs::create_dir_all(parent)?;
            std::fs::write(&path, def)?;
        }
    }

    // Combo preset: `harness model claude+glm` (or `model=claude+glm`).
    if args.len() == 1 && args[0].contains('+') {
        return apply_combo(&path, &omp_cfg, &args[0]);
    }

    // Set mode: `harness model <key> <value>` (single 8sync-routing key).
    if args.len() >= 2 {
        let key = args[0].trim().to_string();
        let val = args[1..].join(" ").trim().to_string();
        let section = if ROLE_KEYS.contains(&key.as_str()) { "roles" } else { "tasks" };
        set_model_toml(&path, section, &key, &val)?;
        ui::ok(&format!("set [{}].{} = \"{}\" → {}", section, key, val, path.display()));
        ui::info("re-run `8sync harness model` to view; takes effect on the next `8sync ai`/`8sync .`/`/auto`.");
        return Ok(());
    }

    // View mode.
    ui::header("8sync harness model — adaptive model routing");
    let cfg = crate::models::ModelConfig::load();
    let shown = |s: &str| if s.is_empty() { "(omp default)".to_string() } else { s.to_string() };
    println!("  8sync config: {}", path.display());
    println!();
    println!("  [roles]  (8sync → omp --plan/--smol/--slow + main)");
    println!("   default = {}", shown(&cfg.roles.default));
    println!("   plan    = {}", shown(&cfg.roles.plan));
    println!("   smol    = {}", shown(&cfg.roles.smol));
    println!("   slow    = {}", shown(&cfg.roles.slow));
    println!();
    println!("  [tasks]  (per-prompt class → model)");
    if cfg.tasks.is_empty() {
        println!("   (none — falls back to roles.default)");
    } else {
        for (k, v) in &cfg.tasks {
            println!("   {:<8} = {}", k, shown(v));
        }
    }
    println!();
    print_omp_roles(&omp_cfg);
    ui::info("combo: 8sync harness model claude+glm   (set ALL omp roles: opus=thinking, glm=mechanical)");
    ui::info("aliases: claude|opus → anthropic/claude-opus-5-5 · sonnet → sonnet-5-5 · glm|zai → zai/glm-5.3-flash");
    ui::info("one role: 8sync harness model <default|plan|smol|slow | review|debug|code|trivial> <model>");
    Ok(())
}

/// Apply a two-model preset across every omp role + the 8sync routing layer.
/// `combo` = `<strong>+<cheap>` (e.g. `claude+glm`). Strong carries the thinking
/// roles (xhigh on plan/designer/reviewer); cheap carries the mechanical bulk.
fn apply_combo(toml_path: &std::path::Path, omp_cfg: &std::path::Path, combo: &str) -> Result<()> {
    let (a, b) = combo.split_once('+').unwrap();
    let (strong, cheap) = (resolve_alias(a.trim()), resolve_alias(b.trim()));
    if strong.is_empty() || cheap.is_empty() {
        anyhow::bail!("combo must be <strong>+<cheap>, e.g. claude+glm");
    }

    // omp modelRoles — the optimal split. `high` general, `xhigh` on the three
    // roles the strong model must nail (plan/designer/reviewer), `minimal` on the
    // cheap micro-roles (titles/commit/tiny). advisor stays bare (frequent → cheap).
    let roles: Vec<(&str, String)> = vec![
        ("default", format!("{cheap}:high")),
        ("task", format!("{cheap}:high")),
        ("smol", format!("{cheap}:minimal")),
        ("tiny", format!("{cheap}:minimal")),
        ("commit", format!("{cheap}:minimal")),
        ("advisor", cheap.clone()),
        ("vision", vision_role_for_combo(&strong, &cheap)),
        ("slow", format!("{strong}:high")),
        ("plan", format!("{strong}:xhigh")),
        ("designer", format!("{strong}:xhigh")),
    ];
    let reviewer = format!("{strong}:xhigh");
    apply_omp_roles(omp_cfg, &roles, &reviewer)?;

    // Keep 8sync's own routing (models.toml) consistent with the split.
    let (s, c) = (short_name(&strong), short_name(&cheap));
    for (k, v) in [("default", &c), ("plan", &s), ("smol", &c), ("slow", &s)] {
        set_model_toml(toml_path, "roles", k, v)?;
    }
    for (k, v) in [("plan", &s), ("review", &s), ("debug", &s), ("code", &c), ("trivial", &c)] {
        set_model_toml(toml_path, "tasks", k, v)?;
    }

    ui::ok(&format!("applied combo: strong={strong}  cheap={cheap}"));
    println!();
    println!("  omp modelRoles → {}", omp_cfg.display());
    for (k, v) in &roles {
        println!("   {:<9} = {}", k, v);
    }
    println!("   {:<9} = {}   (task.agentModelOverrides)", "reviewer", reviewer);
    println!();
    println!("  8sync routing → {}", toml_path.display());
    println!("   roles: default={c} plan={s} smol={c} slow={s}");
    println!("   tasks: plan/review/debug={s} · code/trivial={c}");
    println!();
    ui::info("takes effect on the NEXT omp session (start a new `8sync ai`/`8sync .`).");
    ui::info("tweak one role: 8sync harness model plan <model>  ·  view: 8sync harness model");
    Ok(())
}

/// Friendly alias → concrete omp model id. Anything with a `/` is passed through
/// as an explicit id. Unknown bare tokens pass through (omp resolves fuzzily).
fn resolve_alias(tok: &str) -> String {
    if tok.contains('/') {
        return tok.to_string();
    }
    match tok.to_ascii_lowercase().as_str() {
        "claude" | "opus" | "anthropic" => "anthropic/claude-opus-5-5".to_string(),
        "sonnet" => "anthropic/claude-sonnet-5-5".to_string(),
        "haiku" => "anthropic/claude-haiku-5-5".to_string(),
        "fable" | "fable-5-1" | "claude-fable-5-1" => "anthropic/claude-fable-5-1".to_string(),
        "glm" | "zai" | "flash" => "zai/glm-5.3-flash".to_string(),
        "glm-5.3" | "glm53" => "zai/glm-5.3".to_string(),
        other => other.to_string(),
    }
}

/// True when this omp model id can take `image_url` natively (no zai-vision MCP).
/// GLM-5.3 / GLM-5.3-Flash: https://docs.z.ai/guides/vlm/glm-5.3-flash
/// Does **not** match text-only `glm-5.2`.
pub(crate) fn is_native_vlm(id: &str) -> bool {
    let s = id.to_ascii_lowercase();
    s.contains("glm-5.3") || s.contains("glm-4v") || s.contains("glm-5v")
}

fn vision_role_for_combo(strong: &str, cheap: &str) -> String {
    if is_native_vlm(cheap) {
        format!("{cheap}:high")
    } else {
        format!("{strong}:high")
    }
}

/// Short label for the 8sync models.toml layer (omp resolves it fuzzily).
fn short_name(id: &str) -> String {
    let low = id.to_ascii_lowercase();
    for k in ["opus", "sonnet", "haiku", "glm"] {
        if low.contains(k) {
            return k.to_string();
        }
    }
    id.to_string()
}

/// Print the current omp `modelRoles` + reviewer override from config.yml, so
/// the view answers "which model does omp actually use per role?".
fn print_omp_roles(omp_cfg: &std::path::Path) {
    let Ok(raw) = std::fs::read_to_string(omp_cfg) else {
        return;
    };
    println!("  omp modelRoles: {}", omp_cfg.display());
    let mut in_roles = false;
    let mut printed = false;
    for line in raw.lines() {
        let indented = line.starts_with([' ', '\t']);
        if !indented {
            in_roles = line.trim_start().starts_with("modelRoles:");
            continue;
        }
        if in_roles {
            let t = line.trim();
            if !t.is_empty() {
                println!("   {t}");
                printed = true;
            }
        }
        if let Some(rv) = line.trim().strip_prefix("reviewer:") {
            println!("   reviewer:{rv}   (subagent)");
            printed = true;
        }
    }
    if !printed {
        println!("   (none set — omp uses its bundled defaults)");
    }
    println!();
}

/// Rewrite the `modelRoles:` block + `task.agentModelOverrides.reviewer` in an
/// omp `config.yml`, preserving every other key. Line-based (no serde_yaml dep):
/// the file is machine-written and flat, so block replacement is robust and
/// keeps the user's layout for the keys we don't touch.
fn apply_omp_roles(
    omp_cfg: &std::path::Path,
    roles: &[(&str, String)],
    reviewer: &str,
) -> Result<()> {
    if let Some(parent) = omp_cfg.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let raw = std::fs::read_to_string(omp_cfg).unwrap_or_default();
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();

    // Fresh modelRoles block.
    let mut block = vec!["modelRoles:".to_string()];
    for (k, v) in roles {
        block.push(format!("  {k}: {v}"));
    }

    // Replace the existing top-level `modelRoles:` block, else prepend it.
    let start = lines.iter().position(|l| {
        !l.starts_with([' ', '\t']) && l.trim_start().starts_with("modelRoles:")
    });
    match start {
        Some(s) => {
            let mut e = s + 1;
            while e < lines.len() && lines[e].starts_with([' ', '\t']) {
                e += 1;
            }
            lines.splice(s..e, block);
        }
        None => {
            lines.splice(0..0, block);
        }
    }

    // Reviewer subagent override (nested task.agentModelOverrides.reviewer).
    let rline = format!("    reviewer: {reviewer}");
    if let Some(p) = lines
        .iter()
        .position(|l| l.starts_with([' ', '\t']) && l.trim_start().starts_with("reviewer:"))
    {
        lines[p] = rline;
    } else if let Some(tp) = lines
        .iter()
        .position(|l| !l.starts_with([' ', '\t']) && l.trim_start().starts_with("task:"))
    {
        lines.splice(tp + 1..tp + 1, vec!["  agentModelOverrides:".to_string(), rline]);
    } else {
        lines.push("task:".to_string());
        lines.push("  agentModelOverrides:".to_string());
        lines.push(rline);
    }

    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    std::fs::write(omp_cfg, out)?;
    Ok(())
}

/// Set `[section].key = value` in a `models.toml` document, creating the table
/// and section as needed, then write it back. Shared by the CLI set mode and
/// the `harness web` `POST /api/models` handler so both edit the toml identically.
pub(crate) fn set_model_toml(
    path: &std::path::Path,
    section: &str,
    key: &str,
    value: &str,
) -> Result<()> {
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    let mut doc: toml::Value =
        toml::from_str(&raw).unwrap_or_else(|_| toml::Value::Table(Default::default()));
    let tbl = doc
        .as_table_mut()
        .ok_or_else(|| anyhow::anyhow!("models.toml is not a table"))?;
    let sect = tbl
        .entry(section.to_string())
        .or_insert_with(|| toml::Value::Table(Default::default()));
    sect.as_table_mut()
        .ok_or_else(|| anyhow::anyhow!("[{}] is not a table", section))?
        .insert(key.to_string(), toml::Value::String(value.to_string()));
    std::fs::write(path, toml::to_string(&doc)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glm_alias_is_native_53_flash() {
        assert_eq!(resolve_alias("glm"), "zai/glm-5.3-flash");
        assert_eq!(resolve_alias("zai"), "zai/glm-5.3-flash");
        assert_eq!(resolve_alias("flash"), "zai/glm-5.3-flash");
        assert_eq!(resolve_alias("glm-5.3"), "zai/glm-5.3");
        assert_eq!(resolve_alias("zai/glm-5.2"), "zai/glm-5.2");
    }
    #[test]
    fn fable_alias_resolves_to_claude_fable_5_1() {
        assert_eq!(resolve_alias("fable"), "anthropic/claude-fable-5-1");
        assert_eq!(resolve_alias("fable-5-1"), "anthropic/claude-fable-5-1");
        assert_eq!(resolve_alias("claude-fable-5-1"), "anthropic/claude-fable-5-1");
    }

    #[test]
    fn native_vlm_matches_53_not_52() {
        assert!(is_native_vlm("zai/glm-5.3-flash:high"));
        assert!(is_native_vlm("zai/glm-5.3"));
        assert!(is_native_vlm("GLM-5.3-Flash"));
        assert!(!is_native_vlm("zai/glm-5.2:xhigh"));
        assert!(!is_native_vlm("zai/glm-5.2"));
        assert!(!is_native_vlm("anthropic/claude-opus-5-5"));
    }

    #[test]
    fn combo_vision_stays_on_native_glm() {
        let cheap = resolve_alias("glm");
        let strong = resolve_alias("claude");
        assert_eq!(
            vision_role_for_combo(&strong, &cheap),
            "zai/glm-5.3-flash:high"
        );
        assert_eq!(
            vision_role_for_combo("anthropic/claude-opus-5-5", "zai/glm-5.2"),
            "anthropic/claude-opus-5-5:high"
        );
    }
}
