# CLAUDE.md — guidance for Claude Code

<!-- 8sync:skills:begin -->
## 8sync harness

**STEP 0 — code map trước (graphify + trail):** mọi tìm kiếm code đi qua code map, không grep/đọc cả file (local, không gọi model, ~100–200 token mỗi lần).
- Ai gọi X · X gọi gì · impact · đường A→B → env `GRAPHIFY_MAX_WORKERS=4` + `graphify update . --no-cluster` (đầu phiên + sau khi sửa), rồi `graphify explain <symbol|id>` / `graphify path "A()" "B()"` (bỏ `query`).
- X ở đâu · tìm chữ kèm ngữ cảnh symbol · khung file → `trail ask "<câu hỏi>"` · `trail grep <pattern>` · `trail skeleton <file>` (`trail callers <symbol>` khi chưa có graphify).
- Chỉ đọc raw file khi sắp sửa nó. Map cũ → `trail build`; repo chưa nối → `8sync trail`.

**Quy tắc bất biến:**
- Sau mỗi thay đổi: cập nhật `CHANGELOG.md` (mục `[Unreleased]`) + ghi bài học vào `su-code/KNOWLEDGE.md`.
- Đọc `su-code/STATE.md` đầu phiên; rewrite nó ở mỗi phase-boundary (Goal · Checklist · Current · Next).

**Skills / agents / commands:** plugin ECC `ecc@ecc` (global) + rule của repo trong `.claude/rules/ecc/`.
<!-- 8sync:skills:end -->
