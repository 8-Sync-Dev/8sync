//! ECC for omp: mirror the ECC checkout (`super::ecc`) into omp's own skill and command
//! dirs, so omp lists every ECC skill by name + description (bodies load on demand via
//! `skill://`) and runs every ECC command as `/ecc-<cmd>`:
//! - `<ECC>/skills/<name>/` → `~/.omp/agent/managed-skills/<name>/` (omp's priority-5
//!   provider: an authored skill of the same name, e.g. an 8sync bundled one, still wins);
//! - `<ECC>/commands/<cmd>.md` → `~/.omp/agent/commands/ecc-<cmd>.md`, with every
//!   `/<ecc command>` reference renamed `/ecc-<ecc command>` (the layout the owner made by hand).
//!
//! Agents are not copied: `/eccx-*` spawns a `task` subagent with `<ECC>/agents/<agent>.md`.
//!
//! The manifest `~/.omp/agent/.8sync-ecc.json` keeps the checkout commit last mirrored and
//! the hash of every copy written. A copy is replaced or removed only while it still has
//! that hash (or already equals upstream); one edited by the owner — or a same-named skill
//! omp's auto-learn wrote — is kept and reported. Runs only when the checkout moved.
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use super::ecc::{lf, tree_files};
use crate::verbs::skill::deploy::{copy_dir_recursive, fnv1a64};

const MANIFEST: &str = ".8sync-ecc.json";
/// Prefix of the omp command made from an ECC command.
const CMD_PREFIX: &str = "ecc-";

#[derive(Serialize, Deserialize, Default)]
struct Manifest {
    /// Checkout commit last mirrored.
    head: String,
    /// Skill name → hash of the tree written.
    skills: BTreeMap<String, u64>,
    /// ECC command name → hash of the omp command written.
    commands: BTreeMap<String, u64>,
}

/// Counts of one mirror pass.
#[derive(Default, Debug, PartialEq, Eq)]
pub(crate) struct Report {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    /// Copies left alone because they differ from what 8sync last wrote.
    pub kept: Vec<String>,
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "+{} new · {} updated · -{} removed (skills + /ecc-* commands)", self.added, self.updated, self.removed)?;
        if !self.kept.is_empty() {
            let shown: Vec<&str> = self.kept.iter().take(5).map(String::as_str).collect();
            write!(f, " · {} kept (edited locally: {}{})", self.kept.len(), shown.join(", "), if self.kept.len() > 5 { ", …" } else { "" })?;
        }
        Ok(())
    }
}

/// What to do with one member, from the hash on disk, upstream's hash and the recorded one.
#[derive(Debug, PartialEq, Eq)]
enum Act {
    Add,
    Same,
    Update,
    Keep,
}

fn decide(on_disk: Option<u64>, upstream: u64, recorded: Option<u64>) -> Act {
    match on_disk {
        None => Act::Add,
        Some(h) if h == upstream => Act::Same,
        Some(h) if Some(h) == recorded => Act::Update,
        Some(_) => Act::Keep,
    }
}

/// Mirror `ecc` (at commit `head`) into omp. `Ok(None)`: omp is not installed, or the
/// checkout has not moved since the last mirror.
pub(crate) fn sync(home: &Path, ecc: &Path, head: &str) -> Result<Option<Report>> {
    let agent = home.join(".omp/agent");
    if !agent.is_dir() {
        return Ok(None);
    }
    let mpath = agent.join(MANIFEST);
    let mut m: Manifest = std::fs::read_to_string(&mpath).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    if !head.is_empty() && m.head == head {
        return Ok(None);
    }
    let mut r = Report::default();
    mirror_skills(&ecc.join("skills"), &agent.join("managed-skills"), &mut m.skills, &mut r)?;
    mirror_commands(&ecc.join("commands"), &agent.join("commands"), &mut m.commands, &mut r)?;
    m.head = head.to_string();
    std::fs::write(&mpath, serde_json::to_string_pretty(&m)? + "\n").with_context(|| format!("write {}", mpath.display()))?;
    Ok(Some(r))
}

/// A member name safe to use as a file name, and not hidden.
fn safe(n: &str) -> bool {
    !n.is_empty() && !n.starts_with('.') && n.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

/// Order-stable hash of a tree's LF-normalised files.
fn tree_hash(dir: &Path) -> Option<u64> {
    let files = tree_files(dir)?;
    let mut s = String::new();
    for (rel, bytes) in &files {
        s.push_str(&format!("{rel}\t{:016x}\n", fnv1a64(bytes)));
    }
    Some(fnv1a64(s.as_bytes()))
}

fn mirror_skills(src: &Path, dst: &Path, rec: &mut BTreeMap<String, u64>, r: &mut Report) -> Result<()> {
    let mut upstream = BTreeMap::new();
    for e in std::fs::read_dir(src).with_context(|| format!("read {}", src.display()))?.flatten() {
        let Ok(n) = e.file_name().into_string() else { continue };
        if safe(&n) && e.path().join("SKILL.md").is_file() {
            if let Some(h) = tree_hash(&e.path()) {
                upstream.insert(n, h);
            }
        }
    }
    std::fs::create_dir_all(dst)?;
    for (n, h) in &upstream {
        let to = dst.join(n);
        let on_disk = if to.exists() { Some(tree_hash(&to).unwrap_or(0)) } else { None };
        match decide(on_disk, *h, rec.get(n).copied()) {
            Act::Same => {}
            Act::Keep => {
                r.kept.push(n.clone());
                continue;
            }
            act => {
                let _ = std::fs::remove_dir_all(&to);
                if let Err(e) = copy_dir_recursive(&src.join(n), &to) {
                    let _ = std::fs::remove_dir_all(&to); // no half skill that would then be "edited"
                    return Err(e.context(format!("copy ECC skill {n}")));
                }
                if act == Act::Add { r.added += 1 } else { r.updated += 1 }
            }
        }
        rec.insert(n.clone(), *h);
    }
    let gone: Vec<String> = rec.keys().filter(|n| !upstream.contains_key(*n)).cloned().collect();
    for n in gone {
        let to = dst.join(&n);
        if safe(&n) && to.is_dir() && tree_hash(&to) == rec.get(&n).copied() {
            std::fs::remove_dir_all(&to)?;
            r.removed += 1;
        }
        rec.remove(&n);
    }
    Ok(())
}

fn mirror_commands(src: &Path, dst: &Path, rec: &mut BTreeMap<String, u64>, r: &mut Report) -> Result<()> {
    let mut texts = BTreeMap::new();
    for e in std::fs::read_dir(src).with_context(|| format!("read {}", src.display()))?.flatten() {
        let Ok(f) = e.file_name().into_string() else { continue };
        let Some(n) = f.strip_suffix(".md").filter(|n| safe(n)) else { continue };
        if e.path().is_file() {
            texts.insert(n.to_string(), std::fs::read_to_string(e.path())?);
        }
    }
    let names: BTreeSet<&str> = texts.keys().map(String::as_str).collect();
    std::fs::create_dir_all(dst)?;
    for (n, text) in &texts {
        let body = omp_command(text, &names);
        let h = fnv1a64(&lf(body.clone().into_bytes()));
        let to = dst.join(format!("{CMD_PREFIX}{n}.md"));
        let on_disk = std::fs::read(&to).ok().map(|b| fnv1a64(&lf(b)));
        match decide(on_disk, h, rec.get(n).copied()) {
            Act::Same => {}
            Act::Keep => {
                r.kept.push(format!("/{CMD_PREFIX}{n}"));
                continue;
            }
            act => {
                std::fs::write(&to, &body).with_context(|| format!("write {}", to.display()))?;
                if act == Act::Add { r.added += 1 } else { r.updated += 1 }
            }
        }
        rec.insert(n.clone(), h);
    }
    let gone: Vec<String> = rec.keys().filter(|n| !texts.contains_key(*n)).cloned().collect();
    for n in gone {
        let to = dst.join(format!("{CMD_PREFIX}{n}.md"));
        if std::fs::read(&to).ok().map(|b| fnv1a64(&lf(b))) == rec.get(&n).copied() {
            std::fs::remove_file(&to)?;
            r.removed += 1;
        }
        rec.remove(&n);
    }
    Ok(())
}

/// ECC command text for omp: each `/<cmd>` naming an ECC command becomes `/ecc-<cmd>`.
/// A reference starts after start-of-line or a char that cannot be part of a path, URL or
/// word, and the name is the whole `[A-Za-z0-9_-]` run after the slash (`~/x/plan.md`,
/// `https://a/plan` and `/planner` stay).
fn omp_command(text: &str, names: &BTreeSet<&str>) -> String {
    let name_char = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    let mut out = String::with_capacity(text.len() + 64);
    let mut prev: Option<char> = None;
    let mut rest = text;
    while let Some(c) = rest.chars().next() {
        let at_ref = c == '/' && prev.is_none_or(|p| !(name_char(p) || matches!(p, '/' | '.' | ':')));
        if at_ref {
            let run = rest[1..].find(|ch: char| !name_char(ch)).map_or(&rest[1..], |end| &rest[1..1 + end]);
            if names.contains(run) {
                out.push('/');
                out.push_str(CMD_PREFIX);
                out.push_str(run);
                prev = run.chars().last();
                rest = &rest[1 + run.len()..];
                continue;
            }
        }
        out.push(c);
        prev = Some(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-eccomp-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn put(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    fn read(p: &Path) -> String {
        std::fs::read_to_string(p).unwrap()
    }

    #[test]
    fn command_references_get_the_ecc_prefix_only_where_they_are_commands() {
        let names: BTreeSet<&str> = ["plan", "aside", "code-review"].into();
        let src = "/aside <q>\nRun `/plan` then (/code-review).\n- /planner, ~/.claude/commands/plan.md, https://x.io/plan, a/plan, /ecc:plan\n/aside";
        assert_eq!(
            omp_command(src, &names),
            "/ecc-aside <q>\nRun `/ecc-plan` then (/ecc-code-review).\n- /planner, ~/.claude/commands/plan.md, https://x.io/plan, a/plan, /ecc:plan\n/ecc-aside"
        );
        assert_eq!(omp_command("đã /plan xong", &names), "đã /ecc-plan xong", "multi-byte neighbours");
    }

    #[test]
    fn decide_never_touches_what_8sync_did_not_write() {
        assert_eq!(decide(None, 1, None), Act::Add);
        assert_eq!(decide(Some(1), 1, None), Act::Same, "an identical copy is adopted");
        assert_eq!(decide(Some(2), 1, Some(2)), Act::Update);
        assert_eq!(decide(Some(3), 1, Some(2)), Act::Keep, "edited");
        assert_eq!(decide(Some(3), 1, None), Act::Keep, "not ours");
    }

    /// A checkout at commit `head` with skills `a`, `b` and commands `plan`, `aside`.
    fn ecc(d: &Path) -> PathBuf {
        let e = d.join("ecc");
        put(&e.join("skills/a/SKILL.md"), "---\nname: a\n---\nA v1\n");
        put(&e.join("skills/a/ref/x.md"), "x\n");
        put(&e.join("skills/b/SKILL.md"), "---\nname: b\n---\nB v1\n");
        put(&e.join("skills/not-a-skill/README.md"), "no SKILL.md\n");
        put(&e.join("commands/plan.md"), "---\ndescription: Plan\n---\nThen /aside.\n");
        put(&e.join("commands/aside.md"), "/aside q\n");
        e
    }

    #[test]
    fn mirrors_updates_removes_and_keeps_edits_and_learned_skills() {
        let d = tmp("sync");
        let home = d.join("home");
        let e = ecc(&d);
        assert_eq!(sync(&home, &e, "h1").unwrap(), None, "no omp → nothing written");
        let agent = home.join(".omp/agent");
        put(&agent.join("managed-skills/learned/SKILL.md"), "---\nname: learned\n---\nmine\n");
        put(&agent.join("commands/eccx-full.md"), "ours\n");

        let r = sync(&home, &e, "h1").unwrap().unwrap();
        assert_eq!((r.added, r.updated, r.removed, r.kept.len()), (4, 0, 0, 0), "{r}");
        let ms = agent.join("managed-skills");
        assert_eq!(read(&ms.join("a/ref/x.md")), "x\n");
        assert!(!ms.join("not-a-skill").exists());
        assert_eq!(read(&agent.join("commands/ecc-plan.md")), "---\ndescription: Plan\n---\nThen /ecc-aside.\n");
        assert_eq!(sync(&home, &e, "h1").unwrap(), None, "same commit → no work");

        // Upstream moves: a changes, b is dropped, c and /review arrive; the owner edited /ecc-aside.
        put(&e.join("skills/a/SKILL.md"), "---\nname: a\n---\nA v2\n");
        std::fs::remove_dir_all(e.join("skills/b")).unwrap();
        put(&e.join("skills/c/SKILL.md"), "---\nname: c\n---\nC\n");
        put(&e.join("commands/review.md"), "after /plan\n");
        put(&e.join("commands/aside.md"), "/aside v2\n");
        put(&agent.join("commands/ecc-aside.md"), "my own aside\n");
        let r = sync(&home, &e, "h2").unwrap().unwrap();
        assert_eq!((r.added, r.updated, r.removed), (2, 1, 1), "{r}");
        assert_eq!(r.kept, ["/ecc-aside"]);
        assert!(read(&ms.join("a/SKILL.md")).contains("A v2") && !ms.join("b").exists() && ms.join("c/SKILL.md").is_file());
        assert_eq!(read(&agent.join("commands/ecc-review.md")), "after /ecc-plan\n");
        assert_eq!(read(&agent.join("commands/ecc-aside.md")), "my own aside\n");
        assert_eq!(read(&ms.join("learned/SKILL.md")), "---\nname: learned\n---\nmine\n", "auto-learned skill untouched");
        assert_eq!(read(&agent.join("commands/eccx-full.md")), "ours\n");

        // An edited copy whose upstream disappears stays.
        put(&ms.join("c/SKILL.md"), "---\nname: c\n---\nC edited\n");
        std::fs::remove_dir_all(e.join("skills/c")).unwrap();
        let r = sync(&home, &e, "h3").unwrap().unwrap();
        assert_eq!(r.removed, 0);
        assert!(ms.join("c/SKILL.md").is_file());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn crlf_copies_count_as_unedited() {
        let d = tmp("crlf");
        let home = d.join("home");
        std::fs::create_dir_all(home.join(".omp/agent/managed-skills/a")).unwrap();
        let e = ecc(&d);
        put(&home.join(".omp/agent/managed-skills/a/SKILL.md"), "---\r\nname: a\r\n---\r\nA v1\r\n");
        put(&home.join(".omp/agent/managed-skills/a/ref/x.md"), "x\r\n");
        let r = sync(&home, &e, "h1").unwrap().unwrap();
        assert!(r.kept.is_empty(), "{r}");
        assert_eq!(r.added, 3, "b + 2 commands; a adopted");
        let _ = std::fs::remove_dir_all(&d);
    }
}
