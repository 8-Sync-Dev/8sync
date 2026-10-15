#!/usr/bin/env bash
# UAT (no model, free): the /sprint skill covers every kit agent and skill, every role of the
# `ccc standup` roster and of the HQ office seats; /ship, /ship-auto, /ship-loop, /autopilot run the
# sprint cadence; the kit installs it. Run from the repo root. Exit 0 = pass.
set -uo pipefail
S=assets/claude/skills/sprint/SKILL.md
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

[ -f "$S" ] || { echo "FAIL missing $S"; exit 1; }
head -5 "$S" | grep -qx 'name: sprint' && head -5 "$S" | grep -q '^description: ' && ok "frontmatter name + description" || bad "frontmatter"

for f in assets/claude/agents/*.md; do
  a=$(basename "$f" .md)
  grep -qF "\`$a\`" "$S" && ok "agent $a has a role" || bad "agent $a missing from roster"
done
for d in assets/claude/skills/*/; do
  k=$(basename "$d"); [ "$k" = sprint ] && continue
  grep -qE "/$k([^a-z-]|$)" "$S" && ok "kit skill /$k covered" || bad "kit skill /$k not covered"
done
# every /skill the sprint skill names must exist in the kit or the bundled skills (/chrome is built in)
for k in $(grep -oE '`/[a-z0-9-]+' "$S" | sed 's/`\///' | sort -u); do
  [ "$k" = chrome ] && continue
  [ -d "assets/claude/skills/$k" ] || [ -d "assets/skills/$k" ] && ok "/$k exists" || bad "/$k named but not shipped"
done

roster=$(grep -oE 'ROSTER: \[&str; 7\] = \[[^]]*\]' crates/cli/src/verbs/ccc/standup.rs | grep -oE '"[a-z]+"' | tr -d '"')
[ "$(echo "$roster" | wc -l)" -eq 7 ] && ok "standup roster has 7 roles" || bad "standup roster: $roster"
for r in $roster; do
  grep -qE "^\| \`$r\` " "$S" && ok "role $r in skill table" || bad "role $r missing from skill table"
  grep -qE "\{ key: \"$r\"" apps/hq-ui/lib/office.ts && ok "role $r is an HQ seat" || bad "role $r not an HQ seat"
done

for k in ship ship-auto ship-loop autopilot; do
  f=assets/claude/skills/$k/SKILL.md
  grep -qF '/sprint' "$f" && grep -qF 'ccc standup' "$f" && ok "/$k runs the sprint cadence" || bad "/$k lacks /sprint + ccc standup"
done
grep -qF '"claude/skills/sprint/SKILL.md"' crates/cli/src/verbs/ccc.rs && ok "kit installs sprint" || bad "sprint not in KIT_FILES"
grep -A1 '^const CORE_SKILLS' crates/cli/src/verbs/ccc.rs | grep -qF '"sprint"' && ok "sprint is a core skill" || bad "sprint not in CORE_SKILLS"
grep -qF 'ccc standup' assets/claude/CLAUDE.md && ok "kit CLAUDE.md mentions standup" || bad "kit CLAUDE.md"

[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $fail
