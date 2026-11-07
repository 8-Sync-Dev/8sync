# STATE — su-code

## Goal
Owner 2026-11-07 `/solo` (2), Level 6: HQ Bots như một messenger — chat đang mở không nhảy khi phòng khác bận (list trượt kiểu Messenger), sidebar Phiên gọn, tạo bot từ mẫu (mẫu → thư mục → tên), nhóm bot + @bot nói chuyện với nhau, các phòng hiểu session của nhau, tab graphify mạnh hơn, UI/UX mới mobile-first; ship + UAT Tailscale 390/1280.

## Checklist
- [x] v0.137.0: `ccc grade`, KNOWLEDGE v2 opt-in, sửa lỗi UAT 0.136.0 (HQ live lên 0.137.0, UAT PASS)
- [x] #374 graphify-out/ vào info/exclude · #375 research bots/nhóm/mẫu (`su-code/research/hq-bots-groups.md`) · #376 thread giữ nguyên + FLIP + sidebar gọn · #377 mẫu bot + sheet "Bot mới"
- [ ] v0.138.0: release (#374–#377), HQ tự cập nhật, UAT Tailscale 390/1280 (`~/.cache/8sync/uat/v0138/`)
- [ ] Nhóm bot + @bot + loop guard (research slice 3–7) — worker-groups
- [ ] Rà UI/UX ngoài tab Bots — worker-ui
- [ ] Tab graphify/Bản đồ code mạnh hơn · ngữ cảnh chéo phiên · UI mới mobile-first (chờ chủ gửi lại Image #1)

## Current
Router (phòng core su-code) cắt release 0.138.0; 2 worker đang chạy (groups, ui). Engine plan 3/10.

## Next
Merge release → tag → HQ tự cập nhật → UAT Tailscale. Rồi review PR nhóm bot + UI audit, giao slice graphify / cross-session / redesign.
