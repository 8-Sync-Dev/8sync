# /feature plan

> Đã load `references/feature-rules.md` (luật xuyên suốt: R1 config-resolve, R3 load skill, R5 AC, R10 code-intel FIRST) ở Dispatch chưa? Nếu chưa → load trước.

Discuss + Plan cho phase hiện tại (`active_phase` trong STATE). Output: `M<x>-CONTEXT.md` + `M<x>-NN-PLAN.md` trong `su-code/planning/<slug>/phases/M<x>-<name>/`.

## Step 1 — Discuss (chốt quyết định TRƯỚC khi plan)

- Đọc PROJECT.md (ràng buộc) + ROADMAP.md (contract phase này) + REQUIREMENTS.md (UC của phase).
- Trích **Requirement scope** cho phase: liệt kê UC-ID + mô tả từ REQUIREMENTS.md mà phase này chịu trách nhiệm; nếu ROADMAP và REQUIREMENTS lệch phase/UC → sửa/hỏi trước khi plan.
- Đọc knowledge liên quan: `su-code/KNOWLEDGE.md` + (R10) `trail ask` cho module sẽ đụng.
- Chốt quyết định triển khai mơ hồ (API nào, schema, pattern). Mơ hồ → dùng `ask` (tương tác). Auto-mode: thay `ask` bằng spawn `task` discuss (xem `auto.md`).
- Ghi `su-code/planning/<slug>/phases/M<x>-<name>/M<x>-CONTEXT.md`: quyết định riêng phase + Requirement scope (dùng `templates/M-CONTEXT.md`).
- Append quyết định lớn vào STATE.Decisions + PROJECT Key Decisions table.

### ★ BẮT BUỘC: Goal + Acceptance Criteria (UAT) trong CONTEXT — KHÔNG được bỏ

Mỗi `M<x>-CONTEXT.md` PHẢI có 3 mục dưới TRƯỚC khi plan. Đây là **hợp đồng nghiệm thu** mà `/feature go` và `/feature ship` đọc làm chuẩn — thiếu thì subagent code/review/test không biết đang phục vụ phần nào của REQUIREMENTS.

1. **📌 Requirement scope** — bảng UC-ID từ `REQUIREMENTS.md` mà phase này làm, mỗi dòng:
   - **UC**: id đúng như REQUIREMENTS.md (vd UC-15).
   - **Mô tả**: copy/rút gọn literal từ REQUIREMENTS.md.
   - **Trong phase này làm gì**: phạm vi cụ thể của UC ở phase này.
   - **Không làm ở phase này**: ranh giới nếu UC còn phần future/out-of-scope.
2. **🎯 Goal** — 1 câu: output đo được của phase + ranh giới (CHƯA làm gì → tránh review đòi hỏi quá phạm vi).
3. **✅ Acceptance Criteria (UAT)** — bảng `AC-NN`, mỗi dòng:
   - **Given/When/Then** điều kiện PASS **đo được** (số, trạng thái, output cụ thể — KHÔNG "chạy ổn", "đúng").
   - **UC**: UC-ID từ Requirement scope mà AC này chứng minh (vd UC-15).
   - **Cách verify**: lệnh/SQL/script/thao tác cụ thể để chứng minh (đây cũng là `verify` của engine task ở `go`).
   - **Tier**: must-test / verify-sql / verify-only.
   - **Task nguồn**: AC này do task nào trong PLAN thỏa.
   - AC phải phủ HẾT Goal + map về contract export (ROADMAP). Mỗi UC của phase ⇒ ≥1 AC.
4. Cuối mục ghi: **"Phase DONE khi mọi AC PASS, ghi ở M<x>-VERIFICATION.md. AC FAIL → không ship."**

> Template Requirement scope: `| UC | Mô tả REQUIREMENTS.md | Trong phase này làm gì | Không làm ở phase này |`
> Template AC: `| AC-01 | UC-15 | GIVEN <tiền đề> WHEN <hành động> THEN <kết quả đo được> | <cách verify> | <tier> | <task> |`
> Mọi task trong PLAN (Step 3) phải truy được về ≥1 AC và ≥1 UC. AC không có task thỏa = thiếu task; task không gắn UC = không biết phục vụ phần nào của REQUIREMENTS.

## Step 2 — Research (FAN-OUT song song nếu cần)

**Áp dụng R10 (code-intelligence FIRST) — kể cả khi tự research ở main thread lẫn khi spawn subagent.**

Nếu phase cần khảo nhiều mặt codebase (và `config.workflow.parallelization === true`):
- Spawn ĐỒNG THỜI nhiều `task` subagent `agent: explore` (1 message, nhiều tool-call) — mỗi agent 1 khía cạnh:
  - "tìm pattern <X> trong codebase"
  - "schema/migration module tương tự"
  - "module tham khảo đã làm <Y>"
- **Prompt mỗi subagent nhúng chỉ thị R10 literal**: dùng `trail ask "<query>"` / `trail callers <symbol>` (CLI) để tìm/hiểu code TRƯỚC grep/Read thô; chỉ Read khi cần xem chi tiết 1 file cụ thể đã định vị; kết quả dài (>50 dòng) sắp đưa vào báo cáo cuối → `mcp__headroom_compress` trước, không dump thô.
- Barrier → tổng hợp ở main thread.
- Phase nhỏ/pattern đã rõ, hoặc `parallelization === false` → skip, không spawn (chạy tuần tự main thread).

## Step 3 — Plan (decompose + phân wave)

Tạo `M<x>-NN-PLAN.md` (NN bắt đầu 01, dùng `templates/M-PLAN.md`). BẮT BUỘC mỗi task có:
- **file ownership**: đụng file/folder nào (để biết parallel an toàn).
- **wave**: nhóm độc lập (song song được) vs nhóm phụ thuộc (chờ). → sẽ map thành slices/tasks của `engine_plan` ở `go`.
- **test tier**: must-test / verify-sql / verify-only.
- **skill**: skill repo nào chi phối task (`su-code/skills/<name>` hoặc `~/.omp/skills/<name>`). BẮT BUỘC — subagent KHÔNG tự biết skill nào áp dụng; cột này là nguồn để `go` resolve. Task không rõ skill → ghi `—` nhưng tự hỏi đã đúng chưa (đa số task code có ≥1 skill chi phối). Sai/thiếu skill = nguồn lỗi "code đúng task nhưng sai convention".
- **UC phục vụ**: task này phục vụ UC-ID nào trong `REQUIREMENTS.md`/Requirement scope (vd UC-15).
- **AC thỏa**: task này thỏa AC-NN nào (truy ngược về CONTEXT). Mọi AC phải có ≥1 task thỏa; task không gắn AC/UC nào = nghi vấn thừa, soát lại.

Template PLAN:
```markdown
# M<x>-NN-PLAN — <phase name>
## Wave 1 (song song — độc lập, khác file)
- [ ] T1: <việc>   [file: path]   [skill: <name>]   [tier: ...]   [UC: UC-15]   [AC: AC-01,AC-03]
- [ ] T2: <việc>   [file: path]   [skill: <name>]   [tier: ...]   [UC: UC-16]   [AC: AC-05]
## Wave 2 (cần Wave 1)
- [ ] T3: <việc>   [file: path]   [skill: <name>]   [depends: T1]  [UC: UC-15]  [AC: AC-08]
## Checkpoints / Gates
- review dimensions: <từ config.workflow.review_dimensions>
- **Acceptance**: phase done ⇔ mọi AC trong M<x>-CONTEXT PASS (verify ở /feature ship → M<x>-VERIFICATION.md). KHÔNG dùng DoD mơ hồ — dùng AC.
- engine mapping: mỗi task ↔ 1 engine task; `verify` = lint/test/build THẬT (cột "Cách verify" của AC).
```

Quy tắc parallel: chỉ đánh cùng wave khi **độc lập + khác file**. Vi phạm → race/sai. <`min_parallel_tasks` task độc lập → 1 wave tuần tự cũng được.

**Kiểm tra phủ UC/AC trước khi trình:** mọi UC trong Requirement scope đều có ≥1 AC; mọi AC-NN trong CONTEXT đều xuất hiện ở cột [AC:] của ≥1 task; mọi task có `[UC:]` + `[AC:]`. Thiếu UC/AC nào không task thỏa → thêm task (hoặc UC/AC sai phạm vi → sửa CONTEXT).

## Step 3.5 — Plan-review (gate theo `config.workflow.plan_review`)

Soát PLAN TRƯỚC khi code — bắt lỗi cấp-kế-hoạch (AC hở, wave race, thiếu skill) rẻ hơn bắt sau khi đã code. Đọc `config.workflow.plan_review`:

| Giá trị | Khi nào chạy review |
|---------|---------------------|
| `always` | luôn review PLAN |
| `complex` (mặc định khuyến nghị) | chỉ review khi phase **phức tạp**: ≥`config.workflow.min_parallel_tasks` task, HOẶC nhiều wave phụ thuộc, HOẶC chạm ≥2 module/domain, HOẶC có task DB/migration/schema. Phase nhỏ 1 wave đơn giản → BỎ. |
| `never` / thiếu | BỎ Step này. |

Khi chạy: spawn 1 `task` subagent `agent: reviewer` review **bản PLAN + bảng AC** (không phải code — chưa có code). Prompt nhúng literal: Goal + bảng AC + PLAN, yêu cầu soát:
- **Phủ UC/AC**: mọi UC trong Requirement scope có ≥1 AC? Mọi AC-NN có ≥1 task thỏa? Task nào không gắn UC/AC (nghi thừa)?
- **Wave an toàn**: task cùng wave có thật sự độc lập + khác file? (race risk)
- **Skill đúng**: cột `[skill:]` hợp lý? Task code mà `[skill: —]` → cờ đỏ.
- **Thiếu task**: Goal/contract ROADMAP có phần nào chưa task nào phủ?
- "Trả về findings cụ thể (PLAN dòng nào) + 1 verdict: READY / NEEDS-FIX. KHÔNG hỏi lại."

Có NEEDS-FIX → sửa PLAN/CONTEXT (main thread) → ghi tóm tắt vào `M<x>-CONTEXT.md` (mục Plan-review notes) → tiếp Step 4. Không loop vô hạn: tối đa 2 vòng, còn lỗi thì nêu ở gate 2 cho user quyết.

> Auto-mode: plan-review chạy **THAY** gate 2 (xem `auto.md`) — verdict READY thì tự duyệt; NEEDS-FIX thì sửa rồi tự duyệt, ghi `(auto-decided)`.

## Step 4 — USER DUYỆT plan (gate 2)

Trình **Goal + bảng AC + PLAN** (AC là phần user nghiệm thu — nêu rõ để user soát tiêu chí đúng ý) + tóm tắt verdict plan-review (Step 3.5) nếu có chạy. Dùng `ask` xác nhận trước khi code. Cập nhật STATE:
- `status: planned`, `next_action: execute-phase`.
- ROADMAP: phase `[ ]` → `[~]`.

Next: `/feature go`.
