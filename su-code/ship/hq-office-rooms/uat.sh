#!/usr/bin/env bash
# C8: seeded UAT in an isolated HOME (never the owner's real ~/.local/state/8sync/hq).
# Two git projects (shop on feat/cart, shop-api on main), one session each, subagents in shop,
# a message shop -> shop-api (a walk between rooms), tasks, and a status-line usage snapshot.
# `claude` is kept off PATH so the journal is the source of live sessions.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/../../../apps/hq-ui" && pwd)"
PORT="${PORT:-8752}"
OUT="${OUT:-$HERE/uat-out}"
T="$(mktemp -d)"
# Paths as node sees them (on Windows Git Bash, /tmp/... is not a path node can open).
W="$T"
command -v cygpath >/dev/null && W="$(cygpath -m "$T")"
stop_dev() {
  # The dev server is a process tree (pnpm -> node); on Windows kill it by its port.
  if command -v taskkill >/dev/null; then
    pid=$(netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && /LISTEN/ {print $NF; exit}')
    [ -n "${pid:-}" ] && taskkill //PID "$pid" //T //F >/dev/null 2>&1
  fi
  kill "${DEV:-0}" 2>/dev/null || true
  sleep 1
  rm -rf "$T" 2>/dev/null || true
}
trap stop_dev EXIT

A=aaaaaaaa-1111-4222-8333-444444444444
B=bbbbbbbb-1111-4222-8333-444444444444
mkdir -p "$T/w/shop/.git" "$T/w/shop-api/.git" "$T/home/.local/state/8sync/hq/usage" "$T/home/.config/8sync/hq"
echo "ref: refs/heads/feat/cart" >"$T/w/shop/.git/HEAD"
echo "ref: refs/heads/main" >"$T/w/shop-api/.git/HEAD"
now=$(($(date +%s) * 1000))
J="$T/home/.local/state/8sync/hq/events.jsonl"
ev() { printf '%s\n' "$1" >>"$J"; }
ev "{\"v\":1,\"ts\":$((now - 600000)),\"kind\":\"session_start\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\"}"
ev "{\"v\":1,\"ts\":$((now - 590000)),\"kind\":\"session_start\",\"session_id\":\"$B\",\"cwd\":\"$W/w/shop-api\"}"
ev "{\"v\":1,\"ts\":$((now - 30000)),\"kind\":\"subagent_start\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"task_id\":\"ag1\",\"subject\":\"reviewer\"}"
ev "{\"v\":1,\"ts\":$((now - 25000)),\"kind\":\"subagent_start\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"task_id\":\"ag2\",\"subject\":\"explore\"}"
ev "{\"v\":1,\"ts\":$((now - 20000)),\"kind\":\"subagent_start\",\"session_id\":\"$B\",\"cwd\":\"$W/w/shop-api\",\"task_id\":\"ag3\",\"subject\":\"qa\"}"
ev "{\"v\":1,\"ts\":$((now - 300000)),\"kind\":\"task_created\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"task_id\":\"1\",\"subject\":\"Giỏ hàng API\"}"
ev "{\"v\":1,\"ts\":$((now - 200000)),\"kind\":\"task_completed\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"task_id\":\"2\",\"subject\":\"Trang giỏ hàng\"}"
ev "{\"v\":1,\"ts\":$((now - 100000)),\"kind\":\"task_completed\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"task_id\":\"3\",\"subject\":\"Test giỏ hàng\"}"
ev "{\"v\":1,\"ts\":$((now - 5000)),\"kind\":\"session_message\",\"session_id\":\"$A\",\"cwd\":\"$W/w/shop\",\"from\":\"$A\",\"to\":\"$B\",\"text\":\"cần API giỏ hàng trả thêm tổng tiền\"}"
printf '{"session_id":"%s","cost_usd":1.2,"duration_ms":1500000,"lines_added":140,"lines_removed":12,"model":"claude-sonnet-5-5"}' "$A" \
  >"$T/home/.local/state/8sync/hq/usage/$A.json"

# PATH without claude / 8sync: sessions come from the seeded journal only.
P=""
IFS=: read -ra parts <<<"$PATH"
for d in "${parts[@]}"; do
  [ -x "$d/claude" ] || [ -x "$d/claude.exe" ] || [ -x "$d/8sync" ] || [ -x "$d/8sync.exe" ] || P="$P${P:+:}$d"
done

(cd "$APP" && HOME="$T/home" USERPROFILE="$T/home" PATH="$P" nice -n 19 pnpm exec next dev -H 127.0.0.1 -p "$PORT" >"$T/dev.log" 2>&1) &
DEV=$!
for _ in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:$PORT/" || { echo "dev server did not start:"; tail -20 "$T/dev.log"; exit 1; }
node "$HERE/uat.mjs" "http://127.0.0.1:$PORT/" "$OUT" --seeded "$A" "$B"
