---
description: "Run a full Industry plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-industry — Industry

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: supply chain, logistics, energy, healthcare, documents.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:carrier-relationship-management` — Carrier portfolios, freight rate negotiation, and performance tracking
- `ecc:customs-trade-compliance` — Customs documentation, tariff classification, and regulatory compliance
- `ecc:energy-procurement` — Energy procurement patterns and utility management
- `ecc:esign-field-placement` — Deterministic method for placing signature, date, and text fields in a web
- `ecc:healthcare-cdss-patterns` — Clinical Decision Support System (CDSS) development patterns
- `ecc:healthcare-emr-patterns` — EMR/EHR development patterns for healthcare applications
- `ecc:healthcare-eval-harness` — Patient safety evaluation harness for healthcare application deployments
- `ecc:healthcare-phi-compliance` — Protected Health Information (PHI) and PII compliance patterns for healthcare applications: data
- `ecc:hipaa-compliance` — HIPAA-specific entrypoint for healthcare privacy and security work
- `ecc:inventory-demand-planning` — Inventory optimization, demand forecasting, and replenishment
- `ecc:logistics-exception-management` — Exception handling for logistics and freight management
- `ecc:master-agreement-generator` — Generate review drafts of counterparty master agreements from one template plus
- `ecc:production-scheduling` — Manufacturing scheduling, capacity planning, and optimization
- `ecc:quality-nonconformance` — Quality control, nonconformance tracking, and CAPA processes
- `ecc:returns-reverse-logistics` — Returns processing, reverse logistics, and refurbishment workflows
- `ecc:visa-doc-translate` — Visa document translation and immigration paperwork processing

## Agents
- `ecc:healthcare-reviewer` — Reviews healthcare application code for clinical safety, CDSS accuracy, PHI
