# Rules map for `/aup-audit`

Luật gốc của org: `8sync-anthropic-rules.md` (cùng thư mục) — đọc trước; file này chỉ thêm dấu hiệu để tìm trong code. Nguồn chính thức (Usage Policy hiệu lực 2026-11-12): https://www.anthropic.com/legal/aup · Commercial Terms https://www.anthropic.com/legal/commercial-terms · Consumer Terms https://www.anthropic.com/legal/terms. Snapshot văn bản gốc mới nhất (tự cập nhật hàng tuần): https://github.com/8-Sync-Dev/8sync/tree/main/docs/legal/anthropic. Khi trích dẫn, mở bản gốc.

## Đường truy cập Claude
| Truy cập qua | Điều khoản | Dấu hiệu sai |
|---|---|---|
| API key Console (backend, tool bên thứ ba) | Commercial Terms | — |
| Claude.ai / Pro-Max / đăng nhập Claude Code | Consumer hoặc Team/Enterprise | token `sk-ant-oat…`, OAuth client id của Claude Code, header beta `oauth-…`, gateway/proxy chuyển token gói sang tool khác, giả client Claude Code |

Quy tắc: token gói chỉ chạy trong Claude Code và claude.ai chính chủ; tool khác (omp, Forge, Feynman, app 8 Sync) dùng API key Console. Proxy/giả client = AUP "Do Not Abuse Our Platform". → **BLOCK**

## Universal Usage Standards
| Mục AUP | Dấu hiệu trong code | Mức |
|---|---|---|
| Abuse Our Platform | proxy/bán lại subscription, xoay nhiều account để né ban, train model khác bằng output Claude, tool jailbreak | BLOCK |
| Compromise Computer/Network Systems | malware, keylogger, C2, credential stealer, exploit nhắm hệ thống không được uỷ quyền | BLOCK (tài liệu phòng thủ: WARN) |
| Compromise Critical Infrastructure | điều khiển/phá SCADA, Modbus, PLC không uỷ quyền | WARN |
| Develop or Design Weapons | CBRN, chất nổ, nhắm mục tiêu vũ khí | BLOCK |
| Children's Safety | bất kỳ nội dung tình dục liên quan trẻ vị thành niên | BLOCK |
| Sexually Explicit Content / NCII | tạo nội dung khiêu dâm, deepfake nude, "undress" | BLOCK |
| Cruel, Abusive, Psychologically Harmful | khuyến khích tự hại, rối loạn ăn uống, quấy rối | WARN |
| Incite Violence or Hateful Behavior | doxxing, điều phối quấy rối, sinh hate speech | WARN |
| Privacy or Identity Rights | scrape thành viên/khách, mass-DM/mass-add, PII thật trong repo (CCCD, SĐT, email kèm tên) | BLOCK nếu scrape/mass-contact, còn lại WARN |
| Surveillance / Law Enforcement | nhận diện khuôn mặt, sinh trắc, cảm xúc; tracking vị trí; dựng hồ sơ cá nhân không đồng ý | WARN |
| Disinformation / Deceptive Campaigns | mạo danh người/tổ chức thật, sockpuppet, fake review/account, bot farm | WARN |
| Democratic Processes | thông tin sai về bầu cử, nhắm cử tri | WARN |
| Fraudulent / Predatory | giấy tờ giả, carding, phishing, trang đăng nhập giả | WARN |
| Illegal Activity | vi phạm luật áp dụng (VN: dữ liệu cá nhân, quảng cáo, thương mại điện tử) | WARN |

## High-risk Use Case Requirements
- **AI Recommendations** (pháp lý, y tế, tài chính, tín dụng, bảo hiểm, nhà ở, tuyển dụng, giáo dục, phúc lợi, tư cách pháp lý): cần người đủ chuyên môn review + disclosure cho người bị ảnh hưởng. Dấu hiệu: `credit score`, `loan approve`, `resume screen`, `candidate rank`, `triage`, `dosage`. → WARN
- **Physical Actions** (model điều khiển phần cứng, robot, xe, thiết bị): đánh giá hậu quả khi sai, giới hạn hành động, có người giám sát. → WARN

## Additional guidelines
- Chatbot/agent nói chuyện với người ngoài (Zalo OA, Messenger, Telegram, widget chat) phải nói rõ là AI ở đầu phiên hoặc trên UI. Thiếu disclosure → WARN.
- Agentic: người dựng chịu trách nhiệm mọi hành động agent làm qua tool/browser/hệ thống kết nối.

## Quy tắc nội bộ 8 Sync
Mục 3 của `8sync-anthropic-rules.md` là bản duy nhất (secret, ZUS local-first, dữ liệu client/CRM, số liệu traction, luật dữ liệu cá nhân VN). Dấu hiệu cần tìm: file secret đang track; code đẩy dữ liệu user ZUS lên server; dữ liệu CRM thật trong fixture/seed/ví dụ; số traction/khách/đối tác trong README, landing, pitch không ghi nguồn dashboard.
