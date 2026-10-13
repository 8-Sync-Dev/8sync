---
name: 8sync-code-intel-first
description: Use when a search is really a code-structure question (where is a symbol defined, who calls it, what breaks if it changes) — route it to codegraph (CLI) first instead of grep or glob.
condition: '(?i)\b(?:class|struct|enum|trait|impl|interface|fn|func|function|def|method|module|namespace|type)\s+[A-Za-z_]\w*'
scope: "tool:grep(*), tool:glob(*)"
interruptMode: tool-only
---

That search is a **code-structure** query, not a text query. Structure goes through the code-intel stack first — it answers in one call what grep needs five to approximate:

| Question | Exact call |
|---|---|
| where is `X` defined / who calls `X` / impact | `bash: codegraph query "X"` · `codegraph callers "X"` · `codegraph impact "X"` — or `codegraph explore "X"` for source + call paths in one shot (`codegraph index .` once if `.codegraph/` is missing) |
@serena | where is `X` defined / callers (serena enabled) | `mcp__serena_find_symbol { name_path: "X" }` · `mcp__serena_find_referencing_symbols { name_path: "X", relative_path: "<file>" }` |
@cbm | shape, call paths, blast radius (cbm enabled) | `mcp__codebase_memory_mcp_search_graph { query: "X" }` · `_trace_path` · `_get_architecture` · `_get_code_snippet` |

Re-run the original `grep`/`glob` only after one of those returns nothing, and name the call you made.

<!-- 8sync:requires codegraph,codebase-memory-mcp,serena -->
<!-- UC-7 (enforcement must never dead-end a machine without the replacement) is met on
     two independent layers, neither of which is prose:
     1. Availability gate at DEPLOY time. `8sync harness` (deploy::ensure_rules) reads the
        `8sync:requires` marker above and writes this file only when at least one of those
        tools is actually present — codegraph on PATH, or (only when enabled via `8sync harness cbm|serena on`)
        codebase-memory-mcp / serena registered in ~/.omp/agent/mcp.json with a runnable command. When none is, the
        already-deployed copy is REMOVED, so the veto disappears with the capability
        instead of stranding the session. omp cannot express a capability predicate in a
        `condition:`, so the gate has to live where the capability is observable.
     2. One-shot by construction. This is a nudge, not a veto: omp's `ttsr.repeatMode`
        defaults to `once` (repeatGap 10 turns), so the retried turn may re-issue the
        identical grep and it goes through. The worst case is one restarted turn — which
        is also why the false-positive cost of a slightly wide `condition` is acceptable.
     Complements, never duplicates, the other two layers: bashInterceptor covers the
     `bash rg` / `grep -r` / `find -name` shell escape (patterns live in
     ~/.config/8sync/models.toml), and APPEND_SYSTEM.md carries only the routing intent. -->
