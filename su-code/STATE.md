# STATE — su-code

Updated: 2026-11-08 · phase boundary: release 0.140.0 (Bản đồ code, Bot mới chọn model, mẫu của chủ + AI, skill tự làm mới)

## Goal
HQ thiết kế quanh Bot (brief chủ `8sync-startup/outputs/hq-grok-bot/BRIEF.md`): roster Bot, nhóm + @bot, các phòng hiểu session của nhau, mobile-first, UAT thật trên Tailscale.

## Checklist
- [x] 0.138.0: #375 research · #376 thread không nhảy + sidebar gọn · #377 mẫu + "Bot mới"
- [x] 0.139.0: #379 nhóm + @bot + loop guard · #380 UI audit + login reload · #381 digest + fact + turns · #382 roster, nav 4 mục, tab đáy, trang Bot
- [x] UAT Tailscale 0.139.0 (phòng coding): link ngoài vào thẳng, sidebar 11 mục, tên tách, tab đáy 56px, scrollWidth đúng, list→chat→Back, digest đúng
- [x] #384 Bản đồ code: explain/path trong HQ, tự chọn repo của bot, đã có map → chỉ đăng ký (không rebuild), bật 1 chạm (chỉ chủ), ≥44px
- [x] #385 Bot mới chọn engine + model; mẫu có sẵn bỏ thương hiệu; Của tôi: Tạo/Sửa/Nhân bản/Xoá + xem trước; Tạo/Viết lại bằng AI (`claude -p`, chỉ chủ); Đính kèm + X ≥44px
- [x] #386 `hq.mjs` nhận ra phòng omp (`EIGHTSYNC_ROOM_ID`/`PI_SESSION_FILE`, mơ hồ → 422); `8sync up` làm mới skill bundled (manifest hash, giữ bản chủ sửa)
- [ ] 0.140.0 released → HQ tự cập nhật → UAT Tailscale 1280/390/360
- [ ] Live nhóm/@bot/hop-limit: chờ chủ tạo nhóm thử coding + su-code-demo trong HQ (API script bị 403 đúng thiết kế, không giả danh chủ)

## Current
Release 0.140.0. 6 mẫu thương hiệu đã chép vào `~/.config/8sync/hq/templates/` (mẫu của chủ). Engine 9/10 (còn s6 ship).

## Next
1. UAT Tailscale trên 0.140.0: Bot mới chọn engine/model (body request đúng), Của tôi Sửa/Xem trước/Xoá, Tạo bằng AI (cần `claude` đăng nhập trên máy HQ), Bản đồ code `core · su-code` → "đã có bản đồ" + Thêm vào HQ, 390/360 không cuộn ngang; `hq.mjs digest` không id từ phòng omp trả đúng phòng.
2. Live s8/s9 khi có nhóm thử: A @B → B trả lời, ping-pong → 409 hop-limit; tin chủ có digest, tin kế không đổi thì không; `hq.mjs turns`/`fact`.
3. Còn mở: link file:dòng từ chat sang Bản đồ code; worktree đặt cạnh repo (vd `su-code-codemap`) không dùng map của repo gốc; chờ-anh lên đầu chỉ có unit test.
4. Quyết định chờ chủ: purge history PR #361 (GitHub Support), P4/P5, Cloudflare domain, Models ~81 GB, retire `hq-machine-mon`. `harness up` sắp archive ~670 dòng KNOWLEDGE.
