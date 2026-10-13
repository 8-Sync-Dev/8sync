# /feature go

> Đã load `references/feature-rules.md` (R3 load skill 2-lớp, R8 commit, **R10 code-intelligence FIRST — áp dụng cả subagent**) ở Dispatch chưa? Nếu chưa → load trước. Bước dưới KHÔNG lặp lại các luật đó.

Execute phase hiện tại theo PLAN.

## Nguyên lý: feed engine có sẵn — KHÔNG dựng engine mới

**Feature layer KHÔNG tự viết vòng lặp thực thi/swarm.** Nó FEED chính `engine_*` mà `/auto` lái (durable state ở `.cache/8sync/engine/state.json`, verify-gate + doom-loop guard + worktree đã enforce trong CODE). Feature layer chỉ sở hữu phần ENGINE KHÔNG quản: hợp đồng ROADMAP nhiều phase + AC + bookkeeping STATE/PLAN. Đọc `assets/commands/auto.md` (`/auto`) để lấy đúng kỷ luật engine-loop + guardrail cần mirror.

## Trước khi code

- **Đọc `M<x>-CONTEXT.md` TRƯỚC** → 📌 Requirement scope (UC từ REQUIREMENTS.md) + 🎯 Goal + ✅ AC + **Decisions (D1, D2…)** + ranh giới. Đây là "tại sao + nghiệm thu" — PLAN chỉ có "làm gì + file". Code đúng task nhưng sai UC/Decision = vẫn hỏng.
- Đọc `M<x>-NN-PLAN.md` → wave + task + file ownership + cột `[skill:]` + `[UC:]` + `[AC:]` mỗi task.
- Đọc STATE.next_action → biết task tiếp (resume đúng chỗ nếu session trước dở).
- **Load skill repo theo cột `[skill:]` (R3, BẮT BUỘC):** với MỖI skill ghi trong task, orchestrator đọc `su-code/skills/<skill>/SKILL.md` (hoặc `~/.omp/skills/<skill>/SKILL.md`) + references TRƯỚC khi code/spawn — KHÔNG mirror module có sẵn rồi suy đoán convention.

> **Orchestrator giữ CONTEXT trong đầu suốt phase.** Mỗi task code phải tôn trọng Decisions + nhắm AC nó gánh. Lệch Decision → DỪNG (như lệch ROADMAP, R6).

## Bước 1 — `engine_plan`: nạp phase vào engine

Gọi **`engine_plan`** một lần cho phase:
- `goal` = literal 🎯 **Goal** của phase (từ CONTEXT).
- `slices` = các **Wave** trong PLAN (mỗi wave = 1 slice; đặt title = tên wave).
- Mỗi slice `tasks` = các task `T<n>` của wave, `title` = mô tả task literal.
- Mỗi task `verify` = **lệnh lint/test/build THẬT của dự án** (cột "Cách verify" của AC mà task gánh; vd `cargo test <mod>`, `npm test`, `<lint> <file>`). Đây là GATE — engine chạy đúng các lệnh này, `engine_advance` từ chối task chưa verify pass.
- Smallest-first (wave độc lập trước, wave phụ thuộc sau — khớp `depends:` trong PLAN).

> `engine_plan` ghi plan vào durable state; nếu phase đã có plan engine (resume) → dùng `engine_status` xem còn task nào pending thay vì plan lại từ đầu.

## Bước 2 — Loop `engine_next → engine_verify → engine_advance` mỗi task

Lặp tới khi `engine_next` báo done (mọi task done/blocked):

1. **`engine_next`** → task kế + context scoped. Hiểu TRƯỚC khi sửa (R10: `codegraph callers/impact` + `git log/blame` + `su-code/DECISIONS.md`).
2. **Code task ở đúng size:**
   - **Wave ≥ `config.workflow.min_parallel_tasks` task độc lập + khác file + `parallelization === true`** → spawn `task` subagent ĐỒNG THỜI (1 message, nhiều tool-call), `agent: task` (executor). Mỗi agent **1 file/folder RIÊNG**. Prompt mỗi agent BẮT BUỘC nhúng (subagent KHÔNG đọc được CONTEXT/config/skill):
     1. Task cụ thể + file được phép sửa + "chỉ làm task này".
     2. **UC literal** task phục vụ (copy mô tả UC + phạm vi "trong phase này làm gì").
     3. **AC literal** task gánh (copy nguyên văn Given/When/Then từ CONTEXT → đích đo được).
     4. **Decisions liên quan** từ CONTEXT (chỉ cái chạm task, copy literal — KHÔNG ghi "theo D4").
     5. **Skill (cột `[skill:]`) — 2 lớp:** (a) nhúng literal luật cốt lõi + anti-pattern skill; (b) ra lệnh agent Read `su-code/skills/<skill>/SKILL.md` (hoặc `~/.omp/skills/<skill>/SKILL.md`) TRƯỚC khi code.
     6. Convention: `AGENTS.md` + `su-code/DECISIONS.md`/`PREFERENCES.md` liên quan.
     7. Ground-truth cần thiết (schema/symbol thật từ research) nếu task đụng DB/code có sẵn.
     8. **R10 literal**: "Trước khi sửa file, dùng `codegraph query/callers/impact \"<symbol|file>\"` (CLI) (cbm/serena nếu đã bật) xem source + call path + blast radius — KHÔNG grep/Read tràn lan. Chỉ Read khi sắp sửa. Output dài (>50 dòng) sắp đưa vào báo cáo cuối → `mcp__headroom_compress` trước, không dump thô."
   - **Wave nhỏ (< ngưỡng) / task phụ thuộc / `parallelization === false`** → code thẳng ở main thread, tuần tự. Ưu tiên serena `replace_symbol_body` symbol-level (activate qua `search_tool_bm25` nếu chưa có trong tool list) thay vì rewrite cả file.
3. **`engine_verify {taskId}`** — gate chạy đúng `verify` của task. FAILED → sửa NGUYÊN NHÂN rồi verify lại với 1 fix KHÁC (2 fail giống nhau = warn, 3 = engine BLOCK task sớm — doom-loop guard). BLOCKED → ghi `failure:` vào `su-code/KNOWLEDGE.md`, chuyển task unblocked kế hoặc escalate.
4. **`engine_advance {taskId, commit:true}`** — engine từ chối nếu `engine_verify` chưa pass (self-report "xong" KHÔNG phải tín hiệu dừng); gitleaks clean. Message Conventional Commits (R8): `<type>: M<x> - T<n> <English desc>`, no AI ref. KHÔNG `git push`.
5. **Bookkeeping skill-side (engine KHÔNG quản):**
   - Append `su-code/planning/<slug>/STATE.md` `## Log`: `- DATE M<x> T<n> ✓ <việc> [file] (<hash ngắn>)`.
   - Tick checkbox task trong `M<x>-NN-PLAN.md` (`[ ]` → `[x]`).
   - Cập nhật STATE `Current Position` + `next_action` = task kế.
6. **Guardrail R6**: việc đang làm phải thuộc `active_phase`. Lệch ROADMAP/Decision → DỪNG, hỏi user (auto: SKIP + NEEDS-CONFIRM).

> **Isolate slice rủi ro/lớn** bằng **`engine_worktree`** (open → work → merge squash → remove) — tránh nửa chừng làm bẩn nhánh chính.

## Commit per-task (R8) — qua engine

Commit atomic **mỗi task xong** bằng `engine_advance {commit:true}` (không gom, không `/commit` thủ công). Luật:
- **Verify-gate trước commit**: engine chỉ commit sau khi `engine_verify` pass — enforce trong code.
- **Branch**: mặc định nhánh hiện tại (commit local checkpoint). Nếu user chọn feature branch → verify `git branch --show-current` khớp `STATE.branch` trước khi commit; lệch → DỪNG.
- **Message tiếng Anh**, milestone/task ở đầu: `feat: M2 - T1 sync group-info onto the group record`. `type` ∈ feat/fix/docs/refactor. KHÔNG `[<Category>]` prefix, no AI ref.
- **KHÔNG `git push` / PR** trừ khi user yêu cầu. Ghi commit hash vào STATE.Log để `ship`/revert truy ngược.
- Task hỏng giữa chừng: KHÔNG commit task dở. `engine_verify` fail → không advance; sửa xong mới advance, hoặc revert file task đó.

## `--auto` (autonomous) — cùng loop, không user-gate

`/feature go --auto` = đúng loop trên chạy tự động (mirror kỷ luật `/auto` trong `assets/commands/auto.md`), **scoped 1 phase**, dừng ở ranh giới phase kế:
- Không yield giữa các task; chạy hết `engine_next/verify/advance` của phase.
- Task block (dữ liệu/môi trường subagent+repo+DB bó tay) → SKIP + ghi NEEDS-CONFIRM vào VERIFICATION/STATE, làm task khác. Không stall cả phase.
- Ranh giới an toàn: KHÔNG push/merge ra ngoài, KHÔNG xoá data, KHÔNG gọi API production gửi tin thật — trừ khi user đã duyệt ở plan. Chi tiết: `references/auto.md`.

## Khi hết task của phase

- STATE: `status: executing` → sẵn sàng verify. `next_action: ship-phase`.
- **Self-check nhanh**: mọi UC trong Requirement scope có code/task phủ; mọi AC trong CONTEXT đã có code thỏa (chưa cần test sâu — đó là việc ship). UC/AC nào chưa task nào chạm → thiếu code, làm nốt trước khi ship.
- KHÔNG tự review/test sâu ở đây — đó là việc `/feature ship` (verify từng AC → VERIFICATION matrix).

Next: `/feature ship`.
