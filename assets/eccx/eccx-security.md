---
name: eccx-security
description: "Run a full Security plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-security — Security

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: security review, scanning, hardening, compliance, crypto.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `<ECC>` = 8sync's pinned ECC checkout `~/.cache/8sync/ecc/` (made by `8sync harness`), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` = 8sync skill; plain name = ECC skill: `skill://<name>` if it resolves, else read `<ECC>/skills/<name>/SKILL.md`.
- Agents: spawn a `task` subagent whose prompt opens with the role file `<ECC>/agents/<agent>.md`.
- Commands: read `<ECC>/commands/<cmd>.md` and follow it with that step's arguments.
- A member that does not resolve: skip it, say so.

## Skills
- `agent-security-hardening` — Security hardening guidance for AI agent frameworks that process untrusted content, invoke
- `skill://aup-audit` — Kiểm tra repo theo Usage Policy của Anthropic (anthropic.com/legal/aup) và quy tắc
- `defi-amm-security` — Security checklist for Solidity AMM contracts, liquidity pools, and swap flows
- `django-security` — Django security best practices, CSRF, SQL injection, and secure deployment
- `evm-token-decimals` — Prevent silent decimal mismatch bugs across EVM chains
- `gateguard` — PreToolUse fact-forcing gate that denies the first Edit/Write/Bash (including MultiEdit and NotebookEdit)
- `healthcare-phi-compliance` — Protected Health Information (PHI) and PII compliance patterns for healthcare applications: data
- `hipaa-compliance` — HIPAA-specific entrypoint for healthcare privacy and security work
- `laravel-security` — Laravel security best practices
- `llm-trading-agent-security` — Security patterns for autonomous trading agents with wallet or transaction authority
- `mcp-dependency-review` — Statically review MCP configuration for mutable package references before approval or CI
- `nodejs-keccak256` — Prevent Ethereum hashing bugs in JavaScript and TypeScript
- `perl-security` — Perl security patterns, taint checking, and input validation
- `repo-scan` — Bootstrap pointer that installs the external repo-scan skill from a pinned, reviewable
- `safety-guard` — Guard against destructive operations with three modes: Careful intercepts dangerous commands
- `security-bounty-hunter` — Hunt for exploitable, bounty-worthy security issues in repositories
- `security-review` — OWASP top 10, secret detection, injection prevention, and security checklists
- `security-scan` — Automated security scanning for codebases and configurations
- `skill://senior-security` — Security engineering toolkit for threat modeling, vulnerability analysis, secure architecture, and penetration
- `springboot-security` — Spring Security patterns, OAuth2, JWT, and secure API configurations

## Agents
- `opensource-sanitizer` — Verify an open-source fork is fully sanitized before release
- `security-reviewer` — Security vulnerability detection and OWASP top 10 scanning

## Commands
- `quality-gate` — Run quality gate checks before merge
- `security-scan` — Run AgentShield against agent, hook, MCP, permission, and secret surfaces
