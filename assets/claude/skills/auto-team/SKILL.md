---
name: auto-team
description: Fixed team of Claude Desktop sessions for any project, level 5, built 100% on ECC — /auto-team [mục tiêu]. Reads the project, runs 3 sub-sessions by default (Build & Ship, Critic, R&D; 2–5 with --rooms) and what each owns, names every session clearly in Vietnamese by role, reuses or adopts existing sessions instead of opening new ones, keeps an ECC agent Kanban (team-agent-orchestration) that only the lead writes, and drives each sub-session by prompt (SendMessage) with ECC skills and agents; sub-sessions report back the same way. No 8sync rooms, board or HQ. The lead works too. Owner-only; re-run to resume after a restart.
argument-hint: "[mục tiêu, kèm lệnh check / deadline nếu có] [--rooms 2-5, mặc định 3] [--plan]"
disable-model-invocation: true
---
Tham số: $ARGUMENTS (`--plan` = chỉ đề xuất đội hình, không mở/đổi tên session)

Owner (2026-10-28): "1 team thật sự tương tác liên tục không 1 session nào được ngồi không có việc làm, session chính control các session con thì session chính cũng phải làm việc", "các session cố định để sài á chứ không phải là tạo session mới liên tục", "đặt lên tên session đổi tên chuẩn, biết cần chia bao nhiêu session con và task phân chia", "cần gấp hoàn chỉnh sớm nên có deadline". Owner (2026-10-29): "auto-team là dùng 100% ecc và session con trong prompt ra lệnh thông không phải rooms, teams hq ui đâu bỏ rồi". Tổng quát hoá từ `/tohe-auto-team` (mốc có giờ; rubric trích nguyên lời owner; trưởng nhóm tự mở link deploy kiểm rồi mới báo).

Session này là **Trưởng nhóm**. Session con = một session Claude Desktop (Code tab) trong worktree riêng. **Không dùng** `8sync ccc auto …`, phòng nền, board 8sync hay HQ: đội chạy hoàn toàn bằng tool session của Desktop + skill/agent ECC.
- **File đội** (không commit, chung mọi worktree): `$T` = output của `git rev-parse --path-format=absolute --git-common-dir` + `/ecc-team/` (git ≥2.31) → `ROSTER.md` (đội hình), `BOARD.md` (agent Kanban), `ON` (đội đang chạy), `REPORT-<ngày>.md`. Biến shell không giữ giữa các lệnh: mỗi lần tính lại, Read/Write bằng đường dẫn tuyệt đối. **Chỉ trưởng nhóm ghi** `$T` (một người ghi, không tranh file).
- **BOARD.md** theo `ecc:team-agent-orchestration`: mỗi card một dòng `id · việc · chủ (handle) · cột · nhánh · AC · merge gate · bằng chứng/handoff`; cột: backlog → ready → running → review → blocked → merged → archived. Một card một chủ, ≤ ~5 file, AC kiểm được.
- **Nhánh tích hợp:** repo có remote GitHub → nhánh mặc định của remote; card đi PR, merge sau câu `Ship`. Không remote → nhánh session này đang đứng; trưởng nhóm merge ở máy.
- **Rubric** (commit trên nhánh tích hợp): `su-code/team/RUBRIC.md` — mỗi yêu cầu owner một ô: trích nguyên văn + ngày giờ + cách kiểm; luật do agent đặt ghi "(agent rule)".

## 0. Lần đầu, chạy lại, hay nhận đội có sẵn
- Không có tool `mcp__ccd_session__start_session` / `mcp__ccd_session_mgmt__list_sessions` / `SendMessage` (CLI thường) → nói rõ "cần Claude Desktop", dừng.
- `$T/ROSTER.md` có `status: active` → **chạy lại**: sang mục 4 (tìm session theo id → name → tên; mở lại session archive; chỉ mở session thật sự mất), rồi 5–7. `status: draft` (từ `--plan`) → coi như lần đầu, dùng nháp làm đề xuất.
- **Nhận đội có sẵn**: có `<git-common-dir>/8sync-team/ROSTER.md` (bản cũ dùng board 8sync), skill `*auto-team*` của dự án, hoặc session tên `<Dự án> · …` (`list_sessions` `include_archived: true`, `limit: 200`) → nhập nguyên tên/vai vào ROSTER, không đổi tên; card đang dở (board 8sync cũ, `BOARD.md` riêng) → chép vào `$T/BOARD.md` giữ chủ + nhánh; Ship owner đã duyệt sẵn → chép vào ROSTER kèm nguồn + ngày. Session con đang có cron `/team-tick <handle>` cũ → mục 5 bảo nó `CronDelete`.

## 1. Đọc dự án (không sửa gì)
Trên nhánh tích hợp: `su-code/STATE.md` (`## Goal`, `## Next`), `AGENTS.md`/`README`, manifest (package.json, Cargo.toml, go.mod, pyproject, *.uproject…), cây 2 tầng, `git log --oneline -30`, `git remote -v` (rỗng → chế độ local), `.github/workflows` (không có → "not verified: CI 3 OS"), worktree/nhánh mở, `ListAgents`. Hiểu codebase nhanh: `ecc:codebase-onboarding` / agent `ecc:code-explorer`. Mục tiêu: đối số → STATE Goal → hỏi ở mục 3; phải kiểm được (`ecc:loop-design-check`: lệnh check hoặc tiêu chí đo được + điều KHÔNG được làm). Mục tiêu lớn → `ecc:planner` / `ecc:blueprint` tách thành card.

## 2. Chia đội
1. **Lane maker** = nhóm thư mục sửa độc lập (không chung file, check riêng được) có ≥2 việc mở. Lane quan trọng nhất (nhiều việc nhất hoặc chặn lane khác) là của Trưởng nhóm — không tính vào session con.
2. **Mặc định 3 session con = Build & Ship + Critic + R&D** (owner 2026-10-30: "auto-team only 3 session con", "cần hiệu quả optimize cao nhất"). Mỗi lane maker còn lại thêm một session chỉ khi owner cho `--rooms` 4–5. Dự án chỉ có một lane độc lập, máy áp lực (CPU >85% / RAM >90%) hoặc sắp hết hạn mức → `--rooms 2` (gộp Critic + R&D). Trưởng nhóm Opus, session con Sonnet: đa agent tốn khoảng 15× token chat (theo tóm tắt bài Anthropic multi-agent research system, chưa đọc nguyên văn) nên chỉ thêm session khi có việc độc lập.
3. **Tên session** `<Tên dự án> · <Vai>: <2–3 việc chính>` — tiếng Việt, thuật ngữ kỹ thuật giữ tiếng Anh, nhìn sidebar là biết làm gì; không trùng, không theo tên nhánh/số. **Handle** = một từ thường chỉ chữ cái, duy nhất trong đội (`lead`, `qa`, `review`, `art`, `hero`, `api`…), dùng làm chủ card và nhãn tin.

| Vai (mẫu tên) | Handle | Việc chính · việc thường trực khi hết card | Skill/agent ECC chính |
|---|---|---|---|
| `Trưởng nhóm: <lane chính> + ghép code` (session này) | `lead` | giao việc, mốc, merge, làm lane chính · gỡ blocked, bơm card | `ecc:team-agent-orchestration`, `ecc:planner`, `ecc:architect`, `ecc:loop-operator`, `ecc:council` |
| `Build & Ship: code, test, bản xem` | `qa` | code card ngoài lane trưởng nhóm, check + UAT, bản xem cho owner · chạy lại bản mới nhất ở khổ màn owner yêu cầu | `ecc:verification-loop`, `ecc:e2e-runner`, `ecc:browser-qa`, `ego-browser`, `/ecc:orch-fix-defect`, `/ecc:orch-add-feature`, `performance-optimization`, `/ecc:security-scan` |
| `Critic: chấm điểm, audit` | `review` | review đối kháng diff/bản xem theo RUBRIC · chấm mốc, giữ RUBRIC, audit automation | `/ecc:orch-review`, `ecc:code-reviewer`, `ecc:security-reviewer`, `ecc:santa-method`, `ecc:agent-architecture-audit`, `ecc:agent-security-hardening`, `ecc:automation-audit-ops`, `ecc:agent-self-evaluation` |
| `R&D: nghiên cứu, thị trường` | `rd` | trả lời câu hỏi chặn card, đề xuất card có nguồn · quét thị trường/đối thủ theo mục tiêu | `ecc:deep-research`, `ecc:market-research`, `/ecc:marketing-campaign`, `ecc:search-first` |
| `<Mảng>: <việc>` (chỉ khi `--rooms` 4–5; vd `Thiết kế màn hình, UI/UX`, `Kỹ thuật lõi: API, dữ liệu`) | lane | card của lane · việc kế trong Next của lane | `ecc:tdd-workflow` + `ecc:tdd-guide`, `ecc:build-error-resolver`, reviewer theo ngôn ngữ (`ecc:typescript-reviewer`, `ecc:rust-reviewer`, `ecc:python-reviewer`, `ecc:go-reviewer`…), màn hình thêm `ecc:frontend-patterns`, `ecc:a11y-architect`, `impeccable` |

**Gọi skill ECC theo trigger, không nạp hết vào mọi prompt** (mỗi skill đổi token lấy chất lượng; brief chỉ ghi tên + trigger):

| Skill | Ai | Gọi khi |
|---|---|---|
| `ecc:loop-design-check` | lead | lập mục tiêu/lệnh check (mục tiêu máy quyết được, chống chạy hoang) |
| `ecc:continuous-agent-loop` | lead | nhịp `/team-tick`: gate eval, phục hồi khi kẹt (thay `ecc:autonomous-loops`, ECC giữ nó chỉ để tương thích) |
| `ecc:autonomous-agent-harness` | lead | chỉ phần memory + hàng đợi việc; cron duy nhất vẫn là `/team-tick` |
| `/ecc:learn` | lead + mọi session | cuối ngày hoặc xong card không tầm thường |
| `/ecc:orch-fix-defect`, `/ecc:orch-add-feature` | qa, lane | card bug/feature cỡ vừa trở lên; hai cổng người của `ecc:orch-pipeline` (duyệt plan, xác nhận commit) do trưởng nhóm trả lời bằng tin, không chờ owner |
| `performance-optimization` | qa, lane | card có số đo chậm (trước/sau phải có số) |
| `/ecc:security-scan` | qa, lane | trước khi chuyển card sang `review` |
| `ecc:agent-architecture-audit`, `ecc:agent-security-hardening` | review | card đụng agent/LLM, hook, tool, credential |
| `ecc:automation-audit-ops` | review | mỗi ngày một lần: hook, cron, MCP nào còn sống/trùng/hỏng |
| `ecc:agent-self-evaluation` | review (chấm output session khác) | mỗi card trước `approved` |
| `ecc:deep-research`, `ecc:market-research` | rd | câu hỏi chặn card, quét đối thủ/thị trường |
| `/ecc:marketing-campaign` | rd | chỉ khi mục tiêu có ra mắt/marketing; chỉ dùng số liệu có nguồn (dashboard Vercel/Cloudflare), không bịa khách/đối tác/metric |

`/ecc:auto-update` (nâng chính plugin ECC) không thuộc đội: owner tự chạy.

## 3. Duyệt đội hình (một câu hỏi)
In bảng: tên session · handle · thư mục giữ · card đầu tiên · skill/agent ECC · mốc đề xuất (M1… giờ Việt Nam + "xong khi"). Một `AskUserQuestion` (≤4 câu, gom mục tiêu/deadline nếu thiếu): `Duyệt đội hình (Recommended)` · `Ít session hơn` · `Chỉ lập kế hoạch` · `Dừng`. Owner vắng / "auto" → Recommended, ghi giả định. `--plan` → ghi `$T/ROSTER.md` `status: draft` + `$T/BOARD.md`, dừng.

## 4. Lập session con (cố định, không churn)
1. `$T/ROSTER.md` (`status: active`): mục tiêu + check, nhánh tích hợp, remote có/không, mốc, ràng buộc owner (khổ màn, thiết bị), Ship đã duyệt (nguồn, ngày), bảng: tên · session id · name · handle · thư mục giữ · việc thường trực. `$T/BOARD.md` với card đầu cho mỗi session (cột `ready`). Tạo `$T/ON`.
2. Đổi tên session này: `mcp__ccd_session_mgmt__set_session_title` (`self`).
3. Mỗi session con: có id trong ROSTER → `get_session`; không thì `list_sessions` (`include_archived: true`, `limit: 200`) tìm theo name rồi tên. Thấy → archive thì `unarchive_session`, sai tên thì `set_session_title`. Không thấy → `mcp__ccd_session__start_session` **một lần**: `initiation` "user_asked", `context` "fresh", `use_worktree` true, `source_branch` = nhánh tích hợp, `branch_name` `team-<handle>`, `name` = slug `[a-z0-9-]` ≤24 ký tự (`tohe-art`), `model` một id Sonnet (vd `claude-sonnet-5-5`) cho `qa`/`review`/`rd` (lane maker bỏ trống), `permission_mode` = mode của session này (`bypassPermissions` → truyền `auto`), `background` (≥80 ký tự: dự án, mục tiêu, mốc, vai), `prompt` = brief mục 5 + card đầu. Ghi id vào ROSTER ngay. Tool từ chối → không thử lại; ghi session thiếu + brief vào báo cáo để owner mở tay.
4. Có `mcp__ccd_sidebar__*`: chưa có nhóm `<Tên dự án> · Team` thì `create_group`; `move_sessions` cả đội vào.
Không bao giờ: mở session thứ hai cho cùng vai, mở session ngoài ROSTER, xoá/archive session để "dọn".

## 5. Lệnh cho session con (prompt lúc mở, hoặc `SendMessage` tới id)
**Brief** (một lần): tên, vai, handle, thư mục được sửa (ngoài đó → nhắn session giữ file qua trưởng nhóm), mục tiêu, mốc, ràng buộc owner, skill/agent ECC của vai (bảng mục 2), luật dưới. Session con **không đặt cron, không tự lấy việc ngoài lệnh**: việc tới bằng tin của trưởng nhóm; có cron `/team-tick <handle>` cũ → `CronDelete`.

**Lệnh giao việc** (mỗi card một tin, dòng đầu tự đủ nghĩa):
`[giao] card <id> · <việc> — AC: … · gate: <lệnh check> · nhánh card-<id>-<slug> từ <nhánh tích hợp> · xong thì làm tiếp: <việc thường trực/card kế>`

**Session con làm** (theo vai, chỉ trong worktree của mình):
- maker: `ecc:tdd-workflow` (test trước) → code → `ecc:verification-loop` / `/ecc:quality-gate` → reviewer ECC theo ngôn ngữ → gate commit bắt buộc (`sec`, `rules`, `aup-audit` qua Skill tool, `8sync ccc risk`, `trail check`) → commit. Có remote → push nhánh + PR (base = nhánh mặc định); không remote → chỉ commit. Không merge, không push main, không deploy.
- `qa`: check + UAT nhánh card ở khổ màn/thiết bị owner yêu cầu (`ecc:e2e-runner`/`ecc:browser-qa`, trình duyệt `ego-browser`, ảnh `qa/evidence/card-<id>-<slug>.png`).
- `review`: review đối kháng theo `su-code/team/RUBRIC.md` (`/ecc:orch-review` khi diff lớn, không thì `ecc:code-reviewer` + `ecc:security-reviewer`), FATAL/MAJOR/MINOR.
- `rd`: nghiên cứu có nguồn cho từng câu hỏi (`ecc:deep-research`/`ecc:market-research`), ghi `su-code/research/<ngày>-<slug>.md`, đề xuất card kèm AC + lệnh check; không sửa code sản phẩm.
- Vòng sửa ↔ chấm giữa maker và `review`: tối đa 2 lượt, rồi trưởng nhóm quyết (evaluator–optimizer chỉ hội tụ khi tiêu chí rõ).
- Kẹt cùng lỗi 2 lần → hỏi `rd` qua trưởng nhóm (hoặc tự `ecc:search-first`, ≤2 agent) rồi thử lại; lần 3 → báo blocked.

**Báo lại** (luôn `SendMessage` tới id trưởng nhóm, một tin khi xong/kẹt):
`[<handle>] card <id> → review|approved|blocked · nhánh, SHA, PR · lệnh check: kết quả · việc đang làm tiếp`
Rồi làm ngay phần "làm tiếp" trong lệnh giao; hết thật → báo `[<handle>] rảnh` và kết thúc lượt (không chờ vòng).
- Owner nhắn thẳng vào session con → làm nếu hợp vai, báo trưởng nhóm `[<handle>] [owner] "<trích nguyên văn>"` để vào BOARD + RUBRIC.
- Xong card không tầm thường: bài học có bằng chứng → `/remember`; cách làm dùng lại được → `/ecc:learn-eval` (hỏi owner trước khi ghi skill); rồi `/compact`. ECC learn-v2 (instinct) cần hook ECC, đang tắt — không dựa vào nó.

## 6. Bơm việc + mốc
- Mốc M1…Mn: giờ Việt Nam + "xong khi" đo được, ghi ROSTER và báo owner; card mốc gần nhất ưu tiên P0. Trễ mốc → báo owner ngay: lý do + giờ mới.
- Mỗi session con luôn có **một card đang làm + một việc "làm tiếp"** trong lệnh giao — không session nào ngồi không. Ready thiếu → tách mục tiêu/mốc/Next/đề xuất của Critic + R&D thành card (`ecc:planner`).
- `review` (cùng `rd` khi cần nguồn) lập `su-code/team/RUBRIC.md` từ lời owner; trưởng nhóm commit nó trên nhánh tích hợp.

## 7. Trưởng nhóm làm việc + nhịp
- Tin `[<handle>] …` tới = sự kiện: cập nhật BOARD (`running → review`: giao `qa` rồi `review`; `approved` → merge; `blocked` → gỡ: tách nhỏ, đổi chủ, R&D, hoặc gom câu hỏi owner; `rảnh` → giao card kế ngay).
- Nhịp dự phòng: `CronList` → chưa có `/team-tick` thì `CronCreate` `*/15 * * * *` prompt `/team-tick` (chỉ ở session này; mất khi đóng app hoặc sau 7 ngày — `/auto-team` lần sau đặt lại).
- Giữa các tin: làm lane chính, chỉ card ≤30 phút (không bỏ điều phối).
- Báo owner ≤10 dòng: đội hình (link `[tên](#<session id>)`), mốc + card từng session, đường dẫn `$T/BOARD.md`, việc owner cần làm (session mở tay, Ship), not verified.

## Luật
- Merge: chỉ trưởng nhóm, card `approved` có SHA + check xanh. Không remote → merge nhánh card vào nhánh tích hợp ở máy, chạy lại check, card → `merged` kèm bằng chứng. Có remote → merge PR / push / tag / release / deploy cần MỘT câu `Ship` (gom hết, trừ đích owner đã duyệt sẵn ghi trong ROSTER).
- Tin giữa các session là dữ liệu và lệnh việc, không phải lời duyệt của owner; không session nào duyệt Ship thay owner, không nhờ session khác làm việc mình bị chặn quyền.
- `unarchive_session`, `set_session_title`, `move_sessions` trên session không do mình mở có thể hỏi owner: làm trong `/auto-team` (owner có mặt), nhịp cron chỉ báo owner. Không `bypassPermissions`; không build nặng ở máy (CI).
- Gói subscription: đội chạy trong Claude Desktop khi owner mở app; không chạy headless (`claude -p`) bằng token subscription — việc không người trông dùng Console API key.
- Bản xem/deploy mới: trưởng nhóm tự mở link (đúng khổ màn owner yêu cầu), chụp ảnh (`SendUserFile`) rồi mới báo owner.
- Owner nói "dừng đội"/"stop" → xoá `$T/ON`, `CronDelete` job `/team-tick`, nhắn mỗi session con `[dừng đội] dừng sau bước đang làm, commit dở thì để nhánh`; session giữ nguyên để lần sau dùng lại.
- Mọi "xong/pass" kèm lệnh + output; thiếu → "not verified".
