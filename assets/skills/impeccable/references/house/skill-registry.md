# Supporting Skill Registry

Use this registry to map task intent to local skills under `skills/`.
Load the minimum set needed for the current task.

## Routing Map

| Intent | Primary Skills | Secondary Skills | Subagent Candidates |
| --- | --- | --- | --- |
| Codebase exploration | `explore-codebase` | `improve-codebase-architecture`, `refactor-safely`, `frontend-patterns` | `code-explorer`, `code-architect` |
| Fix workflow | `frontend-patterns`, `ecc:code-review` | `javascript-cheatsheet`, `typescript-advanced-types`, `explore-codebase`, `lint` | `typescript-reviewer`, `code-reviewer` |
| Debug workflow | `debug-like-expert` | `browser-testing-with-devtools`, `agent-browser`, `javascript-cheatsheet` | `silent-failure-hunter`, `code-explorer`, `typescript-reviewer` |
| Browser automation | `agent-browser` | `browser-testing-with-devtools`, `javascript-cheatsheet` | `code-reviewer` |
| Refactor workflow | `code-simplification`, `refactor-safely` | `clean-code-javascript`, `javascript-refactoring`, `composition-patterns`, `ecc:code-review` | `code-simplifier`, `refactor-cleaner` |
| Performance workflow | `performance-optimization`, `core-web-vitals` | `react-best-practices`, `code-optimizer`, `browser-testing-with-devtools`, `tanstack-virtual` | `performance-optimizer` |
| Security workflow | `ecc:code-review`, `best-practices` | `frontend-patterns`, `web-quality-audit`, `accessibility` | `security-reviewer`, `security-auditor` |
| Responsive workflow | `responsive-design`, `responsive-web-design` | `frontend-ui-engineering`, `web-component-design`, `accessibility` | `code-reviewer` |
| Design / redesign workflow | `frontend-ui-engineering`, `frontend-design` | `web-component-design`, `tailwind-design-system`, `shadcn`, `ui-ux-pro-max` | `code-architect`, `code-reviewer` |
| Accessibility workflow | `accessibility` | `browser-testing-with-devtools`, `web-quality-audit`, `frontend-ui-engineering` | `code-reviewer` |
| State and data workflow | `react-state-management`, `tanstack-query` | `frontend-patterns`, `typescript-advanced-types`, `ts-pattern` | `type-design-analyzer`, `typescript-reviewer` |
| Table/list scalability | `tanstack-table`, `tanstack-virtual` | `tanstack-query`, `performance-optimization` | `performance-optimizer`, `typescript-reviewer` |
| React/Next implementation | `react`, `react-best-practices` | `react-view-transitions`, `shadcn`, `frontend-patterns` | `typescript-reviewer`, `type-design-analyzer` |
| Vue implementation | `vue` | `responsive-design`, `accessibility`, `frontend-patterns` | `code-reviewer` |
| Quality gate and release checks | `ecc:code-review`, `lint` | `web-quality-audit`, `best-practices`, `seo` | `code-reviewer`, `security-reviewer`, `silent-failure-hunter`, `seo-specialist` |
| Prompt optimization only | `prompt-optimizer` | none | none |
| Documentation workflow | `write-docs` | `workspace-surface-audit` | `code-architect` |

## Resolution Order

Resolve skill files in this order:

1. `skills/<skill>/SKILL.md` (this workspace)
2. Additional skill-local references only when needed (`skills/<skill>/references/*`)

Resolve subagent files in this order:

1. `agents/subagents/<subagent>.md`

Do not load unrelated skill files.
Always verify decisions against real workspace code before editing.
