---
name: rules
description: Luật Anthropic + quy tắc 8 Sync — trả lời "X có được phép không?" hoặc kiểm tra một hành động/diff dự định làm theo Usage Policy (AUP), Consumer/Commercial Terms, Claude Code legal & compliance và quy tắc nội bộ. Dùng khi user gõ /rules <câu hỏi hoặc việc định làm>, hỏi về token subscription, tool bên thứ ba, scrape, chatbot, dữ liệu cá nhân, hoặc cần trích dẫn điều khoản.
argument-hint: <câu hỏi hoặc hành động định làm>
---
Không phải tư vấn pháp lý. Không dựa trí nhớ cho điều khoản.

1. Mở toàn văn `skills/aup-audit/8sync-anthropic-rules.md` (trong `~/.claude/skills/` hoặc plugin 8sync-kit) — file này không còn nạp sẵn mỗi phiên. Ghi ngày "Cập nhật" của nó.
   Không có file (cài chỉ plugin 8sync-kit) → dùng link chính thức: AUP https://www.anthropic.com/legal/aup · Commercial https://www.anthropic.com/legal/commercial-terms · Consumer https://www.anthropic.com/legal/terms · https://code.claude.com/docs/en/legal-and-compliance, và ghi chú "bộ rules 8 Sync đầy đủ đi kèm `8sync ccc kit`".
2. Cần trích dẫn → mở bản gốc, không dùng bản tóm tắt: snapshot `docs/legal/anthropic/` trong repo 8sync (`usage-policy.md`, `consumer-terms.md`, `commercial-terms.md`, `claude-code-legal-and-compliance.md`; ngày snapshot ở `index.md`) hoặc link chính thức trong file rules. Không có snapshot → WebFetch link gốc; không mở được thì ghi "chưa kiểm chứng".
3. Xác định đường truy cập của việc đang hỏi (API key/Console → Commercial; claude.ai/Claude Code login → Consumer hoặc Team/Enterprise terms; AUP áp cho tất cả) rồi đối chiếu: AUP (Universal Standards, High-risk, Additional Guidelines) + quy tắc 8 Sync (secret, ZUS local-first, dữ liệu client, số liệu traction).
4. Dòng đầu của câu trả lời: **ALLOWED** / **CONDITIONS** (nêu điều kiện: human review, disclosure AI, API key thay vì token subscription…) / **NOT ALLOWED**. Sau đó: điều khoản chính xác (tên mục + trích ngắn) + link chính thức + cách làm hợp lệ nếu bị chặn.
5. Dữ liệu cá nhân Việt Nam: dẫn Nghị định 13/2023/NĐ-CP (Chính phủ) và Luật Bảo vệ dữ liệu cá nhân 2025 kèm link vbpl.vn / chinhphu.vn, và nói "đối chiếu bản chính thức trên cổng đó trước khi áp dụng".
6. Có diff/repo cụ thể → chuyển sang `/aup-audit` (quét repo) hoặc `/sec` (bảo mật code). Muốn khoá máy/org → `/harden`.

Chọn nhanh: hỏi "được không / điều khoản nào" → `/rules` · quét repo theo AUP trước release → `/aup-audit` · secret + lỗ hổng code → `/sec` · cấu hình Claude Code của máy/org → `/harden`.
