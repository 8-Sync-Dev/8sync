---
gsd_state_version: '1.0'
feature: SLUG
ticket: "TICKET"
branch: "BRANCH"
status: planning
active_phase: "M0"
next_action: plan-phase
next_phases: ["M0"]
progress:
  total_phases: 0
  completed_phases: 0
  percent: 0
last_updated: "DATE"
---

# State — FEATURE_NAME

> Bộ nhớ sống. Đọc ĐẦU TIÊN mỗi session. Giữ < 100 dòng — DIGEST không archive.
> Frontmatter ràng buộc parser: `---` ở ký tự đầu file · KHÔNG comment trong `progress:` · `next_phases` single-line `["M1"]`.
> `ticket`/`branch`: TUỲ CHỌN — điền ở `/feature new` nếu user muốn, để trống được. KHÔNG ép ticket/nhánh.

## Project Reference

See: su-code/planning/SLUG/PROJECT.md · ROADMAP: su-code/planning/SLUG/ROADMAP.md
**Core value:** [1 câu từ PROJECT.md]
**Current focus:** [phase đang làm]

## Current Position

Phase: M0 of N ([tên phase])
Plan: 0 of 0
Status: planning
Vì sao phase này: [1 câu neo về mục tiêu — chống lạc]
Last activity: DATE — [việc vừa xong]

## Accumulated Context

### Decisions (append, 3-5 cái gần nhất; full ở PROJECT.md — ghi CẢ lý do)
- [Mx]: [quyết định — vì sao]

### Contract — phase sau CẦN BIẾT (append mỗi khi phase xong)
<!-- Những gì phase này để lại mà phase sau sẽ gọi/dùng. Symbol thật, không mô tả chung. -->
- [Mx]: hàm `Module::method(...)` — [làm gì]; bảng/store `xxx` cột [a,b]; endpoint/route `...`

### Files touched (per phase, để resume verify bằng code-intel)
- [Mx]: `path/file1` (new), `path/file2` (edit) — commit <hash ngắn>

### Blockers/Concerns
None

## Session Continuity

Stopped at: [việc cuối — file nào, xong/dở]
Next: [next_action cụ thể — session sau làm tiếp cái này]

<!-- RESUME RULE: session mới đọc STATE xong PHẢI verify Contract bằng ground-truth
     trước khi code tiếp: `codegraph query "<symbol>"` 
     các symbol trong Contract (tồn tại thật?) + `detect_changes` (code đổi gì từ session
     trước). State ghi ý định, code ghi sự thật — lệch nhau thì tin code, sửa STATE. -->
<!-- DONE RULE: kết thúc phase = rewrite STATE (Position/Decisions/Contract/Files/Next)
     TRƯỚC khi báo done. Chưa rewrite = phase chưa xong. -->
