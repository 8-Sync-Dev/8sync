# STATE — su-code

## Goal
Owner 2026-11-07 `/solo` (auto): HQ kiểu "Grok bot" — mỗi phiên là một bot, các bot hiểu việc của nhau, graphify ngay trong HQ, UI mới dễ dùng nhất trên điện thoại; kèm vòng tự cải thiện theo `su-code/research/self-improve-loop.md` (P1 Observer, P2 bộ chấm ngoài, P3 KNOWLEDGE có counter).

## Checklist
- [x] v0.135.0–v0.135.4: HQ tự cập nhật; Tri thức/Vòng lặp/Sessions thấy phòng omp
- [x] v0.136.0: tab Bots (#363, #366), graphify (#364), Quan sát phòng P1 (#365), brief + Chief (#362); HQ live tự lên 0.136.0, UAT Tailscale 390/1280 PASS (ảnh `~/.cache/8sync/uat/v0136/`)
- [x] #368 observer dùng chung hằng caption với `deriveFloor`
- [x] P3 KNOWLEDGE v2 opt-in (#369): `[k-id] (+h/-x)`, `used:`, gộp trùng, harmful → archive, `harness up --curate`, bỏ ghi khi file đổi giữa chừng
- [x] P2 `8sync ccc grade` (#371, thay #370): thêm test mới OK, sửa/xoá/đổi tên test có sẵn + CI/hook/conftest → REJECTED
- [x] #372 lỗi UAT 0.136.0: menu đóng ngay, header theo view, Bots đang tải, key trùng ở Bản đồ code
- [ ] v0.137.0 release + HQ live tự lên + UAT lại 4 lỗi trên (390/1280)

## Current
Router ở `C:\Users\Projects\su-code-watch`, nhánh `release/v0.137.0`.

## Next
- Sau UAT 0.137.0: báo owner; P4/P5 chờ owner quyết.
- Owner còn treo: #79, #77, quay lại #19/#20/#21/#24, 5 quyết định 18–30/11, dọn repo public (lịch sử PR #361 cần GitHub Support), đổi key link công khai/Tailscale, domain Cloudflare, model ~81 GB, chọn phòng Canh máy (để bật Quan sát phòng), gỡ `hq-machine-mon`.
- Worktree giữ: `.claude/worktrees/radar-20261102-1926` (#258), `.claude/worktrees/xenodochial-leavitt-eef970` (#244), `su-code-zalo` (#276).
