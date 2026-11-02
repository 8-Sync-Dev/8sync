//! The ECC layer of the harness. A shallow checkout of upstream ECC's default
//! branch lives at `~/.cache/8sync/ecc` and refreshes itself: every 6 h from the
//! detached release probe any 8sync command spawns, on `harness init/up/global`
//! when the last fetch is older than 6 h, and at once on `harness up --pull`.
//! Offline → the last checkout stays in use, never an error.
//!
//! From that checkout:
//! - omp gets ECC's skills and commands (`super::ecc_omp`), refreshed whenever the
//!   checkout moves; Claude Code reads the same checkout (`ecc-pick`, `/eccx-*`);
//! - a repo gets ECC's `rules/` packs for the stacks it uses, copied into
//!   `<repo>/.claude/rules/ecc/<pack>/` (never over an existing pack dir), with the
//!   generic `common/` rules scoped by `paths:` so they stop loading every turn.
//!
//! Stacks are detected with ECC's own `config/project-stack-mappings.json`
//! (indicators `{file, contains}`, `*`/`?` globs) over the repo root and its
//! first-level non-hidden sub-dirs.
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
/// What the tag-pinned checkout (≤ v0.114) wrote into the cache; removed on the first refresh.
const LEGACY_PIN_FILE: &str = ".8sync-pin";
/// Epoch seconds of the last successful fetch, beside the checkout (not inside it).
const STAMP_FILE: &str = "ecc.fetched";
/// A harness run fetches again only after this long (the release probe has its own 6 h gate).
const REFRESH_S: u64 = 6 * 3600;
const MAPPINGS: &str = "config/project-stack-mappings.json";
/// Dependency/build output: never scanned for stack indicators.
const SKIP: [&str; 7] = ["node_modules", "target", "dist", "build", ".next", "vendor", ".venv"];
/// Indicator files larger than this are not read for `contains`.
const MAX_INDICATOR_BYTES: u64 = 2_000_000;

/// How a caller may touch the network for the checkout.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Fetch {
    /// Launch paths: the cache only.
    No,
    /// Harness commands: fetch when the last fetch is older than [`REFRESH_S`].
    IfDue,
    /// `harness up --pull` and the 6 h release probe.
    Now,
}

/// The per-project ECC layer every harness path runs: retire the vendored skill
/// layout, refresh the checkout (per `fetch`) and mirror it into omp, then seed and
/// scope the rule packs for the repo's stacks. Never fails the caller.
pub(crate) fn project_layer(home: &Path, root: &Path, fetch: Fetch) {
    retire_vendored_skills(home, root);
    if let Some(ecc) = global_layer(home, fetch) {
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
    // Also after ECC's own installer rewrote `common/` without `paths:`.
    let scoped = scope_common_rules(root);
    if !scoped.is_empty() {
        ui::ok(&format!("ECC rules: `paths:` scoped {} generic rule(s) in .claude/rules/ecc/common/ ({})", scoped.len(), scoped.join(", ")));
    }
}

/// The machine-wide ECC layer: refresh the checkout (per `fetch`), then mirror it
/// into omp when it moved since the last mirror (a few stats otherwise). Returns
/// the checkout. Never fails the caller.
pub(crate) fn global_layer(home: &Path, fetch: Fetch) -> Option<PathBuf> {
    let ecc = checkout(home, fetch)?;
    let head = head(&ecc).unwrap_or_default();
    match super::ecc_omp::sync(home, &ecc, &head) {
        Ok(Some(r)) => ui::ok(&format!("ECC {} → omp: {r}", version(&ecc))),
        Ok(None) => {}
        Err(e) => ui::warn(&format!("ECC → omp skipped: {e:#}")),
    }
    Some(ecc)
}

// ── the checkout ────────────────────────────────────────────────────────────────

/// `~/.cache/8sync/ecc`: the checkout every ECC consumer reads.
pub(crate) fn cache_dir(home: &Path) -> PathBuf {
    home.join(".cache/8sync/ecc")
}

/// The commit the checkout is at, read from `.git` (no process: launch paths call this).
pub(crate) fn head(dir: &Path) -> Option<String> {
    let git = dir.join(".git");
    let raw = std::fs::read_to_string(git.join("HEAD")).ok()?;
    let raw = raw.trim();
    let Some(r) = raw.strip_prefix("ref: ") else { return Some(raw.to_string()) };
    if let Ok(sha) = std::fs::read_to_string(git.join(r)) {
        return Some(sha.trim().to_string());
    }
    let packed = std::fs::read_to_string(git.join("packed-refs")).ok()?;
    packed.lines().find_map(|l| l.strip_suffix(r).and_then(|s| s.strip_suffix(' ')).map(str::to_string))
}

/// `2.2.3@b38be6a` (ECC's `VERSION` + short commit), for messages.
pub(crate) fn version(dir: &Path) -> String {
    let v = std::fs::read_to_string(dir.join("VERSION")).map(|v| v.trim().to_string()).unwrap_or_else(|_| "?".into());
    match head(dir) {
        Some(h) => format!("{v}@{}", &h[..h.len().min(7)]),
        None => v,
    }
}

/// Whether a fetch is due: no stamp, garbage, older than [`REFRESH_S`], or from the future.
fn fetch_due(stamp: &str, now: u64) -> bool {
    stamp.trim().parse::<u64>().map_or(true, |t| t > now || now - t > REFRESH_S)
}

fn now_s() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// The ECC checkout, refreshed per `fetch`. A failed fetch (offline) keeps the
/// last checkout; None only when there is none and it could not be cloned.
fn checkout(home: &Path, fetch: Fetch) -> Option<PathBuf> {
    let dir = cache_dir(home);
    let stamp = dir.with_file_name(STAMP_FILE);
    let due = match fetch {
        Fetch::No => false,
        Fetch::Now => true,
        Fetch::IfDue => fetch_due(&std::fs::read_to_string(&stamp).unwrap_or_default(), now_s()),
    };
    let usable = |d: &Path| d.join(MAPPINGS).is_file();
    if due {
        let ok = if dir.join(".git").is_dir() { pull(&dir) } else { clone(&dir) };
        if ok && usable(&dir) {
            let _ = std::fs::write(&stamp, now_s().to_string());
            let _ = std::fs::remove_file(dir.join(LEGACY_PIN_FILE));
        } else if usable(&dir) {
            ui::warn(&format!("ECC: could not fetch {ECC_REPO} (offline?) — keeping {}", version(&dir)));
        } else {
            ui::warn(&format!("ECC skipped: could not clone {ECC_REPO} (offline?) — re-run `8sync harness up --pull` later"));
        }
    }
    usable(&dir).then_some(dir)
}

/// `git` with no prompt and a stall limit, so an offline or captive network fails fast.
fn git() -> Command {
    let mut c = Command::new("git");
    c.env("GIT_TERMINAL_PROMPT", "0")
        .args(["-c", "advice.detachedHead=false", "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=30"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    c
}

/// Move the checkout to upstream's default-branch tip (depth 1).
fn pull(dir: &Path) -> bool {
    let ok = |c: &mut Command| c.status().is_ok_and(|s| s.success());
    ok(git().arg("-C").arg(dir).args(["fetch", "--quiet", "--depth", "1", ECC_REPO, "HEAD"]))
        && ok(git().arg("-C").arg(dir).args(["checkout", "--quiet", "--force", "--detach", "FETCH_HEAD"]))
}

/// First clone, beside the cache then swapped in: a concurrent run never sees half a tree.
fn clone(dir: &Path) -> bool {
    let tmp = dir.with_file_name(format!("ecc.tmp-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    if let Some(p) = tmp.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    let cloned = git().args(["clone", "--quiet", "--depth", "1", ECC_REPO]).arg(&tmp).status().is_ok_and(|s| s.success());
    if !cloned || !tmp.join(MAPPINGS).is_file() {
        let _ = std::fs::remove_dir_all(&tmp);
        return false;
    }
    let _ = std::fs::remove_dir_all(dir);
    if std::fs::rename(&tmp, dir).is_err() {
        let _ = std::fs::remove_dir_all(&tmp); // a concurrent run swapped first
    }
    true
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

/// Source-code globs the generic ECC rules are about.
const CODE: &[&str] = &["**/*.rs", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go"];

/// `paths:` per generic `common/` rule. `security.md` and `git-workflow.md` gate commits, so
/// they stay always-on. Without `paths:` Claude Code loads all ten (~18 KB, ~4.6k tokens) into
/// every main turn and every subagent's first turn (A/B in su-code: prefix 50 244 → 43 560).
fn rule_scope(name: &str) -> Option<Vec<&'static str>> {
    Some(match name {
        "code-review.md" | "coding-style.md" | "development-workflow.md" | "patterns.md" => CODE.to_vec(),
        "testing.md" => CODE.iter().copied().chain(["**/tests/**"]).collect(),
        "agents.md" => vec![".claude/agents/**"],
        "hooks.md" => vec!["**/hooks.json", "**/hooks/**", ".claude/settings*.json"],
        "performance.md" => vec![".claude/settings*.json", ".claude/agents/**"],
        _ => return None,
    })
}

/// Prepend `paths:` frontmatter to each generic rule in `<root>/.claude/rules/ecc/common/`
/// that has no frontmatter yet; a file already starting with `---` (scoped, or edited by the
/// owner) is left alone. Returns the files changed.
fn scope_common_rules(root: &Path) -> Vec<String> {
    let dir = root.join(".claude/rules/ecc/common");
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else { return out };
    let mut names: Vec<String> = entries.flatten().filter_map(|e| e.file_name().into_string().ok()).collect();
    names.sort();
    for name in names {
        let Some(globs) = rule_scope(&name) else { continue };
        let path = dir.join(&name);
        let Ok(text) = std::fs::read_to_string(&path) else { continue };
        if text.starts_with("---\n") || text.starts_with("---\r\n") {
            continue;
        }
        let head: String = globs.iter().map(|g| format!("  - \"{g}\"\n")).collect();
        if std::fs::write(&path, format!("---\npaths:\n{head}---\n{text}")).is_ok() {
            out.push(name);
        }
    }
    out
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
pub(super) fn tree_files(dir: &Path) -> Option<BTreeMap<String, Vec<u8>>> {
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

pub(super) fn lf(b: Vec<u8>) -> Vec<u8> {
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
    fn launch_uses_any_cached_checkout_without_network() {
        let home = tmp("cache");
        let dir = cache_dir(&home);
        assert!(checkout(&home, Fetch::No).is_none(), "no cache, no network");
        write(&dir.join(MAPPINGS), r#"{"stacks":[]}"#);
        write(&dir.join(LEGACY_PIN_FILE), "v2.2.3\n");
        assert_eq!(checkout(&home, Fetch::No), Some(dir.clone()), "the tag-pinned cache is still usable");
        assert!(dir.join(LEGACY_PIN_FILE).exists(), "only a successful fetch retires the pin file");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn fetch_is_due_after_six_hours_or_on_a_bad_stamp() {
        let now = 1_800_000_000;
        assert!(!fetch_due(&now.to_string(), now));
        assert!(!fetch_due(&format!("{}\n", now - REFRESH_S), now));
        assert!(fetch_due(&(now - REFRESH_S - 1).to_string(), now));
        assert!(fetch_due("", now) && fetch_due("x", now) && fetch_due(&(now + 60).to_string(), now));
    }

    #[test]
    fn head_reads_detached_branch_and_packed_refs() {
        let d = tmp("head");
        assert_eq!(head(&d), None);
        let sha = "b38be6a7f6350964d59328b52f0624e1d1d552d1";
        write(&d.join(".git/HEAD"), &format!("{sha}\n"));
        write(&d.join("VERSION"), "2.2.3\n");
        assert_eq!(head(&d).as_deref(), Some(sha));
        assert_eq!(version(&d), "2.2.3@b38be6a");
        write(&d.join(".git/HEAD"), "ref: refs/heads/main\n");
        write(&d.join(".git/packed-refs"), &format!("# pack-refs\n{sha} refs/heads/main\n"));
        assert_eq!(head(&d).as_deref(), Some(sha), "packed");
        write(&d.join(".git/refs/heads/main"), "c05b2d6614f62f6db0047669aa4eefb223d478f9\n");
        assert_eq!(head(&d).as_deref(), Some("c05b2d6614f62f6db0047669aa4eefb223d478f9"), "loose ref wins");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn generic_rules_get_paths_once_and_commit_gates_and_edits_stay() {
        let d = tmp("scope");
        let common = d.join(".claude/rules/ecc/common");
        assert!(scope_common_rules(&d).is_empty(), "no rules dir");
        write(&common.join("agents.md"), "# Agent Orchestration\n");
        write(&common.join("testing.md"), "# Testing\r\nbody\r\n");
        write(&common.join("security.md"), "# Security\n");
        write(&common.join("coding-style.md"), "---\npaths:\n  - \"src/**\"\n---\n# mine\n");
        assert_eq!(scope_common_rules(&d), ["agents.md", "testing.md"]);
        let read = |n: &str| std::fs::read_to_string(common.join(n)).unwrap();
        assert_eq!(read("agents.md"), "---\npaths:\n  - \".claude/agents/**\"\n---\n# Agent Orchestration\n");
        assert!(read("testing.md").starts_with("---\npaths:\n  - \"**/*.rs\"\n") && read("testing.md").contains("  - \"**/tests/**\"\n---\n# Testing\r\n"));
        assert_eq!(read("security.md"), "# Security\n", "commit gate stays always-on");
        assert_eq!(read("coding-style.md"), "---\npaths:\n  - \"src/**\"\n---\n# mine\n", "owner's frontmatter kept");
        assert!(scope_common_rules(&d).is_empty(), "idempotent");
        let _ = std::fs::remove_dir_all(&d);
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
