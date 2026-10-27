#!/usr/bin/env bash
# UAT (no model, free): `8sync ccc . urgent` + `8sync ccc . ls` against a sandbox HOME/XDG config and a
# throwaway git repo. Seeds a session registry (older/newer), flags the newer-registered but older-active
# session the way an agent would (CLAUDE_CODE_SESSION_ID), then checks ls order (default priority: the
# flagged room first; `--sort time`: newest first), chip text, JSON order + id/urgency per row, clear.
# Usage: scripts/uat/ls-urgency.sh [path/to/8sync]   Exit 0 = pass.
set -uo pipefail
# 8sync finds the registry under dirs::config_dir(), which follows XDG_CONFIG_HOME on Linux only
# (Windows: %APPDATA%, macOS: ~/Library/Application Support): the sandbox below works on Linux only.
[ "$(uname -s)" = Linux ] || { echo "skipped: Linux only (the sandbox registry needs XDG_CONFIG_HOME)"; exit 2; }
B="${1:-target/debug/8sync}"
command -v "$B" >/dev/null || [ -x "$B" ] || { echo "missing $B"; exit 2; }
B=$(cd "$(dirname "$B")" && pwd)/$(basename "$B")
T=$(mktemp -d -t uat-urg.XXXXXX); trap 'rm -rf "$T"' EXIT
H="$T/home"; X="$T/xdg"; REPO="$T/repo"
mkdir -p "$H" "$X" "$REPO"; git -C "$REPO" init -q
ROOT=$(cd "$REPO" && pwd -P)
KEY=$(printf '%s' "$ROOT" | sed 's/[^A-Za-z0-9]/-/g')
IDX="$X/8sync/claude-sessions/$KEY"; mkdir -p "$IDX"
OLD=11111111-1111-4111-8111-111111111111; NEW=22222222-2222-4222-8222-222222222222
now=$(date +%s)
cat > "$IDX/index.json" <<EOF
{"last_used":"fresh","sessions":[
 {"name":"fresh","conversation_id":"$NEW","created":$((now-500)),"last_active":$((now-10))},
 {"name":"stale","conversation_id":"$OLD","created":$((now-900)),"last_active":$((now-3600))}]}
EOF
# Reverse registration order so newest-first is visible: put stale first in the file.
python3 -I -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["sessions"].reverse(); json.dump(d,open(p,"w"))' "$IDX/index.json"
run() { (cd "$REPO" && env -u CLAUDE_CONFIG_DIR HOME="$H" XDG_CONFIG_HOME="$X" CLAUDE_CONFIG_DIR="$H/.claude" SUSYNC_NO_AUTO_UPDATE=1 NO_COLOR=1 "$@"); }
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1: $2"; fail=1; }

out=$(run env CLAUDE_CODE_SESSION_ID="$OLD" "$B" ccc . urgent high "chờ owner duyệt PR" 2>&1); rc=$?
[ $rc = 0 ] && grep -qF "'stale' marked high" <<<"$out" && ok "agent flags its own session via env id" || bad "flag via env" "rc=$rc $out"

out=$(run "$B" ccc . ls 2>&1)
first=$(grep -nE '^(★| ) ' <<<"$out" | head -1)
grep -q 'stale' <<<"$first" && ok "default priority: the flagged room listed first" || bad "order" "$out"
grep -q 'sắp theo ưu tiên' <<<"$out" && ok "header says the order in use" || bad "sort note" "$out"
grep -E '^ +stale .*▲ high$' <<<"$out" >/dev/null && ok "chip '▲ high' (text, not colour only) on stale" || bad "chip" "$out"
grep -qE '^ +flag chờ owner duyệt PR · ' <<<"$out" && ok "flag line carries the note" || bad "flag line" "$out"
out=$(run "$B" ccc . ls --sort time 2>&1)
first=$(grep -nE '^(★| ) ' <<<"$out" | head -1)
grep -q 'fresh' <<<"$first" && ok "--sort time: newest activity first" || bad "order time" "$out"

out=$(run "$B" ccc . ls --json 2>&1)
python3 -I -c 'import json,sys; o,n=sys.argv[1],sys.argv[2]; r=json.loads(sys.stdin.read()); assert [x["name"] for x in r]==["stale","fresh"], r; assert (r[0]["id"],r[0]["urgency"]["level"],r[1]["id"],r[1]["urgency"])==(o,"high",n,None), r' "$OLD" "$NEW" <<<"$out" \
  && ok "--json: priority order, id/urgency stay with their row" || bad "json" "$out"
out=$(run "$B" ccc . ls --json --sort time -r 2>&1)
python3 -I -c 'import json,sys; o=sys.argv[1]; r=json.loads(sys.stdin.read()); assert [x["name"] for x in r]==["stale","fresh"] and r[0]["id"]==o, r' "$OLD" <<<"$out" \
  && ok "--json --sort time -r: oldest first" || bad "json time -r" "$out"
out=$(run "$B" ccc . ls --sort size 2>&1); rc=$?
[ $rc != 0 ] && grep -qF "priority | time | name | status" <<<"$out" && ok "unknown --sort key -> clear error" || bad "bad key" "rc=$rc $out"

out=$(run "$B" ccc . urgent low --session fresh 2>&1); grep -qF "'fresh' marked low" <<<"$out" && ok "--session flags another by name" || bad "--session" "$out"
out=$(run env -u CLAUDE_CODE_SESSION_ID "$B" ccc . urgent high 2>&1); rc=$?
[ $rc != 0 ] && grep -qF -- "--session" <<<"$out" && ok "no id, no --session -> clear error" || bad "no target" "rc=$rc $out"
out=$(run env CLAUDE_CODE_SESSION_ID="$OLD" "$B" ccc . urgent clear 2>&1); grep -qF "cleared urgency of 'stale'" <<<"$out" && ok "clear" || bad "clear" "$out"
out=$(run "$B" ccc . ls 2>&1)
# Session lines only: the order note under the header lists the chips as a legend.
grep -E '^(★| ) stale .*▲ high$' <<<"$out" >/dev/null && bad "cleared chip still shown" "$out" || ok "cleared chip gone"
grep -E '^(★| ) fresh .*▽ low$' <<<"$out" >/dev/null && ok "low chip shown" || bad "low chip" "$out"

[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $fail
