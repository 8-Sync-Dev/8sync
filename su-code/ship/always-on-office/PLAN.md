# always-on-office — không ai rảnh (R&D tự research), critic thay owner chọn, phòng ban theo tên session, office sống động

Owner 2026-10-15 (/ship-loop + /ship-auto): mọi vị trí không rảnh; R&D rảnh thì /deep-research (học Feynman) → plan → hỏi owner bằng một bảng AskUserQuestion có Recommended; vị trí critic (phê bình, review sâu) được owner uỷ quyền chọn thay; mọi vị trí có hình; session = phòng ban theo tên, quan sát nhau để đỡ trùng việc và tốn token, bám context/mem/recall theo tên; office như game 2D, animation mượt nhẹ (agent-sprite-forge); nghiên cứu Rust/wasm và XERJ.
Base: v0.87.0 (`ccc hook idle` ladder, ask gate Sonnet, `hook session-start` digest, HQ office 7 ghế).

## Acceptance criteria (exit 0 = pass)
- C1 R&D rảnh tự research: ladder idle thêm bậc "research" — teammate R&D (tên/agent rd·researcher·explore) hết task → nhắc chạy `/deep-research` câu hỏi mở đầu tiên (STATE `Next`, chưa có brief trong `su-code/research/`) → brief + plan → MỘT AskUserQuestion có Recommended; lead cả team + mọi phòng hết việc → giao R&D (hoặc tự làm) một lần/epoch. Rails cũ giữ (lease, $/giờ, MAX_BLOCKS, OFF mặc định).
  `nice -n 19 cargo test -p su-code -j2 -- ccc::idle`
- C2 Critic thay owner chọn: `8sync ccc delegate on|off|status` (features.toml `delegate`, OFF mặc định) + `ccc hook delegate` (PreToolUse AskUserQuestion, không gọi model): khi bật, câu hỏi sản phẩm/kỹ thuật bị trả lại kèm hướng dẫn "gọi agent `critic` chấm option (FATAL/MAJOR/MINOR), chọn option critic chọn (mặc định Recommended), ghi quyết định vào `su-code/DECISIONS.md`, không hỏi owner". Luôn để owner trả lời: header `Ship`, secret/credential/login, xoá/không hoàn tác/tiền/deploy prod/push main/merge/release, high-risk (pháp lý, y tế, tuyển dụng, tín dụng). Agent `critic` trong kit.
  `nice -n 19 cargo test -p su-code -j2 -- ccc::delegate`
- C3 Phòng ban theo tên session: `hook session-start` thêm khối "Phòng của bạn": tên session (registry `ccc .`) → vai trò (rd/qa/ui/api/ops/docs/sec/core…; tên lạ → dùng nguyên tên làm chủ đề), recall ≤5 dòng theo chủ đề tên, và "Phòng khác đang làm" (session sống khác cùng repo: tên + việc gần nhất, ≤5 dòng) để tránh trùng file. Không lộ nội dung ngoài repo; tổng output < 10,000 ký tự.
  `nice -n 19 cargo test -p su-code -j2 -- ccc::room`
- C4 Office: ghế Critic thứ 8 (agent `critic`); mọi ghế có sprite riêng theo vai (phụ kiện/màu), animation: idle thở + chớp mắt, typing ≥2 frame, walking ≥4 frame, một vòng rAF chung (không mỗi canvas một timer), dừng khi tab ẩn, `prefers-reduced-motion` → khung tĩnh.
  `cd apps/hq-ui && nice -n 19 pnpm vitest run tests/office.test.ts tests/sprite.test.ts && nice -n 19 pnpm typecheck`
- C5 UAT trình duyệt (Edge headless, HOME cô lập): 8 ghế/phòng, canvas đổi pixel theo thời gian (animation chạy), reduced-motion đứng yên, không tràn ngang 390 px, không pageerror.
  `bash su-code/ship/hq-office-rooms/uat.sh`
- C6 Brief nghiên cứu có nguồn: Feynman (auto/deep research), agent-sprite-forge (animation), XERJ + Rust/wasm (token/RAM) → khuyến nghị adopt/trial/skip.
  `test $(grep -c 'https://' su-code/research/2026-10-15-always-on.md) -ge 6`
- C7 CI xanh Linux/macOS/Windows trên PR; /sec + /rules + /aup-audit; CHANGELOG.
  `gh pr checks <n> --watch --fail-fast`

## Assumptions
- "Autowork vĩnh viễn": trên gói subscription giữ lease owner-có-mặt của `idle` (Consumer/Claude Code terms: dùng tự động không người trông thuộc API key Console). Delegate chỉ trả lời câu hỏi, không tự mở session. Ship/secret/destructive luôn hỏi owner (CLAUDE.md 8 Sync).
- Feynman không có chế độ research khi rảnh (RELEASES.md:358); lấy thiết kế pipeline + verifier→reviewer (MIT, ý tưởng, không chép code).
- Tên session: registry `~/.config/8sync/ccc/<project-key>/index.json` (name ↔ conversation_id = session_id).
- Wasm cho renderer: chỉ làm nếu brief C6 có số đo cho thấy cần; mặc định canvas 2D + một rAF.
