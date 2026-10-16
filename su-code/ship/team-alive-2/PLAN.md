# team-alive-2 — phiên rảnh quá 1 phút tự làm tiếp, kể cả phiên đứng một mình

Owner 2026-10-16 (/ship-loop, gõ lại mục tiêu hq-team-alive): "R&D cứ ngồi chơi … tất cả luôn trong trạng thái work … chờ tôi quá 1p không tự R&D và lead tự giao nghiên cứu tự làm tiếp, có nút pause, mặc định luôn chạy liên tục … các vị trí chưa bao giờ thấy được dùng liên tục".
hq-team-alive đã ship v0.94.0 (auto/meet verb, phòng họp, pause). Phần còn hở sau UAT cùng ngày:
- `8sync ccc auto on` chỉ tác động **agent-team lead** (idle.rs `hook` nhánh Stop đòi `~/.claude/teams/session-<8>/config.json`); phiên thường (web/rd/team/core…) không được nudge; phiên đang rảnh không bao giờ có Stop event → không ai đánh thức.
- Owner đang phải tự gõ `/loop 5m /loop-me …` trong từng phiên (phiên BE-AI từ chối nhận cron từ tin nhắn, đúng quy ước).
- HQ đang chạy giao diện 0.93.3 nên owner "không thấy gì mới" (tick 1 loop-me: hq-stale-ui, nhánh xanh).
Base: v0.94.0 (720c732). Worktree /home/alexng/tools/su-code-inbox. Nhánh: `feat/ship-tick` (C1, đã commit), `feat/hq-up-ui-refresh` (C4, xanh), `feat/auto-tick` (C2 + C3, mới).

## Acceptance criteria (exit 0 = pass; local nhẹ `nice -n 19 ionice -c3`, `-j2`, `CARGO_TARGET_DIR=/home/alexng/tools/su-code-hq/target`)
- C1 **Kit skill `/ship-tick`** model-invocable, được ship-loop/autopilot/ship-auto/ship đặt cron và xoá cron; KIT_FILES 39; help.
  `gh run view 38867604686 --exit-status` (CI 3 OS của feat/ship-tick 62da3d9; test ship_tick nằm ở nhánh đó, không có trên feat/auto-tick)
- C2 **Idle ladder cho phiên đứng một mình** (Rust `ccc/idle.rs`): Stop hook không có team config nhưng `auto` đang on và chưa paused → vẫn chạy ladder (task list đọc `~/.claude/tasks/<session_id>/`, team name `session-<8>`), trả `additionalContext`/`block` như lead; `auto` off hoặc paused → như cũ (None). Test mới `standalone_session_gets_the_ladder_when_auto_is_on`.
  `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code idle::tests`
- C3 **HQ auto-tick qua inbox** (apps/hq-ui `lib/auto-tick.ts` pure + `lib/server/auto-tick.ts`): khi tab Văn phòng poll `/api/auto` và `on && !paused`, mỗi phòng có `inboxLive`, `pending == 0`, không `running`/`needs_input`, rảnh ≥ 60 s và chưa được tick trong 10 phút → `queueInbox(sid, TICK_PROMPT)`; prompt bảo phiên: có loop mở (`su-code/ship/ACTIVE`) → `/ship-tick`, đã có `/loop` riêng → trả lời "đã có loop" và không làm thêm, không thì một việc nhỏ từ `su-code/STATE.md` Next rồi `8sync ccc meet --say`; ghi `ticked` vào state file (0600). Không bao giờ tick khi `paused`.
  `cd apps/hq-ui && nice -n 19 ionice -c3 pnpm exec vitest run tests/auto-tick.test.ts tests/auto-api.test.ts`
- C4 **HQ bản cũ được báo** (tick 1 loop-me): `hq ui --install`, `up` tải sẵn UI + cảnh báo cổng bận, HQ hiện "đang chạy X / đã cài Y".
  `gh run view 38866841389 --exit-status` (CI 3 OS của feat/hq-up-ui-refresh dbf22a9)
- C5 **hq-ui typecheck + lint** sạch.
  `cd apps/hq-ui && nice -n 19 ionice -c3 pnpm exec tsc --noEmit -p . && nice -n 19 ionice -c3 pnpm run lint`
- C6 **clippy touched files** sạch.
  `nice -n 19 ionice -c3 cargo clippy -q -j2 -p su-code 2>&1 | grep -E 'ccc/(idle|auto)\.rs|ccc\.rs|ccc/help\.rs' ; test $? -eq 1`
- C7 **CI xanh 3 OS** trên mỗi nhánh (`ci.yml`: test ubuntu/macos/windows + hq-ui-test + package-hq-ui + minimal).
  `gh run watch <id> --exit-status`

## Giả định (owner "tự làm đi" = Recommended)
- Tick 1 phút theo lời owner; HQ poll 60 s nên độ trễ thực 60–120 s. Không tick lặp dưới 10 phút cho cùng phiên (tránh spam, tiết kiệm token subscription).
- Chỉ tick phiên đã nạp mod inbox (`.live`); phiên chưa nạp → HQ đã có badge "chưa nạp mod" (hq-live-apply).
- Không tạo cron `/ship-tick team-alive-2` trong phiên này: skill chưa cài (kit 38/38 trên máy, chờ release); cron `/loop 5m /loop-me` e23dd948 đang giữ nhịp.
- Loop: `--max-iter 12 --max-min 90` (mặc định).
- Release: không có `--release` → dừng ở nhánh xanh; gom ≥3 nhánh xanh vào MỘT câu Ship.
- Reviewer (SHOULD 4, quyết định sản phẩm, chọn Recommended): Stop hook bắn ở mỗi lần kết thúc lượt nên "1 phút" cho phiên standalone không đo bằng đồng hồ mà bằng rào của ladder (tối đa MAX_BLOCKS=3 nhắc khi task list không đổi, gate owner-có-mặt với subscription, `auto pause`); phiên đang rảnh hẳn (không có Stop) do HQ auto-tick lo (≥60 s, tab Văn phòng mở). Ghi trong comment idle.rs.
