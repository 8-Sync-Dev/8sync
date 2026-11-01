# feat/disk-watch — 8sync clean scan (auto disk-anomaly tracking + deletion plan)

## Goal
Owner 2026-11-01: "nâng cấp harness để auto tracking bất thường dung lượng để có plan xóa" — sau đợt dọn tay +79 GB (bản ghi `su-code/CLEANUP-2026-11-01.md`).

## Checklist
- [x] Research: v0.112.1 đã có `clean --dev` (project junk, models list+forget) — disk scan BỔ SUNG: snapshot + anomaly delta + plan nhóm + guarded apply + roots tmp/Downloads. Không đè verb nào (verb count giữ 30).
- [x] `crates/cli/src/verbs/disk.rs` (~790 dòng + 12 test): no-follow walk (junction=0), unique-by-nlink (Windows=logical), classify 6 lớp, snapshot last.json, anomalies (root ≥10GB/≥20%, entry ≥5GB), plan.md/json nhóm A/B/C/REVIEW/PROTECTED, `--apply` guard (ngay dưới root, không qua .git/protected), `--watch`, `--json`, `SUSYNC_DISK_HOME` sandbox.
- [x] Wire: `clean.rs` (Args +command/apply/json, dispatch đầu `run()`, EXAMPLES), `mod.rs` `pub mod disk;`, Cargo.toml dev-dep `filetime`.
- [x] Test: 614/614 pass (`cargo test --bin 8sync`), build sạch, `--no-default-features` sạch.
- [x] Smoke thật: fixture 7 entry phân lớp đúng (scratch/review/protected/keep, junction skip), dry-run không xoá, apply sandbox chỉ xoá sandbox.

## Current
Đã xong code + test + docs (CHANGELOG/KNOWLEDGE). Chờ: commit → push → PR → CI 3 OS → ask ship (merge + tag + release).

## Incident (đã báo owner)
Smoke `--apply scratch` đầu tiên chạy ngoài sandbox trên plan THẬT → xoá ~6 GB file cũ ≥10 ngày ở Downloads (235 mục nhỏ + vài file GB; `zus-1.7.3-draft`, `infographic-*`…; danh sách đầy đủ trong `~/.local/state/8sync/disk/plan.json` scratch). uat-2026-10-25/27/26 + daily-content còn nguyên (7 ngày < 10). Hậu quả fix: bug size file top-level (0 KB trong plan), thêm `SUSYNC_DISK_HOME`.

## Next
1. Commit `feat/disk-watch`, push, PR, CI xanh 3 OS.
2. ask ship (merge squash + version bump + tag + release.yml).
3. Sau ship: `8sync up` trên máy owner + `8sync clean scan` thật (Downloads + C:\tmp), verify plan.md live.
4. Báo owner các decision treo: VPS vps.8syncdev.com xuống (OVH check), ~330 GB models giữ/xoá, uat-* Downloads 12.4 GB, 5 branch worktree chưa merge, CLAUDE_CODE_SUBAGENT_MODEL.
