# v0.111.2 — lệnh /eccx-* cho mọi người dùng

## Goal
Owner 2026-10-30: bỏ board/card/team/auto; per-repo harness chỉ ECC (`ecc@ecc` giữ đủ); tối ưu token mạnh nhất, Rust, nhẹ RAM; ai cài/`8sync up` cũng có `/eccx-<nhóm>`. Lịch sử các bản trước nằm trong CHANGELOG và git.

## Checklist
- [x] v0.111.0: bỏ board (#247), per-repo ECC-only (#246), compaction ~200K + hook ECC tắt thật + seed gọn prompt (#248)
- [x] v0.111.1 (tag, không có bản phát hành: build macOS bị huỷ do brownout `macos-14`): `/eccx-<nhóm>` bundle trong binary (Claude Code qua `ccc kit`, omp qua `harness global`); registry bỏ builtin đã retire
- [x] v0.111.2: bản phát hành đầu tiên có `/eccx-*`; cắt builtin đã retire khỏi cả registry máy; release macOS chạy trên `macos-latest`
- [ ] Đo lại 24 h sau release so với mốc cũ

## Current
v0.112.0 (PR chờ CI): plugin `ecc@ecc` tắt; hook `ccc hook ecc-pick` tự gợi ý ≤3 member ECC mỗi prompt (UAT debug: ~100 ms, 0 output khi không khớp); `/eccx-*` chạy một Workflow + stage Learn.
Prefix probe "OK" sau v0.111.0: Claude Code trung tính 43 968 → 36 388; repo su-code 41 084 → 47 876 vì rule ECC `common/` (10 file, 18 KB, không có `paths:`) giờ luôn nạp. omp: trung tính 40 837 (không đổi), repo su-code 69 589 → 59 970.

## Next
- Sau release: `8sync up` rồi `8sync ccc kit` để cài hook `ecc-pick` vào `~/.claude/settings.json`; theo dõi pick sai/thiếu trong vài ngày, chỉnh `VI`/`MIN_SCORE` trong `crates/cli/src/verbs/ccc/ecc_pick.rs`.
- Chạy lại `usage-scan` 24 h sau release; kỳ vọng ~−50 % token input (replay: nén ở 200K = −53 %).
- Compaction 200K làm mất ngữ cảnh → `8sync ccc compact --at 65` rồi `8sync ccc compact --window 1000000` để trả mốc cũ.
- Không dựng filter output kiểu rtk: replay 27 341 output Bash thật chỉ −1,7 % (85,5 % là đọc file phải giữ nguyên).
