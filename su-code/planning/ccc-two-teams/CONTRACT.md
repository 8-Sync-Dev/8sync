# ccc-two-teams — shared contract (v1.0, 2026-10-19)

Owner goal: CLI is on/off only; everything else from HQ UI (local or remote link). Rooms never stay stuck:
unanswered questions are answered (HQ within 1 min, else critic), permission prompts while the owner is away
are decided from HQ or auto-denied with guidance, API-error/usage-limit stops resume by themselves, and a second
team of omp rooms works next to the Claude Code (ccc) rooms and they message each other.

Compliance (org rules + Anthropic, NON-NEGOTIABLE): never read/store/forward Claude OAuth credentials (no
`api/oauth/usage`, no `.credentials.json`); usage numbers come ONLY from the status-line JSON Claude Code gives
the status line (`rate_limits.*.used_percentage|resets_at`, epoch seconds). Never auto-ALLOW a permission —
only the owner (via authenticated HQ) allows; timeout = deny. No bypass-permissions flags. omp team features are
disabled when the omp model provider is `anthropic` (subscription OAuth stays in Claude Code only). Everything
off unless the owner turned `8sync ccc auto on` (scope `--here` respected via `auto::in_scope`).

All state paths below are under `home` = the user's home dir (same on Windows: `C:\Users\X\.local\state\...`).
`STATE` = `~/.local/state/8sync/hq` (Rust `Paths::under(home).state_dir`), `CCC` = `~/.local/state/8sync/ccc`,
`CFG` = `~/.config/8sync/hq`. Dirs 0700, files 0600 on unix. Writes = tmp file + rename (atomic).

## C1 Usage snapshot (Rust writes, HQ reads) — `STATE/usage/<session_id>.json`
Existing object gains two fields: `"five_hour_resets_at": u64|null`, `"seven_day_resets_at": u64|null`
(epoch seconds, from `rate_limits.five_hour.resets_at` / `.seven_day.resets_at`). Existing: `five_hour_pct`,
`seven_day_pct`, `ts` (epoch s), `session_id`, `cwd`, `model`, ...

## C2 Stop-failure record (Rust) — `CCC/stopfail/<session_id>.json`
`{"error": str, "ts": u64, "cwd": str, "auto": u32, "resume_at": u64|null, "resumed_at": u64|null}`
- `auto` = consecutive automatic resumes already done for this session (carried over from the previous record
  when it was resumed automatically; reset to 0 when the owner types a prompt).
- `resume_at` = when 8sync will resume it automatically (null = never, owner must act). Policy:
  rate_limit → reset time from the freshest usage snapshot (+60 s): windows with pct ≥ 90 → latest resets_at,
  else five_hour.resets_at if in the future, else ts + 900·(auto+1); null if > 24 h away or auto ≥ 2 (mirrors
  Claude Code's own autoContinueAtUsageLimit: ≤2 consecutive, not weekly). overloaded | server_error | unknown →
  ts + min(60·2^auto, 900), null when auto ≥ 5. max_output_tokens → ts + 5, null when auto ≥ 2. Everything else
  (authentication_failed, oauth_org_not_allowed, account_on_hold, billing_error, invalid_request,
  model_not_found, cloud_credential_error) → null.
- `resumed_at` set when an automatic resume prompt was submitted (record kept so the count survives; HQ stops
  showing "Kẹt"). A human prompt deletes the record (existing `resume-note` behaviour).
- The automatic resume prompt starts with the marker `[8sync:resume]`.
- `8sync ccc . ls --json` rows (ccc-core) expose `stalled_error` (only when `resumed_at` is null) and new
  `stalled_resume_at` (u64|null).

## C3 Inbox ids + `8sync ccc inbox` (Rust) — existing `STATE/inbox/<id>.jsonl` lines `{"ts":ms,"text":str}`
- ccc room id = Claude session id (unchanged). omp room id = `omp-` + 16 lowercase hex of FNV-1a-64 over
  `<canonical project root as UTF-8>` + `"\0"` + `<session name>` (Rust fn `room_id`, single source of truth).
- `8sync ls --json` / `8sync ccc . ls --json` rows gain `"inbox_id": str|null` (ccc: session id; omp named
  session: room id). HQ uses `inbox_id` to deliver to any room of either team.
- `8sync ccc inbox --session <id> --json` claim: when no owner message is pending and C2 says a resume is due
  (auto on + in scope of record cwd, now ≥ resume_at, resumed_at null) → `{"text": "[8sync:resume] ..."}`.
  Ack/release on a synthetic text are no-ops (the record itself is the dedupe).
- omp rooms are launched by `8sync . <name>` with env `EIGHTSYNC_ROOM=<name>` and `EIGHTSYNC_ROOM_ID=<room id>`.

## C4 Teams + nudges + messages (Rust)
- `CCC/auto.json` gains `"teams": ["ccc"] | ["ccc","omp"]` (absent = ["ccc"]). `8sync ccc auto on --omp`
  turns both on; `8sync ccc auto omp on|off` toggles omp; `auto status --json` includes `teams`.
- `8sync ccc auto nudge --session <room id> --cwd <dir> --json` → `{"text": str|null}`: text when auto on, not
  paused, "omp" in teams, in scope, lease not expired, a target is queued, and this room got no nudge in the last
  10 min (≤ 6/h; state `CCC/nudge/<id>.json`). Text = queue head + check + how to report (`auto done <id>
  --evidence`) + how to talk to other rooms (`8sync ccc msg`).
- `8sync ccc msg <room> "<text>" [--from <room>]` (agents of both teams): resolves `<room>` among this
  project's ccc named sessions and omp named sessions (name match; ambiguous → error listing ids), cleans text
  (target.rs `clean`), queues it into the room's inbox as `"[từ phòng <from>] <text>"`, and appends a
  `session_message` journal event `{from,to,text}` so HQ chat shows it. `msg --all "<text>"` = every room of the
  project except the sender. Exit 1 when no room matches.

## C5 Pending questions/permissions (Rust hook writes, HQ answers) — `STATE/pending/`
Request `<id>.json` (id = 16 lowercase hex):
```
{"v":1,"id":"…","kind":"question"|"permission","session_id":"…","cwd":"…","room":str|null,
 "created":ms,"deadline":ms,
 "questions":[{"question","header","options":[{"label","description"}],"multiSelect"}],   // question
 "tool":"Bash","summary":"<masked one line, ≤300 chars>",                                  // permission
 "owner_only":bool,"fallback":"critic"|"deny"|"dialog"}
```
Answer (HQ writes atomically) `<id>.answer.json`:
question → `{"v":1,"answers":{"<question text>":"<label or free text ≤500>"},"note":str?}`;
permission → `{"v":1,"allow":bool,"note":str?}`.
Hook polls every 500 ms until `deadline`; answer → delete both files; timeout → delete request, apply fallback.
- AskUserQuestion (`ccc hook delegate`): delegate on + in scope + owner away (no typed prompt for
  `delegate_after_s`, default 60 via `auto on`) → post + wait `min(after_s, 540)` s. Answer → PreToolUse
  `permissionDecision:"allow"` + `updatedInput` = original input + `answers`. Timeout: normal question → existing
  critic deny reason; owner-only (Ship/secret/delete/money/deploy/merge/release/high-risk) → no output (dialog
  shows for the owner). after_s = 0 keeps today's immediate critic. Owner present → no output.
- PermissionRequest (`ccc hook permission`, new, matcher `*`): same gates. Answer allow → `decision.behavior
  "allow"`; deny → `"deny"` + message; timeout → deny with message: owner away > N s, do not wait, take a path
  that needs no new permission or record what needs owner approval in the final report and continue. Never
  allow without an owner answer. Kit hook timeout 600 s for both.

## C6 Public link (Rust launcher writes, HQ reads) — `CFG/public.json`
`{"v":1,"host":"<sub>.trycloudflare.com","key":"<64 hex>","since":ms}` (0600). `8sync hq ui --public` starts
`cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<port>`, scrapes the host from stderr, writes the
file, prints `https://<host>/api/login?k=<key>`; removes the file on exit and at every non-public start.
HQ: `GET /api/login?k=` on the public host with the right key → cookie `hq_pub=<key>` (HttpOnly; Secure;
SameSite=Strict; Path=/; Max-Age=43200) + 303 to `/`. Requests with Host == public host need that cookie (+ the
existing `x-hq-token`; mutations need `Origin: https://<host>`). Quick tunnels drop SSE → remote clients poll.
