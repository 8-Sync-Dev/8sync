#!/usr/bin/env bash
# UAT: the 8sync-hints mod loads in the official `claude` binary. Headless `claude -p` with
# `--plugin-dir` prints one stderr line naming a plugin whose module failed to load; a clean run
# prints none. Also checks `8sync ccc hint --json` answers from a repo (the mod's only dependency).
# Usage: scripts/uat/hints-load.sh [MOD_DIR=assets/configs/claude/mods/8sync-hints]
# Exit 0 = pass, 1 = mod failed to load / hint broken, 2 = setup error.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
MOD="${1:-$ROOT/assets/configs/claude/mods/8sync-hints}"
for c in claude 8sync python3; do command -v "$c" >/dev/null || { echo "missing $c"; exit 2; }; done
[ -f "$MOD/.claude-plugin/plugin.json" ] || { echo "no mod at $MOD"; exit 2; }

T=$(mktemp -d -t uat-hints.XXXXXX); trap 'rm -rf "$T"' EXIT
ERR="$T/stderr.txt"
# A prompt the model answers in one short turn; the mod loads before the turn starts.
claude -p "Reply with the single word OK." --plugin-dir "$MOD" --model claude-haiku-5-5 --max-turns 1 \
  >"$T/stdout.txt" 2>"$ERR"
code=$?
if grep -i "8sync-hints" "$ERR" | grep -Eiq "fail|refus|not loaded|error"; then
  echo "FAIL: engine refused the mod:"; grep -i "8sync-hints" "$ERR"; exit 1
fi
[ "$code" -eq 0 ] || { echo "FAIL: claude -p exited $code"; tail -5 "$ERR"; exit 1; }

# The Rust side the mod calls: JSON with suggest + band, and typeahead rows for `/`.
cd "$ROOT" || exit 2
8sync ccc hint --json >"$T/hint.json" || { echo "FAIL: 8sync ccc hint --json exited $?"; exit 1; }
python3 -I - "$T/hint.json" <<'PY' || exit 1
import json, sys
v = json.load(open(sys.argv[1]))
assert "suggest" in v and isinstance(v["band"], list) and len(v["band"]) <= 2, v
print("hint ok:", json.dumps(v, ensure_ascii=False)[:160])
PY
8sync ccc hint --complete /sh --json | python3 -I -c 'import json,sys; v=json.load(sys.stdin); assert any(r["text"]=="/ship" for r in v["complete"]), v; print("complete ok:", len(v["complete"]), "rows")' || exit 1
echo "PASS: 8sync-hints loads in claude -p and 8sync ccc hint answers"
