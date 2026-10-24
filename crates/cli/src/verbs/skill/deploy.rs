//! Bundled-skill deployment (embedded assets → ~/.omp/skills), project mirror,
//! and trail bootstrap. The building blocks `8sync harness init` composes.
use anyhow::Result;
use std::path::Path;
use std::process::Command;

use super::discover::list_installed_skill_dirs;
use crate::{assets, env_detect, ui};

/// Every bundled skill tree: (asset prefix, target subdir name). Always-on first
/// (this is the read order the agent is given), then on-demand specialists, then
/// the research trio. Encore/full-flow are on-demand + tech-gated.
///
/// Module-level so the guard tests can assert BOTH directions against the real
/// data — a fn-local literal can only be text-scraped, and the direction that
/// actually bites (an asset dir nobody registered) needs the list itself.
const BUNDLED_SKILLS: [(&str, &str); 33] = [
    ("skills/trail",                   "trail"),
    ("skills/karpathy-guidelines",     "karpathy-guidelines"),
    ("skills/ponytail",                "ponytail"),
    ("skills/assp-skill",              "assp-skill"),
    ("skills/impeccable",              "impeccable"),
    ("skills/taste-skill",             "taste-skill"),
    ("skills/taste-brutalist",         "taste-brutalist"),
    ("skills/taste-minimalist",        "taste-minimalist"),
    ("skills/taste-soft",              "taste-soft"),
    ("skills/taste-redesign",          "taste-redesign"),
    ("skills/taste-output",            "taste-output"),
    ("skills/8sync-cli",               "8sync-cli"),
    ("skills/image-routing",           "image-routing"),
    ("skills/zai-vision",              "zai-vision"),
    ("skills/locate-anything",         "locate-anything"),
    ("skills/image-gen",               "image-gen"),
    ("skills/code-review-and-quality", "code-review-and-quality"),
    ("skills/senior-security",         "senior-security"),
    ("skills/senior-frontend",         "senior-frontend"),
    ("skills/full-flow",               "full-flow"),
    ("skills/encore-deploy",           "encore-deploy"),
    ("skills/last30days",              "last30days"),
    ("skills/feature",                 "feature"),
    ("skills/branch-sync",             "branch-sync"),
    ("skills/super-pdf",             "super-pdf"),
    ("skills/deep-research",           "deep-research"),
    ("skills/aup-audit",               "aup-audit"),
    ("skills/research-paper",          "research-paper"),
    ("skills/remote-compute",          "remote-compute"),
    // Foundation references (locked): stack-specific, opened on demand.
    ("skills/tauri-v2",                "tauri-v2"),
    ("skills/nextjs-app",              "nextjs-app"),
    ("skills/encore-eino-go",          "encore-eino-go"),
    ("skills/ai-microservice-design",  "ai-microservice-design"),
];

/// Deploy every bundled skill tree under `assets/skills/<name>/` into
/// `~/.omp/skills/<name>/`. Each tree is deployed verbatim including any
/// `references/` or `scripts/` subdirs. Shell scripts get mode 0755.
pub(crate) fn install_bundled_global(env: &env_detect::Env) -> Result<()> {
    let skills_dir = env.home.join(".omp/skills");
    for (asset_prefix, name) in BUNDLED_SKILLS {
        let target_dir = skills_dir.join(name);
        std::fs::create_dir_all(&target_dir)?;
        let (written, _unchanged) = assets::install_tree(asset_prefix, &target_dir)?;
        if written > 0 {
            ui::ok(&format!("synced {} ({} file(s) written) → {}", name, written, target_dir.display()));
        }
    }
    Ok(())
}

/// Clean cutover for machines that installed an earlier 8sync: remove the retired
/// `/gs` command + skill (global + project). Idempotent no-op when absent — `/auto`
/// is the single automation entry now.
pub(crate) fn cleanup_legacy_gs(home: &Path, root: Option<&Path>) {
    let _ = std::fs::remove_file(home.join(".omp/agent/commands/gs.md"));
    let _ = std::fs::remove_dir_all(home.join(".omp/skills/gs"));
    if let Some(r) = root {
        let _ = std::fs::remove_file(r.join(".omp/commands/gs.md"));
        let _ = std::fs::remove_dir_all(r.join("su-code/skills/gs"));
    }
}

/// Ensure a skill directory follows the Agent Skills 3-folder layout:
///   <name>/ ├── SKILL.md  ├── scripts/  └── references/
/// Idempotent. Empty dirs are intentional.
pub(crate) fn ensure_skill_layout(dir: &Path) {
    for sub in ["scripts", "references"] {
        let p = dir.join(sub);
        if !p.exists() {
            let _ = std::fs::create_dir_all(&p);
        }
    }
}

/// For every skill dir under `~/.omp/skills/`, create or refresh a copy under
/// `<root>/su-code/skills/<name>/`. Returns the number of skills processed.
pub(crate) fn mirror_global_to_local(home: &Path, root: &Path, force: bool) -> Result<usize> {
    let global_dir = home.join(".omp/skills");
    let local_dir = root.join("su-code/skills");
    std::fs::create_dir_all(&local_dir)?;
    let globals = list_installed_skill_dirs(&global_dir).unwrap_or_default();
    let mut count = 0usize;
    for g in &globals {
        let name = match g.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let local_target = local_dir.join(name);

        // Self-mirror guard: if the global skill is a symlink that resolves to
        // local_target (e.g. `path:` install with cwd == project root), refusing
        // to remove+copy would otherwise WIPE the source. Skip cleanly.
        let g_canon = std::fs::canonicalize(g).ok();
        let l_canon = std::fs::canonicalize(&local_target).ok();
        if let (Some(gc), Some(lc)) = (g_canon.as_ref(), l_canon.as_ref()) {
            if gc == lc {
                ui::skip(
                    &local_target.display().to_string(),
                    "global symlink resolves here (skipped — already source-of-truth)",
                );
                count += 1;
                continue;
            }
        }

        // Additive by default: never clobber an existing (maybe customized) local
        // skill — only vendor missing ones. `--force` re-mirrors everything.
        let existed = local_target.exists();
        if existed && !force {
            ui::skip(&local_target.display().to_string(), "exists (use --force to refresh)");
            count += 1;
            continue;
        }
        if existed {
            let _ = std::fs::remove_dir_all(&local_target);
        }
        copy_dir_recursive(g, &local_target)?;
        ui::ok(&format!(
            "{} → {}",
            if existed { "refreshed" } else { "vendored " },
            local_target.display()
        ));
        count += 1;
    }
    Ok(count)
}

/// Recursively copy `src` into `dst`. Skips `.git/` (vendor copies should not
/// carry the git history of an unrelated repo). Overwrites existing files.
pub(crate) fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == ".git" { continue; }
        let from = entry.path();
        let to = dst.join(&name);
        let ft = entry.file_type()?;
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ft.is_symlink() {
            // Resolve and copy the target as a regular file (keeps vendor copy self-contained).
            if let Ok(target) = std::fs::read_link(&from) {
                let resolved = if target.is_absolute() { target } else { from.parent().map(|p| p.join(&target)).unwrap_or(target) };
                if resolved.is_file() {
                    std::fs::copy(&resolved, &to)?;
                }
            }
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Host adapters that speak the Agent Skills open standard from a *different*
/// project path than `su-code/skills/` (the committed canonical tree):
///   `.cursor/skills/`  — Cursor Agent Skills (project)
///   `.zcode/skills/`   — Z.ai Code
///   `.claude/skills/`  — Claude Code (project skills)
/// Prefer a relative symlink / Windows junction so the trees cannot drift; fall
/// back to a copy when the OS refuses links. Also writes `.cursor/rules/*.mdc`.
pub(crate) fn ensure_host_adapters(home: &Path, root: &Path, force: bool) -> Result<()> {
    let src = root.join("su-code/skills");
    if src.is_dir() {
        for (rel, label) in [(".cursor/skills", "Cursor"), (".zcode/skills", "Z.ai Code"), (".claude/skills", "Claude Code")] {
            // A repo's own committed `.claude/skills/` is not ours to replace, even with --force.
            if rel == ".claude/skills" && !claude_skills_is_ours(root) {
                continue;
            }
            mirror_skill_host(&src, &root.join(rel), label, force)?;
        }
    }
    if src.is_dir() && claude_skills_is_ours(root) {
        super::inject::claude_skill_overrides(home, root)?;
    }
    super::inject::inject_cursor_rule(home, root)?;
    Ok(())
}

/// `.claude/skills/` → `su-code/skills/` for `8sync ccc` launches: links once,
/// silent afterwards. A `.claude/skills/` the repo already has is left alone.
pub(crate) fn ensure_claude_skills(root: &Path) -> Result<()> {
    let (src, dst) = (root.join("su-code/skills"), root.join(".claude/skills"));
    if !src.is_dir() || dst.exists() {
        return Ok(());
    }
    let how = link_or_copy_dir(&src, &dst)?;
    ui::ok(&format!("Claude Code skills → {} ({how})", dst.display()));
    Ok(())
}

/// Whether `.claude/skills/` is 8sync's link to `su-code/skills/` (or absent,
/// about to become one) rather than skills the repo commits itself.
pub(crate) fn claude_skills_is_ours(root: &Path) -> bool {
    let dst = root.join(".claude/skills");
    !dst.exists() || same_dir(&root.join("su-code/skills"), &dst)
}

/// Copy into `su-code/skills/` every global skill the project lacks. Silent
/// and additive: an existing (maybe customised) project skill is never touched.
pub(crate) fn vendor_missing_skills(home: &Path, root: &Path) -> Result<usize> {
    let local_dir = root.join("su-code/skills");
    let mut added = 0;
    for g in list_installed_skill_dirs(&home.join(".omp/skills")).unwrap_or_default() {
        let Some(name) = g.file_name() else { continue };
        let target = local_dir.join(name);
        if !target.exists() {
            copy_dir_recursive(&g, &target)?;
            added += 1;
        }
    }
    if added > 0 {
        ui::ok(&format!("{added} skill(s) vendored → {}", local_dir.display()));
    }
    Ok(added)
}

fn mirror_skill_host(src: &Path, dst: &Path, label: &str, force: bool) -> Result<()> {
    if dst.exists() && !force {
        if same_dir(src, dst) {
            ui::skip(&dst.display().to_string(), "already linked");
            return Ok(());
        }
        ui::skip(
            &dst.display().to_string(),
            "exists (use --force to refresh)",
        );
        return Ok(());
    }
    if dst.exists() {
        remove_link_or_dir(dst)?;
    }
    let how = link_or_copy_dir(src, dst)?;
    ui::ok(&format!("{label} skills → {} ({how})", dst.display()));
    Ok(())
}

fn same_dir(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn remove_link_or_dir(path: &Path) -> Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    // Unlink the name only. Never `remove_dir_all` a junction/symlink — that
    // can walk into `su-code/skills` and delete the canonical tree.
    if meta.file_type().is_symlink() || is_windows_reparse_point(&meta) {
        std::fs::remove_dir(path).or_else(|_| std::fs::remove_file(path))?;
        return Ok(());
    }
    if meta.is_dir() {
        std::fs::remove_dir_all(path)?;
    } else {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

fn is_windows_reparse_point(_meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return _meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

#[cfg(windows)]
fn strip_verbatim(path: &Path) -> String {
    let s = path.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// Both host dirs sit one level under the repo root, so the relative link is
/// always `../su-code/skills`. Hardcoded on purpose — a computed relative path
/// is a bigger function for two known layouts.
fn link_or_copy_dir(src: &Path, dst: &Path) -> Result<&'static str> {
    link_dir(src, dst, &Path::new("..").join("su-code").join("skills"))
}

/// `dst` → `src` as a symlink whose text is `link` (Windows: a junction when
/// symlinks need developer mode), else a copy.
fn link_dir(src: &Path, dst: &Path, link: &Path) -> Result<&'static str> {
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p)?;
    }
    let rel = link;
    #[cfg(unix)]
    {
        let _ = src;
        std::os::unix::fs::symlink(rel, dst)?;
        return Ok("link");
    }
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(rel, dst).is_ok() {
            return Ok("link");
        }
        let abs = std::fs::canonicalize(src)?;
        let out = Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &strip_verbatim(dst),
                &strip_verbatim(&abs),
            ])
            .output()?;
        if out.status.success() {
            return Ok("link");
        }
        copy_dir_recursive(src, dst)?;
        return Ok("copy");
    }
    #[cfg(not(any(unix, windows)))]
    {
        copy_dir_recursive(src, dst)?;
        Ok("copy")
    }
}

/// Claude Code's personal skills dir gets every bundled skill as a link to
/// `~/.omp/skills/<name>`, the copy 8sync refreshes on each update. Personal
/// skills win over project ones, so Claude Code always reads the current
/// bundled skill even where a repo vendored an older copy. An entry that
/// already exists (a kit file, a user's own skill) is left alone.
pub(crate) fn link_bundled_skills(home: &Path, skills_dir: &Path) -> Result<usize> {
    let mut linked = 0;
    // Every skill folder in ~/.omp/skills, not only the ones 8sync ships: omp
    // installs more (frontend-ui-engineering, browser-testing-with-devtools…).
    let omp = home.join(".omp/skills");
    for e in std::fs::read_dir(&omp).into_iter().flatten().flatten() {
        let src = e.path();
        let Some(name) = e.file_name().to_str().map(str::to_string) else { continue };
        if name.starts_with('.') || !src.join("SKILL.md").is_file() {
            continue;
        }
        let dst = skills_dir.join(&name);
        if std::fs::symlink_metadata(&dst).is_err() {
            std::fs::create_dir_all(skills_dir)?;
            link_dir(&src, &dst, &src)?;
            linked += 1;
        }
    }
    Ok(linked)
}

/// Workspace skill libraries the owner registered (`skill_libraries = [..]` in
/// features.toml, written by `8sync ccc kit --skills-from <dir>`): absolute dirs
/// whose children are skill folders, e.g. a workspace's `su-code/skills`.
pub(crate) fn skill_libraries(home: &Path) -> Vec<std::path::PathBuf> {
    let p = crate::verbs::harness::features::features_path(home);
    let Some(t) = std::fs::read_to_string(p).ok().and_then(|s| s.parse::<toml::Table>().ok()) else { return Vec::new() };
    t.get("skill_libraries")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str())
        .map(|s| s.strip_prefix("~/").map_or_else(|| std::path::PathBuf::from(s), |r| home.join(r)))
        .filter(|p| p.is_absolute())
        .collect()
}

/// Records `dir` (canonical) in features.toml; false when it was already there.
pub(crate) fn add_skill_library(home: &Path, dir: &Path) -> Result<bool> {
    let dir = anyhow::Context::with_context(dir.canonicalize(), || format!("{} does not exist", dir.display()))?;
    if !dir.is_dir() || !has_skills(&dir) {
        anyhow::bail!("{} has no <skill>/SKILL.md folders", dir.display());
    }
    if skill_libraries(home).iter().any(|p| p.canonicalize().is_ok_and(|c| c == dir)) {
        return Ok(false);
    }
    let p = crate::verbs::harness::features::features_path(home);
    let mut t = match std::fs::read_to_string(&p) {
        Ok(s) => s.parse::<toml::Table>().map_err(|e| anyhow::anyhow!("{} is not valid TOML ({e}); fix it first", p.display()))?,
        Err(_) => toml::Table::new(),
    };
    let arr = t.entry("skill_libraries").or_insert_with(|| toml::Value::Array(Vec::new()));
    let Some(a) = arr.as_array_mut() else { anyhow::bail!("`skill_libraries` in {} is not an array", p.display()) };
    a.push(toml::Value::String(dir.to_string_lossy().into_owned()));
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(&p, toml::to_string_pretty(&t)?)?;
    Ok(true)
}

fn has_skills(dir: &Path) -> bool {
    std::fs::read_dir(dir).into_iter().flatten().flatten().any(|e| e.path().join("SKILL.md").is_file())
}

/// Links every skill of the registered libraries that Claude Code does not have
/// yet (kit files, bundled links and the owner's own skills always win; nothing
/// is overwritten). Returns how many links were made.
pub(crate) fn link_library_skills(home: &Path, skills_dir: &Path) -> Result<usize> {
    let mut linked = 0;
    for lib in skill_libraries(home) {
        for e in std::fs::read_dir(&lib).into_iter().flatten().flatten() {
            let src = e.path();
            let Some(name) = e.file_name().to_str().map(str::to_string) else { continue };
            if name.starts_with('.') || !src.join("SKILL.md").is_file() {
                continue;
            }
            let dst = skills_dir.join(&name);
            if std::fs::symlink_metadata(&dst).is_err() {
                std::fs::create_dir_all(skills_dir)?;
                link_dir(&src, &dst, &src)?;
                linked += 1;
            }
        }
    }
    Ok(linked)
}

/// Idempotently add an MCP server `name` (stdio `command` + `args`) to omp's user
/// MCP config (`~/.omp/agent/mcp.json`), preserving any servers already there.
fn register_omp_mcp(home: &Path, name: &str, command: &str, args: &[&str], env: &[(&str, &str)]) -> Result<()> {
    let mcp_path = home.join(".omp/agent/mcp.json");
    if let Some(p) = mcp_path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut root: serde_json::Value = std::fs::read_to_string(&mcp_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    if !root.is_object() {
        root = serde_json::json!({});
    }
    let obj = root.as_object_mut().unwrap();
    obj.entry("$schema").or_insert_with(|| {
        serde_json::Value::String(
            "https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/coding-agent/src/config/mcp-schema.json"
                .to_string(),
        )
    });
    let servers = obj.entry("mcpServers").or_insert_with(|| serde_json::json!({}));
    if !servers.is_object() {
        *servers = serde_json::json!({});
    }
    let smap = servers.as_object_mut().unwrap();
    let mut desired = serde_json::json!({ "type": "stdio", "command": command, "args": args });
    // Only emit an `env` key when there are vars — keeps the stored entry for the
    // env-less servers byte-identical (so the equality self-heal check holds).
    if !env.is_empty() {
        let env_obj: serde_json::Map<String, serde_json::Value> = env
            .iter()
            .map(|(k, v)| (k.to_string(), serde_json::Value::String(v.to_string())))
            .collect();
        desired
            .as_object_mut()
            .expect("stdio mcp server is an object")
            .insert("env".into(), serde_json::Value::Object(env_obj));
    }
    if smap.get(name) == Some(&desired) {
        ui::skip(name, "already in omp mcp.json");
        return Ok(());
    }
    // Self-heal: update in place when the command/args changed (e.g. an
    // executable rename) instead of skipping a stale entry.
    let updating = smap.contains_key(name);
    smap.insert(name.to_string(), desired);
    std::fs::write(&mcp_path, serde_json::to_string_pretty(&root)?)?;
    // 0600: this file carries live API keys (the zai-vision server's key lands in
    // its `env` block). `fs::write` creates 0644 under a stock umask, leaving
    // every local account able to read them.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&mcp_path, std::fs::Permissions::from_mode(0o600));
    }
    let verb = if updating { "updated" } else { "registered" };
    ui::ok(&format!("{} {} MCP → {}", verb, name, mcp_path.display()));
    Ok(())
}

/// Best-effort bootstrap of `uv` (Astral's Python tool manager) — the canonical
/// installer for `headroom-ai[mcp]` (`uvx`). User-level curl
/// install (no sudo); lands in `~/.local/bin` (already on PATH). Idempotent.
/// Returns true if `uv` is available afterwards.
fn ensure_uv() -> bool {
    if which::which("uv").is_ok() {
        return true;
    }
    ui::step("uv (missing — bootstrapping Astral uv: powers headroom)");
    let _ = Command::new("sh")
        .arg("-c")
        .arg("curl -fsSL https://astral.sh/uv/install.sh | sh")
        .status();
    which::which("uv").is_ok()
}

/// Remove a stale MCP server from omp's `mcp.json` (e.g. a tool whose binary
/// failed to install) so omp never fails at startup spawning a missing
/// executable. No-op when absent or the file is unreadable.
fn deregister_omp_mcp(home: &Path, name: &str) -> Result<()> {
    let mcp_path = home.join(".omp/agent/mcp.json");
    let Ok(s) = std::fs::read_to_string(&mcp_path) else {
        return Ok(());
    };
    let Ok(mut root) = serde_json::from_str::<serde_json::Value>(&s) else {
        return Ok(());
    };
    let removed = root
        .get_mut("mcpServers")
        .and_then(|v| v.as_object_mut())
        .is_some_and(|m| m.remove(name).is_some());
    if removed {
        std::fs::write(&mcp_path, serde_json::to_string_pretty(&root)?)?;
        ui::warn(&format!(
            "{} not installed — removed its stale MCP entry (omp won't error at startup)",
            name
        ));
    }
    Ok(())
}

/// Ensure `headroom` (context-compression MCP) is installed + registered as an
/// omp MCP server. Headroom compresses long tool outputs / logs / diffs before
/// they reach the model (60–95% fewer tokens) — complements trail.
pub(crate) fn ensure_headroom_mcp(env: &env_detect::Env) -> Result<()> {
    if which::which("headroom").is_err() {
        ui::step("headroom (missing — installing headroom-ai[mcp] via uv)");
        if ensure_uv() {
            let _ = Command::new("uv")
                .args(["tool", "install", "headroom-ai[mcp]"])
                .status();
        }
        // Fallback for boxes with pipx/pip but no uv (e.g. curl bootstrap blocked).
        if which::which("headroom").is_err() {
            let cmd = "if command -v pipx >/dev/null 2>&1; then pipx install 'headroom-ai[mcp]'; \
elif command -v pip >/dev/null 2>&1; then pip install --user 'headroom-ai[mcp]' \
|| pip install --user --break-system-packages 'headroom-ai[mcp]'; fi";
            let _ = Command::new("sh").arg("-c").arg(cmd).status();
        }
    }
    // Register ONLY when the binary exists — never leave a broken MCP entry that
    // makes omp fail at startup. If still missing, purge any stale entry.
    if which::which("headroom").is_ok() {
        let v = env_detect::cmd_version("headroom", &["--version"]).unwrap_or_default();
        ui::ok(&format!("headroom present ({})", v.trim()));
        register_omp_mcp(&env.home, "headroom", "headroom", &["mcp", "serve"], &[])
    } else {
        ui::warn("headroom unavailable — skipped MCP (install `uv`: https://astral.sh/uv, then re-run `8sync harness`)");
        deregister_omp_mcp(&env.home, "headroom")
    }
}

/// Enable omp's local long-term memory (Mnemopi) in the user's omp settings
/// (`~/.omp/agent/config.yml`) so the agent recalls + retains durable project
/// memory across sessions — "deep awareness that never forgets". API-only by
/// design: `llmMode: smol` reuses the configured online model and
/// `noEmbeddings: true` uses full-text recall, so there are NO local model
/// downloads (runs on any machine). Idempotent + non-clobbering: skips if
/// Mnemopi is already configured or the user authored their own `memory:` block.
/// Ensure omp's anti-forget stack in the user's settings (`~/.omp/agent/config.yml`):
/// (1) Mnemopi long-term memory (API-only — no local model), and (2) compaction
/// tuned to fire at 50% context + when idle (snapcompact strategy stays the omp
/// default), so the agent stops forgetting skills/rules/workflow past ~50%.
/// Idempotent sentinel-block; never clobbers a user-authored `memory:` block.
pub(crate) fn ensure_omp_memory_config(home: &Path) -> Result<()> {
    let cfg = home.join(".omp/agent/config.yml");
    if let Some(p) = cfg.parent() { std::fs::create_dir_all(p)?; }
    // omp rewrites/normalizes config.yml and strips comments, so detect by KEY
    // presence (not sentinel markers) and only append top-level keys when absent.
    let mut s = std::fs::read_to_string(&cfg).unwrap_or_default();
    let mut changed = false;
    let has_mnemopi = s.contains("backend: mnemopi");
    let has_memory_key = s.lines().any(|l| l.starts_with("memory:"));
    if has_mnemopi {
        ui::skip("mnemopi memory", "backend already set");
    } else if has_memory_key {
        ui::warn("config.yml has its own `memory:` — left as-is");
    } else {
        s.push_str("\nmemory:\n  backend: mnemopi\nmnemopi:\n  scoping: per-project-tagged\n  llmMode: smol\n  noEmbeddings: true\n  polyphonicRecall: true\n");
        changed = true;
        ui::ok("mnemopi memory enabled (API-only)");
    }
    if s.lines().any(|l| l.starts_with("compaction:")) {
        ui::skip("compaction@50%", "key already present (user-configured)");
    } else {
        s.push_str("\ncompaction:\n  thresholdPercent: 50\n  idleEnabled: true\n");
        changed = true;
        ui::ok("compaction@50% + idle enabled (anti-forget)");
    }
    if changed { std::fs::write(&cfg, s)?; }
    Ok(())
}

/// Which STEP-0 code-intel replacements are actually reachable on THIS machine.
///
/// This is the UC-7 predicate. Every layer that redirects a search to `trail` is
/// installed only while it can answer, and is un-installed again when it cannot — enforcement must never
/// dead-end a box that lacks the replacement. omp cannot express a capability test
/// in a rule `condition:` or an interceptor `pattern`, so the test happens here, at
/// deploy time, which is the only place the capability is observable.
///
/// Mirrors `doctor::check_ai_engines`: `trail` is a plain binary on PATH.
pub(crate) fn code_intel_available(_home: &Path) -> Vec<&'static str> {
    let mut out = Vec::new();
    if crate::verbs::harness::trail::found().is_some() {
        out.push("trail");
    }
    out
}

/// Write the STEP-0 `bashInterceptor` rules into `~/.omp/agent/config.yml` so the
/// agent's `bash` shell-escapes (`rg`, recursive `grep`, `find -name`) on code are
/// BLOCKED — closing the loophole the `--tools` allowlist leaves open (it removes
/// the `grep`/`glob` TOOLS but not `bash rg`).
///
/// omp's real rule shape is `{ pattern, tool, message }` (+ optional `flags`) —
/// read off omp 17.2.9's own default array and its matcher:
/// ```js
/// for (let {rule:p, regex:o} of faf(rules)) {
///   if (!toolNames.includes(p.tool)) continue;   // rule is SKIPPED
///   if (o.test(segment)) return { block:true, message:`Blocked: ${p.message}` };
/// }
/// ```
/// Two consequences drive this implementation:
/// 1. A rule with no `tool` key is skipped unconditionally (`includes(undefined)`
///    is false). Earlier 8sync builds wrote `{ pattern, reason }`, so the
///    interceptor silently blocked NOTHING — verified live: `rg main main.rs` ran.
/// 2. `tool` must name a tool PRESENT in the session. omp's built-in rule for
///    `grep|rg` points at `tool: "grep"`, which STEP-0 removes from the allowlist
///    — so the stock rule disables itself exactly when we need it. Every shipped
///    rule therefore points at `lsp`: always present, and the honest suggestion
///    (code intelligence) for someone reaching for `rg`.
///
/// The rules themselves live in `~/.config/8sync/models.toml` under
/// `[bashInterceptor]` (embedded default when the user file predates the section),
/// so a machine can tune the pattern set without a rebuild. Setting the key
/// REPLACES omp's default array, so that list is the whole guard; single-file and
/// log `grep` stay allowed by construction.
///
/// UC-7 safe degradation: the guard is installed only while this machine has a
/// replacement ([`code_intel_available`]). With none — or with `enabled = false` /
/// an empty pattern list — the block we previously wrote is REMOVED, so `bash`
/// never dead-ends on a box without trail.
///
/// Idempotent. If the user authored their OWN `bashInterceptor:` block, this bails
/// out rather than appending: omp parses config.yml with `Bun.YAML.parse`, which
/// does NOT reject duplicate mapping keys — it takes the LAST one, so appending
/// would silently void every rule the user wrote.
pub(crate) fn ensure_bash_interceptor(home: &Path) -> Result<()> {
    let models = crate::models::ModelConfig::load();
    let bi = &models.bash_interceptor;
    let have = code_intel_available(home);
    let block = (bi.enabled && !bi.patterns.is_empty() && !have.is_empty())
        .then(|| render_interceptor_block(bi));
    let cfg = home.join(".omp/agent/config.yml");
    if let Some(p) = cfg.parent() {
        std::fs::create_dir_all(p)?;
    }
    let mut s = std::fs::read_to_string(&cfg).unwrap_or_default();
    // omp rewrites config.yml in its own style (re-quoting, trailing spaces), so a
    // byte-exact match on what we last wrote does NOT survive a single omp run.
    // Identify OUR block(s) by their `STEP-0` signature and remove them all; any
    // bashInterceptor block WITHOUT that marker is the user's and is kept.
    // Removing every owned copy (then appending one fresh) collapses duplicates
    // regardless of ordering — a leftover second `bashInterceptor:` key makes
    // omp's YAML loader reject the file as a duplicate mapping.
    let owned: Vec<(usize, usize)> = {
        let starts: Vec<usize> = s
            .match_indices("bashInterceptor:")
            .map(|(i, _)| i)
            .filter(|&i| i == 0 || s.as_bytes()[i - 1] == b'\n')
            .collect();
        starts
            .into_iter()
            .map(|start| {
                let rest = &s[start..];
                // Block ends at the next top-level YAML line: anything at column
                // 0 that is NOT an indented continuation (space/tab) — that
                // includes `#` comments, `_underscore`, and quoted keys, so they
                // are not swallowed into the block and deleted on migration.
                let end = rest
                    .match_indices('\n')
                    .find(|(i, _)| {
                        let line = rest[i + 1..].lines().next().unwrap_or("");
                        !line.is_empty() && !line.starts_with([' ', '\t'])
                    })
                    .map(|(i, _)| start + i + 1)
                    .unwrap_or(s.len());
                (start, end)
            })
            .filter(|(start, end)| s[*start..*end].contains("STEP-0"))
            .collect()
    };
    let removed = !owned.is_empty();
    // Remove owned blocks from the end backwards so earlier offsets stay valid.
    for (start, end) in owned.into_iter().rev() {
        s.replace_range(start..end, "");
    }
    // UC-7 / opt-out path: nothing to install. Our block (if any) is already gone;
    // only touch the file when that actually changed something, and say WHY —
    // silence here would read as a bug.
    let Some(block) = block else {
        if removed {
            std::fs::write(&cfg, &s)?;
        }
        if !bi.enabled || bi.patterns.is_empty() {
            ui::skip("bashInterceptor", "no rules in models.toml [bashInterceptor]");
        } else {
            ui::warn(
                "  bashInterceptor OFF: no `trail` on this machine — shell search stays ALLOWED rather than dead-ending (run `8sync trail`, then re-run)",
            );
        }
        return Ok(());
    };
    // A `bashInterceptor:` still standing here is one the USER wrote. omp parses
    // config.yml with `Bun.YAML.parse`, which does not reject duplicate mapping
    // keys — it silently takes the LAST. Appending ours would therefore void
    // every rule they wrote, with no error anywhere. Bail out instead.
    if s.match_indices("bashInterceptor:")
        .any(|(i, _)| i == 0 || s.as_bytes()[i - 1] == b'\n')
    {
        std::fs::write(&cfg, s)?;
        ui::warn(
            "  bashInterceptor: user-authored block present — left untouched (STEP-0 shell guard NOT installed; merge the rules by hand or remove your block)",
        );
        return Ok(());
    }
    // `block` starts with a '\n' and removal leaves the preceding newline, so each
    // run would otherwise gain a blank line. Collapse any trailing blanks first.
    while s.ends_with("\n\n") {
        s.pop();
    }
    // Only separate from EXISTING content — on a fresh machine the file is empty
    // and `block`'s own leading newline is enough.
    if !s.is_empty() && !s.ends_with('\n') {
        s.push('\n');
    }
    s.push_str(&block);
    std::fs::write(&cfg, s)?;
    ui::ok(&format!(
        "bashInterceptor ON (STEP-0): {} rule(s) → trail (present: {})",
        bi.patterns.len(),
        have.join(" · ")
    ));
    Ok(())
}

/// Render `[bashInterceptor]` as an omp `config.yml` block.
///
/// The indented `STEP-0` comment is the OWNERSHIP MARKER: block detection must not
/// depend on `message` text, which the user is invited to edit, and an indented
/// line stays inside the block for the column-0 end scan above.
fn render_interceptor_block(bi: &crate::models::BashInterceptor) -> String {
    let mut out = format!(
        "\nbashInterceptor:\n  # {}:STEP-0 guard — generated from models.toml [bashInterceptor]; edits here are overwritten\n  enabled: true\n  patterns:\n",
        crate::brand::NS
    );
    for r in &bi.patterns {
        out.push_str("    - pattern: ");
        out.push_str(&yaml_sq(&r.pattern));
        out.push_str("\n      tool: ");
        out.push_str(&yaml_sq(&r.tool));
        out.push_str("\n      message: ");
        out.push_str(&yaml_sq(&r.message));
        out.push('\n');
    }
    out
}

/// YAML single-quoted scalar. It is the only style that needs no backslash
/// escaping, which is what makes it safe for regexes; the sole escape is `'` → `''`.
fn yaml_sq(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' {
            out.push('\'');
        }
        out.push(c);
    }
    out.push('\'');
    out
}

/// Deploy every embedded omp rule (`assets/rules/*.md`) to `~/.omp/agent/rules/`
/// and, inside a project, `<repo>/.omp/rules/` — the two native rule sources omp
/// reads. This is the ENFORCED half of tool routing: a rule carrying `condition:` +
/// `scope:` + `interruptMode:` is a TTSR rule, which omp re-evaluates on every
/// stream, so it costs zero prompt tokens and cannot be compacted away (unlike the
/// prose in APPEND_SYSTEM.md, which now carries only routing INTENT).
///
/// Directory-iterated on purpose: adding a rule means dropping a file into
/// `assets/rules/`, never editing this function. Discovery is non-recursive and
/// `.md`/`.mdc`-only, matching omp's own. Rule identity in omp is the NAME, so
/// filenames are namespaced through `brand::ns_file`.
///
/// UC-7: a rule may declare `<!-- 8sync:requires a,b,c -->` and is then deployed
/// only while one of those is available ([`code_intel_available`]); when none is,
/// the deployed copies are REMOVED, so the veto disappears together with the
/// capability. Byte-identical writes stay quiet (`deploy_omp_pair`) so omp's
/// prompt-cache prefix survives a harness run.
pub(crate) fn ensure_rules(home: &Path, root: Option<&Path>) -> Result<()> {
    let have = code_intel_available(home);
    for asset in assets::iter_under("rules/") {
        let name = &asset["rules/".len()..];
        if name.contains('/') || !(name.ends_with(".md") || name.ends_with(".mdc")) {
            continue;
        }
        let Some(raw) = assets::read(&asset) else {
            continue;
        };
        let file = crate::brand::ns_file(name);
        let global_rel = format!(".omp/agent/rules/{}", file);
        let proj_rel = format!(".omp/rules/{}", file);
        if !requirements_met(&raw, &have) {
            let _ = std::fs::remove_file(home.join(&global_rel));
            if let Some(r) = root {
                let _ = std::fs::remove_file(r.join(&proj_rel));
            }
            ui::warn(&format!(
                "  rule {}: required code-intel tools absent — not deployed (search stays unrestricted)",
                name
            ));
            continue;
        }
        deploy_omp_pair(home, root, &asset, &global_rel, &proj_rel, &format!("rule {}", name))?;
    }
    Ok(())
}

/// `<!-- 8sync:requires a,b,c -->` — satisfied when ANY listed capability is
/// available, and vacuously satisfied when the rule declares nothing. Read from the
/// RAW asset (before `brand::render`), so the marker is brand-independent.
///
/// Only a real HTML-comment marker counts: a rule that merely MENTIONS the marker
/// in prose (this one documents its own gate) must not be misread as declaring one.
fn requirements_met(raw: &str, have: &[&str]) -> bool {
    const MARKER: &str = "8sync:requires";
    let mut declared = false;
    for (idx, _) in raw.match_indices(MARKER) {
        if !raw[..idx].trim_end().ends_with("<!--") {
            continue;
        }
        let list = raw[idx + MARKER.len()..].split("-->").next().unwrap_or("");
        for req in list.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            declared = true;
            if have.iter().any(|h| *h == req) {
                return true;
            }
        }
    }
    !declared
}

/// Keep the STEP-0 MCP servers' tools ALWAYS VISIBLE via `mcp.discoveryDefaultServers`
/// in `~/.omp/agent/config.yml`. omp's default `tools.discoveryMode: auto` hides ALL
/// MCP tools behind a `search_tool_bm25` discovery hop once the registry exceeds 40
/// tools — measured effect: headroom 0 calls across 29 sessions. Listing the
/// harness servers keeps their full catalogs in the active tool set (verified in
/// omp 16.4.8: the setting filters discoverable MCP tools by `serverName` and merges
/// them into the session baseline). `tools.essentialOverride` does NOT work for this —
/// omp filters its entries to BUILT-IN tool names only. Key-presence idempotent:
/// never overrides a user-set `discoveryDefaultServers`; migrates away the inert
/// essentialOverride block earlier 8sync builds wrote (exact-match removal only).
pub(crate) fn ensure_mcp_tools_visible(home: &Path) -> Result<()> {
    // omp ≥17 replaced the pre-17 bm25 discovery hop (+ `mcp.discoveryDefaultServers`)
    // with `tools.xdev` (default on): MCP tools mount as `xd://` device URLs, callable
    // via read/write without shipping schemas every request. The old key is obsolete
    // (absent from omp's schema) — writing it is dead weight omp strips on rewrite,
    // which is exactly the churn that made STEP-0 look like it kept "regressing".
    if env_detect::omp_major().is_some_and(|m| m >= 17) {
        ui::ok("STEP-0 MCP tools mounted as xd:// devices (omp ≥17 tools.xdev) — headroom/zai callable, no config key needed");
        return Ok(());
    }
    const SERVERS: &[&str] = &["headroom", "zai-vision"];
    let cfg = home.join(".omp/agent/config.yml");
    if let Some(p) = cfg.parent() { std::fs::create_dir_all(p)?; }
    let mut s = std::fs::read_to_string(&cfg).unwrap_or_default();
    if s.contains("discoveryDefaultServers") {
        ui::skip("STEP-0 MCP visibility", "mcp.discoveryDefaultServers already set (user-configured)");
        return Ok(());
    }
    let list: String = SERVERS.iter().map(|t| format!("    - {t}\n")).collect();
    if s.lines().any(|l| l.starts_with("mcp:")) {
        // Insert under the existing top-level `mcp:` block (same approach as
        // compaction::set_threshold).
        s = s
            .lines()
            .map(|l| {
                if l.starts_with("mcp:") {
                    format!("{l}\n  discoveryDefaultServers:\n{}", list.trim_end())
                } else {
                    l.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        if !s.ends_with('\n') {
            s.push('\n');
        }
    } else {
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(&format!("\nmcp:\n  discoveryDefaultServers:\n{list}"));
    }
    std::fs::write(&cfg, s)?;
    ui::ok("STEP-0 MCP servers always visible (mcp.discoveryDefaultServers) — headroom/zai callable, no search_tool_bm25 hop");
    Ok(())
}

/// Deploy the anti-forget recall hook to `~/.omp/hooks/pre/8sync-recall.ts`.
/// The hook injects a lean ref bundle (skill index + live STATE) at every
/// `before_agent_start` and into every compaction summary, so the agent keeps
/// the skill/rule/workflow index fresh even past 50% context / compaction.
/// Idempotent: skipped if the deployed file is byte-identical to the asset.
pub(crate) fn ensure_recall_hook(home: &Path) -> Result<()> {
    let dir = home.join(".omp/hooks/pre");
    std::fs::create_dir_all(&dir)?;
    let target = dir.join(crate::brand::ns_file("recall.ts"));
    let Some(body) = assets::read("hooks/8sync-recall.ts") else { return Ok(()); };
    if std::fs::read(&target).ok().as_deref() == Some(body.as_bytes()) {
        ui::skip("recall hook", "already deployed");
        return Ok(());
    }
    std::fs::write(&target, body.as_bytes())?;
    ui::ok(&format!("recall hook → {}", target.display()));
    Ok(())
}

/// Deploy the always-apply operating directives to `~/.omp/agent/APPEND_SYSTEM.md`.
/// omp appends this verbatim to EVERY system prompt (never compacts away), so the
/// code-intel-first rule + always-on skill manifest are read on every turn — the
/// fix for "skills/rules are defined but the agent ignores them past ~50% context".
/// Idempotent (byte-identical skip); appended, so omp's base prompt is preserved.
pub(crate) fn ensure_append_system(home: &Path) -> Result<()> {
    let Some(body) = assets::read("configs/omp/APPEND_SYSTEM.md") else {
        return Ok(());
    };
    let body = crate::brand::render(&body).into_owned();
    let target = home.join(".omp/agent/APPEND_SYSTEM.md");
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    if std::fs::read_to_string(&target).ok().as_deref() == Some(body.as_str()) {
        ui::skip("APPEND_SYSTEM.md", "already deployed");
        return Ok(());
    }
    std::fs::write(&target, &body)?;
    ui::ok(&format!("always-on directives → {}", target.display()));
    Ok(())
}

/// Deploy the bundled MCP `server.json` standard spec to `~/.omp/specs/` so it's
/// present on the machine by default — the on-disk ground truth every omp session
/// follows when writing/reasoning about `mcp.json`. APPEND_SYSTEM points here.
/// Idempotent (byte-identical skip).
pub(crate) fn ensure_mcp_spec(home: &Path) -> Result<()> {
    let Some(body) = assets::read("specs/mcp-server.md") else {
        return Ok(());
    };
    let body = crate::brand::render(&body).into_owned();
    let target = home.join(".omp/specs/mcp-server.md");
    if let Some(p) = target.parent() {
        std::fs::create_dir_all(p)?;
    }
    if std::fs::read_to_string(&target).ok().as_deref() == Some(body.as_str()) {
        ui::skip("mcp-server.md", "spec already deployed");
        return Ok(());
    }
    std::fs::write(&target, &body)?;
    ui::ok(&format!("MCP standard spec → {}", target.display()));
    Ok(())
}

/// Resolve the Z.AI API key for the vision MCP. Prefer an explicit env var
/// (`Z_AI_API_KEY` / `ZAI_API_KEY` / `ZHIPUAI_API_KEY`); otherwise pull it from
/// omp's auth-broker via `omp token zai` — the SAME key that auths `zai/glm-5.2`.
/// Returns None only when neither source yields a plausible key; the caller then
/// still registers the server (tools discovered) but without auth.
fn resolve_zai_api_key() -> Option<String> {
    for var in ["Z_AI_API_KEY", "ZAI_API_KEY", "ZHIPUAI_API_KEY"] {
        if let Ok(v) = std::env::var(var) {
            if v.len() >= 12 {
                return Some(v);
            }
        }
    }
    // omp auth-broker holds the provider key (provider id `zai`, matching the
    // `zai/glm-5.2` model role). `omp token zai` prints just the key on stdout.
    if let Ok(out) = Command::new("omp").args(["token", "zai"]).output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.len() >= 12 && !s.contains(' ') && !s.contains('\n') {
                return Some(s);
            }
        }
    }
    None
}

/// Ensure the **Z.AI vision MCP** (`@z_ai/mcp-server`) is installed + registered.
/// **Fallback only:** GLM-5.3 / GLM-5.3-Flash are native VLMs and must read
/// `image_url` in-session (https://docs.z.ai/guides/vlm/glm-5.3-flash). This MCP
/// exists for **text-only GLM-5.2** sessions: it exposes GLM-5V tools
/// (`ui_to_artifact`, `extract_text_from_screenshot`, …) authed by the SAME Z.AI
/// key. Defaults `Z_AI_VISION_MODEL` to `glm-4.6v-flash` (free-tier sidecar).
/// Installs via `bun add -g`; falls back to `bunx`. Never bails.
pub(crate) fn ensure_zai_vision_mcp(env: &env_detect::Env) -> Result<()> {
    // 1. Install the package so `zai-mcp-server` is on PATH (preferred over a
    //    per-connect `bunx` cold-start). bun is omnipresent in the omp stack.
    if which::which("zai-mcp-server").is_err() && which::which("bun").is_ok() {
        ui::step("z.ai vision MCP (missing — installing @z_ai/mcp-server via bun)");
        let _ = Command::new("bun").args(["add", "-g", "@z_ai/mcp-server"]).status();
    }
    let (command, args): (String, Vec<String>) = if which::which("zai-mcp-server").is_ok() {
        ("zai-mcp-server".to_string(), Vec::new())
    } else if which::which("bunx").is_ok() {
        ("bunx".to_string(), vec!["@z_ai/mcp-server".to_string()])
    } else {
        ui::warn("z.ai vision MCP: needs `bun` (https://bun.sh) — skipped; text-only GLM-5.2 has no sidecar (GLM-5.3 still reads images natively)");
        return deregister_omp_mcp(&env.home, "zai-vision");
    };
    // 2. Auth: same Z.AI key that auths `zai/glm-5.2`. Declared at fn scope so the
    //    borrow in env_vars outlives the register_omp_mcp call.
    let key = resolve_zai_api_key();
    let key_str = key.clone().unwrap_or_default();
    let mut env_vars: Vec<(&str, &str)> = vec![("Z_AI_MODE", "ZAI"), ("Z_AI_VISION_MODEL", "glm-4.6v-flash")];
    if key.is_some() {
        env_vars.push(("Z_AI_API_KEY", key_str.as_str()));
    } else {
        ui::warn("z.ai vision MCP: no Z_AI_API_KEY (env nor `omp token zai`) — registered WITHOUT auth; set it in ~/.omp/agent/mcp.json");
    }
    // 3. Register. omp's stringMap takes no ${VAR} expansion, so the key is
    //    inlined into mcp.json (user-private, never committed; gitignored).
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    register_omp_mcp(&env.home, "zai-vision", &command, &args_ref, &env_vars)?;
    ui::ok("z.ai vision MCP registered as GLM-5.2 fallback only — GLM-5.3 / 5.3-Flash look at images in-session (do not call this MCP)");
    Ok(())
}

/// Exact tool catalogs for the MCP servers `8sync harness` auto-registers.
/// Static (spawning each server just to list tools would slow every `harness`
/// run) but kept in sync with the pinned tool sets this harness installs —
/// this is what `ensure_omp_capabilities_snapshot` embeds verbatim so the
/// agent gets EXACT tool names instead of guessing/hallucinating them (the
/// tool-name hallucination bug in KNOWLEDGE.md is exactly what this
/// prevents). Unknown/user-added servers get no catalog — the snapshot says so.
fn known_mcp_tool_catalog(server: &str) -> &'static [(&'static str, &'static str)] {
    match server {
        "headroom" => &[
            ("headroom_compress", "compress >~50-line output BEFORE it enters context (60-95% fewer tokens)"),
            ("headroom_retrieve", "fetch the original uncompressed content back by its hash"),
            ("headroom_stats", "this session's compression stats (tokens/cost saved)"),
        ],
        "zai-vision" => &[
            ("ui_to_artifact", "UI screenshot -> frontend code / AI prompt / design spec / description"),
            ("extract_text_from_screenshot", "OCR: code, terminal output, logs, docs (language hint optional)"),
            ("diagnose_error_screenshot", "root-cause an error/stack-trace screenshot -> fix"),
            ("understand_technical_diagram", "architecture/flowchart/UML/ER/sequence diagrams -> text"),
            ("analyze_data_visualization", "charts/graphs -> trends, anomalies, business read"),
            ("ui_diff_check", "visual regression: compare expected vs actual UI screenshots"),
            ("analyze_image", "general-purpose FALLBACK when no specialized tool above fits"),
            ("analyze_video", "video content understanding (uses `video_source` not `image_source`)"),
        ],
        _ => &[],
    }
}

/// Capture a manifest of omp's LIVE capability surface (version + key flags +
/// registered MCP servers + installed skills) to `~/.omp/capabilities.md` so the
/// agent (and `doctor`) know what omp actually offers this session — refreshed
/// every `8sync harness` run. This is the "read omp's README on every update"
/// step: omp is a binary, so we discover its surface from `omp --help` + the
/// config dirs. Surfaces the high-value flags the harness wants maximised:
/// `--advisor`, `--thinking`, `inspect_image`, the `--smol`/`--slow`/`--plan`
/// model roles, and retain/recall (Mnemopi).
pub(crate) fn ensure_omp_capabilities_snapshot(home: &Path) -> Result<()> {
    let omp_ver = env_detect::cmd_version("omp", &["--version"]).unwrap_or_default();
    let help = Command::new("omp")
        .arg("--help")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    let has = |flag: &str| help.contains(flag);
    let flags: [(&str, bool); 5] = [
        ("--advisor (passive turn reviewer)", has("--advisor")),
        ("--thinking (reasoning effort)", has("--thinking")),
        ("inspect_image (built-in vision tool)", help.contains("inspect_image")),
        ("--smol / --slow / --plan (adaptive models)", has("--smol")),
        ("--skills (force-load discovery)", has("--skills")),
    ];
    // Parse the "Available Tools" block straight out of `omp --help` — this is
    // omp's OWN base tool set (read/bash/edit/write/grep/glob/lsp/browser/…),
    // distinct from the MCP servers below. Parsed (not hardcoded) so it tracks
    // whatever this installed omp version actually ships.
    let builtin_tools: Vec<(String, String)> = {
        let mut out = Vec::new();
        let mut in_section = false;
        for line in help.lines() {
            if line.trim_start().starts_with("Available Tools") {
                in_section = true;
                continue;
            }
            if !in_section {
                continue;
            }
            if line.trim().is_empty() || !line.starts_with("  ") {
                break;
            }
            if let Some((name, desc)) = line.trim().split_once('-') {
                out.push((name.trim().to_string(), desc.trim().to_string()));
            }
        }
        out
    };
    let mem_on = std::fs::read_to_string(home.join(".omp/agent/config.yml"))
        .unwrap_or_default()
        .contains("backend: mnemopi");
    // Mnemopi's memory tools are added to the agent's tool set dynamically when
    // `memory.backend: mnemopi` is configured — they don't show up in the
    // static `omp --help` (which reflects the tool-less default), so they're
    // pinned here instead, gated on `mem_on`.
    let memory_tools: &[(&str, &str)] = &[
        ("recall", "search long-term memory for specific facts/entries (ranked, raw)"),
        ("reflect", "synthesize an answer across many memories (open-ended questions)"),
        ("retain", "store durable facts (decisions, prefs, project context) for future sessions"),
        ("memory_edit", "update/forget/invalidate a specific stored memory by id (from recall)"),
    ];
    let mcp_names: Vec<String> = std::fs::read_to_string(home.join(".omp/agent/mcp.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| {
            v.get("mcpServers")
                .and_then(|m| m.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()))
        })
        .unwrap_or_default();
    let mut mcp_names_sorted = mcp_names.clone();
    mcp_names_sorted.sort();
    let skill_count = std::fs::read_dir(home.join(".omp/skills"))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0);
    let mut out = String::new();
    out.push_str("# omp capabilities snapshot\n\n");
    out.push_str(&format!(
        "Captured by `8sync harness`. omp version: **{}**\n\n",
        omp_ver.trim()
    ));
    out.push_str(
        "Refreshed every `8sync harness` run (omp self-updates via `omp update`). \
         This file is the GROUND TRUTH for exact tool names/params — call these, \
         never guess or invent a tool name.\n\n",
    );
    out.push_str("## Maximise these features\n\n");
    for (label, on) in flags.iter() {
        out.push_str(&format!(
            "- [{}] {} — {}\n",
            if *on { 'x' } else { ' ' },
            label,
            if *on { "available" } else { "not detected" }
        ));
    }
    out.push_str(&format!(
        "- [{}] retain/recall/reflect (Mnemopi long-term memory) — {}\n",
        if mem_on { 'x' } else { ' ' },
        if mem_on { "ON" } else { "OFF" }
    ));
    out.push_str(
        "\n## Modality routing (token discipline)\n\n\
         Read STRUCTURE as an image, PRECISE things as text. Vision models (Opus-class): \
         render a graph / diagram / dashboard / big PDF with `8sync shot`/`pdf-img` and \
         read the image (modality-fit — structure beats its adjacency-list text). NEVER \
         image-ify source code / exact config / line-numbered data — text is cheaper AND \
         lossless (Claude bills images per 28x28 patch, pay-per-pixel; the 10x/90% figure \
         needs a dedicated OCR encoder, not a screenshot). GLM-5.3 / 5.3-Flash are native \
         VLMs — look at the image. GLM-5.2 is text-only → zai-vision fallback. Full table: \
         `~/.omp/skills/image-routing/SKILL.md`.\n",
    );
    out.push_str("\n## omp built-in tools (from `omp --help`)\n\n");
    if builtin_tools.is_empty() {
        out.push_str("_(could not parse — run `omp --help` manually)_\n");
    } else {
        for (name, desc) in &builtin_tools {
            out.push_str(&format!("- `{}` — {}\n", name, desc));
        }
    }
    if mem_on {
        out.push_str("\n## Memory tools (Mnemopi — ON)\n\n");
        out.push_str("`recall`/`reflect` BEFORE answering about past sessions/decisions/prefs; `retain` durable facts AFTER. Never re-derive what's already retained.\n\n");
        for (name, desc) in memory_tools {
            out.push_str(&format!("- `{}` — {}\n", name, desc));
        }
    }
    out.push_str("\n## Registered MCP servers — EXACT tool catalog\n\n");
    out.push_str(&format!(
        "`{}` server(s) in `~/.omp/agent/mcp.json`. Use these BEFORE raw grep/read (STEP 0). Callable names are the REGISTERED forms: `mcp__<server-with-underscores>_<tool>` (e.g. `mcp__headroom_compress`; exception: a duplicated server prefix — omp collapses a duplicated server prefix). The four harness servers are kept ALWAYS VISIBLE by `8sync harness` (`mcp.discoveryDefaultServers`) — call their tools directly; only other/newly-added servers' tools need one `search_tool_bm25` call first.\n\n",
        mcp_names_sorted.len()
    ));
    for name in &mcp_names_sorted {
        let tools = known_mcp_tool_catalog(name);
        out.push_str(&format!("### {}\n\n", name));
        if tools.is_empty() {
            out.push_str("_(not a pinned harness server — no static catalog; check its own docs/`--help`)_\n\n");
        } else {
            for (tool, desc) in tools {
                out.push_str(&format!("- `{}` — {}\n", tool, desc));
            }
            out.push('\n');
        }
    }
    // Local GGUF models (mistral.rs → omp providers), if any are registered.
    let reg_raw =
        std::fs::read_to_string(home.join(".config/8sync/local-models.tsv")).unwrap_or_default();
    let locals: Vec<&str> = reg_raw.lines().filter(|l| !l.trim().is_empty()).collect();
    if !locals.is_empty() {
        out.push_str("\n## Local GGUF models (mistral.rs → omp)\n\n");
        out.push_str("On-device GGUF models served by mistral.rs (Rust, memory-safe) and registered as omp providers. Use like any model: `8sync ai --model local/<name>`. Manage: `8sync harness add-local-model list|rm`.\n\n");
        for l in &locals {
            let mut it = l.splitn(3, '\t');
            let name = it.next().unwrap_or("").trim();
            let port = it.next().unwrap_or("").trim();
            if !name.is_empty() {
                out.push_str(&format!("- `local/{}` — mistral.rs on port {}\n", name, port));
            }
        }
    }
    out.push_str(&format!(
        "## Installed skills\n\n`{}` skill dir(s) in `~/.omp/skills/`.\n",
        skill_count
    ));
    let mcp_servers = mcp_names_sorted.len();
    let target = home.join(".omp/capabilities.md");
    let changed = std::fs::read_to_string(&target).ok().as_deref() != Some(out.as_str());
    std::fs::write(&target, out)?;
    if changed {
        ui::ok(&format!(
            "omp capabilities snapshot → {} ({} · {} MCP · {} skills)",
            target.display(),
            omp_ver.trim(),
            mcp_servers,
            skill_count
        ));
    } else {
        ui::skip("omp capabilities snapshot", "unchanged");
    }
    Ok(())
}
/// Best-effort: ensure the `feynman` research CLI (companion-inc/feynman) is
/// available so the 20 feynman research skills registered in su-code/skills.toml
/// (deep-research, alpha-research, literature-review, …) are functional rather
/// than inert — they shell out to `feynman`/`alpha`. A failed install is
/// non-fatal (skills still list; the user can `npx @companion-ai/feynman`
/// later). Never bails the harness run.
pub(crate) fn ensure_feynman_cli() {
    if which::which("feynman").is_ok() {
        let v = env_detect::cmd_version("feynman", &["--version"]).unwrap_or_default();
        ui::skip("feynman CLI", &format!("present ({})", v));
        return;
    }
    ui::step("feynman CLI (missing — installing @companion-ai/feynman)");
    // Global install so skills resolve `feynman` directly on PATH. `npx` remains
    // the zero-install fallback, so a non-zero exit is only a soft failure.
    let cmd = "npm install -g @companion-ai/feynman 2>/dev/null || true";
    match Command::new("sh").arg("-c").arg(cmd).status() {
        Ok(s) if s.success() && which::which("feynman").is_ok() => {
            ui::ok("feynman CLI installed (research skills functional)");
        }
        _ => ui::warn(
            "feynman global install skipped/failed — skills still list (run via `npx @companion-ai/feynman`)",
        ),
    }
}

/// Deploy an omp artifact (command/extension) to the global config dir and, when
/// inside a project, the project config dir too. Byte-identical writes are quiet.
fn deploy_omp_pair(
    home: &Path,
    root: Option<&Path>,
    asset: &str,
    global_rel: &str,
    proj_rel: &str,
    label: &str,
) -> Result<()> {
    let Some(body) = assets::read(asset) else {
        return Ok(());
    };
    let body = if asset.ends_with(".md") {
        crate::brand::render(&body).into_owned()
    } else {
        body
    };
    let global = home.join(global_rel);
    if let Some(p) = global.parent() {
        std::fs::create_dir_all(p)?;
    }
    let changed = std::fs::read_to_string(&global).map(|s| s != body).unwrap_or(true);
    std::fs::write(&global, &body)?;
    if changed {
        ui::ok(&format!("{} → {}", label, global.display()));
    }
    if let Some(r) = root {
        let proj = r.join(proj_rel);
        if let Some(p) = proj.parent() {
            std::fs::create_dir_all(p)?;
        }
        let changed = std::fs::read_to_string(&proj).map(|s| s != body).unwrap_or(true);
        std::fs::write(&proj, &body)?;
        if changed {
            ui::ok(&format!("{} → {}", label, proj.display()));
        }
    }
    Ok(())
}

/// Clean cutover for retired omp extensions. Anything swept here either
/// double-registers the engine's tool names next to `8sync-engine.ts`, or —
/// since omp 17.4 bundled zod v4 — hard-fails extension loading for the whole
/// project with "ParseError: A mutable default value must be specified as a
/// factory" (the old bodies use `.default([])` array literals). Swept from the
/// global and project extension dirs; a rebranded build also sweeps the
/// historical `8sync-` name. Best-effort: absent is the normal case and a
/// failed unlink never bails the harness run.
///
/// - `<NS>-workflow.ts` / `8sync-workflow.ts` — retired into `8sync-engine.ts`
///   (same tool names).
/// - `8sync-gs/` — the multi-file gsd engine the single-file engine replaced.
/// - `ckit-engine.ts` / `ckit-workflow.ts` — interim renames of the two above.
///   Not 8sync-namespaced, so removal is content-gated: the body must carry the
///   `8sync-engine` / `8sync-workflow` lineage marker (they are literally those
///   extensions under another name); a user's own same-named file survives.
fn remove_retired_extensions(home: &Path, root: Option<&Path>) {
    let ns = crate::brand::ns_file("workflow.ts");
    let mut dirs = vec![home.join(".omp/agent/extensions")];
    if let Some(r) = root {
        dirs.push(r.join(".omp/extensions"));
    }
    for name in [ns.as_str(), "8sync-workflow.ts"] {
        for d in &dirs {
            let f = d.join(name);
            if std::fs::remove_file(&f).is_ok() {
                ui::ok(&format!("removed retired extension → {}", f.display()));
            }
        }
    }
    for d in &dirs {
        let f = d.join("8sync-gs");
        if std::fs::remove_dir_all(&f).is_ok() {
            ui::ok(&format!("removed retired engine dir → {}", f.display()));
        }
    }
    for name in ["ckit-engine.ts", "ckit-workflow.ts"] {
        for d in &dirs {
            let f = d.join(name);
            if std::fs::read_to_string(&f)
                .is_ok_and(|b| b.contains("8sync-engine") || b.contains("8sync-workflow"))
                && std::fs::remove_file(&f).is_ok()
            {
                ui::ok(&format!("removed retired extension → {}", f.display()));
            }
        }
    }
}

/// FNV-1a 64 over `bytes`. Not a crate and not a security boundary — the only
/// use is recognising a file we wrote against the frozen list below, so eight
/// dependency-free lines beat adding `sha2` or shelling out to `sha256sum` once
/// per command file. `DefaultHasher` is explicitly not used: its output is not
/// guaranteed stable across Rust releases, and these constants must never rot.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Every un-prefixed command body 8sync has ever shipped, LF-normalised, up to
/// v0.54.1 — the last release that deployed commands without the `sx-` prefix.
///
/// FROZEN by construction: no build after v0.54.1 writes an un-prefixed command,
/// so this set can never grow. Delete the whole migration once every user has
/// passed through a release carrying it.
const LEGACY_COMMAND_BODIES: &[u64] = &[
    0x07c2_eb60_e607_6b34, // push-now.md
    0x11eb_9293_f0df_b294, // auto.md
    0x2d30_a3d6_672c_f75d, // feature.md
    0x3485_1cf3_bd99_e0dd, // auto.md
    0x7667_5a1e_2d94_198c, // create-command.md
    0xa804_2999_eaa7_a198, // auto-package.md
    0xb9b2_8906_5a74_c4a4, // auto.md
    0xd938_b6b8_bf89_9ef6, // auto.md
    0xe7dd_6b8c_27b0_93a7, // auto.md
    0xea20_6d38_a0f6_0a37, // pull-now.md
    0xf25a_62bd_7152_a3c9, // create-skill.md
    0xfe57_329d_5bc7_2dfe, // sync-pr.md
];

/// Is this text a command body we shipped before the `sx-` prefix?
///
/// Normalised first: a CRLF checkout of a pre-0.54.2 release baked CRLF into the
/// shipped asset, and that copy is still unmistakably ours.
fn is_retired_command_body(text: &str) -> bool {
    LEGACY_COMMAND_BODIES.contains(&fnv1a64(text.replace("\r\n", "\n").as_bytes()))
}

/// Delete the pre-prefix copy of a command we previously deployed.
///
/// Without this an upgrade leaves BOTH `/auto` and `/sx-auto` in omp's flat
/// command namespace: two entries, same body, one of them frozen at whatever
/// version shipped last.
///
/// Removal is content-gated on purpose. `~/.omp/agent/commands/` is shared with
/// commands the USER wrote, and `auto.md` is an obvious name for someone to pick.
/// Deleting by name alone would silently eat their file, so the old copy goes
/// only when its body is one we shipped. The gate compares against EVERY shipped
/// version, not just the current asset: the release that introduced the prefix
/// also rewrote each body's self-references, so a current-asset-only compare
/// never matched and left both names behind on every upgraded machine.
fn remove_unprefixed_predecessor(home: &Path, root: Option<&Path>, file: &str) {
    let mut targets = vec![home.join(".omp/agent/commands").join(file)];
    if let Some(r) = root {
        targets.push(r.join(".omp/commands").join(file));
    }
    for p in targets {
        if std::fs::read_to_string(&p).is_ok_and(|on_disk| is_retired_command_body(&on_disk)) {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// Deploy the gsd-pi-style automation engine — the `8sync-engine` omp extension
/// (durable slice/task state machine + code-enforced verify-retry gate + git
/// worktree tools), the `8sync-team` omp extension (inbox / nudge / resume for omp
/// rooms launched by `8sync . <name>`) and every slash command under
/// `assets/commands/`. 100% on omp core (config dirs only, never patches omp) so
/// updates stay safe.
pub(crate) fn ensure_engine(home: &Path, root: Option<&Path>) -> Result<()> {
    remove_retired_extensions(home, root);
    let eng = crate::brand::ns_file("engine.ts");
    deploy_omp_pair(
        home,
        root,
        "extensions/8sync-engine.ts",
        &format!(".omp/agent/extensions/{eng}"),
        &format!(".omp/extensions/{eng}"),
        "8sync-engine extension",
    )?;
    // Global only: a project copy would load it twice in that project (two pollers,
    // two nudges). It is inert outside a room (`EIGHTSYNC_ROOM_ID` unset).
    let team = crate::brand::ns_file("team.ts");
    deploy_omp_pair(
        home,
        None,
        "extensions/8sync-team.ts",
        &format!(".omp/agent/extensions/{team}"),
        &format!(".omp/extensions/{team}"),
        "8sync-team extension",
    )?;
    // Slash commands deploy by ITERATING the `commands/` asset dir — never a
    // hardcoded block per file. Dropping a new `assets/commands/<n>.md` into the
    // tree is therefore all it takes to ship a command; `/create-command` relies
    // on exactly this. (This replaced five copy-pasted `deploy_omp_pair` calls,
    // which is why `create-command` could not exist before.)
    for asset in crate::assets::iter_under("commands/") {
        let Some(file) = asset.rsplit('/').next() else { continue };
        if !file.ends_with(".md") {
            continue;
        }
        // Deployed under the command prefix; the asset itself stays bare so a
        // rebranded build can choose its own prefix from one const.
        let deployed = crate::brand::cmd_file(file);
        let invoked = deployed.trim_end_matches(".md");
        remove_unprefixed_predecessor(home, root, file);
        deploy_omp_pair(
            home,
            root,
            &asset,
            &format!(".omp/agent/commands/{deployed}"),
            &format!(".omp/commands/{deployed}"),
            &format!("/{invoked} command"),
        )?;
    }
    Ok(())
}

/// One-time rebrand migration: when the binary is rebranded (`brand::NS` differs
/// from the historical `8sync`), move the `8sync`-namespaced persistent config to
/// the new namespace and remove stale deployed artifacts left under the old
/// `8sync-` filenames (the new ones deploy under `<NS>-`, so a leftover
/// `8sync-engine.ts` would make omp load the engine tools twice). AGENTS.md
/// sentinels self-heal via `skill::inject`'s legacy-aware block finder, and the
/// `.cache/` namespace is intentionally left literal (see `brand.rs`). No-op on
/// the default build and idempotent once migrated. Best-effort: never bails.
pub(crate) fn migrate_namespace(home: &Path) {
    if crate::brand::NS == "8sync" {
        return;
    }
    // 1. Config namespace: ~/.config/8sync → ~/.config/<NS>, kitty conf filename.
    if let Some(cfg) = dirs::config_dir() {
        rename_if_new_absent(&cfg.join("8sync"), &cfg.join(crate::brand::NS));
        rename_if_new_absent(
            &cfg.join("kitty").join("8sync.conf"),
            &cfg.join("kitty").join(format!("{}.conf", crate::brand::NS)),
        );
        // 3. Old systemd user timer (the NS-named unit installs on next `up --timer`).
        let unit_dir = cfg.join("systemd/user");
        if unit_dir.join("8sync-harness-up.timer").exists() {
            let _ = std::process::Command::new("systemctl")
                .args(["--user", "disable", "--now", "8sync-harness-up.timer"])
                .status();
            let _ = std::fs::remove_file(unit_dir.join("8sync-harness-up.service"));
            let _ = std::fs::remove_file(unit_dir.join("8sync-harness-up.timer"));
        }
    }
    // 2. Stale global deployed artifacts under the old `8sync-` names.
    for stale in [
        home.join(".omp/hooks/pre/8sync-recall.ts"),
        home.join(".omp/agent/extensions/8sync-engine.ts"),
        home.join(".omp/agent/extensions/8sync-team.ts"),
    ] {
        let _ = std::fs::remove_file(&stale);
    }
}

/// `rename(old → new)` only when the old path exists and the new one does not —
/// so a rebrand migrates once and never clobbers freshly-written state.
fn rename_if_new_absent(old: &Path, new: &Path) {
    if old.exists() && !new.exists() {
        let _ = std::fs::rename(old, new);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rules layer is DIRECTORY-discovered: dropping a file into
    /// `assets/rules/` must be enough for `ensure_rules` to ship it, and every
    /// discovered asset must be a readable rule file.
    #[test]
    fn rules_dir_is_discovered() {
        let rules = assets::iter_under("rules/");
        assert!(!rules.is_empty(), "assets/rules/ yielded no rule");
        for r in &rules {
            assert!(r.ends_with(".md") || r.ends_with(".mdc"), "not an omp rule file: {}", r);
            assert!(assets::read(r).is_some(), "unreadable rule asset: {}", r);
        }
        // At least one is a TTSR rule. omp only registers a rule as TTSR when it
        // carries a `condition:`, and only aborts the offending tool call when
        // `scope:` names that tool and `interruptMode:` allows it — all three keys
        // are load-bearing, so a rule missing one is silently advisory.
        // `.gitattributes` pins every asset to LF so the embedded bytes are
        // identical on every platform, but a developer whose worktree predates it
        // would otherwise see this fail for a reason that has nothing to do with
        // the rule's content. Compare on normalised text and keep the signal real.
        assert!(
            rules
                .iter()
                .filter_map(|r| assets::read(r))
                .map(|b| b.replace("\r\n", "\n"))
                .any(|b| {
                    b.starts_with("---\n")
                        && b.contains("\ncondition:")
                        && b.contains("\nscope:")
                        && b.contains("\ninterruptMode:")
                }),
            "no TTSR rule (condition + scope + interruptMode) in assets/rules/"
        );
    }

    /// UC-7: a gated rule ships when ONE required tool is present, is withheld when
    /// none is, and an ungated rule always ships.
    #[test]
    fn requires_marker_gates_deployment() {
        let gated = "body\n<!-- 8sync:requires trail,other -->\n";
        assert!(requirements_met(gated, &["trail"]));
        assert!(requirements_met(gated, &["headroom", "other"]));
        assert!(!requirements_met(gated, &[]));
        assert!(!requirements_met(gated, &["headroom"]));
        assert!(requirements_met("a rule that needs nothing", &[]));
    }

    /// Every shipped rule that can veto a tool call MUST declare its requirements,
    /// or a machine without the replacement dead-ends (UC-7).
    #[test]
    fn every_ttsr_rule_declares_requirements() {
        for r in assets::iter_under("rules/") {
            let body = assets::read(&r).unwrap();
            if body.contains("\ncondition:") {
                assert!(
                    !requirements_met(&body, &[]),
                    "{} interrupts tool calls with no capability gate",
                    r
                );
            }
        }
    }

    /// GLM-5.3 / 5.3-Flash are native VLMs. Always-on prompts must tell the agent
    /// to look at the image — not bounce pixels through the zai-vision sidecar.
    #[test]
    fn glm53_reads_images_natively_not_via_zai_vision() {
        let append = assets::read("configs/omp/APPEND_SYSTEM.md").unwrap();
        assert!(
            append.contains("glm-5.3"),
            "APPEND_SYSTEM must name GLM-5.3 as a native VLM"
        );
        assert!(
            !append.contains("GLM-5.2 cannot. Route every real image through **zai-vision MCP**"),
            "stale text-only-default routing must be gone"
        );
        assert!(
            append.contains("LOOK at the attached image")
                || append.contains("LOOK at the attached image in this session"),
            "APPEND_SYSTEM must order a native-VLM look"
        );
        let routing = assets::read("skills/image-routing/SKILL.md").unwrap();
        assert!(routing.contains("glm-5.3"));
        assert!(
            routing.contains("Do NOT call `mcp__zai_vision_*`"),
            "image-routing must forbid the sidecar on GLM-5.3"
        );
        let zai = assets::read("skills/zai-vision/SKILL.md").unwrap();
        assert!(zai.contains("STOP"), "zai-vision must have a native-VLM STOP gate");
        assert!(zai.contains("glm-5.3"));
        assert!(zai.contains("FALLBACK"));
        let recall = assets::read("hooks/8sync-recall.ts").unwrap();
        assert!(recall.contains("GLM-5.3"));
        assert!(!recall.contains("images → zai-vision (never guess"));
    }

    /// The interceptor block is rendered from `models.toml`, and a regex survives
    /// the trip: YAML single-quoting is escape-free apart from `'` → `''`.
    #[test]
    fn interceptor_block_renders_from_embedded_config() {
        let bi = crate::models::ModelConfig::default().bash_interceptor;
        assert!(bi.enabled, "embedded models.toml disabled the STEP-0 guard");
        assert_eq!(bi.patterns.len(), 3, "embedded models.toml lost its rules");
        let block = render_interceptor_block(&bi);
        // Ownership marker — `ensure_bash_interceptor` finds its own block by it.
        assert!(block.contains("STEP-0"), "block carries no STEP-0 ownership marker");
        for r in &bi.patterns {
            // A rule whose `tool` is absent from the session is skipped by omp, so
            // an empty one would block nothing at all.
            assert!(!r.tool.is_empty(), "rule has no `tool` gate: {}", r.pattern);
            assert!(
                block.contains(&format!("- pattern: '{}'", r.pattern.replace('\'', "''"))),
                "pattern not rendered verbatim: {}",
                r.pattern
            );
            assert!(r.message.contains("trail"), "message names no replacement");
        }
        assert_eq!(yaml_sq("a'b"), "'a''b'");
    }
}

#[cfg(test)]
mod bundled_tests {
    /// Every skill named in a hardcoded deploy list MUST exist as an embedded
    /// asset. These lists are literals (`deploy.rs` and `setup.rs`), so renaming
    /// or deleting a skill directory does not break the build — the skill just
    /// stops deploying, silently, forever.
    ///
    /// That is not hypothetical: `skills/karpathy` was renamed to
    /// `skills/karpathy-guidelines` and both lists kept pointing at the old
    /// prefix. `assets::read` returned None and the skill vanished from every
    /// install with no error. This test is the standing guard for that class.
    #[test]
    fn every_bundled_skill_prefix_resolves_to_a_real_asset() {
        let mut missing = Vec::new();
        for src in [
            include_str!("deploy.rs"),
            include_str!("../setup.rs"),
        ] {
            for raw in src.split("(\"skills/").skip(1) {
                let Some(name) = raw.split('"').next() else { continue };
                // Skip non-directory entries (e.g. `skills/00-force-load.md`,
                // a standalone file) and format!-template fragments.
                if name.is_empty()
                    || name.contains(' ')
                    || name.contains('{')
                    || name.ends_with(".md")
                {
                    continue;
                }
                let probe = format!("skills/{name}/SKILL.md");
                if crate::assets::read(&probe).is_none() {
                    missing.push(probe);
                }
            }
        }
        missing.sort();
        missing.dedup();
        assert!(
            missing.is_empty(),
            "bundled skill prefixes with no embedded SKILL.md (renamed or deleted \
             asset dir — the skill would silently stop deploying): {missing:#?}"
        );
    }

    /// The other direction, which the scrape above structurally cannot cover:
    /// every embedded `assets/skills/<name>/SKILL.md` must be REGISTERED in
    /// [`super::BUNDLED_SKILLS`]. An unregistered asset dir is shipped inside the
    /// binary and deployed nowhere, so `~/.omp/skills/<name>/` never exists on any
    /// machine but this checkout — while `assets/skills/00-force-load.md` still
    /// tells the agent to open that SKILL.md. `research-paper` and
    /// `remote-compute` shipped exactly like that.
    ///
    /// Opt-in skills are the one legitimate exception: they ship on purpose and
    /// are enabled per-machine with `8sync skill add builtin:<name>`. Adding a
    /// name here is a deliberate decision, not a way to silence this test.
    #[test]
    fn every_asset_skill_is_registered_or_explicitly_opt_in() {
        const OPT_IN: [&str; 1] = ["social-growth"];

        let mut unregistered = Vec::new();
        for path in crate::assets::iter_under("skills/") {
            let Some(name) = path
                .strip_prefix("skills/")
                .and_then(|rest| rest.strip_suffix("/SKILL.md"))
            else {
                continue; // `00-force-load.md`, references/, scripts/, …
            };
            // Skill roots are flat by construction (`install_bundled_global`
            // deploys `skills/<name>/`), so a nested SKILL.md is reference
            // material carried inside a tree, not a skill of its own.
            if name.contains('/') || OPT_IN.contains(&name) {
                continue;
            }
            let registered = super::BUNDLED_SKILLS
                .iter()
                .any(|(prefix, _)| prefix.strip_prefix("skills/") == Some(name));
            if !registered {
                unregistered.push(name.to_string());
            }
        }
        unregistered.sort();
        assert!(
            unregistered.is_empty(),
            "asset skill(s) missing from BUNDLED_SKILLS — shipped in the binary but \
             never deployed to ~/.omp/skills/: {unregistered:#?}. Add each to \
             BUNDLED_SKILLS, or to this test's OPT_IN list if it is deliberately \
             opt-in."
        );
    }
}

#[cfg(test)]
mod command_prefix_tests {
    #[test]
    fn prefixing_is_idempotent() {
        assert_eq!(crate::brand::cmd_file("auto.md"), "sx-auto.md");
        // A future asset that already carries the prefix must not become sx-sx-.
        assert_eq!(crate::brand::cmd_file("sx-auto.md"), "sx-auto.md");
    }

    /// Every shipped command deploys under the prefix, so the whole set is
    /// attributable to 8sync in omp's flat, shared command namespace.
    #[test]
    fn every_shipped_command_deploys_prefixed() {
        let mut n = 0;
        for asset in crate::assets::iter_under("commands/") {
            let Some(file) = asset.rsplit('/').next() else { continue };
            if !file.ends_with(".md") {
                continue;
            }
            let deployed = crate::brand::cmd_file(file);
            assert!(
                deployed.starts_with(crate::brand::CMD_PREFIX),
                "`{file}` would deploy unprefixed as `{deployed}`"
            );
            n += 1;
        }
        assert!(n >= 8, "expected the bundled command set, found {n}");
    }

    /// The lifecycle command must exist and declare the frontmatter omp needs to
    /// register it; a command that fails to parse is silently absent at the prompt.
    #[test]
    fn super_dev_command_is_shipped_and_parseable() {
        let body = crate::assets::read("commands/super-dev.md")
            .expect("super-dev command is bundled");
        assert!(body.starts_with("---\n"), "missing frontmatter");
        assert!(body.contains("\nname: sx-super-dev\n"), "frontmatter must state the INVOKED name");
        assert!(body.contains("\ndescription: "), "missing description");
        assert!(body.contains("$ARGUMENTS"), "takes no arguments");
    }
}

#[cfg(test)]
mod legacy_command_tests {
    use super::*;

    /// Reference vectors from the FNV-1a 64 spec. If these drift, every constant
    /// in `LEGACY_COMMAND_BODIES` silently stops matching and the migration
    /// becomes a no-op — exactly the failure this module exists to prevent.
    #[test]
    fn hash_matches_the_fnv1a64_spec() {
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(fnv1a64(b"foobar"), 0x85944171f73967e8);
    }

    /// A command the USER wrote at a name we once used is never deleted.
    #[test]
    fn a_user_authored_command_is_not_ours() {
        assert!(!is_retired_command_body("---\nname: auto\n---\n\nmy own /auto\n"));
        assert!(!is_retired_command_body(""));
    }

    /// The list is a closed set of PRE-prefix bodies. Nothing shipped today may
    /// appear in it: that would mean someone appended post-migration content to a
    /// table whose whole premise is that it can never grow.
    #[test]
    fn the_legacy_set_is_frozen_and_distinct_from_what_ships_now() {
        let mut seen = LEGACY_COMMAND_BODIES.to_vec();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), LEGACY_COMMAND_BODIES.len(), "duplicate digest");
        for asset in crate::assets::iter_under("commands/") {
            let Some(body) = crate::assets::read(&asset) else { continue };
            assert!(
                !is_retired_command_body(&body),
                "`{asset}` ships today yet is listed as a retired body"
            );
        }
    }
}

#[cfg(test)]
mod host_adapter_tests {
    #[test]
    fn host_adapters_create_cursor_and_zcode_from_su_code_skills() {
        let base = std::env::temp_dir().join(format!("8sync-hosts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let home = base.join("home");
        let root = base.join("repo");
        let skill = root.join("su-code/skills/foo");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(
            skill.join("SKILL.md"),
            "---\nname: foo\ndescription: fixture\n---\n\nbody\n",
        )
        .unwrap();

        super::ensure_host_adapters(&home, &root, true).unwrap();

        assert!(
            root.join(".cursor/skills/foo/SKILL.md").is_file(),
            "Cursor Agent Skills dir must expose SKILL.md"
        );
        assert!(
            root.join(".zcode/skills/foo/SKILL.md").is_file(),
            "Z.ai Code skills dir must expose SKILL.md"
        );
        let rule = std::fs::read_to_string(root.join(".cursor/rules/8sync-harness.mdc")).unwrap();
        assert!(rule.contains("alwaysApply: true"));
        assert!(root.join(".claude/skills/foo/SKILL.md").is_file(), "Claude Code project skills dir must expose SKILL.md");
        let overrides: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(".claude/settings.local.json")).unwrap()).unwrap();
        assert_eq!(overrides["skillOverrides"]["foo"], "name-only", "on-demand skill listed by name only");

        // The links must be ignored as links: git sees a symlink/junction as a
        // file, so a `dir/` pattern lets `git add -A` commit it.
        std::process::Command::new("git").args(["init", "-q"]).current_dir(&root).status().unwrap();
        crate::verbs::harness::memory::seed_gitignore(&root).unwrap();
        let out = std::process::Command::new("git").args(["status", "--porcelain", "--untracked-files=all"]).current_dir(&root).output().unwrap();
        let status = String::from_utf8_lossy(&out.stdout);
        for link in [".cursor/skills", ".zcode/skills", ".claude/"] {
            assert!(!status.contains(link), "{link} must be ignored, git status:\n{status}");
        }

        // A repo's own `.claude/skills/` is never replaced, even with --force.
        let own = base.join("own");
        std::fs::create_dir_all(own.join("su-code/skills/foo")).unwrap();
        std::fs::create_dir_all(own.join(".claude/skills/mine")).unwrap();
        std::fs::write(own.join(".claude/skills/mine/SKILL.md"), "---\nname: mine\n---\n").unwrap();
        super::ensure_host_adapters(&home, &own, true).unwrap();
        assert!(own.join(".claude/skills/mine/SKILL.md").is_file(), "repo-owned Claude Code skills survive --force");

        super::ensure_host_adapters(&home, &root, true).unwrap();
        assert!(skill.join("SKILL.md").is_file(), "canonical skill must survive --force");
        assert!(root.join(".cursor/skills/foo/SKILL.md").is_file());

        let _ = std::fs::remove_dir_all(&base);
    }
}

#[cfg(test)]
mod skill_library_tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-skilllib-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn skill(lib: &Path, name: &str) {
        std::fs::create_dir_all(lib.join(name)).unwrap();
        std::fs::write(lib.join(name).join("SKILL.md"), format!("---\nname: {name}\ndescription: x\n---\n")).unwrap();
    }

    #[test]
    fn every_omp_skill_folder_is_linked() {
        let home = tmp("omp-home");
        skill(&home.join(".omp/skills"), "frontend-ui-engineering"); // not in the shipped list
        std::fs::write(home.join(".omp/skills/00-force-load.md"), "x").unwrap(); // a file, not a skill
        let skills = home.join(".claude/skills");
        assert_eq!(link_bundled_skills(&home, &skills).unwrap(), 1);
        assert!(skills.join("frontend-ui-engineering/SKILL.md").is_file());
        assert!(!skills.join("00-force-load.md").exists());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn library_is_registered_once_and_links_only_missing_skills() {
        let home = tmp("home");
        let lib = tmp("lib");
        skill(&lib, "loop-me");
        skill(&lib, "ship"); // the kit's own skill of that name must win
        std::fs::create_dir_all(lib.join("notes")).unwrap(); // no SKILL.md: ignored
        assert!(add_skill_library(&home, &lib).unwrap());
        assert!(!add_skill_library(&home, &lib).unwrap(), "second add is a no-op");
        assert_eq!(skill_libraries(&home), vec![lib.canonicalize().unwrap()]);

        let skills = home.join(".claude/skills");
        std::fs::create_dir_all(skills.join("ship")).unwrap();
        std::fs::write(skills.join("ship/SKILL.md"), "kit").unwrap();
        assert_eq!(link_library_skills(&home, &skills).unwrap(), 1);
        assert!(skills.join("loop-me/SKILL.md").is_file());
        assert_eq!(std::fs::read_to_string(skills.join("ship/SKILL.md")).unwrap(), "kit", "never overwritten");
        assert!(!skills.join("notes").exists());
        assert_eq!(link_library_skills(&home, &skills).unwrap(), 0, "idempotent");

        let empty = tmp("empty");
        assert!(add_skill_library(&home, &empty).is_err(), "a dir without skills is refused");
        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&lib);
        let _ = std::fs::remove_dir_all(&empty);
    }
}
