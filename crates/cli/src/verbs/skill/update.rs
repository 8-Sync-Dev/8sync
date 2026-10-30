//! `8sync skill update [name]` — re-pull registered skills from their recorded
//! source in `~/.config/8sync/skills.toml`.
//!
//! Sources are handled by kind: git URLs are cloned shallow (deduped per URL —
//! a collection repo is fetched once and all its sub-skills reinstalled),
//! `builtin:` redeploys the embedded asset tree, `path:` re-ensures the symlink.
//! Every source is best-effort: a single failure (offline, no `git`, repo gone)
//! warns and is skipped; the command still exits 0. The core bundled skills are
//! NOT touched here — refresh those with `8sync harness init`.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::Result;

use super::deploy::copy_dir_recursive;
use super::discover::{self, detect_current_project_root};
use super::spec::{collect_repo_skills, git_clone_at, install_path_skill};
use super::{inject_agents_md, inject_subfolder_indexes};
use crate::{assets, env_detect, ui};

pub(crate) fn update_skills(
    env: &env_detect::Env,
    toml_path: &Path,
    filter: Option<&str>,
) -> Result<()> {
    ui::header("8sync skill update");
    // Global registry (machine-local) ∪ project manifest (su-code/skills.toml,
    // committed) — the manifest is what makes skills reproducible on a new machine.
    let project_root = detect_current_project_root();
    let proj_manifest = project_root.as_ref().map(|r| r.join("su-code/skills.toml"));
    let mut reg = discover::read_registry(toml_path);
    if let Some(pm) = &proj_manifest {
        for (k, v) in discover::read_registry(pm) {
            reg.entry(k).or_insert(v);
        }
    }
    if reg.is_empty() {
        ui::info("no registered skills — `8sync skill add <url>` (or commit su-code/skills.toml)");
        return Ok(());
    }
    // A `builtin:` this binary does not bundle was registered by an older release (`skill add`
    // refuses unknown builtins): forget it — the manifest rewrite below drops it — instead of
    // warning on every run (`deep-research` ships as `deep-research-web` since 0.111.0;
    // `karpathy` was the pre-`karpathy-guidelines` name).
    for name in drop_unbundled_builtins(&mut reg) {
        ui::info(&format!("dropped `{name}` from the skill registry: this 8sync no longer bundles it"));
    }
    let omp_skills = env.home.join(".omp/skills");
    let mut updated = 0usize;
    let mut sources = 0usize;
    let mut matched = false;

    // Match the name filter (None = match all).
    let want = |name: &str| filter.is_none_or(|f| f == name);

    // --- git sources: dedup by URL, clone once, reinstall every sub-skill ---
    let mut git_urls: BTreeSet<&str> = BTreeSet::new();
    for entry in reg.values() {
        let s = entry.src.as_str();
        if s.starts_with("http://") || s.starts_with("https://") || s.starts_with("git@") {
            git_urls.insert(s);
        }
    }
    for url in &git_urls {
        let url_seg = url.trim_end_matches(".git").rsplit('/').next().unwrap_or(url);
        // Explicit ask for this exact collection (by URL or repo segment) →
        // install every sub-skill it contains. Otherwise (bulk `8sync
        // harness` run with filter=None, or a filter naming a DIFFERENT
        // skill/repo) a sub-skill is only (re)installed when it already has
        // its own registry key — a collection repo must not silently grow
        // the registry just because ONE of its skills is registered (e.g.
        // registering only `alpha-research` out of a 20-skill repo must not
        // also install the other 19 unrequested ones).
        let explicit_collection_filter = filter.is_some_and(|f| f == *url || f == url_seg);
        let tmp = env.home.join(".cache/8sync/skill-clone").join(sanitize(url));
        let _ = std::fs::remove_dir_all(&tmp);
        if let Some(p) = tmp.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        // Reproduce a pinned rev (any registry entry for this URL carrying `rev`).
        let pin = reg.values().filter(|e| e.src.as_str() == *url).find_map(|e| e.rev.clone());
        if let Err(e) = git_clone_at(url, &tmp, pin.as_deref()) {
            ui::warn(&format!("skip {} (clone failed: {})", url, e));
            continue;
        }
        if let Some(r) = &pin {
            ui::step(&format!("pinned @ {}", &r[..r.len().min(12)]));
        }
        let found = collect_repo_skills(&tmp, url_seg);
        let mut any_here = false;
        for (sname, sdir) in &found {
            let named_filter_hit = filter.is_some_and(|f| f == sname.as_str());
            let keep = explicit_collection_filter || named_filter_hit || (filter.is_none() && reg.contains_key(sname.as_str()));
            if sname.is_empty() || !keep {
                continue;
            }
            matched = true;
            let gt = omp_skills.join(sname);
            let _ = std::fs::remove_dir_all(&gt);
            if let Err(e) = copy_dir_recursive(sdir, &gt) {
                ui::warn(&format!("  {} → global copy failed: {}", sname, e));
                continue;
            }
            ui::ok(&format!("updated `{}`", sname));
            updated += 1;
            any_here = true;
        }
        let _ = std::fs::remove_dir_all(&tmp);
        if any_here {
            sources += 1;
        }
    }

    // --- builtin sources: redeploy the embedded asset tree ---
    for (name, entry) in &reg {
        let Some(bname) = entry.src.strip_prefix("builtin:") else {
            continue;
        };
        if !want(name) {
            continue;
        }
        let prefix = format!("skills/{}", bname);
        matched = true;
        let gt = omp_skills.join(name);
        let (w, _) = assets::install_tree(&prefix, &gt)?;
        ui::ok(&format!("updated builtin `{}` ({} file(s))", name, w));
        updated += 1;
        sources += 1;
    }

    // --- path sources: re-ensure the symlink (idempotent) ---
    for (name, entry) in &reg {
        let Some(p) = entry.src.strip_prefix("path:") else {
            continue;
        };
        if !want(name) {
            continue;
        }
        matched = true;
        let gt = omp_skills.join(name);
        let _ = install_path_skill(Path::new(p), &gt);
        updated += 1;
        sources += 1;
    }

    if let Some(f) = filter {
        if !matched {
            ui::warn(&format!("no registered skill matches `{}`", f));
            return Ok(());
        }
    }

    if let Some(root) = project_root.as_ref() {
        inject_agents_md(&env.home, root)?;
        inject_subfolder_indexes(root)?;
    }
    // Persist the union to the committed project manifest so a fresh machine
    // (empty global registry) re-pulls the same skills via `8sync harness`.
    if let Some(pm) = &proj_manifest {
        let _ = discover::write_registry(pm, &reg);
    }
    ui::info(&format!("updated {} skill(s) from {} source(s)", updated, sources));
    Ok(())
}

/// Filesystem-safe slug for a clone-cache subdir derived from a URL.
fn sanitize(url: &str) -> String {
    url.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// Remove the entries whose `builtin:` source this binary does not bundle; returns their names.
fn drop_unbundled_builtins(reg: &mut BTreeMap<String, discover::SkillEntry>) -> Vec<String> {
    let mut gone = Vec::new();
    reg.retain(|name, e| {
        let bundled = e.src.strip_prefix("builtin:").is_none_or(|b| !assets::iter_under(&format!("skills/{b}/")).is_empty());
        if !bundled {
            gone.push(name.clone());
        }
        bundled
    });
    gone
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_forgets_builtins_this_binary_no_longer_bundles() {
        let e = |src: &str| discover::SkillEntry { src: src.into(), when: None, rev: None };
        let mut reg: BTreeMap<String, discover::SkillEntry> = [
            ("deep-research", e("builtin:deep-research")),
            ("karpathy", e("builtin:karpathy")),
            ("trail", e("builtin:trail")),
            ("mine", e("https://github.com/owner/mine")),
            ("local", e("path:/x/local")),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        assert_eq!(drop_unbundled_builtins(&mut reg), ["deep-research", "karpathy"]);
        assert_eq!(reg.keys().map(String::as_str).collect::<Vec<_>>(), ["local", "mine", "trail"]);
    }
}
