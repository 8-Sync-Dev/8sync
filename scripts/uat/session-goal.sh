#!/usr/bin/env bash
# UAT (no model, free): `8sync ccc . goal` sets a session's target + claimed files the way an agent
# would (CLAUDE_CODE_SESSION_ID), `ccc . ls` / `--json` show it, and `ccc standup` lists the other
# room's goal and warns when the board's files overlap its claim. Sandbox HOME/XDG + throwaway repo.
# Usage: scripts/uat/session-goal.sh [path/to/8sync]   Exit 0 = pass.
set -uo pipefail
B="${1:-target/debug/8sync}"
command -v "$B" >/dev/null || [ -x "$B" ] || { echo "missing $B"; exit 2; }
B=$(cd "$(dirname "$B")" && pwd)/$(basename "$B")
T=$(mktemp -d -t uat-goal.XXXXXX); trap 'rm -rf "$T"' EXIT
H="$T/home"; X="$T/xdg"; REPO="$T/repo"
mkdir -p "$H" "$X" "$REPO/su-code"; git -C "$REPO" init -q
ROOT=$(cd "$REPO" && pwd -P)
KEY=$(printf '%s' "$ROOT" | sed 's/[^A-Za-z0-9]/-/g')
IDX="$X/8sync/claude-sessions/$KEY"; mkdir -p "$IDX"
CORE=11111111-1111-4111-8111-111111111111; RD=22222222-2222-4222-8222-222222222222
now=$(date +%s)
cat > "$IDX/index.json" <<J
{"last_used":"core","sessions":[
 {"name":"core","conversation_id":"$CORE","created":$((now-900)),"last_active":$((now-10))},
 {"name":"rd","conversation_id":"$RD","created":$((now-500)),"last_active":$((now-60))}]}
J
run() { (cd "$REPO" && env -u CLAUDE_CONFIG_DIR HOME="$H" XDG_CONFIG_HOME="$X" CLAUDE_CONFIG_DIR="$H/.claude" SUSYNC_NO_AUTO_UPDATE=1 NO_COLOR=1 "$@"); }
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1: $2"; fail=1; }

out=$(run env CLAUDE_CODE_SESSION_ID="$RD" "$B" ccc . goal "T8 agent memory" --files assets/claude/agents/qa.md,crates/x.rs 2>&1); rc=$?
[ $rc = 0 ] && grep -qF "'rd' goal set" <<<"$out" && ok "agent sets its own goal via env id" || bad "goal via env" "rc=$rc $out"
out=$(run "$B" ccc . ls 2>&1)
grep -qE '^ +goal T8 agent memory · file: assets/claude/agents/qa.md, crates/x.rs$' <<<"$out" && ok "ls shows goal + files" || bad "ls goal" "$out"
out=$(run "$B" ccc . ls --json 2>&1)
python3 -I -c 'import json,sys; r={x["name"]:x for x in json.loads(sys.stdin.read())}; assert r["rd"]["goal"]["text"]=="T8 agent memory", r; assert r["core"]["goal"] is None, r' <<<"$out" \
  && ok "--json carries goal" || bad "json" "$out"

run "$B" ccc standup g init >/dev/null 2>&1
run env CLAUDE_CODE_SESSION_ID="$CORE" "$B" ccc standup g set dev doing --agent task --files crates/x.rs "standup verb" >/dev/null 2>&1
out=$(run env CLAUDE_CODE_SESSION_ID="$CORE" "$B" ccc standup g 2>&1); rc=$?
[ $rc = 3 ] && ok "standup exits 3 while roles idle" || bad "standup rc" "rc=$rc"
grep -qF -- '- rd: T8 agent memory' <<<"$out" && ok "standup lists the other room's goal" || bad "peer goal" "$out"
grep -qF '⚠ trùng file với rd: crates/x.rs' <<<"$out" && ok "standup warns on file overlap" || bad "conflict" "$out"
grep -q -- '- core:' <<<"$out" && bad "own room listed as peer" "$out" || ok "own room not listed as a peer"

out=$(run env CLAUDE_CODE_SESSION_ID="$RD" "$B" ccc . goal clear 2>&1); grep -qF "cleared goal of 'rd'" <<<"$out" && ok "clear" || bad "clear" "$out"
out=$(run "$B" ccc . ls 2>&1); grep -qE '^ +goal ' <<<"$out" && bad "goal line after clear" "$out" || ok "goal gone after clear"
out=$(run env -u CLAUDE_CODE_SESSION_ID "$B" ccc . goal x 2>&1); rc=$?
[ $rc != 0 ] && grep -qF -- "--session" <<<"$out" && ok "no id, no --session -> clear error" || bad "no target" "rc=$rc $out"

[ $fail = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $fail
