# STATE — su-code

## Goal
Owner 2026-11-05: chọn model (map đúng sang omp) + mức suy nghĩ ngay ở ô chat phòng, popover bong bóng đổi nhanh; ô chat tự cao theo dòng. "ultracode" là của Claude Code, omp không có → bỏ qua.

## Checklist
- [x] `/api/models` GET/POST (chỉ chủ): omp = `omp models --json` (model có key/đăng nhập, mức theo `thinking[]`), Claude tmux = alias `/model` + `/effort`
- [x] `8sync-inbox`: tin điều khiển `/8sync-model {json}` → `pi.setModel` rồi `pi.setThinkingLevel` (chỉ phiên), lỗi/kẹp mức/throw ghi `error` và luôn ack; ghi `omp-model/<id>.json` mỗi tick
- [x] `ModelPicker` trong Composer + RoomSend; phòng extension cũ (không có file state) → nút báo mở lại, POST 409
- [x] Ô chat tự cao tới 40dvh, fallback JS khi không có `field-sizing`
- [x] PR #313 (base `feat/skill-hq-control`), vitest 838/838, tsc/eslint/build sạch
- [ ] Owner duyệt thứ tự merge #278 → #312 → #310 → #311 → #313 rồi release
- [ ] Sau release: `8sync up`, thoát + mở lại các phòng omp để picker bật

## Current
PR #313 chờ CI + owner duyệt.

## Next
- Merge chuỗi PR HQ, release v0.122.15, `8sync up` + `8sync harness global`.
- Treo từ trước: Tailscale bị WARP chặn; dọn đĩa (ct-plan 64,8 GB, pnpm 11,5 GB); VPS `vps.8syncdev.com`; PR #297; clip #3 thiếu `media_path`.
