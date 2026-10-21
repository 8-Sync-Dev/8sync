---
name: ship
description: Chạy trọn quy trình một feature/bug như một team — plan → R&D → code → test → UAT → review/QC → docs+memory → commit, rồi release/deploy + monitor khi owner thêm cờ --release/--deploy. Dùng khi user gõ /ship <mô tả task>.
argument-hint: <mô tả task> [--release|--deploy]
---
Task: $ARGUMENTS

Thang tự động (chọn mức theo độ lớn việc):
| Mức | Lệnh | Dùng khi |
|---|---|---|
| 1 | `/do <việc>` | đổi nhỏ ≤3 file, không plan/commit |
| 2 | `/ship <việc>` (đây) | một feature/bug, tới commit; release khi có `--release` |
| 3 | `/ship-auto <việc>` | như /ship rồi PR → CI → merge → release sau MỘT câu `Ship` |
| 4 | `/ship-loop <mục tiêu>` | mục tiêu có tiêu chí kiểm được, lặp tới khi xanh (có cap) |
| 5 | `/autopilot` | nhiều item từ backlog, không người trông |


Trạng thái sống trong file, không chỉ trong hội thoại (sống sót qua /compact, /clear, resume):
`su-code/ship/<slug>/STATE.md` gồm Goal · Checklist các phase · Evidence (lệnh + output ngắn) · Next; ghi `<slug>` vào `su-code/ship/ACTIVE` để digest đầu phiên/sau /compact nạp lại (xong việc → xoá dòng đó). Repo không có `su-code/` → `.claude/ship/<slug>/` (không được nạp tự động). Cập nhật ở mỗi ranh giới phase. Theo dõi việc bằng TaskCreate/TaskUpdate.

**Nhịp scrum (`/sprint <slug>`, đọc `sprint/SKILL.md`)**: chạy cổng quy mô trước (≤3 file → không mở sprint); phase 1 là sprint planning (`8sync ccc . goal` + `8sync ccc standup <slug> init --roles …` theo quy mô, giao theo đợt rd/plan → dev → review/qa); **standup ở mỗi ranh giới phase** (`8sync ccc standup <slug>`, exit 3 = có role ngồi không → giao item thật hoặc `rest <lý do>`; review backlog/done/bug, đồng bộ phòng khác); phase 6 là sprint review; phase 7 kèm retro. Lead điều phối, role làm.

1. **Plan** — làm như `/planning`: goal, acceptance criteria kiểm được, task + file, rủi ro. Câu hỏi thật sự cần → gom MỘT `AskUserQuestion` (≤4 câu, Recommended đầu). Owner đã nói "tự làm đi"/"auto" → chọn Recommended, ghi giả định, đi tiếp.
2. **R&D** (chỉ khi có ẩn số) — `explore` cho codebase lạ; `researcher` song song cho câu hỏi con (≤10 bullet mỗi agent); lựa chọn lớn → `deep-research`. Không research thứ đã có trong repo.
3. **Code** — từng task; giao `task`/`quick-task` song song khi file tách bạch. Code mới phải có test. Không sửa test cho pass. Sau mỗi task chạy build/test của repo.
4. **Test** — full build + test + lint của repo. Fail → sửa gốc, không skip.
5. **UAT** — chạy thật như người dùng: CLI chạy lệnh thật trên dữ liệu thật/tạm; web → script e2e của repo hoặc `/chrome`; API → gọi endpoint thật ở local. Ghi lệnh + output vào Evidence. Không chạy được → ghi "UAT: not verified (<lý do>)".
6. **Review/QC** — `reviewer` trên diff; NOT MERGEABLE → task mới từ BLOCKER/SHOULD, quay lại 3. `/sec` + `/rules` + `/aup-audit` trên mọi diff (owner: luôn check tuân thủ), dán kết luận vào báo cáo; `8sync ccc risk` in thêm gate khác từ tên file đổi (người review cho high-risk, `/harden` khi đụng hook/settings) — chạy đủ những gì nó liệt kê. Thêm thu thập dữ liệu, nhắn người ngoài, scrape, high-risk → `/aup-audit`; BLOCK thì dừng và báo.
7. **Docs + memory** — CHANGELOG.md (Unreleased) cho thay đổi user-facing (card của team `8sync ccc auto`: ghi file mới `changelog.d/card-<id>.md`, không sửa CHANGELOG.md); docs liên quan; bài học có bằng chứng → `/remember` (failure/validated/decision). Cập nhật STATE.
8. **Commit** — conventional commits, branch riêng nếu đang ở main. Không push khi không có `--release`/`--deploy`.
9. **Release/deploy — chỉ khi `$ARGUMENTS` kết thúc bằng cờ `--release`/`--deploy` hoặc owner nói rõ trong hội thoại** (chữ "release" trong mô tả task không tính): push branch → PR → chờ CI (`gh pr checks --watch` chạy nền; CI phải xanh trên cả Windows, macOS và Linux (test + build release) trước merge/tag; OS nào chưa có job → ghi "not verified: <OS>" và không merge; `8sync ccc auto ci` báo `local` (GitHub chỉ lưu code) → CI là test + build trên máy release này, OS khác ghi "not verified: <OS>" và vẫn merge (ngoại lệ của luật not-verified ở trên), không chờ `gh pr checks`) → merge → tag/deploy. Repo có `changelog.d/`: trước tag gộp các file đó vào mục version của CHANGELOG.md rồi xoá chúng. Guard sẽ hỏi owner ở merge, push main, tag, deploy prod, publish — không né, không dùng bypass. Sau push: `CronCreate` `*/5 * * * *` → `/ship-tick <slug>` để tick sau đọc CI và đi tiếp (xoá ở phase 10 khi xong).
10. **Monitor** — sau release/deploy: theo dõi workflow/health tới khi xanh; đỏ → đọc log, quay lại 3. Ghi kết quả vào STATE.

Mọi câu "xong/pass/verified" phải kèm lệnh + output đã chạy; không có → chạy lại hoặc ghi "not verified". Không dừng khi còn task, test fail hoặc phase chưa xong — trừ khi owner bảo dừng. Báo cáo cuối: phase nào xong, bằng chứng, cái gì chưa verify, việc owner cần làm.
