# STATE — su-code

## Goal
Owner 2026-11-07: `/solo` có gợi ý trong omp + HQ, kit loop mạnh có trong omp, `/solo` theo DeepSeek Super-Agent + graphify, tìm kiếm code đi qua graphify/trail. Release v0.131.0.

## Checklist
- [x] `/solo` SKILL.md viết lại theo dsh-superagent (Router/Worker, Report states, Mandate explicit/inferred, accept observe/auto, merge ≤200 dòng, retry ×3, Khởi động lại)
- [x] omp kit loops (`solo`, `autopilot`, `ship-loop`, `ship-auto`, `ship-tick`) deploy vào `~/.omp/agent/commands` (`skill/deploy.rs`)
- [x] HQ gợi ý skill `~/.claude/skills` (`apps/hq-ui/lib/server/commands.ts::readSkills`)
- [x] graphify tuyến chính cho callers/impact/path: harness block, APPEND_SYSTEM, 00-force-load, eccx-core, trail_hint
- [x] cargo test (deploy/trail_hint/skill/ccc; 3 lỗi looper do máy thiếu Git Bash trên PATH, không liên quan), vitest commands+solo, test_eccx_gen
- [x] v0.131.0 released (PR #348), `8sync up` + `harness global` xong; `/api/commands` có solo/autopilot/ship-*
- [ ] v0.131.1: không đè `/solo` owner tự viết (marker), TTSR rule + khối repo theo graphify-first

## Current
Worktree `C:\Users\Projects\su-code-kitguard`, nhánh `fix/kit-loop-keep-user`.

## Next
- Owner còn treo: #79 (DB rejected nhưng 5 kênh hẹn 08/11 15:00), #77 quay lại cảnh 13+14, quay lại #19/#20/#21/#24, 5 quyết định 18–30/11, dọn repo public, link Tailscale cho Quyền, domain Cloudflare, mật khẩu/PIN Windows, model ~81 GB, tích hợp chính dsh-superagent (tài khoản Windows riêng, observe).
- Worktree giữ: `.claude/worktrees/radar-20261102-1926` (#258), `.claude/worktrees/xenodochial-leavitt-eef970` (#244), `su-code-zalo` (#276).
