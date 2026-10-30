//! Auto-install external skill collections (ponytail) into the global
//! `~/.omp/skills/`. Best-effort + idempotent (skipped when a sentinel
//! sub-skill is already present); never fails `harness init` when offline.
//! addyosmani/agent-skills is no longer pulled: the ECC plugin covers it.
use anyhow::Result;

use crate::env_detect;
use crate::ui;
use crate::verbs::skill::deploy::copy_dir_recursive;
use crate::verbs::skill::spec::{collect_repo_skills, git_clone_shallow};

/// (clone URL, sentinel sub-skill that proves the pack is already installed).
const PACKS: &[(&str, &str)] = &[
    ("https://github.com/DietrichGebert/ponytail.git", "ponytail-review"),
];

/// Clone each external pack and install every `skills/<name>/SKILL.md` it carries
/// into `~/.omp/skills/`. Returns the number of skills newly installed.
pub(crate) fn install_external_skill_packs(env: &env_detect::Env) -> Result<usize> {
    let skills_dir = env.home.join(".omp/skills");
    let mut total = 0usize;
    for (url, sentinel) in PACKS {
        if skills_dir.join(sentinel).exists() {
            ui::skip(sentinel, "external pack already installed");
            continue;
        }
        let tmp = env.home.join(".cache/8sync/ext-pack").join(sentinel);
        let _ = std::fs::remove_dir_all(&tmp);
        if let Some(p) = tmp.parent() {
            std::fs::create_dir_all(p)?;
        }
        if let Err(e) = git_clone_shallow(url, &tmp) {
            ui::warn(&format!("skip external pack {} ({})", url, e));
            continue;
        }
        let found = collect_repo_skills(&tmp, "");
        let mut n = 0usize;
        for (sname, sdir) in &found {
            if sname.is_empty() {
                continue;
            }
            let gt = skills_dir.join(sname);
            let _ = std::fs::remove_dir_all(&gt);
            if copy_dir_recursive(sdir, &gt).is_ok() {
                n += 1;
            }
        }
        let _ = std::fs::remove_dir_all(&tmp);
        ui::ok(&format!("external pack {} → {} skill(s)", url, n));
        total += n;
    }
    Ok(total)
}
