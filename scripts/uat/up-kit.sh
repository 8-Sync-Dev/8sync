#!/usr/bin/env bash
# UAT: `8sync up` on an "other machine" refreshes the kit (statusline chain, compact env, stamp).
# Old release binary runs from a mktemp dir with HOME/XDG/CLAUDE_CONFIG_DIR all redirected there;
# `up` replaces current_exe() (selfup.rs installed_path), so only the temp copy is touched.
# Usage: scripts/uat/up-kit.sh [OLD_TAG=v0.79.1]   (needs gh, curl, jq, network; no API key)
#   UPDATER=<path to a locally built 8sync> scripts/uat/up-kit.sh  — seed the kit with OLD_TAG, then let the
#   given binary run `up --force` (tests unreleased up.rs code against the latest release).
set -uo pipefail
OLD="${1:-v0.79.1}"; REPO=8-Sync-Dev/su-code
case "$(uname -m)" in x86_64|amd64) ARCH=x86_64;; aarch64|arm64) ARCH=aarch64;; *) echo "unsupported arch"; exit 2;; esac
[ "$(uname -s)" = Linux ] || { echo "linux only"; exit 2; }
for c in gh curl jq; do command -v "$c" >/dev/null || { echo "missing $c"; exit 2; }; done

T=$(mktemp -d -t up-kit.XXXXXX); fail=0; trap '[ "$fail" = 0 ] && rm -rf "$T"' EXIT
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/gh}"  # gh keeps its login (read-only use) despite the HOME redirect
mkdir -p "$T/home/.claude" "$T/home/.config" "$T/home/.cache" "$T/bin"
export HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" XDG_CACHE_HOME="$T/home/.cache" \
       XDG_DATA_HOME="$T/home/.local/share" CLAUDE_CONFIG_DIR="$T/home/.claude"
unset EIGHTSYNC_OFFLINE SUSYNC_NO_AUTO_UPDATE ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
EXE="$T/bin/8sync"
chk() { if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1  ($3)"; fail=1; fi; }

LATEST=$(gh release view -R "$REPO" --json tagName -q .tagName) || { echo "cannot read latest tag"; exit 2; }
echo "old=$OLD latest=$LATEST sandbox=$T"
gh release download -R "$REPO" "$OLD" -p "8sync-$OLD-linux-$ARCH" -O "$EXE" --clobber >/dev/null || { echo "download failed"; exit 2; }
chmod +x "$EXE"
echo '{"statusLine":{"type":"command","command":"echo orca"}}' > "$CLAUDE_CONFIG_DIR/settings.json"

# old machine: kit at OLD (offline = skip MCP mirroring + auto-update probe)
EIGHTSYNC_OFFLINE=1 SUSYNC_NO_AUTO_UPDATE=1 timeout 120 "$EXE" ccc kit >"$T/kit1.log" 2>&1 </dev/null || { echo "seed kit failed:"; tail -20 "$T/kit1.log"; exit 2; }
STAMP="$CLAUDE_CONFIG_DIR/.8sync-kit.json"
v0=$("$EXE" --version | awk '{print $NF}'); s0=$(jq -r '."8sync"' "$STAMP" 2>/dev/null)
echo "seeded: exe=$v0 stamp=$s0"
chk "seed: exe is $OLD" "$([ "$v0" = "${OLD#v}" ] && echo 1 || echo 0)" "$v0"
chk "seed: stamp is ${OLD#v}" "$([ "$s0" = "${OLD#v}" ] && echo 1 || echo 0)" "$s0"

# the update (network); statusline chain may already exist from seeding or be created by the refresh
UPARGS=()
if [ -n "${UPDATER:-}" ]; then cp "$UPDATER" "$EXE" && chmod +x "$EXE" && UPARGS=(--force) && echo "updater: $UPDATER ($("$EXE" --version))"; fi
timeout 300 "$EXE" up "${UPARGS[@]}" >"$T/up.log" 2>&1 </dev/null; echo "up exit=$? ; tail:"; tail -12 "$T/up.log"

v1=$("$EXE" --version | awk '{print $NF}')
chk "exe --version == latest tag ($LATEST)" "$([ "$v1" = "${LATEST#v}" ] && echo 1 || echo 0)" "got $v1"
S="$CLAUDE_CONFIG_DIR/settings.json"; F="$HOME/.config/8sync/features.toml"
chk "statusLine.command contains '8sync ccc statusline'" "$(jq -e '.statusLine.command|contains("8sync ccc statusline")' "$S" >/dev/null 2>&1 && echo 1 || echo 0)" "$(jq -c .statusLine "$S" 2>&1)"
chk "features.toml statusLine_prev has 'echo orca'" "$(grep -s 'statusLine_prev' "$F" | grep -q 'echo orca' && echo 1 || echo 0)" "$(cat "$F" 2>&1 | head -3)"
chk "env CLAUDE_AUTOCOMPACT_PCT_OVERRIDE present" "$(jq -e '.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE' "$S" >/dev/null 2>&1 && echo 1 || echo 0)" "$(jq -c .env "$S" 2>&1)"
s1=$(jq -r '."8sync"' "$STAMP" 2>/dev/null)
chk "kit stamp == ${LATEST#v}" "$([ "$s1" = "${LATEST#v}" ] && echo 1 || echo 0)" "$s1"
# sandbox sanity: nothing outside T was the target
chk "installed path was the temp exe" "$(grep -q "$EXE" "$T/up.log" && echo 1 || echo 0)" "log lacks $EXE"
[ $fail = 0 ] && echo "RESULT: PASS" || { echo "RESULT: FAIL (sandbox kept: $T ; up log: $T/up.log)"; }
exit $fail
