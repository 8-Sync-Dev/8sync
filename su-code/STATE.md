# STATE — su-code

## Goal
HQ tab "Nội dung" nâng cấp (v0.122.0): lịch Ngày/Tuần/Tháng/Năm kiểu Notion + "Danh sách", khung chi tiết theo ngày (`?day=&item=`), Duyệt 1 chạm qua trigger, sửa caption/giờ tại chỗ, giao việc cho phiên omp lưu vào DB, luật không nhãn AI.

## Checklist
- [x] content-post-agency migration 0063 (`scheduled_at`, `assignee_session`, `assigned_at`, `assignee_base`), PR 8syncdev/content-post-agency#95, đã chạy trên DB thật (backup `%TEMP%\daily-dev.pre-0063.db`)
- [x] Server: PATCH nhận giờ + phiên, route `GET /api/content/media`, cổng AI (`no_ai_confirmed`)
- [x] UI: `content-calendar.tsx`, `content-sheet.tsx`, `content-bits.tsx`, `content-view.tsx`
- [x] vitest content (0063, AI gate, media route, lịch), tsc, eslint, `next build`
- [x] UAT sandbox (bản sao DB): mở link ngày, chip → khung, Duyệt có tick AI, trigger chặn hiện đúng câu, sửa caption/giờ, giao việc + reload giữ phiên, mobile 390 px
- [x] PR #279 → reviewer → merge → tag v0.122.0 → `8sync up`
- [ ] v0.122.1 (branch `fix/hq-content-gate`): tick AI chỉ khi vào approved / vào published không từ approved; approved đổi sang nội dung AI → về checked; `stepHint` tắt nút trigger sẽ chặn. vitest 22/22 content, tsc, eslint, next build, UAT sandbox xong → PR → merge → tag → `8sync up`
- [ ] UAT HQ :8740 + link public trên DB thật

## Current
Ship v0.122.1 từ worktree `tu-session-marketing-phong-core`, branch `fix/hq-content-gate`.

## Next
- content-post-agency#95 đã merge; PR #96 ad-frames "MKT short không nhãn AI" (subagent AdFramesMktShort, repo content-post-agency).
- `aiLabel` của job ad-frames chưa nối vào `content_items`: nếu cần, lưu cờ lên mục để HQ chặn luôn.
- Sửa gốc inbox phòng do Orca mở (xem KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
