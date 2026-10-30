---
name: ship-auto
description: Auto ship through release, level 3 — /ship-auto <việc>. Runs the full /ship process (plan → code → test → UAT → review → commit) then ONE "Ship" AskUserQuestion, then PR → CI → merge → tag/release → install → monitor until green. Owner-only.
argument-hint: <mô tả task>
disable-model-invocation: true
---
Task: $ARGUMENTS

Level 3. Chỉ owner khởi động (`disable-model-invocation: true` — Claude không tự gọi; cũng không chạy khi scheduled task dùng skill này làm prompt, theo https://code.claude.com/docs/en/skills#frontmatter-reference).

1. **Làm như `/ship`** — đọc `ship/SKILL.md` và chạy đủ phase 1–8 (plan, R&D khi có ẩn số, code, test, UAT, review/QC, docs + memory, commit); bài học → `/remember`. Trạng thái ở `su-code/ship/<slug>/STATE.md` (tạo nếu chưa có, kể cả việc nhỏ) + dòng trong `su-code/ship/ACTIVE`. Việc quá lớn/nhiều ẩn số → nói owner chia thành mục tiêu có tiêu chí và dùng `/ship-loop`.
2. **Rails trước khi hỏi** — `8sync ccc risk` in gate bắt buộc từ tên file đổi; `/sec` trên diff: gọi skill `sec` (Skill tool) trước commit, bắt buộc, không thay bằng grep tay; dán kết luận của nó vào báo cáo. Không chạy được → dừng trước commit, báo owner; `/rules` + `/aup-audit` khi diff đụng auth/OAuth, thu thập dữ liệu, nhắn người ngoài, tool bên thứ ba, high-risk (BLOCK → dừng, báo owner). Build/test nặng chỉ chạy trên CI: push nhánh feature + `gh workflow run` cho CI được phép TRƯỚC câu hỏi Ship (guard chỉ chặn merge/push main/tag/release/publish/deploy) → `gh run watch <id> --exit-status` chạy nền → `gh run view <id> --log-failed`; local chỉ lint/test một module, `nice -n 19 ionice -c3`, `-j2`. Ngay sau lần push đầu: `CronCreate` `*/5 * * * *` → `/ship-tick <slug>` (recurring) để lượt sau đọc kết quả CI, sửa đỏ, rồi đi tiếp tới câu hỏi Ship mà owner không phải gõ lại; ẩn số → `researcher`/`deep-research-web` theo `ship-tick`.
3. **Không có remote/CI** (`git remote` rỗng hoặc repo không có workflow) → commit xong thì dừng, ghi `Ship: n/a (no remote)` vào STATE + báo cáo; không tạo remote, không hỏi Ship.
4. **Ship một lần** — gom TẤT CẢ bước có tác dụng ngoài máy (push, PR, merge, tag, release, publish, install/deploy) liệt kê từng cái cụ thể (tên nhánh, PR, tag dự kiến) vào MỘT `AskUserQuestion` header `Ship`, options đúng: `Duyệt tất cả (Recommended)` · `Chỉ merge, chưa deploy` · `Dừng`. Hook ghi giấy phép 8 giờ cho session; guard không hỏi lại từng lệnh. Owner chọn `Dừng`, hoặc nói "dừng"/"stop" bất cứ lúc nào → kết thúc ngay, ghi STATE. Không bao giờ dùng `bypassPermissions`/`--dangerously-skip-permissions`; guard vẫn chặn force-push, secret, thao tác phá huỷ.
5. **Thực thi theo lựa chọn**:
   - push nhánh → `gh pr create` → `gh pr checks --watch` chạy nền (`run_in_background`); đỏ → `gh run view <id> --log-failed`, sửa gốc, push lại (tối đa 3 vòng rồi báo thật, không sửa test cho pass); CI phải xanh trên cả Windows, macOS và Linux (test + build release) trước merge/tag; OS nào chưa có job → ghi "not verified: <OS>" và không merge;
   - xanh → `gh pr merge`; chọn "Chỉ merge, chưa deploy" thì dừng sau bước này;
   - tag/release theo quy ước repo (CHANGELOG Unreleased → version) → theo dõi workflow release;
   - nếu có: `8sync up` (cập nhật binary đã cài) và kit refresh (`8sync ccc kit`) — repo không có thì ghi "n/a".
6. **Monitor** — theo dõi workflow/health tới khi xanh (`gh run watch --exit-status` nền, hoặc `/loop` nếu cần poll; lưu ý `/loop` chỉ chạy khi session mở, hết hạn sau 7 ngày — https://code.claude.com/docs/en/scheduled-tasks). Đỏ → đọc log, quay lại sửa. Ghi kết quả vào STATE, xoá dòng khỏi `ACTIVE`, `CronList` → `CronDelete` job `/ship-tick <slug>`.

Báo cáo cuối: phase xong + bằng chứng (lệnh + output), PR/tag/run URL, cái chưa verify, việc owner cần làm. Mọi câu "xong/pass" phải kèm lệnh + output; không có → "not verified".
