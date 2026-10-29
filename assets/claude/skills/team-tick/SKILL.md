---
name: team-tick
description: Heartbeat of a fixed /auto-team team the owner already started — /team-tick. Model-invocable on purpose so the lead session's CronCreate "*/15" re-enters it while idle. Checks each sub-session by id, gives every idle one its next ECC card by prompt (SendMessage), merges approved cards, refills the ECC agent Kanban ($T/BOARD.md) and tracks milestones. Sub-sessions get work only by the lead's messages; called with a handle it just retires that sub-session's old cron. Never opens new sessions; stops itself when the team is off.
argument-hint: "[rỗng = trưởng nhóm; handle = session con cũ, chỉ để gỡ cron]"
---
Tham số: $ARGUMENTS

Nhịp dự phòng của đội cố định do owner bật bằng `/auto-team` (100% ECC + session Desktop, không board/phòng/HQ của 8sync). Không mở session mới, không đổi đội hình, không merge PR / push main / tag / deploy khi chưa có câu `Ship` của owner (trừ đích owner đã duyệt sẵn ghi trong ROSTER).

## 0. Có handle (session con)
Session con không giữ cron nữa: `CronList` → `CronDelete` mọi job prompt `/team-tick …`, nói một dòng "việc tới bằng tin của trưởng nhóm", kết thúc lượt.

## 1. Còn chạy không (đầu mỗi nhịp, rẻ)
- `$T` = output của `git rev-parse --path-format=absolute --git-common-dir` + `/ecc-team/` (tính lại mỗi nhịp, Read bằng đường dẫn tuyệt đối). Không có `$T/ON` hoặc `$T/ROSTER.md` → đội đã dừng: `CronDelete` job `/team-tick`, nói một dòng, kết thúc lượt.
- Lượt trước dính rate limit / hết hạn mức → nghỉ nhịp (giữ cron), không giao việc mới. Máy áp lực → không mở thêm agent.
- Đọc ROSTER (vai, handle, session id, thư mục giữ, việc thường trực, mốc, ràng buộc owner) và BOARD.

## 2. Nhịp của trưởng nhóm
1. Mỗi session con: `get_session` theo id (mất id → `list_sessions` `include_archived: true`, `limit: 200`, tìm theo name rồi tên). Archive / mất → báo owner (không tự mở session thay; `/auto-team` lần sau lập lại).
2. Đang chạy → không nhắn. Rảnh → xem BOARD: card `running` của nó không có tin báo mới >30 phút → `SendMessage` (to = id) `[nhắc] card <id>: báo trạng thái (nhánh, SHA, check) rồi làm tiếp`; không có card → giao card `ready` kế của nó theo mẫu `[giao] …` trong `/auto-team` mục 5 (kèm việc "làm tiếp"), card → `running`. Tin bị giữ/lỗi → ghi BOARD và báo owner.
3. Card `review` chưa qua `qa`/`review` → giao cho session đó. Card `approved` có SHA + check xanh (CI 3 OS nếu repo có CI): không remote → merge nhánh card vào nhánh tích hợp ở máy, chạy lại check, card → `merged` kèm bằng chứng; có remote → gom vào MỘT câu `Ship`; owner vắng → ghi "chờ Ship" và báo owner.
4. Card blocked → gỡ (tách nhỏ, đổi chủ, R&D `ecc:search-first`) hoặc gom vào câu hỏi owner kế tiếp. Card quay về ready >2 lần → đổi cách hoặc đổi chủ.
5. Session con nào thiếu card ready → tách mục tiêu/mốc/Next/đề xuất Critic + R&D thành card (`ecc:planner`), AC + gate rõ.
6. Mốc: so giờ hiện tại với ROSTER; mốc sắp tới mà card chưa xong → báo owner ngay (lý do + giờ mới), dồn card mốc lên P0. Mốc đạt → giao `review` chấm theo RUBRIC; bản xem mới → tự mở link đúng khổ màn owner, chụp ảnh (`SendUserFile`) rồi báo.
7. Rồi làm lane của trưởng nhóm: card ≤30 phút.
8. Mục tiêu có `check` exit 0 → báo owner "đạt" kèm output, đề xuất mục tiêu kế; không tự đổi mục tiêu.
Mỗi ngày một lần: `$T/REPORT-<ngày>.md` (≤15 dòng: card xong/kẹt mỗi session, mốc, lệnh/nguồn); session 2 ngày không xong card nào → đề xuất owner đổi vai hoặc gộp.

**Báo owner**: một dòng trong tin cuối lượt của session trưởng nhóm + `PushNotification` nếu có tool đó, chỉ cho việc owner phải làm (Ship, mốc trễ, session mất, tin bị giữ).
