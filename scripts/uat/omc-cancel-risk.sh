#!/usr/bin/env bash
# UAT: `8sync ccc risk` reads this repo's real diff and names the gates; `8sync ccc cancel` refuses
# without a session (fail-closed) and cancels a throwaway loop in a scratch repo with --session.
# Usage: scripts/uat/omc-cancel-risk.sh [BIN=8sync]   Exit 0 = pass, 1 = fail, 2 = setup error.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
BIN="${1:-8sync}"
command -v "$BIN" >/dev/null || { echo "missing $BIN"; exit 2; }
command -v python3 >/dev/null || { echo "missing python3"; exit 2; }

cd "$ROOT" || exit 2
J=$("$BIN" ccc risk --json) || { echo "FAIL: risk exited $?"; exit 1; }
printf '%s' "$J" | python3 -I -c '
import json,sys
a=json.load(sys.stdin)
gates=[g["gate"] for g in a["gates"]]
assert a["schema"]==1 and gates[0]=="sec", gates
assert a["level"] in ("low","medium","high"), a["level"]
print("risk:", a["level"], "base", a["base"], "files", len(a["files"]), "gates", gates)
' || { echo "FAIL: risk JSON shape"; printf '%s\n' "$J" | head -c 600; exit 1; }
"$BIN" ccc risk --paths apps/web/login.ts,CHANGELOG.md | grep -q '/rules' || { echo "FAIL: --paths did not require /rules"; exit 1; }

T=$(mktemp -d -t uat-cancel.XXXXXX); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/su-code/ship"
cd "$T" || exit 2
# No session id, no --session → refused, nothing written.
if env -u CLAUDE_CODE_SESSION_ID "$BIN" ccc cancel >"$T/out.txt" 2>&1; then echo "FAIL: cancel without a session must exit 1"; cat "$T/out.txt"; exit 1; fi
grep -q -- '--session' "$T/out.txt" || { echo "FAIL: refusal does not name --session"; cat "$T/out.txt"; exit 1; }
# A named session of this scratch repo + a live loop in ACTIVE → cancelled, exit 0, loop stopped.
"$BIN" ccc loop init uat-x --max-iter 2 --max-min 5 >/dev/null || { echo "FAIL: loop init"; exit 1; }
printf 'uat-x\n' > su-code/ship/ACTIVE
"$BIN" ccc cancel --session no-such-session >"$T/out2.txt" 2>&1 && { echo "FAIL: unknown --session must exit 1"; exit 1; }
grep -q "no session 'no-such-session'" "$T/out2.txt" || { echo "FAIL: unknown session message"; cat "$T/out2.txt"; exit 1; }
test -f su-code/ship/ACTIVE || { echo "FAIL: refusal must not touch ACTIVE"; exit 1; }
CLAUDE_CODE_SESSION_ID=uat-unregistered "$BIN" ccc cancel --json >"$T/out3.txt" 2>&1 || { echo "FAIL: cancel exited $?"; cat "$T/out3.txt"; exit 1; }
python3 -I -c '
import json,sys
r=json.load(open(sys.argv[1]))
assert r["ok"] is True and any(d.startswith("loop uat-x") for d in r["done"]), r
' "$T/out3.txt" || { cat "$T/out3.txt"; exit 1; }
grep -q '"stopped": "cancelled"' su-code/ship/uat-x/loop.json || { echo "FAIL: loop not cancelled"; exit 1; }
test ! -e su-code/ship/ACTIVE || { echo "FAIL: ACTIVE still there"; exit 1; }
echo "PASS: risk names gates on the real diff; cancel is fail-closed and stops the loop"
