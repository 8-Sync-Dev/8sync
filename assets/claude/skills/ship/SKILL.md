---
name: ship
description: Chạy trọn gói explore → plan → implement → review → commit cho một feature/bug. Dùng khi user gõ /ship <mô tả task>.
argument-hint: <mô tả task>
---
Thực hiện đúng thứ tự, dùng task list (TaskCreate/TaskUpdate) để theo dõi:
1. Gọi subagent `explore` với task: $ARGUMENTS
2. Gọi subagent `plan`, đưa kết quả explore. Chuyển plan thành task list.
3. Với mỗi task: tự làm hoặc giao `task` / `quick-task` (song song nếu độc lập). Sau mỗi task chạy
   build/test của repo (CLAUDE.md / AGENTS.md).
4. Hết task: gọi `reviewer`. NOT MERGEABLE → tạo task mới từ BLOCKER/SHOULD, quay lại bước 3.
5. Cập nhật CHANGELOG.md, commit theo conventional commits. Không push.

Không hỏi người dùng trừ khi plan có câu hỏi chưa trả lời được. Không dừng khi còn task hoặc test fail.
