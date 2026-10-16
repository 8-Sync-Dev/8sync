# hq-team-alive — team luôn work, họp sprint chung, nhân vật rời ghế đi họp thật

Owner 2026-10-16 (/ship-loop): "R&D cứ ngồi chơi … tất cả luôn trong trạng thái work, giao việc liên tục … animation real đi từ phòng tới phòng khác, ra khỏi chỗ để họp sprint daily 30p … skills scrum luôn bật, lead và R&D luôn work để giao việc … nhiều cần nhiều thì nhân vật tự nhân bản … chờ tôi quá 1p không tự R&D và lead tự giao nghiên cứu tự làm tiếp, có nút pause, mặc định luôn chạy liên tục … các session phòng ban chưa bao giờ họp chung với nhau". Sprite: theo skill `sprite-pipeline` (cùng kích thước khung, anchor bottom-center, feet ổn định, không drift, kiểm ở game scale).
Base: v0.93.3 (56d3a41). Branch `feat/hq-team-alive`, worktree /home/alexng/tools/su-code-inbox.

## Hiện trạng (map 2026-10-16)
- `8sync ccc idle` (không-ai-rảnh, ladder research cho lead/R&D) và `8sync ccc delegate --after 1m` (critic chọn thay) đều tồn tại nhưng mặc định TẮT và chỉ bật bằng tay → "R&D ngồi chơi".
- HQ office: `meeting` chỉ là tư thế tại bàn khi `su-code/ship/<slug>/STANDUP.md` mới < 2 phút (lib/floor.ts:26); walker chỉ chạy khi có SendMessage giữa 2 phòng (lib/office.ts:82); không có phòng họp, không rời ghế, không họp chung giữa session; ghế nhiều agent chỉ ghi "×N".
- Không có nút Pause; "R&D trực" là preset cron 30 phút phải tự giao.

## Acceptance criteria (exit 0 = pass; local nhẹ `nice -n 19 ionice -c3`, `-j2`)
- C1 **`8sync ccc auto on [--hours N] [--after 1m] | off | pause | status [--json]`** (Rust `ccc/auto.rs`): `on` = idle lease (giữ rail subscription ≤4 h, owner-có-mặt 30 phút) + delegate `--after` (mặc định 60 s) + `<state>/ccc/auto.json {on, paused:false, since, hours, after_s}`; `pause`/`off` = idle off + delegate off + `paused:true` (HQ không tự bật lại); `status --json` = {on, paused, idle, delegate, after_s, lease_until, gate}. Test on/off/pause/status + fail-closed (hours ngoài khoảng → không ghi gì).
  `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code ccc::auto`
- C2 **`8sync ccc meet [--say "<done>|<doing>|<blocked>"] [--room <tên>] [--json]`** (Rust `ccc/meet.rs`): ghi một dòng `| HH:MM | phòng | done | doing | blocked |` vào `su-code/standup/<YYYY-MM-DD>.md` của repo (lock, cell sanitised như standup::cell, ≤100 ký tự, tên phòng từ `--room` hoặc registry theo session id/CLAUDE_CODE_SESSION_ID, không có thì "?"); `--json` = {date, attendees:[{room, at, done, doing, blocked}], open:[dòng doing/blocked của phòng khác]}; ngoài repo (không `su-code/`) → bail. Test append 2 phòng, json, sanitise, bail.
  `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code ccc::meet`
- C3 **Scrum luôn bật trong hook**: khối "Phòng của bạn" (room.rs `block`) thêm dòng `Sprint <slug>: role rảnh a,b → 8sync ccc standup <slug> set …` khi `su-code/ship/ACTIVE` có slug với SPRINT.md có role idle, và dòng `Họp sprint hôm nay: N phòng đã nói, bạn chưa → 8sync ccc meet --say …` khi `su-code/standup/<today>.md` có mà phòng mình chưa ghi. Test pure.
  `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code ccc::room`
- C4 **help/hint/dispatcher**: `auto`, `meet` trong VERBS/RESERVED/TEXT + hint rows; test help/hint xanh.
  `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code help_ && nice -n 19 ionice -c3 cargo test -q -j2 -p su-code hint_`
- C5 **HQ office họp thật + nhân bản + pause** (apps/hq-ui, pure + API tests):
  - `lib/meeting.ts`: `parseStandupDay(md)` → attendees; `meetingFor(project, now)`: phòng có dòng < `MEETING_MS` (30 phút) đang "đi họp"; `walkPhase(at, now)`: `walk-out` (0–1.6 s) → `at-table` → `walk-back` (30 phút − 1.6 s) → done.
  - `lib/office.ts`: `seatState(lead)` trả `null` (ghế trống, đã rời) khi phòng đang họp; `cloneCount(seat)` = min(active, 3) sprite vẽ cạnh nhau, nhãn ×N khi >3.
  - `lib/server/office.ts`: `Office.meetings[]` theo project từ `su-code/standup/<today>.md` (đọc tên file an toàn, ≤64 KB).
  - `app/api/auto/route.ts`: GET → `8sync ccc auto status --json`; POST {action: on|pause} → `8sync ccc auto on|pause`; 401 không token; action lạ → 422.
  - `lib/schedule.ts`: preset `MEET_DAILY` (họp sprint daily, mặc định 09:00, prompt bảo mỗi phòng `8sync ccc meet --say …` rồi đọc `--json` nhận việc chưa ai làm, ≤30 phút).
  - `lib/sprite/walker.ts`: `mirror(rows)` cho đi về (quay trái), `WALKER_FRAMES`/`WALKER_STAND`/carry cùng 12×18, dòng chân (feet) cùng hàng ở mọi frame (quality gate sprite-pipeline).
  `cd apps/hq-ui && nice -n 19 ionice -c3 pnpm vitest run tests/meeting.test.ts tests/office.test.ts tests/sprite.test.ts tests/schedule.test.ts tests/auto-api.test.ts && nice -n 19 ionice -c3 pnpm typecheck && nice -n 19 ionice -c3 pnpm exec eslint components/hq lib app/api/auto`
- C6 **UAT trình duyệt seeded** (HOME cô lập, headless shell có sẵn, `claude` off PATH): seed 2 phòng cùng repo + `su-code/standup/<today>.md` 2 dòng → tab Văn phòng có "Phòng họp" với 2 nhân vật, ghế Lead của 2 phòng trống ("đi họp"), nút "Tạm dừng"/"Chạy liên tục" đổi trạng thái qua /api/auto (8sync giả trên PATH ghi file), canvas walker đổi pixel theo thời gian, reduced-motion đứng yên, không pageerror, không tràn 390 px.
  `bash su-code/ship/hq-team-alive/uat.sh`
- C7 **clippy touched files** sạch: `nice -n 19 ionice -c3 cargo clippy -q -j2 -p su-code 2>&1 | grep -E 'ccc/(auto|meet|room|help|hint)\.rs' ; test $? -eq 1`
- C8 **CI xanh 3 OS** trên PR: `gh run watch <id> --exit-status` (test ubuntu/macos/windows + hq-ui-test + package-hq-ui + minimal).

## Giả định (owner "tự làm đi" = Recommended)
- "Mặc định luôn chạy": HQ bật `auto on` khi tab Văn phòng mở và chưa `paused`; lease idle hết (2 h) thì HQ bật lại khi tab còn mở. Rail giữ nguyên: login subscription lease ≤4 h và chỉ chạy khi owner có gõ trong 30 phút (Consumer terms: dùng tự động không người trông thuộc Console API key — `skills/aup-audit/8sync-anthropic-rules.md`). HQ không tự bật lại sau khi owner bấm Tạm dừng.
- "Chờ tôi quá 1 phút": `auto on` đặt `delegate --after 60` (critic chọn thay cho câu hỏi sản phẩm/kỹ thuật; Ship/secret/tiền vẫn chờ owner) và idle ladder (lead hết việc → ask_room → research). Không thêm bậc mới.
- "Nhân bản": sprite nhân bản theo số agent cùng loại đang chạy (SubagentStart) — việc spawn thật vẫn do sprint skill (≤4 writer) + `8sync ccc . new`; HQ không tự mở session.
- Họp daily 30 phút: cửa sổ MEETING 30 phút từ dòng meet của phòng; CronCreate daily hết hạn 7 ngày (giới hạn Claude Code) — HQ nhắc owner giao lại.
- Loop: `--max-iter 12 --max-min 150` (việc 2 ngôn ngữ, 8 criterion; mặc định 90 không đủ cho UAT + CI).
