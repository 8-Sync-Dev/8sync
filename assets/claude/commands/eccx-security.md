---
description: "Run a full Security plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-security — Security

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: security review, scanning, hardening, compliance, crypto.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** as ONE Workflow (this command opts in; load `workflow-authoring` first): `phase()` per plan stage, `pipeline()` by default, each agent prompt names only its picked member files, `effort: 'low'` on mechanical stages, every code stage ends with the project's real build/type-check/lint/tests (`ecc:verification-loop`). Stopped mid-run → re-run with `resumeFromRunId`. A goal of ≤2 small steps → do it inline, no Workflow.
5. **Learn.** Last stage: one agent records only evidence-backed lessons (cause, fix, what was ruled out) via `/remember` or `trail note`; none → skip.
6. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:agent-security-hardening` — Security hardening guidance for AI agent frameworks that process untrusted content, invoke
- `aup-audit` — Kiểm tra repo theo Usage Policy của Anthropic (anthropic.com/legal/aup) và quy tắc
- `ecc:defi-amm-security` — Security checklist for Solidity AMM contracts, liquidity pools, and swap flows
- `ecc:django-security` — Django security best practices, CSRF, SQL injection, and secure deployment
- `ecc:evm-token-decimals` — Prevent silent decimal mismatch bugs across EVM chains
- `ecc:gateguard` — PreToolUse fact-forcing gate that denies the first Edit/Write/Bash (including MultiEdit and NotebookEdit)
- `harden` — Audit tư thế bảo mật Claude Code của máy này rồi đề
- `ecc:healthcare-phi-compliance` — Protected Health Information (PHI) and PII compliance patterns for healthcare applications: data
- `ecc:hipaa-compliance` — HIPAA-specific entrypoint for healthcare privacy and security work
- `ecc:laravel-security` — Laravel security best practices
- `ecc:llm-trading-agent-security` — Security patterns for autonomous trading agents with wallet or transaction authority
- `ecc:mcp-dependency-review` — Statically review MCP configuration for mutable package references before approval or CI
- `ecc:nodejs-keccak256` — Prevent Ethereum hashing bugs in JavaScript and TypeScript
- `ecc:perl-security` — Perl security patterns, taint checking, and input validation
- `ecc:repo-scan` — Bootstrap pointer that installs the external repo-scan skill from a pinned, reviewable
- `rules` — Luật Anthropic + quy tắc 8 Sync
- `ecc:safety-guard` — Guard against destructive operations with three modes: Careful intercepts dangerous commands
- `sec` — Quét bảo mật diff hoặc repo hiện tại
- `ecc:security-bounty-hunter` — Hunt for exploitable, bounty-worthy security issues in repositories
- `ecc:security-review` — OWASP top 10, secret detection, injection prevention, and security checklists
- `ecc:security-scan` — Automated security scanning for codebases and configurations
- `senior-security` — Security engineering toolkit for threat modeling, vulnerability analysis, secure architecture, and penetration
- `ecc:springboot-security` — Spring Security patterns, OAuth2, JWT, and secure API configurations

## Agents
- `ecc:opensource-sanitizer` — Verify an open-source fork is fully sanitized before release
- `ecc:security-reviewer` — Security vulnerability detection and OWASP top 10 scanning

## Commands
- `/ecc:quality-gate` — Run quality gate checks before merge
- `/ecc:security-scan` — Run AgentShield against agent, hook, MCP, permission, and secret surfaces
