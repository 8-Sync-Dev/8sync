---
name: remember
description: Ghi MỘT bài học có bằng chứng vào memory của repo (su-code/KNOWLEDGE.md) để các session sau đọc được qua digest SessionStart. Dùng khi user gõ /remember <bài học>, hoặc khi vừa có failure đã tìm ra gốc, cách làm vừa được verify, hay quyết định thiết kế cần giữ.
argument-hint: <bài học>
---
Ghi: $ARGUMENTS

1. Phân loại: `failure:` (lỗi đã gặp + nguyên nhân gốc + cách chặn) · `validated:` (cách làm đã chạy pass) · `decision:` (lựa chọn + vì sao).
2. Phải có bằng chứng: lệnh + kết quả, `file:line`, hoặc URL. Không có → không ghi, nói rõ thiếu gì.
3. KHÔNG ghi: secret/token/dữ liệu khách; lỗi môi trường thoáng qua (mạng chập, máy bận); "tool X không làm được" chưa kiểm; thứ đọc được ngay từ code/README.
4. Trùng: tìm trong `su-code/KNOWLEDGE.md` (`grep -n` từ khoá). Có dòng cùng ý → sửa dòng đó (cập nhật, ghi "supersedes") thay vì thêm dòng mới.
5. Append đúng một dòng vào cuối `su-code/KNOWLEDGE.md` (repo không có → tạo file với tiêu đề `# KNOWLEDGE`):
   `- <type>: <bài học, ≤2 câu, nêu cách áp dụng> — evidence: <lệnh/file:line/URL> (<YYYY-MM-DD>)`
6. Quy trình nhiều bước đã validated và sẽ dùng lại → thêm mục vào `su-code/PLAYBOOKS.md` (When/Steps/Verify/Pitfalls).
7. Bài học dự án khác trên máy này cũng dùng được (công cụ, hook, guard, cách làm chung — không phải chuyện riêng của repo) → thêm `8sync ccc know add "<bài học ngắn>"`: vào cây tri thức chung của máy (mỗi repo một file, SessionStart của mọi dự án đọc được, có ghi root); không ghi secret/dữ liệu khách.
Báo lại đúng dòng đã ghi.
