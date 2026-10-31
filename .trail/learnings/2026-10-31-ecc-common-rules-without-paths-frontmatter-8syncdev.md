---
title: "ECC common rules without paths: frontmatter cost ~6.7k prefix tokens per turn"
author: 8syncdev
date: 2026-10-31
branch: feat/token-radar
cost: { minutes: 81, tokens: 990693 }
id: l-a74f0fb7
scope: repo
status: active
src: agent
touches:
  - ".github/workflows/ci.yml"
  - CHANGELOG.md
  - scripts/scope-ecc-rules.py
  - scripts/test_scope_ecc_rules.py
  - scripts/test_token_usage.py
  - scripts/token-usage.py
  - su-code/KNOWLEDGE.md
  - Cargo.lock
  - Cargo.toml
  - README.md
---

## Decided
ECC installs `.claude/rules/ecc/common/*.md` without `paths:`, so Claude Code loads all ten (about 18 KB) into every main turn and into every subagent's first turn. `scripts/scope-ecc-rules.py REPO` adds `paths:` to the 8 generic files. `security.md` and `git-workflow.md` stay always-on because they gate commits.
Measured with an A/B `claude -p "Reply with OK only."` in su-code: fresh-session prefix 50,244 → 43,560 tokens.
## Watch out
- Reinstalling ECC overwrites the files. Re-run the script afterwards.
- Not verified: that a scoped rule still loads when Claude reads a file matching its glob.
- Measure with `scripts/token-usage.py`. Not raising the compaction window keeps the main-turn mean near 152k tokens.
## Tried and ruled out
- rtk, LLMLingua and lazy-mcp: they need unvetted installs or a prompt rewrite, or offer at most about 1.7% benefit.
