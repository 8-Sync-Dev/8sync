# hq-live-apply — PLAN (autopilot item, 2026-10-16)

Owner: "cứ rơi vô trạng thái xong việc là không làm tiếp dù có gửi tin nhắn cho nhau … apply active lại các session đang work tôi không muốn mở lại claude code".

Findings (evidence in transcript): peer messages DO wake idle sessions (ping→pong 3 s). The open
sessions have not loaded mod `8sync-inbox` (zero `ccc inbox` polls in 95 s of pgrep sampling):
a skills-dir plugin written to disk reaches a running session only after `/reload-plugins`
(code.claude.com/docs/en/plugins/loading.md). Nothing in HQ tells the owner which sessions have
the mod, so an HQ task "qua inbox (nhận ngay khi phiên rảnh)" silently waits for the Stop hook.
Separately, HQ "chưa trả lời" never clears: `team-thread.ts` compares raw ids while the journal
stores `to_` as the typed text ("core [ff2607]") and the reply's `from_` as a uuid.

## Deliverables
1. `claim_inbox` touches `<inbox>/<id>.live` on every claim (only the mod claims) → "mod loaded
   for this session". `sweep_orphans` drops `.live` older than 24 h.
2. HQ `Room.inboxLive`; wording "qua inbox (nhận ngay khi phiên rảnh)" only when live, else
   "qua inbox (nhận khi xong lượt — gõ /reload-plugins trong phiên để nhận ngay)"; office card
   shows "Inbox · mod" / "Inbox · chưa nạp mod"; `/api/messages` and `/api/tasks` return `live`.
3. `8sync ccc kit` / `8sync up` print "phiên đang mở: gõ /reload-plugins (không cần restart)"
   when a mod file changed.
4. `resolve_peer` accepts `name [ref]`; `team-thread.ts` `answered` compares resolved names.

## Criteria
| # | Criterion | Command |
|---|---|---|
| C1 | live marker + resolve_peer | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code hq::` |
| C2 | kit reload hint | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code kit_` |
| C3 | HQ vitest (team-thread, assign-ui, office) | `cd apps/hq-ui && pnpm vitest run tests/team-thread.test.ts tests/assign-ui.test.ts tests/office.test.ts` |
| C4 | HQ typecheck | `cd apps/hq-ui && pnpm tsc --noEmit` |
| C5 | clippy touched crate | `nice -n 19 ionice -c3 cargo clippy -q -j2 -p su-code -- -D warnings` |
| C6 | CI 3 OS | `gh run watch <id> --exit-status` |

Not in scope: auto-typing `/reload-plugins` into panes (could answer an open dialog), relay mod,
`8sync` speaking the socket protocol, flipping `8sync ccc idle on` (owner decision, costs tokens).
