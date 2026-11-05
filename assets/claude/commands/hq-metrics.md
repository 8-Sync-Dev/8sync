---
name: hq-metrics
description: "Ghi hoặc xem số liệu một bài đã đăng (Nội dung › Tổng quan của HQ)"
argument-hint: "[ls [--content N] | add --content N --platform P [--url U] [--reach N] [--reactions N] [--comments N] [--shares N] [--views N]]"
---

# /hq-metrics — số liệu bài đăng trong HQ

`$ARGUMENTS` — trống hoặc `ls [--content N]`: số mới nhất mỗi bài và nền tảng; `add …`: ghi một lần đọc số.

Chạy `node ~/.omp/skills/hq-control/scripts/hq.mjs …` (skill `hq-control`; luật đầy đủ: `~/.omp/skills/hq-control/SKILL.md`). HQ phải đang chạy (`8sync hq ui`); "HQ is not answering" → bảo chủ mở HQ. Không in token hay link `--public`. `~` để trần (không ngoặc kép); PowerShell dùng `$HOME`.

- **Xem:** `node ~/.omp/skills/hq-control/scripts/hq.mjs metrics ls [--content N]` → `#id · nền tảng · giờ đọc · reach/reactions/comments/shares/views · số lần đọc · link`.
- **Ghi:** chỉ số đọc thật từ trang (Business Suite › Nội dung › Đã đăng hoặc Insights, đăng nhập bằng ego profile "8sync FB"), không ước lượng: `node ~/.omp/skills/hq-control/scripts/hq.mjs metrics add --content <id bài> --platform facebook --url <permalink https> --reach N --reactions N --comments N --shares N --views N --session <id phòng mình>`. Bỏ trống số không đọc được (không ghi 0 thay). `--at "2026-11-05 21:30"` khi số là của giờ khác lúc ghi.
- Mỗi lần `add` là một bản ghi mới (không đè); HQ hiện bản mới nhất mỗi bài + nền tảng và cộng lại ở Tổng quan. 422 → đọc lỗi (thiếu số, url không https, giờ ở tương lai) rồi sửa; HQ chưa có `/api/content/metrics` (404) → HQ cũ, bảo chủ `8sync up`.
- Có link bài thật rồi → đổi link của ảnh bằng chứng: `artifact add <ảnh> --content <id> --link <permalink>` (cùng file = cập nhật, giữ id).

Không có tham số → chạy `ls` và tóm tắt theo nền tảng.
