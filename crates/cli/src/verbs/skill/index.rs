//! Sub-folder AGENTS.md pointer (progressive disclosure). Agents read the
//! NEAREST AGENTS.md in the tree, so every significant sub-directory gets a
//! compact pointer back to the root AGENTS.md.
use anyhow::Result;
use std::path::{Path, PathBuf};

use super::inject::{rewrite_md_with_block, BEGIN, END};

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

/// Compact "you are in a sub-folder" block: points to the root AGENTS.md and
/// restates STEP 0. Repo-relative only — the repo is cloned to a different
/// absolute path on every machine.
fn subfolder_index_block() -> String {
    let block = format!(
        "{BEGIN}\n\
## 8sync harness — sub-folder\n\
\n\
Rule đầy đủ ở `AGENTS.md` tại REPO ROOT (không phải file này) — đọc nó trước. \
STEP 0: `trail ask` / `trail grep` / `trail skeleton` / `trail callers` thay cho grep/đọc cả file. \
Skills/agents/commands: plugin ECC `ecc@ecc` + `.claude/rules/ecc/`. \
Sau mỗi thay đổi: `CHANGELOG.md` + `su-code/KNOWLEDGE.md`.\n\
{END}"
    );
    crate::brand::render(&block).into_owned()
}

/// Drop/refresh a compact skill-index AGENTS.md in every significant sub-folder.
/// Idempotent via the shared sentinels. Returns the number of files written.
pub(crate) fn inject_subfolder_indexes(root: &Path) -> Result<usize> {
    let block = subfolder_index_block();
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
