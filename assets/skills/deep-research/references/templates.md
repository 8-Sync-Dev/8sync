# deep-research templates

Copy the block for the stage you are in. Keep headings; fill or write `none`. Never create a later stage's file early.

## Status words (one vocabulary for every file)
| Where | Words |
|---|---|
| Plan task ledger | `todo` · `done` · `blocked (<why>)` · `superseded (<by what>)` |
| Researcher, per assigned question | `done` · `blocked (<why>)` · `needs follow-up (<what>)` |
| Claim status (notes) | `read` · `inferred` · `unresolved` |
| Source type | `primary` · `secondary` · `self-reported` |
| Verifier, per claim (cite audit) | `OK` · `FIXED` · `UNVERIFIED` · `DEAD-LINK` · `REMOVED` |
| Reviewer verdict | `PASS` · `PASS WITH NOTES` · `FAIL (<n> FATAL)` |
| Provenance `Verification` (lead) | `PASS` · `PASS WITH NOTES` · `BLOCKED (<why>)` |

- **PASS** = every stage ran, reviewer verdict PASS, 0 `UNVERIFIED` on `(D)` claims.
- **PASS WITH NOTES** = MAJOR findings moved to Open questions, or `UNVERIFIED` only on hedged, non-numeric context.
- **BLOCKED** = a required stage or check could not run, or a FATAL survived the second review. List what.
- `UNVERIFIED` is allowed only on hedged context; an unsourced factual claim is removed, a number without an artifact becomes `TODO`.

## outputs/.plans/<slug>.md

```markdown
# <topic>
Asked: <user's words, one line> · Date: <YYYY-MM-DD>

## Key questions
1. <question that changes the decision>

## Evidence needed
- Q1: <what would answer it: primary doc, benchmark, source code path, paper>

## Scale decision
<direct | N researchers> — <why, using the scale table>; decision brief: <yes/no>

## Task ledger
| # | Task | Owner | Status | Output |
|---|---|---|---|---|
| T1 | Q1 gather | lead / researcher-1 | todo | outputs/.drafts/<slug>-research-<topic>.md |
| T2 | draft | lead | todo | outputs/.drafts/<slug>-draft.md |
| T3 | cite | lead / verifier | todo | outputs/.drafts/<slug>-cited.md |
| T4 | review | research-reviewer / lead | todo | outputs/.drafts/<slug>-verification.md |
| T5 | deliver | lead | todo | outputs/<slug>.md |

## Verification log
- <date> <what was checked> — <result> — <evidence path or URL>

## Decision log
- <date> <decision> — <why>
```

## outputs/.plans/<slug>-T<n>.md (researcher brief)

```markdown
Question: <one sub-question>
Scope: <in / out>
Known so far: <one line, or none>
Write notes to: outputs/.drafts/<slug>-research-<topic>.md
Budget: ≤<N> tool calls · stop a direction after 2 rounds with nothing new
Return: one line with the path + ≤5 bullets `claim — S# — confidence`
```

## outputs/.drafts/<slug>-research-*.md (researcher or direct notes)

```markdown
# <slug> — <topic>
Queries run (exact text): 1. "<query>" 2. "<query>" 3. "<query>"

## Sources
- S1 <title> — <URL or file:line> — <date/version> — primary / secondary / self-reported

## Evidence
| # | Claim (numbers copied exactly) | Source | Status | Confidence |
|---|---|---|---|---|
| C1 | ... | S1 | read / inferred / unresolved | high / med / low |

## Conflicts
- S2 vs S5: <what differs, which is more credible, why>

## Coverage status
- Q1: done / blocked (<why>) / needs follow-up (<what>)
- Uncertain: <what and why>
```

## outputs/.drafts/<slug>-cite-audit.md (verifier)

```markdown
# Cite audit: <slug>
| Claim | Source | Result | Note |
|---|---|---|---|
| <short claim> (D) | [3] | OK / FIXED / UNVERIFIED / DEAD-LINK / REMOVED | <what changed> |
Totals: OK n · FIXED n · UNVERIFIED n · DEAD-LINK n · REMOVED n
```

## outputs/.drafts/<slug>-verification.md (review; second pass `-verification-2.md`)

```markdown
# Verification: <slug>
Input: outputs/.drafts/<slug>-cited.md · Reviewer: research-reviewer | lead self-review

## Checks performed
- <check, e.g. opened S3 for (D) claim "…": supports / does not support> — <result>

## Findings
- [W1] FATAL — <claim or section> — "<exact quoted text>" — <why it fails> — <fix>
- [W2] MAJOR — ...
- [W3] MINOR — ...

## Questions
- [Q1] <what the brief does not answer>

Verdict: PASS | PASS WITH NOTES | FAIL (<n> FATAL) — <one line>
```

## outputs/<slug>.provenance.md

```markdown
# Provenance: <topic>

- **Date:** <YYYY-MM-DD>
- **Rounds:** <n> (a round = one gather pass over the open questions)
- **Sources consulted:** <count> — <list or path>
- **Sources accepted:** <count> — <list>
- **Sources rejected:** <dead / unverifiable / removed, with reason>
- **Verification:** PASS | PASS WITH NOTES | BLOCKED (<why>)
- **Plan:** outputs/.plans/<slug>.md
- **Research files:** <paths>
- **Measurements:** <command → result, or none>
- **Open UNVERIFIED / TODO:** <claims, or none>
```

<!-- Adapted from Feynman v0.5.58 prompts/deepresearch.md and .feynman/agents/*.md (MIT, Copyright (c) 2026 Companion, Inc.; full notice in ../LICENSE-feynman.md). PASS/BLOCKED definitions, (D) claims and the vocabulary table are 8sync additions. -->
