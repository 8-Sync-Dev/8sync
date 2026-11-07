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
- [ ] v0.133.1: phòng omp còn subagent chạy nền hiện đang làm (owner báo 12:15)

## Current
Worktree `C:\Users\Projects\su-code-bgwork`, nhánh `fix/omp-bg-working`.

## Next
- Thử APK trên điện thoại thật với `8sync hq ui --tailnet`; P1: APK theo ABI, thanh trạng thái theo màu trang.
- Pane Orca cũ của phòng profile (`omp-58c205d74a964fbb`) vẫn chạy extension cũ: mở lại pane hoặc "Chuyển sang HQ" để nhận tin.
- Owner còn treo: #79 (DB rejected nhưng 5 kênh hẹn 08/11 15:00), #77 quay lại cảnh 13+14, quay lại #19/#20/#21/#24, 5 quyết định 18–30/11, dọn repo public, link Tailscale, domain Cloudflare, mật khẩu/PIN Windows, model ~81 GB, dsh-superagent observe.
- Worktree giữ: `.claude/worktrees/radar-20261102-1926` (#258), `.claude/worktrees/xenodochial-leavitt-eef970` (#244), `su-code-zalo` (#276).
