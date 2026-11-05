# STATE — su-code

## Goal
Owner 2026-11-05: "release sài liền" — gộp chuỗi PR HQ (#278 hq-control, #312 Kết quả nội dung, #310 picker giao việc, #311 site, #313 chọn model, #314 spinner neon) thành v0.122.15, cài lên máy, HQ link public giữ nguyên; phòng cpa cập nhật Kết quả vào sheet.

## Checklist
- [x] Nhánh `release/v0.122.15` = origin/main + 6 PR head (xung đột docs gộp union, code lấy bản đã UAT `ef0c132b`)
- [x] Bump Cargo.toml / Cargo.lock / plugin.json, CHANGELOG `[0.122.15]`
- [ ] CI 8/8 → squash merge → tag → release.yml
- [ ] `8sync up` + `8sync harness global`; HQ :8740 (`--app su-code-uat`) về commit release, respawn qua supervisor, link public giữ
- [ ] Đóng #278 #310 #311 #312 #313 #314 trỏ về PR release
- [ ] Phòng core cpa cập nhật Kết quả/metrics (nhắc inbox #5980)

## Current
Release v0.122.15 đang chạy CI.

## Next
- Owner chọn phương án Không gian / Chat phòng (1 hay 2).
- Treo: dọn đĩa (ct-plan 64,8 GB, pnpm 11,5 GB); VPS `vps.8syncdev.com`; PR #297; xoay token HQ UI.
