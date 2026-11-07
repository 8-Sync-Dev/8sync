# STATE — su-code

Updated: 2026-11-07 · phase boundary: release 0.139.0 (HQ quanh Bot, kiểu Grok Bot)

## Goal
HQ thiết kế quanh Bot (brief chủ `8sync-startup/outputs/hq-grok-bot/BRIEF.md`): roster Bot, nhóm + @bot, các phòng hiểu session của nhau, mobile-first, UAT thật trên Tailscale.

## Checklist
- [x] #375 research bots/groups · #376 thread không nhảy + sidebar gọn · #377 mẫu + "Bot mới" · 0.138.0
- [x] #379 nhóm bot, @bot giữa các bot, loop guard (hop ≤3/turn ≤6, pair-limit 12/10 phút)
- [x] #380 UI audit ngoài Bots (tiếng Việt, tên phòng, phone) + login reload 1 lần khi cookie Strict bị bỏ
- [x] #381 digest "ai đang làm gì" + fact chung (bot đề xuất, chủ duyệt) + `hq.mjs turns` + panel "Đang biết gì"
- [x] #382 shell mới: roster Bot (tên duy nhất, Chính), nav 4 mục Bots·Nhóm·Tìm·Thêm, tab đáy ≤768px, trang Bot (Chat · Lịch sử phiên · Bản đồ code · Đang biết gì), lưới mẫu
- [ ] 0.139.0 released → HQ tự cập nhật → UAT Tailscale 1280/390/360

## Current
Release 0.139.0. s8/s9 mới merged + unit test, CHƯA live.

## Next
1. UAT Tailscale trên 0.139.0: sidebar không "worktree/__advisor/cũ hơn", tên không trùng; 390/360 tab đáy 4 mục, scrollWidth == innerWidth, list→chat→Back; Bản đồ code từ trang Bot; mở link từ site khác vào thẳng HQ.
2. Live s8/s9: nhóm 2 phòng nháp A @B → B trả lời, ping-pong → 409 hop-limit; tin chủ có digest, tin kế không đổi thì không; `hq.mjs turns <bot>` trả reply đủ; `hq.mjs fact` → pending.
3. Đang làm s7 (worker-codemap, nhánh solo/codemap): Bản đồ code mobile, explain/path từ HQ, bật 1 chạm cho repo của bot → 0.140.0. Còn mở: `POST /api/templates`; chờ-anh lên đầu mới có unit test.
4. Quyết định chờ chủ: purge history PR #361 (GitHub Support), P4/P5, Cloudflare domain, Models ~81 GB, retire `hq-machine-mon`. `harness up` sắp archive ~670 dòng KNOWLEDGE.
