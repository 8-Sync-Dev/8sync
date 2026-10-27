---
name: autopilot
description: Unattended backlog runner, level 5 — /autopilot. Picks items from labelled GitHub issues, STATE.md Next, or unguarded failure lines, runs each as /ship-loop (no release), batches green PRs, then ONE Ship question; writes a brief to STATE.md. Owner-only; also headless via claude -p.
argument-hint: "[--max-items 5] [--hours 8] [--backlog issues|state|knowledge]"
disable-model-invocation: true
---
Tham số: $ARGUMENTS

Level 5. Mặc định `--max-items 5`, `--hours 8`, backlog theo thứ tự dưới (`--backlog` chỉ giới hạn vào một nguồn). Chỉ owner khởi động; "dừng"/"stop" kết thúc ngay.

1. **Khởi động** — đọc `su-code/STATE.md`; ghi `autopilot` vào `su-code/ship/ACTIVE` (sống sót qua /compact); ghi mốc bắt đầu để tính `--hours`. `8sync ccc . ls` + ListAgents để biết lane, mục tiêu và file của session khác; `8sync ccc . goal "autopilot: <item>" --files <file>` mỗi khi đổi item.
2. **Chọn item** (đủ tiêu chí kiểm được mới nhận):
   1. GitHub issue mở, label `ccc` hoặc `8sync`, có acceptance criteria, chưa assignee: `gh issue list --label ccc --state open --json number,title,body,assignees` (và `--label 8sync`).
   2. Mục trong `su-code/STATE.md` phần `Next`.
   3. Dòng `failure:` trong `su-code/KNOWLEDGE.md` chưa có guard (hook/test/rule ngăn lặp).
   Bỏ qua item thuộc session khác (cùng file/chủ đề với `8sync ccc . ls`/ListAgents) → `SendMessage` hỏi/chia việc, không sửa chồng. Item chạm auth/secret/deploy, hoặc không viết được criterion có lệnh kiểm → bỏ qua, ghi lý do vào brief.
3. **Chạy từng item** như `/ship-loop "<item>"` (không `--release`), kể cả item nhỏ — không sửa thẳng: nhánh riêng (worktree trong repo), `su-code/ship/<slug>/PLAN.md` (criterion + lệnh kiểm), `8sync ccc loop init <slug>` rồi `CronCreate` `*/5 * * * *` → `/ship-tick <slug>` (tick tự tiếp khi session rảnh; `CronDelete` khi item xong), mỗi check qua `8sync ccc loop ev <slug> <C#> -- '<lệnh>'` (evidence vào LOOP.md), `/goal` (tuỳ chọn), skill `sec` (Skill tool, bắt buộc trước commit, không thay bằng grep tay), commit. `/goal` chỉ một cái mỗi session và là built-in (Claude không tự gõ được: not verified, theo docs hiện có) — nên chạy tuần tự từng item; interactive: in dòng `/goal` cho owner dán ở mỗi item, hoặc dùng chế độ headless bên dưới (mỗi item một `claude -p`). Mỗi item chạy theo nhịp `/sprint` ở chế độ gọn (cổng quy mô, ≤2 subagent mỗi item, tính vào `--max-budget-usd`; chỉ dispatch khi chạy bằng API key Console, không thì một agent), standup `8sync ccc standup <slug>` mỗi iteration, retro → `/remember`. Item stop:<reason> → ghi brief, sang item sau. Dừng toàn bộ khi: hết backlog, đủ `--max-items`, quá `--hours`, owner dừng, hoặc 2 item liên tiếp stuck.
4. **Không có remote/CI** (`git remote` rỗng) → item xanh chỉ commit trên nhánh của nó; cuối batch ghi `Ship: n/a (no remote)` vào brief, không tạo remote, không hỏi Ship.
5. **Gom batch** — mỗi item xanh: push nhánh feature + `gh workflow run` cho CI được phép trước Ship; merge/main/tag/release/deploy KHÔNG làm trước Ship. Cuối batch (hết backlog / đủ N PR xanh / hết giờ) hỏi MỘT `AskUserQuestion` header `Ship`, liệt kê từng nhánh/PR/tag: options đúng `Duyệt tất cả (Recommended)` · `Chỉ merge, chưa deploy` · `Dừng`. Duyệt → push → PR → `gh pr checks --watch` nền → merge từng PR xanh (CI phải xanh trên cả Windows, macOS và Linux (test + build release) trước merge/tag; OS nào chưa có job → ghi "not verified: <OS>" và không merge) → monitor. Build nặng chỉ trên CI.
6. **Brief** — ghi ≤10 dòng vào `su-code/STATE.md` mục `## Brief`: item xong (PR/commit + evidence), item bỏ/stuck + lý do, việc owner cần làm, thời gian/iteration đã dùng. Xoá dòng khỏi `ACTIVE`.

## Chạy headless (không cần mở terminal)
```bash
claude -p "/autopilot --max-items 5 --hours 8" --permission-mode auto --permission-prompts none --max-turns 200 --max-budget-usd 20
```
`--permission-prompts none` cần Claude Code v2.1.259+. Docs: `-p` chạy một lần tới xong; `/goal` dùng được trong `-p` (https://code.claude.com/docs/en/goal). `--max-budget-usd` là ước lượng phía client, có thể vượt; auto mode tạm dừng sau 3 lần liên tiếp / 20 lần tổng bị classifier chặn, và trong `-p` hành động bị chặn bị bỏ qua chứ không fatal (theo `su-code/ship/auto-harness/DESIGN.md`, chưa kiểm lại với bản docs hiện tại: not verified) → mỗi item kết thúc bằng bước verify trước câu hỏi Ship. Headless không trả lời được `AskUserQuestion`: batch dừng ở trước bước Ship và ghi brief; owner chạy `/ship-auto`/duyệt sau. Cần hooks bật + workspace đã trust.

## Giới hạn của lập lịch
Muốn chạy lặp theo giờ bằng `/loop`: tác vụ lặp hết hạn sau 7 ngày, chỉ chạy khi session mở và idle, và `/loop` tự pace không được khôi phục khi `--resume` (https://code.claude.com/docs/en/scheduled-tasks#limitations). Skill có `disable-model-invocation: true` không chạy khi scheduled task dùng nó làm prompt — nên cron/routine phải gọi `claude -p` hoặc owner khởi động; `/ship-tick <slug>` thì model-invocable, là prompt cron mà `/ship-loop`, `/autopilot`, `/ship-auto` đặt sau khi owner đã khởi động để vòng lặp tự tiếp (một việc mỗi tick, tự xoá cron khi xong). Cần chạy bền không phụ thuộc session → Routines/GitHub Actions.

Rails: không `bypassPermissions`; `8sync ccc risk` rồi `/sec` mỗi diff; owner "dừng"/"huỷ" → `8sync ccc cancel` (loop trong ACTIVE, goal, urgent; fail-closed); không in secret; không đụng data client/CRM; không push main. Mọi câu "xong/pass" phải kèm lệnh + output; thiếu → "not verified".
