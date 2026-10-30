//! The per-project layer of the ECC-only harness. Skills, agents and commands
//! come from the global Claude Code plugin `ecc@ecc`; a repo gets only ECC's
//! `rules/` packs for the stacks it uses, copied into
//! `<repo>/.claude/rules/ecc/<pack>/` (never over an existing pack dir).
//!
//! Stacks are detected with ECC's own `config/project-stack-mappings.json`
//! (indicators `{file, contains}`, `*`/`?` globs) over the repo root and its
//! first-level non-hidden sub-dirs. The ECC source is a shallow checkout of a
//! pinned tag cached at `~/.cache/8sync/ecc`, re-cloned only when the pin
//! changes; offline → skipped with a warning, never an error.
//!
//! Also retires the layout 8sync used before: vendored `su-code/skills/` copies
//! and the `.claude/skills` / `.cursor/skills` / `.zcode/skills` links to them.
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;

use crate::verbs::skill::{deploy, discover};
use crate::{assets, ui};

const ECC_REPO: &str = "https://github.com/affaan-m/ECC";
/// Bump to move every machine to a newer ECC release (re-clones the cache once).
const ECC_TAG: &str = "v2.2.3";
const PIN_FILE: &str = ".8sync-pin";
const MAPPINGS: &str = "config/project-stack-mappings.json";
/// Dependency/build output: never scanned for stack indicators.
const SKIP: [&str; 7] = ["node_modules", "target", "dist", "build", ".next", "vendor", ".venv"];
/// Indicator files larger than this are not read for `contains`.
const MAX_INDICATOR_BYTES: u64 = 2_000_000;

/// The per-project ECC layer every harness path runs: retire the vendored skill
/// layout, then seed the rule packs for the repo's stacks. `fetch` lets it clone
/// the pinned checkout (harness commands); launch paths pass false (no network
/// on launch) and use the cache only. Never fails the caller.
pub(crate) fn project_layer(home: &Path, root: &Path, fetch: bool) {
    retire_vendored_skills(home, root);
    let Some(ecc) = checkout(home, fetch) else { return };
    let seeded = detect(&ecc, root).and_then(|(ids, packs)| Ok((ids, seed_rules(&ecc, root, &packs)?)));
    match seeded {
        Ok((ids, packs)) => {
            let added: Vec<&str> = packs.iter().filter(|(_, a)| *a).map(|(p, _)| p.as_str()).collect();
            if !added.is_empty() {
                let stacks = if ids.is_empty() { "none detected".to_string() } else { ids.join(", ") };
                ui::ok(&format!("ECC rules → .claude/rules/ecc/ ({}) · stacks: {stacks}", added.join(", ")));
            }
        }
        Err(e) => ui::warn(&format!("ECC rules skipped: {e:#}")),
    }
}

// ── pinned checkout ─────────────────────────────────────────────────────────────

fn is_current(dir: &Path) -> bool {
    std::fs::read_to_string(dir.join(PIN_FILE)).is_ok_and(|p| p.trim() == ECC_TAG) && dir.join(MAPPINGS).is_file()
}

/// The ECC checkout at [`ECC_TAG`]: the cache when it carries the pin; else,
/// with `fetch`, a fresh shallow clone swapped into place. None when the cache
/// is stale and `fetch` is off, or the clone failed (offline).
fn checkout(home: &Path, fetch: bool) -> Option<PathBuf> {
    let dir = home.join(".cache/8sync/ecc");
    if is_current(&dir) {
        return Some(dir);
    }
    if !fetch {
        return None;
    }
    // Clone beside the cache, then swap: a concurrent run never sees half a tree.
    let tmp = dir.with_file_name(format!("ecc.tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    if let Some(p) = tmp.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let cloned = Command::new("git")
        .args(["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", ECC_TAG, ECC_REPO])
        .arg(&tmp)
        .stdin(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !cloned || std::fs::write(tmp.join(PIN_FILE), ECC_TAG).is_err() || !is_current(&tmp) {
        let _ = std::fs::remove_dir_all(&tmp);
        ui::warn(&format!("ECC rules skipped: could not clone {ECC_REPO} @ {ECC_TAG} (offline?) — re-run `8sync harness` later"));
        return None;
    }
    let _ = std::fs::remove_dir_all(&dir);
    if std::fs::rename(&tmp, &dir).is_err() {
        let _ = std::fs::remove_dir_all(&tmp); // a concurrent run swapped first
    }
    is_current(&dir).then_some(dir)
}

// ── stack detection ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct Mappings {
    stacks: Vec<Stack>,
}

#[derive(Deserialize)]
struct Stack {
    id: String,
    indicators: Vec<Indicator>,
    #[serde(default)]
    rules: Vec<String>,
}

#[derive(Deserialize)]
struct Indicator {
    file: String,
    contains: Option<String>,
}

/// Stacks detected in `root` (ids, mapping order) and the rule packs they need:
/// `common` first, deduped, only packs the checkout actually ships.
fn detect(ecc: &Path, root: &Path) -> Result<(Vec<String>, Vec<String>)> {
    let path = ecc.join(MAPPINGS);
    let raw = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let map: Mappings = serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    let dirs = scan_dirs(root);
    let (mut ids, mut packs) = (Vec::new(), vec!["common".to_string()]);
    for s in map.stacks {
        if s.indicators.iter().any(|i| hits(&dirs, i)) {
            for r in s.rules {
                if !packs.contains(&r) {
                    packs.push(r);
                }
            }
            ids.push(s.id);
        }
    }
    packs.retain(|p| ecc.join("rules").join(p).is_dir());
    Ok((ids, packs))
}

/// The repo root plus its first-level non-hidden sub-dirs (monorepos keep
/// `web/`, `backend/`, `apps` one level down).
fn scan_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![root.to_path_buf()];
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let name = e.file_name();
        let Some(n) = name.to_str() else { continue };
        if !n.starts_with('.') && !SKIP.contains(&n) && e.file_type().is_ok_and(|t| t.is_dir()) {
            dirs.push(e.path());
        }
    }
    dirs
}

fn hits(dirs: &[PathBuf], ind: &Indicator) -> bool {
    dirs.iter().any(|d| {
        std::fs::read_dir(d).into_iter().flatten().flatten().any(|e| {
            let name = e.file_name();
            if !name.to_str().is_some_and(|n| glob(ind.file.as_bytes(), n.as_bytes())) {
                return false;
            }
            let Some(needle) = &ind.contains else { return true };
            let p = e.path();
            std::fs::metadata(&p).is_ok_and(|m| m.is_file() && m.len() < MAX_INDICATOR_BYTES)
                && std::fs::read_to_string(&p).is_ok_and(|t| t.contains(needle.as_str()))
        })
    })
}

/// `*` = any run, `?` = one byte, everything else literal (case-sensitive).
fn glob(pat: &[u8], s: &[u8]) -> bool {
    match (pat.first(), s.first()) {
        (None, None) => true,
        (Some(b'*'), _) => glob(&pat[1..], s) || (!s.is_empty() && glob(pat, &s[1..])),
        (Some(b'?'), Some(_)) => glob(&pat[1..], &s[1..]),
        (Some(p), Some(c)) if p == c => glob(&pat[1..], &s[1..]),
        _ => false,
    }
}

/// Copy each pack's `rules/<pack>` into `<root>/.claude/rules/ecc/<pack>/`. An
/// existing pack dir is never touched. Returns `(pack, added)` per pack.
fn seed_rules(ecc: &Path, root: &Path, packs: &[String]) -> Result<Vec<(String, bool)>> {
    let base = root.join(".claude/rules/ecc");
    let mut out = Vec::with_capacity(packs.len());
    for p in packs {
        let dst = base.join(p);
        if std::fs::symlink_metadata(&dst).is_ok() {
            out.push((p.clone(), false));
            continue;
        }
        if let Err(e) = deploy::copy_dir_recursive(&ecc.join("rules").join(p), &dst) {
            let _ = std::fs::remove_dir_all(&dst); // no half pack that would then be "kept"
            return Err(e.context(format!("copy ECC rules/{p}")));
        }
        out.push((p.clone(), true));
    }
    Ok(out)
}

// ── retire the vendored layout ──────────────────────────────────────────────────

/// Host skill dirs 8sync used to link to `su-code/skills/`.
const HOST_LINKS: [&str; 3] = [".claude/skills", ".cursor/skills", ".zcode/skills"];

/// Retire the per-project skill layout 8sync vendored before the ECC cutover:
/// the host links into `su-code/skills/`, each `su-code/skills/<name>` that is
/// an 8sync skill (bundled, registered in a `skills.toml`, or in the global
/// `~/.omp/skills` library the mirror copied from) AND an unedited copy of its
/// source — so a byte-identical copy always survives outside the repo — or a
/// link 8sync made; then the emptied tree and the `skillOverrides: name-only`
/// keys 8sync wrote. Anything else is kept and reported. A tree the owner
/// registered as a workspace skill library is left alone entirely.
fn retire_vendored_skills(home: &Path, root: &Path) {
    let tree = root.join("su-code/skills");
    if deploy::skill_libraries(home).iter().any(|l| deploy::same_dir(l, &tree)) {
        return;
    }
    for rel in HOST_LINKS {
        let p = root.join(rel);
        let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
        if !deploy::is_link(&meta) || !links_to_tree(&p, &tree) {
            continue;
        }
        match deploy::remove_link_or_dir(&p) {
            Ok(()) => ui::ok(&format!("removed {rel} (link to su-code/skills)")),
            Err(e) => ui::warn(&format!("could not remove {}: {e}", p.display())),
        }
    }

    let known = known_skills(home, root);
    let mut listed: BTreeSet<String> = BTreeSet::new();
    let (mut removed, mut kept) = (0usize, Vec::new());
    for e in std::fs::read_dir(&tree).into_iter().flatten().flatten() {
        let Some(name) = e.file_name().to_str().map(str::to_string) else { continue };
        let p = e.path();
        let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
        listed.insert(name.clone());
        let ours = known.contains(&name)
            && (deploy::is_link(&meta) || (meta.is_dir() && is_unedited_copy(home, &name, &p)));
        if !ours {
            kept.push(name);
            continue;
        }
        match deploy::remove_link_or_dir(&p) {
            Ok(()) => removed += 1,
            Err(e) => ui::warn(&format!("could not remove {}: {e}", p.display())),
        }
    }
    if removed > 0 {
        ui::ok(&format!("retired {removed} vendored 8sync skill(s) from su-code/skills/ (skills come from the ECC plugin now)"));
    }
    if !kept.is_empty() {
        let shown = kept.iter().take(8).cloned().collect::<Vec<_>>().join(", ");
        let more = if kept.len() > 8 { format!(" +{} more", kept.len() - 8) } else { String::new() };
        ui::info(&format!("su-code/skills/: kept {} entry(ies) that are not unedited 8sync copies: {shown}{more} — yours to keep or delete", kept.len()));
    }
    if std::fs::read_dir(&tree).is_ok_and(|mut d| d.next().is_none()) {
        let _ = std::fs::remove_dir(&tree);
    }

    listed.extend(known);
    let settings = root.join(".claude/settings.local.json");
    if let Ok(raw) = std::fs::read_to_string(&settings) {
        match strip_name_only(&raw, &listed) {
            Some(None) => {
                if std::fs::remove_file(&settings).is_ok() {
                    ui::ok("removed .claude/settings.local.json (it held only 8sync's skill listing overrides)");
                }
            }
            Some(Some(out)) => {
                if std::fs::write(&settings, out).is_ok() {
                    ui::ok("dropped 8sync's skillOverrides from .claude/settings.local.json");
                }
            }
            None => {}
        }
    }
}

/// Whether link `p` resolves to `tree`, or (when the tree is already gone) its
/// text still names `su-code/skills`.
fn links_to_tree(p: &Path, tree: &Path) -> bool {
    deploy::same_dir(p, tree)
        || std::fs::read_link(p).is_ok_and(|t| t.to_string_lossy().replace('\\', "/").trim_end_matches('/').ends_with("su-code/skills"))
}

/// Every skill name 8sync ever listed for this repo: the bundled ones, the
/// registered ones (global registry + the project manifest) and the global library.
fn known_skills(home: &Path, root: &Path) -> BTreeSet<String> {
    let mut names: BTreeSet<String> = assets::iter_under("skills/")
        .iter()
        .filter_map(|p| p.strip_prefix("skills/")?.split_once('/').map(|(n, _)| n.to_string()))
        .collect();
    let registries = super::legacy::config_dirs(home).into_iter().map(|d| d.join("skills.toml")).chain([root.join("su-code/skills.toml")]);
    for reg in registries {
        names.extend(discover::read_registry(&reg).into_keys());
    }
    for d in discover::list_installed_skill_dirs(&home.join(".omp/skills")).unwrap_or_default() {
        if let Some(n) = d.file_name().and_then(|s| s.to_str()) {
            names.insert(n.to_string());
        }
    }
    names
}

/// `dir` holds exactly the bundled tree of `name`, or exactly its global copy
/// `~/.omp/skills/<name>` (the source 8sync mirrored from) — never when that
/// global copy IS this dir (a `path:` skill whose source lives here).
fn is_unedited_copy(home: &Path, name: &str, dir: &Path) -> bool {
    let Some(local) = tree_files(dir) else { return false };
    let bundled = bundled_files(name);
    if !bundled.is_empty() && bundled == local {
        return true;
    }
    let global = home.join(".omp/skills").join(name);
    global.is_dir() && !deploy::same_dir(&global, dir) && tree_files(&global).is_some_and(|g| g == local)
}

/// LF-normalised contents of every file under `dir` keyed by `/`-relative path
/// (`.git` skipped, empty dirs ignored, symlinks followed). None if unreadable.
fn tree_files(dir: &Path) -> Option<BTreeMap<String, Vec<u8>>> {
    fn walk(d: &Path, base: &Path, out: &mut BTreeMap<String, Vec<u8>>) -> Option<()> {
        for e in std::fs::read_dir(d).ok()?.flatten() {
            if e.file_name() == ".git" {
                continue;
            }
            let p = e.path();
            if std::fs::metadata(&p).ok()?.is_dir() {
                walk(&p, base, out)?;
            } else {
                let rel = p.strip_prefix(base).ok()?.to_string_lossy().replace('\\', "/");
                out.insert(rel, lf(std::fs::read(&p).ok()?));
            }
        }
        Some(())
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out)?;
    Some(out)
}

/// The bundled tree of `name` exactly as `assets::install_tree` deploys it.
fn bundled_files(name: &str) -> BTreeMap<String, Vec<u8>> {
    let prefix = format!("skills/{name}/");
    assets::iter_under(&prefix)
        .into_iter()
        .filter_map(|p| {
            let rel = p.strip_prefix(&prefix)?.to_string();
            let bytes = assets::read_bytes(&p)?;
            let bytes = if rel.ends_with(".md") || rel.ends_with(".txt") {
                crate::brand::render(&String::from_utf8(bytes).ok()?).into_owned().into_bytes()
            } else {
                bytes
            };
            Some((rel, lf(bytes)))
        })
        .collect()
}

fn lf(b: Vec<u8>) -> Vec<u8> {
    if !b.contains(&b'\r') {
        return b;
    }
    String::from_utf8(b).map(|s| s.replace("\r\n", "\n").into_bytes()).unwrap_or_else(|e| e.into_bytes())
}

/// Pure: `raw` settings without the `skillOverrides` keys 8sync wrote (value
/// `"name-only"` for a skill in `names`). None = nothing to change; Some(None)
/// = nothing left, delete the file; Some(Some(text)) = the rewritten file.
fn strip_name_only(raw: &str, names: &BTreeSet<String>) -> Option<Option<String>> {
    let mut v: Value = serde_json::from_str(raw).ok()?;
    let obj = v.as_object_mut()?;
    let over = obj.get_mut("skillOverrides")?.as_object_mut()?;
    let before = over.len();
    over.retain(|k, val| !(*val == "name-only" && names.contains(k)));
    if over.len() == before {
        return None;
    }
    if over.is_empty() {
        obj.remove("skillOverrides");
    }
    if obj.is_empty() {
        return Some(None);
    }
    Some(Some(serde_json::to_string_pretty(&v).ok()? + "\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-ecc-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(p: &Path, s: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, s).unwrap();
    }

    /// A miniature ECC checkout: the real indicator shapes for the stacks the
    /// fixture repo uses, plus one that must not fire.
    fn ecc_fixture(d: &Path) -> PathBuf {
        let ecc = d.join("ecc");
        write(
            &ecc.join(MAPPINGS),
            r#"{"version":1,"stacks":[
              {"id":"typescript","indicators":[{"file":"tsconfig.json"},{"file":"tsconfig.*.json"},{"file":"package.json","contains":"typescript"}],"rules":["common","typescript"]},
              {"id":"javascript","indicators":[{"file":"package.json"},{"file":".eslintrc*"}],"rules":["common","typescript"]},
              {"id":"react","indicators":[{"file":"package.json","contains":"\"react\":"}],"rules":["common","typescript","web","react"]},
              {"id":"golang","indicators":[{"file":"go.mod"}],"rules":["common","golang"]},
              {"id":"rust","indicators":[{"file":"Cargo.toml"},{"file":"Cargo.lock"}],"rules":["common","rust"]},
              {"id":"ruby","indicators":[{"file":"Gemfile"}],"rules":["common"]},
              {"id":"docker","indicators":[{"file":"Dockerfile"}],"rules":[]}
            ]}"#,
        );
        for p in ["common", "typescript", "web", "react", "golang", "rust"] {
            write(&ecc.join("rules").join(p).join("coding-style.md"), &format!("# {p} rules\n"));
        }
        ecc
    }

    #[test]
    fn globs_match_like_ecc_indicators() {
        assert!(glob(b"tsconfig.*.json", b"tsconfig.app.json"));
        assert!(!glob(b"tsconfig.*.json", b"tsconfig.json"));
        assert!(glob(b".eslintrc*", b".eslintrc.cjs") && glob(b".eslintrc*", b".eslintrc"));
        assert!(glob(b"*.csproj", b"App.csproj") && !glob(b"*.csproj", b"App.csproj.user"));
        assert!(glob(b"Cargo.toml", b"Cargo.toml") && !glob(b"Cargo.toml", b"cargo.toml"));
    }

    #[test]
    fn detects_rust_and_react_in_a_subdir_and_skips_deps_and_hidden_dirs() {
        let d = tmp("detect");
        let ecc = ecc_fixture(&d);
        let repo = d.join("repo");
        write(&repo.join("Cargo.toml"), "[package]\nname = \"x\"\n");
        write(&repo.join("web/package.json"), r#"{"dependencies":{"react":"^19.0.0"}}"#);
        // never scanned: dependency output and hidden dirs, nor two levels down
        write(&repo.join("node_modules/go.mod"), "module x\n");
        write(&repo.join(".hidden/go.mod"), "module x\n");
        write(&repo.join("web/deep/go.mod"), "module x\n");
        let (ids, packs) = detect(&ecc, &repo).unwrap();
        assert_eq!(ids, ["javascript", "react", "rust"]);
        assert_eq!(packs, ["common", "typescript", "web", "react", "rust"]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn rules_copy_never_overwrites_an_existing_pack() {
        let d = tmp("seed");
        let ecc = ecc_fixture(&d);
        let repo = d.join("repo");
        write(&repo.join("Cargo.toml"), "");
        write(&repo.join(".claude/rules/ecc/rust/coding-style.md"), "# my edited rust rules\n");
        let (_, packs) = detect(&ecc, &repo).unwrap();
        let got = seed_rules(&ecc, &repo, &packs).unwrap();
        assert_eq!(got, [("common".to_string(), true), ("rust".to_string(), false)]);
        let base = repo.join(".claude/rules/ecc");
        assert_eq!(std::fs::read_to_string(base.join("common/coding-style.md")).unwrap(), "# common rules\n");
        assert_eq!(std::fs::read_to_string(base.join("rust/coding-style.md")).unwrap(), "# my edited rust rules\n");
        // second run: everything exists, nothing written
        assert!(seed_rules(&ecc, &repo, &packs).unwrap().iter().all(|(_, added)| !added));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn only_a_pinned_cache_is_used_without_fetch() {
        let home = tmp("pin");
        let dir = home.join(".cache/8sync/ecc");
        assert!(checkout(&home, false).is_none(), "no cache, no network");
        write(&dir.join(MAPPINGS), r#"{"stacks":[]}"#);
        write(&dir.join(PIN_FILE), "v0.0.1\n");
        assert!(checkout(&home, false).is_none(), "an older pin is stale");
        write(&dir.join(PIN_FILE), ECC_TAG);
        assert_eq!(checkout(&home, false), Some(dir));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn retire_deletes_identical_copies_keeps_edits_and_user_skills_removes_links() {
        let d = tmp("retire");
        let (home, root) = (d.join("home"), d.join("repo"));
        let tree = root.join("su-code/skills");
        // bundled + unedited (plus the empty layout dirs 8sync added) → removed
        assets::install_tree("skills/ponytail", &tree.join("ponytail")).unwrap();
        std::fs::create_dir_all(tree.join("ponytail/scripts")).unwrap();
        // bundled but edited → kept
        assets::install_tree("skills/karpathy-guidelines", &tree.join("karpathy-guidelines")).unwrap();
        write(&tree.join("karpathy-guidelines/SKILL.md"), "my own take\n");
        // registered (global copy is the source), CRLF checkout of the same bytes → removed
        write(&home.join(".omp/skills/foo/SKILL.md"), "---\nname: foo\n---\nbody\n");
        write(&home.join(".config/8sync/skills.toml"), "[foo]\nsrc = \"https://github.com/x/foo\"\n");
        write(&tree.join("foo/SKILL.md"), "---\r\nname: foo\r\n---\r\nbody\r\n");
        // the owner's own skill → kept
        write(&tree.join("mine/SKILL.md"), "---\nname: mine\n---\n");
        // host links 8sync made
        let linked: Vec<&str> = HOST_LINKS
            .into_iter()
            .filter(|rel| deploy::link_dir(&tree, &root.join(rel), &Path::new("..").join("su-code").join("skills")).is_ok_and(|how| how == "link"))
            .collect();
        assert!(!linked.is_empty(), "fixture could not create a single host link");
        // 8sync's listing overrides next to an owner setting
        write(
            &root.join(".claude/settings.local.json"),
            r#"{"skillOverrides":{"ponytail":"name-only","foo":"name-only","mine":"name-only","x-own":"name-only","impeccable":"off"},"model":"opus"}"#,
        );

        retire_vendored_skills(&home, &root);

        assert!(!tree.join("ponytail").exists() && !tree.join("foo").exists(), "unedited copies go");
        assert_eq!(std::fs::read_to_string(tree.join("karpathy-guidelines/SKILL.md")).unwrap(), "my own take\n");
        assert!(tree.join("mine/SKILL.md").is_file(), "user skill kept");
        for rel in linked {
            assert!(std::fs::symlink_metadata(root.join(rel)).is_err(), "{rel} link removed");
        }
        let s: Value = serde_json::from_str(&std::fs::read_to_string(root.join(".claude/settings.local.json")).unwrap()).unwrap();
        assert_eq!(s["skillOverrides"], serde_json::json!({"x-own":"name-only","impeccable":"off"}), "only 8sync's keys go");
        assert_eq!(s["model"], "opus");

        // second pass: nothing more to remove; the kept ones stay
        retire_vendored_skills(&home, &root);
        assert!(tree.join("mine/SKILL.md").is_file() && tree.join("karpathy-guidelines").is_dir());

        // once the owner clears the rest, the empty tree goes too
        std::fs::remove_dir_all(tree.join("mine")).unwrap();
        std::fs::remove_dir_all(tree.join("karpathy-guidelines")).unwrap();
        retire_vendored_skills(&home, &root);
        assert!(!tree.exists(), "empty su-code/skills removed");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn settings_holding_only_8sync_overrides_are_deleted() {
        let names: BTreeSet<String> = ["a".to_string()].into();
        assert_eq!(strip_name_only(r#"{"skillOverrides":{"a":"name-only"}}"#, &names), Some(None));
        assert_eq!(strip_name_only(r#"{"skillOverrides":{"a":"off"}}"#, &names), None, "owner's value");
        assert_eq!(strip_name_only(r#"{"model":"x"}"#, &names), None);
        assert_eq!(strip_name_only("not json", &names), None);
    }
}
