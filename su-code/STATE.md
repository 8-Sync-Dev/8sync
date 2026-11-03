# STATE — su-code

## Goal
HQ qua link `--public` điều khiển terminal mượt + báo đúng khi omp crash trên máy (v0.120.6).

## Checklist
- [x] v0.120.5: skill `ego-zalo-advisor` (bundled, eccx content/specialized), deploy `~/.omp/skills` + `~/.claude/skills`
- [x] Repro trên link thật: phím lộn thứ tự; kill omp → link vẫn "Đang nối", bridge+omp mới lặng lẽ mở
- [x] Fix: `keyQueue` (phím tuần tự), bridge thoát mã 4 khi host đóng, HQ giữ bridge đã kết thúc theo gen, long-poll `&wait=`
- [x] Test: vitest 760, cargo 636; smoke bridge: rời = 0, omp chết = 4
- [ ] Release v0.120.6 → `8sync up` → HQ tự restart → UAT lại qua link (thứ tự phím, độ trễ, crash notice, Nối lại, nhắn qua link)
- [ ] Dọn phiên thử `uat-link-phien-thu-se`, tab `hqpub`

## Current
Release v0.120.6 (branch fix/hq-link-term-crash-realtime, worktree su-code-term).

## Next
UAT lại trên link public, dọn scratch, báo owner.
