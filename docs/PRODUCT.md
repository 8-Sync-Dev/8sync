# Product

## Register

brand

## Users

Developers who run coding agents (omp, Claude Code, Forge) or are about to, on Linux, macOS or Windows: the 8 Sync team first, then other engineers who find the repo or the Pages site. They arrive from GitHub, a video or a teammate's link, often in the evening with a terminal open, deciding whether one command and one dashboard can replace the tabs of agents they juggle. The job: install in one line, open a named session with `8sync . <name>`, and see it in 8 Sync HQ.

## Product Purpose

8sync is one Rust binary that opens a named coding-agent session per repo with `8sync . <name>`: omp by default, Claude Code with `--mode claude-code-cli` (with the 8sync kit: guard, verify hook, stop and ask gates, `/ship` and four more levels of hands-off work), Forge supported, Codex CLI planned. 8 Sync HQ (`8sync hq ui`) shows every session on the machine, on the desk or on a phone. The long-term goal is every coding-agent CLI, each controllable from HQ. The Pages site exists so a visitor can answer three questions in under a minute: how do I install it, which engine do I get, and what does HQ show me. Success is a visitor copying the install line and knowing which command to type next. Visual identity follows the 8 Sync logo (lime to cyan to blue "8") on deep navy; the release number is always fetched, never written into the page.

## Brand Personality

Engaged, exact, nocturnal. The voice of a flight-deck placard: short, literal, specific numbers with their source. Confident because every claim links to a run, never because of adjectives. Emotional goal: "I can let this run."

## Anti-references

- Generic dev-tool landing: gradient headline, icon-card feature grid, hero metric with a big number (the page this replaces).
- Neon "hacker terminal" costume: green-on-black, matrix rain, scanlines.
- SaaS cream editorial (serif italic headline, ruled columns, no imagery).
- Any number that was not measured and sourced in the README or a CI run.

## Design Principles

1. Show the run, not the promise: real transcripts, real commands, measured tables with their method.
2. The automation ladder is the story; every section answers "how far does it go without me, and what stops it".
3. Rails are first-class: the gates get as much space as the features.
4. Copy-paste first: every command on the page works as written on the current release.
5. Honest limits next to the claim (slower than omp on short tasks, subscription loops need you around).

## Accessibility & Inclusion

WCAG 2.2 AA: body text ≥ 4.5:1, large text ≥ 3:1, visible focus, skip link, semantic headings. Every animation has a `prefers-reduced-motion` path that shows the final state. Content is visible without JavaScript. English page with a link to the Vietnamese guide (`docs/huong-dan.md`).

<!-- Written 2026-10-17 by Claude Code under the owner's standing "proceed without asking" approval; inferred from README.md and docs/huong-dan.md. Updated 2026-11-05 for the engines + HQ focus and the logo palette. Edit freely. -->
