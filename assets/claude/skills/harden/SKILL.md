---
name: harden
description: Audit tư thế bảo mật Claude Code của máy này rồi đề xuất cách siết — permission mode, tắt bypassPermissions, sandbox, deny rule, MCP server/marketplace tin cậy, hooks, cách login (claude.ai org vs API key), Channels, quyền file .env/key. Dùng khi user gõ /harden, setup máy mới, hoặc muốn cấu hình org Team an toàn nhất.
---
Chỉ đọc và đề xuất. KHÔNG sửa `/etc` hay file hệ thống; KHÔNG đọc/in nội dung `.env`, token, key (chỉ quyền file + có/không).

Đọc: `~/.claude/settings.json`, `.claude/settings*.json` của repo, managed-settings (Linux `/etc/claude-code/managed-settings.json` + `managed-settings.d/`, macOS `/Library/Application Support/ClaudeCode/`), `claude auth status`, `claude mcp list`, `claude plugin marketplace list`, `8sync ccc status`. Mở `/status` trong phiên nếu cần xem `Setting sources`.

Checklist (mỗi dòng OK / WARN / BLOCK + cách sửa):
1. **Login:** claude.ai org (Team) qua OAuth chính chủ, không API key/`apiKeyHelper`/token trong env; `forceLoginMethod: "claudeai"` + `forceLoginOrgUUID` ở managed. Token subscription chỉ cho Claude Code/claude.ai chính chủ — tool bên thứ ba bắt buộc API key.
2. **Permission mode:** không để `bypassPermissions` mặc định; `permissions.disableBypassPermissionsMode: "disable"` ở managed.
3. **Deny rule:** `.env`, `*.pem`, `id_rsa*`, `*.session`, `*.pkl`, force-push có trong `permissions.deny`.
4. **Sandbox:** `sandbox.enabled` (Linux cần bubblewrap/WSL2), cân nhắc `sandbox.failIfUnavailable` + `sandbox.allowUnsandboxedCommands: false`.
5. **MCP:** mỗi server do ai thêm, chạy lệnh gì, có token trong config không; `allowedMcpServers` + `allowManagedMcpServersOnly` ở managed.
6. **Marketplace/plugin:** chỉ `claude-plugins-official` + 8sync; `strictKnownMarketplaces` ở managed. Plugin bên thứ ba = code chưa review.
7. **Hooks:** liệt kê hook đang chạy (guard/verify/gates của kit + hook lạ); `allowManagedHooksOnly` chỉ bật khi hook kit đã nằm trong managed (`8sync ccc policy --strict-hooks`).
8. **Channels:** Team/Enterprise cần `channelsEnabled: true` ở managed mới dùng được (vd. Discord); giới hạn bằng `allowedChannelPlugins`.
9. **File:** `.env`/key quyền 600, không nằm trong git, `.gitignore` đủ.

Kết quả: checklist + việc nên làm theo thứ tự ưu tiên. Đề xuất managed-settings: chạy `8sync ccc policy --org-uuid <uuid>` (in JSON + lệnh `sudo install` để user tự chạy; org UUID lấy ở claude.ai Admin settings). Team plan còn có server-managed settings trong admin console claude.ai (cùng key, không cần file; https://code.claude.com/docs/en/server-managed-settings).

Liên quan: `/sec` (secret + lỗ hổng code) · `/rules` (được phép không) · `/aup-audit` (quét theo Usage Policy).
