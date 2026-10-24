---
name: 8sync-code-intel-first
description: Use when a search is really a code-structure question (where is a symbol defined, who calls it, what breaks if it changes) — route it to trail (CLI) first instead of grep or glob.
condition: '(?i)\b(?:class|struct|enum|trait|impl|interface|fn|func|function|def|method|module|namespace|type)\s+[A-Za-z_]\w*'
scope: "tool:grep(*), tool:glob(*)"
interruptMode: tool-only
---

That search is a **code-structure** query, not a text query. Structure goes through trail first — it answers in one call what grep needs five to approximate:

| Question | Exact call |
|---|---|
| where is `X` defined / what does the code do about `X` | `bash: trail ask "<question>"` (code inlined at file:line) · `trail grep "<pattern>"` |
| shape of a file before editing | `trail skeleton <file>` (signatures only) |
| who calls `X` / what `X` calls / impact | `trail callers <symbol>` · `trail callers <symbol> --direction out` |
| architecture overview | `trail map` |

Re-run the original `grep`/`glob` only after one of those returns nothing, and name the call you made. After learning something durable, `trail note "<fact>"`.

<!-- 8sync:requires trail -->
<!-- UC-7 (enforcement must never dead-end a machine without the replacement) is met on
     two independent layers, neither of which is prose:
     1. Availability gate at DEPLOY time. `8sync harness` (deploy::ensure_rules) reads the
        `8sync:requires` marker above and writes this file only when that tool is actually
        present — `trail` on PATH. When it is not, the already-deployed copy is REMOVED, so
        the veto disappears with the capability instead of stranding the session. omp cannot
        express a capability predicate in a `condition:`, so the gate has to live where the
        capability is observable.
     2. One-shot by construction. This is a nudge, not a veto: omp's `ttsr.repeatMode`
        defaults to `once` (repeatGap 10 turns), so the retried turn may re-issue the
        identical grep and it goes through. The worst case is one restarted turn — which
        is also why the false-positive cost of a slightly wide `condition` is acceptable.
     Complements, never duplicates, the other two layers: bashInterceptor covers the
     `bash rg` / `grep -r` / `find -name` shell escape (patterns live in
     ~/.config/8sync/models.toml), and APPEND_SYSTEM.md carries only the routing intent. -->
