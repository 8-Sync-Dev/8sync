---
name: sec
description: Quét bảo mật diff hoặc repo hiện tại — secret (không in giá trị), file nhạy cảm đang track/trong history, dependency audit, guard/hook/deny rule của kit, rồi review code đổi theo OWASP. Dùng khi user gõ /sec, trước commit/PR/release, hoặc sau khi diff đụng auth, input, file credential, dependency.
argument-hint: [diff | repo]
---
Mặc định quét diff hiện tại (`git diff` + file untracked); `repo` hoặc không có diff → cả repo. Chỉ báo file:dòng + loại, KHÔNG in giá trị secret.

1. **Secret:** có gitleaks → quét đúng phần đang ship, KHÔNG quét cả history (một lần quét cả history của repo lớn ăn 3–4 GB RAM và ~30% CPU trong vài phút; nhiều phòng cùng chạy làm máy vượt ngưỡng guard — 2026-10-21): commit của nhánh `gitleaks detect --no-banner --redact --max-target-megabytes 5 --log-opts=origin/main..HEAD` + phần chưa commit `gitleaks protect --staged --no-banner --redact` (nhánh chính không phải `main` → thay tên). Chỉ `repo` hoặc sắp public repo mới quét cả history (`gitleaks detect --no-banner --redact --max-target-megabytes 5`), chạy một mình, không song song với phòng khác. Không có gitleaks → regex trên file đang track và diff: khoá API (AWS, GitHub, Anthropic, OpenAI, Slack), header PEM private key, gán `password|secret|token` bằng chuỗi literal dài. Nói rõ đã dùng công cụ nào.
2. **File nhạy cảm:** `git ls-files` và `git log --all --name-only --format=` lọc `.env` (trừ `.example/.sample/.template`), `*.pem`, `*.p12`, `*.session`, `*.pkl`, `id_rsa*`, `id_ed25519*`, `credentials*`. Còn trong history → `git filter-repo` + rotate.
3. **Dependency audit** — chỉ chạy công cụ có sẵn, thiếu thì ghi "skipped: thiếu <tool>": `cargo audit` (Cargo.lock) · `pnpm audit` / `npm audit` (lockfile tương ứng) · `govulncheck ./...` (go.mod) · `pip-audit` (requirements/pyproject).
4. **Kit:** chạy `8sync ccc status` — guard hook, verify/stop gate, deny rule `.env`/key/force-push còn bật không; managed-settings có không. Thiếu → `8sync ccc kit`; muốn siết cả máy → `/harden`.
5. **Review code đổi theo OWASP:** có `/security-review` built-in và skill `senior-security` → dùng chúng cho bước này, không viết lại. Tự làm thì soát: injection (SQL/shell/path), authN/authZ thiếu, SSRF, deserialization, crypto yếu, log lộ dữ liệu, CORS/CSRF, `unsafe`/`eval`/`exec` mới.
6. **Báo cáo:** bảng `mức | mục | file:dòng | việc cần làm`. **BLOCK** (secret thật, lỗ hổng khai thác được — dừng ship) · **WARN** (rủi ro cần user quyết) · **OK** (liệt kê ngắn mục sạch + mục bị skip).
7. Secret thật → bảo user rotate NGAY và xoá khỏi history; không tự rotate, không tự xoá, không lặp lại giá trị.

Liên quan: `/aup-audit` (quét theo Usage Policy) · `/rules` (được phép không) · `/harden` (cấu hình Claude Code).
