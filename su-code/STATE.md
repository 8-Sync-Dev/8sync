# v0.111.0 — harness gọn: bỏ board, per-repo chỉ ECC, cắt token

## Goal
Owner 2026-10-30: xoá board/card/team/auto tự chế (8sync không tự mở hay nhắc session); per-repo harness chỉ ECC (`ecc@ecc` giữ đủ); tối ưu token mạnh nhất, Rust, nhẹ RAM. Lịch sử các bản trước nằm trong CHANGELOG và git.

## Checklist
- [x] #247 bỏ board/card/auto-team/delegate/permit; exe −771 584 B
- [x] #246 per-repo ECC-only: hết vendor `su-code/skills`, block AGENTS/CLAUDE 955 B, ECC rule pack theo stack, session-start ≤1 200 ký tự
- [x] #248 compaction ~200K (ccc 80 % × 250K, omp `thresholdTokens` 200000); hook ECC tắt thật; seed skill-listing 0,005 + deny 3 tool không dùng; luật giọng gọn
- [ ] Đo lại 24 h sau release so với mốc cũ

## Current
v0.111.0 vừa phát hành. Mốc trước release (24 h transcript Claude Code): 10 020 call, 2,41 B token phía input, 78 % ở context ≥200K. Prefix probe "OK": trung tính 43 968 → 36 882, repo su-code 96 026 → 41 084.

## Next
- Chạy lại `usage-scan` 24 h sau release; kỳ vọng ~−50 % token input (replay: nén ở 200K = −53 %).
- Compaction 200K làm mất ngữ cảnh → `8sync ccc compact --at 65 --window 1000000` để trả mốc cũ.
- Compaction 200K làm mất ngữ cảnh → `8sync ccc compact --at 65` rồi `8sync ccc compact --window 1000000` để trả mốc cũ.
