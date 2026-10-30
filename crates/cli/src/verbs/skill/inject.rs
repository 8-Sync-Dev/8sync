//! The 8sync block in every root agent entry file (AGENTS.md, CLAUDE.md, …) and
//! `.cursor/rules/8sync-harness.mdc`: STEP 0 (trail) + the memory rules. Skills,
//! agents and commands come from the global ECC plugin, never from the repo.
use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::ui;

pub(crate) const BEGIN: &str = "<!-- 8sync:skills:begin -->";
pub(crate) const END: &str = "<!-- 8sync:skills:end -->";

/// Find the byte offset of `needle` only when it occurs as the start of a line
/// (offset 0, or the byte immediately before is '\n'). Returns the offset of
/// the needle itself (not the newline).
fn find_line(hay: &str, needle: &str) -> Option<usize> {
    let bytes = hay.as_bytes();
    let mut start = 0;
    while let Some(rel) = hay[start..].find(needle) {
        let pos = start + rel;
        if pos == 0 || bytes[pos - 1] == b'\n' {
            return Some(pos);
        }
        start = pos + needle.len();
    }
    None
}

/// Locate the skills block, preferring the current (possibly rebranded)
/// sentinels and falling back to the legacy `8sync:` sentinels so a rebranded
/// binary migrates an existing file IN PLACE (no duplicate block). Returns
/// `(begin_offset, end_offset, end_marker_len)`.
fn find_block(existing: &str) -> Option<(usize, usize, usize)> {
    let cur_b = crate::brand::sentinel_begin();
    let cur_e = crate::brand::sentinel_end();
    for (bm, em) in [(cur_b.as_str(), cur_e.as_str()), (BEGIN, END)] {
        if let (Some(b), Some(e)) = (find_line(existing, bm), find_line(existing, em)) {
            if b < e {
                return Some((b, e, em.len()));
            }
        }
    }
    None
}

/// The block written between the sentinels of every agent entry file and the
/// Cursor rule. Deliberately small and machine-independent: no skill list (the
/// ECC plugin `ecc@ecc` provides skills/agents/commands globally, the repo's ECC
/// rule packs live in `.claude/rules/ecc/`), only STEP 0 and the memory rules.
/// Byte-stable on every run and machine, so the prompt prefix stays cache-hot.
pub(crate) fn harness_block() -> String {
    let block = format!(
        "{BEGIN}\n\
## 8sync harness\n\
\n\
**STEP 0 — code map trước (trail):** hỏi `trail` TRƯỚC grep/đọc cả file (tree-sitter local, không gọi model).\n\
- `trail ask \"<câu hỏi>\"` — định vị/giải thích code · `trail grep <pattern>` — tìm kèm ngữ cảnh symbol\n\
- `trail skeleton <file>` — khung file, không body · `trail callers <symbol>` (`--direction out` = callees) — impact trước khi sửa\n\
- Chỉ đọc raw file khi sắp sửa nó. Map cũ → `trail build`; repo chưa nối → `8sync trail`.\n\
\n\
**Quy tắc bất biến:**\n\
- Sau mỗi thay đổi: cập nhật `CHANGELOG.md` (mục `[Unreleased]`) + ghi bài học vào `su-code/KNOWLEDGE.md`.\n\
- Đọc `su-code/STATE.md` đầu phiên; rewrite nó ở mỗi phase-boundary (Goal · Checklist · Current · Next).\n\
\n\
**Skills / agents / commands:** plugin ECC `ecc@ecc` (global) + rule của repo trong `.claude/rules/ecc/`.\n\
{END}"
    );
    crate::brand::render(&block).into_owned()
}

/// True when `dir` is a su-code MEMORY dir (not a repo root): a dir named
/// `su-code` holding STATE.md/KNOWLEDGE.md, or a dir whose parent is such a dir
/// (e.g. the nested `su-code/su-code/`). Conservative: both need the marker file.
pub(crate) fn is_memory_dir(dir: &Path) -> bool {
    let has_markers = |d: &Path| d.join("STATE.md").is_file() || d.join("KNOWLEDGE.md").is_file();
    let named = |d: &Path| d.file_name().and_then(|n| n.to_str()) == Some("su-code");
    (named(dir) && has_markers(dir)) || dir.parent().is_some_and(|p| named(p) && has_markers(p))
}

/// True when an ancestor of `root` (up to `home`, exclusive) has a CLAUDE.md that
/// already carries the 8sync block. Claude Code loads ancestor CLAUDE.md files
/// too, so the child would duplicate it. Roots outside `home` → false.
pub(crate) fn ancestor_claude_has_block(home: &Path, root: &Path) -> bool {
    if !root.starts_with(home) {
        return false;
    }
    root.ancestors()
        .skip(1)
        .take_while(|a| *a != home)
        .any(|a| std::fs::read_to_string(a.join("CLAUDE.md")).is_ok_and(|t| find_block(&t).is_some()))
}

/// Keep the 8sync block in ancestor CLAUDE.md files current, git repo or not.
/// Claude Code loads every CLAUDE.md up the tree, so a stale FULL block in a plain
/// folder (e.g. `~/startup`, no `.git`) keeps being injected into every session.
/// Walks `start` and its ancestors up to `home` (exclusive; nothing above, nothing
/// when `start` is outside `home`). Only text between the markers is touched:
/// a block in a normal dir becomes the current block, a block in a su-code
/// MEMORY dir is removed (a bare 8sync stub is deleted with it; the original is
/// kept as `CLAUDE.md.bak-8sync`). Files without markers are never written.
/// Returns the files changed.
pub(crate) fn refresh_ancestor_blocks(home: &Path, start: &Path) -> Result<Vec<PathBuf>> {
    let mut changed = Vec::new();
    if !start.starts_with(home) {
        return Ok(changed);
    }
    let block = harness_block();
    for dir in start.ancestors().take_while(|a| *a != home) {
        let path = dir.join("CLAUDE.md");
        let Ok(old) = std::fs::read_to_string(&path) else { continue };
        let Some((b, e, elen)) = find_block(&old) else { continue };
        let crlf = old[b..e].contains("\r\n");
        let new = if is_memory_dir(dir) {
            strip_block(&old, b, e + elen)
        } else {
            let blk = if crlf { block.replace('\n', "\r\n") } else { block.clone() };
            format!("{}{}{}", &old[..b], blk, &old[e + elen..])
        };
        if new == old {
            continue;
        }
        if is_memory_dir(dir) && new.trim() == "# CLAUDE.md — guidance for Claude Code" {
            // Only the stub `inject_agents_md` seeds is left: 8sync made this file.
            crate::verbs::ccc::write_atomic_bak(&path, &old, &new)?;
            std::fs::remove_file(&path)?;
        } else {
            crate::verbs::ccc::write_atomic_bak(&path, &old, &new)?;
        }
        changed.push(path);
    }
    Ok(changed)
}

/// `old` without bytes `b..end` plus the line ending right after, and one blank line
/// when removal would leave two in a row. Everything else stays byte-for-byte.
fn strip_block(old: &str, b: usize, end: usize) -> String {
    let (head, mut tail) = (&old[..b], &old[end..]);
    tail = tail.strip_prefix("\r\n").or_else(|| tail.strip_prefix('\n')).unwrap_or(tail);
    if (head.ends_with("\n\n") || head.ends_with("\r\n\r\n")) && (tail.starts_with('\n') || tail.starts_with("\r\n")) {
        tail = tail.strip_prefix("\r\n").or_else(|| tail.strip_prefix('\n')).unwrap_or(tail);
    }
    format!("{head}{tail}")
}

/// Rewrite (or insert) the 8sync block in **every** agent entry file at the
/// project root: AGENTS.md, CLAUDE.md, GEMINI.md, OPENCODE.md,
/// .github/copilot-instructions.md, .cursorrules, .windsurfrules. Only the
/// sentinel block is rewritten; text outside it is never touched.
pub(crate) fn inject_agents_md(home: &Path, root: &Path) -> Result<()> {
    if is_memory_dir(root) {
        ui::info(&format!("skip 8sync block: {} is a su-code memory dir, not a repo root", root.display()));
        return Ok(());
    }
    let ancestor_dup = ancestor_claude_has_block(home, root);
    let block = harness_block();
    // Inject into every known agent entry file (markdown: sentinel rewrite or
    // skeleton; plain text: prepend). AGENTS.md + CLAUDE.md are stub-created;
    // the rest are touched only if they already exist.
    let targets: &[(&str, EntryKind)] = &[
        ("AGENTS.md",                       EntryKind::Markdown { h1: "AGENTS.md — guidance for AI" }),
        ("CLAUDE.md",                       EntryKind::Markdown { h1: "CLAUDE.md — guidance for Claude Code" }),
        ("GEMINI.md",                       EntryKind::Markdown { h1: "GEMINI.md — guidance for Gemini" }),
        ("OPENCODE.md",                     EntryKind::Markdown { h1: "OPENCODE.md — guidance for opencode" }),
        (".github/copilot-instructions.md", EntryKind::Markdown { h1: "GitHub Copilot instructions" }),
        (".cursorrules",                    EntryKind::Plain),
        (".windsurfrules",                  EntryKind::Plain),
    ];

    let mut written = 0usize;
    for (name, kind) in targets {
        let path = root.join(name);
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let stub_create = matches!(*name, "AGENTS.md" | "CLAUDE.md");
        if existing.is_empty() && !stub_create { continue; }

        // Never strip an existing block (the ancestor may exist only on this machine);
        // only skip CREATING one. An existing child block is still upserted (compacted).
        if *name == "CLAUDE.md" && ancestor_dup && find_block(&existing).is_none() {
            ui::info(&format!("skip {}: an ancestor CLAUDE.md already has the 8sync block", path.display()));
            continue;
        }
        let new_contents = match kind {
            EntryKind::Markdown { h1 } => rewrite_md_with_block(&existing, &block, h1),
            EntryKind::Plain => rewrite_plain_with_block(&existing, &block),
        };
        if new_contents != existing {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&path, &new_contents)?;
            ui::ok(&format!("injected 8sync block → {}", path.display()));
            written += 1;
        }
    }

    if written > 0 {
        ui::info(&format!("8sync block written into {written} file(s)"));
    }
    Ok(())
}

/// Cursor-native always-applied rule carrying the same block as AGENTS.md, so a
/// Cursor session gets STEP 0 and the memory rules without reading `~/.omp`.
pub(crate) fn inject_cursor_rule(root: &Path) -> Result<()> {
    let path = root.join(".cursor/rules/8sync-harness.mdc");
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let body = format!(
        "---\n\
         description: 8sync harness (trail code map first, memory rules). Always applied.\n\
         alwaysApply: true\n\
         ---\n\n\
         {}\n",
        harness_block().trim()
    );
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing != body {
        std::fs::write(&path, body)?;
        ui::ok(&format!("injected Cursor rule → {}", path.display()));
    }
    Ok(())
}

enum EntryKind {
    Markdown { h1: &'static str },
    Plain,
}

/// Markdown injection: replace existing sentinel block, or insert after the first
/// H1, or create a minimal skeleton if the file is empty.
pub(crate) fn rewrite_md_with_block(existing: &str, block: &str, h1_title: &str) -> String {
    if let Some((b, e, elen)) = find_block(existing) {
        let mut s = String::with_capacity(existing.len() + block.len());
        s.push_str(&existing[..b]);
        s.push_str(block);
        s.push_str(&existing[e + elen..]);
        return s;
    }
    if existing.is_empty() {
        return format!("# {h1_title}\n\n{block}\n");
    }
    insert_block_after_h1(existing, block)
}

/// Plain-text injection (.cursorrules / .windsurfrules): replace existing
/// sentinel block, or prepend the block at the top of the file.
fn rewrite_plain_with_block(existing: &str, block: &str) -> String {
    if let Some((b, e, elen)) = find_block(existing) {
        let mut s = String::with_capacity(existing.len() + block.len());
        s.push_str(&existing[..b]);
        s.push_str(block);
        s.push_str(&existing[e + elen..]);
        return s;
    }
    let sep = if existing.is_empty() { "" } else { "\n\n" };
    format!("{block}{sep}{existing}")
}

fn insert_block_after_h1(existing: &str, block: &str) -> String {
    if existing.is_empty() {
        return format!("# AGENTS.md\n\n{block}\n");
    }
    let mut out = String::with_capacity(existing.len() + block.len() + 8);
    let mut inserted = false;
    let mut prev_was_h1 = false;
    for line in existing.lines() {
        out.push_str(line);
        out.push('\n');
        if !inserted {
            if prev_was_h1 {
                out.push('\n');
                out.push_str(block);
                out.push_str("\n\n");
                inserted = true;
                prev_was_h1 = false;
            } else if line.starts_with("# ") {
                prev_was_h1 = true;
            }
        }
    }
    if !inserted {
        let mut s = String::with_capacity(existing.len() + block.len() + 4);
        s.push_str(block);
        s.push_str("\n\n");
        s.push_str(existing);
        return s;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The block is the whole contract now: STEP 0 (the four trail verbs), the
    /// memory rules, and the ECC pointer — no skill list, no machine path.
    #[test]
    fn block_is_minimal_and_lists_no_skills() {
        let b = harness_block();
        assert!(b.starts_with(BEGIN) && b.ends_with(END));
        for verb in ["trail ask", "trail grep", "trail skeleton", "trail callers"] {
            assert!(b.contains(verb), "STEP 0 must teach `{verb}`");
        }
        for rule in ["CHANGELOG.md", "[Unreleased]", "su-code/KNOWLEDGE.md", "su-code/STATE.md"] {
            assert!(b.contains(rule), "invariant rule `{rule}` missing");
        }
        assert!(b.contains("`ecc@ecc`") && b.contains("`.claude/rules/ecc/`"));
        assert!(!b.contains("SKILL.md") && !b.contains("su-code/skills") && !b.contains("~/.omp/skills"), "no skill list:\n{b}");
        assert!(b.lines().count() <= 16, "block grew to {} lines", b.lines().count());
        assert_eq!(harness_block(), b, "byte-stable on rebuild");
    }

    /// Re-running the harness rewrites ONLY the sentinel block: the user's text
    /// around it survives byte for byte, and a second pass changes nothing.
    #[test]
    fn block_rewrite_keeps_outside_text_and_is_idempotent() {
        let base = tmp("idem");
        let (home, root) = (base.join("home"), base.join("repo"));
        std::fs::create_dir_all(&root).unwrap();
        let old_block = format!("{BEGIN}\n## 🚨 STEP 1 — skills\n  1. `su-code/skills/trail/SKILL.md`\n{END}");
        let agents = format!("# Mine\n\nbefore \u{e9}\n\n{old_block}\n\nafter\n");
        let claude = format!("# C\r\nkeep top\r\n{old_block}\r\nkeep bottom\r\n");
        std::fs::write(root.join("AGENTS.md"), &agents).unwrap();
        std::fs::write(root.join("CLAUDE.md"), &claude).unwrap();
        inject_agents_md(&home, &root).unwrap();
        let block = harness_block();
        let a1 = std::fs::read_to_string(root.join("AGENTS.md")).unwrap();
        assert_eq!(a1, agents.replace(&old_block, &block));
        let c1 = std::fs::read_to_string(root.join("CLAUDE.md")).unwrap();
        assert_eq!(c1, claude.replace(&old_block, &block), "same block in CLAUDE.md, CRLF outside kept");
        inject_agents_md(&home, &root).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("AGENTS.md")).unwrap(), a1, "idempotent");
        assert_eq!(std::fs::read_to_string(root.join("CLAUDE.md")).unwrap(), c1, "idempotent");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn cursor_rule_is_always_apply_mdc_with_the_same_block() {
        let root = tmp("cursor-rule");
        inject_cursor_rule(&root).unwrap();
        let path = root.join(".cursor/rules/8sync-harness.mdc");
        let body = std::fs::read_to_string(&path).unwrap();
        assert!(body.contains("alwaysApply: true"), "Cursor standard: alwaysApply mdc");
        assert!(body.contains(harness_block().trim()));
        assert!(!body.contains("su-code/skills") && !body.contains(".cursor/skills"));
        inject_cursor_rule(&root).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), body);
        let _ = std::fs::remove_dir_all(&root);
    }

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("8sync-inject-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn memory_dir_detection() {
        let b = tmp("mem");
        let mem = b.join("su-code");
        std::fs::create_dir_all(mem.join("su-code")).unwrap();
        assert!(!is_memory_dir(&mem), "no marker file yet");
        std::fs::write(mem.join("STATE.md"), "x").unwrap();
        assert!(is_memory_dir(&mem));
        assert!(is_memory_dir(&mem.join("su-code")), "nested dir under a memory dir");
        assert!(!is_memory_dir(&b), "repo root is not a memory dir");
        let other = b.join("other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("STATE.md"), "x").unwrap();
        assert!(!is_memory_dir(&other), "name must be su-code");
        let _ = std::fs::remove_dir_all(&b);
    }

    #[test]
    fn ancestor_block_detected_up_to_home() {
        let home = tmp("anc");
        let proj = home.join("startup");
        let child = proj.join("app");
        std::fs::create_dir_all(&child).unwrap();
        assert!(!ancestor_claude_has_block(&home, &child));
        std::fs::write(proj.join("CLAUDE.md"), format!("# x\n{BEGIN}\nold\n{END}\n")).unwrap();
        assert!(ancestor_claude_has_block(&home, &child));
        assert!(!ancestor_claude_has_block(&home, &proj), "own file is not an ancestor");
        // $HOME's own CLAUDE.md is excluded
        std::fs::remove_file(proj.join("CLAUDE.md")).unwrap();
        std::fs::write(home.join("CLAUDE.md"), format!("{BEGIN}\nx\n{END}\n")).unwrap();
        assert!(!ancestor_claude_has_block(&home, &child));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn ancestor_block_skips_create_but_keeps_and_compacts_existing() {
        let home = tmp("dup");
        let proj = home.join("startup");
        let (new, old) = (proj.join("new"), proj.join("old"));
        std::fs::create_dir_all(&new).unwrap();
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(proj.join("CLAUDE.md"), format!("# p\n{BEGIN}\nx\n{END}\n")).unwrap();
        std::fs::write(old.join("CLAUDE.md"), format!("# mine\nkeep top\n{BEGIN}\nold\n{END}\nkeep bottom\n")).unwrap();
        inject_agents_md(&home, &new).unwrap();
        assert!(!new.join("CLAUDE.md").exists(), "no new block created under an ancestor block");
        inject_agents_md(&home, &old).unwrap();
        let out = std::fs::read_to_string(old.join("CLAUDE.md")).unwrap();
        assert!(out.contains(BEGIN) && out.contains("keep top") && out.contains("keep bottom") && !out.contains("\nold\n"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn new_block_replaces_old_full_block() {
        let blk = harness_block();
        assert!(!blk.contains("ĐỌC NGAY") && !blk.contains("LUÔN có"));
        let old = format!("# T\n\nmine-before\n\n{BEGIN}\n## OLD full block\n{END}\n\nmine-after\n");
        let out = rewrite_md_with_block(&old, &blk, "T");
        assert!(!out.contains("OLD full block"));
        assert!(out.contains("mine-before") && out.contains("mine-after"));
        assert_eq!(out.matches(BEGIN).count(), 1);
    }

    const FULL: &str = "## OLD full block\nĐỌC NGAY the old stack LUÔN có\n";

    #[test]
    fn ancestor_refresh_compacts_full_block_in_non_git_dir_keeping_user_text() {
        let home = tmp("anc-refresh");
        let (up, leaf) = (home.join("startup"), home.join("startup/app/deep"));
        std::fs::create_dir_all(&leaf).unwrap();
        let old = format!("# Mine\nbefore\n\n{BEGIN}\n{FULL}{END}\n\nafter \u{e9}\n");
        std::fs::write(up.join("CLAUDE.md"), &old).unwrap();
        // no markers -> untouched; $HOME itself -> untouched
        std::fs::write(up.join("app/CLAUDE.md"), "# plain\n").unwrap();
        std::fs::write(home.join("CLAUDE.md"), &old).unwrap();
        let ch = refresh_ancestor_blocks(&home, &leaf).unwrap();
        assert_eq!(ch, vec![up.join("CLAUDE.md")]);
        let out = std::fs::read_to_string(up.join("CLAUDE.md")).unwrap();
        assert!(out.starts_with("# Mine\nbefore\n\n") && out.ends_with("\n\nafter \u{e9}\n"));
        assert!(!out.contains("OLD full block") && out.len() < old.len() + 1100);
        assert_eq!(out.matches(BEGIN).count(), 1);
        assert_eq!(std::fs::read_to_string(up.join("CLAUDE.md.bak-8sync")).unwrap(), old);
        assert_eq!(std::fs::read_to_string(up.join("app/CLAUDE.md")).unwrap(), "# plain\n");
        assert_eq!(std::fs::read_to_string(home.join("CLAUDE.md")).unwrap(), old, "$HOME untouched");
        assert!(refresh_ancestor_blocks(&home, &leaf).unwrap().is_empty(), "idempotent");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn ancestor_refresh_never_goes_above_home_or_outside_it() {
        let root = tmp("above");
        let (home, outside) = (root.join("home"), root.join("other"));
        std::fs::create_dir_all(home.join("p")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let old = format!("{BEGIN}\n{FULL}{END}\n");
        std::fs::write(root.join("CLAUDE.md"), &old).unwrap(); // above $HOME
        std::fs::write(outside.join("CLAUDE.md"), &old).unwrap();
        assert!(refresh_ancestor_blocks(&home, &home.join("p")).unwrap().is_empty());
        assert!(refresh_ancestor_blocks(&home, &outside).unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(root.join("CLAUDE.md")).unwrap(), old);
        assert_eq!(std::fs::read_to_string(outside.join("CLAUDE.md")).unwrap(), old);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ancestor_refresh_preserves_crlf_outside_markers() {
        let home = tmp("crlf");
        let d = home.join("w");
        std::fs::create_dir_all(&d).unwrap();
        let old = format!("# T\r\nmine\r\n{BEGIN}\r\n{}{END}\r\ntail\r\n", FULL.replace('\n', "\r\n"));
        std::fs::write(d.join("CLAUDE.md"), &old).unwrap();
        refresh_ancestor_blocks(&home, &d).unwrap();
        let out = std::fs::read_to_string(d.join("CLAUDE.md")).unwrap();
        assert!(out.starts_with("# T\r\nmine\r\n") && out.ends_with("\r\ntail\r\n"));
        assert!(!out.replace("\r\n", "").contains('\n'), "no bare LF left");
        assert!(!out.contains("OLD full block"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn memory_dir_claude_md_loses_the_block_user_text_kept_stub_deleted() {
        let home = tmp("mem-strip");
        let (mem, mem2) = (home.join("startup/su-code"), home.join("proj/su-code"));
        for m in [&mem, &mem2] {
            std::fs::create_dir_all(m).unwrap();
            std::fs::write(m.join("STATE.md"), "s").unwrap();
        }
        // stub made by 8sync: h1 + block only -> deleted (backup kept)
        std::fs::write(mem.join("CLAUDE.md"), format!("# CLAUDE.md — guidance for Claude Code\n\n{BEGIN}\n{FULL}{END}\n")).unwrap();
        // user text around the block -> kept, file stays
        std::fs::write(mem2.join("CLAUDE.md"), format!("# Notes\n\nkeep me\n\n{BEGIN}\n{FULL}{END}\n\nand me\n")).unwrap();
        let ch = refresh_ancestor_blocks(&home, &mem).unwrap();
        assert_eq!(ch.len(), 1);
        assert!(!mem.join("CLAUDE.md").exists() && mem.join("CLAUDE.md.bak-8sync").exists());
        refresh_ancestor_blocks(&home, &mem2).unwrap();
        assert_eq!(std::fs::read_to_string(mem2.join("CLAUDE.md")).unwrap(), "# Notes\n\nkeep me\n\nand me\n");
        let _ = std::fs::remove_dir_all(&home);
    }
}
