# Provenance: hq-team-ux.md

Date: 2026-10-14
Rounds: draft → verifier → reviewer → fixes (1 review round)

Sources read: 42 numbered sources (see `## Sources` in hq-team-ux.md). Evidence notes are in `outputs/.evidence/hq-ux-r1.md`, `hq-ux-r2.md` and `hq-ux-r3.md`. The verifier re-fetched [1][2][3][4][30][32][33][36][37] on 2026-10-14 but did not archive them. At finalization, [1], [32] and [33] were re-fetched and excerpts were archived in `outputs/.evidence/hq-ux-verify.md`. Local sources: CHANGELOG.md 0.79.0/0.80.0 [38] and code in `apps/hq-ui` [42].
Sources not readable: [34] m3.material.io snackbar guidelines returned the page title only, with no body text. The WCAG 2.0 Understanding URL returned 403 and was replaced by the WCAG 2.2 page [36]. Partial reads: the last ~25k characters of the Claude Desktop docs [2] and the last ~37k characters of agent view [1] in the finalization re-fetch were not read.
Measured: nothing (no benchmarks or user tests). The code in `apps/hq-ui` was read at file:line, and changelog-only rows are labelled "changelog" in the gap table.
Remaining [UNVERIFIED]: Material "do not use snackbars for critical information" [34]; Smallville map plus agent list [28] (secondary summary); WCAG 2.3.3 level (caveat only); product adoption numbers (none gathered); whether WCAG 2.2.2 applies to the reconnecting pulse dot (plausible, not verified); refresh rate <1 s and dialog keys (changelog only, not measured); keyboard access of the terminal drawer (not tested).
Verification: PASS (verifier 59 claims: 40 ok, 16 fixed, 3 unverified; reviewer: 0 FATAL, 6 MAJOR fixed, 4 MINOR fixed; 3 sources re-fetched and archived, others marked "per verifier, not archived")
