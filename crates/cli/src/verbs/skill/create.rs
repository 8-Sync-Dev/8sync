//! `8sync skill new` — scaffold a spec-compliant skill directory, or a slash
//! command file, from nothing.
//!
//! `skill add` installs something that already exists; `skill gen` fuses skills
//! that are already installed. This is the missing third verb: authoring.
//!
//! Two modes, picked automatically from the cwd:
//!
//! * **dev** — inside a `su-code` checkout. The scaffold lands in
//!   `assets/skills/<name>/SKILL.md` or `assets/commands/<name>.md`, so it ships
//!   embedded on the next build. Nothing else is needed: the bundled registry
//!   enumerates `assets/` at deploy time, so a new file deploys with **zero Rust
//!   changes**.
//! * **user** — anywhere else. The scaffold lands straight in the live omp roots
//!   omp discovers: `~/.omp/skills/<name>/` (global) plus
//!   `<repo>/su-code/skills/<name>/` (project) for a skill;
//!   `~/.omp/agent/commands/<name>.md` (global) plus `<repo>/.omp/commands/<name>.md`
//!   (project) for a command.
//!
//! Never overwrites an existing skill/command without `--force` (the repo-wide
//! "default KHÔNG ĐÈ" invariant), and byte-compares before writing so a re-run
//! is a no-op.
use anyhow::{bail, Result};
use std::path::{Path, PathBuf};

use super::discover::detect_current_project_root;
use super::spec::yaml_quote;
use crate::{assets, env_detect, ui};

/// omp's managed-skill name cap (`[a-z0-9][a-z0-9-]{0,63}`).
const NAME_MAX: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Skill,
    Command,
}

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Kind::Skill => "skill",
            Kind::Command => "command",
        }
    }
}

/// Where a scaffold is allowed to land. Every path is injected rather than
/// re-detected inside the writers, so the whole thing is unit-testable without
/// touching the real `$HOME`.
pub(crate) struct CreateOpts {
    /// Overwrite an existing skill/command instead of refusing.
    pub(crate) force: bool,
    /// `$HOME` — root of the global omp layer (user mode).
    pub(crate) home: PathBuf,
    /// Nearest project root — gets the project-local mirror (user mode).
    pub(crate) project_root: Option<PathBuf>,
    /// `su-code` checkout root. `Some` ⇒ dev mode: author into `assets/`.
    pub(crate) dev_root: Option<PathBuf>,
}

impl CreateOpts {
    pub(crate) fn detect(env: &env_detect::Env, force: bool) -> Self {
        Self {
            force,
            home: env.home.clone(),
            project_root: detect_current_project_root(),
            dev_root: detect_su_code_root(),
        }
    }

    /// Files the scaffold is written to, primary (canonical) first.
    fn targets(&self, kind: Kind, name: &str) -> Vec<PathBuf> {
        if let Some(dev) = &self.dev_root {
            return match kind {
                Kind::Skill => vec![dev.join("assets/skills").join(name).join("SKILL.md")],
                Kind::Command => vec![dev.join("assets/commands").join(format!("{name}.md"))],
            };
        }
        let mut out = Vec::with_capacity(2);
        match kind {
            Kind::Skill => {
                out.push(self.home.join(".omp/skills").join(name).join("SKILL.md"));
                if let Some(root) = &self.project_root {
                    out.push(root.join("su-code/skills").join(name).join("SKILL.md"));
                }
            }
            Kind::Command => {
                out.push(self.home.join(".omp/agent/commands").join(format!("{name}.md")));
                if let Some(root) = &self.project_root {
                    out.push(root.join(".omp/commands").join(format!("{name}.md")));
                }
            }
        }
        out
    }

    /// Paths whose mere existence means "this name is taken". For a skill that
    /// is the *directory* — a skill dir carrying only `references/` still owns
    /// the name.
    fn collision_paths(&self, kind: Kind, name: &str) -> Vec<PathBuf> {
        self.targets(kind, name)
            .into_iter()
            .map(|p| match kind {
                Kind::Skill => p.parent().map(Path::to_path_buf).unwrap_or(p),
                Kind::Command => p,
            })
            .collect()
    }
}

/// Walk up from the cwd to the enclosing `su-code` checkout, if any. Identified
/// by the asset tree plus the CLI manifest, so an unrelated repo that happens to
/// have an `assets/` dir is not mistaken for one.
pub(crate) fn detect_su_code_root() -> Option<PathBuf> {
    let mut p = std::env::current_dir().ok()?;
    loop {
        if p.join("assets/skills").is_dir()
            && p.join("assets/commands").is_dir()
            && p.join("crates/cli/Cargo.toml").is_file()
        {
            return Some(p);
        }
        if !p.pop() {
            return None;
        }
    }
}

/// Reject anything omp would not discover, or that would escape its root.
/// `[a-z0-9][a-z0-9-]*`, ≤ 64 chars, no trailing dash.
pub(crate) fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() {
        bail!("empty name — usage: 8sync skill new <name> [description…]");
    }
    if name.len() > NAME_MAX {
        bail!("name `{name}` is {} chars — omp caps skill/command names at {NAME_MAX}", name.len());
    }
    let alnum = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();
    if let Some(bad) = name.chars().find(|c| !(alnum(*c) || *c == '-')) {
        bail!(
            "name `{name}` contains `{bad}` — only lowercase a-z, 0-9 and `-` are allowed \
             (kebab-case, e.g. `code-review`)"
        );
    }
    if !name.starts_with(alnum) {
        bail!("name `{name}` must start with a letter or digit");
    }
    if name.ends_with('-') {
        bail!("name `{name}` must not end with `-`");
    }
    Ok(())
}

/// `code-review` → `Code Review`.
fn title_case(name: &str) -> String {
    name.split('-')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_ascii_uppercase().to_string() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Description used when the author gave none. Deliberately loud: the
/// `description` IS the trigger omp matches on, so an unfilled one is a bug.
fn default_description(kind: Kind, name: &str) -> String {
    match kind {
        Kind::Skill => format!(
            "FILL ME — describe WHEN the agent must load this. Use when the user mentions \"{}\".",
            name.replace('-', " ")
        ),
        Kind::Command => format!("FILL ME — one line: what /{name} does and when to reach for it."),
    }
}

/// A spec-compliant `SKILL.md`: Agent-Skills frontmatter + a body skeleton the
/// author replaces section by section.
pub(crate) fn skill_md(name: &str, description: &str) -> String {
    let title = title_case(name);
    format!(
        "---\n\
         name: {name}\n\
         description: {desc}\n\
         ---\n\
         \n\
         # {title}\n\
         \n\
         One paragraph: what this skill makes the agent DO, in the imperative. Not what it is.\n\
         \n\
         ## When to use\n\
         \n\
         - <the phrase the user actually types>\n\
         - <the situation the agent should recognise on its own>\n\
         - Skip it when <the cheaper path that already covers this> — ponytail: the best skill is\n\
         \u{20} the one you did not have to write.\n\
         \n\
         ## Procedure\n\
         \n\
         1. **Ground** — read <the file / state / tool output> first; never guess.\n\
         2. **Act** — the real, runnable steps:\n\
         \u{20}  ```bash\n\
         \u{20}  <the actual command>\n\
         \u{20}  ```\n\
         3. **Verify** — <the check that fails if step 2 silently did nothing>.\n\
         \n\
         ## Guardrails\n\
         \n\
         - <what this skill must never do>\n\
         - <the irreversible action it must stop and ask about>\n",
        name = name,
        desc = yaml_quote(description),
        title = title,
    )
}

/// A slash command in the house format (see `assets/commands/auto.md`):
/// `name` / `argument-hint` / `description` frontmatter, a `$ARGUMENTS` line, a
/// numbered workflow, guardrails, and a `Begin:` imperative.
pub(crate) fn command_md(name: &str, description: &str, argument_hint: &str) -> String {
    let title = title_case(name);
    // The asset keeps the bare stem, but omp registers a command by its DEPLOYED
    // filename — so the frontmatter and the heading must say the name a user can
    // actually type, or the scaffold documents a command that does not exist.
    let deployed = crate::brand::cmd_file(&format!("{name}.md"));
    let invoked = deployed.trim_end_matches(".md");
    format!(
        "---\n\
         name: {invoked}\n\
         argument-hint: '{hint}'\n\
         description: {desc}\n\
         ---\n\
         \n\
         # /{invoked} — {title}\n\
         \n\
         `$ARGUMENTS` = <what the argument means; say \"(none)\" if the command takes none>.\n\
         \n\
         ## 0. Ground\n\
         \n\
         Read <the state this command depends on> before acting. Obey\n\
         `~/.omp/agent/APPEND_SYSTEM.md` (code-intel first). Explore with codegraph\n\
         (cbm / serena only if enabled) — never grep-everything.\n\
         \n\
         ## 1. Workflow\n\
         \n\
         1. <first concrete step, with the command that performs it>\n\
         2. <second step>\n\
         3. <the verification that proves it worked>\n\
         \n\
         ## Guardrails\n\
         \n\
         - <what this command must never do>\n\
         - NO `git push` / PR unless explicitly asked.\n\
         \n\
         Begin: <the first action, in the imperative>.\n",
        invoked = invoked,
        hint = argument_hint.replace('\'', ""),
        desc = yaml_quote(description),
        title = title,
    )
}

/// Scaffold a skill. Returns the canonical `SKILL.md` path.
pub(crate) fn create_skill(name: &str, description: &str, opts: &CreateOpts) -> Result<PathBuf> {
    scaffold(Kind::Skill, name, description, opts, |n, d| skill_md(n, d))
}

/// Scaffold a slash command. Returns the canonical `<name>.md` path.
pub(crate) fn create_command(name: &str, description: &str, opts: &CreateOpts) -> Result<PathBuf> {
    scaffold(Kind::Command, name, description, opts, |n, d| {
        command_md(n, d, "[<args>]")
    })
}

fn scaffold(
    kind: Kind,
    name: &str,
    description: &str,
    opts: &CreateOpts,
    render: impl Fn(&str, &str) -> String,
) -> Result<PathBuf> {
    validate_name(name)?;
    if !opts.force {
        if let Some(taken) = first_collision(kind, name, opts) {
            bail!(
                "{} `{name}` already exists at {} — pick another name, or re-run with --force to \
                 overwrite it",
                kind.label(),
                taken
            );
        }
    }

    let owned;
    let description = if description.trim().is_empty() {
        owned = default_description(kind, name);
        ui::warn(&format!(
            "no description given — wrote a placeholder. omp matches on `description`; rewrite it \
             before the {} is worth anything.",
            kind.label()
        ));
        owned.as_str()
    } else {
        description.trim()
    };

    let body = render(name, description);
    let targets = opts.targets(kind, name);
    let Some(primary) = targets.first().cloned() else {
        bail!("no writable target for {} `{name}` (no $HOME and no project root)", kind.label());
    };
    for t in &targets {
        write_managed(t, &body)?;
    }
    Ok(primary)
}

/// First already-taken location, as a printable string. Checks the on-disk
/// targets, and — in user mode only — the embedded bundle, because a bundled
/// skill of the same name would shadow the new one at deploy time. In dev mode
/// the on-disk `assets/` tree IS the bundle, so checking it twice is noise.
fn first_collision(kind: Kind, name: &str, opts: &CreateOpts) -> Option<String> {
    if let Some(p) = opts.collision_paths(kind, name).into_iter().find(|p| p.exists()) {
        return Some(p.display().to_string());
    }
    if opts.dev_root.is_none() {
        let prefix = match kind {
            Kind::Skill => format!("skills/{name}/"),
            Kind::Command => format!("commands/{name}.md"),
        };
        if !assets::iter_under(&prefix).is_empty() {
            return Some(format!("<bundled>/{prefix}"));
        }
    }
    None
}

/// Byte-compare before writing so a re-run is a genuine no-op (prompt-cache
/// stability: an unchanged file must keep its mtime).
fn write_managed(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::read_to_string(path).is_ok_and(|prev| prev == content) {
        ui::skip(&path.display().to_string(), "unchanged");
        return Ok(());
    }
    std::fs::write(path, content)?;
    ui::ok(&format!("wrote {}", path.display()));
    Ok(())
}

/// `8sync skill new …` — smart-arg entry point.
///
/// Shapes accepted (one verb, several input shapes — AGENTS.md §8):
/// ```text
/// 8sync skill new <name>                       skill, placeholder description
/// 8sync skill new <name> <description words…>  skill, description from the rest of the line
/// 8sync skill new <name> --desc "…"            same, explicit
/// 8sync skill new --command <name> <desc…>     slash command instead of a skill
/// 8sync skill new command <name> <desc…>       same, bare word
/// 8sync skill new <name> --force               overwrite an existing one
/// ```
pub(crate) fn run_new(env: &env_detect::Env, args: &[String]) -> Result<()> {
    let mut kind = Kind::Skill;
    let mut force = false;
    let mut desc_flag: Option<String> = None;
    let mut expect_desc = false;
    let mut positional: Vec<&str> = Vec::new();

    for a in args {
        let s = a.as_str();
        if expect_desc {
            desc_flag = Some(s.to_string());
            expect_desc = false;
            continue;
        }
        match s {
            "--command" | "--cmd" | "-c" => kind = Kind::Command,
            "--skill" | "-s" => kind = Kind::Skill,
            "--force" | "-f" => force = true,
            "--desc" | "--description" | "-d" => expect_desc = true,
            _ if s.starts_with("--desc=") => desc_flag = Some(s["--desc=".len()..].to_string()),
            _ if s.starts_with("--description=") => {
                desc_flag = Some(s["--description=".len()..].to_string())
            }
            _ if s.starts_with('-') => ui::warn(&format!("ignoring unknown flag `{s}`")),
            _ => positional.push(s),
        }
    }
    if expect_desc {
        bail!("--desc needs a value");
    }
    // `new command <name>` / `new skill <name>` — kind as a bare word. Only when
    // something follows it, so `8sync skill new command` still names a skill
    // `command`.
    if positional.len() >= 2 {
        match positional[0] {
            "command" | "cmd" => {
                kind = Kind::Command;
                positional.remove(0);
            }
            "skill" => {
                positional.remove(0);
            }
            _ => {}
        }
    }

    let Some(name) = positional.first().copied() else {
        ui::err("usage: 8sync skill new <name> [description…] [--command] [--force]");
        ui::info("examples: 8sync skill new flaky-test-triage \"Use when a CI test fails intermittently.\"");
        ui::info("          8sync skill new --command ship-notes \"Draft release notes from the diff.\"");
        return Ok(());
    };
    let description = desc_flag.unwrap_or_else(|| positional[1..].join(" "));

    let opts = CreateOpts::detect(env, force);
    let mode = if opts.dev_root.is_some() { "dev (assets/)" } else { "user (~/.omp)" };
    ui::step(&format!("scaffolding {} `{}` — {} mode", kind.label(), name, mode));

    let path = match kind {
        Kind::Skill => create_skill(name, &description, &opts)?,
        Kind::Command => create_command(name, &description, &opts)?,
    };

    match kind {
        Kind::Skill if opts.dev_root.is_none() => {
            // A new project-local skill must appear in the AGENTS.md force-load
            // block, same as `skill add` / `skill gen`.
            if let Some(root) = &opts.project_root {
                super::inject::inject_agents_md(&opts.home, root)?;
            }
        }
        Kind::Skill => ui::info("bundled skill: run `8sync harness init` to deploy it after the next build"),
        Kind::Command if opts.dev_root.is_some() => {
            ui::info("bundled command: deploys automatically — no Rust change needed")
        }
        Kind::Command => ui::info(&format!("use it as `/{name}` in the next omp session")),
    }
    ui::info(&format!("next: open {} and replace every <placeholder>", path.display()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verbs::skill::meta::read_skill_meta;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("8sync-create-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn dev_opts(root: &Path, force: bool) -> CreateOpts {
        CreateOpts {
            force,
            home: root.join("home"),
            project_root: None,
            dev_root: Some(root.to_path_buf()),
        }
    }

    /// The name is a filesystem path component AND omp's discovery key — every
    /// shape omp would refuse (or that would escape the skills root) must fail
    /// here, with a message, not on disk.
    #[test]
    fn name_validation_rejects_bad_input() {
        for bad in [
            "",
            "Upper",
            "has space",
            "-leading",
            "trailing-",
            "under_score",
            "../escape",
            "dir/sub",
            "dot.name",
            "emoji🚀",
        ] {
            assert!(validate_name(bad).is_err(), "must reject {bad:?}");
        }
        assert!(validate_name(&"a".repeat(NAME_MAX + 1)).is_err(), "must reject over-long name");
        for good in ["a", "z9", "code-review", "flaky-test-triage", &"a".repeat(NAME_MAX)] {
            assert!(validate_name(good).is_ok(), "must accept {good:?}");
        }
    }

    /// The scaffold has to be a real skill, not a text blob: the same parser
    /// 8sync uses everywhere else must read back the name and description.
    #[test]
    fn create_skill_produces_parsable_frontmatter() {
        let root = tmp("skill");
        std::fs::create_dir_all(root.join("assets/skills")).unwrap();
        let desc = "Use when a CI test fails intermittently: triage the flake.";
        let p = create_skill("flaky-test-triage", desc, &dev_opts(&root, false)).unwrap();

        assert_eq!(p, root.join("assets/skills/flaky-test-triage/SKILL.md"));
        let meta = read_skill_meta(&p).unwrap().expect("frontmatter must parse");
        assert_eq!(meta.name, "flaky-test-triage");
        assert_eq!(meta.description, desc);
        let body = std::fs::read_to_string(&p).unwrap();
        assert!(body.starts_with("---\n"), "must open with frontmatter");
        assert!(body.contains("# Flaky Test Triage"), "title derived from the name");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A command lands as one `.md` in BOTH omp command roots in user mode, with
    /// the three house frontmatter keys.
    #[test]
    fn create_command_writes_both_user_roots() {
        let root = tmp("cmd");
        let home = root.join("home");
        let proj = root.join("proj");
        let opts = CreateOpts {
            force: false,
            home: home.clone(),
            project_root: Some(proj.clone()),
            dev_root: None,
        };
        let p = create_command("ship-notes", "Draft release notes from the diff.", &opts).unwrap();
        assert_eq!(p, home.join(".omp/agent/commands/ship-notes.md"));
        assert!(proj.join(".omp/commands/ship-notes.md").is_file(), "project mirror written");

        let body = std::fs::read_to_string(&p).unwrap();
        assert!(body.starts_with("---\nname: sx-ship-notes\n"), "scaffold must declare the INVOKED name");
        assert!(body.contains("\nargument-hint: '[<args>]'\n"));
        assert!(body.contains("\ndescription: \"Draft release notes from the diff.\"\n"));
        assert!(body.contains("$ARGUMENTS"), "house format threads the argument through");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Default-KHÔNG-ĐÈ: a second `new` on the same name is an error, and only
    /// an explicit `--force` overwrites. A skill *directory* owns the name even
    /// when its SKILL.md is gone.
    #[test]
    fn collision_is_refused_without_force() {
        let root = tmp("collide");
        std::fs::create_dir_all(root.join("assets/skills")).unwrap();
        let p = create_skill("dup-check", "First.", &dev_opts(&root, false)).unwrap();

        let err = create_skill("dup-check", "Second.", &dev_opts(&root, false)).unwrap_err();
        assert!(err.to_string().contains("--force"), "message must name the escape hatch: {err}");
        assert!(std::fs::read_to_string(&p).unwrap().contains("First."), "original untouched");

        // Directory without SKILL.md still owns the name.
        std::fs::remove_file(&p).unwrap();
        assert!(create_skill("dup-check", "Third.", &dev_opts(&root, false)).is_err());

        create_skill("dup-check", "Fourth.", &dev_opts(&root, true)).unwrap();
        assert!(std::fs::read_to_string(&p).unwrap().contains("Fourth."), "--force overwrites");
        let _ = std::fs::remove_dir_all(&root);
    }
}
