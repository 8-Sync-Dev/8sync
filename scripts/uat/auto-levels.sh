#!/usr/bin/env bash
# UAT of kit levels 3 (/ship-auto) and 5 (/autopilot) on a throwaway repo, official `claude` CLI, headless.
# usage: bash scripts/uat/auto-levels.sh ship-auto|autopilot
# Never sets keys, never bypasses permissions; toy repo has no remote. Uses the existing subscription login.
set -uo pipefail
MODE="${1:-}"
case "$MODE" in
  ship-auto) PROMPT='/ship-auto sửa bug để npm test pass'; TURNS=60; BUDGET=3 ;;
  autopilot) PROMPT='/autopilot --max-items 2'; TURNS=100; BUDGET=5 ;;
  *) echo "usage: $0 ship-auto|autopilot" >&2; exit 2 ;;
esac
command -v claude >/dev/null && command -v node >/dev/null && command -v jq >/dev/null || { echo "need claude, node, jq" >&2; exit 2; }

D="$(mktemp -d -t uat-auto-XXXXXX)"; R="$D/toy"; mkdir -p "$R"; cd "$R" || exit 2
SET="$HOME/.claude/settings.json"
mt() { stat -c %Y "$SET" 2>/dev/null || echo none; }
M0="$(mt)"

mkdir -p src test su-code
cat > package.json <<'J'
{ "name": "toy", "version": "0.0.0", "private": true,
  "scripts": { "test": "node --test test/", "lint": "node scripts-lint.js" } }
J
cat > scripts-lint.js <<'J'
// tiny lint: no "var", no console.log in src/
const fs = require('fs'); let bad = 0;
for (const f of fs.readdirSync('src')) {
  const t = fs.readFileSync('src/' + f, 'utf8');
  if (/\bvar\s/.test(t) || /console\.log/.test(t)) { console.error('lint:', f); bad++; }
}
process.exit(bad ? 1 : 0);
J
cat > src/sum.js <<'J'
exports.sum = (a, b) => a - b;
J
cat > src/slug.js <<'J'
exports.slug = (s) => s.toLowerCase().replace(/\s+/g, '_');
J
cat > src/max.js <<'J'
exports.max = (xs) => { let m = 0; for (const x of xs) if (x > m) m = x; return m; };
J
cat > test/sum.test.js <<'J'
const t = require('node:test'), a = require('node:assert');
const { sum } = require('../src/sum');
t.test('sum adds', () => a.strictEqual(sum(2, 3), 5));
J
cat > test/slug.test.js <<'J'
const t = require('node:test'), a = require('node:assert');
const { slug } = require('../src/slug');
t.test('slug uses dashes', () => a.strictEqual(slug('Hello Big World'), 'hello-big-world'));
J
cat > test/max.test.js <<'J'
const t = require('node:test'), a = require('node:assert');
const { max } = require('../src/max');
t.test('max handles negatives', () => a.strictEqual(max([-5, -2, -9]), -2));
J
cat > CLAUDE.md <<'J'
# toy repo
Test: `npm test`. Lint: `npm run lint`. No CI, no remote (local-only sandbox). Conventional commits. Update CHANGELOG.md (Unreleased).
J
printf '# Changelog\n\n## Unreleased\n' > CHANGELOG.md
cat > su-code/STATE.md <<'J'
# STATE
## Goal
Fix the toy library.
## Next
- Fix `sum` in src/sum.js. Acceptance: `node --test test/sum.test.js` exit 0 and `npm run lint` exit 0.
- Fix `slug` in src/slug.js (dashes, not underscores). Acceptance: `node --test test/slug.test.js` exit 0 and `npm run lint` exit 0.
J
git init -q -b main . && git add -A && git -c user.name=uat -c user.email=uat@example.invalid commit -qm "chore: initial toy repo"
git config user.name uat; git config user.email uat@example.invalid
C0="$(git rev-parse HEAD)"; N0="$(git rev-list --count HEAD)"
echo "== toy repo: $R  (before: npm test exit $(npm test >/dev/null 2>&1; echo $?))"
echo "== run: $PROMPT"
OUT="$D/result.json"; ERR="$D/stderr.log"
nice -n 10 claude -p "$PROMPT" --permission-mode auto --max-turns "$TURNS" --max-budget-usd "$BUDGET" \
  --model claude-sonnet-5-5 --output-format json > "$OUT" 2> "$ERR"
RC=$?
echo "== claude rc=$RC out=$OUT err=$ERR"

fails=0
chk() { if [ "$1" = 0 ]; then echo "PASS $2"; else echo "FAIL $2"; fails=$((fails+1)); fi; }
RES="$(jq -r '.result // empty' "$OUT" 2>/dev/null)"

if [ "$MODE" = autopilot ]; then
  # items: sum + slug each have a criterion; test/max.test.js is not in the backlog so total pass is not required
  # Autopilot keeps each item on its own branch until the Ship question, so each test must pass on SOME branch.
  ok_items=0
  for t in test/sum.test.js test/slug.test.js; do
    for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
      # A branch may be checked out in an autopilot worktree: test it in a detached throwaway worktree.
      wt="$D/check-$ok_items-$RANDOM"
      git worktree add -q --detach "$wt" "$b" 2>/dev/null || continue
      if (cd "$wt" && node --test "$t" >/dev/null 2>&1); then pass=1; else pass=0; fi
      git worktree remove -q --force "$wt" 2>/dev/null
      if [ "$pass" = 1 ]; then ok_items=$((ok_items+1)); break; fi
    done
  done
  [ "$ok_items" = 2 ]; chk $? "backlog items pass on their branches (sum, slug: $ok_items/2)"
else
  npm test >/dev/null 2>&1; chk $? "npm test exit 0 after"
fi
NEW=$(( $(git rev-list --count --all) - N0 ))
CONV=$(git log --all --format=%s "^$C0" 2>/dev/null | grep -cE '^(feat|fix|chore|docs|test|refactor|perf|build|ci|style)(\(.+\))?!?: ' || true)
git log --all --format=%s | head -8 | sed 's/^/   commit: /'
[ "$NEW" -ge 1 ] && [ "${CONV:-0}" -ge 1 ]; chk $? "new commit(s) with conventional message (new=$NEW conv=${CONV:-0})"
[ -z "$(git remote)" ]; chk $? "git remote still empty"
echo "$RES" | grep -qiE 'ship|remote|CI'; chk $? "result text mentions Ship / remote / CI"
# The skills write `Ship: n/a (no remote)` into STATE (ship-auto: su-code/ship/<slug>/STATE.md, autopilot: the brief).
{ echo "$RES"; cat su-code/STATE.md su-code/ship/*/STATE.md 2>/dev/null || true; } | grep -qiE 'Ship\**:?\** *n/a'
chk $? "records 'Ship: n/a (no remote)' (result or STATE) instead of improvising"
# The skill `sec` must really run (Skill tool call in the session transcript), not a hand-rolled grep.
SID="$(jq -r '.session_id // empty' "$OUT")"
TR="$(find "$HOME/.claude/projects" -name "$SID.jsonl" 2>/dev/null | head -1)"
[ -n "$SID" ] && [ -n "$TR" ] && grep -q '"name":"Skill"' "$TR" && grep -qE '"skill":"(sec|[a-z0-9-]+:sec)"' "$TR"; chk $? "skill sec invoked (transcript ${TR:-missing})"
# Ship state on disk: ship-auto keeps su-code/ship/<slug>/STATE.md, autopilot runs each item with a LOOP.md.
WANT=STATE.md; [ "$MODE" = autopilot ] && WANT=LOOP.md
{ find . -path ./node_modules -prune -o -path "./su-code/ship/*/$WANT" -print | grep -q . ; } || git log --all --name-only --format= | grep -qE "su-code/ship/[^/]+/$WANT"
chk $? "su-code/ship/<slug>/$WANT exists (worktree or any branch)"
M1="$(mt)"; [ "$M0" = "$M1" ]; chk $? "~/.claude/settings.json mtime unchanged ($M0 -> $M1)"
jq -e '.total_cost_usd != null' "$OUT" >/dev/null 2>&1; chk $? "total_cost_usd present"
echo "== numbers: turns=$(jq -r .num_turns "$OUT") cost_usd=$(jq -r .total_cost_usd "$OUT") duration_ms=$(jq -r .duration_ms "$OUT") is_error=$(jq -r .is_error "$OUT") stop=$(jq -r '.subtype // .stop_reason // ""' "$OUT")"
echo "== result tail:"; echo "$RES" | tail -25 | cut -c1-300
[ "$fails" = 0 ] && echo "ALL PASS" || echo "$fails FAILED"
echo "== artifacts kept in $D"
[ "$fails" = 0 ]
