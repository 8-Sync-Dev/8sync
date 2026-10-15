#!/usr/bin/env bash
# UAT (no model, free): how long each kit hook keeps Claude Code waiting. The hooks run on every
# prompt / tool call, so they must stay far below the model's own latency; omp/forge have no such
# hooks, and this is where ccc pays. Budget (median of N runs, sandbox HOME): guard, wake, watchdog,
# resume-note <= 20 ms; verify with a file outside any project (its no-op path) <= 50 ms. The real
# verify check (tsc/cargo) runs with asyncRewake and never blocks the model: see ccc/verify.rs.
# Usage: scripts/uat/hook-latency.sh [path/to/8sync] [runs]   Exit 0 = every hook within budget.
# HOOK_BUDGET_SCALE=3 relaxes every budget (loaded CI runner); the numbers printed are the real medians.
set -uo pipefail
B="${1:-8sync}"; N="${2:-7}"; SCALE="${HOOK_BUDGET_SCALE:-1}"
command -v "$B" >/dev/null || [ -x "$B" ] || { echo "missing $B"; exit 2; }
T=$(mktemp -d -t uat-hook-lat.XXXXXX); trap 'rm -rf "$T"' EXIT
H="$T/home"; mkdir -p "$H"
# Microseconds. bash >= 5 has EPOCHREALTIME (decimal separator follows the locale: "." or ",");
# GNU date has %N; macOS bash 3.2 + BSD date have neither, so fall back to python3 / perl.
now_us() {
  if [ -n "${EPOCHREALTIME-}" ]; then echo "${EPOCHREALTIME/[.,]/}"; return; fi
  local n; n=$(date +%s%N 2>/dev/null)
  case "$n" in "" | *[!0-9]*) ;; *) echo $(( n / 1000 )); return ;; esac
  if command -v python3 >/dev/null 2>&1; then python3 -c 'import time; print(int(time.time() * 1e6))'
  else perl -MTime::HiRes=time -e 'printf "%d\n", time * 1e6'; fi
}
fail=0
# bench <label> <budget-ms> <hook> <stdin-json>
bench() {
  local label=$1 budget=$(( $2 * SCALE )) hook=$3 input=$4 i t0 t1 times=()
  for ((i = 0; i < N; i++)); do
    t0=$(now_us)
    env -u CLAUDE_CONFIG_DIR -u ANTHROPIC_API_KEY HOME="$H" "$B" ccc hook "$hook" <<<"$input" >/dev/null 2>&1
    t1=$(now_us)
    times+=( $(( (t1 - t0) / 1000 )) )
  done
  local sorted med
  sorted=$(printf '%s\n' "${times[@]}" | sort -n)
  med=$(printf '%s\n' "$sorted" | sed -n "$(( (N + 1) / 2 ))p")
  local max; max=$(printf '%s\n' "$sorted" | tail -1)
  if [ "$med" -le "$budget" ]; then
    printf 'ok   %-12s median %3d ms  max %3d ms  (budget %d ms)\n' "$label" "$med" "$max" "$budget"
  else
    printf 'FAIL %-12s median %3d ms  max %3d ms  (budget %d ms)\n' "$label" "$med" "$max" "$budget"; fail=1
  fi
}
SID=bench-0123-4567
bench guard       20 guard       '{"hook_event_name":"PreToolUse","session_id":"'$SID'","tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"'$T'"}'
bench wake        20 wake        '{"hook_event_name":"UserPromptSubmit","session_id":"'$SID'","prompt":"làm tiếp","cwd":"'$T'"}'
bench watchdog    20 watchdog    '{"hook_event_name":"PostToolUse","session_id":"'$SID'","tool_name":"Read","cwd":"'$T'"}'
bench resume-note 20 resume-note '{"hook_event_name":"UserPromptSubmit","session_id":"'$SID'","prompt":"làm tiếp","cwd":"'$T'"}'
bench verify-noop 50 verify      '{"hook_event_name":"PostToolUse","session_id":"'$SID'","tool_name":"Write","tool_input":{"file_path":"'$T'/nowhere/x.ts"},"cwd":"'$T'"}'
[ "$fail" = 0 ] && echo "PASS hook-latency ($N runs each)" || echo "FAIL hook-latency"
exit $fail
