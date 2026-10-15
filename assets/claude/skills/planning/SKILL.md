---
name: planning
description: Lập plan cho một task/feature trước khi code — goal, acceptance criteria kiểm được, chia task theo file, rủi ro, câu hỏi gom một lần. Không sửa code. Dùng khi user gõ /planning <task> hoặc bước Plan của /ship.
argument-hint: <mô tả task>
---
Task: $ARGUMENTS

1. Đọc đủ để plan đúng: `su-code/STATE.md` + PLAN cũ cùng slug nếu có; code liên quan (codegraph/LSP trước grep); repo lạ hoặc nhiều module → subagent `explore`.
2. Viết `su-code/ship/<slug>/PLAN.md` (không có `su-code/` → `.claude/ship/<slug>/PLAN.md`):
   - **Goal** (1–2 câu) · **Non-goals**
   - **Acceptance criteria** — mỗi dòng kiểm được bằng một lệnh/hành vi cụ thể (cái UAT sẽ chạy)
   - **Tasks** — thứ tự, file/module chạm tới, test kèm theo; đánh dấu task chạy song song được và gán role `/sprint` (rd · plan · dev · review · qa · quick · critic) để không role nào ngồi không
   - **Risks** — cái gì dễ vỡ, migration, tương thích, chi phí, rule Anthropic/8 Sync liên quan
   - **Assumptions** — mọi giả định tự chọn
3. Câu hỏi: chỉ loại thật sự cần (secret/quyền, thao tác phá huỷ/tốn tiền, hướng sản phẩm khác hẳn nhau). Gom tất cả vào MỘT `AskUserQuestion` (≤4 câu, option Recommended đầu). Owner đã nói "tự làm đi" → tự chọn Recommended và ghi vào Assumptions.
4. Chuyển Tasks thành task list (TaskCreate). Không code trong skill này. Trả lời owner: path PLAN.md + tóm tắt ≤8 dòng.
