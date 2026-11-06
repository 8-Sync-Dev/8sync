---
name: hq-metrics
description: "Ghi hoặc xem số liệu một bài đã đăng (Nội dung › Tổng quan của HQ)"
argument-hint: "[ls [--content N] | add --content N --platform P [--url U] [--at T] [--reach N] [--reactions N] [--comments N] [--shares N] [--views N] [--session ID]]"
---

# /hq-metrics: số liệu bài đăng trong HQ

`$ARGUMENTS`: trống → `ls`; `ls [--content N]` hoặc `add …` như bảng lệnh trong SKILL.md.

Chạy `node ~/.omp/skills/hq-control/scripts/hq.mjs …` (skill `hq-control`). Luật, lỗi thường gặp và định dạng output ở `~/.omp/skills/hq-control/SKILL.md`: đọc nó trước nếu chưa đọc trong phiên này. `~` để trần (không ngoặc kép); PowerShell dùng `$HOME` thay `~`. Không in token hay link `--public`.

1. `node ~/.omp/skills/hq-control/scripts/hq.mjs metrics $ARGUMENTS` (trống: `metrics ls`, rồi tóm tắt theo nền tảng).
2. `add`: chỉ số đọc thật từ trang (Business Suite › Nội dung › Đã đăng hoặc Insights, ego profile "8sync FB"), không ước lượng; số không đọc được thì bỏ cờ đó. Thêm `--session <id phòng mình>`.
3. Có permalink thật → cập nhật ảnh bằng chứng: `/hq-artifact add <ảnh> --content <id> --link <permalink>`.
