# STATE — su-code

## Goal
Owner 2026-11-06: HQ từ xa qua Tailscale, link cố định, tự sống lại khi bật máy (`8sync hq ui --tailnet` + `--at-login`, v0.126.0). Tailnet `tail5204e3.ts.net`, máy `desktop-hrgdu0t`, HTTPS Certificates đã bật (console Tailscale, ego profile "8sync FB").

## Checklist
- [x] v0.124.0 + v0.124.1 đã release (grant ship chỉ từ trang HQ của chủ)
- [x] Thứ tự ảnh dán (`useAttach` slot theo lúc dán, `- 1. <path>`), báo cáo trong sheet ngày, nút `#id` → Nội dung, "Xem" → Kết quả, panel "Thư mục" + `/api/files`
- [x] vitest + next build + smoke UI trên sandbox HQ :8751 (phòng thật qua JSON của HQ live, ghi file chỉ trong worktree)
- [x] v0.125.0 đã release (PR #326)
- [x] v0.125.1: reply media không đánh số · Danh sách hiện trạng thái từng kênh + báo "lịch khi chưa duyệt" · bỏ `/rules` sót; vitest 996/996 + build + smoke sandbox :8752 (#77–80)
- [x] v0.125.1 đã release (PR #327)
- [ ] v0.126.0 `--tailnet` + `--at-login`: test → PR → release → `8sync up` → owner chạy `8sync hq ui --at-login` + `--relink`, cài Tailscale trên điện thoại (GitHub `8syncdev`)
- [ ] Owner: #77–80 đã lên lịch trên nền tảng khi còn `checked` → huỷ trên nền tảng hoặc Duyệt trước 15:00 06/11
- [ ] Owner: mua domain Cloudflare → `8sync hq ui --tunnel-setup hq.<domain>` → restart `--public`

## Goal: đa kênh cho tab Nội dung (phiên tu-session-marketing-phong-core)
Owner 2026-11-04: một bài lên lịch NATIVE ra FB Page + LinkedIn (profile Tú) + Threads @8syncdev + YouTube (8 Sync Dev) qua ego-browser profile "8sync FB" (task space id 2 "8sync content channels", tab p1 FB · p2 LinkedIn · p3 YouTube Studio · p4 Threads), ghi permalink + published_at về item; gate không nhãn AI giữ cho mọi kênh. Acceptance: UAT click thật trên HQ :8740 + 1 bài test lên lịch trên 3 kênh text rồi xoá lịch.
- [x] content-post-agency `feat/content-channels` (worktree `C:/Users/Projects/cpa-channels`): 0064 (`channels`, `captions_json`, bảng `content_channel_posts`), `src/services/channels/*`, `pnpm channels:tick`; driver Threads kiểm live
- [x] HQ `feat/hq-content-channels` (v0.123.0): chip kênh, caption theo kênh, trạng thái từng kênh, Thử lại, luật duyệt 409; kiểm trên dev HQ :8771 với bản sao DB
- [ ] Driver Facebook / LinkedIn / YouTube kiểm live
- [ ] Áp 0064 vào DB thật (backup trước), runner chạy định kỳ (Scheduled Task) từ checkout sạch
- [x] PR #297 gộp vào release v0.123.0 (review bảo mật: `send` chỉ chủ, `assign` ẩn với khách)
- [ ] UAT: bài test lên lịch FB/LinkedIn/Threads qua HQ → kiểm trên nền tảng → bỏ duyệt → lịch bị huỷ → xoá item test

## Current
v0.126.0 trong worktree `C:/Users/Projects/su-code-tailnet` (nhánh `feat/hq-tailnet`). HQ live đang tắt (owner tắt).

## Next
- Đa kênh: đưa 0064 của content-post-agency (`wip/content-channels-snapshot`) thành PR vào `win-dev`; tới lúc đó HQ chạy như DB chưa có kênh.
- Đa kênh: tự động hoá trình duyệt trên LinkedIn/Threads trái điều khoản nền tảng (có thể bị hạn chế tài khoản), báo owner.
- `--mode codex-cli`: engine kế tiếp (hiện báo "chưa hỗ trợ").
- `aiLabel` của job ad-frames chưa nối vào `content_items`.
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
- Link không cần đăng nhập lại khi tunnel restart cần host cố định (Cloudflare named tunnel); quick tunnel đổi host. VPS cũ đã huỷ.
