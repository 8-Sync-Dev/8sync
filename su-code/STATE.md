# STATE — su-code

## Goal
Owner 2026-11-04: (1) sidebar HQ không tự nhảy, chỉ kéo thả mới đổi chỗ; (2) Chat phòng/inbox gửi được ảnh như terminal, chung một component; (3) "/" gợi ý cả giữa câu; (4) clip trong Nội dung xem và tải được; (5) terminal lag khi đang làm (subagent TermLag, branch `perf/term-lag`).

## Checklist
- [x] v0.122.5 (#285) cookie `session-secret`; v0.122.6 (#287/#288) mã thoát omp
- [x] #289: sidebar sort "Tự sắp (kéo thả)" mặc định, `hq.tree.order`; `attach.tsx` dùng chung; `slashAt` giữa câu; Media luôn hiện + nút Tải. Dev HQ :8791 kiểm thật: kéo phiên/dự án, 30 s không nhảy, `/rev` giữa câu, thumbnail, tải file 38 861 B
- [x] v0.122.7 (#290) đã release
- [x] #291 Nhật ký: reply/prompt đầy đủ + markdown, kẹp 8 dòng + "Xem hết"
- [ ] v0.122.8 release + `8sync up`
- [ ] Clip #3 (bài 35, Reels 17s) chưa có file render: chỉ có video bài học đầy đủ `content-ai/output/courses/8547-c/videos/35-toan-tu-bitwise-trong-c.mp4` (102 MB). Pipeline content-post-agency cần ghi `media_path` khi render
- [ ] TermLag: lag terminal giữa lượt (native omp đúng, lỗi ở pipeline HQ) — chờ PR
- [ ] #283 HQ Artifacts chờ #278
- [ ] "omp exited non-zero": chờ owner cho biết lệnh/thư mục

## Goal: đa kênh cho tab Nội dung (phiên tu-session-marketing-phong-core)
Owner 2026-11-04: một bài lên lịch NATIVE ra FB Page + LinkedIn (profile Tú) + Threads @8syncdev + YouTube (8 Sync Dev) qua ego-browser profile "8sync FB" (task space id 2 "8sync content channels", tab p1 FB · p2 LinkedIn · p3 YouTube Studio · p4 Threads), ghi permalink + published_at về item; gate không nhãn AI giữ cho mọi kênh. Acceptance: UAT click thật trên HQ :8740 + 1 bài test lên lịch trên 3 kênh text rồi xoá lịch.
- [x] content-post-agency `feat/content-channels` (worktree `C:/Users/Projects/cpa-channels`): 0064 (`channels`, `captions_json`, bảng `content_channel_posts`), `src/services/channels/*`, `pnpm channels:tick`; driver Threads kiểm live
- [x] HQ `feat/hq-content-channels` (v0.123.0): chip kênh, caption theo kênh, trạng thái từng kênh, Thử lại, luật duyệt 409; kiểm trên dev HQ :8771 với bản sao DB
- [ ] Driver Facebook / LinkedIn / YouTube kiểm live
- [ ] Áp 0064 vào DB thật (backup trước), runner chạy định kỳ (Scheduled Task) từ checkout sạch
- [ ] PR + reviewer + merge + release HQ + `8sync up`
- [ ] UAT: bài test lên lịch FB/LinkedIn/Threads qua HQ → kiểm trên nền tảng → bỏ duyệt → lịch bị huỷ → xoá item test

## Current
Release v0.122.7 (#289). TermLag đang đo. Đa kênh: chờ 3 driver rồi gom PR.

## Next
- Đa kênh: tự động hoá trình duyệt trên LinkedIn/Threads trái điều khoản nền tảng (có thể bị hạn chế tài khoản), báo owner.
- VPS `vps.8syncdev.com` không vào được (ssh :22 timeout) → link cố định `/hq` không kiểm được.
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
- Link không cần đăng nhập lại khi tunnel restart cần host cố định (VPS hoặc Cloudflare named tunnel); quick tunnel đổi host.
