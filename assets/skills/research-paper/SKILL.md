---
name: research-paper
description: Work a paper, claim, or benchmark end to end — replicate a result, extract an implementable ML training recipe, audit a paper against its released code, draft a paper-style write-up, or run a bounded try/measure/keep-or-revert experiment loop. Use when the user wants to reproduce, verify, optimize against, or formally write up research rather than get a casual summary.
---

# Research Paper

Ported from `companion-inc/feynman`'s `/replicate`, `/recipe`, `/audit`, `/draft`, and `/autoresearch` slash-commands. Self-contained omp-native version — no `feynman` CLI required.

## Pick a mode

| The user wants… | Mode |
| --- | --- |
| Reproduce a paper's result / verify a benchmark claim | [Replicate](#replicate) |
| A concrete, source-backed training/fine-tuning recipe | [Recipe](#recipe) |
| To know whether the paper matches its released code | [Audit](#audit) |
| A formal paper/technical-report write-up | [Draft](#draft) |
| An automated optimization loop against a benchmark command | [Autoresearch](#autoresearch) |

Modes compose: a replication usually starts with a recipe pass; an audit often precedes a replication; a draft consumes any of the above.

## Shared conventions

- **Slug** — derive from the topic/target: lowercase, hyphens, ≤5 words.
- **Plan first, then continue** — write the plan to `outputs/.plans/<slug>.md`, summarize briefly, and continue immediately. Don't stop for confirmation unless asked (the one exception is the environment gate below).
- **Environment gate** — never install packages, run training, or execute experiments before the user picks an environment: **Local** (cwd) · **New git branch** (keeps main clean) · **Virtual environment** (venv/conda) · **Docker** · **Modal** · **RunPod** (last three: see the `remote-compute` skill) · **Plan only** (produce the plan, execute nothing).
- **Verification vocabulary** — use `verified`, `unverified`, `inferred`, `blocked` precisely. Never claim a method is state-of-the-art, replicated, or production-ready unless the checks actually prove it. Never call something "replicated" unless the planned checks passed.
- **Provenance** — every result, figure, table, benchmark, or quantitative comparison needs a traceable source. End every artifact with a `Sources` section carrying direct URLs (paper, dataset, docs, repo).
- **Log** — if `CHANGELOG.md` exists, read its recent entries before starting, and append a concise entry after meaningful progress, failed attempts, major verification outcomes, and before stopping: active objective, what changed, what was checked, next step.

### Tool mapping

Papers/docs/HF hub pages → `web_search` + `read <url>` (Hugging Face dataset/repo pages are plain URLs — read them directly; there is no dedicated HF tool in omp). Codebases → `read`/`grep` on the clone (`git clone` first if not local), or `trail ask`/`trail skeleton` after `trail build`. Broad sweeps → `task` (role "Researcher"). Citations/source checks → `task` (role "Verifier"). Long write-ups from gathered notes → `task` (role "Writer"). Narrow scopes: do it yourself.

---

## Replicate

1. **Extract** — `task` (role "Researcher") to pull implementation details from the target paper and any linked code.
2. **Recipe pass** — for ML training/fine-tuning/benchmark/dataset-heavy targets, run the [Recipe](#recipe) mode first: link each claimed result to the exact dataset, method, hyperparameters, compute assumptions, metric, and code path. Mark unchecked details `unverified`.
3. **Plan** — what code, datasets, metrics, environment are needed. Be explicit about verified vs. inferred vs. missing, and which checks/test oracles decide success.
4. **Environment** — `ask` the user (see the environment gate above).
5. **Execute** — implement and run in the chosen environment. Save notes/scripts/raw outputs/results to disk in a reproducible layout.
6. **Report** — results vs. claim, what matched, what didn't, what stayed `unverified`, plus `Sources`.

## Recipe

Required artifacts: `outputs/.plans/<slug>-recipe.md`, `outputs/.drafts/<slug>-recipe-research.md`, `outputs/<slug>-recipe.md`, `outputs/<slug>-recipe.provenance.md`.

1. **Plan** — target task, benchmark/desired behavior, candidate source types, feasibility constraints, task ledger. Continue automatically.
2. **Research** — `task` (role "Researcher") for a broad sweep; direct `web_search` for narrow tasks. Start from evidence of actual results, not example scripts.
3. **Recipe extraction** — for each promising approach link the result to the exact recipe: paper/report, benchmark/result, dataset, training method, key hyperparameters, compute assumptions, implementation code path, current docs.
4. **Dataset validation** — availability, splits/columns, format match via `read` on the dataset's hub/docs page. Anything not directly checked is `unverified`.
5. **Implementation grounding** — find working code or official docs; prefer current, actively-maintained repos. Record exact file paths, function/class names, command patterns.
6. **Synthesis** — write the research draft first, then promote a concise ranked brief to `outputs/<slug>-recipe.md`.
7. **Verification** — verify key source URLs and dataset/code availability for the top-ranked recipe before delivery.
8. **Provenance** — `outputs/<slug>-recipe.provenance.md`: date, sources consulted, accepted/rejected, verification status, artifact paths.

Required final shape: **Recommendation** (the one recipe to try first, and why) · **Ranked recipe table** (one row per candidate: paper/source, result, dataset, method, hyperparameters, compute, code/docs, verification status) · **Dataset notes** (schema, split, size, license/access when checked) · **Implementation plan** (minimal steps to run the top recipe) · **Known gaps** (missing code, inaccessible data, unclear hyperparameters, benchmark mismatch) · **Sources**.

## Audit

1. **Plan** — which paper, which repo, which claims to check.
2. **Gather** — `task` (role "Researcher") to pull claims from the paper and matching implementation details from the code; `task` (role "Verifier") for sources and inline citations. Small audits: do both yourself.
3. **Compare** — check claimed methods, defaults, metrics, and data handling against the actual code (`read`/`grep` the relevant files — don't guess from the README alone).
4. **Report** — missing code, mismatches, ambiguous defaults, reproduction risks. Save exactly one artifact: `outputs/<slug>-audit.md`, ending with `Sources` (paper + repo URLs).

## Draft

1. **Outline** — proposed title, sections, key claims, source material, and a verification log for critical claims/figures/calculations.
2. **Draft** — `task` (role "Writer") from already-collected notes, or write directly. Include at minimum: title, abstract, problem statement, related work, method/synthesis, evidence/experiments, limitations, conclusion. Clean Markdown; LaTeX only where equations materially help.
3. **Provenance discipline** — missing evidence gets a placeholder or a proposed experimental plan, never a claimed outcome. Generate a chart only when source-backed data supports it; otherwise a table or a chart spec. Mermaid only for source-supported architectures/pipelines.
4. **Sweep** — before delivery, sweep for claims stronger than their support. Mark tentative results tentative; remove unsupported numerics rather than letting review catch them.
5. **Cite** — `task` (role "Verifier") to add inline citations and verify sources.
6. **Deliver** — save exactly one draft to `papers/<slug>.md`, ending with a `Sources` appendix.

## Autoresearch

A bounded foreground loop: try a hypothesis, measure, keep what works, revert what doesn't, repeat — driven by omp's own tools (`bash`/`eval` for the benchmark, `edit`/`write` for the change and the log).

1. **Gather** — if `autoresearch.md` and `autoresearch.jsonl` already exist, `ask` whether to resume or start fresh. Otherwise collect first: what to optimize (accuracy, retrieval quality, loss, latency, …), the benchmark command, the metric name/unit/direction, the files in scope, max iterations (default 20).
2. **Environment** — `ask` (see the environment gate above). Do not proceed without a clear answer. For an iterative Docker loop use a named persistent container (see `remote-compute`).
3. **Confirm** — present the full plan (target metric + direction, benchmark command, files in scope, environment, max iterations) and `ask` for explicit approval before starting.
4. **Run** — initialize `autoresearch.md` (human-readable log), `autoresearch.jsonl` (one JSON record per iteration: `{iteration, change, metric_value, baseline_value, decision, evidence}`), and `autoresearch.sh` (re-runnable benchmark invocation). Record the baseline as iteration 0. Each iteration: `edit` the change → run the benchmark → append result + evidence + decision → compare against baseline and keep, revert, or record the failed hypothesis → next.

Informal subcommands: "resume autoresearch" (read the log files, continue) · "stop autoresearch" (stop, keep the data) · "clear autoresearch" (delete `autoresearch.md`/`.jsonl`/`.sh` and start fresh — destructive, confirm first).
