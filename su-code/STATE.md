# STATE — su-code

## Goal
HQ terminal qua link public (Cloudflare quick tunnel) trống dưới chấm xanh "Đang nối", lúc hiện lúc không (owner 2026-11-04). Sửa, ship v0.122.2, `8sync up`, kiểm trên bề mặt thật.

## Checklist
- [x] v0.122.0 (#279) + v0.122.1 (#280) Nội dung: lịch, khung chi tiết, tick AI ở mọi lần duyệt/đăng; release.yml v0.122.1 xanh
- [x] content-post-agency #95, #96 (ad-frames MKT short không nhãn AI) đã merge
- [x] Đo quick tunnel: nhả stream theo lô ~130 KB, không flush theo giờ (bảng trong KNOWLEDGE 2026-11-04)
- [x] Nguyên nhân: replay phòng (≤ 256 KB, một event) → lô đầu có ping + một phần replay trong 4 s → trang ở lại stream, trống
- [x] Sửa (branch `fix/hq-term-held-stream`): HQ ping 2 s kèm giờ (`PING_MS`), ngoài loopback poll khi im `STALE_MS` 6 s hoặc ping trễ > `HELD_MS` 3 s (`heldBack`, `pingTime` trong `lib/term-stream.ts`); test term-stream 11/11; vitest 782/785 (3 lỗi máy đã biết, giống main); tsc, eslint
- [x] Tái hiện bằng proxy gom lô `127.0.0.2:8790` + `next start` sandbox: main trống 36 s dưới chấm xanh; bản sửa hiện dòng cuối + prompt ở 6,1 s
- [ ] PR → reviewer → merge → tag v0.122.2 → release.yml → `8sync up` → `/api/version` ui 0.122.2
- [ ] Owner lấy link public mới: `8sync hq ui --relink` trên PC (HQ public cũ chết do lần thử `hq ui --public` thứ hai, xem KNOWLEDGE)

## Current
Ship v0.122.2 từ worktree `tu-session-marketing-phong-core`, branch `fix/hq-term-held-stream`.

## Next
- VPS `vps.8syncdev.com` không vào được (ssh :22 và https timeout) → link cố định `/hq` chết; tiến trình `ssh -R /run/8sync-hq/hq.sock` trên PC còn nhưng vô dụng.
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
