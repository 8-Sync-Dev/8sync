---
name: hq-artifact
description: "Xem, đọc hoặc đăng file kết quả ở tab Kết quả của HQ; báo cáo đăng bài (link Meta, ảnh chứng minh, ghi chú) vào phần Báo cáo của phòng"
argument-hint: "[ls [n] [--content N] | show <id> | add <file> [<file>…] [--title T] [--note N] [--session ID] [--content 38,16] [--link URL] [--for DIR]]"
---

# /hq-artifact — tab Kết quả của HQ

`$ARGUMENTS` — trống hoặc `ls [n]`: danh sách; `show <id>`: đọc một kết quả; `add <file> [--title T] [--note N]`: đăng file vừa làm.

Chạy `node ~/.omp/skills/hq-control/scripts/hq.mjs …` (skill `hq-control`; luật đầy đủ: `~/.omp/skills/hq-control/SKILL.md`). HQ phải đang chạy (`8sync hq ui`); script báo "HQ is not answering" → bảo chủ mở HQ, không tự mở HQ thứ hai. Không in token hay link `--public`. `~` để trần (không ngoặc kép) để bash tự mở rộng cả khi `$HOME` trống; PowerShell dùng `$HOME` thay `~`.

- **Danh sách:** `node ~/.omp/skills/hq-control/scripts/hq.mjs artifact ls [n]` → `id · dự án · loại · cỡ (MISSING = file đã mất) · tiêu đề · đường dẫn`, mới nhất trước.
- **Đọc:** `node ~/.omp/skills/hq-control/scripts/hq.mjs artifact show <id>` → dòng thông tin + ghi chú, rồi nội dung nếu là md/txt/json/csv/log (tối đa 40 000 ký tự). Ảnh/video/PDF/HTML: script in đường dẫn → mở bằng công cụ đọc ảnh/PDF của mình.
- **Đăng:** chỉ file chủ cần xem (kết quả cuối, không nháp, không file có bí mật): `node ~/.omp/skills/hq-control/scripts/hq.mjs artifact add <file> --title "<tên ngắn>" --note "<là gì, xem gì>" --session <id phòng mình>` → báo chủ "đã đăng lên tab Kết quả" kèm `id`. 403 (ngoài dự án HQ biết) / 422 (loại hay tên bị từ chối) / 413 (quá cỡ) → báo chủ đường dẫn, không copy file đi chỗ khác để lách. HQ chưa có `/api/artifacts` (404) → HQ cũ, bảo chủ `8sync up`.
- **Kết quả của bài đăng (Nội dung):** thêm `--content <id bài>[,<id>…]` để ảnh/file hiện trong sheet của bài đó, `--link <https>` cho nút mở (Meta Business Suite "đã lên lịch", sau đó permalink thật: đăng lại cùng file với `--link` mới), `--for <thư mục dự án>` khi file nằm ở repo khác dự án nó thuộc về (vd file cho dự án A làm trong repo B). `--content ""` bỏ liên kết. `ls --content N`: kết quả của một bài. Số liệu bài: `/hq-metrics`.
- **Báo cáo đăng bài (luôn làm):** lên lịch hay đăng xong một bài → ngay lúc đó `node ~/.omp/skills/hq-control/scripts/hq.mjs artifact add <ảnh chứng minh> [<ảnh>…] --title "<kênh · bài>" --link <link Meta/permalink> --note "<trạng thái, giờ lên, số liệu, ghi chú>" --content <id bài nếu có> --session <id phòng mình>`. Nó hiện ở phần **Báo cáo** dưới phòng mình trong HQ (nút mở link, ảnh, ghi chú, bài trong Nội dung); các file cùng `--link` là một dòng. Có permalink thật hay số liệu mới → `add` lại đúng các file đó với `--link`/`--note` mới để cập nhật. `--session` = id phòng mình (cột đầu của `ls`, dòng có nhãn và `cwd` của mình); thiếu nó báo cáo không hiện dưới phòng.

Không có tham số → chạy `ls 10` và tóm tắt.
