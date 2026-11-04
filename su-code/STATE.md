# STATE — su-code

## Goal
HQ terminal qua link public (Cloudflare quick tunnel) trống dưới chấm xanh "Đang nối", lúc hiện lúc không (owner 2026-11-04). Sửa, ship v0.122.3, `8sync up`, kiểm trên bề mặt thật.

## Checklist
- [x] v0.122.0 (#279), v0.122.1 (#280) Nội dung; v0.122.2 (#281, phiên khác): EPIPE không còn sập HQ, live chỉ khi có output, watchdog 40 s, nhãn phòng `core · dự án`
- [x] content-post-agency #95, #96 (ad-frames MKT short không nhãn AI) đã merge
- [x] Đo quick tunnel: nhả stream theo lô ~130 KB, không flush theo giờ (KNOWLEDGE 2026-11-04)
- [x] Nguyên nhân: replay phòng (≤ 256 KB, một event) → lô đầu có ping + một phần replay trong 4 s → trang ở lại stream, trống
- [x] Sửa (branch `fix/hq-term-held-stream`, PR #282, rebase lên #281): HQ ping 2 s kèm giờ, ngoài loopback poll khi im 6 s hoặc ping trễ > 3 s; bỏ `arm(STALL_MS)` đầu vòng đọc của #281 (đè mốc 4 s → 40 s); `end` thắng ping trễ; interval ping của stream đã kết thúc được dọn
- [x] Reviewer: approve sau P2 (`!ended`), P3 test payload ping + interval, P3 ghi tradeoff một chiều
- [x] Tái hiện lại trên code đã rebase: proxy gom lô 6,1 s; loopback 0,6 s, 0 poll; CI 8/8 → merge #282 → tag v0.122.3
- [x] UAT HQ thật (0.122.2) lộ lỗi khác: 1/12 lần tải sập "This page couldn't load" (`makeApi` nuốt AbortError → `worktrees` undefined). Sửa ở v0.122.4 (branch `fix/hq-api-abort`)
- [x] v0.122.4 (#284): reviewer approve, CI 8/8, release xanh, `8sync up` → HQ `/api/version` ui 0.122.4; 24 lần tải HQ thật 0 sập (trước 1/12); bundle đang phục vụ có `signal?.aborted)throw`
- [x] Link public thật (host không đổi sau `up`): đăng nhập OK, terminal phòng hiện 33 dòng chữ sau 1,0 s, 0 pageerror. Shell máy qua Cloudflare bị chặn có chủ ý (`app/api/shell/route.ts:17`, khung hiện câu báo đỏ)
- [ ] Owner lấy link đăng nhập mới khi cần: `8sync hq ui --relink` (giữ host + cookie thiết bị đã đăng nhập)

## Current
Loop tick xong: goal (terminal trống qua link public) đã kiểm trên bề mặt thật. Chờ owner phản hồi trên điện thoại.

## Next
- VPS `vps.8syncdev.com` không vào được (ssh :22 timeout) → link cố định `/hq` không kiểm được.
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
