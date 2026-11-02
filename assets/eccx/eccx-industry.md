---
name: eccx-industry
description: "Run a full Industry plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-industry — Industry

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: supply chain, logistics, energy, healthcare, documents.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `<ECC>` = 8sync's ECC checkout `~/.cache/8sync/ecc/` (tracks upstream: `8sync harness` + a 6-hourly background refresh), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` loads any skill: `skill://` refs are 8sync's, plain names ECC's (8sync mirrors ECC into omp). Not found → read `<ECC>/skills/<name>/SKILL.md`.
- Agents: a `task` subagent whose assignment opens with "read the role file `<ECC>/agents/<agent>.md` first"; independent agents/steps → ONE `task` call with several `tasks[]` (parallel).
- Commands: run `/ecc-<cmd>` with that step's arguments; not found → read `<ECC>/commands/<cmd>.md` and follow it.
- A member that does not resolve: skip it, say so.
- A skill in your session's skill list that fits the goal but is missing below (ECC updated since this list) is eligible too.

## Skills
- `carrier-relationship-management` — Carrier portfolios, freight rate negotiation, and performance tracking
- `customs-trade-compliance` — Customs documentation, tariff classification, and regulatory compliance
- `energy-procurement` — Energy procurement patterns and utility management
- `esign-field-placement` — Deterministic method for placing signature, date, and text fields in a web
- `healthcare-cdss-patterns` — Clinical Decision Support System (CDSS) development patterns
- `healthcare-emr-patterns` — EMR/EHR development patterns for healthcare applications
- `healthcare-eval-harness` — Patient safety evaluation harness for healthcare application deployments
- `healthcare-phi-compliance` — Protected Health Information (PHI) and PII compliance patterns for healthcare applications: data
- `hipaa-compliance` — HIPAA-specific entrypoint for healthcare privacy and security work
- `inventory-demand-planning` — Inventory optimization, demand forecasting, and replenishment
- `logistics-exception-management` — Exception handling for logistics and freight management
- `master-agreement-generator` — Generate review drafts of counterparty master agreements from one template plus
- `production-scheduling` — Manufacturing scheduling, capacity planning, and optimization
- `quality-nonconformance` — Quality control, nonconformance tracking, and CAPA processes
- `returns-reverse-logistics` — Returns processing, reverse logistics, and refurbishment workflows
- `visa-doc-translate` — Visa document translation and immigration paperwork processing

## Agents
- `healthcare-reviewer` — Reviews healthcare application code for clinical safety, CDSS accuracy, PHI
