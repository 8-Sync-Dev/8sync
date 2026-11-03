# STATE — su-code

## Goal
HQ tab "Nội dung": đọc/ghi `content_items` của content-post-agency (bài FB ↔ tin news) + kiểm bug inbox phòng `core` (v0.121.0).

## Checklist
- [x] `lib/content.ts` (luật thuần) · `lib/server/content.ts` (node:sqlite, busy_timeout, 1811 → 409) · `app/api/content` (GET/POST/PATCH/DELETE qua `open(req)`)
- [x] `content-view.tsx` + tab ẩn khi chưa cấu hình (`moreTabs`, probe `?probe=1`)
- [x] vitest `content.test.ts` (chưa cấu hình, file thiếu không bị tạo, thiếu bảng, cổng 409, đổi nguồn mất duyệt), `tabs`, `child-env`
- [x] UAT sandbox (bản sao DB): tạo mục, duyệt khi nguồn chưa duyệt → 409, publish thiếu news_url → 409 đúng câu trigger, điền link rồi publish OK
- [x] Bug inbox: phòng `core` do Orca mở không có `EIGHTSYNC_ROOM_ID` → extension inbox không chạy (ghi KNOWLEDGE)
- [x] Fix kèm: `childEnv` bỏ env Next standalone (`next build` trong phòng HQ lỗi)
- [ ] PR → reviewer → merge → tag v0.121.0 → `8sync up` → UAT trên HQ thật

## Current
Release v0.121.0 từ worktree `tu-session-marketing-phong-core`.

## Next
- Sửa gốc inbox: `8sync-inbox.ts` suy room id từ đường session file + git root khi thiếu env; HQ rút `LIVE_MS` 24 h.
- `8sync up` chỉ refresh kit, KHÔNG deploy bundled skill mới vào `~/.omp/skills` (phải chạy `8sync harness global`) — cân nhắc cho `up` deploy luôn.
- `statusline::tests::chained_timeout_kills_group` flake thời gian trên Windows CI; đỏ lại thì đọc `statusline.rs:869`.
