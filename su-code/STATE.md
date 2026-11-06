# STATE — su-code

## Goal
Owner 2026-11-06: HQ trên phone dùng được trọn: gợi ý `/` `@` không khuất, Nhật ký tới được bằng thanh "Chat · Nhật ký" (v0.127.4); video demo mới trên site/README; skill `hq-*` chuẩn; quyết định repo public hay private. Luật bố cục ghi ở `su-code/PREFERENCES.md`.

## Checklist
- [x] v0.126.0 `--tailnet` + `--at-login` đã release (PR #328)
- [x] v0.127.0: vitest + eslint + tsc + smoke trình duyệt trên dev :8791 (pane Thư mục, Mở lớn, branch sidebar, tạo thư mục 409/201)
- [x] v0.127.0 đã release (PR #329)
- [x] v0.127.1 đã release (PR #330), `8sync up` xong; :8740 trả UI 0.127.1, `/api/projects/branches` 9 repo (có 8sync-startup)
- [x] v0.127.4 đã release (PR #338), `8sync up` + `8sync harness global` xong; :8740 trả UI 0.127.4 (gợi ý trong sheet phone, thanh Chat · Nhật ký, header tin `[owner → <phiên> · <thư mục>]`, video demo 13 s, `hq.mjs` msg/turns/--full)
- [x] Owner chốt: KHÔNG nhãn AI ở mọi nơi → content-post-agency #130 merged (win-dev) + drivers trên `wip/content-channels-snapshot` 86febb84; khi merge nhánh đa kênh vào win-dev: file va #130 lấy bản win-dev, chạy `tests/policy/no-ai-label.test.ts`
- [x] Audit public/private repo: khuyên GIỮ PUBLIC (private làm gãy install/`8sync up`/get.8syncdev.com, ~$380–560/tháng Actions) + dọn: nội dung CloudGo trong `assets/skills/{encore-eino-go,ai-microservice-design}`, `gateway-models.yml:12`, fixture tailnet thật, ghi chú nội bộ `su-code/`·`outputs/`·`plans/`·`research/`, `docs/hq-quota-keys.md`. Chờ owner chọn
- [ ] Tailscale: Quyền (Quin19FD) đã là Member nhưng chưa có máy online; chờ owner tạo link khách HQ (Chỉ xem / Sửa nội dung) và chọn siết ACL hay Share 1 máy
- [x] v0.128.0 đã release (PR #341), `8sync up` + `harness global` xong; :8740 trả UI 0.128.0: HQ bỏ hẳn nhãn AI + test policy, sheet "Trạng thái đăng" 3 nhóm + trượt mượt, tự giao phòng đăng khi kênh không lên lịch được (`lib/server/content-manual.ts`, HQ giữ chỗ dòng `scheduling` trước khi giao), đường dẫn file trong tin phòng bấm mở được (PDF/Office/ảnh/md). Ảnh sheet live: `C:\Users\Admin\Pictures\hq-v0.128.0-sheet-{1440,390}.png`, đã gửi phòng cpa (#6096, #6097)
- [x] v0.129.0 đã release (PR #343), `8sync up` + `harness global` xong; :8740 trả UI 0.129.0: khung chi tiết Nội dung kéo rộng (≥ 1280 px), Góp ý nháp gửi 1 lần, tự giao phòng đăng bù tới 72 h + kênh chưa có dòng (giữ chỗ `blocked` + "HQ giao …", bỏ qua bài có dấu hiệu đã đăng). cpa đã ghi facebook `published` cho #16/#38/#39/#76, `cancelled` cho linkedin #77/#79
- [ ] v0.129.1 (PR #344): eco tự đóng tab New tab của trình duyệt agent (`--remote-debugging-port`) khi renderer ≥ 4 GB. Đã gỡ tay ngay: Edge deploy-profile CDP :9309, 4 GB → 303 MB
- [x] v0.127.2 đã release (PR #334), `8sync up` xong; :8740 trả UI 0.127.2 (ô chat full ngang + nút Báo cáo; sheet ngày: lưới mục tiêu 8 ô, hàng 2 dòng, tag kênh)
- [x] v0.127.3 đã release (PR #335), `8sync up` xong; :8740 trả UI 0.127.3 (nút Báo cáo trong hàng nút ô chat cả trên phone, hàng xuống 2 dòng < 640 px)
- [x] Owner "auto fix với cách tốt nhất" → giao content-post-agency (#6049, #6059): phương án A + Highlight Cam. Gốc mất tiếng cảnh 2+: bump `@hyperframes` 0.7.26 → 0.8.221 (181e9c73) làm producer cộng giờ bắt đầu scene vào `data-start` của media lồng; sửa `data-hf-media-start-basis=global` — PR 8syncdev/content-post-agency#122 (→ `win-dev`), đo qua UI 5 cảnh: giọng lệch ≤ 0.04 s, -14.1 LUFS (master -14 của app, giữ)
- [ ] content-post-agency: merge #122 (ai `pnpm install` trên `win-dev` trước khi merge sẽ dính lỗi); PR tiếp: clip dài hơn lời → app tự cắt clip cho vừa lời (tăng tốc chỉ khi ≤ 1.25×), hết quãng lặng 4.8 s; quay lại demo HQ bằng Demo sản phẩm qua `localhost:8740` (không link public, không lộ token)
- [ ] content-post-agency: preset "Highlight Cam" (`scenes/course/highlight-cam.ts`, 9:16, /ad-frames + tab trend; không sửa recordly). Luật: 100% output tạo + UAT trên app, không script tay
- [x] 0065 đã áp vào `daily-dev.db` (content-post-agency, nhánh `wip/content-channels-snapshot` 2f3dc342, backup `daily-dev.db.bak-pre0065-1793925502904`); HQ :8740 kiểm: `channels0065: true`, 52 dòng kênh đều `scheduled`, #77–80 đủ 6 kênh (thêm TikTok/X)
- [ ] Owner: #77–80 đã lên lịch trên 6 nền tảng khi còn `checked` → Duyệt, hoặc huỷ lịch trên từng nền tảng
- [ ] Owner: ĐỪNG chạy `pnpm channels:tick` trên `daily-dev.db`: tick coi món không approved là "bỏ duyệt" → huỷ lịch thật. Vá 04239d99 chỉ bỏ qua kênh KHÔNG có driver (tiktok/x); FB/LinkedIn/Threads/YouTube có driver nên vẫn bị huỷ: tới 44 dòng (32 + 4 + 4 + 4) khi các món còn `checked`
- [ ] Owner: mua domain Cloudflare → `8sync hq ui --tunnel-setup hq.<domain>` → restart `--public`

## Goal: đa kênh cho tab Nội dung (phiên tu-session-marketing-phong-core)
Owner 2026-11-04: một bài lên lịch NATIVE ra FB Page + LinkedIn (profile Tú) + Threads @8syncdev + YouTube (8 Sync Dev) qua ego-browser profile "8sync FB" (task space id 2 "8sync content channels", tab p1 FB · p2 LinkedIn · p3 YouTube Studio · p4 Threads), ghi permalink + published_at về item; gate không nhãn AI giữ cho mọi kênh. Acceptance: UAT click thật trên HQ :8740 + 1 bài test lên lịch trên 3 kênh text rồi xoá lịch.
- [x] content-post-agency `feat/content-channels` (worktree `C:/Users/Projects/cpa-channels`): 0064 (`channels`, `captions_json`, bảng `content_channel_posts`), `src/services/channels/*`, `pnpm channels:tick`; driver Threads kiểm live
- [x] HQ `feat/hq-content-channels` (v0.123.0): chip kênh, caption theo kênh, trạng thái từng kênh, Thử lại, luật duyệt 409; kiểm trên dev HQ :8771 với bản sao DB
- [ ] Driver Facebook / LinkedIn / YouTube kiểm live
- [x] Áp 0064 vào DB thật (backup trước)
- [ ] BLOCKED: runner `channels:tick` chạy định kỳ (Scheduled Task) — chỉ bật sau khi tick tách "lịch tay chờ duyệt" khỏi "bỏ duyệt", hoặc sau khi mọi món đã lên lịch (#77–80…) được Duyệt
- [x] PR #297 gộp vào release v0.123.0 (review bảo mật: `send` chỉ chủ, `assign` ẩn với khách)
- [ ] UAT: bài test lên lịch FB/LinkedIn/Threads qua HQ → kiểm trên nền tảng → bỏ duyệt → lịch bị huỷ → xoá item test

## Current
v0.129.0 đang release. Chờ owner: dọn repo public (CloudGo…), Tailscale cho Quyền (máy chưa vào tailnet, cần link khách HQ), domain named tunnel.

## Next
- Tự giao đăng tay: bài phòng đăng tay mà không ghi dòng kênh, không `published_at`, không `fb_post_url` chỉ còn bước kiểm trang thật của phòng chặn đăng lại; luật cho phòng: đăng tay là ghi dòng ngay. Gửi lỗi / không có phòng thì tick thử lại mỗi 60 s tới hết 72 h (không gửi trùng; thêm backoff nếu ồn). "Thử lại" trên dòng `failed` do phòng ghi vẫn mở, đúng ý đồ.
- Đa kênh: đưa 0064 + 0065 của content-post-agency (`wip/content-channels-snapshot`) thành PR vào `win-dev`; thiết kế phân biệt "lịch tay chờ duyệt" với "bỏ duyệt" trong `channels:tick`.
- content-post-agency: `course_chat_messages` rowid 1, 2 mồ côi (thiếu `course_chat_sessions`), có từ trước 0065, chưa xử lý.
- Đa kênh: tự động hoá trình duyệt trên LinkedIn/Threads trái điều khoản nền tảng (có thể bị hạn chế tài khoản), báo owner.
- `--mode codex-cli`: engine kế tiếp (hiện báo "chưa hỗ trợ").
- content-post-agency: xác nhận đã gỡ mọi nhãn AI (option, toggle nền tảng, caption/watermark) + test chặn tái xuất hiện (#6079).
- Sửa gốc inbox phòng do Orca mở (KNOWLEDGE 2026-11-04).
- `statusline::tests::chained_timeout_kills_group` flake Windows CI; đỏ lại thì `gh run rerun --failed`.
- `8sync up` không deploy lại bundled skill vào `~/.omp/skills` (KNOWLEDGE 2026-11-06): cho selfup chạy bước refresh skill của `harness global` sau khi cài binary mới.
- Link không cần đăng nhập lại khi tunnel restart cần host cố định (Cloudflare named tunnel); quick tunnel đổi host. VPS cũ đã huỷ.
