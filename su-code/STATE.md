# STATE — su-code

## Goal
Owner 2026-11-07 `/solo` (auto, không hỏi): `/solo` mạnh nhất (research web + cổng UAT), video demo mới qua phòng cpa `su-code-demo`, web + README mạnh hơn; APK HQ Android có link tải + roadmap; HQ phòng omp trong Orca nhận tin không cần "Chuyển sang HQ"; xem file nhắc tới ngay trong HQ trên điện thoại.

## Checklist
- [x] v0.132.0 (PR #350): `/solo` research + cổng UAT, map WebSearch/WebFetch cho omp, site/README mục `/solo` + Code search; `8sync up` + `harness global` + UAT bản cài
- [x] Video demo 42 s (phòng cpa `su-code-demo`) vào `docs/assets/8sync-demo.mp4`, gỡ `hq-demo.*`
- [x] Sửa inbox Orca: tra lại room id, `session_switch`, poll treo 60 s, setModel 20 s (6 test)
- [x] Xem file nhắc tới trong HQ: `POST /api/files/locate` + FileChips/PathLink, UAT 390/1280
- [x] APK `apps/hq-android/` + `hq-android.yml` (ký v2/v3, UAT emulator không chặn), roadmap `docs/hq-android.md`
- [x] v0.133.0 (PR #351): released, APK gắn vào release, `8sync up` + UAT
- [x] v0.133.1 (PR #352): phòng omp còn subagent chạy nền hiện đang làm
- [x] v0.134.0 (PR #353): HQ › Máy › Canh máy (phòng canh, cron mặc định 30 phút, khẩn khi tăng đột biến, Gửi urgent ngay, Nghi vấn + Kill) + `eco scan`/`eco kill <pid:start>`

- [x] v0.135.0 (PR #354) + v0.135.1 (PR #355): HQ tự cập nhật, UAT thật: HQ live tự lên 0.135.1 lúc 18:02 không cần `8sync up`, trang tự tải lại
- [ ] v0.135.2: giữ lần tự cài qua restart, đọc binary ngay, sửa chữ lúc đổi bản; UAT = HQ tự lên 0.135.2

## Current
Worktree `C:\Users\Projects\su-code-watch`, nhánh `fix/hq-update-status`.

## Next
- Sau khi bật Canh máy: tắt monitor PowerShell tạm của phòng Admin (`C:\Users\Admin\scratch\hqmon`, service `hq-machine-mon`). Việc tiếp theo cho Rust: chụp process một lần bằng `NtQuerySystemInformation` (+2 KB), lấy GPU theo process qua PDH (+11 KB).
- Thử APK trên điện thoại thật với `8sync hq ui --tailnet`; P1: APK theo ABI, thanh trạng thái theo màu trang.
- Pane Orca cũ của phòng profile (`omp-58c205d74a964fbb`) vẫn chạy extension cũ: mở lại pane hoặc "Chuyển sang HQ" để nhận tin.
- Owner còn treo: #79 (DB rejected nhưng 5 kênh hẹn 08/11 15:00), #77 quay lại cảnh 13+14, quay lại #19/#20/#21/#24, 5 quyết định 18–30/11, dọn repo public, link Tailscale, domain Cloudflare, mật khẩu/PIN Windows, model ~81 GB, dsh-superagent observe.
- Worktree giữ: `.claude/worktrees/radar-20261102-1926` (#258), `.claude/worktrees/xenodochial-leavitt-eef970` (#244), `su-code-zalo` (#276).
