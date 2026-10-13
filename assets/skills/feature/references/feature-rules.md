# feature-rules — Luật xuyên suốt MỌI subcommand

> **Load FILE NÀY ĐẦU TIÊN ở mọi subcommand** (`new`/`plan`/`go`/`ship`/`--auto`), TRƯỚC khi làm việc. Với subcommand khác `new`: đọc ACTIVE+STATE+config trước rồi load file này. Riêng `new`: chưa có ACTIVE/STATE thì đọc config nếu có, load file này, rồi scaffold ACTIVE/STATE.
> Đây là "hợp đồng luôn áp" — gom các luật rải rác trong SKILL.md và từng reference. Reference khác chỉ thêm bước RIÊNG của subcommand, KHÔNG lặp lại luật ở đây.
>
> **Đã lược cho su-code (repo-agnostic):** R2 (routing model 4-slot của Claude-Code), R4 (audit brace ngôn ngữ cụ thể), R9 (cập nhật ticket quản-lý-dự-án ngoài), R11 (comment convention gắn ticket-ID) đã bị BỎ HẲN — chúng gắn chặt vào 1 repo/1 ngôn ngữ và không portable. R-number của các luật còn lại GIỮ NGUYÊN để cross-reference cũ vẫn resolve.

## R1 — config.X là chỉ thị cho ORCHESTRATOR, resolve về literal trước khi dùng

`config.X` (đọc từ `su-code/planning/config.json`) là tham số cho orchestrator (main thread), **KHÔNG phải chuỗi đưa cho subagent**. Subagent KHÔNG đọc được config.json và KHÔNG kế thừa context — nó chỉ thấy prompt bạn soạn. Vì vậy:
- **Vai/role** → orchestrator tự chọn `agent: <role>` khi spawn `task` (explore/plan/reviewer/Tester/task). Subagent không cần biết role của chính nó; model do omp chọn qua `~/.config/8sync/models.toml`.
- **Tham số nội dung** (workflow.review_dimensions, tier, convention, ticket…) → nhúng **giá trị thật** vào prompt (vd "review dimension: security"). TUYỆT ĐỐI không viết chữ `config.workflow.review_dimensions` vào prompt subagent.
- Thiếu key → dùng default rồi cảnh báo user.

## R3 — Load skill repo theo cột [skill:] (2 lớp, BẮT BUỘC)

Subagent KHÔNG tự biết skill nào áp dụng và KHÔNG đọc được session context. Với MỖI skill ghi ở cột `[skill:]` của task:
1. **Orchestrator đọc `su-code/skills/<skill>/SKILL.md`** (project-local) hoặc `~/.omp/skills/<skill>/SKILL.md` (global) + references liên quan TRƯỚC khi code/spawn — KHÔNG mirror file có sẵn rồi suy đoán convention (mirror dễ trật; chỉ đọc SKILL.md mới biết anti-pattern thật).
2. **Khi spawn**, prompt subagent phải: (a) nhúng **literal luật cốt lõi + anti-pattern** của skill; (b) ra lệnh subagent **Read `su-code/skills/<skill>/SKILL.md` (hoặc `~/.omp/skills/<skill>/SKILL.md`) TRƯỚC khi code** và tuân theo. Hai lớp bù nhau.

Task ghi `[skill: —]` mà vẫn là task code → DỪNG, xác minh thật sự không skill nào chi phối (đa số task code có ≥1 skill).

## R5 — AC là hợp đồng nghiệm thu xuyên phase

Mỗi phase có 🎯 Goal + ✅ Acceptance Criteria (AC-NN, đo được) trong `M<x>-CONTEXT.md`. AC là nguồn chân lý: `plan` viết, `go` code bám, `ship` verify từng AC → `M<x>-VERIFICATION.md`. Phase done ⇔ MỌI AC PASS. Mọi AC PHẢI map về ≥1 UC trong `REQUIREMENTS.md`; mọi task PLAN truy được về ≥1 AC + ≥1 UC; mọi AC có ≥1 task thỏa. KHÔNG dùng "DoD" mơ hồ.

## R6 — Guardrail chống "đi 1 nẻo"

- Việc đang code phải thuộc `active_phase`. Lệch ra ngoài ROADMAP → DỪNG, hỏi user (auto-mode: SKIP+NEEDS-CONFIRM).
- Lệch Decision trong CONTEXT → DỪNG (như lệch ROADMAP).
- STATE.md < 100 dòng, digest không archive. Cập nhật: task xong → STATE.Log + next_action; phase xong → ROADMAP tick + progress.
- Traceability bắt buộc: `REQUIREMENTS.md` UC → `M<x>-CONTEXT.md` Requirement scope → AC-NN → PLAN task → go prompt → `M<x>-VERIFICATION.md`. Code task mà không biết UC nào đang phục vụ = DỪNG, bổ sung trace trước.

## R7 — Neo vào codebase (brownfield)

- Tổng thể: `AGENTS.md` + `su-code/PROJECT.md` — KHÔNG mô tả lại.
- Nghiệp vụ/kiến trúc: `su-code/KNOWLEDGE.md` + codegraph — tra trước khi code module.
- Convention + quyết định: `AGENTS.md` + `su-code/DECISIONS.md` + `su-code/PREFERENCES.md`.
- Không mô tả lại thứ đã có trong các nguồn trên; trích dẫn (vd "theo `su-code/DECISIONS.md` đã chốt X").

## R8 — Commit model riêng của feature

Commit **atomic mỗi task xong** trong `go`, qua `engine_advance {commit:true}` (engine chỉ commit sau khi `engine_verify` pass — verify-gate enforce trong code; self-report "xong" KHÔNG phải tín hiệu dừng). Message theo Conventional Commits, **tiếng Anh**, milestone/task ở ĐẦU: `<type>: M<x> - T<n> <English description>` (`type` ∈ feat/fix/docs/refactor; KHÔNG `[<Category>]` prefix), no AI ref.
- **Feature branch + ticket là TUỲ CHỌN** (`STATE.branch`/`STATE.ticket` có thể trống — KHÔNG ép tạo nhánh/ticket ở `new`). Nếu user muốn 1 feature branch lớn → verify `git branch --show-current` khớp `STATE.branch` trước khi commit.
- **KHÔNG `git push` / mở PR** trừ khi user yêu cầu rõ (convention su-code). Commit local làm checkpoint.
- Ghi commit hash vào STATE.Log dòng task để `ship`/revert truy ngược.

## R10 — Code-intelligence FIRST (mọi lookup code, ÁP DỤNG CẢ SUBAGENT — bắt buộc, không tuỳ chọn)

Mọi thao tác TÌM/HIỂU/ĐỊNH VỊ code (không phải sắp EDIT ngay) → dùng code-intelligence engine TRƯỚC grep/Read thô, theo đúng RULE #0 (`~/.omp/agent/APPEND_SYSTEM.md`). Áp dụng cho **CẢ main thread LẪN MỌI subagent** (`explore` ở `plan.md` Step 2, `task` executor ở `execute.md`, `reviewer`/`Tester` ở `ship.md`, discuss subagent ở `auto.md`). Ưu tiên:

1. **codegraph** (local graph, CLI) — `codegraph query/explore/node/callers/callees/impact "<symbol|query>"`: source + call path + blast radius. Skill: `~/.omp/skills/codegraph/SKILL.md`.
2. **codebase-memory-mcp** / **serena** — OPT-IN, mặc định TẮT (`8sync harness cbm|serena on`); chỉ dùng `mcp__codebase_memory_mcp_*` / `mcp__serena_*` nếu thực sự có trong tool list, không thì codegraph. Chỉ `Read` raw file khi SẮP SỬA nó (read-before-edit) — KHÔNG dùng Read/grep để survey; tool của server khác/mới → `search_tool_bm25`.
3. **Nén những gì BẠN phát lại:** báo cáo/subagent prompt/nội dung dài sắp re-emit → `mcp__headroom_compress` (60–95% ít token). omp tự spill output quá dài ra artifact — KHÔNG paste lại blob đã spill.

**Subagent KHÔNG tự biết luật này** (không đọc APPEND_SYSTEM, không kế thừa session context — chỉ thấy prompt bạn soạn, giống R3). Khi spawn BẤT KỲ subagent nào cần tìm/hiểu code, prompt BẮT BUỘC nhúng 2 lớp:
- (a) **Chỉ thị literal**: "Dùng `codegraph query/explore/callers/impact \"<query>\"` (CLI) (hoặc cbm/serena nếu đã bật) để tìm/hiểu/định vị code TRƯỚC — KHÔNG grep/Read thô để khảo sát. Chỉ Read file khi sắp sửa đổi nó. Kết quả dài (>50 dòng) sắp đưa vào báo cáo cuối → nén qua `mcp__headroom_compress`, không dump thô."
- (b) Nếu subagent type có quyền đọc skill (đa số có tool Read) → thêm: "Đọc `~/.omp/skills/codegraph/SKILL.md` nếu cần chi tiết cách dùng."

Vi phạm (subagent grep/Read tràn lan để survey thay vì code-intel, hoặc dump log thô >50 dòng vào báo cáo) = lệch quy tắc dự án, không phải style nit — sửa ngay khi phát hiện, không đợi review pass mới bắt.
