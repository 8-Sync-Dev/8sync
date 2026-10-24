---
name: feature
disable-model-invocation: true
description: "Quản lý feature LỚN nhiều phase, nhiều ngày, xuyên session (>10 file, nhiều milestone) theo nguyên lý GSD. State sống ở su-code/planning/<slug>/ (PROJECT/REQUIREMENTS/ROADMAP/STATE) + ACTIVE switch giữa nhiều feature. Việc nhỏ/bug/1-concern (≤10 file, 1 pass) dùng /auto (lái engine trực tiếp)."
---

# Feature Skill — GSD cho feature lớn

> Chống "đi 1 nẻo": tổng thể + vị trí lưu ở FILE (`su-code/planning/<slug>/`), không ở context tạm.
> Mỗi feature lớn = 1 folder. Loop phase: Discuss → Plan → Execute → Verify → Ship.
> Execute KHÔNG tự dựng engine riêng — nó FEED engine `engine_*` có sẵn của su-code (verify-gate, doom-loop guard, worktree đã enforce trong code).

## Usage

```
/feature new <slug>     -> Scaffold su-code/planning/<slug>/ + 4 file + set ACTIVE. Điền → user duyệt.
/feature plan           -> Discuss + Plan phase hiện tại (fan-out research) -> M<x>-CONTEXT + M<x>-NN-PLAN.md
/feature go             -> Execute phase: feed PLAN vào engine_plan → loop engine_next/verify/advance
/feature ship           -> Verify (review multi-lens + test) BÁM AC -> M<x>-VERIFICATION + tick ROADMAP + archive
/feature status         -> In STATE.md hiện tại
/feature switch <slug>  -> Đổi feature active (ghi ACTIVE.md + config.active_feature)

/feature --auto         -> AUTONOMOUS: chạy TRỌN 1 phase (plan→go) không hỏi user, dừng ở ranh giới phase kế.
                           Auto-discuss qua task subagent thay ask; block thì skip+ghi NEEDS-CONFIRM+code nốt.
                           Có thể kèm subcommand: `/feature plan --auto`, `/feature go --auto`.
```

> **Deterministic ops cũng có ở verb `8sync feature`** (nhanh, không cần model): `8sync feature new|switch|status|list`.
> Còn `plan`/`go`/`ship` cần model phán đoán → chạy trong 1 session omp qua `/feature`.

## Dispatch (đọc STATE → biết đang đâu)

BẮT BUỘC trước mọi subcommand (trừ `new`) — đọc 3 file vào context NGAY đầu lệnh:
1. Đọc `su-code/planning/ACTIVE.md` dòng đầu (không comment, không blank) → slug active. Trống → báo user chạy `/feature new` hoặc `/feature switch`.
2. Đọc `su-code/planning/<slug>/STATE.md` → frontmatter `active_phase`, `status`, `next_action`, `ticket`, `branch` (ticket/branch có thể trống — không sao).
3. Đọc `su-code/planning/config.json` → giữ trong context cả lệnh: `workflow.*` (parallelization, min_parallel_tasks, review_dimensions, plan_review, code_review, verifier), `paths.*` (planning_root, archive). Thiếu key → dùng default rồi cảnh báo user.
4. **Load `references/feature-rules.md` NGAY** (luật xuyên suốt mọi subcommand: R1 resolve config→literal, R3 2-lớp load skill, R5 AC discipline, R6 guardrail, R7 codebase anchor, R8 commit, R10 code-intelligence FIRST). Reference từng subcommand chỉ thêm bước RIÊNG, KHÔNG lặp luật này.
5. Dispatch theo bảng:

| Subcommand | Load reference | Khi nào hợp lệ |
|-----------|----------------|----------------|
| `new` | `references/new.md` | luôn |
| `plan` | `references/plan.md` | phase chưa có PLAN, hoặc cần re-plan |
| `go` | `references/execute.md` | phase đã có PLAN (status=executing/planned) |
| `ship` | `references/ship.md` | phase code xong (status=executing, plan tasks done) |
| `status` | — (in STATE trực tiếp) | luôn |
| `switch` | sửa ACTIVE.md dòng đầu + config.active_feature | luôn |

Nếu user gõ `/feature` không subcommand → đọc STATE → đề xuất next theo `next_action`.

### ⚡ Cờ `--auto` (autonomous mode) — check NGAY khi parse lệnh

Nếu args chứa `--auto` (dù có/không subcommand) → **BẮT BUỘC load `references/auto.md` TRƯỚC** rồi mới dispatch. Auto-mode đổi hành vi của `plan` + `go`:
- **KHÔNG dùng `ask`** cho điểm-quyết-định triển khai → thay bằng spawn `task` subagent (`agent: explore` / `agent: plan` / `agent: task`) đóng vai discuss + tự quyết theo ràng buộc PROJECT/REQUIREMENTS. Tự tra repo/DB trước khi coi là "phải hỏi".
- **KHÔNG dừng ở user-gate** (gate 2 plan, gate cuối go) → tự duyệt (plan-review thay vai gate chất lượng) rồi chạy tiếp.
- **Block** (thiếu credential/môi trường/dữ liệu thật subagent không tra được) → SKIP item đó, ghi NEEDS-CONFIRM vào VERIFICATION/STATE, **code nốt phần còn lại của phase**. Không stall cả phase vì 1 item.
- **1 lệnh `--auto` = chạy TRỌN 1 phase**: `plan` (nếu chưa có PLAN) → `go` (code hết wave qua engine) → self-check AC. Dừng ở ranh giới phase kế (không tự nhảy phase sau trừ khi user nói "code hết các phase").
- Chỉ escalate user thật sự khi: hành động không đảo được/outward-facing (push, xoá data, gọi API production).

Chi tiết luật + cách spawn subagent discuss: `references/auto.md`.

## Phân biệt với `/auto` (QUAN TRỌNG)

| Loại việc | Dùng | State ở |
|-----------|------|---------|
| Nhỏ/bug/1-concern (≤10 file, 1 pass, đường đi rõ) | **`/auto`** (lái `engine_*` trực tiếp) | `su-code/STATE.md` (spine session) |
| **Feature LỚN** (nhiều domain, nhiều phase, nhiều ngày, xuyên session) | **`/feature`** (skill này) | `su-code/planning/<slug>/` + ACTIVE switch |

> `/feature` KHÔNG thay `/auto` — nó ngồi TRÊN engine: quản ROADMAP nhiều phase + hợp đồng AC + switch giữa nhiều feature; khi `go`, mỗi phase được FEED vào chính engine mà `/auto` lái.

## Quy ước cốt lõi

- **Phase** = mảng nghiệp vụ, đặt tên `M<n>-<slug>` (M0-foundation, M1-ket-ban...).
- **Plan** = batch task trong 1 phase: `M<x>-NN-PLAN.md`.
- **STATE.md < 100 dòng** — digest, không archive. Frontmatter ràng buộc: `---` đầu file · không comment trong `progress:` · `next_phases` single-line.
- **Cập nhật:** task xong → STATE.Log + next_action · phase xong → ROADMAP tick + STATE.progress · feature xong → `su-code/KNOWLEDGE.md` + `su-code/DECISIONS.md`.
- **Parallel:** `config.workflow.parallelization === false` → TẮT mọi swarm, chạy tuần tự main thread (debug/máy yếu). Khi `true`: việc độc lập + khác file + ≥`config.workflow.min_parallel_tasks` → spawn `task` subagent đồng thời; dưới ngưỡng → main thread.
- **Commit:** commit **atomic mỗi task xong** qua `engine_advance {commit:true}` trong `go` (verify-gate enforce trước). Conventional Commits, tiếng Anh, `<type>: M<x> - T<n> <desc>`, no AI ref. Feature branch + ticket là **TUỲ CHỌN** (STATE `branch`/`ticket` có thể trống). **KHÔNG `git push`/PR trừ khi user yêu cầu**. Chi tiết: `references/execute.md` §Commit + R8.
- **Model:** su-code sở hữu chọn model qua `~/.config/8sync/models.toml` (xem/sửa: `8sync harness model`) + role của `task` subagent. Skill NEVER hardcode tên model; chỉ chọn `agent: <role>` (explore/plan/reviewer/Tester/task) đúng vai.

## Neo vào codebase (brownfield) — R7

- Tổng thể dự án: `AGENTS.md` + `su-code/PROJECT.md` — KHÔNG mô tả lại.
- Nghiệp vụ/kiến trúc module: `su-code/KNOWLEDGE.md` + `trail ask` — đọc/tra trước khi code.
- Convention + quyết định: `AGENTS.md` + `su-code/DECISIONS.md` + `su-code/PREFERENCES.md`.
- Project-local skill: `su-code/skills/<name>/SKILL.md`; global: `~/.omp/skills/<name>/SKILL.md`.

## Flow chuẩn 1 feature

```
/feature new zalo-group    -> điền 4 file (neo AGENTS.md + su-code/) -> USER DUYỆT (gate 1)
mỗi phase:
  /feature plan            -> Discuss + Goal/AC (UAT) + Plan (task↔AC) -> USER DUYỆT plan (gate 2)
  /feature go              -> feed PLAN → engine_plan/next/verify/advance -> append STATE mỗi task
  /feature ship            -> review+test BÁM AC -> M<x>-VERIFICATION (AC matrix) -> tick ROADMAP
lặp tới phase cuối -> ship (phase cuối) -> update su-code/KNOWLEDGE.md + DECISIONS.md + archive
```

> **Mỗi phase BẮT BUỘC có Requirement scope + Goal + Acceptance Criteria (AC-NN, đo được) trong `M<x>-CONTEXT.md`.** Requirement scope map từ `REQUIREMENTS.md` UC; AC = hợp đồng nghiệm thu: `plan` viết, `go` code bám (verify của mỗi engine task = lint/test/build thật), `ship` review+test verify từng UC/AC → `M<x>-VERIFICATION.md`. Phase done ⇔ mọi UC/AC PASS. KHÔNG dùng "DoD" mơ hồ.

Đọc `references/<subcommand>.md` để biết chi tiết từng bước.
