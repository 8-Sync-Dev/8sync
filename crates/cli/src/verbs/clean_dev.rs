//! `8sync clean --dev` (every OS; what `8sync clean` does off Linux): the junk dev work leaves
//! behind, across every project Claude Code has worked in on this machine. Owner (2026-10-25):
//! "auto clear rác sau ci local, train, finetune, pull image old rác không sài, model ai local
//! không sài … all deep", "apply liền cho all dự án trong máy".
//!
//! Removed without asking (rebuilt or re-fetched on demand, never someone's work):
//! - projects idle for `--idle-days` (default 14; last commit and last Claude Code transcript):
//!   git-ignored build output (`target` beside a Cargo.toml, `node_modules` beside a package.json,
//!   `.next`, `.turbo`, `.nuxt`, `.svelte-kit`, `.parcel-cache`, `.angular`) and Python caches;
//!   every project: `git worktree prune` (entries whose folder is already gone).
//! - Docker, only when its daemon already runs: stopped containers older than a day, dangling
//!   images, build cache older than a week, images no container uses created over `--image-days`
//!   (default 30) ago.
//! - caches that only drop unreferenced entries: `uv cache prune`, `pnpm store prune`, `npm cache
//!   verify`; with `--deep` also `go clean -cache` and `pip cache purge`.
//! - files in the OS temp folder untouched for 7 days.
//!
//! Listed for the owner, never removed by default (someone's work or a big re-download): AI models
//! (Hugging Face hub, Ollama, LM Studio, torch hub) with when each was last read, training output
//! (checkpoints, wandb, mlruns, lightning_logs, runs), Docker volumes no container uses. The owner
//! picks; `--forget <id>` removes one listed item through its own tool (`hf cache rm`, `ollama rm`).
//! Hugging Face downloads that never finished (`*.incomplete`, a day old) are junk and go.
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use anyhow::{bail, Result};

use crate::ui;

const DAY: u64 = 86_400;
/// Build output and caches: removed in an idle project when git ignores them.
const BUILD_DIRS: &[&str] = &[".next", ".turbo", ".nuxt", ".svelte-kit", ".parcel-cache", ".angular"];
/// Python caches: removed in an idle project wherever they are (never source).
const PY_CACHES: &[&str] = &["__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache"];
/// Training output: listed with its size, never removed by default.
const TRAIN_DIRS: &[&str] = &["checkpoints", "wandb", "mlruns", "lightning_logs", "runs"];
/// Training output under this size is not worth a line.
const TRAIN_MIN: u64 = 100 << 20;
/// How deep below a project root build output is looked for (monorepo apps/x/node_modules).
const MAX_DEPTH: usize = 4;
const TEMP_DAYS: u64 = 7;
/// Models under this size are not worth a line (a repo of config files, a tokenizer).
const MODEL_MIN: u64 = 50 << 20;

#[derive(Debug, Clone)]
pub struct Opts {
    pub dry: bool,
    pub deep: bool,
    pub idle_days: u64,
    pub image_days: u64,
    pub roots: Vec<PathBuf>,
    pub forget: Vec<String>,
}

/// What a pass removed and what it left for the owner.
#[derive(Debug, Default)]
struct Tally {
    freed: u64,
    ask: Vec<String>,
}

pub fn run(o: &Opts) -> Result<()> {
    let Some(home) = dirs::home_dir() else { bail!("no HOME") };
    ui::header(if o.dry { "8sync clean --dev --dry-run" } else { "8sync clean --dev" });
    if !o.forget.is_empty() {
        for id in &o.forget {
            forget(id, &home, o.dry)?;
        }
        return Ok(());
    }
    let now = SystemTime::now();
    let mut t = Tally::default();

    ui::step("dự án (build output của dự án nghỉ, worktree đã mất)");
    let cwds = transcript_cwds(&home.join(".claude").join("projects"));
    let projects = projects(&cwds, &o.roots);
    ui::info(&format!("{} dự án", projects.len()));
    for p in &projects {
        project(p, &cwds, o, now, &mut t);
    }

    ui::step("Docker");
    docker(o, &mut t);

    ui::step("cache công cụ");
    tool_caches(o);

    ui::step(&format!("thư mục tạm (file không đụng {TEMP_DAYS} ngày)"));
    let tmp = std::env::temp_dir();
    let (n, b) = clean_temp(&tmp, now, TEMP_DAYS * DAY, o.dry);
    t.freed += b;
    ui::info(&format!("{} {n} file, {}", if o.dry { "sẽ xoá" } else { "đã xoá" }, human(b)));

    ui::step("model AI local (bản tải dở của Hugging Face; còn lại để anh chọn)");
    let (n, b) = hf_incomplete(&hf_hub(&home), now, o.dry);
    t.freed += b;
    ui::info(&format!("{} {n} bản tải dở, {}", if o.dry { "sẽ xoá" } else { "đã xoá" }, human(b)));
    let models = models(&home, now);
    for m in models.iter().filter(|m| m.bytes >= MODEL_MIN) {
        t.ask.push(format!("{:<48} {:>9}  {}  → 8sync clean --forget {}", m.id, human(m.bytes), m.note, m.id));
    }
    if models.is_empty() {
        ui::info("không có model nào trong Hugging Face / Ollama / LM Studio / torch hub");
    }

    ui::header(&format!("{} {}", if o.dry { "sẽ giải phóng" } else { "đã giải phóng" }, human(t.freed)));
    if !t.ask.is_empty() {
        ui::info("cần anh quyết (không tự xoá: model, kết quả train, volume Docker):");
        for l in &t.ask {
            println!("  {l}");
        }
    }
    Ok(())
}

// ── projects ──────────────────────────────────────────────────────────

/// Every folder Claude Code worked in (`~/.claude/projects/*/*.jsonl` → `cwd`) plus `roots`, each
/// resolved to its git top level; a folder outside git stands for the repos one or two levels below.
fn projects(cwds: &[(PathBuf, SystemTime)], roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut seeds: BTreeSet<PathBuf> = cwds.iter().map(|(p, _)| p.clone()).collect();
    seeds.extend(roots.iter().cloned());
    let mut out = BTreeSet::new();
    for s in seeds {
        if !s.is_dir() {
            continue;
        }
        match git_top(&s) {
            Some(top) => {
                out.insert(top);
            }
            None => out.extend(repos_below(&s, 2)),
        }
    }
    out.into_iter().collect()
}

/// (cwd, newest transcript mtime) for each Claude Code project folder.
fn transcript_cwds(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let mut newest: Option<(SystemTime, PathBuf)> = None;
        for f in std::fs::read_dir(e.path()).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().is_some_and(|x| x == "jsonl") {
                let t = f.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
                if newest.as_ref().is_none_or(|(n, _)| t > *n) {
                    newest = Some((t, p));
                }
            }
        }
        if let Some((t, p)) = newest {
            if let Some(cwd) = first_cwd(&p) {
                out.push((cwd, t));
            }
        }
    }
    out
}

/// The `cwd` of the first transcript line that has one.
fn first_cwd(p: &Path) -> Option<PathBuf> {
    use std::io::BufRead;
    let f = std::fs::File::open(p).ok()?;
    std::io::BufReader::new(f).lines().take(50).map_while(Result::ok).find_map(|l| cwd_of(&l))
}

pub(crate) fn cwd_of(line: &str) -> Option<PathBuf> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    v.get("cwd")?.as_str().filter(|s| !s.is_empty()).map(PathBuf::from)
}

/// The folder holding `.git` (a dir, or a worktree's `.git` file) at or above `p`.
fn git_top(p: &Path) -> Option<PathBuf> {
    p.ancestors().find(|a| a.join(".git").exists()).map(Path::to_path_buf)
}

fn repos_below(p: &Path, depth: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(p).into_iter().flatten().flatten() {
        let c = e.path();
        if !e.file_type().is_ok_and(|t| t.is_dir()) || hidden(&c) {
            continue;
        }
        if c.join(".git").exists() {
            out.push(c);
        } else if depth > 1 {
            out.extend(repos_below(&c, depth - 1));
        }
    }
    out
}

fn hidden(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.'))
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let o = Command::new("git").arg("-C").arg(dir).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).into_owned())
}

/// Idle: no commit and no Claude Code transcript for `days`.
pub(crate) fn idle(last_commit: Option<SystemTime>, last_transcript: Option<SystemTime>, now: SystemTime, days: u64) -> bool {
    let newest = last_commit.into_iter().chain(last_transcript).max();
    newest.is_some_and(|t| now.duration_since(t).is_ok_and(|d| d.as_secs() >= days * DAY))
}

fn project(root: &Path, cwds: &[(PathBuf, SystemTime)], o: &Opts, now: SystemTime, t: &mut Tally) {
    if root.join(".git").is_dir() && !o.dry {
        let _ = git(root, &["worktree", "prune"]);
    }
    let commit = git(root, &["log", "-1", "--format=%ct"]).and_then(|s| s.trim().parse::<u64>().ok()).map(|s| SystemTime::UNIX_EPOCH + Duration::from_secs(s));
    let transcript = cwds.iter().filter(|(c, _)| c.starts_with(root)).map(|(_, t)| *t).max();
    let mut found = Vec::new();
    walk(root, 0, &mut found);
    // Training output is the owner's, idle or not.
    for d in found.iter().filter(|f| f.kind == Kind::Train) {
        let b = size(&d.path);
        if b >= TRAIN_MIN {
            t.ask.push(format!("{:<48} {:>9}  kết quả train  → xoá tay nếu không cần", d.path.display(), human(b)));
        }
    }
    if !idle(commit, transcript, now, o.idle_days) {
        return;
    }
    let cands: Vec<&Found> = found.iter().filter(|f| f.kind == Kind::Build).collect();
    if cands.is_empty() {
        return;
    }
    let ignored = check_ignore(root, &cands.iter().map(|f| f.path.clone()).collect::<Vec<_>>());
    for f in cands.into_iter().filter(|f| ignored.contains(&f.path)) {
        let b = size(&f.path);
        if b == 0 {
            continue;
        }
        if o.dry {
            ui::info(&format!("sẽ xoá {} ({})", f.path.display(), human(b)));
            t.freed += b;
        } else if std::fs::remove_dir_all(&f.path).is_ok() {
            ui::ok(&format!("đã xoá {} ({})", f.path.display(), human(b)));
            t.freed += b;
        } else {
            ui::warn(&format!("không xoá được {} (đang mở?)", f.path.display()));
        }
    }
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub(crate) enum Kind {
    Build,
    Train,
}

#[derive(Debug)]
struct Found {
    path: PathBuf,
    kind: Kind,
}

/// What a folder named `name` is, given its parent's files: build output we may remove, training
/// output we list, or neither.
pub(crate) fn classify(name: &str, parent_has: impl Fn(&str) -> bool) -> Option<Kind> {
    match name {
        "target" if parent_has("Cargo.toml") => Some(Kind::Build),
        "node_modules" if parent_has("package.json") => Some(Kind::Build),
        n if BUILD_DIRS.contains(&n) || PY_CACHES.contains(&n) => Some(Kind::Build),
        n if TRAIN_DIRS.contains(&n) || n.starts_with("checkpoint-") => Some(Kind::Train),
        _ => None,
    }
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<Found>) {
    if depth > MAX_DEPTH {
        return;
    }
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        // Never follow a link or junction out of the project.
        if !e.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name == ".git" || p.join(".git").exists() {
            continue; // a nested repo or worktree is its own project
        }
        if let Some(kind) = classify(&name, |f| dir.join(f).is_file()) {
            out.push(Found { path: p, kind });
            continue;
        }
        if !name.starts_with('.') {
            walk(&p, depth + 1, out);
        }
    }
}

/// The paths git ignores (only those are build output; a tracked `dist` is someone's).
fn check_ignore(root: &Path, paths: &[PathBuf]) -> BTreeSet<PathBuf> {
    use std::io::Write;
    let Ok(mut c) = Command::new("git").arg("-C").arg(root).args(["check-ignore", "--stdin"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
        return BTreeSet::new();
    };
    if let Some(mut i) = c.stdin.take() {
        for p in paths {
            let rel = p.strip_prefix(root).unwrap_or(p);
            let _ = writeln!(i, "{}", rel.to_string_lossy().replace('\\', "/"));
        }
    }
    let Ok(o) = c.wait_with_output() else { return BTreeSet::new() };
    let ignored: BTreeSet<PathBuf> = String::from_utf8_lossy(&o.stdout).lines().map(|l| normalize(&root.join(l.trim()))).collect();
    paths.iter().filter(|p| ignored.contains(&normalize(p))).cloned().collect()
}

fn normalize(p: &Path) -> PathBuf {
    PathBuf::from(p.to_string_lossy().replace('\\', "/").trim_end_matches('/'))
}

/// Bytes under `p`, links not followed.
fn size(p: &Path) -> u64 {
    let Ok(m) = std::fs::symlink_metadata(p) else { return 0 };
    if !m.is_dir() {
        return m.len();
    }
    std::fs::read_dir(p).into_iter().flatten().flatten().map(|e| size(&e.path())).sum()
}

// ── Docker ────────────────────────────────────────────────────────────

/// `cmd args…` with a timeout (a stopped Docker Desktop can hang its CLI). None = missing / failed.
fn out_timeout(cmd: &str, args: &[&str], secs: u64) -> Option<String> {
    let exe = which::which(cmd).ok()?;
    let mut c = Command::new(exe).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let end = std::time::Instant::now() + Duration::from_secs(secs);
    loop {
        match c.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < end => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = c.kill();
                return None;
            }
        }
    }
    let o = c.wait_with_output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).into_owned())
}

/// "Total reclaimed space: 1.382GB" → bytes.
pub(crate) fn reclaimed(out: &str) -> u64 {
    out.lines().filter_map(|l| l.strip_prefix("Total reclaimed space:")).filter_map(|v| parse_size(v.trim())).sum()
}

/// "1.382GB", "266.2kB", "0B" (Docker's units, powers of 1000).
pub(crate) fn parse_size(s: &str) -> Option<u64> {
    let i = s.find(|c: char| c.is_ascii_alphabetic())?;
    let (n, u) = s.split_at(i);
    let n: f64 = n.trim().parse().ok()?;
    let m = match u.trim().to_ascii_uppercase().as_str() {
        "B" => 1.0,
        "KB" => 1e3,
        "MB" => 1e6,
        "GB" => 1e9,
        "TB" => 1e12,
        _ => return None,
    };
    Some((n * m) as u64)
}

pub(crate) fn docker_prunes(image_days: u64) -> Vec<Vec<String>> {
    let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    vec![
        v(&["container", "prune", "-f", "--filter", "until=24h"]),
        v(&["image", "prune", "-f"]),
        v(&["builder", "prune", "-f", "--filter", "until=168h"]),
        vec!["image".into(), "prune".into(), "-a".into(), "-f".into(), "--filter".into(), format!("until={}h", image_days * 24)],
    ]
}

fn docker(o: &Opts, t: &mut Tally) {
    if out_timeout("docker", &["info", "--format", "{{.ServerVersion}}"], 15).is_none() {
        ui::info("Docker không chạy (hoặc chưa cài): bỏ qua, không tự mở Docker Desktop");
        return;
    }
    if o.dry {
        if let Some(df) = out_timeout("docker", &["system", "df"], 60) {
            for l in df.lines() {
                ui::info(l);
            }
        }
        ui::info(&format!("sẽ chạy: container prune (dừng > 24 giờ), image prune (dangling), builder prune (> 7 ngày), image prune -a (không container nào dùng, tạo > {} ngày)", o.image_days));
    } else {
        for a in docker_prunes(o.image_days) {
            let args: Vec<&str> = a.iter().map(String::as_str).collect();
            let b = out_timeout("docker", &args, 600).map_or(0, |s| reclaimed(&s));
            t.freed += b;
            ui::ok(&format!("docker {}: {}", args[..2].join(" "), human(b)));
        }
    }
    // Volumes hold data: listed, removed only on `--forget docker-volumes`.
    if let Some(v) = out_timeout("docker", &["volume", "ls", "-q", "--filter", "dangling=true"], 60) {
        let n = v.lines().filter(|l| !l.trim().is_empty()).count();
        if n > 0 {
            t.ask.push(format!("{:<48} {:>9}  {n} volume không container nào dùng (có thể là dữ liệu)  → 8sync clean --forget docker-volumes", "docker-volumes", "?"));
        }
    }
    ui::info("Docker Desktop trên Windows: file đĩa WSL không tự co sau prune — Docker Desktop → Troubleshoot → Clean / Purge data, hoặc để nguyên.");
}

// ── tool caches ───────────────────────────────────────────────────────

pub(crate) fn tool_cmds(deep: bool) -> Vec<(&'static str, Vec<&'static str>)> {
    let mut v = vec![("uv", vec!["cache", "prune"]), ("pnpm", vec!["store", "prune"]), ("npm", vec!["cache", "verify"])];
    if deep {
        v.push(("go", vec!["clean", "-cache"]));
        v.push(("pip", vec!["cache", "purge"]));
    }
    v
}

fn tool_caches(o: &Opts) {
    for (tool, args) in tool_cmds(o.deep) {
        let Ok(exe) = which::which(tool) else { continue };
        if o.dry {
            ui::info(&format!("sẽ chạy: {tool} {}", args.join(" ")));
            continue;
        }
        let ok = Command::new(exe).args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success());
        if ok {
            ui::ok(&format!("{tool} {}", args.join(" ")));
        } else {
            ui::warn(&format!("{tool} {} không chạy được", args.join(" ")));
        }
    }
}

// ── temp ──────────────────────────────────────────────────────────────

/// Files under `dir` not modified for `age_s`, then the folders that emptied. Links are skipped;
/// a file in use fails to delete and stays. Returns (files, bytes).
fn clean_temp(dir: &Path, now: SystemTime, age_s: u64, dry: bool) -> (u64, u64) {
    let (mut n, mut b) = (0, 0);
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            let (n2, b2) = clean_temp(&p, now, age_s, dry);
            n += n2;
            b += b2;
            // An old folder that emptied (a fresh empty one may be in use by the app that made it).
            let old_dir = std::fs::metadata(&p).ok().and_then(|m| m.modified().ok()).and_then(|t| now.duration_since(t).ok()).is_some_and(|d| d.as_secs() >= age_s);
            if !dry && old_dir {
                let _ = std::fs::remove_dir(&p); // only succeeds when empty
            }
        } else if ft.is_file() {
            let Ok(m) = e.metadata() else { continue };
            let old = m.modified().ok().and_then(|t| now.duration_since(t).ok()).is_some_and(|d| d.as_secs() >= age_s);
            if old && (dry || std::fs::remove_file(&p).is_ok()) {
                n += 1;
                b += m.len();
            }
        }
    }
    (n, b)
}

// ── models ────────────────────────────────────────────────────────────

/// One AI model on disk, listed for the owner. Never removed by age: any scan bumps access times
/// (`hf cache ls` set every model to "seconds ago" on 2026-10-25), so "unused for N days" can't
/// be trusted; the owner picks from size and download date.
#[derive(Debug)]
struct Model {
    /// `hf:org/name`, `hf-dataset:org/name`, `ollama:name:tag`, `lmstudio:pub/name`, `torch:file`.
    id: String,
    path: PathBuf,
    bytes: u64,
    note: String,
}

/// Seconds since `p` was last written, as "tải N ngày trước".
fn got_vi(p: &Path, now: SystemTime) -> String {
    let days = std::fs::metadata(p).ok().and_then(|m| m.modified().ok()).and_then(|t| now.duration_since(t).ok()).map(|d| d.as_secs() / DAY);
    match days {
        Some(0) => "tải hôm nay".to_string(),
        Some(d) => format!("tải {d} ngày trước"),
        None => String::new(),
    }
}

fn hf_hub(home: &Path) -> PathBuf {
    if let Some(h) = std::env::var_os("HF_HUB_CACHE") {
        return PathBuf::from(h);
    }
    std::env::var_os("HF_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".cache").join("huggingface")).join("hub")
}

/// `models--org--name` → `hf:org/name`; `datasets--…` → `hf-dataset:…`.
pub(crate) fn hf_id(dir: &str) -> Option<String> {
    let (kind, rest) = dir.split_once("--")?;
    let name = rest.replacen("--", "/", 1);
    match kind {
        "models" => Some(format!("hf:{name}")),
        "datasets" => Some(format!("hf-dataset:{name}")),
        _ => None,
    }
}

/// `hf cache ls --json` rows → models. The CLI knows the shared-blob layout (huggingface_hub 1.x
/// keeps blobs in `hub/blobs`, so a repo folder can look empty while it holds gigabytes).
pub(crate) fn hf_rows(json: &str) -> Vec<(String, String, String)> {
    let Ok(serde_json::Value::Array(rows)) = serde_json::from_str::<serde_json::Value>(json) else { return Vec::new() };
    rows.iter()
        .filter_map(|r| {
            let repo = r.get("repo_id")?.as_str()?;
            let kind = if r.get("repo_type")?.as_str()? == "dataset" { "hf-dataset" } else { "hf" };
            let size = r.get("size")?.as_str()?.to_string();
            let modified = r.get("last_modified").and_then(|v| v.as_str()).unwrap_or("");
            let unpinned = r.get("refs").and_then(|v| v.as_array()).is_some_and(|a| a.is_empty());
            let note = format!("tải {modified}{}", if unpinned { " · không có ref (có thể code ghim theo commit)" } else { "" });
            Some((format!("{kind}:{repo}"), size, note))
        })
        .collect()
}

/// "2.3G", "959.6K", "50.8K" (huggingface_hub's sizes) → bytes, for sorting.
pub(crate) fn hf_size(s: &str) -> u64 {
    let (n, m) = match s.chars().last() {
        Some('K') => (&s[..s.len() - 1], 1e3),
        Some('M') => (&s[..s.len() - 1], 1e6),
        Some('G') => (&s[..s.len() - 1], 1e9),
        Some('T') => (&s[..s.len() - 1], 1e12),
        _ => (s, 1.0),
    };
    n.trim().parse::<f64>().map_or(0, |n| (n * m) as u64)
}

fn models(home: &Path, now: SystemTime) -> Vec<Model> {
    let mut v = Vec::new();
    let hub = hf_hub(home);
    match hub.is_dir().then(|| out_timeout("hf", &["cache", "ls", "--json"], 120)).flatten() {
        Some(json) => {
            for (id, size, note) in hf_rows(&json) {
                v.push(Model { bytes: hf_size(&size), id, path: hub.clone(), note });
            }
        }
        None => {
            // No `hf` CLI: the classic layout, one folder per repo.
            for e in std::fs::read_dir(&hub).into_iter().flatten().flatten() {
                let p = e.path();
                if let Some(id) = hf_id(&e.file_name().to_string_lossy()) {
                    v.push(Model { id, bytes: size(&p), note: got_vi(&p, now), path: p });
                }
            }
        }
    }
    let ollama = std::env::var_os("OLLAMA_MODELS").map(PathBuf::from).unwrap_or_else(|| home.join(".ollama").join("models"));
    for (id, bytes, manifest) in ollama_models(&ollama) {
        v.push(Model { id, bytes, note: got_vi(&manifest, now), path: manifest });
    }
    for base in [home.join(".lmstudio").join("models"), home.join(".cache").join("lm-studio").join("models")] {
        for publ in std::fs::read_dir(&base).into_iter().flatten().flatten() {
            for repo in std::fs::read_dir(publ.path()).into_iter().flatten().flatten() {
                let p = repo.path();
                if p.is_dir() {
                    let id = format!("lmstudio:{}/{}", publ.file_name().to_string_lossy(), repo.file_name().to_string_lossy());
                    v.push(Model { id, bytes: size(&p), note: got_vi(&p, now), path: p });
                }
            }
        }
    }
    for e in std::fs::read_dir(home.join(".cache").join("torch").join("hub").join("checkpoints")).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_file() {
            v.push(Model { id: format!("torch:{}", e.file_name().to_string_lossy()), bytes: size(&p), note: got_vi(&p, now), path: p });
        }
    }
    v.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    v
}

/// (`ollama:name:tag`, bytes, manifest) from the manifests; `ollama rm` handles shared blobs.
fn ollama_models(dir: &Path) -> Vec<(String, u64, PathBuf)> {
    let mut out = Vec::new();
    let reg = dir.join("manifests").join("registry.ollama.ai");
    for ns in std::fs::read_dir(&reg).into_iter().flatten().flatten() {
        for model in std::fs::read_dir(ns.path()).into_iter().flatten().flatten() {
            for tag in std::fs::read_dir(model.path()).into_iter().flatten().flatten() {
                let Ok(s) = std::fs::read_to_string(tag.path()) else { continue };
                let Some(bytes) = ollama_manifest(&s) else { continue };
                let ns_s = ns.file_name().to_string_lossy().into_owned();
                let name = if ns_s == "library" { model.file_name().to_string_lossy().into_owned() } else { format!("{ns_s}/{}", model.file_name().to_string_lossy()) };
                out.push((format!("ollama:{name}:{}", tag.file_name().to_string_lossy()), bytes, tag.path()));
            }
        }
    }
    out
}

/// Total layer bytes of an Ollama manifest.
pub(crate) fn ollama_manifest(s: &str) -> Option<u64> {
    let v: serde_json::Value = serde_json::from_str(s).ok()?;
    let layers = v.get("layers")?.as_array()?;
    Some(layers.iter().filter_map(|l| l.get("size")?.as_u64()).sum())
}

/// The command that removes model `id` through its own tool, when it has one.
pub(crate) fn rm_argv(id: &str) -> Option<Vec<String>> {
    if let Some(name) = id.strip_prefix("ollama:") {
        return Some(vec!["ollama".into(), "rm".into(), name.into()]);
    }
    let (kind, repo) = if let Some(r) = id.strip_prefix("hf-dataset:") { ("dataset", r) } else { ("model", id.strip_prefix("hf:")?) };
    Some(vec!["hf".into(), "cache".into(), "rm".into(), format!("{kind}/{repo}"), "-y".into()])
}

fn remove_model(m: &Model, dry: bool) -> bool {
    if dry {
        ui::info(&format!("sẽ xoá {} ({})", m.id, human(m.bytes)));
        return true;
    }
    let ok = match rm_argv(&m.id) {
        Some(a) => Command::new(&a[0]).args(&a[1..]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success()),
        None if m.path.is_dir() => std::fs::remove_dir_all(&m.path).is_ok(),
        None => std::fs::remove_file(&m.path).is_ok(),
    };
    if ok {
        ui::ok(&format!("đã xoá {} ({})", m.id, human(m.bytes)));
    } else {
        ui::warn(&format!("không xoá được {}", m.id));
    }
    ok
}

/// Hugging Face downloads that never finished (`*.incomplete`, untouched for a day): junk.
fn hf_incomplete(dir: &Path, now: SystemTime, dry: bool) -> (u64, u64) {
    let (mut n, mut b) = (0, 0);
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            let (n2, b2) = hf_incomplete(&p, now, dry);
            n += n2;
            b += b2;
        } else if ft.is_file() && p.extension().is_some_and(|x| x == "incomplete") {
            let Ok(m) = e.metadata() else { continue };
            let old = m.modified().ok().and_then(|t| now.duration_since(t).ok()).is_some_and(|d| d.as_secs() >= DAY);
            if old && (dry || std::fs::remove_file(&p).is_ok()) {
                n += 1;
                b += m.len();
            }
        }
    }
    (n, b)
}

/// `--forget <id>`: one model from the list, or `docker-volumes`. Only ids this machine lists.
fn forget(id: &str, home: &Path, dry: bool) -> Result<()> {
    if id == "docker-volumes" {
        if dry {
            ui::info("sẽ chạy: docker volume prune -a -f");
        } else {
            let b = out_timeout("docker", &["volume", "prune", "-a", "-f"], 600).map(|s| reclaimed(&s));
            match b {
                Some(b) => ui::ok(&format!("docker volume prune: {}", human(b))),
                None => bail!("docker volume prune không chạy được (Docker có đang chạy?)"),
            }
        }
        return Ok(());
    }
    let Some(m) = models(home, SystemTime::now()).into_iter().find(|m| m.id == id) else { bail!("không thấy `{id}` trong danh sách model của máy (chạy `8sync clean --dev --dry-run` để xem id)") };
    if !remove_model(&m, dry) {
        bail!("không xoá được {id}");
    }
    Ok(())
}

// ── text ──────────────────────────────────────────────────────────────

pub(crate) fn human(b: u64) -> String {
    match b {
        b if b >= 1 << 30 => format!("{:.1} GB", b as f64 / (1u64 << 30) as f64),
        b if b >= 1 << 20 => format!("{:.0} MB", b as f64 / (1u64 << 20) as f64),
        b => format!("{} KB", b / 1024),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_build_output_only_beside_its_manifest() {
        let has = |files: &'static [&'static str]| move |f: &str| files.contains(&f);
        assert_eq!(classify("target", has(&["Cargo.toml"])), Some(Kind::Build));
        assert_eq!(classify("target", has(&[])), None, "a `target` folder that is not Cargo's");
        assert_eq!(classify("node_modules", has(&["package.json"])), Some(Kind::Build));
        assert_eq!(classify("node_modules", has(&[])), None);
        assert_eq!(classify(".next", has(&[])), Some(Kind::Build));
        assert_eq!(classify("__pycache__", has(&[])), Some(Kind::Build));
        assert_eq!(classify("checkpoint-500", has(&[])), Some(Kind::Train));
        assert_eq!(classify("wandb", has(&[])), Some(Kind::Train));
        for keep in ["src", "dist", "build", "out", "models", "data"] {
            assert_eq!(classify(keep, has(&["package.json", "Cargo.toml"])), None, "{keep} may be someone's");
        }
    }

    #[test]
    fn a_project_is_idle_only_when_both_commits_and_transcripts_are_old() {
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(100 * DAY);
        let ago = |d: u64| Some(now - Duration::from_secs(d * DAY));
        assert!(idle(ago(30), ago(20), now, 14));
        assert!(!idle(ago(30), ago(3), now, 14), "Claude worked there 3 days ago");
        assert!(!idle(ago(2), None, now, 14), "committed 2 days ago");
        assert!(!idle(None, None, now, 14), "nothing known: never idle");
        assert!(idle(ago(14), None, now, 14));
    }

    #[test]
    fn reads_the_cwd_of_a_transcript_line() {
        assert_eq!(cwd_of(r#"{"type":"user","cwd":"C:\\Users\\Projects\\su-code"}"#), Some(PathBuf::from(r"C:\Users\Projects\su-code")));
        assert_eq!(cwd_of(r#"{"type":"summary"}"#), None);
        assert_eq!(cwd_of(r#"{"cwd":""}"#), None);
        assert_eq!(cwd_of("not json"), None);
    }

    #[test]
    fn parses_docker_sizes_and_reclaimed_space() {
        assert_eq!(parse_size("1.382GB"), Some(1_382_000_000));
        assert_eq!(parse_size("266.2kB"), Some(266_200));
        assert_eq!(parse_size("0B"), Some(0));
        assert_eq!(parse_size("lots"), None);
        assert_eq!(reclaimed("Deleted Images:\nuntagged: x\n\nTotal reclaimed space: 3.491GB\n"), 3_491_000_000);
        assert_eq!(reclaimed("nothing"), 0);
    }

    #[test]
    fn docker_prunes_never_touch_volumes_and_keep_recent_images() {
        let p = docker_prunes(30);
        assert!(p.iter().all(|a| a[0] != "volume" && a[0] != "system"), "volumes are data: only on --forget");
        assert_eq!(p[3], ["image", "prune", "-a", "-f", "--filter", "until=720h"]);
        assert!(p[0].contains(&"until=24h".to_string()));
    }

    #[test]
    fn deep_adds_rebuildable_caches_only() {
        assert_eq!(tool_cmds(false).iter().map(|(t, _)| *t).collect::<Vec<_>>(), ["uv", "pnpm", "npm"]);
        assert!(tool_cmds(true).iter().any(|(t, a)| *t == "go" && a == &["clean", "-cache"]));
    }

    #[test]
    fn model_ids() {
        assert_eq!(hf_id("models--meta-llama--Llama-3.1-8B").as_deref(), Some("hf:meta-llama/Llama-3.1-8B"));
        assert_eq!(hf_id("datasets--org--set--v2").as_deref(), Some("hf-dataset:org/set--v2"));
        assert_eq!(hf_id(".locks"), None);
        assert_eq!(hf_id("version.txt"), None);
        let m = r#"{"layers":[{"digest":"sha256:aa","size":10},{"digest":"sha256:bb","size":4000}]}"#;
        assert_eq!(ollama_manifest(m), Some(4010));
        assert_eq!(ollama_manifest("{}"), None);
        assert_eq!(rm_argv("hf:org/m").unwrap(), ["hf", "cache", "rm", "model/org/m", "-y"]);
        assert_eq!(rm_argv("hf-dataset:org/d").unwrap(), ["hf", "cache", "rm", "dataset/org/d", "-y"]);
        assert_eq!(rm_argv("ollama:qwen3:8b").unwrap(), ["ollama", "rm", "qwen3:8b"]);
        assert_eq!(rm_argv("torch:x.pth"), None);
        assert_eq!(hf_size("2.3G"), 2_300_000_000);
        assert_eq!(hf_size("959.6K"), 959_600);
        let rows = hf_rows(r#"[{"id":"model/BAAI/bge","repo_id":"BAAI/bge","repo_type":"model","size":"2.3G","last_accessed":"now","last_modified":"4 weeks ago","refs":[]},{"repo_id":"a/d","repo_type":"dataset","size":"1K","last_modified":"1 week ago","refs":["main"]}]"#);
        assert_eq!(rows[0].0, "hf:BAAI/bge");
        assert!(rows[0].2.contains("4 weeks ago") && rows[0].2.contains("không có ref"), "{:?}", rows[0]);
        assert_eq!((rows[1].0.as_str(), rows[1].2.as_str()), ("hf-dataset:a/d", "tải 1 week ago"));
        assert!(hf_rows("not json").is_empty());
        assert_eq!(human(3 << 30), "3.0 GB");
    }

    #[test]
    fn temp_clean_removes_only_old_files_and_skips_in_dry_run() {
        let dir = std::env::temp_dir().join(format!("8sync-clean-dev-{}", std::process::id()));
        let sub = dir.join("a");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("x"), b"12345").unwrap();
        let now = SystemTime::now();
        assert_eq!(clean_temp(&dir, now, 3600, false), (0, 0), "a fresh file stays");
        let later = now + Duration::from_secs(7200);
        assert_eq!(clean_temp(&dir, later, 3600, true), (1, 5), "dry run counts");
        assert!(sub.join("x").exists(), "dry run deletes nothing");
        assert_eq!(clean_temp(&dir, later, 3600, false), (1, 5));
        assert!(!sub.exists(), "the emptied folder goes too");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn walk_finds_nested_build_output_and_skips_nested_repos() {
        let root = std::env::temp_dir().join(format!("8sync-clean-walk-{}", std::process::id()));
        let app = root.join("apps").join("web");
        std::fs::create_dir_all(app.join("node_modules").join("x")).unwrap();
        std::fs::write(app.join("package.json"), "{}").unwrap();
        std::fs::create_dir_all(root.join("nested").join(".git")).unwrap();
        std::fs::create_dir_all(root.join("nested").join("target")).unwrap();
        std::fs::write(root.join("nested").join("Cargo.toml"), "").unwrap();
        std::fs::create_dir_all(root.join("runs")).unwrap();
        let mut f = Vec::new();
        walk(&root, 0, &mut f);
        let got: Vec<(String, Kind)> = f.iter().map(|x| (x.path.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/"), x.kind)).collect();
        assert!(got.contains(&("apps/web/node_modules".to_string(), Kind::Build)), "{got:?}");
        assert!(got.contains(&("runs".to_string(), Kind::Train)), "{got:?}");
        assert!(!got.iter().any(|(p, _)| p.starts_with("nested")), "a nested repo is its own project: {got:?}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
