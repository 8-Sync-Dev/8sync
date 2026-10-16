#!/usr/bin/env bash
# C6: seeded browser UAT for hq-team-alive in an isolated HOME (never the owner's live HQ on :8740).
# Two sessions in ONE repo (shop, feat/cart) + today's su-code/standup/<date>.md with a row per room
# -> the office shows a meeting room with 2 attendees, both lead seats empty ("đi họp");
# a fake `8sync` on PATH answers `ccc auto status|on|pause` by writing a state file -> the Pause button
# turns auto on by itself, then pauses on click; two running `task` agents -> the Fullstack seat shows 2 sprites.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../../../apps/hq-ui" && pwd)"
PORT="${PORT:-8753}"
OUT="${OUT:-$HERE/uat-out}"
T="$(mktemp -d)"
W="$T"
command -v cygpath >/dev/null && W="$(cygpath -m "$T")"
# Everything that listens on $PORT (pnpm -> next -> next-server is a tree; killing the subshell alone leaves it alive).
port_pids() { lsof -ti ":$PORT" 2>/dev/null || ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | cut -d= -f2 || true; }
stop_dev() {
  kill "${DEV:-0}" 2>/dev/null || true
  for p in $(port_pids); do kill "$p" 2>/dev/null || true; done
  sleep 1
  rm -rf "$T" 2>/dev/null || true
}
trap stop_dev EXIT

A=aaaaaaaa-1111-4222-8333-444444444444
B=bbbbbbbb-1111-4222-8333-444444444444
mkdir -p "$T/w/shop/.git" "$T/w/shop/su-code/standup" "$T/home/.local/state/8sync/hq/usage" "$T/home/.config/8sync/hq" "$T/bin"
echo "ref: refs/heads/feat/cart" >"$T/w/shop/.git/HEAD"
now=$(($(date +%s) * 1000))
today="$(date -u +%F)"
hm="$(date -u -d '-2 min' +%H:%M 2>/dev/null || date -u -v-2M +%H:%M)"
cat >"$T/w/shop/su-code/standup/$today.md" <<MD
# Họp sprint $today

| giờ | phòng | done | doing | blocked |
|---|---|---|---|---|
| $hm | aaaaaaaa | API giỏ hàng | Trang giỏ hàng | |
MD
J="$T/home/.local/state/8sync/hq/events.jsonl"
ev() { printf '%s\n' "$1" >>"$J"; }
ev "{\"v\":1,\"ts\":$((now - 600000)),\"kind\":\"session_start\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\"}"
ev "{\"v\":1,\"ts\":$((now - 590000)),\"kind\":\"session_start\",\"session_id\":\"$B\",\"cwd\":\"$W/w/shop\"}"
ev "{\"v\":1,\"ts\":$((now - 30000)),\"kind\":\"subagent_start\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"task_id\":\"ag1\",\"subject\":\"task\"}"
ev "{\"v\":1,\"ts\":$((now - 25000)),\"kind\":\"subagent_start\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"task_id\":\"ag2\",\"subject\":\"task\"}"
ev "{\"v\":1,\"ts\":$((now - 20000)),\"kind\":\"subagent_start\",\"session_id\":\"$B\",\"cwd\":\"$W/w/shop\",\"task_id\":\"ag3\",\"subject\":\"qa\"}"

# Fake 8sync: `ccc auto status --json` reads the state file; `on`/`pause` write it; everything else is empty.
cat >"$T/bin/8sync" <<SH
#!/usr/bin/env bash
S="$T/auto.state"
if [ "\$1" = ccc ] && [ "\$2" = auto ]; then
  case "\$3" in
    on) echo on >"\$S"; exit 0 ;;
    pause) echo pause >"\$S"; exit 0 ;;
    status)
      st=\$(cat "\$S" 2>/dev/null || echo off)
      on=false; paused=false
      [ "\$st" = on ] && on=true
      [ "\$st" = pause ] && paused=true
      echo "{\"schema\":1,\"on\":\$on,\"paused\":\$paused,\"idle\":\$on,\"delegate\":\$on,\"after_s\":60,\"lease_until\":$(( now / 1000 + 7200 )),\"gate\":null,\"subscription\":true}"
      exit 0 ;;
  esac
fi
[ "\$1" = ls ] && { echo "[]"; exit 0; }
echo "{}"
SH
chmod +x "$T/bin/8sync"

# PATH without claude / the real 8sync: sessions come from the seeded journal only (pnpm resolved first).
PNPM="$(command -v pnpm)"
P="$T/bin"
IFS=: read -ra parts <<<"$PATH"
for d in "${parts[@]}"; do
  [ -x "$d/claude" ] || [ -x "$d/claude.exe" ] || [ -x "$d/8sync" ] || [ -x "$d/8sync.exe" ] || P="$P:$d"
done

if [ -n "$(port_pids)" ]; then echo "port $PORT is busy (stale dev server?) — set PORT or stop it"; exit 1; fi
(cd "$APP" && HOME="$T/home" USERPROFILE="$T/home" PATH="$P" nice -n 19 "$PNPM" exec next dev -H 127.0.0.1 -p "$PORT" >"$T/dev.log" 2>&1) &
DEV=$!
for _ in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:$PORT/" || { echo "dev server did not start:"; tail -20 "$T/dev.log"; exit 1; }
node "$HERE/uat.mjs" "http://127.0.0.1:$PORT/" "$OUT" "$T/auto.state" "$T/w/shop/su-code/standup/$today.md"
