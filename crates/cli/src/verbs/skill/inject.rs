//! Force-load block injection into root agent entry files (AGENTS.md, CLAUDE.md,
//! …) + always-on ranking + project-tech gating for conditional skills.
use anyhow::Result;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use super::discover::list_installed_skill_dirs;
use super::meta::meta_for_dir;
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

/// Priority rank for always-on skills (lower = read earlier). The force-load
/// block lists always-on skills in EXACTLY this order; agents read top-down so
/// position == priority. The canonical chain is:
///   codegraph → karpathy → ponytail → assp → impeccable → taste → 8sync-cli → image-routing → locate-anything
/// codegraph (code intel), karpathy (engineering discipline) and ponytail
/// (lazy-senior YAGNI) form the engineering core; the brand + frontend-design
/// skills follow; the harness/token-routing tooling closes. Skills not listed
/// here are on-demand (read only when the task matches their description) and
/// rank `usize::MAX`.
pub(crate) fn always_on_rank(dirname: &str) -> usize {
    match dirname {
        "codegraph" => 0,
        "karpathy-guidelines" => 1,
        "ponytail" => 2,
        "assp-skill" => 3,
        "impeccable" => 4,
        "taste-skill" => 5,
        "8sync-cli" => 6,
        "image-routing" => 7,
        "locate-anything" => 8,
        _ => usize::MAX,
    }
}

/// Always-on skills are read on EVERY session before the first tool call.
pub(crate) fn is_always_on(dirname: &str) -> bool {
    always_on_rank(dirname) != usize::MAX
}

/// CORE always-on skills: small + universal, so their SKILL.md body is read
/// upfront EVERY session. The remaining always-on skills are specialists —
/// listed (capability noted) but their body is read lazily, only when a
/// matching task triggers it (progressive disclosure → leaner, KV-cache-stable
/// prefix; Anthropic "skills" + Manus KV-cache lessons).
pub(crate) fn always_on_core(dirname: &str) -> bool {
    matches!(dirname, "codegraph" | "karpathy-guidelines" | "ponytail" | "8sync-cli")
}

/// On-demand skills gated by a project-tech predicate: only surfaced in the
/// force-load block when the tech is actually present (keeps a non-Encore
/// project from listing the Encore deploy runbook). Returns true = hide it.
fn skill_gated_out(dirname: &str, root: &Path) -> bool {
    match dirname {
        "encore-deploy" => !project_uses_encore(root),
        _ => false,
    }
}

/// Detect whether the project uses the Encore.dev framework.
fn project_uses_encore(root: &Path) -> bool {
    if root.join("encore.app").is_file() {
        return true;
    }
    for sub in ["backend", "api", "server"] {
        if root.join(sub).join("encore.app").is_file() {
            return true;
        }
    }
    for f in ["go.mod", "package.json"] {
        if let Ok(s) = std::fs::read_to_string(root.join(f)) {
            if s.contains("encore.dev") || s.contains("encore.app") {
                return true;
            }
        }
    }
    false
}

/// Classified skill dirs + the rendered force-load block. Single source of
/// truth shared by `inject_agents_md` (writes the block) and `harness bench`
/// (measures it) so the benchmark never drifts from what is actually injected.
pub(crate) struct ForceLoadStats {
    pub(crate) block: String,
    pub(crate) core: Vec<PathBuf>,        // CORE always-on — body read upfront every session
    pub(crate) specialist: Vec<PathBuf>,  // SPECIALIST always-on — body read on trigger
    pub(crate) ondemand: Vec<PathBuf>,    // on-demand visible — body read on trigger
}

/// Machine-portable reference to a skill's entry file, exactly as embedded in
/// AGENTS.md. Project-local skills are **repo-relative**
/// (`su-code/skills/<dir>/<entry>`) so the block survives a clone into any path;
/// global skills genuinely live in `$HOME`, so they are `~/`-anchored and stay
/// user-agnostic. Emitting `/home/<user>/…` is a bug: it resolves only on the
/// machine that ran the harness, and every other machine silently skips the
/// skill because the file the agent is told to read does not exist.
fn skill_ref(dirname: &str, entry: &str, is_local: bool) -> String {
    if is_local {
        format!("su-code/skills/{}/{}", dirname, entry)
    } else {
        format!("~/.omp/skills/{}/{}", dirname, entry)
    }
}

/// Gather installed skills (global ∪ project-local, deduped), classify them into
/// CORE / SPECIALIST / on-demand, and render the force-load block. Pure: reads
/// the skill dirs, writes nothing.
pub(crate) fn build_force_load(home: &Path, root: &Path) -> ForceLoadStats {
    let global_dir = home.join(".omp/skills");
    let local_dir = root.join("su-code/skills");

    let globals = list_installed_skill_dirs(&global_dir).unwrap_or_default();
    let locals = list_installed_skill_dirs(&local_dir).unwrap_or_default();

    // Dedupe global vs local (locals mirror globals): list each skill once,
    // preferring the committed local copy under su-code/skills/.
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut chosen: Vec<(PathBuf, bool)> = Vec::new(); // (dir, is_local)
    for p in locals.iter() {
        if let Some(n) = p.file_name().and_then(|s| s.to_str()) {
            if seen.insert(n.to_string()) { chosen.push((p.clone(), true)); }
        }
    }
    for p in globals.iter() {
        if let Some(n) = p.file_name().and_then(|s| s.to_str()) {
            if seen.insert(n.to_string()) { chosen.push((p.clone(), false)); }
        }
    }
    // Always-on lead in canonical force-load order; on-demand (rank usize::MAX)
    // trail, ordered alphabetically by directory name.
    chosen.sort_by(|(a, _), (b, _)| {
        let an = a.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let bn = b.file_name().and_then(|s| s.to_str()).unwrap_or("");
        always_on_rank(an).cmp(&always_on_rank(bn)).then_with(|| an.cmp(bn))
    });

    let mut core: Vec<PathBuf> = Vec::new();
    let mut specialist: Vec<PathBuf> = Vec::new();
    let mut ondemand: Vec<PathBuf> = Vec::new();
    let mut core_lines = String::new();
    let mut specialist_lines = String::new();
    let mut ondemand_lines = String::new();
    let mut seen_names: BTreeSet<String> = BTreeSet::new();
    for (p, is_local) in chosen.iter() {
        let dirname = p.file_name().and_then(|s| s.to_str()).unwrap_or("?");
        let (m, entry) = meta_for_dir(p);
        if is_always_on(dirname) {
            // Collapse cross-dir duplicates (e.g. a stale `karpathy` dir beside
            // the canonical `karpathy-guidelines` — same frontmatter name): list
            // each logical skill once, keeping the higher-ranked dir (sorted first).
            if !seen_names.insert(m.name.clone()) {
                continue;
            }
            let rel = skill_ref(dirname, entry, *is_local);
            if always_on_core(dirname) {
                core.push(p.clone());
                core_lines.push_str(&format!("  {}. `{}`\n", core.len(), rel));
            } else {
                specialist.push(p.clone());
                specialist_lines.push_str(&format!("- `{}` — `{}`\n", m.name, rel));
            }
        } else {
            // Tech-gated on-demand skill in a project that doesn't use that tech → hide.
            if skill_gated_out(dirname, root) {
                continue;
            }
            if !seen_names.insert(m.name.clone()) {
                continue;
            }
            let rel = skill_ref(dirname, entry, *is_local);
            ondemand.push(p.clone());
            ondemand_lines.push_str(&format!("- `{}` — `{}`\n", m.name, rel));
        }
    }
    if core.is_empty() {
        core_lines.push_str("  _(no core skills — run `8sync harness init`)_\n");
    }
    if specialist.is_empty() {
        specialist_lines.push_str("- _(none)_\n");
    }
    if ondemand.is_empty() {
        ondemand_lines.push_str("- _(none — add via `8sync skill add <github-url>`)_\n");
    }

    let has_codegraph_bin = which::which("codegraph").is_ok();
    let codegraph_install_hint: &str = if has_codegraph_bin {
        ""
    } else {
        "> ⚠ `codegraph` binary chưa cài. Chạy `8sync harness init` (auto cài) HOẶC `npx -y @colbymchenry/codegraph install` rồi quay lại đọc tiếp.\n\n"
    };

    let mcp_lines = mcp_lines(
        crate::verbs::harness::cbm::enabled(home),
        crate::verbs::harness::serena::enabled(home),
    );

    let block = format!(
        "{BEGIN}\n\
## 🚨 STEP 0 — CODE INTELLIGENCE FIRST (codegraph CLI trước)\n\
\n\
Mọi câu hỏi về code → dùng code-intelligence engine TRƯỚC grep/read (tiết kiệm ~99% token). Bạn (AI) **PHẢI**:\n\
\n\
1. **codegraph** (local index): `codegraph index .` 1 lần/session; rồi `codegraph query/explore/node/callers/callees/impact` thay cho `grep`/`rg`/`fd`/`Grep`/`Glob` và `Read` toàn file.\n\
{mcp_lines}\
3. **Nén những gì BẠN phát lại:** báo cáo / subagent prompt / nội dung dài sắp re-emit → `mcp__headroom_compress` (60–95% ít token). omp tự spill output quá dài ra artifact — KHÔNG paste lại blob đã spill vào context.\n\
\n\
Lý do: 5 query cấu trúc ≈ 3.4k token vs ≈ 412k token grep từng file (−99%). Dump cả file / grep mù = đốt token = bug.\n\
\n\
{codegraph_install_hint}\
## 🚨 STEP 1 — skills 2 tầng: CORE (đọc ngay) · SPECIALIST + on-demand (đọc khi cần)\n\
\n\
Mỗi skill = 1 directory (Agent Skills open standard): `SKILL.md` có frontmatter `name`+`description`. Skill vendored ở `su-code/skills/<name>/` (bản commit trong repo, mirror từ `~/.omp/skills/`). Mỗi skill liệt kê 1 lần.\n\
\n\
### ⛔ CORE always-on — ĐỌC NGAY (body), trước tool call đầu tiên (không skip)\n\
\n\
Nhỏ + dùng cho MỌI task. **Thứ tự = ưu tiên (đọc top-down).** Mở `SKILL.md` ở path dưới rồi mới gọi tool đầu tiên:\n\
\n\
{core_lines}\n\
### 🧩 SPECIALIST always-on — biết khả năng, đọc body KHI task khớp (progressive disclosure)\n\
\n\
KHÔNG đọc body mỗi phiên (giữ prefix gọn, tiết kiệm KV-cache). Khi task khớp → mở `SKILL.md` tương ứng NGAY. **`impeccable` = design system CHUẨN, BẮT BUỘC mở body ngay khi có việc UI/design/redesign/audit** (kèm `references/house/*`); `assp` cho copy/offer; `taste` chống slop; `image-routing` khi xử lý ảnh/diff/PDF. **GLM-5.3 / GLM-5.3-Flash = native VLM** (https://docs.z.ai/guides/vlm/glm-5.3-flash): nhìn ảnh trực tiếp trong session — **CẤM** `mcp__zai_vision_*` / `@z_ai/mcp-server`. zai-vision chỉ cho GLM-5.2 text-only.\n\
\n\
{specialist_lines}\n\
### 🔎 On-demand — tên = trigger; mở `SKILL.md` của skill khi task khớp (mô tả ở frontmatter, KHÔNG nhồi ở đây)\n\
\n\
{ondemand_lines}\n\
### Quy tắc bất biến\n\
\n\
- **Code-intelligence FIRST** (codegraph CLI trước) cho mọi câu hỏi explore code (Step 0). Bypass = bug.\n\
- **Output > ~50 dòng → BẮT BUỘC `headroom_compress`** trước khi vào context — không dump thô.\n\
- Đọc body **CORE** (codegraph → karpathy → ponytail → 8sync-cli) TRƯỚC tool call đầu tiên. **SPECIALIST** (assp · impeccable · taste · image-routing) đọc body KHI task khớp — `impeccable` bắt buộc ngay khi có việc UI/design.\n\
- Skill **on-demand**: chỉ mở khi description khớp task hiện tại — đừng đọc thừa.\n\
- Nếu skill có `scripts/` → ưu tiên invoke script đó thay vì viết lại logic.\n\
- Khi áp dụng skill, **cite** rõ: ví dụ `su-code/skills/<name>/SKILL.md:line`.\n\
- **Sau mỗi thay đổi:** cập nhật `CHANGELOG.md` (mục Unreleased) + ghi học được vào `su-code/KNOWLEDGE.md`.\n\
- **Doc-hygiene**: chạy `8sync harness audit` khi đụng vùng có docs — path lệch→fix, doc rác/superseded→xóa (thêm doc phải kèm xóa cái cũ), oversized→trim.\n\
- **Loop / STATE spine**: đọc `su-code/STATE.md` đầu phiên; rewrite ở mỗi phase-boundary (Goal·Checklist·Current·Next). Context gần đầy → handoff vào STATE + bài học vào KNOWLEDGE rồi reinit. Đo loop: `8sync harness bench`.\n\
- **Loop discipline (C/D/E)**: implementer↔verifier qua `task` (verifier chạy build/test ĐỘC LẬP, verify-gate TRƯỚC commit); FAIL → ghi `failure:` vào KNOWLEDGE, đọc đầu phiên để khỏi lặp; quy trình `validated:` → distill vào `su-code/PLAYBOOKS.md` (index theo `When:`); autonomy L1 report · L2 assisted · L3 unattended — không tự `push`/PR ở L3 mặc định.\n\
{END}"
    );

    let block = crate::brand::render(&block).into_owned();
    ForceLoadStats { block, core, specialist, ondemand }
}

/// STEP-0 item 2: codegraph CLI first; cbm / serena lines appear only when enabled.
fn mcp_lines(cbm: bool, serena: bool) -> String {
    let mut l = String::from("2. Tìm/hiểu/định vị code · impact · route→handler · dead code · architecture → codegraph CLI trước. Chỉ `Read` raw file khi sắp SỬA nó (read-before-edit).\n");
    if cbm {
        l.push_str("   - codebase-memory-mcp (đã bật): `mcp__codebase_memory_mcp_search_graph` · `_trace_path` · `_get_architecture` · `_get_code_snippet`.\n");
    }
    if serena {
        l.push_str("   - serena (đã bật): `mcp__serena_find_symbol` · `_find_referencing_symbols` · `_get_symbols_overview`.\n");
    }
    l
}

/// CLAUDE.md's block: a compact pointer (~1 KB). Claude Code loads CLAUDE.md
/// into every request and already lists skills with descriptions, so the block
/// does NOT force-read SKILL.md bodies and does NOT claim MCP tools exist.
/// The full CORE/SPECIALIST block stays in AGENTS.md (omp/Cursor harnesses).
fn claude_block(home: &Path) -> String {
    claude_block_with(
        crate::verbs::harness::cbm::enabled(home),
        crate::verbs::harness::serena::enabled(home),
    )
}

fn claude_block_with(cbm: bool, serena: bool) -> String {
    let mcp = match (cbm, serena) {
        (false, false) => "",
        (true, false) => "; codebase-memory-mcp đã bật",
        (false, true) => "; serena đã bật",
        (true, true) => "; codebase-memory-mcp + serena đã bật",
    };
    let block = format!(
        "{BEGIN}\n\
## 8sync harness — Claude Code\n\
\n\
- **Repo:** quy ước, lệnh build/test, kiến trúc nằm trong `AGENTS.md` — xem mục lục (`grep -n '^#' AGENTS.md`), đọc đúng mục cần.\n\
- **Code intelligence:** `codegraph query|explore` qua Bash (nhanh, local){mcp}. Chỉ đọc raw file khi sắp sửa.\n\
- **Skills nạp theo nhu cầu:** Claude Code đã liệt kê skill kèm mô tả; chỉ mở khi task khớp (UI/design → `impeccable`). Không đọc SKILL.md trước.\n\
- **Lệnh:** ưu tiên `8sync` (`8sync run test`, `8sync find` …) hơn shell thô.\n\
- **Memory:** `su-code/STATE.md` đầu phiên; bài học → `su-code/KNOWLEDGE.md`; thay đổi → `CHANGELOG.md`.\n\
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
/// a block in a normal dir becomes the current compact block, a block in a su-code
/// MEMORY dir is removed (a bare 8sync stub is deleted with it; the original is
/// kept as `CLAUDE.md.bak-8sync`). Files without markers are never written.
/// Returns the files changed.
pub(crate) fn refresh_ancestor_blocks(home: &Path, start: &Path) -> Result<Vec<PathBuf>> {
    let mut changed = Vec::new();
    if !start.starts_with(home) {
        return Ok(changed);
    }
    let block = claude_block(home);
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

/// Skills the Claude Code kit installs into `~/.claude/skills`: their
/// descriptions stay listed whatever tier the project gives them.
const KIT_SKILLS: [&str; 3] = ["ship", "aup-audit", "deep-research"];

/// `.claude/settings.local.json` → `skillOverrides`: on-demand skills are listed
/// by name only, the same progressive disclosure as `AGENTS.md` (always-on
/// skills keep their descriptions). Listing every description of 237 skills
/// measured +18.4k tokens on every request. Adds missing entries only, so a
/// value set in Claude Code's `/skills` menu wins.
pub(crate) fn claude_skill_overrides(home: &Path, root: &Path) -> Result<()> {
    use anyhow::Context;
    let stats = build_force_load(home, root);
    let path = root.join(".claude/settings.local.json");
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut v: serde_json::Value = if raw.trim().is_empty() {
        serde_json::json!({})
    } else {
        serde_json::from_str(&raw).with_context(|| format!("{} is not valid JSON", path.display()))?
    };
    let overrides = v
        .as_object_mut()
        .context("settings.local.json is not a JSON object")?
        .entry("skillOverrides")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .context("`skillOverrides` is not an object")?;
    for name in stats.ondemand.iter().filter_map(|p| p.file_name()?.to_str()) {
        if !KIT_SKILLS.contains(&name) {
            overrides.entry(name).or_insert_with(|| serde_json::json!("name-only"));
        }
    }
    let out = serde_json::to_string_pretty(&v)? + "\n";
    if out != raw {
        std::fs::create_dir_all(root.join(".claude"))?;
        std::fs::write(&path, out).with_context(|| format!("write {}", path.display()))?;
    }
    Ok(())
}

/// Rewrite (or insert) the force-load block in **every** agent entry file at the
/// project root: AGENTS.md, CLAUDE.md, GEMINI.md, OPENCODE.md,
/// .github/copilot-instructions.md, .cursorrules, .windsurfrules.
pub(crate) fn inject_agents_md(home: &Path, root: &Path) -> Result<()> {
    if is_memory_dir(root) {
        ui::info(&format!("skip force-load: {} is a su-code memory dir, not a repo root", root.display()));
        return Ok(());
    }
    let stats = build_force_load(home, root);
    let always_count = stats.core.len() + stats.specialist.len();
    let on_count = stats.ondemand.len();
    let claude_block = claude_block(home);
    let ancestor_dup = ancestor_claude_has_block(home, root);
    let block = stats.block;

    // Inject into every known agent entry file (markdown: sentinel rewrite or
    // skeleton; plain text: prepend). AGENTS.md + CLAUDE.md are stub-created;
    // the rest are touched only if they already exist. CLAUDE.md gets the
    // compact block (see `claude_block`).
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
        let block = if *name == "CLAUDE.md" { &claude_block } else { &block };
        let new_contents = match kind {
            EntryKind::Markdown { h1 } => rewrite_md_with_block(&existing, block, h1),
            EntryKind::Plain => rewrite_plain_with_block(&existing, block),
        };
        if new_contents != existing {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(&path, &new_contents)?;
            ui::ok(&format!("injected force-load → {}", path.display()));
            written += 1;
        }
    }

    ui::info(&format!(
        "force-load: {} always-on, {} on-demand skill(s), written into {} file(s)",
        always_count, on_count, written,
    ));
    Ok(())
}

/// Cursor-native always-on rule. Cursor discovers project skills from
/// `.cursor/skills/` (not `su-code/skills/`); this `.mdc` is the equivalent of
/// the AGENTS.md force-load block so a Cursor session loads the same CORE
/// contract without reading omp's `~/.omp` tree.
pub(crate) fn inject_cursor_rule(home: &Path, root: &Path) -> Result<()> {
    let stats = build_force_load(home, root);
    let path = root.join(".cursor/rules/8sync-harness.mdc");
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let body = format!(
        "---\n\
         description: 8sync harness force-load (CORE skills, code-intel first). Always applied.\n\
         alwaysApply: true\n\
         ---\n\n\
         {}\n\n\
         Project skills live in `.cursor/skills/<name>/SKILL.md` (Cursor Agent Skills standard; \
         mirrored from `su-code/skills/` by `8sync harness create`).\n",
        stats.block.trim()
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

    /// Minimal Agent-Skills dir: `<parent>/<name>/SKILL.md` with frontmatter, so
    /// `meta_for_dir` resolves the name and the `SKILL.md` entry point.
    fn skill_fixture(parent: &Path, name: &str) {
        let dir = parent.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: fixture\n---\n\nbody\n"),
        )
        .unwrap();
    }

    /// Every skill path in the force-load block MUST be machine-portable:
    /// repo-relative for a project skill, `~/`-anchored for a global one. An
    /// absolute path is the dead-path bug — it resolves only on the box that ran
    /// the harness, so agents on every other machine (or clone) are told to read
    /// a file that is not there and silently skip the skill.
    #[test]
    fn force_load_paths_are_portable() {
        let base = std::env::temp_dir().join(format!("8sync-force-load-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let home = base.join("home");
        let root = base.join("repo");
        // codegraph + ponytail are CORE (rank 0 / 2); impeccable is SPECIALIST.
        skill_fixture(&root.join("su-code/skills"), "codegraph");
        skill_fixture(&home.join(".omp/skills"), "ponytail");
        skill_fixture(&home.join(".omp/skills"), "impeccable");

        let stats = build_force_load(&home, &root);

        assert!(
            stats.block.contains("  1. `su-code/skills/codegraph/SKILL.md`"),
            "CORE project skill must render repo-relative"
        );
        assert!(
            stats.block.contains("  2. `~/.omp/skills/ponytail/SKILL.md`"),
            "CORE global skill must render ~/-anchored"
        );
        assert!(
            stats.block.contains("`impeccable` — `~/.omp/skills/impeccable/SKILL.md`"),
            "SPECIALIST global skill must render ~/-anchored"
        );
        assert!(!stats.block.contains("/home/"), "no machine-specific path may leak");
        assert!(
            !stats.block.contains(&root.display().to_string()),
            "the absolute project root must never appear in the block"
        );

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn cursor_rule_is_always_apply_mdc() {
        let base = std::env::temp_dir().join(format!("8sync-cursor-rule-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let home = base.join("home");
        let root = base.join("repo");
        skill_fixture(&root.join("su-code/skills"), "codegraph");
        inject_cursor_rule(&home, &root).unwrap();
        let body = std::fs::read_to_string(root.join(".cursor/rules/8sync-harness.mdc")).unwrap();
        assert!(body.contains("alwaysApply: true"), "Cursor standard: alwaysApply mdc");
        assert!(body.contains(".cursor/skills/"), "points at Cursor skill dir");
        assert!(body.contains("su-code/skills/codegraph/SKILL.md"));
        assert!(
            body.contains("GLM-5.3") && body.contains("CẤM") && body.contains("mcp__zai_vision_*"),
            "Cursor alwaysApply rule must tell GLM-5.3 to look at images, not zai-vision"
        );
        let _ = std::fs::remove_dir_all(&base);
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
    fn compact_block_replaces_old_full_block_and_is_small() {
        let blk = claude_block_with(false, false);
        assert!(blk.len() <= 1100, "block is {} B", blk.len());
        assert!(!blk.contains("ĐỌC NGAY") && !blk.contains("LUÔN có"));
        let old = format!("# T\n\nmine-before\n\n{BEGIN}\n## OLD full block\n{END}\n\nmine-after\n");
        let out = rewrite_md_with_block(&old, &blk, "T");
        assert!(!out.contains("OLD full block"));
        assert!(out.contains("mine-before") && out.contains("mine-after"));
        assert_eq!(out.matches(BEGIN).count(), 1);
    }

    #[test]
    fn code_intel_text_omits_cbm_serena_when_off() {
        let off = format!("{}{}", claude_block_with(false, false), mcp_lines(false, false));
        for w in ["codebase-memory", "codebase_memory", "serena"] {
            assert!(!off.contains(w), "`{w}` leaked while off");
        }
        assert!(off.contains("codegraph"));
        let on = format!("{}{}", claude_block_with(true, true), mcp_lines(true, true));
        assert!(on.contains("codebase-memory") && on.contains("serena"));
    }

    const FULL: &str = "## OLD full block\nĐỌC NGAY codebase-memory-mcp LUÔN có\n";

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

    #[test]
    fn ancestor_block_mentions_cbm_serena_only_when_on() {
        let off = claude_block_with(false, false);
        assert!(!off.contains("codebase-memory") && !off.contains("serena"));
        assert!(claude_block_with(true, false).contains("codebase-memory") && !claude_block_with(true, false).contains("serena"));
        assert!(claude_block_with(false, true).contains("serena") && !claude_block_with(false, true).contains("codebase-memory"));
    }
}
