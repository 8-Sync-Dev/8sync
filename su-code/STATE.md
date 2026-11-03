# STATE — su-code

## Goal
HQ qua link `--public` điều khiển terminal mượt + báo đúng khi omp crash trên máy (v0.120.6–v0.120.7).

## Checklist
- [x] v0.120.5: skill `ego-zalo-advisor` (bundled, eccx content/specialized), deploy `~/.omp/skills` + `~/.claude/skills`
- [x] Repro trên link thật: phím lộn thứ tự; kill omp → link vẫn "Đang nối", bridge+omp mới lặng lẽ mở
- [x] v0.120.6: `keyQueue` (phím tuần tự), bridge thoát mã 4 khi host đóng, HQ giữ bridge đã kết thúc theo gen, long-poll `&wait=`
- [x] v0.120.7: poll treo trên bridge HQ tự đóng trả "chưa có gì mới" (hết báo nhầm "Đã rời phòng"), settle 40 ms
- [x] Test: vitest 759, cargo 636 (1 ignored); smoke bridge: rời = 0, omp chết = 4
- [x] UAT v0.120.7 trên link thật: gõ nhanh đúng nguyên văn, echo 323–452 ms/phím (v0.120.6: 546–692), crash báo sau 126 ms, Nối lại OK, đóng khung trên máy không làm rớt link, PONG/PING2 tới phòng
- [x] Dọn: phiên `uat-link-phien-thu-se`, phòng `uat-link`, tab `hqpub`

## Current
Không có việc dở cho HQ link.

## Next
- `8sync up` chỉ refresh kit, KHÔNG deploy bundled skill mới vào `~/.omp/skills` (phải chạy `8sync harness global`) — cân nhắc cho `up` deploy luôn.
- `statusline::tests::chained_timeout_kills_group` đỏ 1 lần trên Windows CI (release v0.120.7), re-run xanh — flake thời gian; đỏ lại thì đọc assertion `statusline.rs:869`.
