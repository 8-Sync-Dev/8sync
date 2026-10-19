//! One project's sizes for the Máy tab's "Dung lượng dự án": the walk of
//! `apps/hq-ui/lib/server/disk.ts` `scanDisk` in native code (same caps, same skips, same JSON
//! `ProjectDisk` without `findings`, which node derives in `lib/disk.ts`). Symlinks and junctions
//! are never followed; a folder with its own `.git` is another repo and counts 0, except the
//! worktrees under `.claude/worktrees`.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};

pub const WALK_ENTRIES: i64 = 400_000;
pub const WALK_TIME: Duration = Duration::from_secs(45);
const TRACKED_MIN: u64 = 5 * 1024 * 1024;
const TOP: usize = 12;
const WORKTREES: &str = ".claude/worktrees";
const UPLOADS: &str = ".claude/hq-uploads";
pub const PREVIEW_DIRS: [&str; 5] = ["qa/evidence", "evidence", "screenshots", "su-code/shots", "docs/screenshots"];
const BUILD_DIRS: [&str; 12] = ["target", ".next", "dist", "build", "out", ".turbo", "coverage", ".vite", ".svelte-kit", ".parcel-cache", ".nuxt", ".output"];

struct Budget {
    left: i64,
    end: Instant,
    cut: bool,
}

#[derive(Default)]
struct Acc {
    /// Insertion-ordered (rel path, bytes): top-level folders and the watched ones.
    sizes: Vec<(String, u64)>,
    root_files: Vec<(String, u64)>,
    node_modules: Vec<(String, u64)>,
    build: Vec<(String, u64)>,
}

impl Acc {
    fn size(&self, rel: &str) -> Option<u64> {
        self.sizes.iter().find(|(k, _)| k == rel).map(|(_, n)| *n)
    }
}

fn watched(rel: &str) -> bool {
    rel == ".git" || rel == WORKTREES || rel == UPLOADS || PREVIEW_DIRS.contains(&rel)
}

/// Bytes under `abs` (files only, apparent size). `inside`: already under node_modules or build
/// output (not reported again); `own`: a repo or worktree root.
fn du(abs: &Path, rel: &str, b: &mut Budget, acc: &mut Acc, inside: bool, own: bool) -> u64 {
    if b.cut {
        return 0;
    }
    let Ok(rd) = std::fs::read_dir(abs) else { return 0 };
    let ents: Vec<std::fs::DirEntry> = rd.flatten().collect();
    if !own && ents.iter().any(|e| e.file_name() == ".git") {
        return 0; // another repo: not this project's bytes
    }
    let mut files = Vec::new();
    let mut dirs = Vec::new();
    for e in &ents {
        b.left -= 1;
        if b.left < 0 || Instant::now() > b.end {
            b.cut = true;
            break;
        }
        let Ok(t) = e.file_type() else { continue };
        if t.is_symlink() {
            continue; // links and junctions are never followed
        }
        if t.is_dir() {
            dirs.push(e);
        } else if t.is_file() {
            files.push(e);
        }
    }
    let mut total = 0;
    for f in files {
        // Apparent size of the entry itself (Windows: from the directory listing, no extra call).
        let n = f.metadata().map_or(0, |m| m.len());
        total += n;
        if rel.is_empty() {
            acc.root_files.push((f.file_name().to_string_lossy().into_owned(), n));
        }
    }
    for d in dirs {
        let name = d.file_name().to_string_lossy().into_owned();
        let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        let nm = name == "node_modules";
        let out = !inside && !nm && BUILD_DIRS.contains(&name.as_str());
        let n = du(&d.path(), &r, b, acc, inside || nm || out, rel == WORKTREES);
        total += n;
        if rel.is_empty() || watched(&r) {
            acc.sizes.push((r.clone(), n));
        }
        if !inside && nm {
            acc.node_modules.push((r, n));
        } else if out {
            acc.build.push((r, n));
        }
    }
    total
}

/// `git ls-tree -r -l -z HEAD`: "<mode> blob <sha> <size>\t<path>\0"; blobs over 5 MiB, biggest first, ≤ 20.
pub fn parse_ls_tree(out: &[u8]) -> Vec<(String, u64)> {
    let mut big: Vec<(String, u64)> = out
        .split(|&c| c == 0)
        .filter_map(|rec| {
            let rec = String::from_utf8_lossy(rec);
            let (meta, path) = rec.split_once('\t')?;
            let m: Vec<&str> = meta.split_whitespace().collect();
            let n: u64 = m.get(3)?.parse().ok()?;
            (m.get(1) == Some(&"blob") && n > TRACKED_MIN).then(|| (path.to_string(), n))
        })
        .collect();
    big.sort_by(|a, b| b.1.cmp(&a.1));
    big.truncate(20);
    big
}

fn sized(xs: &[(String, u64)]) -> Value {
    Value::Array(xs.iter().map(|(p, n)| json!({ "path": p, "bytes": n })).collect())
}

fn biggest(mut xs: Vec<(String, u64)>, n: usize) -> Vec<(String, u64)> {
    xs.sort_by(|a, b| b.1.cmp(&a.1));
    xs.truncate(n);
    xs
}

/// JS object key order: array-index keys first (ascending), then the rest in insertion order.
fn js_key_order(xs: &mut [(String, u64)]) {
    let index = |k: &str| k.parse::<u32>().ok().filter(|n| *n != u32::MAX && n.to_string() == k);
    xs.sort_by_key(|(k, _)| index(k).map_or((1, 0), |n| (0, n)));
}

fn mtime_ms(m: &std::fs::Metadata) -> Option<f64> {
    m.modified().ok()?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs_f64() * 1000.0)
}

fn git_ls_tree(root: &Path) -> Option<Vec<u8>> {
    let mut c = std::process::Command::new(which::which("git").ok()?);
    c.arg("-C").arg(root).args(["ls-tree", "-r", "-l", "-z", "HEAD"]);
    c.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    super::agents::run_bounded(c, Duration::from_secs(20))
}

/// One project's `ProjectDisk` (without `findings`); never fails (an unreadable root has `error`).
pub fn scan(root: &str, name: &str, at: u64) -> Value {
    let t0 = Instant::now();
    let empty = |err: &str| {
        json!({ "root": root, "name": name, "total": 0, "entries": [], "git": null, "worktrees": null, "evidence": [], "nodeModules": [],
                "build": [], "uploads": null, "tracked": [], "truncated": false, "at": at, "error": err, "ms": 0 })
    };
    let rootp = PathBuf::from(root);
    match std::fs::metadata(&rootp) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => return empty("không phải thư mục"),
        Err(_) => return empty("không đọc được thư mục"),
    }
    let tree = {
        let r = rootp.clone();
        std::thread::spawn(move || git_ls_tree(&r))
    };
    let mut b = Budget { left: WALK_ENTRIES, end: t0 + WALK_TIME, cut: false };
    let mut acc = Acc::default();
    let total = du(&rootp, "", &mut b, &mut acc, false, true);
    let tree = tree.join().ok().flatten();
    // Top-level folders (a nested repo measures 0 and drops out) and files, biggest first.
    let mut top: Vec<(String, u64)> = acc.sizes.iter().filter(|(k, _)| !k.contains('/')).cloned().collect();
    js_key_order(&mut top);
    let mut entries: Vec<(String, u64, bool)> = top.into_iter().map(|(k, n)| (k, n, true)).chain(acc.root_files.iter().map(|(k, n)| (k.clone(), *n, false))).filter(|e| e.1 > 0).collect();
    entries.sort_by(|a, c| c.1.cmp(&a.1));
    entries.truncate(TOP);
    let list_dirs = |p: PathBuf| -> Option<Vec<PathBuf>> {
        Some(std::fs::read_dir(p).ok()?.flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()).collect())
    };
    let worktrees = list_dirs(rootp.join(".claude").join("worktrees")).map(|w| json!({ "n": w.len(), "bytes": acc.size(WORKTREES).unwrap_or(0) }));
    let uploads = list_dirs(rootp.join(".claude").join("hq-uploads")).map(|ids| {
        let oldest = ids.iter().filter_map(|p| std::fs::metadata(p).ok().as_ref().and_then(mtime_ms)).reduce(f64::min);
        json!({ "n": ids.len(), "bytes": acc.size(UPLOADS).unwrap_or(0), "oldest": oldest })
    });
    let evidence: Vec<(String, u64)> = PREVIEW_DIRS.iter().filter_map(|d| acc.size(d).map(|n| (d.to_string(), n))).collect();
    json!({
        "root": root,
        "name": name,
        "total": total,
        "entries": entries.iter().map(|(p, n, dir)| json!({ "path": p, "bytes": n, "dir": dir })).collect::<Vec<_>>(),
        "git": acc.size(".git"),
        "worktrees": worktrees,
        "evidence": sized(&evidence),
        "nodeModules": sized(&biggest(acc.node_modules, 8)),
        "build": sized(&biggest(acc.build, 8)),
        "uploads": uploads,
        "tracked": sized(&tree.map(|t| parse_ls_tree(&t)).unwrap_or_default()),
        "truncated": b.cut,
        "error": null,
        "at": at,
        "ms": t0.elapsed().as_millis() as u64,
    })
}

/// `/v1/disk` request body.
#[derive(serde::Deserialize)]
pub struct Ask {
    pub root: String,
    pub name: String,
    pub at: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(p: &Path, bytes: usize) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, vec![b'x'; bytes]).unwrap();
    }

    #[test]
    fn walks_like_disk_ts() {
        let d = std::env::temp_dir().join(format!("hq-core-disk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        put(&d.join("README.md"), 10);
        put(&d.join("src/a.rs"), 100);
        put(&d.join(".git/objects/x"), 1000);
        put(&d.join("web/node_modules/pkg/i.js"), 5000);
        put(&d.join("web/node_modules/pkg/node_modules/inner/i.js"), 7);
        put(&d.join("target/debug/bin"), 3000);
        put(&d.join("web/dist/app.js"), 200);
        put(&d.join("qa/evidence/shot.png"), 50);
        put(&d.join("vendor/other/.git/HEAD"), 1);
        put(&d.join("vendor/other/big.bin"), 99_999);
        put(&d.join(".claude/worktrees/card-1/.git"), 5);
        put(&d.join(".claude/worktrees/card-1/x.txt"), 40);
        put(&d.join(".claude/hq-uploads/u1/f.png"), 30);
        let v = scan(&d.to_string_lossy(), "shop", 7);
        assert_eq!(v["error"], Value::Null);
        assert_eq!(v["total"], json!(10 + 100 + 1000 + 5000 + 7 + 3000 + 200 + 50 + 5 + 40 + 30), "the nested repo counts 0");
        assert_eq!(v["git"], json!(1000));
        assert_eq!(v["worktrees"], json!({ "n": 1, "bytes": 45 }));
        assert_eq!(v["evidence"], json!([{ "path": "qa/evidence", "bytes": 50 }]));
        assert_eq!(v["nodeModules"], json!([{ "path": "web/node_modules", "bytes": 5007 }]), "outermost only");
        assert_eq!(v["build"], json!([{ "path": "target", "bytes": 3000 }, { "path": "web/dist", "bytes": 200 }]));
        assert_eq!(v["uploads"]["n"], json!(1));
        assert_eq!(v["uploads"]["bytes"], json!(30));
        assert!(v["uploads"]["oldest"].is_number());
        let top: Vec<(&str, u64)> = v["entries"].as_array().unwrap().iter().map(|e| (e["path"].as_str().unwrap(), e["bytes"].as_u64().unwrap())).collect();
        assert_eq!(top[0], ("web", 5207));
        assert!(!top.iter().any(|(p, _)| *p == "vendor"), "0 bytes drops out");
        assert!(top.contains(&("README.md", 10)));
        assert_eq!(v["truncated"], json!(false));
        let _ = std::fs::remove_dir_all(&d);
        assert_eq!(scan(&d.to_string_lossy(), "gone", 1)["error"], json!("không đọc được thư mục"));
    }

    #[test]
    fn ls_tree_keeps_big_blobs_biggest_first() {
        let out = b"100644 blob aaa 6291456\tassets/a.png\0100644 blob bbb 10\tsmall.txt\0160000 commit ccc       -\tsub\0100644 blob ddd 9437184\tb.bin\0";
        assert_eq!(parse_ls_tree(out), vec![("b.bin".to_string(), 9_437_184), ("assets/a.png".to_string(), 6_291_456)]);
    }

    #[test]
    fn top_level_keys_follow_js_object_order() {
        let mut xs = vec![("src".to_string(), 1), ("2024".to_string(), 1), ("01".to_string(), 1), ("7".to_string(), 1)];
        js_key_order(&mut xs);
        assert_eq!(xs.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["7", "2024", "src", "01"]);
    }
}
