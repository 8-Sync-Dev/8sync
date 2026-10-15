# Sprint delegation: why the lead works alone, and what fixes it (2026-10-15)

## Kết luận
1. **Lead đang tự làm gần hết.** Trên 11 session chính của 14 ngày qua, có 237 lần spawn Agent so với 4.670 lệnh Edit/Write/MultiEdit/Bash do lead tự gọi, tỉ lệ 0,051 (median theo session 0,034; 3 session không spawn lần nào). Chuỗi dài nhất lead tự làm không giao việc là 73 lệnh (đếm strict). Trong ~650 spawn không có lần nào thuộc role `plan` hay `critic`. Vì vậy trên HQ chỉ thấy phòng Lead sáng. [3]
2. **Song song chỉ có lợi khi việc tách được và mỗi worker có ranh giới rõ.**
   - Lead + subagent hơn single-agent 90,2% trên eval research nội bộ của Anthropic. Đổi lại tốn khoảng 15× token so với chat, và Anthropic nói việc code "có ít task thật sự song song hơn research". [2a]
   - Cognition cảnh báo các writer chạy song song sẽ ra quyết định ngầm mâu thuẫn nhau. [2b]
   - MAST nhóm lỗi multi-agent thành 3 loại: thiết kế hệ thống, lệch pha giữa agent, thiếu verify. [2d]
   - MetaGPT: đủ role (SOP) thì số lần sửa giảm từ 10 xuống 2,5 nhưng chi phí tăng khoảng 1,5×. [2c]
3. **Primitive có sẵn trong Claude Code:**
   - Subagent chạy nền (mặc định), lồng tối đa 3 tầng, tối đa 20 subagent cùng lúc.
   - Agent teams: docs khuyên 3–5 teammate, 5–6 task mỗi teammate.
   - Hook không spawn được agent. Exit 2 chặn được Stop, TeammateIdle và TaskCompleted, nhưng không chặn được PostToolUse.
   - Field `description` có "use proactively" là đòn bẩy để Claude tự giao việc. [1]

## Thiết kế đã chọn (đã làm trên nhánh feat/sprint-standup)
| Vấn đề | Cách xử lý | Vì sao |
|---|---|---|
| Lead tự làm (chỉ 5% số lệnh là giao việc) | skill `/sprint` (scrum master), gọi ở mọi phase của /ship, /ship-auto, /ship-loop, /autopilot; luật "≤5 lệnh Edit/Bash liên tiếp khi còn item độc lập" | skill là chỗ đặt hành vi duy nhất mà model đọc đúng lúc; hook không spawn được agent [1] |
| Role ngồi không | `8sync ccc standup <slug>`: bảng 7 role (khớp ghế HQ), exit 1 khi có role không có việc; `rest` bắt buộc ghi lý do | tạo một check có exit code để /ship-loop lặp tới khi pass; ngồi không thành lỗi nhìn thấy được |
| Tốn token vì việc giả | mỗi role có một "việc rẻ luôn có sẵn" (đọc trước backlog, test đỏ cho bug, review diff mới); ≤4 writer; Sonnet/quick-task | khoảng 15× token [2a]; code ít việc song song [2a] |
| Phòng sửa trùng file | `8sync ccc . goal "<mục tiêu>" --files …`; standup cảnh báo `⚠ trùng file`; SendMessage trước khi sửa; worktree cho writer song song | lỗi conflict của Cognition [2b] và nhóm "inter-agent misalignment" của MAST [2d] |
| Phòng không biết tên và mục tiêu của nhau | goal hiện ở `ccc . ls`, ở khối "Phòng khác đang làm" lúc SessionStart/compact, và trong `standup` | hook SessionStart cho chèn context, local, không gọi model [1] |
| Không verify | sprint review: reviewer + qa + verifier chạy song song; Definition of Done có CI 3 OS | nhóm "task verification" của MAST [2d] |

## Caveats
- Q3 chỉ đo theo tool call. Bash gồm cả lệnh CLI như gh, git, 8sync, nên không phải toàn bộ là sửa code. Thư mục project `-home-alexng-startup` không có transcript. Không tách được transcript của teammate với transcript do Agent spawn (not verified).
- Thông tin "Devin manages Devins" năm 2026 chỉ có nguồn thứ cấp: [UNVERIFIED].
- Hiệu quả của `/sprint` (tỉ lệ giao việc sau khi bật) chưa đo. Cách đo: chạy lại `.evidence/q3_measure.py` sau một tuần dùng.

## Sources
1. Q1, `.evidence/q1-primitives.md`: https://code.claude.com/docs/en/sub-agents, /agent-teams, /hooks, /costs, /settings-reference (đọc ngày 2026-10-15).
2. Q2, `.evidence/q2-orchestration.md`:
   - (a) https://www.anthropic.com/engineering/multi-agent-research-system
   - (b) https://cognition.com/blog/dont-build-multi-agents
   - (c) https://arxiv.org/abs/2308.00352
   - (d) https://arxiv.org/abs/2503.13657
3. Q3, `.evidence/q3-local.md` + `.evidence/q3_measure.py`: chỉ đếm số liệu local, không in nội dung.
