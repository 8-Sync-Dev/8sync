#!/usr/bin/env bash
# UAT (no model, free): `8sync ccc hook idle` against a sandbox HOME with a fake agent-team task list.
# Walks the ladder the way Claude Code would call it (TeammateIdle exit 2 + stderr, lead Stop JSON block)
# and checks the rails: off by default, loop -> rest, subscription without a lease -> rest.
# A real agent team needs an interactive session (agent teams do not spawn under `claude -p`), so the
# live run is owner-run: see README.md "no-idle".
# Usage: scripts/uat/no-idle-hook.sh [path/to/8sync]   Exit 0 = pass.
set -uo pipefail
B="${1:-8sync}"
command -v "$B" >/dev/null || [ -x "$B" ] || { echo "missing $B"; exit 2; }
T=$(mktemp -d -t uat-idle.XXXXXX); trap 'rm -rf "$T"' EXIT
H="$T/home"; TEAM=session-abcdefgh; TD="$H/.claude/tasks/$TEAM"
mkdir -p "$TD" "$H/.claude/teams/$TEAM"
echo '{"members":[]}' > "$H/.claude/teams/$TEAM/config.json"
task() { printf '{"id":"%s","subject":"%s","status":"%s","owner":"%s","blockedBy":[]}\n' "$1" "$2" "$3" "${4:-}" > "$TD/$1.json"; }
fail=0
# check <label> <on> <input> <want rc> <want text|->
check() {
  local out rc
  out=$(env -u CLAUDE_CONFIG_DIR -u ANTHROPIC_API_KEY HOME="$H" EIGHTSYNC_NO_IDLE="$2" "$B" ccc hook idle <<<"$3" 2>&1); rc=$?
  if [ "$rc" != "$4" ] || { [ "$5" != - ] && ! grep -qF -- "$5" <<<"$out"; } || { [ "$5" = - ] && [ -n "$out" ]; }; then
    echo "FAIL $1: rc=$rc out=$out"; fail=1
  else
    echo "ok   $1"
  fi
}
TI='{"hook_event_name":"TeammateIdle","session_id":"mate","team_name":"'$TEAM'","teammate_name":"be","cwd":"/nonexistent"}'
ST='{"hook_event_name":"Stop","session_id":"abcdefgh-1111","cwd":"/nonexistent","stop_hook_active":false}'
task 1 "viết test" pending
check "off by default"            0 "$TI" 0 -
check "teammate takes next task" 1 "$TI" 2 "TaskList"
check "same nudge twice = rest"   1 "$TI" 0 -
check "lead hands out task #1"    1 "$ST" 0 '"decision":"block"'
task 1 "viết test" completed be
check "no task: teammate rests"   1 "$TI" 0 -
check "lead rests (no work)"      1 "$ST" 0 -
mkdir -p "$H/.claude/tasks/other123"; printf '{"id":"1","subject":"x","status":"pending","blockedBy":[]}' > "$H/.claude/tasks/other123/1.json"
rm -rf "$H/.local/state/8sync/ccc/idle/mem"
check "lead offers help to other room" 1 "$ST" 0 'other123'
rm -rf "$H/.local/state/8sync/ccc/idle/mem"
check "busy lead (bg task) stays home" 1 '{"hook_event_name":"Stop","session_id":"abcdefgh-1111","background_tasks":[{"id":"a","status":"running"}]}' 0 -
check "no team_name: from session_id" 1 '{"hook_event_name":"TeammateIdle","session_id":"abcdefgh-2222","teammate_name":"qa"}' 0 -
# task-done gate: a code edit after the last check on a dirty tree holds the task, a test run lets it pass,
# and the member's next idle asks for one /remember lesson.
R="$T/repo"; mkdir -p "$R"; git -C "$R" init -q; echo 'fn a() {}' > "$R/a.rs"; git -C "$R" add a.rs
git -C "$R" -c user.name=t -c user.email=t@t commit -qm init; echo 'fn a() { 1; }' > "$R/a.rs"
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"%s/a.rs"}}]}}\n' "$R" > "$R/t.jsonl"
TC='{"hook_event_name":"TaskCompleted","session_id":"mate","team_name":"'$TEAM'","teammate_name":"be","task_id":"9","task_subject":"fix a","cwd":"'$R'","transcript_path":"'$R/t.jsonl'"}'
tdone() { out=$(env -u CLAUDE_CONFIG_DIR HOME="$H" EIGHTSYNC_NO_IDLE=1 "$B" ccc hook task-done <<<"$TC" 2>&1); rc=$?; }
out=; rc=; tdone; [ "$rc" = 2 ] && grep -q 'a.rs' <<<"$out" && echo "ok   task-done holds an unchecked edit" || { echo "FAIL task-done hold: $out"; fail=1; }
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"cargo test"}}]}}\n' >> "$R/t.jsonl"
tdone; [ "$rc" = 0 ] && echo "ok   task-done passes after a test run" || { echo "FAIL task-done pass: $out"; fail=1; }
check "next idle asks for one lesson" 1 "$TI" 2 "/remember"
echo '{"oauthAccount":{"emailAddress":"x@y.z"}}' > "$H/.claude.json"
task 2 docs pending
check "subscription, no lease"    1 "$TI" 0 -
check "path-like team name ignored" 1 '{"hook_event_name":"TeammateIdle","team_name":"../x","teammate_name":"be"}' 0 -
st=$(env HOME="$H" EIGHTSYNC_NO_IDLE=1 "$B" ccc idle status --json)
grep -q '"state":"rest"' <<<"$st" && grep -q 'subscription' <<<"$st" && echo "ok   status --json records the rest reason" || { echo "FAIL status: $st"; fail=1; }
[ "$fail" = 0 ] && echo PASS || echo FAIL
exit "$fail"
