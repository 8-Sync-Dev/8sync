---
name: hq-ls
description: "Xem các phòng Claude Code/omp đang mở qua HQ: ai đang làm gì, phòng nào đang chờ hộp thoại"
argument-hint: "[--all]"
---

# /hq-ls — các phòng đang làm gì

`$ARGUMENTS` — `--all` để gồm cả phòng đã kết thúc.

Chạy `node "$HOME/.omp/skills/hq-control/scripts/hq.mjs" …` (skill `hq-control`; luật đầy đủ: `~/.omp/skills/hq-control/SKILL.md`). HQ phải đang chạy (`8sync hq ui`); script báo "HQ is not answering" → bảo chủ mở HQ, không tự mở HQ thứ hai. Không in token hay link `--public`.

1. `node "$HOME/.omp/skills/hq-control/scripts/hq.mjs" ls $ARGUMENTS` → mỗi phòng một dòng `id · nhãn · status · engine · cwd · việc đang làm`.
2. Phòng có `WAITING`: `node "$HOME/.omp/skills/hq-control/scripts/hq.mjs" dialog <id> permission` (hoặc `question`) để đọc nguyên văn. Chỉ đọc: hộp thoại quyền thì chủ bấm trong HQ, không tự trả lời.
3. Báo chủ một bảng: nhãn · trạng thái · việc cuối · đang chờ gì. Muốn xem kỹ một phòng → `/hq-log <id>`.
