//! Skill-directory listing + project-root detection.
use anyhow::Result;
use std::path::{Path, PathBuf};
use serde::Deserialize;
use std::collections::BTreeMap;

/// One `[name]` section of `~/.config/8sync/skills.toml`.
#[derive(Deserialize)]
pub(crate) struct SkillEntry {
    /// Install source: git URL, `path:<abs>`, or `builtin:<name>`.
    pub(crate) src: String,
    /// `always` | `on-demand` — load policy (unused by update, kept for parity).
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) when: Option<String>,
    /// Pinned git commit/ref (lockfile). Present ⇒ `skill update` checks out
    /// exactly this rev (reproducible); absent ⇒ track latest HEAD.
    #[serde(default)]
    pub(crate) rev: Option<String>,
}

/// Parse the skill registry → `{name: entry}`. Empty map on a missing file or
/// parse error, so callers treat the registry as authoritative-or-empty.
pub(crate) fn read_registry(toml_path: &Path) -> BTreeMap<String, SkillEntry> {
    let s = std::fs::read_to_string(toml_path).unwrap_or_default();
    toml::from_str(&s).unwrap_or_default()
}

/// Write a registry map to a TOML manifest — the committed project manifest
/// `su-code/skills.toml`, so `8sync harness` re-pulls the same skills on any
/// machine (the global `~/.config/8sync/skills.toml` is machine-local).
pub(crate) fn write_registry(toml_path: &Path, reg: &BTreeMap<String, SkillEntry>) -> Result<()> {
    let mut s = String::from(
        "# su-code/skills.toml — project skill manifest (committed). `8sync harness` re-pulls these on any machine.\n",
    );
    for (name, e) in reg {
        s.push_str(&format!("\n[{}]\nsrc = \"{}\"\n", name, e.src));
        if let Some(w) = &e.when {
            s.push_str(&format!("when = \"{}\"\n", w));
        }
        if let Some(r) = &e.rev {
            s.push_str(&format!("rev = \"{}\"\n", r));
        }
    }
    if let Some(p) = toml_path.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(toml_path, s)?;
    Ok(())
}

/// List immediate sub-directories of `skills_dir` (one per skill), sorted.
pub(crate) fn list_installed_skill_dirs(skills_dir: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !skills_dir.exists() {
        return Ok(out);
    }
    for entry in std::fs::read_dir(skills_dir)? {
        let entry = entry?;
        let p = entry.path();
        if p.is_dir() {
            out.push(p);
        }
    }
    out.sort();
    Ok(out)
}

/// The project-memory directory name. A literal, matching every other call site
/// (`memory::seed_harness_memory`, `memory::migrate_legacy_layout`) — it is
/// NOT `brand::NS`, which is the config/artifact namespace (`8sync`).
pub(crate) const MEMORY_DIR: &str = "su-code";

/// True when `<dir>/<name>` is an 8sync memory tree rather than a directory that
/// merely shares the name. Without this check any folder called `su-code` makes
/// its PARENT look like a project — and since this repo's own checkout is named
/// `su-code`, a stamp run from `~/Projects/tools` wrote `STATE.md` + a 74-entry
/// `skills/` straight into the repo root.
fn is_memory_dir(dir: &Path, name: &str) -> bool {
    let d = dir.join(name);
    if !d.is_dir() {
        return false;
    }
    d.join("skills").is_dir()
        || ["STATE.md", "KNOWLEDGE.md", "PROJECT.md", "PLAYBOOKS.md", "skills.toml"]
            .iter()
            .any(|f| d.join(f).exists())
}

/// Walk up from the cwd to the nearest recognised project root.
pub(crate) fn detect_current_project_root() -> Option<PathBuf> {
    // Markers in priority order. AGENTS.md / CLAUDE.md catch projects already
    // seeded by `8sync .` even when they lack a language manifest.
    // `.git` / `.hg` catch any VCS repo. The rest cover major ecosystems.
    // `su-code` / `agents` are checked separately — they must hold real memory.
    let markers = [
        "AGENTS.md",
        "CLAUDE.md",
        ".git",
        ".hg",
        "Cargo.toml",
        "package.json",
        "pyproject.toml",
        "deno.json",
        "go.mod",
        "composer.json",
        "Gemfile",
        "mix.exs",
    ];
    let mut p = std::env::current_dir().ok()?;
    loop {
        if markers.iter().any(|m| p.join(m).exists())
            || is_memory_dir(&p, MEMORY_DIR)
            || is_memory_dir(&p, "agents")
        {
            return Some(p);
        }
        if !p.pop() {
            return None;
        }
    }
}

/// Project-shaped enough for `8sync harness global` to stamp a per-project layer
/// into it. Same memory-tree requirement as above.
pub(crate) fn is_omp_project(repo: &Path) -> bool {
    repo.join("AGENTS.md").is_file()
        || repo.join("CLAUDE.md").is_file()
        || is_memory_dir(repo, MEMORY_DIR)
}
