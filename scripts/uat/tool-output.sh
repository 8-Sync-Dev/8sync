#!/usr/bin/env bash
# UAT: the kit's tool-output budget (BASH_MAX_OUTPUT_LENGTH / CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS) cuts input tokens
# without breaking the answer. Real run of the official `claude -p` (subscription login, no API key), Haiku 5.5,
# twice on the same generated corpus: BASELINE (settings without the env) vs KIT (env from crates/cli/src/verbs/ccc/output_budget.rs).
# Tokens = input + cache_creation + cache_read summed over all API calls (`usage` of `--output-format json`).
# Pass = both runs contain both hidden tokens in the answer AND KIT tokens < BASELINE tokens.
# Usage: scripts/uat/tool-output.sh [MODEL=claude-haiku-5-5]   (KEEP=1 keeps the sandbox)   Exit 0 pass, 1 fail, 2 setup error.
set -uo pipefail
MODEL="${1:-claude-haiku-5-5}"; BUDGET=1; MAX_TURNS=14
BASH_LEN=20000; READ_TOK=15000      # keep in sync with output_budget.rs
for c in claude jq python3; do command -v "$c" >/dev/null || { echo "missing $c"; exit 2; }; done
T=$(mktemp -d -t uat-tooloutput.XXXXXX)
cleanup() { [ -n "${KEEP:-}" ] && { echo "kept: $T"; return; }; rm -rf "$T"; }
trap cleanup EXIT

# --- corpus: big.txt (~21k tokens when read: fits the default 25k limit, not the kit's 15k) and gen.py (prints ~27k chars) ---
mk() { # $1 = dir
  mkdir -p "$1"
  python3 -I - "$1" <<'PY'
import random, string, sys
d = sys.argv[1]; r = random.Random(11)
def words(n): return " ".join("".join(r.choice(string.ascii_lowercase) for _ in range(r.randint(3, 9))) for _ in range(n))
lines = [f"row {i:04d}: {words(9)}" for i in range(1, 801)]
lines.append("END-OF-FILE-TOKEN: FILEEND-7Q4K2X")
open(f"{d}/big.txt", "w").write("\n".join(lines) + "\n")
open(f"{d}/gen.py", "w").write(
    "import random, string\nr = random.Random(5)\n"
    "for i in range(1, 541):\n    print('log %04d: ' % i + ' '.join(''.join(r.choice(string.ascii_lowercase) for _ in range(r.randint(3, 9))) for _ in range(6)))\n"
    "print('SUMMARY lines=540 token=CMDEND-9Z3M1V')\n")
PY
}
PROMPT="Do two things. 1) Read the file big.txt in the current directory with the Read tool and tell me the text after 'END-OF-FILE-TOKEN:' on its last line. 2) Run 'python3 gen.py' with Bash and tell me its final SUMMARY line. If either output arrives truncated or as a saved file, get the missing part yourself. Final answer: exactly two lines, 'FILE=<token>' and 'CMD=<token>'."

run() { # $1 label  $2 settings json
  local d="$T/$1"; mk "$d/cwd"; printf '%s' "$2" > "$d/settings.json"
  ( cd "$d/cwd" && unset BASH_MAX_OUTPUT_LENGTH CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS && timeout 600 claude -p "$PROMPT" \
      --model "$MODEL" --permission-mode auto --max-turns "$MAX_TURNS" --max-budget-usd "$BUDGET" \
      --setting-sources local --settings "$d/settings.json" --disable-slash-commands --strict-mcp-config \
      --output-format json ) > "$d/out.json" 2> "$d/err.log" </dev/null
  [ -s "$d/out.json" ] || { echo "$1: no output"; head -c 500 "$d/err.log"; exit 2; }
  local tok cost turns res ok
  tok=$(jq '(.usage.input_tokens//0)+(.usage.cache_creation_input_tokens//0)+(.usage.cache_read_input_tokens//0)' "$d/out.json")
  cost=$(jq -r '.total_cost_usd // "n/a"' "$d/out.json"); turns=$(jq -r '.num_turns // "n/a"' "$d/out.json")
  res=$(jq -r '.result // ""' "$d/out.json")
  ok=0; { printf %s "$res" | grep -q 'FILEEND-7Q4K2X' && printf %s "$res" | grep -q 'CMDEND-9Z3M1V'; } && ok=1
  echo "$1: input_total_tokens=$tok turns=$turns cost_usd=$cost hidden_check=$([ $ok = 1 ] && echo pass || echo FAIL)"
  eval "TOK_$1=$tok OK_$1=$ok"
}

run baseline '{}'
run kit "$(jq -nc --arg b "$BASH_LEN" --arg r "$READ_TOK" '{env:{BASH_MAX_OUTPUT_LENGTH:$b,CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS:$r}}')"
echo "baseline=$TOK_baseline kit=$TOK_kit delta=$((TOK_kit-TOK_baseline))"
[ "$OK_baseline" = 1 ] && [ "$OK_kit" = 1 ] || { echo "FAIL: hidden check missing in a run"; exit 1; }
[ "$TOK_kit" -lt "$TOK_baseline" ] && { echo "PASS: kit budget used fewer input tokens ($TOK_kit < $TOK_baseline)"; exit 0; }
echo "FAIL: kit budget did not reduce tokens"; exit 1
