#!/usr/bin/env bash
# UAT (no model, free): `8sync ccc standup <slug>` scrum board against a sandbox HOME/XDG and a throwaway
# git repo with su-code/. Checks init, idle detection (exit 3), full assignment (exit 0), STANDUP.md log, --json.
# Usage: scripts/uat/sprint-standup.sh [path/to/8sync]   Exit 0 = pass.
set -uo pipefail
B="${1:-target/debug/8sync}"
command -v "$B" >/dev/null || [ -x "$B" ] || { echo "missing $B"; exit 2; }
B=$(cd "$(dirname "$B")" && pwd)/$(basename "$B")
T=$(mktemp -d -t uat-standup.XXXXXX); trap 'rm -rf "$T"' EXIT
H="$T/home"; X="$T/xdg"; REPO="$T/repo"
mkdir -p "$H" "$X" "$REPO/su-code"; git -C "$REPO" init -q
run() { (cd "$REPO" && env HOME="$H" XDG_CONFIG_HOME="$X" CLAUDE_CONFIG_DIR="$H/.claude" SUSYNC_NO_AUTO_UPDATE=1 NO_COLOR=1 "$@"); }
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1: $2"; fail=1; }
ROLES="rd plan dev review qa quick critic"
DIR="$REPO/su-code/ship/demo"

out=$(run "$B" ccc standup demo init 2>&1); rc=$?
[ $rc = 0 ] && [ -f "$DIR/SPRINT.md" ] && ok "init writes SPRINT.md" || bad "init" "rc=$rc $out"
out=$(run "$B" ccc standup demo init 2>&1); rc=$?
[ $rc != 0 ] && ok "init refuses overwrite without --force" || bad "overwrite" "rc=$rc $out"

out=$(run "$B" ccc standup demo 2>&1); rc=$?
[ $rc = 3 ] && ok "fresh board: exit 3 (idle)" || bad "idle exit" "rc=$rc $out"
idle=$(grep '^IDLE:' <<<"$out")
all=1; for r in $ROLES; do grep -qw "$r" <<<"$idle" || all=0; done
[ $all = 1 ] && ok "IDLE lists all 7 roles" || bad "idle roles" "$out"

for r in $ROLES; do
  if [ "$r" = qa ]; then
    run "$B" ccc standup demo set qa rest chờ dev xong >/dev/null 2>&1 || bad "set qa" "failed"
  else
    run "$B" ccc standup demo set "$r" doing --agent "agent-$r" --files "src/$r.rs" "việc của $r" >/dev/null 2>&1 || bad "set $r" "failed"
  fi
done
out=$(run "$B" ccc standup demo 2>&1); rc=$?
[ $rc = 0 ] && ! grep -q '^IDLE:' <<<"$out" && ok "all assigned (one rest + reason): exit 0" || bad "assigned" "rc=$rc $out"

n=$(grep -c '^[0-9]' "$DIR/STANDUP.md" 2>/dev/null || true); n=${n:-0}
[ "$n" = 2 ] && sed -n '2p' "$DIR/STANDUP.md" | grep -q '^1 ' && sed -n '3p' "$DIR/STANDUP.md" | grep -q '^2 ' \
  && ok "STANDUP.md has numbered lines 1 and 2" || bad "log" "$(cat "$DIR/STANDUP.md" 2>&1)"

out=$(run "$B" ccc standup demo --json 2>&1); rc=$?
python3 -I -c 'import json,sys; r=json.loads(sys.stdin.read()); assert r["idle"]==[] and len(r["roles"])==7, r' <<<"$out" \
  && [ $rc = 0 ] && ok "--json parses, idle == []" || bad "json" "rc=$rc $out"

run "$B" ccc standup demo set dev done >/dev/null 2>&1
out=$(run "$B" ccc standup demo 2>&1); rc=$?
[ $rc = 3 ] && grep -q '^IDLE: dev' <<<"$out" && ok "done role is idle again: exit 3" || bad "done idle" "rc=$rc $out"

# --json must not append to STANDUP.md
run "$B" ccc standup demo --json >/dev/null 2>&1
n2=$(grep -c '^[0-9]' "$DIR/STANDUP.md" 2>/dev/null || true); n2=${n2:-0}
[ "$n2" = 3 ] && ok "--json does not append to STANDUP.md" || bad "json log" "lines=$n2 (expected 3 after one plain standup since)"

# init --roles dev,review: only those rows count, so all-assigned exits 0
run "$B" ccc standup sub init --roles dev,review >/dev/null 2>&1 || bad "init --roles" "failed"
run "$B" ccc standup sub set dev doing x >/dev/null 2>&1
run "$B" ccc standup sub set review doing y >/dev/null 2>&1
out=$(run "$B" ccc standup sub 2>&1); rc=$?
[ $rc = 0 ] && ! grep -q '^IDLE:' <<<"$out" && ok "init --roles dev,review: exit 0 when both assigned" || bad "roles subset" "rc=$rc $out"

[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $fail
