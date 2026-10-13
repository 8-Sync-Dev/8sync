# /feature ship

> Đã load `references/feature-rules.md` (R1 config-resolve, R5 AC nghiệm thu, **R10 code-intelligence FIRST — áp dụng cả reviewer/tester subagent**) ở Dispatch chưa? Nếu chưa → load trước.

Verify (review + test) → close phase → archive khi hết feature → cập nhật bản đồ. = GSD Verify + Ship.
Gate: review/test FAIL → fix → re-run. KHÔNG ship khi fail.

## Step 0 — Load hợp đồng nghiệm thu (BẮT BUỘC trước review/test)

Đọc `M<x>-CONTEXT.md` → **📌 Requirement scope (UC từ REQUIREMENTS.md) + 🎯 Goal + bảng ✅ Acceptance Criteria (AC-NN)**. Chuẩn nghiệm thu phase.
- Requirement scope + AC là **nguồn chân lý** cho cả Step 1 (review) lẫn Step 2 (test): mọi reviewer/tester nhận **UC literal + bảng AC literal** trong prompt + verify ĐÚNG từng UC/AC liên quan. Subagent KHÔNG tự đặt tiêu chí ngoài AC; cũng KHÔNG đòi hỏi vượt Goal (ranh giới phase).
- CONTEXT thiếu Goal/AC → DỪNG, quay lại `/feature plan` bổ sung (không nghiệm thu mò).
- Đầu ra cuối: `M<x>-VERIFICATION.md` (dùng `templates/M-VERIFICATION.md`) có **bảng AC → verdict** (mỗi AC: PASS/FAIL + bằng chứng cụ thể). Phase done ⇔ MỌI AC PASS.

## Step 1 — Review (FAN-OUT multi-lens song song)

**Gate:** `config.workflow.code_review === false` → BỎ Step 1, ghi STATE Log "review skipped per config" + cảnh báo user "review tắt theo config — chất lượng tự chịu". Ngược lại (`true`/thiếu) → chạy review:

Spawn ĐỒNG THỜI `task` subagent `agent: reviewer`. Số agent = số phần tử `config.workflow.review_dimensions`; nhúng **tên dimension thật** vào prompt mỗi agent (vd "dimension: security"), KHÔNG ghi chữ `config.workflow.review_dimensions` vào prompt. Dimension mặc định (`["security","correctness","convention"]`):
- **security**: injection (query tham số hoá?), XSS/escape output, CSRF/permission check, type cast, secret leak.
- **correctness**: symbol/method tồn tại (`codegraph query`), logic, runtime, config key/DB column đúng.
- **convention**: `AGENTS.md` + `su-code/DECISIONS.md`/`PREFERENCES.md`, naming, tách file, error-handling.

Scope = file phase này đụng (từ PLAN). Barrier → gộp findings.
Có lỗi → fix (main thread hoặc spawn) → re-review tới sạch. Phase nhỏ → 1 reviewer tổng hợp cũng được.

**Nhúng UC + AC vào prompt reviewer:** mỗi prompt kèm Requirement scope + bảng AC literal (từ Step 0) + yêu cầu: "Ngoài lens <dimension>, soát code có thỏa đúng UC/AC thuộc lens này không (vd security lens ↔ AC nào về permission/inject); báo UC/AC nào code KHÔNG thỏa kèm `file:line`." Reviewer trả findings gắn UC-ID/AC-NN khi liên quan. Nhúng R10 literal (dùng code-intel định vị, `mcp__headroom_compress` cho output dài trước khi vào báo cáo).

## Step 2 — Test (theo tier, fan-out per-component nếu nhiều)

**Gate:** `config.workflow.verifier === false` → bỏ tầng verify/test sâu, chỉ chạy lint/build của dự án + cảnh báo "verifier tắt theo config". Ngược lại → chạy đủ theo tier.

**Tester agent là nguồn viết test authoritative** — spawn `task` subagent `agent: Tester` (NEVER tự viết test). Theo tier:

| Tier | Áp dụng | Làm |
|------|---------|-----|
| must-test | logic/handler/model/helper cốt lõi | `Tester` agent → unit + edge/security theo AC. KHÔNG mock cái đang test. |
| verify-sql | report/migration/SELECT | chạy SQL/script trên môi trường thật + build/lint |
| verify-only | config/DDL/asset tĩnh | lint/build của dự án + review đủ |

Nhiều component độc lập → spawn `Tester` song song (1 component/agent). Barrier.

**Test BÁM UC/AC, không test mò:** mỗi `Tester` nhận Requirement scope + bảng AC literal + chỉ thị "viết test chứng minh ĐÚNG các UC/AC được giao (dùng cột 'Cách verify' của AC làm kịch bản; Given/When/Then làm assertion). Mỗi AC must-test/verify-sql → ≥1 test thực thi, trả PASS/FAIL kèm output thật." Test bổ sung ngoài AC (edge/security) vẫn khuyến khích, nhưng KHÔNG được thiếu UC/AC nào.

> Test lint/build đã chạy như GATE của từng task trong `/feature go` (engine `verify`); Step 2 là tầng nghiệm thu AC end-to-end, bổ sung chứ không thay verify-gate của engine.

### Ghi `M<x>-VERIFICATION.md` — bắt buộc dạng AC-matrix
```markdown
# M<x>-VERIFICATION
## UC/AC verdicts (nguồn: REQUIREMENTS.md + M<x>-CONTEXT)
| UC | AC | Verdict | Bằng chứng (output/SQL/file:line) |
|----|----|---------|-----------------------------------|
| UC-15 | AC-01 | PASS | test/test-...  → "handler not called" ✓ |
| UC-16 | AC-05 | FAIL | migration lỗi dòng X |
...
## Review findings (per dimension) — đã fix / còn lại
## Kết luận: <N/M AC PASS>. Phase done? YES/NO
```
**Gate cứng:** còn ≥1 UC/AC FAIL hoặc UC trong Requirement scope chưa có AC verdict → phase CHƯA done. Fix → re-verify UC/AC đó → mới sang Step 3. KHÔNG ship khi matrix còn FAIL.

## Step 3 — Ship (đóng phase)

1. **Commit**: code đã commit atomic per-task trong `/feature go` (qua `engine_advance`) rồi — KHÔNG commit gộp lại. Ship chỉ:
   - Commit nốt phần phụ của phase chưa thuộc task nào (`M<x>-VERIFICATION.md`/STATE/ROADMAP đổi): `docs: M<x> close phase <tên>` (Conventional Commits, tiếng Anh, milestone ở đầu — xem `execute.md` §Commit).
   - Verify **AC matrix trong M<x>-VERIFICATION.md MỌI AC = PASS** (Step 0+1+2) TRƯỚC khi tính phase done. Còn FAIL → KHÔNG đóng phase.
   - **KHÔNG `git push` / mở PR** — chỉ push khi user yêu cầu rõ.
2. **ROADMAP**: phase `[~]` → `[x]` + ghi Phase log (range commit `<first>..<last>` của phase, contract đã export).
3. **STATE cập nhật**:
   - `progress.completed_phases` +1, `percent` lại.
   - `active_phase` → phase tiếp (unblocked theo dependency) hoặc `null` nếu hết.
   - `next_action` → `plan-phase` cho phase sau, hoặc `done`.
   - `## Session Continuity`: ghi vừa ship phase nào.

## Step 4 — Nếu là phase CUỐI: chống drift + archive

BẮT BUỘC khi feature hoàn tất:
- [ ] `su-code/KNOWLEDGE.md` — append nghiệp vụ/gotcha mới học (`validated:`/`failure:`). Lớn → spawn `task` (`agent: task`).
- [ ] `su-code/DECISIONS.md` — append quyết định kiến trúc feature chốt.
- [ ] `PROJECT.md` Validated — tick UC đã ship.
- [ ] `REQUIREMENTS.md` — rà UC thực tế bỏ/đổi, cập nhật intent.
- [ ] `CHANGELOG.md` (Unreleased) — thêm dòng feature (convention su-code).
- [ ] Archive: `mv su-code/planning/<slug> su-code/planning/_archive/` + clear `su-code/planning/ACTIVE.md` (dòng slug về trống) + `config.active_feature = ""`.

## Sau ship

Báo user: phase X done. Còn phase nào → next `/feature plan`. Hết → feature hoàn thành, đã archive.
