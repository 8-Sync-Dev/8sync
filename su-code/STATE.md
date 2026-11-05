# STATE — su-code

## Goal
Owner 2026-11-05 (/eccx-full, /eccx-security ưu tiên nhất): README + site đúng logo 8 Sync, trọng tâm `8sync . <name> --mode`; HQ Kết quả (Chép, bôi đen hỏi, thư mục, preview video/nhạc/office); tab Bản đồ code; dọn mọi việc treo; auto ship.

## Checklist
- [x] Xoay token HQ UI (link `?k=` cũ hết hạn sau 10 phút); VPS đã huỷ chủ động (ticket OVH CS16955879), gỡ SSH block; pnpm store prune; ct-plan đã không còn
- [x] `8sync trail --all C:/Users/Projects`: 25 repo
- [x] Nhánh agent: here-mode, harness-trail-hints, readme-web-brand, hq-results-ux, hq-code-map, PR #297 (merge main)
- [x] Review bảo mật vòng 1 (Rust: chặn tên phiên trùng lệnh engine, `--model=-x`; dashboard harness: Host/Origin/token, rule delete canonicalize; web-token vào deny/guard) + kiểm media public (bỏ 11 ảnh không dùng)
- [ ] Review bảo mật vòng 2 (HQ results/codemap/content + follow-up Rust) → sửa
- [ ] `release/v0.123.0` → PR → CI → squash → tag → release.yml → `8sync up` → swap HQ

## Goal: đa kênh cho tab Nội dung (phiên tu-session-marketing-phong-core)
Owner 2026-11-04: một bài lên lịch NATIVE ra FB Page + LinkedIn (profile Tú) + Threads @8syncdev + YouTube (8 Sync Dev) qua ego-browser profile "8sync FB" (task space id 2 "8sync content channels", tab p1 FB · p2 LinkedIn · p3 YouTube Studio · p4 Threads), ghi permalink + published_at về item; gate không nhãn AI giữ cho mọi kênh. Acceptance: UAT click thật trên HQ :8740 + 1 bài test lên lịch trên 3 kênh text rồi xoá lịch.
- [x] content-post-agency `feat/content-channels` (worktree `C:/Users/Projects/cpa-channels`): 0064 (`channels`, `captions_json`, bảng `content_channel_posts`), `src/services/channels/*`, `pnpm channels:tick`; driver Threads kiểm live
- [x] HQ `feat/hq-content-channels` (v0.123.0): chip kênh, caption theo kênh, trạng thái từng kênh, Thử lại, luật duyệt 409; kiểm trên dev HQ :8771 với bản sao DB
- [ ] Driver Facebook / LinkedIn / YouTube kiểm live
- [ ] Áp 0064 vào DB thật (backup trước), runner chạy định kỳ (Scheduled Task) từ checkout sạch
- [x] PR #297 gộp vào release v0.123.0 (review bảo mật: `send` chỉ chủ, `assign` ẩn với khách)
- [ ] UAT: bài test lên lịch FB/LinkedIn/Threads qua HQ → kiểm trên nền tảng → bỏ duyệt → lịch bị huỷ → xoá item test

## Current
v0.123.0 đang gộp trong worktree `C:/Users/Projects/su-code-v123` (nhánh `release/v0.123.0`).

## Next
- Đa kênh: đưa 0064 của content-post-agency (`wip/content-channels-snapshot`) thành PR vào `win-dev`; tới lúc đó HQ chạy như DB chưa có kênh.
- Đa kênh: tự động hoá trình duyệt trên LinkedIn/Threads trái điều khoản nền tảng (có thể bị hạn chế tài khoản), báo owner.
- `--mode codex-cli`: engine kế tiếp (hiện báo "chưa hỗ trợ").
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
- Link không cần đăng nhập lại khi tunnel restart cần host cố định (Cloudflare named tunnel); quick tunnel đổi host. VPS cũ đã huỷ.
