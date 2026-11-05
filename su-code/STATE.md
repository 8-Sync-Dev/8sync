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

## Goal: đa kênh cho tab Nội dung (phiên tu-session-marketing-phong-core)
Owner 2026-11-04: một bài lên lịch NATIVE ra FB Page + LinkedIn (profile Tú) + Threads @8syncdev + YouTube (8 Sync Dev) qua ego-browser profile "8sync FB" (task space id 2 "8sync content channels", tab p1 FB · p2 LinkedIn · p3 YouTube Studio · p4 Threads), ghi permalink + published_at về item; gate không nhãn AI giữ cho mọi kênh. Acceptance: UAT click thật trên HQ :8740 + 1 bài test lên lịch trên 3 kênh text rồi xoá lịch.
- [x] content-post-agency `feat/content-channels` (worktree `C:/Users/Projects/cpa-channels`): 0064 (`channels`, `captions_json`, bảng `content_channel_posts`), `src/services/channels/*`, `pnpm channels:tick`; driver Threads kiểm live
- [x] HQ `feat/hq-content-channels` (v0.123.0): chip kênh, caption theo kênh, trạng thái từng kênh, Thử lại, luật duyệt 409; kiểm trên dev HQ :8771 với bản sao DB
- [ ] Driver Facebook / LinkedIn / YouTube kiểm live
- [ ] Áp 0064 vào DB thật (backup trước), runner chạy định kỳ (Scheduled Task) từ checkout sạch
- [ ] PR + reviewer + merge + release HQ + `8sync up`
- [ ] UAT: bài test lên lịch FB/LinkedIn/Threads qua HQ → kiểm trên nền tảng → bỏ duyệt → lịch bị huỷ → xoá item test

## Current
v0.122.21: ô nhắn Chat phòng ra hàng riêng full-width dưới split (split chỉ còn tin nhắn | Nhật ký) theo ảnh owner 2026-11-05.
v0.122.20: Kết quả đặt tên lượt `/eccx-*` theo `Goal:`, cờ `working` vào `RoomLogProvider` (chat + panel cùng "Đang làm"), map tin → lượt trong 1 phút trước … 30 phút sau.
Research (/eccx-research, chỉ báo cáo): trail/graphify đã cài trong harness nhưng agent ít dùng (Claude Code 7 ngày: trail 1 421 lần vs grep/Read ~23 k); HQ chưa có tab đồ thị code; `harness toolstats` sai tên thư mục session omp trên Windows (`toolstats.rs` + `web.rs` `session_slug`); dsh-superagent (DeepSeek) chỉ dùng read/glob/grep.
PR #297 (đa kênh + Duyệt một chạm) đã merge `origin/main` (merge commit): cổng nhãn AI theo main (bỏ), `ai_label` thành lựa chọn không bắt buộc; `send` chỉ chủ HQ. content-ai 0064 mới ở nhánh `wip/content-channels-snapshot`, chưa vào `win-dev`.

## Next
- Owner chọn: sửa toolstats/web slug · hook gợi ý trail trong kit Claude Code + `8sync trail --all` · tab "Bản đồ code" HQ · graphify vào eccx core.
- Owner chọn phương án Không gian / Chat phòng (1 hay 2).
- Treo: dọn đĩa (ct-plan 64,8 GB, pnpm 11,5 GB); VPS `vps.8syncdev.com`; xoay token HQ UI (gấp: lộ qua `?k=` trong output tool).
- Đa kênh: đưa 0064 của content-post-agency (`wip/content-channels-snapshot`) thành PR vào `win-dev`; tới lúc đó HQ chạy như DB chưa có kênh.
- Đa kênh: tự động hoá trình duyệt trên LinkedIn/Threads trái điều khoản nền tảng (có thể bị hạn chế tài khoản), báo owner.
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
- Link không cần đăng nhập lại khi tunnel restart cần host cố định (VPS hoặc Cloudflare named tunnel); quick tunnel đổi host.
