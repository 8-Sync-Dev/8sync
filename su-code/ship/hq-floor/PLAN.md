# PLAN — hq-floor: HQ UI shows what every ccc session is doing (2D pixel office)

## Goal
Open `8sync hq ui` and understand in 2 seconds which Claude Code session is doing what: each session is a pixel character at a desk whose animation and one-line caption show its state; details and chat are one click away. On brand (8 Sync lime on near-black).

## Non-goals
No model calls from the UI (Vercel AI SDK used for UI components only; Claude subscription stays inside official Claude Code). No image-generation APIs. No local `next build` on the owner's machine (CI builds).

## Acceptance criteria
1. Floor is the default tab; every session from `8sync ls --json --all` + hq tmux/claude agents appears as a character with a readable name (title / hq name, never a bare uuid).
2. States drive distinct animations + text label: idle (sitting), working/editing (typing), running a command (terminal glow), reading/searching (looking), waiting for owner (raised hand + badge), stalled/error (red "!" after API-error record or no progress while running > 5 min), done (all tasks done → cheer once).
3. Caption: one line `doing` + task progress `3/7`; click opens the session panel (chat rendered with AI Elements Conversation/Message, terminal, tasks).
4. `prefers-reduced-motion` → static frame; animation pauses when the tab is hidden; WCAG AA contrast; state never shown by color alone.
5. `/api/floor` is token-authenticated, cached 4 s with one in-flight `8sync ls` call.
6. Brand: 8 Sync mark + lime/near-black tokens + Geist/Be Vietnam Pro.
7. Composer hidden when no session runs; old idle sessions collapsed.
8. Tests: vitest for sprite data integrity, state derivation, /api/floor auth+cache; Rust test for new `last_tool` / `error` fields. CI runs hq-ui typecheck + vitest + build.

## Tasks (parallel where files are disjoint)
- R (Rust): `session_view.rs` row_json adds `last_tool` (structured tool name) and `stalled_error` (StopFailure record for that session id); tests.
- S (sprites+floor): `apps/hq-ui/lib/sprite/*` (palette-indexed pixel frames, canvas renderer), `components/hq/floor-view.tsx`, `lib/floor.ts` (state derivation), `app/api/floor/route.ts`, tab wiring in `hq-app.tsx`; tests.
- B (brand+UX+chat): tokens/fonts in `app/globals.css` + `app/layout.tsx`, logo in `public/` + `nav.tsx`, AI Elements chat in `team-view.tsx`, readable names/collapse in `nav.tsx`/`bits.tsx`, composer hiding; tests where logic.
- C (CI): hq-ui typecheck + vitest job in `.github/workflows/ci.yml`.
- U (UAT): download CI's packaged hq-ui artifact, run it locally (no build), screenshot the floor with real sessions.

## Risks
- Shadcn/AI Elements versions vs React 19.3/Next 16.4; keep only display components, pin versions.
- Brand files come from a proprietary repo; su-code is public: copy only the logo mark + token values (owner approved).
- `8sync ls --all` cost per poll: cache + single flight.
