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
**SHIPPED v0.114.0** (PR #255, CI 3 OS xanh, release published, `8sync up` xong — 0.113.0 → 0.114.0, scan thật chạy OK, baseline snapshot hôm nay). Release cần 3 chỉnh: bump `Cargo.toml` + refresh `Cargo.lock` (build `--locked`) + bump `assets/claude/.claude-plugin/plugin.json` (test lockstep `plugin_manifest_version_matches_crate`) — thiếu mỗi cái là 1 run fail.

## Incident (đã báo owner)
Smoke `--apply scratch` đầu tiên chạy ngoài sandbox trên plan THẬT → xoá ~6 GB file cũ ≥10 ngày ở Downloads (235 mục nhỏ + vài file GB; thấy được: `zus-1.7.3-draft` 20 MB, `infographic-*` 11 MB/cái; danh sách đầy đủ đã mất khi plan.json bị scan sau ghi đè). uat-2026-10-25/27/26 + daily-content còn nguyên (7 ngày < 10). Hậu quả fix: bug size file top-level, `age_days` epoch bug, thêm `SUSYNC_DISK_HOME` (sandbox bắt buộc cho smoke).

## Next
1. Chờ owner quyết các mục treo (dưới).
2. Decision treo: VPS `vps.8syncdev.com` xuống từ ~17:00 (HTTPS timeout — check OVH Manager); ~330 GB models (huggingface 209 GB, .cache/content-ai 103 GB, mfa-align 5.6 GB, codex-runtimes 2.2 GB) giữ hay xoá; `uat-*` trong Downloads 12.4 GB; 5 branch worktree chưa merge (eccx-lazy, eccx-loop, token-radar…); `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`.
3. Sau vài ngày: `8sync clean scan` lại — anomaly so với baseline hôm nay (Downloads + C:\tmp).
