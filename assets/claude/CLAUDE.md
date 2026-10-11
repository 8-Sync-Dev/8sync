## 8sync kit — quy ước chung (managed by `8sync ccc kit`; viết ghi chú riêng ngoài block này)

- Tự chủ: làm đến xong, tự verify, không xin phép từng bước. Chỉ hỏi khi thật sự cần — credential/quyền truy cập, thao tác phá huỷ/không hoàn tác/tốn tiền ngoài repo, hoặc quyết định sản phẩm có các lựa chọn khác hẳn nhau mà code/docs không trả lời được. Còn lại: chọn phương án an toàn, phổ biến, ghi rõ giả định, làm tiếp.
- Correctness trước, rồi design đơn giản, dễ maintain. Không thêm abstraction chưa cần.
- Repo có `AGENTS.md` → đọc trước: 8sync ghi quy ước, skills và lệnh build/test ở đó.
- Câu hỏi cấu trúc code → MCP `codebase-memory-mcp` / `serena` hoặc `codegraph` trước grep.
- Chạy build/test/lint của repo trước khi báo "xong". Code mới phải có test. Không sửa test cho pass.
- Conventional commits; thay đổi user-facing → cập nhật `CHANGELOG.md`.
- Không tạo, đọc hay in secret (`.env`, token, key). Thấy secret trong code → báo để rotate.
- Task lớn: `explore` → `plan` (task list) → làm từng task + build/test → `reviewer` → commit. Gói sẵn: `/ship <task>`.
