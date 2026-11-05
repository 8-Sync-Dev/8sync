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
v0.122.21: ô nhắn Chat phòng ra hàng riêng full-width dưới split (split chỉ còn tin nhắn | Nhật ký) theo ảnh owner 2026-11-05.
v0.122.20: Kết quả đặt tên lượt `/eccx-*` theo `Goal:`, cờ `working` vào `RoomLogProvider` (chat + panel cùng "Đang làm"), map tin → lượt trong 1 phút trước … 30 phút sau.
Research (/eccx-research, chỉ báo cáo): trail/graphify đã cài trong harness nhưng agent ít dùng (Claude Code 7 ngày: trail 1 421 lần vs grep/Read ~23 k); HQ chưa có tab đồ thị code; `harness toolstats` sai tên thư mục session omp trên Windows (`toolstats.rs` + `web.rs` `session_slug`); dsh-superagent (DeepSeek) chỉ dùng read/glob/grep.

## Next
- Owner chọn: sửa toolstats/web slug · hook gợi ý trail trong kit Claude Code + `8sync trail --all` · tab "Bản đồ code" HQ · graphify vào eccx core.
- Owner chọn phương án Không gian / Chat phòng (1 hay 2).
- Treo: dọn đĩa (ct-plan 64,8 GB, pnpm 11,5 GB); VPS `vps.8syncdev.com`; PR #297; xoay token HQ UI (gấp: lộ qua `?k=` trong output tool).
