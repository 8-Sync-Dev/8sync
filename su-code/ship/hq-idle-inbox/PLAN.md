# hq-idle-inbox — giao task từ HQ tới phiên đang rảnh

Owner (2026-10-16, /autopilot): "trên hq ui giao task khi ccc còn working nó mới làm, còn khi nó chưa working gửi task nó bị
treo không gửi đi được".

## Nguyên nhân (đọc code)
`POST /api/tasks` với phiên mở ngoài HQ (địa chỉ = Claude session id: mọi phiên `8sync ccc`, mọi phiên trên Windows) chỉ
`queueInbox()` vào file inbox của HQ (`<state>/inbox/<id>.jsonl`). Người đọc duy nhất là Stop hook (`verify.rs owner_inbox`
→ `hq::take_inbox`), chạy khi một lượt kết thúc. Phiên đang rảnh không có lượt nào kết thúc → task nằm đó mãi.
Phiên `hq-*` (tmux) không bị: HQ gõ thẳng vào pane.

## Fix
1. `8sync ccc inbox [--session <id>] [--ack|--release] [--json]` (Rust): claim hai pha. Claim = rename `<id>.jsonl` →
   `<id>.claimed` (masked, khung câu cho phiên rảnh, `{"text"}`); claim còn mới (< 120 s) → null; claim cũ (taker chết)
   → gộp tin mới vào, phục vụ lại. `--ack` xoá claim; `--release` trả claim về inbox (O_APPEND, 0600). Stop hook không
   đụng claim, đọc lỗi thì trả file về.
2. Mod `8sync-inbox` (function hooks, cài qua kit vào `~/.claude/skills/8sync-inbox`): phiên interactive, khi main loop rảnh
   poll 5 s (1 phút đầu) → 15 s → 30 s, reset khi xong lượt / giao xong; claim → `$.prompt.submit`; bị drop →
   `$.prompt.fill` mode append (giữ chữ owner gõ dở) + toast; vào được → `--ack`, không → `--release`. Session id đọc mỗi
   poll (sau `/clear`), lỗi thì giữ id cũ. Review lần 1 (2 BLOCKER: id cũ sau /clear, fill replace làm mất draft/task) đã sửa.
3. HQ UI: đổi chữ "qua inbox (nhận khi xong lượt)" → "qua inbox (nhận ngay khi phiên rảnh)" (các chỗ hiện chữ + test).

## Acceptance criteria (exit 0 = pass; cwd /home/alexng/tools/su-code-inbox)
| # | Criterion | Lệnh |
|---|---|---|
| C1 | `inbox` verb: lấy một lần, masked, null khi trống/id xấu; producer (dòng `{ts,text}` như `queueInbox`) → verb → Stop hook không giao lại | `CARGO_TARGET_DIR=/home/alexng/tools/su-code-hq/target nice -n 19 ionice -c3 cargo test -q -j2 -p su-code inbox` |
| C2 | Mod hợp lệ | `claude plugin validate assets/claude/skills/8sync-inbox` |
| C3 | Test mod: rảnh → submit; đang chạy → không gọi; drop → fill; lỗi → im lặng; headless không poll | `claude plugin test assets/claude/skills/8sync-inbox` |
| C4 | Kit cài mod (KIT_FILES) + bảng verb khớp dispatcher | `CARGO_TARGET_DIR=/home/alexng/tools/su-code-hq/target nice -n 19 ionice -c3 cargo test -q -j2 -p su-code kit_installs_the_inbox_mod` và `… hint_ccc_verbs` |
| C5 | HQ UI test chữ mới | `cd apps/hq-ui && nice -n 19 npx vitest run tests/assign-ui.test.ts` |
| C6 | Clippy sạch ở file chạm | `! (cargo clippy -q -j2 -p su-code --all-targets 2>&1 \| grep -E 'verbs/(hq.rs\|ccc.rs\|ccc/help.rs\|ccc/hint.rs)')` |
| C7 | CI 3 OS | `gh run watch <id> --exit-status` |

## Giả định
- Poll 5 s khi rảnh (một process ~10 ms): đủ "gần như ngay", không tốn CPU.
- Prompt gửi có khung plugin (không `asUser`): text tự nói là tin của owner qua HQ, như Stop hook.
- Not verified tới khi owner restart phiên có mod: `$.prompt.submit` khi ô prompt đang có chữ owner gõ dở; UAT phiên thật
  cần ghi inbox thật — guard cấm session ghi inbox (đúng), nên owner giao một task từ HQ là bước UAT cuối.
- Nhánh xếp chồng trên `feat/ccc-hints` (cùng sửa KIT_FILES / help VERBS) → merge sau PR hints.
