#!/usr/bin/env bash
# UAT: the ENV VAR CLAUDE_CODE_AUTO_COMPACT_WINDOW (what `8sync ccc compact --window N` writes) moves the
# auto-compaction trigger: trigger ~= PCT % x WINDOW. No --autocompact flag is passed (the env var outranks it anyway).
# Real run of the official `claude` binary (subscription login), Haiku 5.5, a few cents.
# Also a recall check: a secret token in part01.txt (read first, before the compaction) is asked at the end.
# Usage: scripts/uat/compact-window.sh [WINDOW=200000] [PCT=60] [MODEL=claude-haiku-5-5]
# Pass = first auto compact_boundary.preTokens within PCT-10 .. PCT+7 % of the window (200000/60 -> 100..134K). Windows <=120K trigger LOWER than PCT x window (see README).
# Exit 0 = pass, 1 = compaction missing/out of band, 2 = setup error.
set -uo pipefail
WINDOW="${1:-200000}"; PCT="${2:-60}"; MODEL="${3:-claude-haiku-5-5}"   # PCT=none -> control run, env var NOT set (informational, exit 0)
FILES=14 FILE_KB=34 MAX_TURNS=24 BUDGET=2
for c in claude jq python3; do command -v "$c" >/dev/null || { echo "missing $c"; exit 2; }; done

T=$(mktemp -d -t uat-compact.XXXXXX); mkdir -p "$T/cwd"
PROJ="$HOME/.claude/projects/$(printf %s "$(cd "$T/cwd" && pwd -P)" | sed 's|[^A-Za-z0-9]|-|g')"
cleanup() { [ -n "${KEEP:-}" ] && { echo "kept: $T proj: $PROJ"; return; }; rm -rf "$T"; case "$PROJ" in "$HOME"/.claude/projects/-tmp-*|"$HOME"/.claude/projects/-var-*) rm -rf "$PROJ";; esac; }
trap cleanup EXIT

# --- generated corpus: random pseudo-words, ~FILE_KB KB each --------------------------------------
python3 -I - "$T/cwd" "$FILES" "$FILE_KB" <<'PY'
import random, sys, string
d, n, kb = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
r = random.Random(7)
for i in range(1, n + 1):
    out, size = [], 0
    while size < kb * 1024:
        w = "".join(r.choice(string.ascii_lowercase) for _ in range(r.randint(3, 9)))
        out.append(w); size += len(w) + 1
        if len(out) % 12 == 0: out.append("\n")
    txt = " ".join(out)
    if i == 1: txt = "RECALL-MARKER: ZQX-4417-LUMEN\n" + txt
    open(f"{d}/part{i:02d}.txt", "w").write(txt)
PY

# --- PreCompact hook: stdin JSON + tokens of the last assistant message in the transcript ---------
cat > "$T/hook.sh" <<'HOOK'
#!/usr/bin/env bash
in=$(cat); tp=$(printf %s "$in" | jq -r .transcript_path)
tok=$(jq -s '[ .[] | select(.type=="assistant" and .message.usage) | .message.usage
              | (.input_tokens//0)+(.cache_read_input_tokens//0)+(.cache_creation_input_tokens//0) ] | last // 0' "$tp" 2>/dev/null)
printf %s "$in" | jq -c --argjson tok "${tok:-0}" '. + {last_assistant_usage_tokens:$tok}' >> "$LOG"
HOOK
chmod +x "$T/hook.sh"
export LOG="$T/precompact.log"; : > "$LOG"
jq -n --arg c "$T/hook.sh" '{hooks:{PreCompact:[{hooks:[{type:"command",command:$c}]}]}}' > "$T/settings.json"

LIST=$(seq -f 'part%02g.txt' 1 "$FILES" | paste -sd' ')
PROMPT="Read these files with the Read tool, strictly one Read call per step and in this order, never in parallel and never skipping: $LIST. Do not summarise or quote them. Between reads write only the word next. After the last file, reply with exactly CODE=<the value after RECALL-MARKER: written at the top of part01.txt>."

echo "model=$MODEL window=$WINDOW pct=$PCT expected_trigger=$([ "$PCT" = none ] && echo default || echo "~$((WINDOW*PCT/100))") cwd=$T/cwd"
( cd "$T/cwd" && export CLAUDE_CODE_AUTO_COMPACT_WINDOW="$WINDOW" && { [ "$PCT" = none ] && unset CLAUDE_AUTOCOMPACT_PCT_OVERRIDE || export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE="$PCT"; } && timeout 900 claude -p "$PROMPT" \
    --model "$MODEL" --permission-mode auto --max-turns "$MAX_TURNS" --max-budget-usd "$BUDGET" \
    --setting-sources local --settings "$T/settings.json" \
    --disable-slash-commands --strict-mcp-config --output-format json ) > "$T/out.json" 2> "$T/err.log" </dev/null
rc=$?
cost=$(jq -r '.total_cost_usd // "n/a"' "$T/out.json" 2>/dev/null); turns=$(jq -r '.num_turns // "n/a"' "$T/out.json" 2>/dev/null)
echo "claude exit=$rc turns=$turns total_cost_usd=$cost subtype=$(jq -r '.subtype // .result // "?"' "$T/out.json" 2>/dev/null | head -c 80)"
[ -s "$T/out.json" ] || { echo "no output:"; head -c 600 "$T/err.log"; exit 2; }

n=$(wc -l < "$LOG"); echo "PreCompact hook events logged: $n (a compaction may fire the hook more than once)"
[ "$n" -gt 0 ] && jq -c '{trigger,last_assistant_usage_tokens,custom_instructions}' "$LOG"
auto=$(jq -s '[.[]|select(.trigger=="auto")]|length' "$LOG")
[ "$auto" -ge 1 ] || { echo "FAIL: no trigger=auto PreCompact within $MAX_TURNS turns / \$$BUDGET"; exit 1; }
# Tokens AT compaction: Claude Code writes them into the transcript's compact_boundary record
# (preTokens, includes the tool_result that was pending). Hook's transcript_path points at that file.
tp=$(jq -rs '[.[]|select(.trigger=="auto")][0].transcript_path' "$LOG")
echo "compact_boundary records (trigger / preTokens / postTokens / % of window):"
jq -r --argjson w "$WINDOW" 'select(.type=="system" and .subtype=="compact_boundary") | .compactMetadata
  | "  \(.trigger)  pre=\(.preTokens)  post=\(.postTokens)  \(.preTokens*1000/$w|floor/10)%"' "$tp"
m=$(jq -s '[.[]|select(.type=="system" and .subtype=="compact_boundary" and .compactMetadata.trigger=="auto")][0].compactMetadata.preTokens' "$tp")
[ "$m" != null ] && [ -n "$m" ] || { echo "FAIL: hook fired but no compact_boundary in transcript"; exit 1; }
pct=$(python3 -c "print(round($m*100/$WINDOW,1))")
echo "FIRST auto-compaction at $m tokens = $pct % of the $WINDOW window (override=$PCT %)"
ans=$(jq -r '.result // ""' "$T/out.json" | tr '\n' ' ' | head -c 200)
if printf %s "$ans" | grep -q 'ZQX-4417-LUMEN'; then echo "RECALL: ok - token from part01 answered after compaction ($ans)"; else echo "RECALL FINDING: token from part01 NOT recovered after compaction; final answer: $ans"; fi
[ "$PCT" = none ] && { echo "CONTROL run (no override): informational only"; exit 0; }
lo=$((WINDOW*(PCT-10)/100)); hi=$((WINDOW*(PCT+7)/100))
if [ "$m" -ge "$lo" ] && [ "$m" -le "$hi" ]; then echo "PASS: trigger=auto at $pct % (accepted band $((PCT-10))..$((PCT+7)) % of window)"; exit 0; fi
echo "FAIL: compaction at $pct % is outside $((PCT-10))..$((PCT+7)) %"; exit 1
