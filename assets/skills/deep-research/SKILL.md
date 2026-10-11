---
name: deep-research
description: Source-heavy investigation of a topic or codebase that ends in a cited brief. Use when the user asks for deep research, a comparison, a multi-source investigation, an in-depth technical report, or "R&D to pick the best option". Token-lean - snippets before pages, compressed subagent returns, one artifact.
---

# Deep research (token-lean)

Answer quality comes from primary sources and verification, not from volume. Every token spent should either find a source, check a claim, or go into the brief.

## Tools (omp · Claude Code)
| Need | omp | Claude Code |
|---|---|---|
| Search | `web_search` | `WebSearch` |
| Read a page | `read <url>` (ranges `:N-M`) | `WebFetch` with a narrow prompt ("extract X, Y with quotes") |
| Code structure | `codebase-memory-mcp` / `serena` / `codegraph` | same MCP servers / `codegraph` via Bash |
| Parallel workers | `task` with a `tasks[]` batch | `Agent` (e.g. `explore`), several in one message |
| Plan / ledger | `todo` | task list (`TaskCreate`) |

## Scale: pick the smallest that answers
1. **Lookup** (≤5 calls): answer inline with links. No files.
2. **Brief** (one topic, 2-4 sub-questions): work inline, write `outputs/<slug>.md`.
3. **Survey** (independent sub-topics): one batch of 2-4 workers, each owning one sub-question. Never more workers than sub-questions.

## Workflow
1. **Questions.** Write 2-6 key questions and what evidence would settle each into the task list. That is the plan; a plan file only when the work spans sessions (`outputs/.plans/<slug>.md`).
2. **Gather cheaply.**
   - Search first, read snippets, fetch only sources that look primary (official docs, specs, source code, papers, changelogs).
   - Fetch with extraction: ask for the facts and verbatim quotes you need, or read line ranges — never paste whole pages into context.
   - Issue independent searches and fetches in the same turn.
   - Codebase questions: graph tools before grep; read files only where you will cite a line.
   - Stop a thread after two rounds that add nothing new.
3. **Workers return compressed findings only:** ≤10 bullets, each `claim — source URL or file:line — confidence`. Give them the questions, the source bar and this return format in the prompt.
4. **Measure when you can.** If a claim can be tested locally (benchmark, script, API probe), run it — a measured number beats any source. Record command + result.
5. **Verify.** Every claim in the brief carries a link or `file:line`. Re-open the source for the claims the conclusion depends on and for anything contested. Unverified → mark `[INFERENCE]` or drop it. Classify problems FATAL / MAJOR / MINOR and fix FATAL before writing.
6. **Write once:** `outputs/<slug>.md` (slug = 2-5 hyphenated words):
   - Answer / recommendation first, then evidence by question, then caveats and open questions.
   - Comparisons as a table.
   - `## Sources` (numbered, each used at least once).
   - Footer: date, rounds, sources read, what was measured, what stayed unverified.

## Rules
- Primary over secondary; newest version of docs; note the date or version you read.
- Quote numbers exactly and say where they came from; never round a source into a different claim.
- Disagreeing sources: report both and say which you trust and why.
- Size or performance questions about native binaries: `references/binary-weight-audit.md`.
