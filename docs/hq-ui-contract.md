# HQ UI contract (journal · local API · channel)

Local-only team view for Claude Code sessions. Nothing here talks to Claude's API or holds a Claude credential. Sessions are official `claude` processes started on the owner's machine.

## 1. Event journal (written by `8sync hq hook`, Rust)

- Path: `~/.local/state/8sync/hq/events.jsonl`. The file is mode 0600 and its directory 0700. When it passes 5 MiB it rotates to `events.1.jsonl`, keeping one old file.
- Written only when `~/.config/8sync/hq/config.toml` has `local = true`. `8sync hq ui` sets this on first run. Discord is independent of it.
- One JSON object per line:

```json
{"v":1,"ts":1791800000000,"kind":"task_created","session_id":"…","team":"…","cwd":"/abs/repo",
 "task_id":"team:3","subject":"[be] Add /health","role":"backend","from":"implementer","to":null,"text":null}
```

`kind` is one of:
- `task_created`, `task_completed` (TaskCreated / TaskCompleted hooks)
- `teammate_idle`
- `notification`: `text` = the notification type plus its message
- `session_message`: from PostToolUse on `SendMessage`. `from` is this session, `to` is `tool_input.to`, `text` is `tool_input.message`
- `session_start`, `session_end` (SessionStart / SessionEnd)

`text` is capped at 4000 chars, cut on a char boundary. Secrets are never logged on purpose; message bodies the user's agents wrote are logged locally because that is the feature.

## 2. UI server (`apps/hq-ui`, Next.js, Node ≥ 22.5 `node:sqlite`)

- Binds `127.0.0.1` only. Default port 8740, or `HQ_UI_PORT`.
- DB at `~/.local/state/8sync/hq/hq.db`, mode 0600. It ingests the journal by byte offset, so ingestion is idempotent.
- Auth: a random token in `~/.config/8sync/hq/ui-token` (0600) is created on first run. Every API call needs header `x-hq-token`, and mutating calls also check `Origin` equals the UI origin. The page receives the token server-side through a same-origin HTML render only.
- API (JSON):
  - `GET /api/projects` and `POST /api/projects {path}` register or list project folders. A path must be an existing absolute directory.
  - `GET /api/sessions` merges `claude agents --json` with the tmux sessions named `hq-*`. `POST /api/sessions {project, name}` starts `tmux new-session -d -s hq-<name> -c <path> "env EIGHTSYNC_HQ_SESSION=hq-<name> claude <channels flags>"`. `POST /api/sessions/:name/stop` stops one.
  - `GET /api/sessions/:name/screen` returns `tmux capture-pane -p` text (read-only terminal view).
  - `GET /api/tasks?project=` and `POST /api/tasks {session, subject, role, prio}`. A task from the owner becomes an owner message to the session: "New task: …".
  - `GET /api/messages?session=|team=&after=` and `POST /api/messages {session, text}` (an owner message, stored with `kind=owner_message`).
  - `GET /api/stream` is SSE that pushes new rows from all tables.
- Channel endpoints (token required):
  - `GET /api/channel/inbox?session=<EIGHTSYNC_HQ_SESSION>&after=<id>` long-polls owner messages for that session.
  - `POST /api/channel/reply {session, text}` stores `kind=session_reply`.
  - `POST /api/channel/heartbeat {session}` is sent by the channel every 15 s. The UI treats the channel as connected while the last beat is under ~45 s old.

## 3. Channel `8sync-hq` (MCP stdio server, Node/TS, ships as a plugin in the `8sync` marketplace)

- Started by Claude Code via Channels.
- Reads `EIGHTSYNC_HQ_SESSION` and the token file, and long-polls `/api/channel/inbox`. Each owner message is pushed into the session as a channel event. A `reply` tool posts the session's answer to `/api/channel/reply`.
- Protocol ([channels-reference](https://code.claude.com/docs/en/channels-reference)):
  - The server declares `capabilities.experimental['claude/channel'] = {}` and `tools: {}`.
  - It pushes `notifications/claude/channel` `{content, meta}`. Meta keys must be identifiers: `chat_id`, `message_id`, `user`, `ts`.
  - It exposes the tool `reply(chat_id, text)`, and its `instructions` tell Claude to answer with that tool.
  - It does NOT declare the permission relay. Tool approvals stay in the terminal for now.
- Loading: a custom channel is not on Anthropic's allowlist, so during the research preview a session is started as
  `claude --mcp-config ~/.config/8sync/hq/channel-mcp.json --dangerously-load-development-channels server:8sync-hq`
  - This needs an interactive session. Claude Code shows a warning dialog.
  - On a claude.ai Team/Enterprise org, an Owner must enable Channels (`channelsEnabled`).
  - Set `MCP_PROTOCOL_NEGOTIATION=legacy` if the server isn't registered (MCP v2 runtime note).
- Fallback when the channel isn't connected (no `session_reply`/heartbeat from it): the UI types the owner's message into that session's own tmux pane (`tmux send-keys -l` + Enter). It is the same as the owner typing in their terminal: the official binary is unmodified and no credential is involved. The UI shows which path delivered the message.
