---
name: consolidate
description: Dọn memory của repo — gộp bài học trùng, bỏ dòng sai/lỗi thời/nhiễu môi trường, chuyển quy trình đã validated sang PLAYBOOKS, rút gọn STATE. Dùng khi user gõ /consolidate, khi KNOWLEDGE.md dài hoặc digest đầu phiên toàn chuyện cũ.
disable-model-invocation: true
---
Mục tiêu: memory nhỏ, đúng, có bằng chứng (memory tự viết không được duyệt làm agent kém đi — giữ ít mà chắc).

1. Đọc `su-code/KNOWLEDGE.md`, `su-code/PLAYBOOKS.md`, `su-code/STATE.md`.
2. Với từng dòng `failure:`/`validated:`/`decision:`:
   - trùng ý → gộp thành một dòng, giữ evidence mạnh nhất;
   - mâu thuẫn → giữ cái mới hơn có evidence, bỏ cái cũ;
   - không còn đúng với code hiện tại (kiểm path/lệnh còn tồn tại) → bỏ;
   - nhiễu môi trường, thiếu evidence, hoặc đọc được ngay từ code → bỏ.
3. Quy trình nhiều bước đã validated → chuyển sang PLAYBOOKS (When/Steps/Verify/Pitfalls), để lại 1 dòng trỏ tới.
4. STATE.md: giữ phần đang làm (Goal · Checklist · Current · Next) ở đầu file; phần đã release thu gọn còn 1–2 dòng mỗi bản (chi tiết đã có trong git log/CHANGELOG).
5. Cho owner xem `git diff --stat` + 5–10 thay đổi tiêu biểu, hỏi duyệt bằng MỘT `AskUserQuestion` (Apply · Chỉnh lại · Huỷ). Owner đã nói "tự làm đi" → apply.
6. Commit `docs(memory): consolidate KNOWLEDGE/PLAYBOOKS/STATE`. Không push.
