# HQ UI contract (journal · local API · channel)

Local-only team view for Claude Code sessions. Nothing here talks to Claude's API or holds a Claude credential. Sessions are official `claude` processes started on the owner's machine.

## 1. Event journal (written by `8sync hq hook`, Rust)

- Path: `~/.local/state/8sync/hq/events.jsonl`. The file is mode 0600 and its directory 0700. When it passes 5 MiB it rotates to `events.1.jsonl`, keeping one old file.
- Written only when `~/.config/8sync/hq/config.toml` has `local = true`. `8sync hq ui` sets this on first run. Discord is independent of it.
- One JSON object per line:

```json
{"v":1,"ts":1791800000000,"kind":"task_created","session_id":"…","team":"…","cwd":"/abs/repo",
 "hq_session":"hq-a","task_id":"team:3","subject":"[be] Add /health","role":"backend","from":"implementer","to":null,"text":null}
```

`kind` is one of:
- `task_created`, `task_completed` (TaskCreated / TaskCompleted hooks)
- `teammate_idle`
- `notification`: `text` = the notification type plus its message (masked). Written only when `hq_session` is set
- `session_message`: from PostToolUse on `SendMessage`. `from` is this session, `to` is `tool_input.to`, `text` is `tool_input.message`
- `session_start`, `session_end` (SessionStart / SessionEnd)
- `session_reply`: from the async Stop hook (`8sync hq hook Stop`, own group beside `ccc hook verify-stop`). `text` = hook input `last_assistant_message` (docs: https://code.claude.com/docs/en/hooks) after the shared masker (`crates/ccc-core/src/secret_mask.rs`). Written **only** when `hq_session` is set; non-hq sessions get no row. Skipped when the message is empty

`hq_session` is on every row: env `EIGHTSYNC_HQ_SESSION` (hooks inherit the claude process env) when it matches `hq-[a-z0-9][a-z0-9-]{0,31}`, else `null`. The UI should prefer it over the `session_id` uuid. `from` keeps its `session_message` meaning.

`text` is capped at 4000 chars, cut on a char boundary. Every free-text field (`text`, `subject`, `from`, `to`) is passed through `secret_mask::mask` before it is appended. The masker is a heuristic: it splits on any whitespace and masks `key: value`, `key=value`, `"key":"value"` for token/secret/password/passwd/api_key/apikey/access_key/private_key/authorization/bearer/cookie/session names, known token prefixes/shapes (`sk-ant-`, `sk-`, `ghp_`, `gho_`, `github_pat_`, `AKIA`, `ASIA`, `xox[bpas]-`, JWT `eyJ`, `AIza`, Discord bot tokens) and PEM blocks. A secret with no name and no known shape is not caught, so message bodies of `hq-*` sessions are stored locally on purpose (that is the feature), not guaranteed secret-free.

Retention: the journal is rotated at 5 MB (`events.1.jsonl` kept, older dropped); `hq.db` and `channel-*.json` have no expiry. `8sync hq ui` prints a notice when it turns `local = true` on (after the UI process started). `8sync hq ui --off` sets `local = false`. `8sync hq purge [--yes]` deletes `events*.jsonl`, `hq.db*` and `channel-*.json` in `~/.local/state/8sync/hq` (without `--yes` it lists what it would delete; stop the UI first).

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

## 4. ccc JSON surfaces

Machine-readable output for IDE integrations (ZUS Sessions). Every object carries `"schema": 1`; a breaking change bumps it. Arrays (`ls`) put `schema` on each row, so old readers that ignore unknown keys keep working. Free text goes through the shared masker (`crates/ccc-core/src/secret_mask.rs`); no command prints a token, key or account email.

- `8sync ccc . ls --json`, `8sync ls [--all] --json`: array of rows (`engine, sid, name, status, title, doing, last_user, tasks_done, tasks_total, resume, ...`), each with `schema`.
- `8sync ccc . show <name> --json` (also `8sync show <name> [--engine ccc] --json`): one row plus `last_users: [str]` (max 5), `last_text: str|null`, `tasks: [{id,title,state}]` (`state` = `pending|in_progress|done`), `files: [str]`.
- `8sync ccc kit status --json`: `{schema, kit_version, files:{present,total,missing:[]}, hooks:{guard,verify,stop_gate,watchdog,ship_grant,session_start: bool}, skills:{linked,libraries:[]}, mcp:{cbm,serena:"on"|"off"}, claude:{found,version}}`.
- `8sync ccc login-kind [--json]`: `{schema, kind:"subscription"|"api-key"|"none", source:"env"|"claude-config"|"unknown"}`. `api-key` when `ANTHROPIC_API_KEY` is set (presence only), else `subscription` when `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`) has an `oauthAccount`, else `none`. Plain form: `kind (source)`.
