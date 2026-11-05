# STATE — su-code

## Goal
Owner 2026-11-05 (`/eccx-loop-full`): tự fix/dev theo tick, không làm hư link public đang dùng (quick tunnel → HQ :8740), UAT ở port local. Tick 1 xuất phát từ: "sheet ngày 5/11 không có Kết quả, HQ đã lên bản mới chưa?".

## Checklist
- [x] Nguyên nhân: HQ :8740 chạy từ worktree `su-code-uat` = chỉ #310 (chưa có #312 Kết quả, #313 picker); phòng cpa ĐÃ đăng proof Meta cho #38 + #16 (artifact có `content:[16,38]` + link Business Suite)
- [x] Build gộp #310 + #312 + #313 (`c92d05e5`, worktree `su-code-live`), vitest 847/847, tsc + ext tsc + build sạch, UAT :8741: sheet 5/11 #38 hiện "Kết quả" (link Meta + ảnh proof), Tổng quan hiện link #16/#38
- [x] Đổi HQ :8740 sang bản gộp tại chỗ: `su-code-uat` checkout `c92d05e5` (bản sửa cũ ở `git stash` "uat working copy…"), build, kill cây node con của supervisor `8sync hq ui --public` → supervisor tự chạy lại node cùng port; cloudflared + `public.json` giữ nguyên → link không đổi (local + public trả 200, chunk mới 200, `/api/content/results` có 1 artifact)
- [x] #313 CI đỏ (`hq-ui-test`, `package-hq-ui`): test import tĩnh extension → tsc đi theo type SDK omp; sửa `1758da68` (import lúc chạy), CI 8/8 xanh
- [ ] Owner duyệt merge #278 → #312 → #310 → #311 → #313 rồi release v0.122.15 (sau đó `su-code-uat` về lại bản release)
- [ ] Owner chọn phương án Không gian / Chat phòng (1 hay 2)

## Current
Tick 1 xong. Chờ owner: merge/release, phương án Chat phòng.

## Next
- Tick sau: không có việc tự làm an toàn còn lại khi chưa có quyết định của owner → 2 tick no-op thì dừng loop.
- Treo từ trước: dọn đĩa (ct-plan 64,8 GB, pnpm 11,5 GB); VPS `vps.8syncdev.com`; PR #297; xoay token HQ UI.
