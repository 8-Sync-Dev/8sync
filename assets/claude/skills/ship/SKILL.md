---
name: ship
description: Chạy trọn gói explore → plan → implement → review → commit cho một feature/bug. Dùng khi user gõ /ship <mô tả task>.
argument-hint: <mô tả task>
---
Thực hiện đúng thứ tự, theo dõi bằng task list (TaskCreate/TaskUpdate):
1. Repo lạ hoặc task chạm nhiều module → subagent `explore` với task: $ARGUMENTS. Repo nhỏ/đã quen → tự đọc, bỏ bước này.
2. Tự viết plan ngắn ngay trong lượt này (không cần subagent) rồi chuyển thành task list.
3. Mỗi task: tự làm hoặc giao `task` / `quick-task` (song song nếu độc lập). Sau mỗi task chạy build/test của repo.
4. Hết task: gọi `reviewer`. NOT MERGEABLE → tạo task mới từ BLOCKER/SHOULD, quay lại bước 3.
5. Diff thêm tính năng thu thập dữ liệu người dùng, chat với người ngoài, scrape/nhắn tin hàng loạt, hoặc đụng file credential → chạy `/aup-audit` trên phần thay đổi; BLOCK thì dừng và báo user.
6. Cập nhật CHANGELOG.md, commit theo conventional commits. Không push.

Không hỏi người dùng trừ khi plan có câu hỏi chưa trả lời được. Không dừng khi còn task hoặc test fail.
