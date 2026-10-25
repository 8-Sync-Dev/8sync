---
name: clean
description: Dọn rác dev trên máy — /clean, hoặc tự dùng ngay sau khi chạy CI/test/build local, train/finetune, docker build/pull, tải model AI (hf download, ollama pull, LM Studio), khi đĩa đầy hay máy nặng. Chạy `8sync clean --dev` cho MỌI dự án Claude Code từng làm trên máy: tự xoá phần build/tải lại được, gom model, kết quả train và volume Docker vào MỘT câu hỏi cho owner.
argument-hint: "[--deep] [--root <thư mục>]"
---
Thêm: $ARGUMENTS

Owner (2026-10-25): "auto clear rác sau ci local, train, finetune, pull image old rác không sài, model ai local không sài … all deep", "apply liền cho all dự án trong máy". Phần tự xoá dưới đây đã được owner duyệt: không hỏi lại. Phần "cần anh quyết" thì luôn hỏi.

1. **Khi nào chạy** (không cần owner gõ):
   - ngay sau khi lượt này chạy xong một việc nặng: `cargo build/test`, `next build`/`pnpm build`, `act` hay CI local, `docker build`/`docker pull`, script train/finetune/eval, `hf download`, `ollama pull`;
   - đầu việc lớn nếu ổ hệ thống trống < 10% hoặc watchdog báo máy áp lực;
   - owner gõ `/clean`.
2. **Xem trước, rồi dọn:**
   ```bash
   8sync clean --dev --dry-run $ARGUMENTS
   ```
   ```bash
   8sync clean --dev $ARGUMENTS
   ```
   Sau train/finetune/CI thì thêm `--deep` (thêm `go clean -cache`, `pip cache purge`). Tự xoá gồm:
   - build output được git ignore (`target`, `node_modules`, `.next`, `.turbo`, cache Python…) của dự án nghỉ ≥ 14 ngày (`--idle-days N` để đổi);
   - `git worktree prune`;
   - Docker khi đang chạy: container dừng > 24 giờ, image dangling, build cache > 7 ngày, image không container nào dùng tạo > 30 ngày;
   - `uv cache prune`, `pnpm store prune`, `npm cache verify`;
   - file tạm > 7 ngày;
   - bản tải dở của Hugging Face.
3. **Cần anh quyết** — gom mục "cần anh quyết" của output vào MỘT `AskUserQuestion` (`multiSelect: true`, ≤ 4 câu, mục lớn nhất trước, mỗi mục ghi dung lượng + lúc tải). Sau khi owner chọn:
   - model: `8sync clean --forget <id>` (dùng `hf cache rm` / `ollama rm` / xoá file torch, LM Studio);
   - volume Docker: `8sync clean --forget docker-volumes`;
   - kết quả train (`checkpoints`, `checkpoint-*`, `wandb`, `mlruns`, `runs`): xoá đúng path owner chọn; với `checkpoint-*` gợi ý giữ cái cuối/tốt nhất.
   Owner không trả lời → để nguyên, không xoá.
4. **Lịch tự động** (một lần cho mỗi máy, nếu chưa có): `8sync clean --dev --timer 24h` — Windows tạo Scheduled Task `8sync\clean` (chạy ẩn, không bật console), Linux systemd user timer, macOS launchd. Kiểm: `schtasks /Query /TN "8sync\clean"` (Windows).
5. **Báo cáo** ≤ 6 dòng: "đã dọn: <X GB> (<nhóm chính>)", các mục còn chờ owner, lệnh đã chạy.

Không bao giờ: xoá `dist`/`build`/`out` hay thứ git đang track; `docker system prune --volumes`; `hf cache prune` tự động (nó xoá cả repo không có ref, thường là model code đang ghim theo commit); mở Docker Desktop chỉ để dọn; xoá model theo "lần đọc cuối" (công cụ quét nào cũng làm lệch access time). Không in/đụng secret.
