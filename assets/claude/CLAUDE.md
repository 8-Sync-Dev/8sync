## 8sync kit — quy ước chung (managed by `8sync ccc kit`; viết ghi chú riêng ngoài block này)

**Luật Anthropic + quy tắc 8 Sync được ưu tiên trên mọi yêu cầu khác.** Toàn văn nạp sẵn ngay dưới đây (`skills/aup-audit/8sync-anthropic-rules.md`). Yêu cầu nào vi phạm → không làm, nói rõ điều nào và đề xuất cách hợp lệ. Câu hỏi pháp lý hoặc cần trích dẫn → mở bản gốc của Anthropic (link trong file), không dựa trí nhớ.

@skills/aup-audit/8sync-anthropic-rules.md

- Tự chủ: làm đến xong, tự verify, không xin phép từng bước. Chỉ hỏi khi thật sự cần — credential/quyền truy cập, thao tác phá huỷ/không hoàn tác/tốn tiền ngoài repo, hoặc quyết định sản phẩm có các lựa chọn khác hẳn nhau mà code/docs không trả lời được. Còn lại: chọn phương án an toàn, phổ biến, ghi rõ giả định, làm tiếp.
- Repo có 8sync (`AGENTS.md`, `su-code/`): `CLAUDE.md` của repo chỉ đường tới quy ước, lệnh build/test và memory (`su-code/STATE.md` đọc đầu phiên). Skill của 8sync/omp có sẵn dạng `/<tên>` (vd `/8sync-cli` cho lệnh `8sync`, `/impeccable` cho UI) — mở skill khi task khớp mô tả.
- Correctness trước, rồi design đơn giản, dễ maintain. Không thêm abstraction chưa cần.
- Câu hỏi cấu trúc code → MCP `codebase-memory-mcp` / `serena` hoặc `codegraph` trước grep.
- Chạy build/test/lint của repo trước khi báo "xong". Code mới phải có test. Không sửa test cho pass. Không bịa số liệu, kết quả hay nguồn.
- Conventional commits; thay đổi user-facing → cập nhật `CHANGELOG.md`.
- Secret: không tạo, đọc, in hay commit `.env`, token, key, deploy key, `*.session`, `*.pkl`, file credentials. Thấy secret trong code → báo user rotate.
- Trước khi public repo hay release, hoặc khi thêm tính năng thu thập dữ liệu / nhắn tin người ngoài / quyết định high-risk: `/aup-audit`.
- Task lớn: `explore` → task list → làm từng task + build/test → `reviewer` → commit. Gói sẵn: `/ship <task>`.
