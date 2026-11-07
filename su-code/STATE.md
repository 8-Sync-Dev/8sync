# STATE — su-code

## Goal
Owner 2026-11-07 `/solo` (auto): HQ kiểu "Grok bot" — mỗi phiên là một bot, các bot hiểu việc của nhau, graphify ngay trong HQ, UI mới dễ dùng nhất trên điện thoại; kèm vòng tự cải thiện theo `su-code/research/self-improve-loop.md` (P1 Observer, P2 bộ chấm ngoài, P3 KNOWLEDGE có counter).

## Checklist
- [x] v0.135.0–v0.135.4: HQ tự cập nhật; Tri thức/Vòng lặp/Sessions thấy phòng omp (UAT link Tailscale 390 px trên 0.135.4: PASS)
- [x] PR #360 docs nghiên cứu self-improve + Observer (P1–P5)
- [x] PR #362 `/api/brief`, dòng `[từ phòng …]`, Chief of Staff (thay #361 đã đóng vì dính ảnh UAT)
- [x] PR #363 tab Bots (màn đầu), #364 graphify trong Bản đồ code, #365 Quan sát phòng (P1), #366 Bots-2 (tin phòng bên trái, giữ `~`, brief, Chief)
- [x] v0.136.0 (PR #367, tag 145c42ad)
- [ ] HQ live tự lên 0.136.0 + UAT 390/1280 qua link Tailscale (ảnh ngoài repo)
- [ ] P2 `8sync ccc grade` (worktree `su-code-grade`, nhánh `solo/grade`)
- [ ] P3 KNOWLEDGE v2 `[k-id] (+h/-x)` + `used:` (worktree `su-code-know`, nhánh `solo/know`)
- [ ] P2 + P3 chung ≤ ~35 KiB headroom size gate (mỗi cái ≤ 15 KiB)

## Current
Router ở `C:\Users\Projects\su-code-watch`, nhánh `fix/observer-captions` (observer dùng chung hằng caption với `deriveFloor`).

## Next
- Review + grade P2/P3, rebase lần lượt (CHANGELOG/KNOWLEDGE luôn xung đột: giữ cả hai khối), CI 8/8, merge, release 0.137.0.
- Owner còn treo: #79, #77, quay lại #19/#20/#21/#24, 5 quyết định 18–30/11, dọn repo public (lịch sử PR #361 cần GitHub Support), đổi key link công khai/Tailscale, domain Cloudflare, model ~81 GB, chọn phòng Canh máy, P4/P5, gỡ `hq-machine-mon`.
- Worktree giữ: `.claude/worktrees/radar-20261102-1926` (#258), `.claude/worktrees/xenodochial-leavitt-eef970` (#244), `su-code-zalo` (#276).
