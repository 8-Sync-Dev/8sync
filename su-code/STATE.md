# STATE — su-code

## Goal
Owner 2026-11-04: chia khung Nhật ký/chat, media trong chat (xem/tải), chép caption Nội dung, chia sẻ HQ cho người ngoài theo vai trò (xem/sửa), terminal hết lag, giới hạn tài nguyên an toàn, dọn rác (kế hoạch trước), rồi Tailscale cho HQ.

## Checklist
- [x] v0.122.10: #295 terminal hết lag, #296 chia khung, #298 chép caption, #299 test không xả rác %TEMP% + "Dự án trên máy" bỏ thư mục tạm (302 → 106 dòng)
- [x] #301 media trong chat (ảnh/video/audio/file, Range 206, `?dl=1`, link ký 12 h, không fetch OG phía server)
- [x] #302 Chia sẻ: owner/editor/viewer, invite link (sha256, cookie `hq_guest` ≤ 7 ngày, thu hồi → 401 ngay), bảng route deny-by-default; link ký file đính kèm chat chỉ cho chủ
- [x] eco: ngưỡng RAM 80→75 %, CPU 75→70 % (`~/.config/8sync/eco.json`)
- [x] Task "8sync HQ" (watchdog VPS-tunnel gọi lại) giờ chạy `hq ui --public --no-open`: trước đó mỗi lần watchdog mở lại HQ là mất link public
- [x] Tailscale: đăng nhập tailnet `8syncdev.github` (nhầm tạo thêm `alex-dev-8sd.github`), cài client 1.104.5
- [ ] Tailscale chưa lên mạng: tailscaled bị WARP chặn (WSAEACCES khi dial controlplane); chờ owner chọn cách
- [ ] Dọn rác: chờ owner duyệt kế hoạch (%TEMP% ~2,2 GB fixture test cũ, worktree đã merge)
- [ ] Clip #3 (bài 35, Reels 17 s) chưa có `media_path`
- [ ] "omp exited non-zero": chờ owner cho biết lệnh/thư mục
- [ ] PR #297 (đa kênh Nội dung, phòng khác) còn mở

## Current
Release v0.122.11 (#301, #302).

## Next
- HQ qua Tailscale: `hq ui --tailscale` = `tailscale serve` + host `*.ts.net` vào public.json, nhận `Tailscale-User-Login` làm danh tính (chỉ sau khi tailscaled lên mạng).
- VPS `vps.8syncdev.com` bị OVH treo: sửa VPS hay bỏ hẳn task "8sync HQ VPS tunnel".
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
