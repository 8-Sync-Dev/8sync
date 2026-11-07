---
name: hq-send
description: "Nhắn hoặc giao việc cho một phòng khác qua HQ"
argument-hint: "<id> <tin nhắn…>"
---

# /hq-send: nhắn một phòng

`$ARGUMENTS`: `<id> <tin nhắn…>`. Thiếu id → `node ~/.omp/skills/hq-control/scripts/hq.mjs ls`, hỏi chủ chọn phòng. Thiếu tin → hỏi chủ nhắn gì.

Chạy `node ~/.omp/skills/hq-control/scripts/hq.mjs …` (skill `hq-control`). Luật, lỗi thường gặp và định dạng output ở `~/.omp/skills/hq-control/SKILL.md`: đọc nó trước nếu chưa đọc trong phiên này. `~` để trần (không ngoặc kép); PowerShell dùng `$HOME` thay `~`. Không in token hay link `--public`.

1. Theo luật gửi tin trong SKILL.md (không gửi cho chính mình, phòng `running` chỉ khi cần, một tin trọn vẹn, chuyển nguyên lời chủ).
2. `node ~/.omp/skills/hq-control/scripts/hq.mjs brief <id>` (phòng đó đang làm gì, có đang chờ chủ không), rồi `node ~/.omp/skills/hq-control/scripts/hq.mjs send <id> "<tin>"` → báo chủ `delivery` trong kết quả. HQ tự thêm dòng `[từ phòng …]` của mình, không gõ thêm.
3. `failed`, `held`, `unconfirmed` hoặc `error` → báo chủ, không gửi lại liên tục.

Báo cáo đăng bài → `/hq-artifact add …`, không `/hq-send`.
