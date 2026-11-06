# STATE — su-code

## Goal
Owner 2026-11-06: HQ v0.127.0 — phòng kiểu IDE ("Thư mục" là pane cạnh phòng, kéo rộng được; "Báo cáo" có nút Mở lớn; ô chat không kéo dài), sidebar hiện branch/worktree như Orca, "Chọn thư mục" có "Thư mục mới…", tab Nội dung theo nền tảng (mục tiêu 10 bài/nền tảng/ngày, chip "Đã lên lịch x/y kênh", kênh TikTok/X/Instagram/Zalo chờ migration 0065 của content-post-agency).

## Checklist
- [x] v0.126.0 `--tailnet` + `--at-login` đã release (PR #328)
- [x] v0.127.0: vitest + eslint + tsc + smoke trình duyệt trên dev :8791 (pane Thư mục, Mở lớn, branch sidebar, tạo thư mục 409/201)
- [x] v0.127.0 đã release (PR #329)
- [x] v0.127.1 đã release (PR #330), `8sync up` xong; :8740 trả UI 0.127.1, `/api/projects/branches` 9 repo (có 8sync-startup)
- [x] 0065 đã áp vào `daily-dev.db` (content-post-agency, nhánh `wip/content-channels-snapshot` 2f3dc342, backup `daily-dev.db.bak-pre0065-1793925502904`); HQ :8740 kiểm: `channels0065: true`, 52 dòng kênh đều `scheduled`, #77–80 đủ 6 kênh (thêm TikTok/X)
- [ ] Owner: #77–80 đã lên lịch trên 6 nền tảng khi còn `checked` → Duyệt, hoặc huỷ lịch trên từng nền tảng
- [ ] Owner: ĐỪNG chạy `pnpm channels:tick` trên `daily-dev.db`: tick coi món không approved là "bỏ duyệt" → huỷ lịch thật. Vá 04239d99 chỉ bỏ qua kênh KHÔNG có driver (tiktok/x); FB/LinkedIn/Threads/YouTube có driver nên vẫn bị huỷ: tới 44 dòng (32 + 4 + 4 + 4) khi các món còn `checked`
- [ ] Owner: mua domain Cloudflare → `8sync hq ui --tunnel-setup hq.<domain>` → restart `--public`

## Goal: đa kênh cho tab Nội dung (phiên tu-session-marketing-phong-core)
Owner 2026-11-04: một bài lên lịch NATIVE ra FB Page + LinkedIn (profile Tú) + Threads @8syncdev + YouTube (8 Sync Dev) qua ego-browser profile "8sync FB" (task space id 2 "8sync content channels", tab p1 FB · p2 LinkedIn · p3 YouTube Studio · p4 Threads), ghi permalink + published_at về item; gate không nhãn AI giữ cho mọi kênh. Acceptance: UAT click thật trên HQ :8740 + 1 bài test lên lịch trên 3 kênh text rồi xoá lịch.
- [x] content-post-agency `feat/content-channels` (worktree `C:/Users/Projects/cpa-channels`): 0064 (`channels`, `captions_json`, bảng `content_channel_posts`), `src/services/channels/*`, `pnpm channels:tick`; driver Threads kiểm live
- [x] HQ `feat/hq-content-channels` (v0.123.0): chip kênh, caption theo kênh, trạng thái từng kênh, Thử lại, luật duyệt 409; kiểm trên dev HQ :8771 với bản sao DB
- [ ] Driver Facebook / LinkedIn / YouTube kiểm live
- [x] Áp 0064 vào DB thật (backup trước)
- [ ] BLOCKED: runner `channels:tick` chạy định kỳ (Scheduled Task) — chỉ bật sau khi tick tách "lịch tay chờ duyệt" khỏi "bỏ duyệt", hoặc sau khi mọi món đã lên lịch (#77–80…) được Duyệt
- [x] PR #297 gộp vào release v0.123.0 (review bảo mật: `send` chỉ chủ, `assign` ẩn với khách)
- [ ] UAT: bài test lên lịch FB/LinkedIn/Threads qua HQ → kiểm trên nền tảng → bỏ duyệt → lịch bị huỷ → xoá item test

## Current
Không có worktree nào đang làm dở. Tab Nội dung đa kênh đã live đủ 8 kênh.

## Next
- Đa kênh: đưa 0064 + 0065 của content-post-agency (`wip/content-channels-snapshot`) thành PR vào `win-dev`; thiết kế phân biệt "lịch tay chờ duyệt" với "bỏ duyệt" trong `channels:tick`.
- content-post-agency: `course_chat_messages` rowid 1, 2 mồ côi (thiếu `course_chat_sessions`), có từ trước 0065, chưa xử lý.
- Đa kênh: tự động hoá trình duyệt trên LinkedIn/Threads trái điều khoản nền tảng (có thể bị hạn chế tài khoản), báo owner.
- `--mode codex-cli`: engine kế tiếp (hiện báo "chưa hỗ trợ").
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
- Link không cần đăng nhập lại khi tunnel restart cần host cố định (Cloudflare named tunnel); quick tunnel đổi host. VPS cũ đã huỷ.
