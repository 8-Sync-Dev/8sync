# CLAUDE.md — guidance for Claude Code

<!-- 8sync:skills:begin -->
## 8sync harness — Claude Code (bản gọn; bản đầy đủ cho omp/Cursor nằm trong `AGENTS.md`)

- **Quy ước repo, lệnh build/test, kiến trúc:** `AGENTS.md` — xem mục lục (`grep -n '^#' AGENTS.md`) rồi đọc đúng mục cần trước khi sửa code.
- **Code intelligence trước grep:** MCP `codebase-memory-mcp` (search_graph · trace_path · get_code_snippet), `serena` (find_symbol · find_referencing_symbols), hoặc `codegraph query|explore` qua Bash. Chỉ đọc raw file khi sắp sửa nó.
- **Luôn áp dụng** (`codegraph` · `karpathy-guidelines` · `ponytail` · `8sync-cli`): đọc trước khi viết, bước nhỏ có kiểm chứng, làm ít nhất mà đúng (YAGNI, xoá > thêm), ưu tiên lệnh `8sync` (`8sync run test`, `8sync find` …) hơn shell thô. Chi tiết: `su-code/skills/<tên>/SKILL.md` (hoặc `~/.omp/skills/<tên>/`), chỉ mở khi cần.
- **Mở SKILL.md khi task khớp:** `assp-skill` · `impeccable` · `taste-skill` · `image-routing` · `locate-anything` — `impeccable` bắt buộc cho mọi việc UI/design.
- **226 skill on-demand khác:** `ls su-code/skills ~/.omp/skills`, mở `SKILL.md` khi tên/description khớp task.
- **Memory dự án:** đọc `su-code/STATE.md` đầu phiên, cập nhật ở mỗi mốc; bài học → `su-code/KNOWLEDGE.md`; thay đổi → `CHANGELOG.md` (Unreleased).
<!-- 8sync:skills:end -->
