<!-- 8sync:skills:begin -->
## 🚨 8sync harness — sub-folder index

Bạn đang ở **sub-folder**. Rule + skill force-load đầy đủ KHÔNG lặp ở đây — đọc ROOT trước:

- **Root rules + skill list:** `AGENTS.md` ở REPO ROOT (không phải file này)
- **Master skills (omp đọc đầu tiên):** `~/.omp/skills/00-force-load.md`

**Always-on (đọc trước tool call đầu tiên, ĐÚNG thứ tự):** codegraph → karpathy-guidelines → ponytail → assp-skill → impeccable → taste-skill → 8sync-cli → image-routing → locate-anything.
SKILL.md ở `su-code/skills/<name>/` (repo-relative) hoặc `~/.omp/skills/<name>/`.

**Cách tận dụng (bắt buộc):** `codegraph` cho mọi explore code (query/callers/callees — KHÔNG grep) · `karpathy` + `ponytail` = YAGNI, làm ít nhất, xoá > thêm · `assp` cho copy/offer hướng người dùng · **`impeccable` = design system CHUẨN, BẮT BUỘC cho mọi UI/design/redesign/audit (kèm `references/house/*`)** + `taste` chống slop.

**Quy tắc:** cite `path:line` · ưu tiên verb `8sync` hơn shell · sau mỗi thay đổi cập nhật `CHANGELOG.md` + `su-code/KNOWLEDGE.md`.
<!-- 8sync:skills:end -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
