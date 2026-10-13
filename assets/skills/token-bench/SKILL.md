---
name: token-bench
description: Prove how much the code-intelligence stack (codegraph; codebase-memory-mcp if enabled) actually saves on a real codebase — measured token reduction vs naive grep+read, with a correctness check. Use when the user asks "how much token does codegraph save", "benchmark the token optimization", "prove >X% reduction on this repo", or wants evidence the STEP-0 stack is worth it. Runs a real codebase, not a synthetic claim.
---

# token-bench — measure code-intel token savings (real codebase, with correctness)

Quantifies the STEP-0 claim ("query the graph, don't grep+read whole files") on an
actual repo. For each real symbol it compares the two ways an agent answers
*"where is X defined / what is it"*:

- **OPTIMIZED** = `codegraph query X` output + reading one ~40-line slice at the hit.
- **NAIVE** = `rg -n X` (all matches) + reading the **whole** definition file.

Tokens = bytes/4 (same proxy both sides). **Correctness** = codegraph returns a
*definition-kind* node (function/class/constant/…) for the exact symbol, and that
location really contains it — so a saving that returns the *wrong* answer never counts.

## Run

```bash
# repo must be indexed first:  cd <repo> && codegraph index .
uv run scripts/token_bench.py <repo>                 # auto-picks 8 real exported symbols
uv run scripts/token_bench.py <repo> --terms a,b,c   # specific symbols
uv run scripts/token_bench.py <repo> --k 12 --json    # more symbols, JSON out
```
(`python3 scripts/token_bench.py …` works too — stdlib only, no deps.)

## Reading the result

```
Button     opt~505tok  naive~32461tok  (311f)  -98.4%  OK
ROUTES     opt~1092tok naive~5942tok   (6f)    -81.6%  OK
── TOTAL  opt~Ntok  naive~Mtok  →  -P% tokens · correct-def K/N
```

- **Reduction scales with footprint:** widely-referenced symbols in large files →
  95–98%; a symbol in one small file → 50–80% (but that lookup is already cheap).
  The big wins are on the queries that would otherwise read many/large files.
- **`OK`** = codegraph surfaced the real definition (verified). `check` = the symbol
  was returned but not as a classic def-kind (e.g. a default export / arrow const) —
  inspect manually; it is usually still correct, just not auto-classified.
- Empty result → the repo isn't indexed (or index is stale): `codegraph index .`.

## Honest framing

This is a **per-symbol micro-benchmark** (a conservative lower bound: naive reads ONE
def file). Real agent tasks touch several files, where naive cost compounds and the
reduction approaches the headline numbers. Report the measured range, never a flat
"always >95%". Correctness is the gate — a token saving that loses the answer is a bug.
