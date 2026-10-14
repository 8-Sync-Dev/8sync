# hq-office-rooms — HQ UI: mỗi session là một phòng, chat đúng phạm vi, nhắn được mọi session

## Goal
1. `8sync hq ui` hiển thị văn phòng nhiều phòng: mỗi session đang sống là **một phòng**. Trong phòng có các **chuyên gia theo cùng một template** (Lead + các subagent của kit). Khi một session gửi việc hay hỏi session khác, sprite **đi sang phòng kia** rồi quay về.
2. Bấm vào một session đang chạy (kể cả session mở bằng `8sync ccc .`/`claude` ở terminal khác, không có tmux, gồm cả Windows) phải mở **phòng của nó**, không bao giờ hiện "Start a session".
3. **Chat nhóm** = giữa mọi phòng: handoff giữa các session, việc giao và tin nhắn của owner. **Chat phòng** (tab Team cũ) = chỉ session đang chọn.
5. (owner bổ sung 2026-10-14) **Board + dự án + đo lường**: session tự gom theo **folder dự án** (git root của cwd) kèm **branch**; Board lọc theo dự án/session và hiện đủ task các session tạo; **token, cost USD (số thật Claude Code đưa statusline), +/- dòng, thời lượng, task xong, cost/task** theo session và dự án; tab **Báo cáo** trong HQ và lệnh `8sync ccc . report [--all] [--json]` (kèm trạng thái loop).
4. Owner nhắn được mọi session đang sống:
   - session tmux: gõ thẳng vào terminal như hiện nay;
   - session khác: ghi vào **inbox**, và hook Stop chính chủ của kit giao tin khi session kết thúc lượt hiện tại. UI nói rõ thời điểm giao.

## Non-goals
- Không gọi model từ UI, không thêm dịch vụ mạng; vẫn chạy local, chỉ nghe 127.0.0.1.
- Không tự giao tin cho session đang **idle** chờ người gõ. Lúc đó UI ghi "giao khi session chạy lượt kế; mở terminal của nó" (đánh thức qua asyncRewake là bước sau).
- Không dùng asset của agent-sprite-forge. Chỉ học ý tưởng PixelSpec (MIT); sprite tự vẽ.

## Acceptance criteria (lệnh kiểm; exit 0 = pass)
| # | Criterion | Lệnh |
|---|---|---|
| C1 | Journal ghi `SubagentStart/Stop` (agent_type → role); `HQ_EVENTS` của kit có hai event này | `nice -n 19 cargo test -q -j2 subagent` |
| C2 | Hook Stop giao inbox: chỉ một lần, có masking, thắng gate, chạy cả khi `stop_hook_active` | `nice -n 19 cargo test -q -j2 inbox` |
| C3 | hq-ui test mới/đổi xanh ở local (file chạm tới); toàn bộ suite xanh trên CI linux (5 test fail sẵn trên Windows: mode 0600, path sep, timeout — không do task này) | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run <files>`; full: C7 |
| C4 | Typecheck | `cd apps/hq-ui && pnpm exec next typegen && nice -n 19 pnpm exec tsc --noEmit` |
| C5 | Lint | `cd apps/hq-ui && nice -n 19 pnpm exec eslint` |
| C6 | Không có request ra ngoài, không có chuỗi giống key | `bash scripts/hq-offline-check.sh` |
| C7 | CI trên nhánh feature xanh (test 3 OS, hq-ui-test, package-hq-ui boot) | `gh run watch <id> --exit-status` |
| C9 | Statusline ghi snapshot usage/session (`state/usage/<sid>.json`, nguyên tử, chỉ khi đổi); `ccc . report` đọc ls + usage + loop → bảng + `--json` (cost/task) | `nice -n 19 cargo test -q -j2 usage_` |
| C10 | UI: dự án tự gom từ cwd + branch; Board hiện task theo dự án; tab Báo cáo (cost, token, cost/task) — test pure + API | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/office.test.ts tests/labels.test.ts` |
| C11 | Test không bao giờ chạm home thật (Windows USERPROFILE) | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/isolation.test.ts` |
| C8 | Ảnh UAT: dev server + journal mẫu (3 phòng, 1 handoff, subagent đang chạy) → chụp màn hình Văn phòng và Chat phòng của một session `claude` (composer bật, không có "Start a session") | `bash su-code/ship/hq-office-rooms/uat.sh` (exit 0 + 2 ảnh PNG) |

## Tasks
1. **Rust** (`crates/cli/src/verbs/hq.rs`, `ccc.rs`):
   - `journal_entry`: `subagentstart`/`subagentstop` → `subagent_start`/`subagent_stop`, `role` = agent_type, `from` = agent_id;
   - `HQ_EVENTS` + test của kit;
   - inbox: `state_dir/inbox/<session_id>.jsonl`, đọc rồi xoá nguyên tử, mask, trả `Some(reason)`;
   - `verify::stop` gọi inbox trước gate.
2. **hq-ui server**:
   - `lib/server/inbox.ts`: ghi file 0600 vào thư mục 0700; session_id chỉ nhận uuid hoặc `[A-Za-z0-9-]`;
   - `POST /api/messages`: tmux → terminal; `claude` → inbox (`delivery: "inbox"`);
   - ingest `subagent_start/stop` → bảng `agents` (session, agent_id, role, started_at, ended_at);
   - `/api/floor` trả về phòng, chuyên gia và các chuyến đi.
3. **hq-ui lib (pure, có test)**:
   - `lib/labels.ts messageTargets` gồm session `claude` đang sống;
   - `lib/rooms.ts` (template ghế, map agent_type → role, chọn chuyến đi từ `session_message` trong 60 s);
   - `lib/team-thread.ts` hai bộ lọc: `groupThread` (mọi phòng) và `roomThread(session)`.
4. **hq-ui view**:
   - `floor-view.tsx` thành lưới phòng (đầu phòng: tên session, trạng thái, một dòng việc đang làm, tiến độ). Mỗi ghế là sprite chuyên gia: sáng khi đang làm, mờ khi trống. Có hành lang và sprite đi giữa các phòng;
   - tabs: "Văn phòng", "Chat nhóm", "Chat phòng" (thay "Team");
   - bấm phòng hoặc sidebar → chọn session, mở Chat phòng của nó;
   - "Running N" đếm mọi session đang sống;
   - composer ghi rõ cách giao: Terminal / Inbox.
5. **Sprite** (`lib/sprite/*`): walker 16×24 tự vẽ theo kiểu PixelSpec (palette ký tự + rows), mỗi role một biến thể màu, có frame đi bộ; tile phòng (sàn, tường, cửa, bàn). Hỗ trợ reduced-motion.
6. **UAT script + docs**: `uat.sh`, CHANGELOG, `docs/hq.md`, `/remember`.

## Risks
- Inbox là một kênh đưa prompt vào session. Chỉ owner ghi được (file 0600 trong home, API có token, chỉ nghe 127.0.0.1); text được mask khi giao. Ranh giới tin cậy bằng với `settings.json`.
- Tin cho session idle không được giao cho tới lượt kế. UI phải nói rõ, không được giả vờ đã giao.
- Thêm `SubagentStart/Stop` thì mỗi subagent tốn thêm một hook async (~9 ms, không chặn).
- Hai bản `8sync`: kit phải refresh (`8sync ccc kit`) thì hook mới có hiệu lực.
- Binary size: thay đổi nhỏ; trần còn ~68 KB.
- Luật: chỉ dùng hook chính chủ, không proxy, không giả client. Tin nhắn là owner nói với session của chính owner, không ai bên ngoài. Vẫn chạy `/sec` + `/aup-audit`.

## Assumptions (tự chọn, owner bảo "auto")
- Template ghế mỗi phòng: Lead, R&D (explore/researcher), Plan (pm/architect), Fullstack (task/general-purpose/designer), Reviewer (reviewer/verifier), Tester (qa), Quick (quick-task).
- "Chat nhóm" đọc dữ liệu cũ của team thread; "Chat phòng" lọc theo session.
- Không có tmux (Windows) → mọi session giao bằng inbox.
