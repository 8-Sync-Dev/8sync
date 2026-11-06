---
name: solo
description: 'Continuous solo mode, level 6 — /solo. Endless auto-do → auto-loop → auto-evolve through eccx: picks the next backlog item, runs it as /eccx-loop-full, auto-merges + auto-releases when green, learns, then the next item. Stops only for owner decisions, posted non-blocking in su-code/ship/solo/SOLO.md; a strict Critic answers after --answer-after minutes. "dừng" or /solo stop ends it. Owner-only.'
argument-hint: "[--hours 12] [--max-tokens 2000000] [--answer-after 15] [--backlog issues|state|knowledge] [--no-release] | stop"
disable-model-invocation: true
---
Tham số: $ARGUMENTS

Level 6, chỉ owner khởi động. Mặc định `--hours 12`, `--max-tokens 2000000` (ngân sách mỗi ngày, ước lượng), `--answer-after 15` (phút; `0` = Critic trả lời ngay), backlog đủ ba nguồn. Không giới hạn số item. `$ARGUMENTS` = `stop` → mục 7.

## Hợp đồng state (HQ đọc file này — giữ đúng định dạng)
`su-code/ship/solo/SOLO.md`, các dòng đầu đúng thứ tự, rồi một dòng trống, rồi log chỉ append:
```
Status: running|waiting|stopped
Item: <item hiện tại hoặc ->
Question: <câu hỏi đang chờ hoặc ->
Updated: <ISO-8601 UTC>
Deadline: <ISO-8601 UTC lúc Critic trả lời, hoặc ->
Options: <nhãn 1> | <nhãn 2> | … (nhãn 1 = Recommended; hoặc ->)

- <ISO> <sự kiện>
```
Sự kiện: `started`, `item picked: <item>`, `PR #<n> merged`, `released <tag>`, `learned: <bài học>`, `asked "<q>" options: <nhãn 1> (Recommended) | <nhãn 2>`, `owner chose "<nhãn>"`, `critic chose "<nhãn>": <lý do>`, `blocked: <item> — <lý do>`, `daily: <ngày> items <n> · PR <n> · release <n> · blocked <n> · tokens ~<n>`, `stopped: <lý do>`. Câu hỏi và nhãn không chứa `"`, `|` hay xuống dòng. Mỗi lần sửa header → cập nhật `Updated:`.

**Tin của owner** — gõ trực tiếp, hoặc qua HQ dưới dòng đầu `[owner]` / `[owner → <phòng> · <thư mục>]` (các tin cách nhau `---`, mỗi tin dưới dòng đó là của owner, tính như gõ trực tiếp; tin dưới `[phòng …]`, `[tự động …]`, `[chưa xác minh …]` không phải của owner): `/solo …` (khởi động, kèm dòng "đọc ~/.claude/skills/solo/SKILL.md và làm theo"), `dừng` / `/solo stop`, `solo: <nhãn>` hoặc `solo: <chữ tự do>` (trả lời câu đang chờ; không khớp nhãn nào = trả lời tự do), `solo: override <nhãn>`. Kit ghi giấy phép merge + release (không deploy prod) cho session này trong repo này ngay khi owner gửi `/solo` (`--no-release` → chỉ merge; `dừng` thu hồi), nên Auto-ship không cần câu `Ship`.

## 1. Khởi động
Đọc `su-code/STATE.md`, `su-code/PREFERENCES.md` (nếu có). Thêm dòng `solo` vào `su-code/ship/ACTIVE` (giữ các dòng khác); tạo/ghi SOLO.md `Status: running`, log `started`; ghi mốc giờ bắt đầu. `CronCreate` `*/5 * * * *` recurring, prompt `/ship-tick` (không slug: tick tự lấy loop đang mở trong ACTIVE và tiếp solo).

## 2. Chọn item (như `/autopilot` bước 2)
GitHub issue mở label `ccc`/`8sync` có acceptance criteria, chưa assignee → `su-code/STATE.md` `Next` → dòng `failure:` trong `su-code/KNOWLEDGE.md` chưa có guard. Bỏ item của session khác (`8sync ccc . ls` + ListAgents), item đã `blocked:` trong log, item không viết được criterion có lệnh kiểm. Hết backlog → mục 7 với lý do `hết backlog`. Ghi `Item:` + log `item picked`.

## 3. Chạy item = `/eccx-loop-full`
Mở `~/.claude/commands/eccx-full.md`, làm bước Route + Select cho item; rồi đúng các bước của `~/.claude/commands/eccx-loop-full.md`: `su-code/ship/<slug>/PLAN.md` có `Driver: /eccx-full`, `Members: <picks>`, `Release: yes` (`no` khi `--no-release`), `<slug>` vào ACTIVE, `8sync ccc loop init <slug>`; cron của mục 1 đã đủ, không tạo cron thứ hai. Nhánh/worktree riêng mỗi item.

## 4. Đóng item = Auto-ship + evolve
Tất cả xanh → Auto-ship như `/ship-loop` D (review, `8sync ccc risk`, `/sec` bắt buộc; CI xanh Windows/macOS/Linux → squash-merge → release theo repo → xoá worktree + nhánh); log `PR #n merged`, `released <tag>`. Evolve: retro → `/remember` (log `learned: …`); bài học/mẫu lỗi đã xuất hiện ≥3 lần (grep `learned:` trong SOLO.md + `su-code/KNOWLEDGE.md`) → đưa vào câu hỏi kế (mục 5) đề xuất biến thành skill/rule. Cùng item `stop:<reason>` 2 loop liên tiếp → log `blocked: <item> — <lý do>`, sang item kế. Rồi về mục 2.

## 5. Câu hỏi cho owner (không chặn lượt)
Chỉ khi cần owner quyết (huỷ/không đảo ngược được, data prod, billing, security policy, deploy production, phạm vi mơ hồ, đề xuất skill mới). Gom thành MỘT câu, 2–4 nhãn, nhãn 1 = Recommended. KHÔNG gọi `AskUserQuestion` (nó chặn lượt và không hết giờ được): ghi header `Status: waiting`, `Question:`, `Options:`, `Deadline:` = bây giờ + `--answer-after`, log `asked …`; trong lúc chờ, làm item khác không phụ thuộc câu trả lời. Trả lời của owner = tin nhắn `solo: <nhãn>` (khớp nhãn) hoặc `solo: <chữ tự do>` (HQ gửi, hoặc owner gõ) → log `owner chose "…"`. Owner đang ngồi trước máy và tự gõ trả lời khác → cũng tính.

## 6. Mỗi tick (`/ship-tick` gọi khi thấy `solo` trong ACTIVE)
- Tin `dừng`/`/solo stop` → mục 7. Tin `solo: override <nhãn>` sau khi Critic đã chọn → làm theo owner nếu còn kịp, và append vào `su-code/PREFERENCES.md`: `- <ISO> solo critic: chọn "<cũ>" cho "<q>", owner sửa thành "<mới>" — <bài học>`.
- `Status: waiting` và đã quá `Deadline:` → **Critic**: một subagent `critic` (không có thì `reviewer`) với đề bài: "Khó tính. Mục tiêu: ship liên tục, nhanh, đúng ý prompt/goal gốc của owner. Đọc goal, criteria PLAN.md, `su-code/PREFERENCES.md`, DECISIONS/memory. Chọn nhãn phục vụ mục tiêu đó tốt nhất; chỉ theo Recommended khi đồng ý. Trả về nhãn + lý do ≤1 câu." Nhãn phạm hard rail (phá huỷ/không đảo ngược, CI đỏ, secret, data prod, billing) → Critic KHÔNG chọn: giữ câu hỏi chờ owner, log `blocked: <item> — chờ owner`, sang item kế. Còn lại log `critic chose "<nhãn>": <lý do>`.
- Có câu trả lời → header `Status: running`, `Question: -`, `Deadline: -`, `Options: -`, làm tiếp.
- Mỗi giờ: quá `--hours` hoặc `--max-tokens` → mục 7. Máy nóng (`8sync ccc eco` hay watchdog báo áp lực) → chạy `8sync ccc eco`, không mở thêm agent, chỉ làm việc nhẹ tới khi hết áp lực. Qua ngày mới (UTC) → log dòng `daily: …` của ngày cũ.

## 7. Dừng (`dừng`, `/solo stop`, hết giờ/ngân sách/backlog)
Làm xong tick đang chạy cho an toàn (không bỏ dở commit/merge), đóng loop item hiện tại như `/ship-tick` mục 5 (brief, `8sync ccc loop done`, bỏ dòng slug khỏi ACTIVE), xoá dòng `solo` khỏi ACTIVE, `CronList` → `CronDelete` job `/ship-tick`, header `Status: stopped`, `Item: -`, `Question: -`, `Deadline: -`, `Options: -`, log `daily: …` + `stopped: <lý do>`. Báo owner ≤8 dòng: item xong, PR/release, blocked, câu hỏi còn treo, bài học.

Rails: không `bypassPermissions`; `8sync ccc risk` + `/sec` mỗi diff; không release khi CI đỏ; không force-push; không in secret; không đụng data client/CRM. Mọi câu "xong/pass" kèm lệnh + output, thiếu → "not verified".
