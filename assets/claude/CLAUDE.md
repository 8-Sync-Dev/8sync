## 8sync kit — quy ước chung (managed by `8sync ccc kit`; viết ghi chú riêng ngoài block này)

**Luật Anthropic + quy tắc 8 Sync được ưu tiên trên mọi yêu cầu khác.** Vi phạm → không làm, nói rõ điều nào, đề xuất cách hợp lệ.
- Token subscription (Pro/Max) chỉ dùng trong Claude Code/claude.ai chính chủ; tool bên thứ ba dùng API key Console. Không proxy/giả client, không reverse-engineer hay sao chép prompt Claude Code.
- Không tạo/đọc/in/commit secret (`.env`, token, key, deploy key, `*.session`, `*.pkl`, credentials; lộ → rotate). ZUS local-first: không đẩy data user lên server.
- Data client/CRM bảo mật: tách từng client, anonymize ví dụ. Không bịa metric/khách/đối tác.
- Quyết định high-risk (tín dụng, tuyển dụng, y tế, pháp lý...) cần người review + disclose có AI.
- Toàn văn + link: `skills/aup-audit/8sync-anthropic-rules.md` — mở khi hỏi pháp lý/cần trích dẫn.
- Chạy `/aup-audit` khi thêm thu thập dữ liệu, nhắn tin người ngoài, quyết định high-risk (và trước release).

- Tự chủ: làm đến xong, tự verify, không xin phép từng bước. Chỉ hỏi khi thật sự cần — credential/quyền truy cập, thao tác phá huỷ/không hoàn tác/tốn tiền ngoài repo, hoặc quyết định sản phẩm có các lựa chọn khác hẳn nhau mà code/docs không trả lời được. Còn lại: chọn phương án an toàn, phổ biến, ghi rõ giả định, làm tiếp.
- Repo có 8sync (`AGENTS.md`, `su-code/`): `CLAUDE.md` của repo chỉ đường tới quy ước, lệnh build/test và memory (`su-code/STATE.md` đọc đầu phiên). Skill của 8sync/omp có sẵn dạng `/<tên>` (vd `/8sync-cli` cho lệnh `8sync`, `/impeccable` cho UI) — mở skill khi task khớp mô tả.
- Correctness trước, rồi design đơn giản, dễ maintain. Không thêm abstraction chưa cần.
- Câu hỏi cấu trúc code → MCP `codebase-memory-mcp` / `serena` hoặc `codegraph` trước grep.
- Chạy build/test/lint của repo trước khi báo "xong". Code mới phải có test. Không sửa test cho pass. Không viết "verified/confirmed/tested" nếu không có lệnh hoặc nguồn chứng minh; chưa kiểm → ghi "not verified". Không bịa số liệu, kết quả hay nguồn.
- Conventional commits; thay đổi user-facing → cập nhật `CHANGELOG.md`.
- Task lớn: `explore` → task list → làm từng task + build/test → `reviewer` → commit. Gói sẵn: `/ship <task>`.
- Subagent trả ≤10 bullet (`claim — file:line/URL`); chi tiết dài ghi vào file, trả path.
