# Channels UAT: bật Channels rồi chạy lại inbox → session → reply tool

Question: Owner: Channels on → re-run the channel UAT (inbox → session → reply tool).

Đọc ngày 2026-10-16. Doc: https://code.claude.com/docs/en/channels (S1), https://code.claude.com/docs/en/channels-reference (S2). Repo = `C:\Users\Projects\su-code` (branch `fix/ask-gate-short`).

## 1. Ai bật được Channels, tên setting

- Setting là `channelsEnabled` (master switch, phải `true`). Trên claude.ai Team/Enterprise mặc định là chặn "until an Owner enables them" (S1, mục Enterprise controls).
- Hai đường bật (S1, "Enable channels for your organization"):
  1. UI: `Organization settings > Claude Code > Channels` tại https://claude.ai/admin-settings/claude-code, cần role **Owner**.
  2. Managed settings: `"channelsEnabled": true`. User không override được.
- `allowedChannelPlugins` là setting thứ hai (managed): thay allowlist mặc định của Anthropic, cần `channelsEnabled: true` (S1). Kit KHÔNG đặt key này có chủ đích (`crates/cli/src/verbs/ccc.rs:1568-1575`).
- `channelsEnabled` cũng chặn cả `--dangerously-load-development-channels`: "This flag skips the allowlist only. The `channelsEnabled` organization policy still applies" (S2, "Test during the research preview"). Vì vậy channel tự viết như `8sync-hq` vẫn cần Owner bật.
- Research preview: có. "Availability is rolling out gradually, and the `--channels` flag syntax and protocol contract may change" (S1, "Research preview"). Cả `--channels` lẫn `--dangerously-load-development-channels` không hiện trong `claude --help` nhưng vẫn chạy (S1).
- Điều kiện login: claude.ai hoặc Console API key; không dùng được trên Bedrock/Vertex/Foundry (S1). Pro/Max không có org thì bỏ qua check, tự opt-in bằng `--channels` (S1). Có bị giới hạn theo plan ngoài Team/Enterprise/Console hay không: not verified (doc không liệt kê bảng plan).
- Repo đã ghi nhận: `docs/hq-ui-contract.md:59`, `crates/cli/src/verbs/hq.rs:2882`, skill `assets/claude/skills/harden/SKILL.md:17`. `ccc.rs:1589` có `org_policy_with` tự sinh `channelsEnabled: true` vào policy; bản đó chỉ có hiệu lực nếu được cài làm managed source. Có đã cài lên org này hay chưa: not verified.
- Triệu chứng khi chưa bật: MCP server vẫn connect, tool vẫn chạy, chỉ message không tới; có warning lúc startup (S1). Repo: banner "Channels are not enabled for your org · have an administrator set channelsEnabled" (`apps/hq-ui/tests/delivery.test.ts:30`), debug-file ghi "Channel notifications skipped: channels not enabled by org policy" (`su-code/KNOWLEDGE.md:403`).

## 2. Checklist UAT (chạy lại sau khi Owner bật)

Tiền điều kiện (owner): Channels bật ở org; máy có tmux (UI gõ vào pane `hq-<name>`, `apps/hq-ui/README.md:23-27`); login claude.ai đúng org. Không in token UI (nằm trong HTML được serve, `apps/hq-ui/README.md:44`).

1. Build + cấu hình channel: trong `apps/hq-channel` chạy `pnpm run mcp-config` (build rồi ghi `~/.config/8sync/hq/channel-mcp.json`, 0600; `apps/hq-channel/package.json`, `src/mcp-config.ts:1`, `apps/hq-ui/README.md:19`).
2. Chạy UI: `8sync hq ui` (flag `--port` mặc định 8740, `--no-open`; `crates/cli/src/verbs/hq.rs:122-127`) rồi mở http://127.0.0.1:8740.
3. Tạo session từ UI. UI sẽ spawn `claude --mcp-config ~/.config/8sync/hq/channel-mcp.json --dangerously-load-development-channels server:8sync-hq` khi file cấu hình tồn tại (`apps/hq-ui/lib/server/proc.ts:190-194`; contract `docs/hq-ui-contract.md:57`). Cần session interactive (flag bị bỏ qua với `-p`, S2).
4. Trả lời dialog: warning "I am using this for local development" và dialog folder trust / "New MCP server found" (S2). Trả lời bằng `POST /api/sessions/:name/keys` hoặc nút trong UI (`apps/hq-ui/README.md:40`). Lưu ý: không gõ message khi dialog mở (UI trả 409; `su-code/KNOWLEDGE.md:404`).
5. Kiểm channel đã đăng ký: pane có dòng "Channels (experimental) messages from server:8sync-hq inject directly…" (S2) và KHÔNG có banner "Channels are not enabled"; `/mcp` trong session thấy `8sync-hq`; UI thấy heartbeat < 45 s (`docs/hq-ui-contract.md:45`). Heartbeat không phải bằng chứng giao tin (`su-code/KNOWLEDGE.md:403`).
6. Inbox: gửi một owner message từ UI (`POST /api/messages`). Kỳ vọng tag `delivery = channel` (không phải `terminal`/`channel→terminal`/`blocked-by-org`) (`apps/hq-ui/README.md:23-30`).
7. Session nhận: pane hiện `← 8sync-hq: <text>`; model nhận `<channel source="8sync-hq" chat_id=… message_id=… user=… ts=…>` (S2; meta keys `docs/hq-ui-contract.md:55`).
8. Reply tool: session gọi tool `reply(chat_id, text)`; duyệt permission prompt đầu tiên trong terminal (channel không khai permission relay, `docs/hq-ui-contract.md:56`). Kỳ vọng: câu trả lời hiện trong chat UI qua `/api/channel/reply`.
9. Đối chứng fallback: cùng message khi `HQ_CHANNEL_FLAGS=off` phải ra `terminal` (`apps/hq-ui/README.md:17`).
10. Nếu không tới: chạy session với `claude --debug …` và đọc `~/.claude/debug/<session-id>.txt` (S2); thử `MCP_PROTOCOL_NEGOTIATION=legacy` nếu server không đăng ký (`docs/hq-ui-contract.md:60`; doc nói v2 runtime không đăng ký server negotiate revision 2026-07-28, S1). Ghi kết quả vào `su-code/STATE.md`, bài học vào `su-code/KNOWLEDGE.md`.

## 3. Kiểm được ngay vs bị chặn bởi owner

Kiểm được không cần owner:
- Unit test hq-channel: file `apps/hq-channel/src/channel.test.ts` (9 test: notification shape, poller, reply POST, heartbeat, mcp-config; dòng 32-145). Lệnh: `cd apps/hq-channel && pnpm install && pnpm test` (`package.json`: `tsc` rồi `node --test dist/channel.test.js`). Smoke với MCP client + fake UI: `pnpm run smoke` (`src/smoke.ts:1`). Theo CLAUDE.md đây là việc nhẹ nhưng nên chạy qua CI nếu nặng.
- Test hq-ui cho phần fallback/phát hiện banner: `apps/hq-ui/tests/delivery.test.ts`, `channel.test.ts`; lệnh `pnpm test` (vitest) trong `apps/hq-ui` (`package.json`).
- Đã có bằng chứng live trước đó (Claude Code 2.1.296, Team login): tới task/board/reply tiếng Việt qua đường terminal, channel chỉ test bằng MCP client (`CHANGELOG.md:423`, `su-code/STATE.md:11`).

Chưa kiểm được trên máy này (tôi có chạy thử, KHÔNG phải verified): `pnpm test` trong `apps/hq-channel` fail ở `pnpm install` (cần `pnpm approve-builds` cho `esbuild`, pnpm sinh `pnpm-workspace.yaml` với `allowBuilds: esbuild`), nên chưa có kết quả pass/fail. Tôi đã xóa file `pnpm-workspace.yaml` bị sinh ra. Cần chạy lại trên CI hoặc sau khi owner chọn allow/deny cho esbuild (not verified: Windows, macOS, Linux).

Bị chặn bởi owner:
- Bật `channelsEnabled` (Owner role ở claude.ai admin settings hoặc managed settings) (S1).
- Login/org đúng, trả lời dialog interactive, duyệt permission prompt đầu tiên.
- Discord thật cần bot token của owner (`su-code/STATE.md:77`), ngoài phạm vi UAT này.

## Nguồn
- S1 https://code.claude.com/docs/en/channels (đọc 2026-10-16, mục Enterprise controls, Research preview).
- S2 https://code.claude.com/docs/en/channels-reference (đọc 2026-10-16, mục Test during the research preview, Notification format, Expose a reply tool).
- Repo: các path:line nêu inline.

## Chưa tìm được / mâu thuẫn
- Không có mâu thuẫn giữa doc và repo. Thông báo của doc là "blocked by org policy" (S2) còn banner thực tế trong repo là "Channels are not enabled for your org" (`delivery.test.ts:30`); detector khớp cả `channelsEnabled` (`apps/hq-ui/lib/server/pane.ts:10`).
- Not verified: giới hạn plan ngoài Team/Enterprise/Console, phiên bản Claude Code tối thiểu cho channels (doc không nêu trong phần đã đọc), và `pnpm test` pass hay không.
