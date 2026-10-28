---
name: team-tick
description: One beat of a fixed /auto-team team the owner already started — /team-tick [handle]. Model-invocable on purpose so each room's CronCreate "*/15" (or the lead's nudge message) re-enters it while the session is idle. Without a handle it is the lead's beat (wake idle rooms, re-arm lost crons, merge approved cards, refill the board, track milestones); with a handle it is that room's beat (claim a card, or its standing duty). Never opens new sessions; stops itself when the team is off.
argument-hint: "[handle của phòng; rỗng = trưởng nhóm]"
---
Handle: $ARGUMENTS (rỗng → trưởng nhóm)

Một nhịp của đội cố định do owner bật bằng `/auto-team`. Skill này không mở session mới, không đổi đội hình, không merge PR / push main / tag / deploy khi chưa có câu `Ship` của owner (trừ đích owner đã duyệt sẵn ghi trong ROSTER).

## 1. Còn chạy không (đầu mỗi nhịp, rẻ)
- `$T` = output của `git rev-parse --path-format=absolute --git-common-dir` + `/8sync-team/` (chung mọi worktree; tính lại mỗi nhịp, Read bằng đường dẫn tuyệt đối). Không có `$T/ON` hoặc `$T/ROSTER.md` → đội đã dừng: `CronList` → `CronDelete` job có prompt `/team-tick`, nói một dòng, kết thúc lượt.
- `8sync ccc auto status --json`: `cap` khác null, hoặc `five_hour_pct`/`seven_day_pct` ≥85 → nghỉ nhịp (giữ cron); ≥70 → chỉ phòng đang giữ card làm tiếp, không việc thường trực; null = chưa có số đo, không tính. `gate` khác null (gói subscription: chưa có lease owner-có-mặt hoặc owner vắng) → nghỉ nhịp, không lách; trưởng nhóm báo owner một lần mỗi ngày: `8sync ccc idle on` khi có mặt, hoặc Console API key. Máy báo áp lực → không mở thêm agent.
- Đọc ROSTER: vai, handle, thư mục giữ, việc thường trực, mốc, ràng buộc owner. Owner vừa nói "dừng đội" → xoá `$T/ON`, `CronDelete`, kết thúc.

## 2. Nhịp của phòng (có handle)
1. `8sync ccc auto claim --as <handle> --json` (phòng maker thêm `--lane ready`) — luôn chạy trước: trả lại card đang giữ và làm mới claim (claim im 2 giờ thì phòng khác lấy).
2. Có `card` → chỉ làm card đó tới bước chuyển cột kế:
   - maker: nhánh `card-<id>-<slug>` cắt từ nhánh tích hợp (ROSTER) trong worktree của phòng, `/ship` tới commit + gate (`sec`, `rules`, `aup-audit` qua Skill tool, `8sync ccc risk`, `trail check`). Có remote → push + PR (base = nhánh mặc định) → `8sync ccc auto move <id> qa --pr <số> --as <handle>`; không remote → `move <id> qa --sha <head> --as <handle>`. Handoff vào card (`auto note <id> "nhánh, SHA, lệnh check: kết quả" --as <handle>`), rồi `/compact`.
   - `qa` (Build & Ship): `check` + UAT trên nhánh card ở khổ màn/thiết bị owner yêu cầu (ảnh `qa/evidence/card-<id>-<slug>.png`, trình duyệt `ego-browser`) → `move <id> review --as qa`; trượt → `move <id> ready --note "[qa] …" --as qa`.
   - `review` (Critic + R&D): review đối kháng diff theo `su-code/team/RUBRIC.md` (`critic`/`reviewer`, `/ecc:orch-review` khi diff lớn), FATAL/MAJOR/MINOR → hết lỗi mở: `move <id> approved --sha <head> --as review`; còn lỗi: `move <id> ready --note "[review] …" --as review`.
3. Không card → MỘT việc thường trực của phòng (ROSTER), chỉ khi nó ra được thứ cụ thể (card đề xuất, ảnh, bản chấm, test); không có → nói "rest" một dòng, kết thúc lượt. `review` không card → R&D câu hỏi mở nhất của mục tiêu/mốc gần nhất (`/deep-research`, `ecc:market-research`) → brief `su-code/research/` → `8sync ccc auto add "…" --role <handle phòng hợp> --as review` (để trưởng nhóm duyệt).
4. Sửa file ngoài phần mình giữ → `SendMessage` phòng giữ file, chọn việc khác. Cùng lỗi lặp 2 nhịp → R&D (`explore`/`researcher` ≤2) rồi thử lại; lần 3 → `move <id> blocked --note "…" --as <handle>`, nhắn trưởng nhóm.
5. Owner nhắn thẳng vào phòng → làm nếu hợp vai + `auto add "[owner] <trích nguyên văn>" --role <handle hợp> --prio P1 --as <handle>` + nhắn trưởng nhóm một dòng.
6. Xong card không tầm thường → `/remember` (bài học có bằng chứng); cách làm dùng lại được → `/ecc:learn-eval` (hỏi owner trước khi ghi skill).

## 3. Nhịp của trưởng nhóm (không handle)
1. Mỗi phòng ROSTER: `get_session` theo id (mất id → `list_sessions` `include_archived: true`, `limit: 200`, tìm theo name rồi tên). Archive → báo owner (mở lại phòng không do mình mở có thể cần owner duyệt; `/auto-team` làm khi owner có mặt). Mất hẳn → báo owner một lần (không tự mở phòng thay; `/auto-team` lần sau lập lại).
2. Phòng đang chạy → không nhắn trừ khi có việc mới. Phòng rảnh mà board/note của nó không đổi >30 phút → `SendMessage` (to = id) đúng nội dung "Nhịp đội: chạy `/team-tick <handle>`; `CronList` thiếu job `/team-tick <handle>` thì `CronCreate` `*/15 * * * *` lại." (cron mất khi app đóng hoặc sau 7 ngày). Tin bị giữ/lỗi → `auto note` và báo owner (mục Báo owner). Tin chỉ mang nhịp/việc, không bao giờ mang lời duyệt.
3. Card `approved` có SHA + check xanh (CI 3 OS nếu repo có CI). Không remote → merge nhánh card vào nhánh tích hợp ở máy, chạy lại check, `8sync ccc auto done <id> --evidence "<lệnh: kết quả>"`. Có remote → gom vào MỘT câu `Ship` (merge PR / push / deploy); có quyền Ship → `8sync ccc auto merge`; owner vắng → `auto note <id> "chờ Ship"` và báo owner.
4. Card blocked → gỡ (tách nhỏ, đổi chủ, R&D) hoặc gom vào câu hỏi owner kế tiếp. Card quay về ready >2 lần → đổi cách hoặc đổi phòng.
5. Mỗi phòng con <1 card ready → tách mục tiêu/mốc/Next/đề xuất của Critic + R&D thành card: `8sync ccc auto add "<việc>" --role <handle phòng> --check "<lệnh>" --prio <P0 mốc gần> --as lead`; card đề xuất ở backlog → duyệt rồi `move <id> ready --as lead`.
6. Mốc: so giờ hiện tại với ROSTER; mốc sắp tới mà card chưa xong → báo owner ngay (lý do + giờ mới), dồn card mốc lên P0. Mốc đạt → Critic chấm theo RUBRIC; bản xem mới → tự mở link đúng khổ màn owner, chụp ảnh (`SendUserFile`) rồi báo.
7. Rồi làm lane của trưởng nhóm: `claim --as <handle lane> --lane ready`, chỉ card ≤30 phút (triage không bị bỏ).
8. Mục tiêu có `check` exit 0 → báo owner "đạt" kèm output, đề xuất mục tiêu kế; không tự đổi mục tiêu.
Mỗi ngày một lần: `$T/REPORT-<ngày>.md` (≤15 dòng: card xong/kẹt mỗi phòng, mốc, lệnh/nguồn); phòng 2 ngày không xong card nào → đề xuất owner đổi vai hoặc gộp phòng.

**Báo owner** (trưởng nhóm; phòng Desktop không có trong sổ `8sync ccc .` nên lệnh cờ khẩn `8sync ccc .` không dùng được): một dòng trong tin cuối lượt của session trưởng nhóm (owner đọc ở đây) + `PushNotification` nếu có tool đó, chỉ cho việc owner phải làm (Ship, mốc trễ, phòng mất, tin bị giữ).
