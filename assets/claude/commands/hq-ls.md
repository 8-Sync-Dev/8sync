---
name: hq-ls
description: "Xem các phòng Claude Code/omp đang mở qua HQ: ai đang làm gì, phòng nào đang chờ hộp thoại"
argument-hint: "[--all]"
---

# /hq-ls: các phòng đang làm gì

`$ARGUMENTS`: trống, hoặc `--all` để gồm cả phòng đã kết thúc.

Chạy `node ~/.omp/skills/hq-control/scripts/hq.mjs …` (skill `hq-control`). Luật, lỗi thường gặp và định dạng output ở `~/.omp/skills/hq-control/SKILL.md`: đọc nó trước nếu chưa đọc trong phiên này. `~` để trần (không ngoặc kép); PowerShell dùng `$HOME` thay `~`. Không in token hay link `--public`.

1. `node ~/.omp/skills/hq-control/scripts/hq.mjs ls $ARGUMENTS`.
2. Phòng có `WAITING`: `node ~/.omp/skills/hq-control/scripts/hq.mjs dialog <id> permission` (hoặc `question`) để đọc nguyên văn. Chỉ đọc: hộp thoại quyền thì chủ bấm trong HQ.
3. Báo chủ một bảng: nhãn · trạng thái · việc cuối · đang chờ gì. Xem kỹ một phòng → `/hq-log <id>`.
