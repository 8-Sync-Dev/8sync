//! `8sync skill add` — install a skill or skill-collection from a spec.
//!
//! Git specs are cloned shallow and every `SKILL.md` they carry is installed
//! (single-skill repo OR a `skills/<name>/` collection like addyosmani / ponytail).
//! Repos with no SKILL.md fall back to README-as-skill synthesis. `path:` specs
//! symlink a local dir; `builtin:` is a no-op note.
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

use super::deploy::copy_dir_recursive;
use super::discover::detect_current_project_root;
use super::inject::inject_agents_md;
use super::meta::audit_skill_layout;
use super::spec::{
    collect_repo_skills, fetch_github_readme, git_clone_at, github_owner_repo,
    install_path_skill, parse_spec, resolve_head_sha, synthesize_skill_md, write_synth_skill,
    Source,
};
use crate::{assets, env_detect, ui};

pub(crate) fn add_skill(env: &env_detect::Env, toml_path: &Path, spec: Option<&str>, force: bool) -> Result<()> {
    let Some(spec) = spec else {
        ui::err("usage: 8sync skill add <https URL|gh:owner/repo|path:/abs|builtin:name>");
        return Ok(());
    };
    let src = parse_spec(spec)?;
    let name = match &src {
        Source::Git { name, .. } => name.clone(),
        Source::Path { name, .. } => name.clone(),
        Source::Builtin { name } => name.clone(),
    };
    if name.is_empty() {
        return Err(anyhow!("empty skill name from `{}`", spec));
    }

    let project_root = detect_current_project_root();
    let global_target = env.home.join(".omp/skills").join(&name);
    // Every skill name actually installed (a collection repo yields many).
    let mut installed: Vec<String> = Vec::new();
    // Resolved commit SHA when the user pinned a ref (`<url>@<ref>`) → recorded
    // in skills.toml as a lockfile so updates/new machines reproduce it.
    let mut git_rev: Option<String> = None;

    match &src {
        Source::Git { url, git_ref, .. } => {
            // Clone shallow, then install every SKILL.md the repo carries:
            //   • repo-root SKILL.md      → single skill `<name>`
            //   • skills/<sub>/SKILL.md   → collection (addyosmani, ponytail, …)
            // Fall back to README-as-skill synthesis when neither layout matches.
            let tmp = env.home.join(".cache/8sync/skill-clone").join(&name);
            let _ = std::fs::remove_dir_all(&tmp);
            if let Some(p) = tmp.parent() { std::fs::create_dir_all(p)?; }
            let mut found: Vec<(String, PathBuf)> = Vec::new();
            match git_clone_at(url, &tmp, git_ref.as_deref()) {
                Ok(()) => found = collect_repo_skills(&tmp, &name),
                Err(e) => ui::warn(&format!("git clone failed ({}) — trying README synthesis", e)),
            }
            if found.is_empty() {
                let (owner, repo) = github_owner_repo(url)
                    .ok_or_else(|| anyhow!("only github.com URLs supported (got `{}`)", url))?;
                ui::info(&format!("synthesising SKILL.md from {}/{} README", owner, repo));
                let readme = fetch_github_readme(&owner, &repo)?;
                let body = synthesize_skill_md(&readme, &name, url);
                write_synth_skill(&global_target, &body)?;
                audit_skill_layout(&global_target);
                installed.push(name.clone());
            } else {
                ui::ok(&format!("{} → {} skill(s)", url, found.len()));
                for (sname, sdir) in &found {
                    let gt = env.home.join(".omp/skills").join(sname);
                    // Additive by default: don't clobber an already-installed skill.
                    if gt.exists() && !force {
                        ui::skip(sname, "already installed (--force to overwrite)");
                        installed.push(sname.clone());
                        continue;
                    }
                    let _ = std::fs::remove_dir_all(&gt);
                    copy_dir_recursive(sdir, &gt)?;
                    audit_skill_layout(&gt);
                    ui::ok(&format!("installed skill `{}`", sname));
                    installed.push(sname.clone());
                }
            }
            if git_ref.is_some() {
                git_rev = resolve_head_sha(&tmp);
            }
            let _ = std::fs::remove_dir_all(&tmp);
        }
        Source::Path { src, .. } => {
            if force {
                let _ = std::fs::remove_file(&global_target);
            }
            install_path_skill(src, &global_target)?;
            audit_skill_layout(&global_target);
            installed.push(name.clone());
        }
        Source::Builtin { .. } => {
            // Deploy the embedded asset tree `assets/skills/<name>/` → global.
            let prefix = format!("skills/{}", name);
            if assets::iter_under(&format!("{}/", prefix)).is_empty() {
                ui::warn(&format!("no bundled skill `{}` (assets/skills/{}/ not found)", name, name));
            } else if global_target.exists() && !force {
                ui::skip(&name, "already installed (--force to overwrite)");
                installed.push(name.clone());
            } else {
                let (w, _) = assets::install_tree(&prefix, &global_target)?;
                ui::ok(&format!("enabled builtin `{}` ({} file(s)) → {}", name, w, global_target.display()));
                audit_skill_layout(&global_target);
                installed.push(name.clone());
            }
        }
    }

    // Update skills.toml registry (idempotent append, one section per skill).
    if let Some(parent) = toml_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let src_val = match &src {
        Source::Git { url, .. } => url.clone(),
        Source::Path { src, .. } => format!("path:{}", src.display()),
        Source::Builtin { name } => format!("builtin:{}", name),
    };
    let mut registry = std::fs::read_to_string(toml_path).unwrap_or_default();
    for sname in &installed {
        if !registry.contains(&format!("[{}]", sname)) {
            if !registry.ends_with('\n') && !registry.is_empty() {
                registry.push('\n');
            }
            let rev_line = match &git_rev {
                Some(r) => format!("rev = \"{}\"\n", r),
                None => String::new(),
            };
            registry.push_str(&format!("\n[{}]\nsrc = \"{}\"\nwhen = \"on-demand\"\n{}", sname, src_val, rev_line));
        }
    }
    std::fs::write(toml_path, &registry)?;

    if let Some(root) = project_root.as_ref() {
        inject_agents_md(&env.home, root)?;
    }

    ui::info(&format!(
        "installed {} skill(s); omp picks them up next `omp --continue`.",
        installed.len()
    ));
    Ok(())
}
