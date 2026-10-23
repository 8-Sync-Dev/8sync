# Provenance: loop-harness

- Ngày: 2026-10-16. Slug: `loop-harness`. Final: `outputs/loop-harness.md`.
- Pipeline (deep-research v2):
  - plan `outputs/.plans/loop-harness.md`;
  - evidence `outputs/.drafts/loop-harness-r1.md` và `-r2.md`;
  - draft `-draft.md` (lead viết);
  - verifier → `-cited.md`;
  - reviewer 1 vòng → sửa → final;
  - re-review 1 lần sau khi sửa FATAL (xem dưới). Verification: PASS (0 FATAL ở vòng 2).
- Scale: 2 researcher (tính năng Claude Code; điều khoản + code 8sync). Lead tự đọc lại các trang quyết định kết luận.

## Nguồn đã đọc

| # | Nguồn | Phạm vi |
|---|---|---|
| 1 | code.claude.com/docs/en/scheduled-tasks | đủ trang |
| 2 | code.claude.com/docs/en/agent-view | 100,000/137,050 ký tự (phần còn lại chưa đọc) |
| 3 | code.claude.com/docs/en/goal | đủ trang |
| 4 | code.claude.com/docs/en/settings-reference | chỉ dòng mục lục `autoContinueAtUsageLimit` (trang > 100k ký tự) |
| 5 | code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset | đủ mục; lead đọc lại để kiểm `/bg` |
| 6 | code.claude.com/docs/en/desktop-scheduled-tasks | đủ trang |
| 7 | code.claude.com/docs/en/routines | đủ trang |
| 8–10 | `docs/legal/anthropic/` (legal-and-compliance, consumer-terms, usage-policy), snapshot 2026-10-12 | dòng trích: 13, 52–55; 28; 131, 134, 197 |
| 11 | support.claude.com article 11647753 (usage limits) | đủ; không có số quota cụ thể |
| 12 | code.claude.com/docs/en/channels | đủ |
| 13 | code.claude.com/docs/en/interactive-mode#queue-messages-while-claude-works | mục queue + `Ctrl+X Ctrl+S` |
| L1–L6 | code local: `auto.rs`, `target.rs`, `idle.rs`, `help.rs`, `assets/claude/CLAUDE.md`, frontmatter skill | đọc tại commit 4bd7317 (sau #59) |

Không đọc: docs statusline (cách tính `cost_usd`); docs permission mode "auto" (điều kiện gói/model).

## Đã đo / chạy

- `cargo test` module `ccc::` (local, `nice`, `-j2`): 232 pass trên nhánh #59.
- CI PR #59: test ubuntu, macos, windows và hq-ui đều pass (run 38927452710).
- Live: chưa chạy loop thật trong phòng đang mở bằng bản mới. Không smoke `auto add --now` (nhắn phòng thật). Ghi "not verified" trong brief.

## Verify

Verifier trên draft: 33 OK · 6 FIXED (sửa số/trích cho khớp nguồn) · 1 UNVERIFIED.

## Review (vòng 1, trên bản cited)

1 FATAL · 5 MAJOR · 3 MINOR. Đã sửa tất cả:

- **FATAL:** draft đóng khung loop subscription như cách chạy 24/7. Final sửa:
  - loop chỉ dùng khi owner có mặt hoặc phòng đang mở;
  - chạy không người trông → Routines, Desktop scheduled task hoặc API key, theo [1] ("Use /loop for quick polling during a session") và [8]:52;
  - binary in đúng điều này từ PR #59.
- **MAJOR:**
  - `auto on` còn bật idle, delegate `--after 60` và auto.json; nêu các câu vẫn hỏi owner.
  - Trần $ là `cost_usd` của status line: cần `statusline --install`, là trung bình với sàn 1 giờ, không phải quota guard.
  - Hàng đích là đường prompt injection nội bộ; `--check` vẫn qua permission; `done` do phòng tự chấm.
  - Phân biệt permission mode "auto" với `8sync ccc auto`; điều kiện của mode đó để [UNVERIFIED].
  - Lead tự phát hiện thêm khi đọc lại [5]: autoContinue không áp cho session nền, `-p` hay teammate. Kết luận 3 sửa theo, binary sửa ở #59.
- **MINOR:**
  - Dừng ngay: `8sync ccc cancel --all`, kiểm ở `cancel.rs`: tắt idle + delegate và đánh dấu auto paused; cron trong phòng thì không với tới. Kèm cách huỷ job `8sync-auto-loop` trong phòng hoặc đóng session.
  - Gia hạn thì mốc tính trung bình của trần được đặt lại.
  - Gom caveats.

`/loop clear` (gợi ý trong summary của `cancel.rs`) không đưa vào final vì chưa thấy trong docs scheduled-tasks đã đọc.

## Re-review (vòng 2, trên final; một lần, theo skill)

0 FATAL · 1 MAJOR · 5 MINOR. Reviewer kiểm lại FATAL vòng 1 (đã sửa), autoContinue với [5], spot-check [7][2][1], L3 và L7, cùng mọi trích dẫn legal: đều khớp. Đã sửa:

- **MAJOR:** Routines được khuyên mà thiếu caveat. Lead đọc lại [7] để xác nhận rồi thêm vào Kết luận 2 và recipe:
  - "without stopping for approval";
  - connector "including writes, without asking for permission";
  - mất rail của 8sync (clone mới);
  - `/schedule` cần login claude.ai.
- **MINOR:**
  - Tách cite: Console API key lấy từ [8]:53, không phải [1].
  - Kết luận 6 ghi rõ là suy luận từ [1] và [8]:52.
  - `/bg` + `Ctrl+T` vẫn cần máy owner bật.
  - Thêm Remote Control vào ngoại lệ autoContinue.
  - Binary nói chắc "sẽ thử lại" trong khi brief gắn nhãn suy luận → sửa chữ trong `loop_notes` ở PR tiếp theo (sau v0.98.0).

## [UNVERIFIED] còn lại

- Cách Claude Code tính `cost_usd` trong status line.
- Điều kiện gói/model của permission mode "auto".
- Phòng `/bg` chạy tiếp khi nhịp cron rơi sau giờ reset: suy luận, chưa kiểm thật.
- "Explicitly permit" trong consumer-terms:28 có bao gồm việc script local đưa tin vào inbox của session hay không: không nguồn nào nói.
