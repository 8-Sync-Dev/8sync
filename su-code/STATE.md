# STATE — su-code

## Goal
Owner 2026-11-04: (1) sidebar HQ không tự nhảy, chỉ kéo thả mới đổi chỗ; (2) Chat phòng/inbox gửi được ảnh như terminal, chung một component; (3) "/" gợi ý cả giữa câu; (4) clip trong Nội dung xem và tải được; (5) terminal lag khi đang làm (subagent TermLag, branch `perf/term-lag`).

## Checklist
- [x] v0.122.5 (#285) cookie `session-secret`; v0.122.6 (#287/#288) mã thoát omp
- [x] #289: sidebar sort "Tự sắp (kéo thả)" mặc định, `hq.tree.order`; `attach.tsx` dùng chung; `slashAt` giữa câu; Media luôn hiện + nút Tải. Dev HQ :8791 kiểm thật: kéo phiên/dự án, 30 s không nhảy, `/rev` giữa câu, thumbnail, tải file 38 861 B
- [ ] v0.122.7 release + `8sync up`
- [ ] Clip #3 (bài 35, Reels 17s) chưa có file render: chỉ có video bài học đầy đủ `content-ai/output/courses/8547-c/videos/35-toan-tu-bitwise-trong-c.mp4` (102 MB). Pipeline content-post-agency cần ghi `media_path` khi render
- [ ] TermLag: lag terminal giữa lượt (native omp đúng, lỗi ở pipeline HQ) — chờ PR
- [ ] #283 HQ Artifacts chờ #278
- [ ] "omp exited non-zero": chờ owner cho biết lệnh/thư mục

## Current
Release v0.122.7 (#289). TermLag đang đo.

## Next
- VPS `vps.8syncdev.com` không vào được (ssh :22 timeout) → link cố định `/hq` không kiểm được.
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
- Link không cần đăng nhập lại khi tunnel restart cần host cố định (VPS hoặc Cloudflare named tunnel); quick tunnel đổi host.
