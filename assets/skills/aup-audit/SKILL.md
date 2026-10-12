---
name: aup-audit
description: Kiểm tra repo theo Usage Policy của Anthropic (anthropic.com/legal/aup) và quy tắc 8 Sync — secret và file nhạy cảm (cả git history), dùng token Claude sai đường, tính năng rủi ro (scrape, nhắn tin hàng loạt, nhận diện khuôn mặt, chatbot thiếu disclosure, quyết định high-risk). Dùng khi user gõ /aup-audit, trước khi public repo, trước release, hoặc khi diff thêm tính năng thu thập dữ liệu / nhắn tin người ngoài.
---
Không phải tư vấn pháp lý: báo cáo phát hiện, user quyết định sửa gì.

1. **Secret, cả history:** `gitleaks detect --no-banner --redact` (thiếu gitleaks → `8sync setup`, hoặc báo user). Chỉ nêu file:dòng + loại, KHÔNG in giá trị.
2. **File nhạy cảm đang track hoặc từng commit:** lọc `git ls-files` và `git log --all --name-only --format=` theo `.env` (trừ `.example`/`.sample`/`.template`), `*.session`, `*.pkl`, `*.pem`, `*.p12`, `id_rsa*`, `id_ed25519*`, `accounts*.json`, `members*.csv`. Đã xoá khỏi cây nhưng còn trong history → `git filter-repo` + rotate.
3. **Hiểu sản phẩm trước khi phán:** đọc README, entry point, route/API chính. Rồi đi từng dòng trong `RULES.md` (cùng thư mục): tìm theo cột "Dấu hiệu" bằng code intelligence hoặc grep, đọc ngữ cảnh từng chỗ. Tài liệu phòng thủ, test fixture, ví dụ trong docs, regex mẫu ≠ vi phạm.
4. **Báo cáo:** bảng `mức | mục AUP / quy tắc | file:dòng | việc cần làm`. BLOCK = vi phạm rõ (dừng ship; hỏi user trước khi xoá/sửa) · WARN = rủi ro cần user quyết · bỏ qua mục sạch.
5. **Secret thật:** bảo user rotate ngay và xoá khỏi history; không tự rotate, không tự xoá.

Chọn nhanh: hỏi "được phép không / điều khoản nào" → `/rules` · quét repo theo AUP (skill này) · secret + lỗ hổng code → `/sec` · cấu hình Claude Code của máy/org → `/harden`.
