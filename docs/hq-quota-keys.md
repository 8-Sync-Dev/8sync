# HQ "Hạn mức": every omp account, API keys for members, per-key call log

Owner ask (2026-11-03): the Hạn mức tab must show every account omp holds with its limit windows, the way
content-post-agency's usage page does; HQ must issue and revoke API keys; every call a member makes with a key
is saved with its project root and what was asked, so the owner can see who works seriously. Calls from the
owner's own machine are not recorded.

## 1. What content-post-agency does (read 2026-11-03)

Files: `apps/content-ai/src/services/omp-gateway.ts`, `src/services/omp-keys/{keys,routes}.ts`,
`web/src/components/OmpQuotaCard.tsx`, `web/src/components/omp-keys/*`, `scripts/lib/omp-clients.mjs`,
`scripts/run-all.mjs` (`startOmpGateway`), migration `0060_omp_api_keys`.

- **Accounts and limits.** `getOmpUsage()` calls the local `omp auth-gateway` (`GET :4310/v1/usage`, bearer from
  `OMP_GATEWAY_TOKEN` or `omp auth-gateway token`). Each report is one signed-in account: `provider`,
  `metadata.{email,orgName,accountId}`, `limits[]` with `label`, `status`, `window.resetsAt`,
  `amount.{used,limit,usedFraction,unit}`. `usedFraction` is the only field every provider fills, so it drives
  the meter. The card hides itself when the gateway is down.
- **Gateway boot.** `run-all.mjs` starts `omp auth-broker serve :4311`, then
  `omp auth-gateway serve --bind 127.0.0.1:4310 --clients=<apps/content-ai/output/omp/gateway-clients.json>`.
- **Keys.** `8sk_` + 32 random bytes base64url. The DB row (`omp_api_keys`) keeps `id` (`k` + 10 hex), `label`,
  `token_prefix` (first 12 chars), `token_sha256`, `models_json`, `created_at`, `revoked_at`. The raw key is shown
  once. Models are `<owner>/<model>` ids from the gateway catalog; `DENY_RE` (`claude|anthropic|opus|sonnet|haiku|
  fable`) is checked on create and again when the file is rendered, so no key can carry Claude (subscription
  tokens are for Claude Code / claude.ai only). At most 50 active keys.
- **Enforcement.** The app only writes the `--clients` file (`{"ca-<id>": {tokenSha256, models}}`, validated, atomic
  rename); omp checks the bearer, limits models and re-reads the file about every 10 s, so revoke takes ~10 s.
- **Write guard.** Create/revoke only from the app itself: loopback Host and the app's Origin.
- **What it does not do.** No per-key call log, no project attribution, no notion of "owner machine". omp's own
  `client_usage` table (agent.db) is per broker install id + app, not per scoped key, and has no project or prompt.

## 2. What omp stores on this machine (read-only)

`~/.omp/agent/agent.db` (`PI_CODING_AGENT_DIR` overrides the folder, as in omp):

- `auth_credentials(id, provider, credential_type, data, disabled_cause, identity_key, updated_at)`: one row per
  login. `data` holds the secrets and is never selected. `identity_key` is `email:<e>|org:<o>` (or `account:<id>`
  for Cursor, NULL for API keys). `disabled_cause = 'deleted by user'` is a removed login; any other cause is a
  broken login (e.g. refresh failed).
- `usage_history(provider, account_key, email, account_id, limit_id, label, window_label, used_fraction, status,
  resets_at, recorded_at)`: every usage report omp fetched (the same reports `/v1/usage` serves), appended per
  limit. The newest row per `(provider, account_key, limit_id)` is the current window.

Measured 2026-11-03: 15 credentials (9 active), 5 providers, 15k usage rows, newest a few minutes old. The gateway
was not running (`omp auth-gateway status`: not configured), so the content-post-agency route would show nothing.

## 3. Design

### Accounts (`GET /api/omp/accounts`, `lib/server/omp-accounts.ts`)

Read agent.db directly, read-only, instead of `/v1/usage`: it lists every login (also those with no usage
endpoint, e.g. NVIDIA, and broken ones), works while the gateway is down, and costs no provider calls.

- Accounts = credentials not deleted by the user. Fields: `id`, `provider`, `kind` (oauth / api_key), `who`
  (email masked to 4 chars of the local part + domain; org name; never `data`), `broken` (the cause, clipped and
  scrubbed of token-like strings), `limits[]`.
- Limits = newest row per series; a series belongs to a credential when provider + email (+ org when both carry
  one) match. A credential without email (Cursor `account:`, API keys) takes the freshest unclaimed series of the
  same provider and kind when it is the only such credential. Several series on one login (Antigravity projects)
  merge per `limit_id`, newest wins.
- A window last read more than a day before the account's newest read is one omp no longer reports (limit ids
  renamed across omp versions) and is dropped. A pool reported under two ids with the same label, window, fraction
  and reset (Antigravity's shared "Claude & GPT") shows once.
- A window whose `resets_at` passed shows "đã reset, chờ số mới" instead of its old fraction.

### API keys (`lib/server/api-keys.ts`, HQ DB)

Same minting and storage as content-post-agency (`8sk_` key, sha256, 12-char prefix, label, models, Claude denied
twice, 50 active keys, raw key shown once).

One deliberate difference: **HQ does not write an omp `--clients` file.** To log the project and the request, HQ
must be on the request path. A key that also worked directly against `:4310` would bypass the log, and the single
gateway on this machine already takes content-post-agency's clients file. So:

- Members call `https://<HQ host>/api/omp/v1` (OpenAI-compatible: `GET models`, `POST chat/completions`,
  `POST responses`) with `Authorization: Bearer 8sk_…` and header `X-8sync-Root: <project root>`. Header values are
  bytes, so a root with non-ASCII characters is sent percent-encoded (`encodeURIComponent`); HQ decodes it.
- HQ checks the key (lookup by sha256, never a comparison on the raw key), refuses revoked keys at once, refuses a
  model the key was not given and anything matching `DENY_RE`, then forwards to the gateway
  (`OMP_GATEWAY_URL`, default `http://127.0.0.1:4310/v1`) with the gateway's own bearer (`OMP_GATEWAY_TOKEN`, else
  `omp auth-gateway token`, re-read on 401). `GET models` returns only the key's models. `/v1/usage` is not proxied.
- Write routes (create / revoke) are local-side only, like `/api/shell`: never through the `--public` quick tunnel.

Tables (`lib/server/db.ts`):

```sql
api_keys(id TEXT PK, label, token_prefix, token_sha256 UNIQUE, models_json, created_at, revoked_at, last_used_at)
api_key_calls(id PK, key_id, at, root, route, model, summary, status, ms, input_tokens, output_tokens, source)
```

### Who is the owner's machine

A call is the owner's when its Host is loopback, it carries no Cloudflare edge header (`cf-connecting-ip` /
`cf-ray`), and every address in a forwarding header (`x-forwarded-for`, `x-real-ip`, `forwarded: for=`) is
loopback. Next.js itself sets `x-forwarded-for` to the socket address, so its presence alone proves nothing (the
sandbox UAT caught this). Owner calls are forwarded but not logged and do not touch `last_used_at`. Everything else
(the `--public` tunnel, the VPS gate, any proxy naming another address) is a member call and is logged. Hosts other
than loopback or the current `--public` host are refused (DNS rebinding). A forwarder on this machine that adds no
forwarding header would look like the owner; cloudflared always adds `cf-connecting-ip`.

### What is logged per member call

`key_id` (the member is the key's label), time, `root` (the `X-8sync-Root` header, ≤ 200 chars; a member call
without it is refused with 400 so every call has a project), route, model, a summary of the request (last user
message, whitespace collapsed, ≤ 200 chars, token-like strings replaced by `[ẩn]`), HTTP status, duration,
input/output tokens when the answer reports `usage` (non-stream JSON, or a stream that sends a usage frame), and
`source` (`tunnel` or `proxy`). Failed calls (bad model, gateway down) are logged too: an attempt is still work.
Calls with an unknown or revoked key are refused and not logged (no member to attach them to).

Not logged: the key, the full prompt, the answer, the caller's IP.

### Retention and privacy

- Key hashes only; the raw key is returned once by `POST /api/omp/keys`.
- Member data = the label the owner types. Calls older than 90 days are deleted on the next insert.
- Account emails leave the server masked.

### Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /api/omp/accounts` | HQ token | accounts + limit windows from agent.db |
| `GET /api/omp/keys` | HQ token | active keys, per-key totals (7 days), last 100 member calls, gateway state |
| `GET /api/omp/keys/models` | HQ token | grantable models (gateway catalog minus Claude) |
| `POST /api/omp/keys` | HQ token, local side | `{label, models}` → `201 {key, token}` |
| `DELETE /api/omp/keys/:id` | HQ token, local side | revoke |
| `GET/POST /api/omp/v1/*` | `Bearer 8sk_…` | the member proxy |

## 4. Limits of this design

- Calls a member makes straight to some other omp gateway, or through content-post-agency's keys, never pass HQ
  and are not in this log.
- Members can only reach HQ when the owner exposes it (`8sync hq ui --public` or the VPS gate). The gateway itself
  must run on the owner's machine (`omp auth-broker serve` + `omp auth-gateway serve`, as content-post-agency's
  `pnpm app` does); HQ does not start it.
- The root is what the member's client sends. HQ can check that it is present, not that it is true.
- Token counts for streams depend on the upstream sending a usage frame; HQ does not add `stream_options` (it would
  change the stream a client receives).
