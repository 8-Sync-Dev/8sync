//! Agent-memory + CHANGELOG seeding and the managed harness breadcrumb in
//! su-code/KNOWLEDGE.md.
use anyhow::Result;
use std::path::{Path, PathBuf};

use crate::ui;
use crate::verbs::skill::index::always_on_names_in_order;

/// Verifiable facts about THIS repo, for `su-code/PROJECT.md`.
///
/// The file used to be seeded as literally `_empty_`, which wasted the single
/// highest-leverage read an agent makes: the first one. An agent that does not
/// know the stack guesses the build command, greps for an entrypoint, and burns
/// context rediscovering what a manifest states outright.
///
/// Only things read off disk are written — never a guess. Nothing recognised
/// yields the old empty skeleton rather than a confident lie.
fn project_facts(root: &Path) -> Option<String> {
    let read = |f: &str| std::fs::read_to_string(root.join(f)).ok();
    let mut stacks: Vec<String> = Vec::new();
    let mut cmds: Vec<(&str, String)> = Vec::new();

    if let Some(s) = read("Cargo.toml") {
        let name = toml_str(&s, "name").unwrap_or_else(|| "?".into());
        let kind = if s.contains("[workspace]") { "Rust workspace" } else { "Rust crate" };
        stacks.push(format!("{kind} `{name}`"));
        cmds.push(("build", "cargo build --release".into()));
        cmds.push(("test", "cargo test".into()));
        cmds.push(("lint", "cargo clippy".into()));
    }
    if let Some(s) = read("package.json") {
        let name = json_str(&s, "name").unwrap_or_else(|| "?".into());
        // Framework beats "Node": it decides where routes and entrypoints live.
        let fw = ["next", "nuxt", "astro", "svelte", "remix", "vite", "encore.dev", "express", "fastify"]
            .iter()
            .find(|f| s.contains(&format!("\"{f}\"")))
            .map(|f| format!(" ({f})"))
            .unwrap_or_default();
        stacks.push(format!("Node/TS `{name}`{fw}"));
        for k in ["dev", "build", "test", "lint"] {
            if s.contains(&format!("\"{k}\":")) {
                cmds.push((k, format!("npm run {k}")));
            }
        }
    }
    if let Some(s) = read("pyproject.toml") {
        let name = toml_str(&s, "name").unwrap_or_else(|| "?".into());
        let fw = ["fastapi", "django", "flask"]
            .iter()
            .find(|f| s.contains(*f))
            .map(|f| format!(" ({f})"))
            .unwrap_or_default();
        stacks.push(format!("Python `{name}`{fw}"));
        cmds.push(("test", "pytest".into()));
    }
    if let Some(s) = read("go.mod") {
        let m = s.lines().find_map(|l| l.strip_prefix("module ")).unwrap_or("?").trim();
        stacks.push(format!("Go `{m}`"));
        cmds.push(("build", "go build ./...".into()));
        cmds.push(("test", "go test ./...".into()));
    }
    if stacks.is_empty() {
        return None;
    }

    let entries: Vec<&str> = [
        "src/main.rs", "src/lib.rs", "src/index.ts", "src/index.js", "src/app/page.tsx",
        "main.py", "app/main.py", "src/main.py", "main.go", "cmd",
    ]
    .into_iter()
    .filter(|p| root.join(p).exists())
    .collect();

    let mut out = String::from("# PROJECT (8sync managed — facts only)\n\n");
    out.push_str("_Detected from the manifests on disk at harness time. Correct anything wrong;\nthis file is seeded once and never overwritten._\n\n");
    out.push_str(&format!("## Stack\n{}\n\n", stacks.iter().map(|s| format!("- {s}")).collect::<Vec<_>>().join("\n")));
    if !entries.is_empty() {
        out.push_str(&format!("## Entrypoints\n{}\n\n", entries.iter().map(|e| format!("- `{e}`")).collect::<Vec<_>>().join("\n")));
    }
    if !cmds.is_empty() {
        out.push_str("## Commands\n");
        for (k, v) in &cmds {
            out.push_str(&format!("- {k}: `{v}`\n"));
        }
        out.push('\n');
    }
    Some(out)
}

/// First `key = "value"` in a TOML blob. Deliberately not a full parse: this is
/// a best-effort seed, and a malformed manifest must not fail the harness run.
fn toml_str(s: &str, key: &str) -> Option<String> {
    s.lines()
        .map(str::trim)
        .find(|l| l.starts_with(key) && l.contains('='))
        .and_then(|l| l.split('=').nth(1))
        .map(|v| v.trim().trim_matches('"').to_string())
        .filter(|v| !v.is_empty())
}

fn json_str(s: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\"");
    let rest = &s[s.find(&pat)? + pat.len()..];
    let rest = rest.trim_start().strip_prefix(':')?.trim_start();
    let inner = rest.strip_prefix('"')?;
    inner.find('"').map(|e| inner[..e].to_string()).filter(|v| !v.is_empty())
}

/// Structured live-plan seed for `su-code/STATE.md` — the loop-engineering
/// recitation anchor (Manus todo.md pattern): the agent rewrites it at each
/// phase boundary and reads it at session start, keeping the plan in recent
/// context (anti lost-in-the-middle). Seeded once; never overwritten if present.
const STATE_TEMPLATE: &str = "\
# STATE (8sync managed — live plan; rewrite ở MỖI phase-boundary, đọc đầu phiên)

## Goal
_một câu: kết quả cần đạt_

## Definition of Done
- [ ] _tiêu chí nghiệm thu_

## Checklist
- [ ] _bước 1_

## Current step
_đang làm gì_

## Next
_bước kế tiếp_

## Assumptions (auto-decided — user can correct)
_none — trong `/auto`: thay vì hỏi, research → quyết → ghi giả định ở đây (cái gì + vì sao)._

## Open questions / blockers
_none_

## Handoff (compaction)
_none — khi context gần đầy: ghi Done · In-flight · Next · Open-questions vào đây + bài học vào KNOWLEDGE, rồi reinit phiên mới chỉ đọc spine._
";

/// Procedural-memory seed for `su-code/PLAYBOOKS.md` (Voyager-style skill
/// library): validated multi-step procedures distilled into reusable runbooks
/// indexed by a `When:` line. Seeded once; appended to by the agent.
const PLAYBOOKS_TEMPLATE: &str = "\
# PLAYBOOKS (8sync managed — procedural memory, append-only)

Runbook tái dùng cho quy trình ĐÃ `validated:`. Index theo `When:` để retrieve;
Voyager-style: lưu cái đã chạy được, lần sau adapt thay vì suy luận lại.

## Template
### <tên ngắn>
- **When:** _tình huống kích hoạt (1 dòng để match)_
- **Steps:** _các bước đã verify_
- **Verify:** _cách kiểm chứng_
- **Pitfalls:** _bẫy đã gặp_

_empty_
";

/// Epoch-seconds stamp in the repo's `epoch:<n>` convention (no chrono dep).
pub(crate) fn now_stamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch:{}", secs)
}

/// Replace the text between `begin`/`end` sentinels in `path`, or prepend the
/// block at the top when the sentinels are absent. Creates the file if missing.
pub(crate) fn upsert_block(path: &Path, begin: &str, end: &str, body: &str) -> Result<()> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let block = format!("{begin}\n{body}\n{end}");
    let new = match (existing.find(begin), existing.find(end)) {
        (Some(b), Some(e)) if b < e => {
            let mut s = String::with_capacity(existing.len() + block.len());
            s.push_str(&existing[..b]);
            s.push_str(&block);
            s.push_str(&existing[e + end.len()..]);
            s
        }
        _ if existing.is_empty() => format!("{block}\n"),
        _ => format!("{block}\n\n{existing}"),
    };
    if new != existing {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(path, new)?;
    }
    Ok(())
}

/// Seed/refresh a managed block in `<root>/.gitignore` so durable agent memory
/// + skills stay committed (portable to a new machine) while derived caches and
/// secrets are ignored. Only the sentinel-bounded block is owned; any user
/// entries outside it (incl. a tool-repo's own `su-code/skills/` rule) survive.
pub(crate) fn seed_gitignore(root: &Path) -> Result<()> {
    let body = concat!(
        "# Derived / machine-local — rebuilt by `8sync harness init` + trail. Safe to ignore:\n",
        "graft/\n",
        // Legacy (codegraph era): kept so old checkouts keep ignoring their index.
        ".codegraph/\n",
        ".cache/8sync/\n",
        ".gs/\n",
        "# Large-scope feature-planning evidence screenshots (regenerable binaries):\n",
        "su-code/planning/**/evidence-*.png\n",
        "# Secrets — NEVER commit:\n",
        ".env\n",
        ".env.*\n",
        "!.env.example\n",
        "*.pem\n",
        "*.p12\n",
        "*.pfx\n",
        "id_rsa*\n",
        "id_ed25519*\n",
        "*.session\n",
        "*.session-journal\n",
        "*.pkl\n",
        "# KEEP COMMITTED (do NOT add here): su-code/ (memory), AGENTS.md, CHANGELOG.md, .cursor/rules/\n",
        "# Host skill mirrors (rebuilt from su-code/skills/ by `8sync harness create`).\n",
        "# No trailing slash: git sees a symlink/junction as a file, and `dir/` never matches it.\n",
        ".cursor/skills\n",
        ".zcode/skills\n",
    );
    // `.claude/skills` is 8sync's link only when the repo has no skills of its own
    // there; `.claude/settings.local.json` (skill listing overrides) is per machine.
    let claude = if crate::verbs::skill::deploy::claude_skills_is_ours(root) { ".claude/skills\n.claude/settings.local.json\n" } else { ".claude/settings.local.json\n" };
    upsert_block(
        &root.join(".gitignore"),
        "# >>> 8sync (managed) >>>",
        "# <<< 8sync <<<",
        &format!("{body}{claude}"),
    )
}

/// One-time legacy `agents/` → `su-code/` migration. Renames the old agent-memory
/// dir to the new `su-code/` marker and rewrites `agents/` → `su-code/` path
/// references in the anchor + live memory markdown. Only fires on a real 8sync
/// memory dir (identified by its files), so a source package literally named
/// `agents/` is never touched. Idempotent: no-op once `su-code/` exists or when
/// no legacy dir is present.
pub(crate) fn migrate_legacy_layout(root: &Path) -> Result<bool> {
    let legacy = root.join("agents");
    let dest = root.join("su-code");
    if dest.is_dir() || !legacy.is_dir() {
        return Ok(false);
    }
    let is_memory = ["STATE.md", "KNOWLEDGE.md", "PROJECT.md", "PLAYBOOKS.md", "skills.toml"]
        .iter()
        .any(|f| legacy.join(f).exists())
        || legacy.join("skills").is_dir();
    if !is_memory {
        return Ok(false);
    }
    std::fs::rename(&legacy, &dest)?;
    let _ = rewrite_legacy_refs(root);
    let _ = seed_gitignore(root); // re-emit the managed block with `su-code/` wording
    ui::ok(&format!("migrated agents/ → su-code/ ({})", root.display()));
    Ok(true)
}

/// Rewrite `agents/` → `su-code/` path references in the anchor files and the
/// live memory markdown (root `*.md` + top-level `su-code/*.md`). Scoped to text
/// docs; never rewrites source code or historical archives. `.agents/` (a foreign
/// skill convention) and `subagents/` are protected. Best-effort per file.
fn rewrite_legacy_refs(root: &Path) -> Result<()> {
    let mut targets: Vec<PathBuf> = Vec::new();
    for f in ["AGENTS.md", "CLAUDE.md"] {
        let p = root.join(f);
        if p.is_file() {
            targets.push(p);
        }
    }
    for dir in [root.to_path_buf(), root.join("su-code")] {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("md") {
                    targets.push(p);
                }
            }
        }
    }
    for p in targets {
        let Ok(s) = std::fs::read_to_string(&p) else {
            continue;
        };
        let n = s
            .replace(".agents/", "\u{0}D\u{0}")
            .replace("subagents/", "\u{0}S\u{0}")
            .replace("agents/", "su-code/")
            .replace("\u{0}S\u{0}", "subagents/")
            .replace("\u{0}D\u{0}", ".agents/");
        if n != s {
            let _ = std::fs::write(&p, n);
        }
    }
    Ok(())
}

/// Ensure the project carries the 8sync agent-memory files + a CHANGELOG, and
/// refresh the managed harness breadcrumb in su-code/KNOWLEDGE.md. Memory files
/// are seeded only when missing; the KNOWLEDGE block is a sentinel-bounded
/// managed region (always current, never spam-appended).
pub(crate) fn seed_harness_memory(root: &Path) -> Result<()> {
    let _ = migrate_legacy_layout(root);
    let agents_dir = root.join("su-code");
    std::fs::create_dir_all(&agents_dir)?;
    seed_gitignore(root)?;
    for f in ["PROJECT.md", "KNOWLEDGE.md", "DECISIONS.md", "PREFERENCES.md", "STATE.md", "PLAYBOOKS.md", "NOTES.md"] {
        let p = agents_dir.join(f);
        if !p.exists() {
            // KNOWLEDGE.md carries an append-only "Learnings" zone below the managed
            // breadcrumb block (which `harness up` overwrites) so learnings persist.
            let content = if f == "KNOWLEDGE.md" {
                "# KNOWLEDGE (8sync managed — append-only)\n\n## Learnings (append-only — ghi DƯỚI đây; KHÔNG sửa block `8sync:harness` ở trên)\n\nMỗi entry prefix `validated:` (test/build xác nhận) · `hypothesis:` (chưa) · `failure:` (lỗi đã gặp + cách sửa; đọc đầu phiên để khỏi lặp).\n\n_empty_\n".to_string()
            } else if f == "STATE.md" {
                STATE_TEMPLATE.to_string()
            } else if f == "PLAYBOOKS.md" {
                PLAYBOOKS_TEMPLATE.to_string()
            } else if f == "PROJECT.md" {
                project_facts(root)
                    .unwrap_or_else(|| "# PROJECT (8sync managed — append-only)\n\n_empty_\n".into())
            } else {
                format!("# {} (8sync managed — append-only)\n\n_empty_\n", f.trim_end_matches(".md"))
            };
            std::fs::write(&p, content)?;
        }
    }
    // CHANGELOG.md — Keep a Changelog skeleton, created once.
    let changelog = root.join("CHANGELOG.md");
    if !changelog.exists() {
        std::fs::write(
            &changelog,
            concat!(
                "# Changelog\n\n",
                "Mọi thay đổi đáng kể ghi vào đây — format [Keep a Changelog](https://keepachangelog.com), ",
                "versioning [SemVer](https://semver.org).\n",
                "**8sync rule:** mỗi PR cập nhật mục `Unreleased` bên dưới.\n\n",
                "## [Unreleased]\n\n",
            ),
        )?;
        ui::ok(&format!("seeded {}", changelog.display()));
    }
    // KNOWLEDGE.md — managed harness breadcrumb (always current).
    let chain = {
        let names = always_on_names_in_order(root);
        if names.is_empty() {
            "trail → karpathy → ponytail → assp → impeccable → taste → 8sync-cli → image-routing".to_string()
        } else {
            names.join(" → ")
        }
    };
    let body = format!(
        "## 🧠 8sync harness\n\n\
- **Always-on (đọc theo thứ tự; CORE đọc body ngay, SPECIALIST đọc khi task khớp):** {}.\n\
- **Cách tận dụng:** trail = explore code (ask/callers/skeleton, không grep) · karpathy + ponytail = YAGNI, làm ít nhất, xoá > thêm · impeccable = design CHUẨN, BẮT BUỘC khi UI/design (đọc body lúc đó) + taste chống slop.\n\
- **Output lớn (>~50 dòng) → BẮT BUỘC `headroom_compress`** trước khi vào context.\n\
- **Sau mỗi thay đổi:** cập nhật `CHANGELOG.md` (Unreleased) + ghi học được vào file này (prefix `validated:` nếu test/build xác nhận, `hypothesis:` nếu chưa).",
        chain,
    );
    upsert_block(
        &agents_dir.join("KNOWLEDGE.md"),
        "<!-- 8sync:harness:begin -->",
        "<!-- 8sync:harness:end -->",
        &body,
    )?;
    Ok(())
}

/// Bound the append-only `## Learnings` zone in su-code/KNOWLEDGE.md (anti
/// context-rot, Hindsight 4-lever): when it exceeds the budget, archive the
/// OLDER lines to su-code/archive/ and keep the most recent, leaving a pointer.
/// Best-effort; git history preserves the full trail.
pub(crate) fn consolidate_learnings(root: &Path) -> Result<()> {
    const BUDGET: usize = 200;
    let path = root.join("su-code/KNOWLEDGE.md");
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Ok(());
    };
    let Some(hpos) = content.find("\n## Learnings") else {
        return Ok(());
    };
    // Body = everything after the header line's trailing newline.
    let Some(nl) = content[hpos + 1..].find('\n') else {
        return Ok(());
    };
    let after_header = hpos + 1 + nl + 1;
    let head = &content[..after_header];
    let body_lines: Vec<&str> = content[after_header..].lines().collect();
    if body_lines.len() <= BUDGET {
        return Ok(());
    }
    let keep_from = body_lines.len() - BUDGET;
    let archived = body_lines[..keep_from].join("\n");
    let kept = body_lines[keep_from..].join("\n");
    let stamp = now_stamp().trim_start_matches("epoch:").to_string();
    let archive_dir = root.join("su-code/archive");
    std::fs::create_dir_all(&archive_dir)?;
    std::fs::write(
        archive_dir.join(format!("KNOWLEDGE-{}.md", stamp)),
        format!("# Archived learnings ({})\n\n{}\n", now_stamp(), archived),
    )?;
    let new = format!(
        "{}_(consolidated {} dòng cũ → su-code/archive/KNOWLEDGE-{}.md)_\n{}",
        head, keep_from, stamp, kept
    );
    std::fs::write(&path, new)?;
    ui::ok(&format!(
        "consolidated KNOWLEDGE learnings → archived {} older line(s)",
        keep_from
    ));
    Ok(())
}

/// Install a gitleaks pre-commit hook so any commit (incl. `harness up --commit`)
/// is secret-scanned. Non-destructive: only when gitleaks is installed,
/// `.git/hooks/` exists, and no pre-commit hook is already present.
pub(crate) fn seed_gitleaks_hook(root: &Path) {
    let hooks = root.join(".git/hooks");
    if !hooks.is_dir() {
        return;
    }
    let hook = hooks.join("pre-commit");
    if hook.exists() || which::which("gitleaks").is_err() {
        return;
    }
    let body = "#!/bin/sh\n# 8sync: block commits containing secrets (gitleaks).\ncommand -v gitleaks >/dev/null 2>&1 || exit 0\ngitleaks protect --staged --no-banner\n";
    if std::fs::write(&hook, body).is_ok() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755));
        }
        ui::ok("installed gitleaks pre-commit hook (.git/hooks/pre-commit)");
    }
}

#[cfg(test)]
mod project_facts_tests {
    use super::*;

    /// Unique per test so the suite stays parallel-safe; the crate carries no
    /// dev-dependencies and the rest of the suite builds scratch dirs the same way.
    struct Scratch(PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scratch(tag: &str, files: &[(&str, &str)]) -> Scratch {
        let d = std::env::temp_dir().join(format!("8sync-facts-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&d);
        for (p, body) in files {
            let full = d.join(p);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, body).unwrap();
        }
        Scratch(d)
    }

    /// The framework matters more than the language: it decides where routes and
    /// entrypoints live, which is the thing an agent would otherwise grep for.
    #[test]
    fn detects_framework_entrypoint_and_commands_per_ecosystem() {
        let d = scratch("node", &[
            ("package.json", r#"{"name":"shop","dependencies":{"next":"15"},"scripts":{"build":"next build"}}"#),
            ("src/app/page.tsx", ""),
        ]);
        let f = project_facts(&d.0).expect("node project recognised");
        assert!(f.contains("Node/TS `shop` (next)"), "{f}");
        assert!(f.contains("`src/app/page.tsx`"), "{f}");
        assert!(f.contains("npm run build"), "{f}");
        // A script that is absent must not be advertised.
        assert!(!f.contains("npm run test"), "{f}");
    }

    #[test]
    fn detects_go_module_path() {
        let d = scratch("go", &[("go.mod", "module github.com/acme/gw\n\ngo 1.23\n"), ("main.go", "")]);
        let f = project_facts(&d.0).unwrap();
        assert!(f.contains("Go `github.com/acme/gw`"), "{f}");
        assert!(f.contains("go test ./..."), "{f}");
    }

    /// A polyglot repo is the normal case for a large project; report every stack
    /// rather than letting whichever manifest is checked first win.
    #[test]
    fn reports_every_stack_in_a_polyglot_repo() {
        let d = scratch("poly", &[
            ("Cargo.toml", "[package]\nname = \"engine\"\n"),
            ("pyproject.toml", "[project]\nname = \"trainer\"\n"),
        ]);
        let f = project_facts(&d.0).unwrap();
        assert!(f.contains("Rust crate `engine`"), "{f}");
        assert!(f.contains("Python `trainer`"), "{f}");
    }

    /// Never invent facts: an unrecognised tree falls back to the empty skeleton.
    #[test]
    fn unknown_project_yields_no_facts() {
        let d = scratch("unknown", &[("README.md", "# hi")]);
        assert!(project_facts(&d.0).is_none());
    }

    /// A malformed manifest must degrade, never abort the harness run.
    #[test]
    fn malformed_manifest_still_produces_a_usable_seed() {
        let d = scratch("malformed", &[("package.json", "{ this is not json")]);
        let f = project_facts(&d.0).expect("still recognised as a node project");
        assert!(f.contains("Node/TS `?`"), "{f}");
    }
}
