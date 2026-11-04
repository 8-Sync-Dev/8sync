---
name: hq-send
description: "Nhắn hoặc giao việc cho một phòng khác qua HQ"
argument-hint: "<id> <tin nhắn…>"
---

# /hq-send — nhắn một phòng

`$ARGUMENTS` — `<id> <tin nhắn…>`. Thiếu id → `node "$HOME/.omp/skills/hq-control/scripts/hq.mjs" ls`, hỏi chủ chọn phòng. Thiếu tin → hỏi chủ nhắn gì.

Chạy `node "$HOME/.omp/skills/hq-control/scripts/hq.mjs" …` (skill `hq-control`; luật đầy đủ: `~/.omp/skills/hq-control/SKILL.md`). HQ phải đang chạy (`8sync hq ui`); script báo "HQ is not answering" → bảo chủ mở HQ, không tự mở HQ thứ hai. Không in token hay link `--public`.

1. Không gửi cho chính phòng mình (so nhãn và `cwd` trong `ls`). Phòng đang `running`: chỉ gửi khi cần (dừng, đổi hướng, phụ thuộc file); hỏi tiến độ thì dùng `/hq-log`.
2. Một lệnh cho cả tin (nhiều dòng vẫn là một đối số), mở đầu bằng nguồn, chuyển nguyên lời chủ: `node "$HOME/.omp/skills/hq-control/scripts/hq.mjs" send <id> "[từ phòng <tên mình>] <tin>"`. Không thêm yêu cầu chủ chưa nói.
3. `node "$HOME/.omp/skills/hq-control/scripts/hq.mjs" msgs <id> 1` → báo chủ `delivery`. `failed`/`error` → báo, không gửi lại liên tục.
