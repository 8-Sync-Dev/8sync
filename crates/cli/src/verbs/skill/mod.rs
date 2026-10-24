//! `8sync skill` — manage the skill library (list / add / gen).
//!
//! Deploying the bundled library, mirroring it into a project, force-load
//! injection, memory + CHANGELOG seeding live in `8sync harness init`
//! (see `verbs::harness`). This verb is the per-skill toolbox.
use anyhow::Result;
use clap::Args as ClapArgs;

use crate::{env_detect, ui};

pub(crate) mod add;
pub(crate) mod create;
pub(crate) mod deploy;
pub(crate) mod discover;
pub(crate) mod gen;
pub(crate) mod index;
pub(crate) mod inject;
pub(crate) mod learn;
pub(crate) mod list;
pub(crate) mod meta;
pub(crate) mod spec;
pub(crate) mod update;

// Re-exports consumed by other verbs (here, harness).
pub(crate) use index::inject_subfolder_indexes;
pub(crate) use inject::inject_agents_md;

#[derive(ClapArgs, Debug)]
#[command(after_help = indoc::indoc! {"
    EXAMPLES
      8sync skill                                                list installed skills (global + project-local) with descriptions
      8sync skill list                                           same as above
      8sync skill help                                           explain the auto-inject flow and config paths
      8sync skill add https://github.com/addyosmani/agent-skills install a skill OR a whole skills/<name>/ collection
      8sync skill add gh:owner/repo                              same, short form
      8sync skill add path:/abs/path#better-name                 register a local dir (symlink), optionally renamed
      8sync skill add builtin:karpathy-guidelines                register a builtin skill (already shipped)
      8sync skill new flaky-test-triage 'Use when a CI test flakes.'   SCAFFOLD a new skill (SKILL.md + body skeleton)
      8sync skill new --command ship-notes 'Draft release notes.'      scaffold a new slash command instead
      8sync skill new command ship-notes                               same, bare word; add --force to overwrite
      8sync skill gen 1 2                                        FUSE local skill #1 and #2 into one combined SKILL.md
      8sync skill gen karpathy-guidelines trail              same, but by name
      8sync skill learn donnemartin/system-design-primer         DISTIL a repo README (≤6 KB SKILL.md + refs/, .git dropped) into ~/.claude/skills/ — local only
      8sync skill update [name]                                  re-pull registered skills from their source (git/builtin/path)

    NOTE
      Deploy + force-load + memory + CHANGELOG → `8sync harness init`
      (the old `8sync skill sync` was renamed to `8sync harness init`).

    SPEC
      Each skill is a directory containing `SKILL.md` at its root (Anthropic Agent
      Skills open standard). YAML frontmatter MUST set `name:` and `description:`.
      A collection repo (`skills/<name>/SKILL.md`) installs every sub-skill.

    FILES
      ~/.config/8sync/skills.toml      skill registry (editable TOML)
      ~/.omp/skills/                   global skill directories (one per skill)
      ~/.omp/skills/00-force-load.md   master file — omp reads this first in every session
      <project>/su-code/skills/         project-local skills (referenced from AGENTS.md)
"})]
pub struct Args {
    /// Sub-action: list (default) | help | new <name> | add <spec> | gen <id> <id> … | update [name]
    pub sub: Option<String>,
    /// Arguments for the sub-action.
    /// - `add`: source spec (one)
    /// - `new`: `<name> [description…]`, plus `--command` / `--force` / `--desc <text>`
    /// - `gen`: 2+ skill IDs (1-based index from local list, OR skill name)
    #[arg(trailing_var_arg = true)]
    pub args: Vec<String>,
}

pub fn run(a: Args) -> Result<()> {
    let env = env_detect::Env::detect()?;
    let skills_toml = env.xdg_config.join("8sync/skills.toml");
    match a.sub.as_deref() {
        None | Some("list") => list::list_skills(&env, &skills_toml),
        Some("help") => list::print_help(&env, &skills_toml),
        Some("add") => {
            let force = a.args.iter().any(|s| s == "--force" || s == "-f");
            let spec = a.args.iter().find(|s| !s.starts_with('-')).map(|s| s.as_str());
            add::add_skill(&env, &skills_toml, spec, force)
        }
        Some("learn") => learn::run(&env, &a.args),
        Some("new") => create::run_new(&env, &a.args),
        Some("gen") => gen::gen_skill(&env, &a.args),
        Some("update") => update::update_skills(&env, &skills_toml, a.args.first().map(|s| s.as_str())),
        Some(other) => {
            if other == "sync" {
                ui::warn("`8sync skill sync` đã đổi tên → chạy `8sync harness init`.");
            } else {
                ui::warn(&format!("unknown subcommand: {}", other));
            }
            ui::info("try: 8sync skill help  (hoặc: 8sync harness init)");
            Ok(())
        }
    }
}
