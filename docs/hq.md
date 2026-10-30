# Agent HQ: your Claude Code team on Discord

`8sync hq` gives one owner a private Discord server where a Claude Code agent team works in the open. It has logs and alerts. The owner talks to the lead session from Discord.

Two pieces, two directions:

| Direction | What | Auth |
|---|---|---|
| Owner ⇄ lead session | Anthropic's official **Channels** plugin `discord@claude-plugins-official` inside your own Claude Code session | your Claude Code login (subscription OAuth stays inside official Claude Code) |
| Team → Discord | `8sync hq` posts through webhooks under persona names (PM, Architect, Backend, Frontend, QA, Reviewer, Researcher). It is driven by the Claude Code `Notification` hook | a Discord bot token and webhook URLs only. HQ never sees a Claude credential |

## Setup (about 15 minutes)

1. **Discord app.** At <https://discord.com/developers/applications>, create an application, add a bot, and turn on **Message Content Intent**. A bot in fewer than 100 servers can enable this privileged intent without verification. The Channels plugin needs it for two-way chat; the HQ webhooks do not. Copy the bot token. Never paste it into a chat.
2. **Server.** Create a private server, then invite the bot with the URL that `8sync hq setup` prints. The URL asks for no Administrator; the Manage Channels/Roles permissions are only needed for setup.
3. **Layout.** Run:
   ```bash
   printf %s "$BOT_TOKEN" | 8sync hq setup --guild <server id> --token-stdin   # add --dry-run first to preview
   ```
   This creates the categories 📌 HQ · 🗂 WORK · 🗓 RITUALS · 🤖 TEAM ROOMS · ⚙ OPS, the forums `rfcs` and `notes`, the persona roles, one webhook per channel, and a pinned charter in `#readme` that says every persona is an AI agent. It is idempotent: it creates only what is missing and matches existing items by name.
   - Secrets are stored in `~/.config/8sync/hq/secrets.json` (mode 0600). Ids and tags go in `config.toml`. State in `~/.local/state/8sync/hq/` keeps only task ids, thread ids, status, role and title, never message bodies.
4. **Two-way chat.** In Claude Code, run `/plugin install discord@claude-plugins-official`, then give it the bot token without pasting it into the chat (a token typed into `/discord:configure` ends up in the session transcript): write it to the plugin's token file `~/.claude/channels/discord/.env` with mode 0600 as the [Channels docs](https://code.claude.com/docs/en/channels) describe, or rotate the token afterwards if you used `/discord:configure`. Then run `/discord:access pair <code>`, and set the policy to `allowlist`, with only your Discord ID on it. Anyone on the allowlist can approve tool use. On a **Team/Enterprise** plan, the org Owner must set `channelsEnabled: true`; `8sync ccc policy` includes it.
5. **Lead session.** Run `8sync hq up --repo <repo> --name <lead>`. It prints a systemd user unit that runs your session inside tmux with Channels turned on (`--install` also removes the units of the retired daily standup). Add `--install` to write the unit and `--now` to start it.
6. **Hooks.** `8sync ccc kit` registers the hook as an async command. Until `hq setup` has run, it is a no-op that takes about 4 ms.

## Daily use

- **Messaging the lead.** Type in `#owner-desk`; the lead session reads it through the Channels plugin.
- **Commands.** `8sync hq post --as <role> --to <channel> …`, `8sync hq status`.
- **Limits HQ follows.** Content is cut to 2000 characters and embed descriptions to 4096. A 429 is retried using `retry_after`. Mentions are off by default.

## Rules that apply

- **Anthropic.** Claude Code's legal page says "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK" ([legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)). That sentence covers Pro and Max. Team and Enterprise fall under the Commercial Terms, per the same page. The same page says developers building products on the Agent SDK "should use API key authentication through Claude Console" and may not route requests through Free, Pro or Max credentials on behalf of users ([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) is the SDK reference). Running a 24/7 fleet on one subscription, or sharing a bot, is therefore not "ordinary, individual usage"; the Console API key or one seat per person rule is 8 Sync policy, not a quoted clause (not verified as a seat rule). Never put your OAuth token on a server. Use `/rules` for the exact clauses.
- **Discord.** No self-bots. Don't train AI on message content. Keep only the data you need. Personas are labelled as AI.
- **Before you invite anyone.** Run `/aup-audit` and `/harden`. Anyone who talks to the agents must be told they are AI.

## HQ web: Cách dùng (apps/hq-ui)

Bảng điều khiển web chạy trên máy bạn (127.0.0.1); `8sync hq ui --public` mở thêm link internet (Cloudflare quick tunnel, cần `cloudflared`). Nút "Cách dùng" trong app mở cùng nội dung này; lần đầu mở app nó tự hiện.

HQ chỉ xem và điều khiển các session của chính bạn: nó không tự mở session, không tự gửi lời nhắn vào session nào.

1. **Mở session theo vai trò.** Tab Sessions: R&D, Plan, Architect dùng Opus (`claude-opus-5-5`). Fullstack, AI, Reviewer dùng Sonnet (`claude-sonnet-5-5`). Tester, Quick dùng Haiku (`claude-haiku-5-5`).
2. **Nhắn một phòng.** Bấm tên phòng để mở Chat phòng rồi gõ tin: tin vào terminal của phòng hoặc vào inbox của nó.
3. **Xem terminal trực tiếp.** Bấm vào bàn hoặc thẻ của một phòng.
4. **Chat nhóm.** Xem ai nhắn ai theo thời gian, kèm thẻ bàn giao (handoff) "A → B".
5. **Anh cần trả lời.** Câu hỏi và yêu cầu quyền của các phòng đang chờ bạn, kèm cách mở terminal của phòng để trả lời.
6. **Kẹt.** Phòng dừng vì lỗi API hay hết usage hiện lỗi kèm "cần anh xử lý"; HQ không tự chạy lại phòng nào.
7. **Tri thức · Vòng lặp.** Tab Tri thức = cây tri thức của máy (`8sync ccc know`); tab Vòng lặp = các vòng `/ship-loop` đang chạy.
8. **Usage.** Thanh trên cùng như Orca: "N% used 4h 11m · 7d N%" (cửa sổ 5 giờ, thời gian tới reset, cửa sổ 7 ngày), lấy từ status line.

Biểu tượng trạng thái: Chờ anh · Đang làm · Rảnh.

**Mẹo tiết kiệm.** `/do` cho việc nhỏ. `/ship-loop` cho việc chạy dài, luôn đặt giới hạn vòng/phút. Haiku cho test và việc lặp lại.

**Offline.** UI chỉ nói chuyện với 127.0.0.1. Kiểm bằng `bash scripts/hq-offline-check.sh`.

### Văn phòng: mỗi session là một phòng

- **Phòng.** Mỗi session Claude Code đang chạy (mở ở HQ hay ở terminal/IDE khác) là một phòng, xếp theo thư mục git của session và nhánh (`⎇ main`, `⎇ feat/x`). Thanh bên trái cũng nhóm session theo thư mục + nhánh.
- **Ghế giống nhau ở mọi phòng:** Lead (chính session), R&D, Plan, Fullstack, Reviewer, Tester, Quick. Ghế sáng khi agent chuyên gia (subagent) của session đó đang chạy, ghi "vừa xong" trong 10 phút sau khi xong. Nguồn: hook `SubagentStart`/`SubagentStop` (cài bằng `8sync ccc kit`).
- **Đi sang phòng khác.** Khi một session nhắn session khác (`SendMessage`), lead của phòng gửi đi bộ sang phòng nhận kèm câu nhắn, trong 2 phút. Bật "giảm chuyển động" thì đứng yên.
- **Chat phòng** = chỉ tin của một session. **Chat nhóm** = mọi phòng nhắn nhau. Bấm một phòng để mở Chat phòng của nó.
- **Nhắn session mở ngoài HQ (inbox).** Session không chạy trong tmux của HQ (mọi session trên Windows) nhận tin qua inbox: tin được xếp vào `~/.local/state/8sync/hq/inbox/<session id>.jsonl` (0600) và hook Stop giao cho session khi nó xong lượt đang làm. Session HQ (`hq-*`) vẫn nhận ngay qua terminal.
- **Báo cáo** (tab và `8sync ccc . report [--json]`): chi phí, thời gian, số dòng +/−, context theo từng phòng và tổng, cùng các vòng `/ship-loop`. Chi phí lấy từ con số Claude Code đưa cho status line của 8sync (`~/.local/state/8sync/hq/usage/<session id>.json`); phòng chưa có số ghi "chưa đo", không ước lượng.
- **An toàn.** Guard của kit chặn session ghi vào inbox hoặc đọc UI token (`~/.config/8sync/hq/ui-token`) qua Bash/PowerShell/Write/Edit, nên một session không giả làm owner được. Giới hạn còn lại: guard không xem tool Read và không phân tích được mọi chương trình tự viết file; inbox và token là file của chính user trên máy.
- **Link internet (`--public`).** Lệnh in `https://<tên>.trycloudflare.com/api/login?k=<khoá>`; mở link một lần để nhận cookie (HttpOnly, Secure, SameSite=Strict, 12 giờ). Mỗi lần bật là host + khoá mới; tắt `hq ui` là link chết và `~/.config/8sync/hq/public.json` bị xoá. Quick tunnel không có SSE nên UI từ xa tự chuyển sang hỏi định kỳ. Ai có link là điều khiển được các phòng — không chia sẻ. Guard và deny rule của kit chặn session đọc khoá này.
