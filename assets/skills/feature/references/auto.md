# /feature --auto — Autonomous full-phase mode

> Cờ `--auto` biến `/feature` thành chế độ tự lái: chạy **trọn 1 phase** với tối thiểu gián đoạn user.
> Load file này NGAY khi args chứa `--auto`, trước khi dispatch sang plan/go.
> `references/feature-rules.md` (luật xuyên suốt, gồm **R10 code-intelligence FIRST**) VẪN áp — auto KHÔNG nới chuẩn code/skill/AC, chỉ thay user-gate bằng tự-quyết.
> Kỷ luật engine-loop + guardrail lấy từ `/auto` (`assets/commands/auto.md`) — mirror nó, đừng chế lại.

## 3 luật cốt lõi

1. **Auto-discuss qua subagent** — mọi điểm-quyết-định mà bình thường dùng `ask` → thay bằng **spawn 1 `task` subagent** (`agent: explore` cho "cái gì đang có / nên theo cái nào", `agent: plan` cho trade-off/approach) đóng vai đối tác trao đổi + tự quyết, bám ràng buộc `PROJECT.md` + `REQUIREMENTS.md` + `su-code/KNOWLEDGE.md`/`DECISIONS.md`. KHÔNG hỏi user.
2. **Block thì không stall** — đánh giá: nếu vẫn code tiếp được → code; nếu không → **SKIP item, ghi NEEDS-CONFIRM**, code nốt phần còn lại. User confirm sau, rồi mới code item bị skip.
3. **1 lệnh `--auto` = code trọn 1 phase** — `plan` (nếu chưa có PLAN) → `go` (hết wave qua engine) → self-check AC → ghi VERIFICATION nếu có item defer. Dừng ở ranh giới phase kế (KHÔNG tự nhảy phase tiếp trừ khi user nói rõ "code hết các phase").

## Phân loại điểm-quyết-định (AI tra được vs phải hỏi)

| Loại | Ví dụ | Xử lý auto |
|------|-------|-----------|
| **AI tra được** (repo/DB/docs) | schema cột nào, pattern nào, module tham khảo, API nào có sẵn, convention | Tự tra (R10: `trail ask`) → quyết. KHÔNG spawn subagent nếu đã rõ. |
| **Cần phán đoán thiết kế** (nhiều hướng hợp lệ) | chọn approach A/B, cắt task, UX flow, trade-off | **Spawn subagent discuss** (xem §Spawn) → lấy khuyến nghị → quyết → ghi `CONTEXT.Decisions`. |
| **Block thật** (subagent+repo+DB bó tay) | credential, URL instance live, holder/account thật, dữ liệu môi trường ngoài | SKIP + NEEDS-CONFIRM (luật 2). KHÔNG bịa. |
| **Không đảo được / outward** | xoá data, push, gọi API production gửi tin thật ra ngoài | VẪN escalate user (an toàn > tự động). |

## Spawn subagent discuss (thay `ask`)

Khi gặp điểm "cần phán đoán thiết kế":
- Spawn `task` subagent: `agent: plan` cho trade-off/approach, hoặc `agent: explore` cho "cái gì đang có / nên theo cái nào".
- Prompt subagent BẮT BUỘC nhúng: câu hỏi cụ thể · ràng buộc liên quan (copy literal từ PROJECT/REQUIREMENTS/su-code memory) · các lựa chọn đang cân nhắc · R10 literal (code-intel FIRST) · "trả về 1 khuyến nghị + lý do ngắn, KHÔNG hỏi lại".
- Orchestrator nhận khuyến nghị → **quyết** (có thể override nếu trái ràng buộc) → ghi `M<x>-CONTEXT.md` Decisions + STATE.Decisions với ghi chú `(auto-decided via <role>)`.
- Nhiều câu độc lập → spawn song song (1 message, nhiều tool-call).

> Mục tiêu: quyết định vẫn **có cơ sở** (subagent phân tích), chỉ là không kéo user vào. Ghi rõ "auto-decided" để user soát lại sau nếu muốn.

## Luồng thực thi auto (1 phase)

1. Dispatch chuẩn (đọc ACTIVE + STATE + config). Xác định `active_phase`.
2. **Nếu phase chưa có PLAN** → chạy `references/plan.md` NHƯNG:
   - Step 1 Discuss: điểm mơ hồ → §Spawn subagent discuss (KHÔNG `ask`).
   - Vẫn viết đủ `M<x>-CONTEXT.md` (Requirement scope + Goal + AC) + `M<x>-NN-PLAN.md` (mỗi task có `[UC:]` + `[AC:]`).
   - **Step 3.5 plan-review VẪN chạy** theo `config.workflow.plan_review` (auto KHÔNG nới chất lượng — review PLAN là tự-soát, không phải hỏi user). NEEDS-FIX → sửa PLAN/CONTEXT rồi tiếp, ghi `(auto-decided)`.
   - Step 4 user-gate → **bỏ qua**, tự set `status: planned` (plan-review thay vai gate chất lượng).
3. **Chạy `references/execute.md`** — feed PLAN vào `engine_plan`, loop `engine_next → engine_verify → engine_advance {commit:true}` hết wave. KHÔNG yield giữa các task (autonomous). Commit atomic mỗi task (verify-gate của engine đã enforce).
   - Task block (dữ liệu/môi trường) → SKIP + ghi NEEDS-CONFIRM, làm task khác.
   - `engine_verify` fail 3 lần giống nhau → engine BLOCK task (doom-loop guard); ghi `failure:` vào `su-code/KNOWLEDGE.md`, chuyển task unblocked kế.
4. Self-check UC/AC. UC/AC nào code-done → đánh dấu; UC/AC block → NEEDS-CONFIRM.
5. Nếu có item defer → ghi `M<x>-VERIFICATION.md` (matrix UC/AC PASS / NEEDS-CONFIRM) ngay (không chờ ship).
6. STATE: `status: executing`, `next_action`: `ship-phase` (nếu mọi AC code-done) hoặc giữ `execute-phase` + ghi list NEEDS-CONFIRM.
7. **Báo cáo cuối**: làm gì xong, commit nào, item nào defer + cần user cấp gì để đóng. Hỏi user có chạy phase kế không (KHÔNG tự nhảy).

## Ranh giới an toàn (auto KHÔNG vượt)

- KHÔNG `git push`, KHÔNG merge ra nhánh chính từ ngoài, KHÔNG gọi API production gửi nội dung thật ra ngoài mà không xác nhận — trừ khi task test bản chất là "gửi thật" VÀ user đã duyệt ở plan.
- KHÔNG xoá dữ liệu / drop table tự động.
- KHÔNG sửa ngoài `active_phase` (guardrail R6 vẫn áp).
- Vi phạm convention (`AGENTS.md`/security) vẫn báo như thường — auto KHÔNG nới chuẩn code.
- Unattended cần omp `tools.approvalMode: yolo` + hard token ceiling (`+Nk!`); turn/token cap là tín hiệu dừng, self-report "xong" thì không.

## Khác biệt nhanh so với mode thường

| | Thường | `--auto` |
|---|--------|---------|
| Điểm mơ hồ thiết kế | `ask` | Spawn `task` subagent discuss → tự quyết |
| Gate 2 (plan) / gate cuối (go) | Chờ user duyệt | Plan-review tự-soát thay gate 2; tự duyệt chạy tiếp |
| Block 1 item | Có thể dừng hỏi | Skip + NEEDS-CONFIRM + code nốt |
| Phạm vi 1 lệnh | 1 bước (plan HOẶC go) | Trọn phase (plan→go) qua engine |
| Dữ liệu môi trường thật | hỏi user | defer NEEDS-CONFIRM (không hỏi giữa chừng) |
