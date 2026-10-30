# Subagent Registry

Project-local subagents are stored in `agents/subagents/`.
These subagents complement skills and are useful when a task needs focused deep work in one specialty.

## Available Subagents

| Subagent | Path | Primary Use Cases | Usually Paired Skills |
| --- | --- | --- | --- |
| `code-explorer` | `agents/subagents/code-explorer.md` | Deep flow tracing, architecture mapping, dependency discovery | `explore-codebase`, `improve-codebase-architecture` |
| `code-architect` | `agents/subagents/code-architect.md` | Implementation blueprint, layering, build order design | `frontend-patterns`, `improve-codebase-architecture` |
| `code-reviewer` | `agents/subagents/code-reviewer.md` | Final review gate for correctness, maintainability, security | `ecc:code-review`, `lint` |
| `code-simplifier` | `agents/subagents/code-simplifier.md` | Behavior-preserving cleanup and readability improvement | `code-simplification`, `clean-code-javascript` |
| `refactor-cleaner` | `agents/subagents/refactor-cleaner.md` | Dead code detection and safe removal | `refactor-safely`, `code-simplification` |
| `typescript-reviewer` | `agents/subagents/typescript-reviewer.md` | Type-safety review, async correctness, TS/JS idioms | `typescript-advanced-types`, `frontend-patterns` |
| `type-design-analyzer` | `agents/subagents/type-design-analyzer.md` | Type model quality, invariants, and encapsulation analysis | `typescript-advanced-types`, `ts-pattern` |
| `silent-failure-hunter` | `agents/subagents/silent-failure-hunter.md` | Detect swallowed errors, hidden fallbacks, and broken error propagation | `debug-like-expert`, `ecc:code-review` |
| `performance-optimizer` | `agents/subagents/performance-optimizer.md` | Bottleneck analysis, runtime/bundle/perf optimization | `performance-optimization`, `core-web-vitals` |
| `security-reviewer` | `agents/subagents/security-reviewer.md` | OWASP-oriented security review and hardening guidance | `ecc:code-review`, `best-practices` |
| `security-auditor` | `agents/subagents/security-auditor.md` | Threat-centric security audit with severity grading | `web-quality-audit`, `best-practices` |
| `seo-specialist` | `agents/subagents/seo-specialist.md` | Technical SEO audits and remediation planning | `seo`, `core-web-vitals` |

## Delegation Rules

1. Prefer skills first for implementation workflow and codebase fit.
2. Use subagents for specialized deep analysis/review or high-risk domains.
3. For critical or release-bound tasks, combine one implementation skill set with one review-oriented subagent.
4. Keep delegation scoped: assign exactly one dominant subagent unless parallel specialization is clearly needed.
