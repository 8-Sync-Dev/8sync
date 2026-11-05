# STATE — su-code

## Goal
Owner 2026-11-05: "release sài liền" — gộp chuỗi PR HQ (#278 hq-control, #312 Kết quả nội dung, #310 picker giao việc, #311 site, #313 chọn model, #314 spinner neon) thành v0.122.15, cài lên máy, HQ link public giữ nguyên; phòng cpa cập nhật Kết quả vào sheet.

## Checklist
- [x] Nhánh `release/v0.122.15` = origin/main + 6 PR head (xung đột docs gộp union, code lấy bản đã UAT `ef0c132b`)
- [x] Bump Cargo.toml / Cargo.lock / plugin.json, CHANGELOG `[0.122.15]`
- [x] CI 8/8 → squash merge #315 → tag v0.122.15 (`723aecae`) → release.yml
- [x] `8sync up` + `8sync harness global`; HQ :8740 (`--app su-code-uat`) về commit release, respawn qua supervisor, link public giữ
- [x] Đóng #278 #310 #311 #312 #313 #314 trỏ về #315
- [x] Phòng core cpa đăng Kết quả: proof #1 #5 #7 #16 #38, số liệu #1 (49 lượt xem)
- [x] v0.122.16: Tổng quan nội dung, tên bài dài đè cột Số liệu (đã cài, HQ :8740 đã swap)
- [x] v0.122.17: review độc lập #315 → chặn SVG ở Kết quả, kiểm lại tên bí mật/thư mục cấm khi đọc, digest một dòng

## Current
v0.122.18: digest đọc bài theo `scheduled_at` (không còn giới hạn 500 bài sửa gần nhất); F5 ghi rõ trong hợp đồng là cố ý.

## Next
- Owner chọn phương án Không gian / Chat phòng (1 hay 2).
- Treo: dọn đĩa (ct-plan 64,8 GB, pnpm 11,5 GB); VPS `vps.8syncdev.com`; PR #297; xoay token HQ UI.
