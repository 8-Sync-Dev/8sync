# no-idle-t6 — phòng ban thật: gate chất lượng, phản xạ học, hỏi phòng khác nhẹ nhàng, thẻ handoff có "đã trả lời"

Goal (owner 2026-10-14): không để agent rảnh; rảnh thì hồi ức + học phản xạ, hỏi lead, cả phòng rảnh thì hỏi phòng khác (session khác); HQ hiển thị rõ.
Base: v0.85.0 (`ccc hook idle`, HQ idle chips, team thread handoff cards đã có từ trước).

## Acceptance criteria (exit 0 = pass)
- C1 `8sync ccc hook task-done` (TaskCompleted, sync, no model, OFF unless no_idle): exit 2 + lý do khi transcript có Edit/Write sau lần chạy test/check cuối VÀ git tree bẩn; ≤2 lần chặn/task rồi cho qua; unit test cả 2 nguồn (TaskUpdate, teammate kết thúc lượt).
  `nice -n 19 ionice -c3 cargo test -p su-code -j2 -- ccc::taskdone`
- C2 Phản xạ học: task bị chặn rồi qua → hook idle kế tiếp (TeammateIdle stderr / lead Stop additionalContext) nhắc một lần "/remember failure: … → fix: …"; qua ngay → không nhắc; không tự ghi KNOWLEDGE.
  `nice -n 19 ionice -c3 cargo test -p su-code -j2 -- ccc::taskdone ccc::idle`
- C3 Lead Stop "hỏi phòng khác" + recall/learn → `hookSpecificOutput.additionalContext` (Stop); giao task giữ `decision:block`.
  `nice -n 19 ionice -c3 cargo test -p su-code -j2 -- ccc::idle`
- C4 Handoff giữa phòng: journal hq ghi `pid` (process Claude Code, unix) → ingest học alias `pid:<n>` → `to` dạng `uds:…/<n>.sock` hiện tên session; thẻ handoff có "đã trả lời / chưa trả lời" (B gửi lại A sau đó). Test fixture.
  `cd apps/hq-ui && nice -n 19 pnpm vitest run tests/team-thread.test.ts tests/ingest.test.ts && pnpm typecheck` + `cargo test -p su-code -j2 -- hq::`
- C5 CI xanh Linux/macOS/Windows (workflow ci.yml trên PR), /sec, CHANGELOG.

## Assumptions
- Socket `cc-socks/<pid>.sock` = pid của process claude: quan sát trên Linux (ls + ps, 2026-10-14), không có trong docs → chỉ là gợi ý hiển thị; Windows/macOS: not verified, fallback hiện địa chỉ rút gọn.
- TaskCompleted không có additionalContext trong docs (chỉ exit 2 / continue:false) → nhắc /remember đi qua hook idle kế tiếp.
- Đọc transcript tail 512 KiB như gate.rs; nhận diện "check" bằng danh sách lệnh test/lint/build phổ biến.
- Handoff: mỗi session tự journal tin GỬI đi (PostToolUse SendMessage); "đã trả lời" = tin ngược chiều B→A của chính B. Không parse `queue-operation` (tin nhận) trong transcript: cố ý, tránh đọc nội dung transcript session khác.
- Tin sang session khác chỉ lưu summary hoặc dòng đầu ≤80 ký tự (giữ data ít nhất); handoff trong team hq-* giữ như cũ.
- `sessions/<pid>.json` của session đã chết có thể còn → tên trùng thì bỏ (ambiguous). Windows: `messagingSocketPath` là named pipe, dạng `to` chưa thấy: not verified Windows (fallback = địa chỉ rút gọn, text vẫn cắt khi `uds:`).
