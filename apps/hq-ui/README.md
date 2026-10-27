# hq-ui

Local team view for Claude Code sessions (contract: `docs/hq-ui-contract.md`). Next.js on Node >= 22.5 (`node:sqlite`), bound to `127.0.0.1` only. Usually started by `8sync hq ui`.

```bash
pnpm install
pnpm build          # eslint + next build (typecheck)
pnpm test           # vitest: ingest mapping, validation, auth, inbox, heartbeat, delivery path
pnpm dev            # or `pnpm start` after a build; port from PORT / HQ_UI_PORT (table below)
```

`pnpm dev` / `pnpm start` go through `scripts/next.mjs`, which reads the port and runs Next with no shell, so
they work the same on Windows (where pnpm runs scripts through cmd.exe), macOS and Linux.

## Environment

| Var | Default | Meaning |
|---|---|---|
| `PORT` / `HQ_UI_PORT` | `8740` | Listen port (host is always 127.0.0.1); `PORT` wins, an empty value counts as unset, and a value that is not a port (1-65535) stops `pnpm dev` / `pnpm start` with an error. Passed to sessions as `HQ_UI_PORT` so their channel finds the UI. |
| `HQ_CHANNEL_FLAGS` | contract §3 flags | Extra `claude` argv for sessions started here, split on whitespace (no shell). `off` = no channel; owner messages are typed into the tmux pane. Unset = `--mcp-config ~/.config/8sync/hq/channel-mcp.json --dangerously-load-development-channels server:8sync-hq`, used only when that file exists. |

Generate the channel config with `pnpm run mcp-config` in `apps/hq-channel`.

## Owner message delivery

`POST /api/messages` (and owner tasks) store an `owner_message` tagged with how it was delivered:

- `channel`: the session's channel sent a heartbeat (or polled the inbox) in the last 45 s, so the message waits in `/api/channel/inbox`.
- `terminal`: no fresh heartbeat, so the text was typed with `tmux send-keys -t =hq-<name>: -l -- <text>` then `Enter` (multi-line text uses a bracketed paste buffer).
- `failed`: the tmux fallback failed (for example, the session is gone). The UI shows "not delivered".
- `channel→terminal`: sent by channel, but nothing came back from the session (reply, task or other journal row) within 25 s, so it was typed into the pane once, but only if the channel poller never fetched it. If the poller did fetch it, the message is never retyped and is tagged `unconfirmed`. A timeout never marks the session `unresponsive`.

A fresh heartbeat is not enough on its own: when the pane shows Claude Code's "Channels are not enabled … channelsEnabled" banner, the session is marked `blocked-by-org` (sticky until it is restarted from the UI) and every message is typed into the terminal.

## Security notes

All routes send `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`. The UI token is embedded in the served HTML, so any local process that can fetch `http://127.0.0.1:<port>/` can read it. Accepted risk: the server listens on 127.0.0.1 only and the owner's machine is the trust boundary.

Owner text (messages, task subjects) containing C0 controls other than `\n` and `\t`, DEL, C1 (U+0080-U+009F) or the bracketed-paste end `ESC[201~` is refused with 422. `GET /api/messages?limit=` takes an integer, clamped to 1-500; anything else is a 400.

## Terminal drawer keys

`POST /api/sessions/:name/keys` answers Claude Code's dialogs (folder trust, auto mode, permission prompts). Body is `{keys: [...]}` with names from a fixed allowlist (`Enter`, `Esc`, `Up`, `Down`, `Tab`, `1`, `2`, `3`, `y`, `n`, max 8), or `{text, enter}` for one line typed with `send-keys -l` (control characters refused). Same token and Origin checks as other mutating calls; tmux gets argv only. `GET /api/sessions` reports an open dialog as `waiting`.
