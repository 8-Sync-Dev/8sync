---
name: full-flow
description: >-
  Use this skill for ANY fix/dev/enhance task on the 8syncdev-pro-v2 stack that must be PROVEN on the running app — "làm full flow", "fix theo flow chuẩn", "dev + verify", "tự chạy đến done". It is the entry playbook + verification gate: ground first (trail), reproduce, implement DATA→BACKEND(Encore)→FRONTEND(Next), then self-verify end-to-end through BOTH the Next.js UI (oh-my-pi `browser` tool) AND Encore structured trace logs before claiming done. Composes with `trail` (navigate first); never replaces it.
---

# full-flow — self-driving fix / dev / enhance loop (8syncdev-pro-v2)

> **HARD MANDATE:** "Done" = the running app proves it. Drive the FE as a real user with the oh-my-pi `browser` tool **and** read the Encore trace for the same action. One source alone (only a screenshot, or only a curl) = guessing. NEVER declare "works" from a typecheck/build alone.
>
> **★ TRAIL / GROUND FIRST:** any symbol/path/endpoint lookup → `trail ask`/`trail grep` (or `search`/`read`) BEFORE guessing. State the `path:line` hit before editing.
>
> **★ READ THE WHOLE EVIDENCE:** after a browser action, `tab.observe()` (not just a screenshot) AND read the matching `[encore]` log lines (correlate by `trace_id`). Scan for non-`ok` codes, 4xx/5xx, error toasts.

## 0. Stack shape
- **Monorepo** (Turborepo + pnpm): `apps/web` (:3000), `apps/coding` (:3001), `apps/app` admin (:3010) — Next.js 16 + Turbopack + React 19. Ports per `scripts/dev.mjs` + each app's `productHost` map.
- **Backend** `backend/` — single Encore.ts app. `pnpm backend:dev` (= `encore run`) → API **:4000**, dev dashboard + traces **:9400**. Services live in `backend/services/<name>/` (`encore.service.ts` + `<name>.ts` + `db.ts` + `migrations/NNN_*.up.sql` + `__tests__/`).
- **Encore needs Docker running** (provisions Postgres). CLI on PATH: `export PATH="$HOME/.encore/bin:$PATH"`.
- **Auth (custom, ADR-019):** username/password seeded in `*.up.sql`; httpOnly session cookie `__session_8sync`; Encore gateway authHandler does a session lookup. Seeded logins: `admin8syncdev`/`admin8syncdev` (owner) and `usertest8syncdev`/`usertest8syncdev` (student) — both on `pro_monthly`.
- **FE↔BE:** typed client `@8sync/api-client` (regen: `pnpm backend:gen:client`); FE calls with `credentials: "include"` (cookie). Coding login is OPTIONAL (anonymous browse/run; submit/save requires login).

## 1. THE LOOP
```
1. GROUND     trail/search the symbol/route; read the FE component + BE endpoint
2. REPRO      bring the stack up (§3); browser the current state
3. IMPLEMENT  order DATA → BACKEND (Encore) → FRONTEND (Next). Respect §2 gates.
4. VERIFY     browser drives the UI as a user  ⨉  read [encore] trace by trace_id
              BOTH must agree: UI shows the change AND the BE call is correct (code=ok)
5. CLEANUP    changelog/tests/docs LAST, gated on a green smoke. Loop until DONE.
```

## 2. Invariant gates (check BEFORE you edit/commit)
- **TS purity:** NEVER `: any` / `as any` — use `unknown` + guards, domain types, `satisfies`. Static string lookup tables → `Record<K,V>`; reserve `Set`/`Map` for runtime collections. `strict` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature` are ON.
- **Encore migrations:** `NNN_<label>.up.sql`, monotonic, no skips — Encore advisory-locks Postgres and runs them in order. Never edit an applied migration; add a new one.
- **Auth scheme:** session cookie `__session_8sync` (or `Authorization: 8syncdev <token>` fallback). Verify authed flows through the browser (cookies), not raw `Bearer` curl.
- **Never commit local-only:** `backend/encore.app` `id` link + any `.secrets.local.cue` / `.env.local`.
- **Cadence:** identifiers in code = English; user copy + Markdown = Vietnamese. Biome 2.4 only (no Prettier). No new lib without an ADR.

## 3. Run & capture logs
```bash
cd <repo-root> && export PATH="$HOME/.encore/bin:$PATH"
setsid bash -c 'cd backend && exec encore run' >/tmp/encore.log 2>&1 </dev/null & disown
setsid bash -c 'cd apps/app && exec pnpm dev' >/tmp/admin.log 2>&1 </dev/null & disown   # :3010
setsid bash -c 'cd apps/coding && exec pnpm dev' >/tmp/coding.log 2>&1 </dev/null & disown # :3001
# readiness:
curl -s -m3 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/health/ping   # 200 = up (502 = compiling)
curl -s -m3 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010                # 200/307 = up
```
`encore run` hot-reloads on change. Read logs with the `read` tool on `/tmp/encore.log` (NOT grep/tail pipelines).

## 4. Drive the FE (oh-my-pi `browser` tool)
- Prefer `tab.observe()` (structured roles/names/ids) over screenshots for state + selectors; screenshot only when visual appearance matters or to show the user.
- The headless tab is often `document.visibilityState === 'hidden'` → `requestAnimationFrame` is throttled, so `motion/react` entrance animations may sit at their initial state. Call `page.bringToFront()` before asserting post-animation opacity/visuals.
- Login (admin): open `http://localhost:3010/login`, fill username/password (`admin8syncdev`), submit, re-observe to confirm the dashboard.
- To exercise a server route with the live cookie without UI setup, `tab.evaluate(async()=>{ const r=await fetch('/api/...',{...}); return {status:r.status, body:await r.json()} })`.

## 5. Confirm the BE (Encore trace)
- Encore logs every request as `[encore]`/`INF` lines in `/tmp/encore.log` with `endpoint=`, `service=`, `trace_id=`, `code=`, `duration=`, and (authed) `uid=`. One FE action fans out to several BE calls sharing a `trace_id` — correlate by it.
- ASSERT the expected `endpoint`/`service` fired, the authHandler completed, `uid` is right, `code=ok`, sane `duration`. Visual traces: open `http://127.0.0.1:9400` in the browser tool.
- Direct probe: `curl -s -X POST :4000/auth/login -d '{"username":"admin8syncdev","password":"admin8syncdev"}' -i` → `Set-Cookie __session_8sync` + `{user,plan}`.

## 6. DECISION GATES — stop & ask
- Docker not running / Encore won't boot / Postgres not provisioned and the fix is non-obvious.
- A screen needs seed data the DB lacks and seeding is ambiguous.
- A change would require committing the local `encore.app` link or secrets.
- Two viable approaches with materially different tradeoffs and the choice is the user's.

## 7. Anti-patterns (cause false "done")
- Declaring success from a screenshot alone or a curl alone — both halves, every turn.
- Asserting motion/visual state in a hidden headless tab without `page.bringToFront()`.
- Editing a guessed path without grounding first; editing an already-applied migration.
- `: any` / `as any`; `Set`/`Map` for a static lookup table.
- Probing authed endpoints with raw `Bearer` curl and calling the 401 a bug (use cookie/browser path or the `8syncdev` header).
- Running project-wide build/lint as the only verification.
