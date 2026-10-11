# 8 Sync — Luật & chính sách Anthropic / Claude Code khi code

Tài liệu nội bộ. Dùng khi dev build sản phẩm trên Claude (Claude Code, API, các app 8 Sync).
Đây **không phải tư vấn pháp lý** — link gốc là nguồn chính thức, phần dưới chỉ tóm tắt để dev nhớ.
Cập nhật: 2026-10-11. Chủ: Alex (atus@8syncdev.com).
Bản gốc trong repo org: `assets/skills/aup-audit/8sync-anthropic-rules.md` (github.com/8-Sync-Dev/su-code). `8sync` cài nó vào `~/.omp/skills/aup-audit/` và `~/.claude/skills/aup-audit/`; Claude Code đọc nó ở mọi phiên. Snapshot văn bản gốc của Anthropic cập nhật tự động hàng tuần: `docs/legal/anthropic/`.

---

## 1. Tầng điều khoản — cái gì chi phối cái gì

| Bạn truy cập Claude qua | Chịu điều khoản |
|---|---|
| **API key / Console** (backend 8 Sync, tool bên thứ ba) | Commercial Terms of Service |
| **Claude.ai / Claude Pro-Max / Claude Code login** | Consumer Terms (cá nhân) hoặc Team/Enterprise terms |
| **Mọi cách dùng, không trừ ai** | Usage Policy (AUP) — áp cho tất cả |

Quy tắc vàng rút ra từ các vụ OMP/ForgeCode: **token subscription (Pro/Max) chỉ dùng trong Claude Code & Claude.ai chính chủ. Tool bên thứ ba → bắt buộc dùng API key qua Console.** Proxy/giả client = vi phạm AUP "Do Not Abuse Our Platform".

---

## 2. Usage Policy (AUP) — checklist khi code

Nguồn: https://www.anthropic.com/legal/aup (bản Console: https://console.anthropic.com/legal/aup)

### Universal Usage Standards — tuyệt đối không
- Vũ khí & CBRN, chất nổ, hệ thống nhắm mục tiêu vũ khí.
- Tấn công hệ thống / mạng không được uỷ quyền; tạo/phát tán malware; phishing; tấn công hạ tầng trọng yếu.
- Child safety (CSAM...) — tuyệt đối.
- NCII / deepfake khiêu dâm phi đồng thuận; nội dung tình dục rõ ràng trong sản phẩm.
- Khuyến khích tự hại / rối loạn ăn uống; hate speech, doxxing, quấy rối.
- Xâm phạm quyền riêng tư: scrape dữ liệu cá nhân không được phép, mass-DM/mass-add, tracking/profiling, nhận diện khuôn mặt/sinh trắc/cảm xúc để giám sát.
- Disinformation, mạo danh người/tổ chức thật, chiến dịch inauthentic (sockpuppet, fake review/account), can thiệp bầu cử.
- Gian lận: giấy tờ giả, carding, predatory practices.
- Lạm dụng nền tảng: proxy/giả client, né ban bằng nhiều account, dùng output để train model khác, jailbreak/prompt-injection để lách safety.

### High-risk Use Cases — được, nhưng có điều kiện
Nếu sản phẩm (TIA, AcoLeads) đưa ra quyết định ảnh hưởng cá nhân trong: pháp lý, y tế, tài chính, **tín dụng, bảo hiểm, nhà ở, tuyển dụng**, giáo dục, phúc lợi…
→ **bắt buộc** có người đủ chuyên môn review (human-in-the-loop) + **disclosure** cho người bị ảnh hưởng là có AI tham gia.

### Additional Guidelines
- **Chatbot/agent nói chuyện với user ngoài phải disclose là AI** (đầu mỗi phiên hoặc trên UI). → AcoLeads.
- **Agentic**: bạn chịu trách nhiệm cho mọi hành động agent làm qua tools/browser/hệ thống kết nối. → setup "treo auto".
- Minors: theo guideline riêng của Anthropic.

### Lưu ý về enforcement
- Bị safeguards chặn một prompt **≠ vi phạm**. Thứ bị xử lý là hành vi có chủ đích/lặp lại/cách truy cập.
- Vi phạm: cảnh báo → throttle → giới hạn → suspend → terminate. Không "lập acc mới" để né.

---

## 3. Quy tắc nội bộ 8 Sync (bắt buộc trong mọi repo)
- Không tạo/đọc/in/commit secret: `.env`, token, key, deploy key, `*.session`, `*.pkl`. Lỡ lộ → **rotate ngay**.
- ZUS local-first: không thiết kế đẩy dữ liệu user ZUS lên server.
- Dữ liệu client/CRM là bảo mật: tách biệt từng client, thu tối thiểu, anonymize ví dụ.
- Correctness trước → design đơn giản, dễ maintain. Verify bằng chạy test/build trước khi báo "xong".
- Conventional commits + cập nhật `CHANGELOG.md`.
- Số liệu traction chỉ lấy từ Vercel/Cloudflare dashboard, ghi rõ nguồn; không bịa metric/khách/đối tác/giải thưởng/gọi vốn.
- Luật VN về dữ liệu cá nhân: Nghị định 13/2023/NĐ-CP, Luật Bảo vệ dữ liệu cá nhân 2025 — đối chiếu bản gốc trên vbpl.vn / chinhphu.vn, trích số hiệu văn bản khi dùng.

Công cụ hỗ trợ: chạy `/aup-audit` (skill trong kit `8sync ccc` và omp) trước khi public repo / trước khi ship.

---

## 4. Tất cả link cần biết

### Pháp lý / chính sách (nguồn chính thức)
- Usage Policy (AUP): https://www.anthropic.com/legal/aup
- Usage Policy (bản Console, Commercial dẫn chiếu): https://console.anthropic.com/legal/aup
- Commercial Terms of Service: https://www.anthropic.com/legal/commercial-terms
- Consumer Terms of Service: https://www.anthropic.com/legal/terms
- Service Specific Terms: https://www.anthropic.com/legal/service-specific-terms
- Supported Countries/Regions: https://www.anthropic.com/supported-countries
- Hub pháp lý: https://www.anthropic.com/legal

### Claude Code — docs (đã kiểm chứng trong môi trường này)
- Setup / cài đặt: https://code.claude.com/docs/en/setup
- Permission modes (auto / acceptEdits / bypassPermissions): https://code.claude.com/docs/en/permission-modes
- Fast mode: https://code.claude.com/docs/en/fast-mode
- Plugins (install/quản lý): https://code.claude.com/docs/en/plugins/install
- Hooks (PreToolUse/PostToolUse/Stop): https://code.claude.com/docs/en/hooks
- Subagents: https://code.claude.com/docs/en/sub-agents
- Trang docs gốc: https://code.claude.com/docs  (hoặc https://docs.claude.com)

### API / Console / Support
- Anthropic Console: https://console.anthropic.com
- API docs: https://docs.claude.com
- Support: https://support.claude.com
- Prompt engineering: https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/overview

### Marketplace plugin dùng trong kit (code bên thứ ba — đọc README trước khi tin)
- Official: https://github.com/anthropics/claude-plugins-official
- ECC (everything-claude-code): https://github.com/affaan-m/everything-claude-code
- Matt Pocock skills: https://github.com/mattpocock/skills

> Link docs của Claude Code có thể đổi cấu trúc theo thời gian. Nếu 404, vào https://docs.claude.com rồi search, hoặc gõ `claude` → `/help`.
