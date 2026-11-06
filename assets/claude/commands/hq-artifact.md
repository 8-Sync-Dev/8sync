---
name: hq-artifact
description: "Xem, đọc hoặc đăng file kết quả ở tab Kết quả của HQ; báo cáo đăng bài (link Meta, ảnh chứng minh, ghi chú) vào phần Báo cáo của phòng"
argument-hint: "[ls [n] [--session ID] [--content N] | show <id> | add <file> [<file>…] [--title T] [--note N] [--session ID] [--content 38,16] [--link URL] [--for DIR]]"
---

# /hq-artifact: tab Kết quả của HQ

`$ARGUMENTS`: trống → `ls 10`; `ls …`, `show <id>` hoặc `add <file> …` như bảng lệnh trong SKILL.md.

Chạy `node ~/.omp/skills/hq-control/scripts/hq.mjs …` (skill `hq-control`). Luật, lỗi thường gặp và định dạng output ở `~/.omp/skills/hq-control/SKILL.md`: đọc nó trước nếu chưa đọc trong phiên này. `~` để trần (không ngoặc kép); PowerShell dùng `$HOME` thay `~`. Không in token hay link `--public`.

1. `node ~/.omp/skills/hq-control/scripts/hq.mjs artifact $ARGUMENTS` (trống: `artifact ls 10`, rồi tóm tắt).
2. `add`: chỉ file chủ cần xem, luôn kèm `--title`, `--note` và `--session <id phòng mình>`; báo chủ "đã đăng lên tab Kết quả" kèm `id`. Báo cáo đăng bài và xử lý lỗi 403/413/422: theo mục Công thức của SKILL.md.
3. `show`: file ảnh/PDF/video thì mở đường dẫn script in ra bằng công cụ đọc ảnh/PDF của mình.
