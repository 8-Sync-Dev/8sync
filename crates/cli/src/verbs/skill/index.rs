//! Sub-folder skill-index AGENTS.md (progressive disclosure). Agents read the
//! NEAREST AGENTS.md in the tree, so every significant sub-directory gets a
//! compact pointer back to the root rules + the always-on chain.
use anyhow::Result;
use std::path::{Path, PathBuf};

use super::discover::list_installed_skill_dirs;
use super::inject::{always_on_rank, is_always_on, rewrite_md_with_block, BEGIN, END};

/// Always-on skill dir names present in the project, in canonical rank order.
pub(crate) fn always_on_names_in_order(root: &Path) -> Vec<String> {
    let dir = root.join("su-code/skills");
    let mut names: Vec<String> = list_installed_skill_dirs(&dir)
        .unwrap_or_default()
        .iter()
        .filter_map(|p| p.file_name().and_then(|s| s.to_str()).map(String::from))
        .filter(|n| is_always_on(n))
        .collect();
    names.sort_by_key(|n| always_on_rank(n));
    names
}

const SUBDIR_IGNORE: &[&str] = &[
    ".git", ".hg", ".svn", ".jj", ".trail", "su-code", "agents", "node_modules", "target",
    "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".venv", "venv",
    "vendor", "__pycache__", ".cache", "coverage", ".idea", ".vscode", "assets",
];
const CODE_EXTS: &[&str] = &[
    "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rb", "java", "kt",
    "kts", "swift", "c", "cc", "cpp", "cxx", "h", "hpp", "cs", "php", "ex", "exs",
    "sh", "lua", "zig", "vue", "svelte", "scala", "clj", "dart", "sql",
];

/// Sub-directories worth their own skill-index AGENTS.md: any dir within depth 3
/// of `root` that DIRECTLY holds ≥ 4 source files, skipping vendor/build/hidden
/// dirs and the `su-code/` memory tree. Capped at 60.
fn significant_subdirs(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    collect_significant(root, 0, &mut out);
    out.truncate(60);
    out
}

fn collect_significant(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth >= 3 {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let name = match p.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name.starts_with('.') || SUBDIR_IGNORE.contains(&name) {
            continue;
        }
        subdirs.push(p);
    }
    subdirs.sort();
    for sub in subdirs {
        if direct_code_file_count(&sub) >= 4 {
            out.push(sub.clone());
        }
        collect_significant(&sub, depth + 1, out);
    }
}

fn direct_code_file_count(dir: &Path) -> usize {
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return 0,
    };
    rd.flatten()
        .filter(|e| e.path().is_file())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|s| s.to_str())
                .map(|x| CODE_EXTS.contains(&x))
                .unwrap_or(false)
        })
        .count()
}

/// Compact "you are in a sub-folder" index block: points to the root AGENTS.md +
/// master skill file, restates the always-on chain and how to leverage each.
fn subfolder_index_block(root: &Path) -> String {
    let names = always_on_names_in_order(root);
    let chain = if names.is_empty() {
        "trail → karpathy → ponytail → assp → impeccable → taste → 8sync-cli → image-routing → locate-anything".to_string()
    } else {
        names.join(" → ")
    };
    // Every path here is repo-relative or `~/`-anchored: this block is written
    // into sub-folders of a repo that gets cloned to a different absolute path on
    // every machine, so an absolute `<root>/AGENTS.md` would point at nothing.
    let block = format!(
        "{BEGIN}\n\
## 🚨 8sync harness — sub-folder index\n\
\n\
Bạn đang ở **sub-folder**. Rule + skill force-load đầy đủ KHÔNG lặp ở đây — đọc ROOT trước:\n\
\n\
- **Root rules + skill list:** `AGENTS.md` ở REPO ROOT (không phải file này)\n\
- **Master skills (omp đọc đầu tiên):** `~/.omp/skills/00-force-load.md`\n\
\n\
**Always-on (đọc trước tool call đầu tiên, ĐÚNG thứ tự):** {chain}.\n\
SKILL.md ở `su-code/skills/<name>/` (repo-relative) hoặc `~/.omp/skills/<name>/`.\n\
\n\
**Cách tận dụng (bắt buộc):** `trail` cho mọi explore code (ask/callers/skeleton — KHÔNG grep) · \
`karpathy` + `ponytail` = YAGNI, làm ít nhất, xoá > thêm · `assp` cho copy/offer hướng người dùng · \
**`impeccable` = design system CHUẨN, BẮT BUỘC cho mọi UI/design/redesign/audit (kèm `references/house/*`)** + `taste` chống slop.\n\
\n\
**Quy tắc:** cite `path:line` · ưu tiên verb `8sync` hơn shell · sau mỗi thay đổi cập nhật `CHANGELOG.md` + `su-code/KNOWLEDGE.md`.\n\
{END}"
    );
    crate::brand::render(&block).into_owned()
}

/// Drop/refresh a compact skill-index AGENTS.md in every significant sub-folder.
/// Idempotent via the shared sentinels. Returns the number of files written.
pub(crate) fn inject_subfolder_indexes(root: &Path) -> Result<usize> {
    let block = subfolder_index_block(root);
    let mut written = 0usize;
    for dir in significant_subdirs(root) {
        let path = dir.join("AGENTS.md");
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let new = rewrite_md_with_block(&existing, &block, "AGENTS.md — sub-folder index");
        if new != existing {
            std::fs::write(&path, &new)?;
            written += 1;
        }
    }
    Ok(written)
}
