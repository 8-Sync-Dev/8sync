# HQ UI contract (journal · local API · channel)

Local-only view of the owner's own Claude Code sessions. Nothing here talks to Claude's API or holds a Claude credential. Sessions are official `claude` processes started on the owner's machine.

## 1. Event journal (written by `8sync hq hook`, Rust)

- Path: `~/.local/state/8sync/hq/events.jsonl`. The file is mode 0600 and its directory 0700. When it passes 5 MiB it rotates to `events.1.jsonl`, keeping one old file.
- Written only when `~/.config/8sync/hq/config.toml` has `local = true`. `8sync hq ui` sets this on first run. Discord is independent of it.
- One JSON object per line:

```json
{"v":1,"ts":1791800000000,"kind":"session_message","session_id":"…","cwd":"/abs/repo",
 "hq_session":"hq-a","from":"hq-a","to":"hq-b","text":"API is ready"}
```

`kind` is one of:
- `notification`: `text` = the notification type plus its message (masked). Written only when `hq_session` is set
- `session_message`: from PostToolUse on `SendMessage`. `from` is this session, `to` is `tool_input.to`, `text` is `tool_input.message`
- `session_start`, `session_end` (SessionStart / SessionEnd)
- `session_reply`: from the async Stop hook (`8sync hq hook Stop`, own group beside `ccc hook verify-stop`). `text` = hook input `last_assistant_message` (docs: https://code.claude.com/docs/en/hooks) after the shared masker (`crates/ccc-core/src/secret_mask.rs`). Written **only** when `hq_session` is set; non-hq sessions get no row. Skipped when the message is empty

`hq_session` is on every row: env `EIGHTSYNC_HQ_SESSION` (hooks inherit the claude process env) when it matches `hq-[a-z0-9][a-z0-9-]{0,31}`, else `null`. The UI should prefer it over the `session_id` uuid. `from` keeps its `session_message` meaning.

`text` is capped at 4000 chars, cut on a char boundary. Every free-text field (`text`, `from`, `to`) is passed through `secret_mask::mask` before it is appended. The masker is a heuristic: it splits on any whitespace and masks `key: value`, `key=value`, `"key":"value"` for token/secret/password/passwd/api_key/apikey/access_key/private_key/authorization/bearer/cookie/session names, known token prefixes/shapes (`sk-ant-`, `sk-`, `ghp_`, `gho_`, `github_pat_`, `AKIA`, `ASIA`, `xox[bpas]-`, JWT `eyJ`, `AIza`, Discord bot tokens) and PEM blocks. A secret with no name and no known shape is not caught, so message bodies of `hq-*` sessions are stored locally on purpose (that is the feature), not guaranteed secret-free.

Retention: the journal is rotated at 5 MB (`events.1.jsonl` kept, older dropped); `hq.db` and `channel-*.json` have no expiry. `8sync hq ui` prints a notice when it turns `local = true` on (after the UI process started). `8sync hq ui --off` sets `local = false`. `8sync hq purge [--yes]` deletes `events*.jsonl`, `hq.db*` and `channel-*.json` in `~/.local/state/8sync/hq` (without `--yes` it lists what it would delete; stop the UI first).

## 2. UI server (`apps/hq-ui`, Next.js, Node ≥ 22.5 `node:sqlite`)

- Binds `127.0.0.1` only. Default port 8740, or `HQ_UI_PORT`.
- DB at `~/.local/state/8sync/hq/hq.db`, mode 0600. It ingests the journal by byte offset, so ingestion is idempotent.
- Auth: a random token in `~/.config/8sync/hq/ui-token` (0600) is created on first run. Every API call needs header `x-hq-token`, and mutating calls also check `Origin` equals the UI origin. The page receives the token server-side through a same-origin HTML render only.
- API (JSON):
  - `GET /api/projects` and `POST /api/projects {path}` register or list project folders. A path must be an existing absolute directory.
  - `GET /api/sessions` merges `claude agents --json` with the tmux sessions named `hq-*`. `POST /api/sessions {project, name}` starts `tmux new-session -d -s hq-<name> -c <path> "env EIGHTSYNC_HQ_SESSION=hq-<name> claude <channels flags>"`. `POST /api/sessions/:name/stop` stops one.
  - `GET /api/sessions/:name/screen` returns `tmux capture-pane -p` text (read-only terminal view).
  - `GET /api/messages?session=&after=` and `POST /api/messages {session, text}` (an owner message, stored with `kind=owner_message`).
  - `GET /api/stream` is SSE that pushes new rows from all tables.
- Channel endpoints (token required):
  - `GET /api/channel/inbox?session=<EIGHTSYNC_HQ_SESSION>&after=<id>` long-polls owner messages for that session.
  - `POST /api/channel/reply {session, text}` stores `kind=session_reply`.
  - `POST /api/channel/heartbeat {session}` is sent by the channel every 15 s. The UI treats the channel as connected while the last beat is under ~45 s old.

- Workspace tab "Không gian" (omp-first; both sides, local and the remote gate, read-only except the new session):
  - `GET /api/tree?path=<abs>` → `{path, parent: string|null, roots: string[], home: string, dirs: [{name, path, git}]}`: directories only, one level, sorted, without dot-dirs, `node_modules` or Windows `$…`/`System Volume Information`, at most 500. An empty `path` lists the roots (Windows: existing drive letters `C:\` …; else `/` and home) as `dirs`. `home` is the user's home folder (the picker shortens paths to `~\…`; browsing starts in the folder most known projects sit in, else there). 404 when `path` is not an existing absolute directory.
  - The tab opens on a project picker (recent picks, live rooms' repos, added folders, "Dự án trên máy" from `GET /api/projects`), defaulting to the project selected in the sidebar; the chosen project's start composer and omp sessions fill the main area. Once a pane is open the picker folds into a "Mở phiên" overlay above the panes (panes stay mounted, so no terminal is resized).
  - `GET /api/omp/sessions?cwd=<abs>` → `{cwd, sessions: [row of 8sync . ls --json]}`, run with cwd = that folder (cached 3 s). 422 for a bad `cwd`.
  - `POST /api/omp/sessions {cwd, name, model?}` → `{id: "omp-<16hex>", name, cwd}`. `name` matches `^[a-z0-9][a-z0-9._-]{0,47}$` and is not `ls|list|rm|mv|merge|new`; `model` matches `^[A-Za-z0-9][A-Za-z0-9/._:@-]{0,127}$`. `id` is `ccc_core::room_id(project_root, name)` computed in Node (FNV-1a 64 over the canonical root, which on Windows is the verbatim `\\?\C:\…` form `std::fs::canonicalize` gives; project root = nearest folder with `.git`/`Cargo.toml`/`package.json`/`pyproject.toml`/`deno.json`/`go.mod`, else `cwd`). Nothing starts yet: the server keeps `{cwd, name, model}` as a pending new session for 10 minutes, keyed by that id.
    Optional `worktree: true` starts the session in the git worktree `<repo>/.claude/worktrees/<name>` (made with branch `<name>`, or reused when it exists; 409 with the git error when it cannot be made). Optional `prompt` (the composer text, same length rule as `POST /api/messages`) plus `files` (upload ids from `POST /api/uploads`, only with a prompt, else 422) is queued as an owner message in the room's inbox, so the fresh session receives it as its first turn.
  - `GET /api/omp/sessions?all=1` → `{sessions: OmpTreeRow[]}` (cached 3 s): every omp session `8sync ls --all --json` knows, for the sidebar tree. `OmpTreeRow = {id, name, title, cwd, state: "needs"|"working"|"done"|"error"|"idle", doing, last_active, created, children}`; `cwd` is a real folder (a registry-key `repo` is mapped back through the registry's `index.json` `root`), `created` comes from that registry (ms, or null). `children` (sessions active in the last 24 h only) are the session's task subagents read beside its transcript (`<transcript>/<Agent>.jsonl` + `.md`): `{key: "<id>/<Agent>", title, state, at, detail}`, state from the files (result → done, empty result → error, a write in the last 90 s → working, else idle), newest first. The UI merges them with the office rooms (`lib/session-tree.ts`); group/sort, archive and unread marks live in the browser's `localStorage` only (`hq.tree.prefs`, `hq.tree.archive`, `hq.tree.unread`).
  - Opening the term route for an id `8sync ls` does not know yet but that has a pending new session (`GET /api/sessions/<id>/term`) spawns `8sync ccc term --omp-new <name> [--model <m>] --cols N --rows N` with cwd = the pending `cwd`. It creates or resumes the named session exactly like `8sync . <name>`, so the room id is the same and later opens (`ccc term omp-<id>`, `--takeover`) reach it. This replaces the `new:<base64url(cwd)>:<name>` id form first sketched: panes always hold the canonical `omp-<16hex>` id.
  - `GET /api/commands` → `{commands: [{name, description, source: "omp"|"claude"}]}` from `~/.omp/agent/commands/*.md` then `~/.claude/commands/*.md` (name = file name, description = frontmatter `description:` or the first prose line), cached 30 s. The composer's `/` picker (start of a line) reads it.

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
- `8sync ccc kit status --json`: `{schema, kit_version, files:{present,total,missing:[]}, hooks:{guard,verify,stop_gate,watchdog,ship_grant,session_start: bool}, skills:{linked,libraries:[]}, claude:{found,version}}`.
- `8sync ccc login-kind [--json]`: `{schema, kind:"subscription"|"api-key"|"none", source:"env"|"claude-config"|"unknown"}`. `api-key` when `ANTHROPIC_API_KEY` is set (presence only), else `subscription` when `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json`) has an `oauthAccount`, else `none`. Plain form: `kind (source)`.
