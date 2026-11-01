// `8sync clean scan` — cross-platform disk anomaly tracking + a deletion PLAN.
//
// Born from the 2026-11-01 manual cleanup (su-code/CLEANUP-2026-11-01.md):
//  - `du` follows junctions → a 0.3 GB node_modules measured 151 GB. All sizing
//    here is no-follow (symlink/junction dirs count 0 and are flagged `link`).
//  - pnpm hardlinks its store → logical bytes overstate what a delete frees.
//    We report `bytes` (logical) and `unique` (nlink == 1) per entry.
//  - Models must NEVER appear in a delete plan → a protected list + model file
//    extensions keep them out; they are only reported.
//  - A plan is a *proposal*: `--apply <group>` is the only thing that deletes,
//    guarded (path must sit under a scanned root, never a root itself, never
//    protected, never an entry containing `.git` — those are listed as `review`).
//
//   8sync clean scan                measure roots, snapshot, report anomalies + write plan
//   8sync clean scan --root DIR     scan extra roots (repeatable; adds to disk.toml roots)
//   8sync clean scan --apply GROUP  scratch|artifacts|outputs|all — run the saved plan
//   8sync clean scan --watch 86400  loop daily (cross-platform; --timer stays systemd/Linux)
//   8sync clean scan --json         machine-readable report on stdout

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::{brand, ui};

// ── config (seed-if-missing, user-owned afterwards) ─────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct DiskConfig {
    /// Extra roots to scan on top of the built-in defaults (Downloads, ~/tmp,
    /// /tmp, C:/tmp — whichever exist). Absolute; `~` expanded.
    pub roots: Vec<String>,
    /// Names (matched against any path component) that are NEVER deleted and
    /// never appear in a plan — only reported with their size.
    pub protected: Vec<String>,
    pub thresholds: Thresholds,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Thresholds {
    pub scratch_days: u64,  // a tmp-root entry older than this is scratch
    pub outputs_days: u64,  // files under output/outputs dirs older than this
    pub anomaly_gb: u64,    // root grew ≥ this since last snapshot → anomaly
    pub anomaly_pct: u64,   // …or grew ≥ this percent (noise floor 500 MB)
    pub entry_gb: u64,      // new/grown top-level entry ≥ this → anomaly
}

impl Default for Thresholds {
    fn default() -> Self {
        Self { scratch_days: 10, outputs_days: 14, anomaly_gb: 10, anomaly_pct: 20, entry_gb: 5 }
    }
}

impl Default for DiskConfig {
    fn default() -> Self {
        Self {
            roots: Vec::new(),
            protected: [
                "huggingface", "comfyui", "torch", "ollama", "models", "model-hub",
                "checkpoints", "loras", "sd", "mfa-align", "miniconda", "micromamba",
                ".git", "node_modules", // node_modules: report-only (hardlinks lie; pnpm store prune is the real fix)
            ]
            .into_iter()
            .map(String::from)
            .collect(),
            thresholds: Thresholds::default(),
        }
    }
}

const MODEL_EXT: [&str; 7] = ["safetensors", "gguf", "ckpt", "pt", "pth", "bin", "onnx"];
const ARTIFACT_NAMES: [&str; 8] =
    ["node_modules", "target", "dist", ".next", "build", ".turbo", ".parcel-cache", ".vite"];
const OUTPUT_NAMES: [&str; 2] = ["output", "outputs"];

fn config_path(home: &Path) -> PathBuf {
    brand::config_dir(home).join("disk.toml")
}

fn state_dir(home: &Path) -> PathBuf {
    home.join(".local/state").join(brand::NS).join("disk")
}

fn load_config(home: &Path) -> Result<DiskConfig> {
    let p = config_path(home);
    if !p.exists() {
        if let Some(dir) = p.parent() {
            fs::create_dir_all(dir).ok();
        }
        let body = toml::to_string_pretty(&DiskConfig::default())?;
        fs::write(&p, format!("# 8sync clean scan config — edit freely; deletions only happen via `--apply`\n{body}"))
            .with_context(|| format!("seed {}", p.display()))?;
        ui::info(&format!("seeded {}", p.display()));
        return Ok(DiskConfig::default());
    }
    toml::from_str(&fs::read_to_string(&p)?).with_context(|| format!("parse {}", p.display()))
}

fn default_roots(home: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = vec![home.join("Downloads"), home.join("tmp")];
    if std::env::var_os("SUSYNC_DISK_HOME").is_none() {
        roots.push(PathBuf::from("/tmp"));
        roots.push(PathBuf::from("C:/tmp"));
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for r in roots.into_iter().filter(|p| p.is_dir()) {
        // canonicalize: same dir reached via /tmp, C:/tmp or a verbatim path
        // must dedupe to one entry — otherwise sizes double and the apply
        // guard's parent comparison misses (mixed verbatim/non-verbatim).
        let c = r.canonicalize().unwrap_or(r);
        if !out.contains(&c) {
            out.push(c);
        }
    }
    out
}

// ── measurement ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Class {
    Scratch,
    Artifact,
    Output,
    Protected,
    Review, // candidate but contains .git — needs human eyes
    Keep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub bytes: u64,     // logical size of regular files (no-follow)
    pub unique: u64,    // bytes of files with nlink == 1 (what a delete really frees, lower bound)
    pub age_days: u64,  // mtime age of the entry itself
    pub class: Class,
    pub link: bool,     // top level is a symlink/junction → sizes are 0
}

/// Depth-first size, never following symlinks/junctions. Returns
/// (logical_bytes, unique_bytes, contains_git, contains_protected).
pub fn tree_bytes(p: &Path, protected: &[String]) -> (u64, u64, bool, bool) {
    let mut bytes = 0u64;
    let mut unique = 0u64;
    let mut git = false;
    let mut prot = false;
    let mut stack = vec![p.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(md) = e.metadata() else { continue }; // follows symlinks; checked below
            let Ok(lmd) = fs::symlink_metadata(e.path()) else { continue };
            let name = e.file_name().to_string_lossy().into_owned();
            if lmd.file_type().is_symlink() {
                continue; // junction trap: count nothing, walk nothing
            }
            if name == ".git" {
                git = true;
                continue;
            }
            if protected.iter().any(|p| name.eq_ignore_ascii_case(p)) {
                prot = true;
                continue;
            }
            if md.is_dir() {
                stack.push(e.path());
            } else if md.is_file() {
                bytes += md.len();
                if !hardlinked(&e.path(), &md) {
                    unique += md.len();
                }
            }
        }
    }
    (bytes, unique, git, prot)
}

// Windows: `number_of_links` is unstable (`windows_by_handle`), so `unique`
// equals logical bytes there — the junction skip above is what catches the real
// inflation (the 2026-11-01 151 GB node_modules was junctions, not hardlinks).
#[cfg(windows)]
fn hardlinked(_p: &Path, _md: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn hardlinked(_p: &Path, md: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    md.nlink() > 1
}

fn age_days(md: &fs::Metadata) -> u64 {
    let Some(m) = md.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()) else {
        return 0;
    };
    now_ts().saturating_sub(m.as_secs()) / 86_400
}

pub fn classify(name: &str, age_days: u64, has_git: bool, protected_hit: bool, t: &Thresholds) -> Class {
    if protected_hit || is_modelish(name) {
        return Class::Protected;
    }
    if has_git {
        return Class::Review;
    }
    if ARTIFACT_NAMES.contains(&name) {
        return Class::Artifact;
    }
    if OUTPUT_NAMES.contains(&name) {
        return Class::Output;
    }
    if age_days >= t.scratch_days {
        return Class::Scratch;
    }
    Class::Keep
}

fn is_modelish(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    MODEL_EXT.iter().any(|e| low.ends_with(&format!(".{e}")))
}

fn scan_root(root: &Path, cfg: &DiskConfig) -> Vec<Entry> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(root) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(lmd) = fs::symlink_metadata(e.path()) else { continue };
        let link = lmd.file_type().is_symlink();
        let (bytes, unique, git, prot) = if link {
            (0, 0, false, false)
        } else if lmd.is_dir() {
            tree_bytes(&e.path(), &cfg.protected)
        } else {
            // a top-level FILE: tree_bytes would read_dir(fail)=0 — size it directly
            (lmd.len(), lmd.len(), false, false)
        };
        let self_prot = cfg.protected.iter().any(|x| name.eq_ignore_ascii_case(x));
        let class = classify(&name, age_days(&lmd), git, prot || self_prot, &cfg.thresholds);
        out.push(Entry {
            path: e.path().to_string_lossy().into_owned(),
            name,
            bytes,
            unique,
            age_days: age_days(&lmd),
            class,
            link,
        });
    }
    out.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    out
}

// ── snapshot + anomaly ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Snapshot {
    pub ts: u64, // unix seconds
    pub roots: Vec<RootSnap>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RootSnap {
    pub path: String,
    pub bytes: u64,
    pub entries: Vec<Entry>,
}

fn now_ts() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()
}

pub fn anomalies(prev: &Snapshot, cur: &Snapshot, t: &Thresholds) -> Vec<String> {
    let mut out = Vec::new();
    for r in &cur.roots {
        let Some(old) = prev.roots.iter().find(|x| x.path == r.path) else { continue };
        let grew = r.bytes as i64 - old.bytes as i64;
        if grew > 0 && r.bytes > 500_000_000 {
            let pct = if old.bytes > 0 { grew as f64 / old.bytes as f64 * 100.0 } else { 999.0 };
            if grew as u64 >= t.anomaly_gb * 1_000_000_000 || pct >= t.anomaly_pct as f64 {
                out.push(format!(
                    "{} grew +{:.1} GB ({:.0}%) since last scan",
                    r.path,
                    grew as f64 / 1e9,
                    pct
                ));
            }
        }
        for e in &r.entries {
            if let Some(o) = old.entries.iter().find(|x| x.name == e.name) {
                if e.bytes.saturating_sub(o.bytes) >= t.entry_gb * 1_000_000_000 {
                    out.push(format!("{}/{} grew +{:.1} GB", r.path, e.name, (e.bytes - o.bytes) as f64 / 1e9));
                }
            } else if e.bytes >= t.entry_gb * 1_000_000_000 {
                out.push(format!("{}/{} is NEW at {:.1} GB", r.path, e.name, e.bytes as f64 / 1e9));
            }
        }
    }
    out
}

// ── plan ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Plan {
    pub ts: u64,
    pub roots: Vec<String>,
    pub scratch: Vec<Entry>,
    pub artifacts: Vec<Entry>,
    pub outputs: Vec<Entry>,
    pub review: Vec<Entry>,
    pub protected: Vec<Entry>,
}

impl Plan {
    fn group(&self, which: &str) -> Vec<&Entry> {
        match which {
            "scratch" => self.scratch.iter().collect(),
            "artifacts" => self.artifacts.iter().collect(),
            "outputs" => self.outputs.iter().collect(),
            "all" => self.scratch.iter().chain(&self.artifacts).chain(&self.outputs).collect(),
            _ => Vec::new(),
        }
    }
}

pub fn build_plan(snaps: &[RootSnap]) -> Plan {
    let mut p = Plan { ts: now_ts(), ..Default::default() };
    for r in snaps {
        p.roots.push(r.path.clone());
        for e in &r.entries {
            match e.class {
                Class::Scratch => p.scratch.push(e.clone()),
                Class::Artifact => p.artifacts.push(e.clone()),
                Class::Output => p.outputs.push(e.clone()),
                Class::Review => p.review.push(e.clone()),
                Class::Protected => p.protected.push(e.clone()),
                Class::Keep => {}
            }
        }
    }
    p
}

fn human(b: u64) -> String {
    if b >= 1_000_000_000 { format!("{:.1} GB", b as f64 / 1e9) }
    else if b >= 1_000_000 { format!("{:.0} MB", b as f64 / 1e6) }
    else { format!("{:.0} KB", b as f64 / 1e3) }
}

fn render_plan(p: &Plan, anom: &[String]) -> String {
    let mut m = String::from("# 8sync disk plan\n\n");
    if !anom.is_empty() {
        m.push_str("## ⚠ Anomalies since last scan\n");
        for a in anom { m.push_str(&format!("- {a}\n")); }
        m.push('\n');
    }
    for (title, group) in [
        ("A — scratch (old tmp entries)", &p.scratch),
        ("B — build artifacts (regenerable)", &p.artifacts),
        ("C — outputs (render/generation results; files older than the age rule)", &p.outputs),
        ("REVIEW — contains .git, never auto-deleted", &p.review),
        ("PROTECTED — models & runtime, never in a plan", &p.protected),
    ] {
        m.push_str(&format!("## {title}\n"));
        if group.is_empty() { m.push_str("- (none)\n"); }
        for e in group {
            m.push_str(&format!(
                "- {} (unique {}) · {} days old{} · {}\n",
                human(e.bytes),
                human(e.unique),
                e.age_days,
                if e.link { " · link" } else { "" },
                e.path
            ));
        }
        m.push('\n');
    }
    m.push_str("Apply with: `8sync clean scan --apply scratch|artifacts|outputs|all`\n");
    m
}

// ── apply (guarded delete) ──────────────────────────────────────────

fn remove_tree(p: &Path, protected: &[String]) -> Result<u64> {
    let mut freed = 0u64;
    let md = fs::symlink_metadata(p)?;
    if md.file_type().is_symlink() || !md.is_dir() {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;
        let mut perm = md.permissions();
        perm.set_readonly(false);
        #[cfg(unix)]
        perm.set_mode(0o644);
        fs::set_permissions(p, perm).ok();
        let sz = md.len();
        fs::remove_file(p)?;
        return Ok(sz);
    }
    for e in fs::read_dir(p)?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if protected.iter().any(|x| name.eq_ignore_ascii_case(x)) || name == ".git" {
            continue; // never descend into protected/.git during apply
        }
        freed += remove_tree(&e.path(), protected)?;
    }
    fs::remove_dir(p).ok();
    Ok(freed)
}
fn apply_group(plan: &Plan, which: &str, cfg: &DiskConfig, dry: bool) -> Result<()> {
    let items = plan.group(which);
    if items.is_empty() {
        ui::info(&format!("group '{which}' is empty — nothing to do"));
        return Ok(());
    }
    let mut freed = 0u64;
    for e in &items {
        let p = Path::new(&e.path);
        let ok = p.exists()
            && p.parent().is_some_and(|par| plan.roots.iter().any(|r| Path::new(r) == par));
        if !ok {
            ui::warn(&format!("skip (not directly under a scanned root): {}", p.display()));
            continue;
        }
        if dry {
            ui::info(&format!("would delete {}", p.display()));
            continue;
        }
        match remove_tree(p, &cfg.protected) {
            Ok(n) => {
                freed += n;
                ui::ok(&format!("deleted {} ({})", p.display(), human(n)));
            }
            Err(err) => ui::warn(&format!("FAILED {}: {err}", p.display())),
        }
    }
    if !dry {
        ui::ok(&format!("group '{which}' freed {} (hardlinks may reduce the real gain)", human(freed)));
    }
    Ok(())
}

// ── entry point ─────────────────────────────────────────────────────

pub struct ScanOpts {
    pub extra_roots: Vec<PathBuf>,
    pub apply: Option<String>,
    pub json: bool,
    pub dry_run: bool,
    pub watch: Option<u64>,
}

pub fn run_scan(o: ScanOpts) -> Result<()> {
    let home = dirs::home_dir().context("no HOME")?;
    // Sandboxing hook: tests/smokes point this at a temp dir so a dev binary
    // never seeds config or writes snapshots into the real HOME (2026-11-01
    // incident: a smoke `--apply` hit the real plan and deleted live files).
    let home = match std::env::var_os("SUSYNC_DISK_HOME") {
        Some(h) => PathBuf::from(h),
        None => home,
    };
    let cfg = load_config(&home)?;
    let dir = state_dir(&home);
    fs::create_dir_all(&dir).context("create disk state dir")?;

    if let Some(which) = o.apply.as_deref() {
        let plan: Plan = serde_json::from_str(&fs::read_to_string(dir.join("plan.json"))?)
            .context("no saved plan — run `8sync clean scan` first")?;
        return apply_group(&plan, which, &cfg, o.dry_run);
    }

    loop {
        let mut roots = default_roots(&home);
        let mut extra: Vec<PathBuf> = cfg.roots.iter().filter_map(|r| {
            let stripped = r.strip_prefix("~/");
            let p = stripped.map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r));
            home.join(&p).canonicalize().ok().or_else(|| p.canonicalize().ok())
        }).collect();
        for r in &o.extra_roots {
            let c = r.canonicalize().with_context(|| format!("root {}", r.display()))?;
            extra.push(c);
        }
        for c in extra {
            if !roots.contains(&c) { roots.push(c); }
        }

        let mut snap = Snapshot { ts: now_ts(), roots: Vec::new() };
        for r in &roots {
            let entries = scan_root(r, &cfg);
            let bytes = entries.iter().map(|e| e.bytes).sum();
            if !o.json {
                ui::step(&format!("scanned {} — {} in {} entries", r.display(), human(bytes), entries.len()));
            }
            snap.roots.push(RootSnap { path: r.to_string_lossy().into_owned(), bytes, entries });
        }

        let prev: Option<Snapshot> = fs::read_to_string(dir.join("last.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        let anom = prev.as_ref().map(|p| anomalies(p, &snap, &cfg.thresholds)).unwrap_or_default();

        let plan = build_plan(&snap.roots);
        fs::write(dir.join("last.json"), serde_json::to_string_pretty(&snap)?)?;
        fs::write(dir.join("plan.json"), serde_json::to_string_pretty(&plan)?)?;
        fs::write(dir.join("plan.md"), render_plan(&plan, &anom))?;

        if o.json {
            println!("{}", serde_json::json!({
                "ts": snap.ts,
                "anomalies": anom,
                "plan": plan,
            }));
        } else {
            ui::header("8sync clean scan");
            if anom.is_empty() {
                ui::ok("no anomalies since last scan");
            } else {
                for a in &anom { ui::warn(a); }
            }
            let reclaim: u64 = plan.scratch.iter().chain(&plan.artifacts).chain(&plan.outputs).map(|e| e.unique).sum();
            ui::info(&format!(
                "reclaimable now: {} (scratch {}, artifacts {}, outputs {}) · review {} · protected {}",
                human(reclaim),
                plan.scratch.len(),
                plan.artifacts.len(),
                plan.outputs.len(),
                plan.review.len(),
                plan.protected.len()
            ));
            ui::info(&format!("plan: {}", dir.join("plan.md").display()));
        }


        match o.watch {
            Some(secs) => {
                let secs = secs.max(60);
                ui::step(&format!("sleeping {secs}s …"));
                std::thread::sleep(std::time::Duration::from_secs(secs));
            }
            None => return Ok(()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-disk-test-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn age(p: &Path, days: u64) {
        let t = filetime::FileTime::from_unix_time(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
                - (days * 86_400) as i64,
            0,
        );
        filetime::set_file_mtime(p, t).unwrap();
    }

    fn cfg() -> DiskConfig {
        DiskConfig::default()
    }

    #[test]
    fn classify_boundaries() {
        let t = Thresholds::default(); // scratch 10d, model ext, artifacts, outputs
        // models always win, regardless of age/name style
        assert_eq!(classify("flux.safetensors", 0, false, false, &t), Class::Protected);
        assert_eq!(classify("qwen.gguf", 999, false, false, &t), Class::Protected);
        // protected hit anywhere in the walk
        assert_eq!(classify("whatever", 0, false, true, &t), Class::Protected);
        // .git → human review, never auto
        assert_eq!(classify("myrepo", 999, true, false, &t), Class::Review);
        // regenerable build artifacts
        assert_eq!(classify("target", 0, false, false, &t), Class::Artifact);
        assert_eq!(classify("node_modules", 0, false, false, &t), Class::Artifact);
        assert_eq!(classify("dist", 999, false, false, &t), Class::Artifact);
        // outputs by name
        assert_eq!(classify("output", 999, false, false, &t), Class::Output);
        // plain entry: fresh → keep, old → scratch
        assert_eq!(classify("junk.bin.old", 9, false, false, &t), Class::Keep);
        assert_eq!(classify("junk.bin.old", 10, false, false, &t), Class::Scratch);
    }

    #[test]
    fn tree_bytes_counts_flags_and_skips_links() {
        let root = tmp("tree");
        fs::write(root.join("a.txt"), vec![0u8; 4096]).unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/b.bin"), vec![0u8; 8192]).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("models")).unwrap();
        fs::write(root.join("models/m.safetensors"), vec![0u8; 2048]).unwrap();

        let (bytes, unique, git, prot) = tree_bytes(&root, &cfg().protected);
        assert_eq!(bytes, 4096 + 8192, "counts plain files, skips .git + protected dirs");
        assert!(bytes >= unique, "unique is a lower bound");
        assert!(git && prot, "flags .git and protected hits");

        // the junction/symlink trap: a link to a big dir must count 0
        let big = tmp("big");
        fs::write(big.join("huge.bin"), vec![0u8; 1 << 20]).unwrap();
        let link = root.join("link-to-big");
        #[cfg(windows)]
        let made = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J", &link.to_string_lossy(), &big.to_string_lossy()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&big, &link).is_ok();
        if made {
            let (b2, _, _, _) = tree_bytes(&root, &cfg().protected);
            assert_eq!(b2, bytes, "link dir adds nothing (the 151 GB du trap)");
        }
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&big);
    }

    #[test]
    fn anomalies_fire_on_growth_and_new_entries() {
        let t = Thresholds { anomaly_gb: 10, anomaly_pct: 20, entry_gb: 5, ..Default::default() };
        let gb = 1_000_000_000u64;
        let prev = Snapshot {
            ts: 1,
            roots: vec![RootSnap {
                path: "/r".into(),
                bytes: 10 * gb,
                entries: vec![Entry {
                    name: "old".into(),
                    path: "/r/old".into(),
                    bytes: 2 * gb,
                    unique: 2 * gb,
                    age_days: 1,
                    class: Class::Keep,
                    link: false,
                }],
            }],
        };
        let cur = Snapshot {
            ts: 2,
            roots: vec![RootSnap {
                path: "/r".into(),
                bytes: 25 * gb, // +15 GB, +150% → root anomaly
                entries: vec![
                    Entry {
                        name: "old".into(),
                        path: "/r/old".into(),
                        bytes: 8 * gb, // +6 GB ≥ entry_gb
                        unique: 8 * gb,
                        age_days: 1,
                        class: Class::Keep,
                        link: false,
                    },
                    Entry {
                        name: "fresh".into(),
                        path: "/r/fresh".into(),
                        bytes: 6 * gb, // NEW at ≥ entry_gb
                        unique: 6 * gb,
                        age_days: 0,
                        class: Class::Keep,
                        link: false,
                    },
                ],
            }],
        };
        let out = anomalies(&prev, &cur, &t);
        assert_eq!(out.len(), 3, "{out:?}");
        assert!(out[0].contains("grew"));
        assert!(out.iter().any(|s| s.contains("old grew +6.0 GB")));
        assert!(out.iter().any(|s| s.contains("fresh is NEW at 6.0 GB")));

        // quiet case: small drift under every threshold
        let quiet = Snapshot {
            ts: 3,
            roots: vec![RootSnap {
                path: "/r".into(),
                bytes: 25 * gb + 100 * gb / 100, // +1 GB, +1%
                entries: cur.roots[0].entries.clone(),
            }],
        };
        assert!(anomalies(&cur, &quiet, &t).is_empty());
    }

    #[test]
    fn scan_root_sizes_top_level_files() {
        let root = tmp("files");
        fs::write(root.join("old-installer.zip"), vec![0u8; 2222]).unwrap();
        age(&root.join("old-installer.zip"), 20);
        let entries = scan_root(&root, &cfg());
        let z = entries.iter().find(|e| e.name == "old-installer.zip").unwrap();
        assert_eq!(z.bytes, 2222, "top-level FILE sized directly, not read_dir(fail)=0");
        assert_eq!(z.class, Class::Scratch);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plan_groups_and_apply_guards() {
        let root = tmp("apply");
        let c = cfg();

        // scratch: old dir directly under the root
        fs::create_dir(root.join("old-scratch")).unwrap();
        fs::write(root.join("old-scratch/x.bin"), vec![0u8; 4096]).unwrap();
        age(&root.join("old-scratch"), 30);

        // protected: node_modules with data — must survive apply
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules/pkg.js"), vec![0u8; 2048]).unwrap();

        // review: repo with .git — must survive apply
        fs::create_dir_all(root.join("repo/.git")).unwrap();
        fs::write(root.join("repo/.git/HEAD"), b"ref").unwrap();
        fs::write(root.join("repo/code.rs"), b"fn").unwrap();
        age(&root.join("repo"), 30);

        // fresh entry — Keep, not in any group
        fs::create_dir(root.join("fresh")).unwrap();

        let entries = scan_root(&root, &c);
        let plan = build_plan(&[RootSnap {
            path: root.to_string_lossy().into_owned(),
            bytes: entries.iter().map(|e| e.bytes).sum(),
            entries,
        }]);
        assert!(plan.scratch.iter().any(|e| e.name == "old-scratch"));
        assert!(plan.protected.iter().any(|e| e.name == "node_modules"), "report-only by default");
        assert!(plan.review.iter().any(|e| e.name == "repo"));

        // dry run deletes nothing
        apply_group(&plan, "all", &c, true).unwrap();
        assert!(root.join("old-scratch").exists());

        // real apply: scratch gone, everything else untouched
        apply_group(&plan, "all", &c, false).unwrap();
        assert!(!root.join("old-scratch").exists(), "scratch deleted");
        assert!(root.join("node_modules/pkg.js").exists(), "protected survives");
        assert!(root.join("repo/.git/HEAD").exists(), ".git survives");
        assert!(root.join("fresh").exists(), "Keep survives");

        // guard: a plan entry NOT directly under a root is refused
        let mut evil = plan.clone();
        evil.scratch = vec![Entry {
            name: "evil".into(),
            path: root.parent().unwrap().join("definitely-outside").to_string_lossy().into_owned(),
            bytes: 1,
            unique: 1,
            age_days: 999,
            class: Class::Scratch,
            link: false,
        }];
        evil.roots = vec![root.to_string_lossy().into_owned()];
        apply_group(&evil, "scratch", &c, false).unwrap(); // must skip, not delete
        assert!(evil.scratch[0].path.contains("definitely-outside"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshot_round_trip() {
        let s = Snapshot {
            ts: 42,
            roots: vec![RootSnap { path: "/r".into(), bytes: 7, entries: vec![] }],
        };
        let js = serde_json::to_string(&s).unwrap();
        let back: Snapshot = serde_json::from_str(&js).unwrap();
        assert_eq!(back.ts, 42);
        assert_eq!(back.roots[0].path, "/r");
        assert!(back.roots[0].entries.is_empty());
    }

    #[test]
    fn remove_tree_deletes_readonly_files() {
        let root = tmp("ro");
        let f = root.join("locked.bin");
        fs::write(&f, vec![0u8; 128]).unwrap();
        let mut perm = fs::metadata(&f).unwrap().permissions();
        perm.set_readonly(true);
        fs::set_permissions(&f, perm).unwrap();
        remove_tree(&root, &[]).unwrap();
        assert!(!f.exists());
    }
}
