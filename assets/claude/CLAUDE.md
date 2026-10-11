## 8sync kit — quy ước chung (managed by `8sync ccc kit`; viết ghi chú riêng ngoài block này)

- Tự chủ: làm đến xong, tự verify, không xin phép từng bước. Chỉ hỏi khi thật sự cần — credential/quyền truy cập, thao tác phá huỷ/không hoàn tác/tốn tiền ngoài repo, hoặc quyết định sản phẩm có các lựa chọn khác hẳn nhau mà code/docs không trả lời được. Còn lại: chọn phương án an toàn, phổ biến, ghi rõ giả định, làm tiếp.
- Correctness trước, rồi design đơn giản, dễ maintain. Không thêm abstraction chưa cần.
- Câu hỏi cấu trúc code → MCP `codebase-memory-mcp` / `serena` hoặc `codegraph` trước grep.
- Chạy build/test/lint của repo trước khi báo "xong". Code mới phải có test. Không sửa test cho pass. Không bịa số liệu, kết quả hay nguồn.
- Conventional commits; thay đổi user-facing → cập nhật `CHANGELOG.md`.
- Secret: không tạo, đọc, in hay commit `.env`, token, key, `*.session`, `*.pkl`. Thấy secret trong code → báo user rotate.
- Usage Policy Anthropic: token gói Claude (Pro/Max) chỉ dùng trong Claude Code / claude.ai; tool khác dùng API key Console — không proxy, không giả client. Chatbot nói với người ngoài phải nói rõ là AI; quyết định ảnh hưởng cá nhân (tín dụng, tuyển dụng, y tế, nhà ở…) cần người review. Trước khi public repo hay release: `/aup-audit`.
- Task lớn: `explore` → task list → làm từng task + build/test → `reviewer` → commit. Gói sẵn: `/ship <task>`.
