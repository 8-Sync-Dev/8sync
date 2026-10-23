#!/bin/sh
# omp router on the 8sync VPS: `omp auth-broker` + `omp auth-gateway` as user omprouter (own vault),
# published at https://vps.8syncdev.com/omp-router (API under /v1, usage guide at the root).
# Idempotent: re-run after any change. Run as root from the folder holding these files (install.sh
# copies them).
#   /opt/omp-router/bin/omp                       the router's omp (root-owned; omp-router-update)
#   /usr/local/bin/omp-gw                         admin CLI: logins, keys, usage, status, guard
#   /usr/local/lib/8sync/omp-router-update        auto-update (24 h soak, health probe, rollback)
#   /usr/local/lib/8sync/vps-clean.sh             daily light cleanup
#   /home/omprouter/.omp/agent/agent.db           the router's vault (logins)
#   /home/omprouter/.omp/gw/clients.json          client keys (SHA-256 only), re-read every 10 s
#   /srv/sites/omp-router.routes                  Caddy routes, imported inside vps.8syncdev.com
#   /srv/www/omp-router/index.html                usage guide
# The edge stack (/srv/apps/edge: caddy + oauth2-proxy) must exist.
set -eu
src=$(cd "$(dirname "$0")" && pwd)
lib=/usr/local/lib/8sync
edge=/srv/apps/edge
sysd=/etc/systemd/system
stamp=$(date +%Y%m%d-%H%M%S)
# The router runs as its own user with its own vault: a /login in an interactive omp session of
# `agent` (the web terminal) never reaches it. Its omp lives in a root-owned dir that only
# omp-router-update replaces; the first copy comes from agent's omp.
id omprouter >/dev/null 2>&1 ||
  useradd --system --create-home --home-dir /home/omprouter --shell /usr/sbin/nologin omprouter
rhome=/home/omprouter
install -d -m 755 /opt/omp-router /opt/omp-router/bin
if [ ! -x /opt/omp-router/bin/omp ]; then
  [ -x /home/agent/.local/bin/omp ] || { echo "no omp to start from: /home/agent/.local/bin/omp missing" >&2; exit 1; }
  install -m 755 /home/agent/.local/bin/omp /opt/omp-router/bin/omp
fi
omp_router() { runuser -u omprouter -- env HOME=$rhome /opt/omp-router/bin/omp "$@"; }
# Client keys (--clients) arrived after 18.11.1; omp-router-update needs a running gateway to prove an
# update, so the first upgrade is by hand (see install.sh).
omp_router auth-gateway --help 2>&1 | grep -q -- '--clients' ||
  { echo "omp $(omp_router --version) has no auth-gateway --clients; upgrade omp first" >&2; exit 1; }

install -d -m 755 "$lib" /srv/www/omp-router
echo 'd /run/omp-gw 0755 root root -' > /etc/tmpfiles.d/omp-gw.conf
systemd-tmpfiles --create /etc/tmpfiles.d/omp-gw.conf
install -d -m 700 /var/lib/omp-router   # omp-router-update keeps database snapshots (vault keys) here
install -m 755 "$src/omp-gw" /usr/local/bin/omp-gw
install -m 755 "$src/omp-router-update" "$lib/omp-router-update"
install -m 755 "$src/vps-clean.sh" "$lib/vps-clean.sh"
install -m 644 "$src/index.html" /srv/www/omp-router/index.html
install -d -m 700 -o omprouter -g omprouter "$rhome/.omp" "$rhome/.omp/gw"
if [ ! -f "$rhome/.omp/gw/clients.json" ]; then
  if [ -f /home/agent/.omp/gw/clients.json ]; then cp /home/agent/.omp/gw/clients.json "$rhome/.omp/gw/clients.json"
  else echo '{}' > "$rhome/.omp/gw/clients.json"; fi
  chown omprouter:omprouter "$rhome/.omp/gw/clients.json"
  chmod 600 "$rhome/.omp/gw/clients.json"
fi
[ -f /etc/default/omp-router ] || cat > /etc/default/omp-router <<'EOF'
# omp-router-update: hours a release must be public before it is installed, and the model of the
# real chat request that proves an update (empty: the first chat model the gateway lists). Keep it a
# GLM Coding Plan model: Z.ai bills other models to the account balance (docs.z.ai/devpack/faq).
OMP_SOAK_HOURS=24
OMP_PROBE_MODEL=zai/glm-5.3-flash
EOF
# Pool read by the gateway. An invalid file aborts the gateway's start (fails closed), so it is
# rewritten from here on every run instead of being edited by hand.
install -d -m 755 /etc/omp-router
printf '%s\n' '{"anthropic": {"accounts": [], "apiKeys": true}}' > /etc/omp-router/account-pool.json
chmod 644 /etc/omp-router/account-pool.json

# --- systemd: slice, broker, gateway, socket + proxy, timers -------------------------------------
# No dash in the slice name: systemd nests `a-b.slice` under `a.slice`, and MemoryLow only protects
# a cgroup whose ancestors are protected too; a top-level slice sits directly under the root.
cat > "$sysd/omprouter.slice" <<'EOF'
[Unit]
Description=omp router (broker, gateway, socket proxy)
[Slice]
# Kept in RAM while a CI job sits at its 2800M cgroup cap (runner-job-hook.sh). Measured RSS on
# omp 18.12.6 (2026-10-23): broker 111-119 MiB + gateway 217-238 MiB, idle and after requests.
MemoryLow=400M
EOF
cat > "$sysd/omp-auth-broker.service" <<'EOF'
[Unit]
Description=omp auth-broker (credential vault + OAuth refresh) for the omp router
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=10
[Service]
User=omprouter
Environment=HOME=/home/omprouter
WorkingDirectory=/home/omprouter
ExecStart=/opt/omp-router/bin/omp auth-broker serve --bind=127.0.0.1:8765
Restart=always
RestartSec=3
Slice=omprouter.slice
NoNewPrivileges=yes
[Install]
WantedBy=multi-user.target
EOF
cat > "$sysd/omp-auth-gateway.service" <<'EOF'
[Unit]
Description=omp auth-gateway: OpenAI/Anthropic-compatible API at https://vps.8syncdev.com/omp-router/v1
After=network-online.target omp-auth-broker.service
Wants=omp-auth-broker.service
StartLimitIntervalSec=300
StartLimitBurst=10
[Service]
User=omprouter
Environment=HOME=/home/omprouter
Environment=OMP_AUTH_BROKER_URL=http://127.0.0.1:8765
# Account pool (docs/auth-broker-gateway.md, "Client account pools"): Anthropic OAuth accounts are
# out of the gateway's credential view, so its routes cannot use one; Anthropic API keys stay usable.
Environment=OMP_AUTH_BROKER_ACCOUNT_POOL_FILE=/etc/omp-router/account-pool.json
WorkingDirectory=/home/omprouter
# Second layer: refuses to start while an Anthropic subscription (OAuth) login is in the vault.
ExecStartPre=/usr/local/bin/omp-gw guard
ExecStart=/opt/omp-router/bin/omp auth-gateway serve --bind=127.0.0.1:4000 --trust-proxy-headers --clients=/home/omprouter/.omp/gw/clients.json
Restart=always
RestartSec=3
Slice=omprouter.slice
NoNewPrivileges=yes
[Install]
WantedBy=multi-user.target
EOF
cat > "$sysd/omp-gw.socket" <<'EOF'
[Unit]
Description=Unix socket of the omp gateway for Caddy (bind-mounted into edge-caddy-1)
[Socket]
ListenStream=/run/omp-gw/gw.sock
Service=omp-gw-proxy.service
SocketMode=0600
[Install]
WantedBy=sockets.target
EOF
cat > "$sysd/omp-gw-proxy.service" <<'EOF'
[Unit]
Description=Forward /run/omp-gw/gw.sock to the omp gateway on 127.0.0.1:4000
Requires=omp-gw.socket
After=omp-gw.socket omp-auth-gateway.service
Wants=omp-auth-gateway.service
[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd --connections-max=512 127.0.0.1:4000
DynamicUser=yes
PrivateTmp=yes
Slice=omprouter.slice
EOF
cat > "$sysd/omp-router-update.service" <<'EOF'
[Unit]
Description=Update omp when a release has soaked 24 h (health probe, rollback on failure)
After=network-online.target
[Service]
Type=oneshot
EnvironmentFile=-/etc/default/omp-router
ExecStart=/usr/local/lib/8sync/omp-router-update
TimeoutStartSec=20min
EOF
cat > "$sysd/omp-router-update.timer" <<'EOF'
[Unit]
Description=Check for a new omp release every 30 min
[Timer]
OnBootSec=10min
OnUnitActiveSec=30min
RandomizedDelaySec=2min
[Install]
WantedBy=timers.target
EOF
cat > "$sysd/8sync-vps-clean.service" <<'EOF'
[Unit]
Description=Light VPS cleanup: journald cap, apt cache, /tmp leftovers of CI and dead runners
[Service]
Type=oneshot
Nice=19
IOSchedulingClass=idle
ExecStart=/usr/local/lib/8sync/vps-clean.sh
EOF
cat > "$sysd/8sync-vps-clean.timer" <<'EOF'
[Unit]
Description=Daily light VPS cleanup (04:50 Vietnam time)
[Timer]
OnCalendar=*-*-* 21:50:00 UTC
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > "$sysd/omp-gw-guard.service" <<'EOF'
[Unit]
Description=Stop the omp gateway when a claude.ai subscription login is in the router's vault
[Service]
Type=oneshot
# omp-gw guard exits 2 only for that login; any other failure of the guard leaves the router up.
ExecStart=/bin/sh -c '/usr/local/bin/omp-gw guard >/dev/null; rc=$?; [ $rc -ne 2 ] || systemctl stop omp-auth-gateway.service; exit 0'
EOF
cat > "$sysd/omp-gw-guard.timer" <<'EOF'
[Unit]
Description=Run the omp router's Anthropic guard every minute
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=5s
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
# Journal capped for real (vps-clean.sh's daily vacuum only trims archived files).
install -d -m 755 /etc/systemd/journald.conf.d
if ! printf '[Journal]\nSystemMaxUse=100M\n' | cmp -s - /etc/systemd/journald.conf.d/8sync.conf; then
  printf '[Journal]\nSystemMaxUse=100M\n' > /etc/systemd/journald.conf.d/8sync.conf
  systemctl restart systemd-journald
fi

# One-time move from the shared vault of `agent`: copy its API-key logins (never a claude.ai
# subscription) into the router's own vault, which the broker has just created.
systemctl enable omp-auth-broker.service omp-auth-gateway.service >/dev/null
systemctl restart omp-auth-broker.service
vault=$rhome/.omp/agent/agent.db
i=0; until [ -f "$vault" ] || [ $i -ge 20 ]; do sleep 1; i=$((i + 1)); done
if [ -f /home/agent/.omp/agent/agent.db ] && [ "$(runuser -u omprouter -- python3 -c "import sqlite3; print(sqlite3.connect('$vault').execute('select count(*) from auth_credentials').fetchone()[0])")" = 0 ]; then
  systemctl stop omp-auth-broker.service
  python3 - "$vault" /home/agent/.omp/agent/agent.db <<'EOF'
import sqlite3, sys
dst = sqlite3.connect(sys.argv[1])
dst.execute("ATTACH ? AS src", (sys.argv[2],))
cols = [r[1] for r in dst.execute("PRAGMA main.table_info(auth_credentials)")]
have = {r[1] for r in dst.execute("PRAGMA src.table_info(auth_credentials)")}
cols = [c for c in cols if c in have and c != "id"]
n = dst.execute(f"INSERT INTO main.auth_credentials ({','.join(cols)}) SELECT {','.join(cols)} FROM src.auth_credentials "
                "WHERE disabled_cause IS NULL AND credential_type = 'api_key' AND provider NOT LIKE 'anthropic%'").rowcount
dst.commit()
print(f"copied {n} API-key login(s) from agent's vault into the router's")
EOF
  chown omprouter:omprouter "$vault" "$vault"-* 2>/dev/null || true
fi
systemctl restart omp-auth-broker.service omp-auth-gateway.service
systemctl enable --now omp-gw.socket omp-router-update.timer omp-gw-guard.timer 8sync-vps-clean.timer >/dev/null
i=0
until curl -fsS -m 3 http://127.0.0.1:4000/healthz >/dev/null 2>&1; do
  i=$((i + 1)); [ $i -gt 30 ] && { journalctl -u omp-auth-gateway -n 40 --no-pager; echo "gateway not up" >&2; exit 1; }
  sleep 2
done
echo "gateway up on 127.0.0.1:4000"

# --- edge: bind-mount the gateway socket dir into Caddy. The dir comes from tmpfiles.d (above), not
# from the socket unit, so it exists before Docker starts Caddy at boot and is never recreated under
# the bind mount (a recreated dir is invisible to the container, see 8sync-term.service). -----------
if ! grep -q '/run/omp-gw:/run/omp-gw' "$edge/compose.yml"; then
  cp "$edge/compose.yml" "$edge/compose.yml.bak-omp-router-$stamp"
  sed -i 's|^      - /run/8sync-hq:/run/8sync-hq$|&\n      # omp router: gateway socket (omp-gw.socket, scripts/vps/omp-router)\n      - /run/omp-gw:/run/omp-gw|' "$edge/compose.yml"
  grep -q '/run/omp-gw:/run/omp-gw' "$edge/compose.yml" || { echo "could not add the volume to $edge/compose.yml" >&2; exit 1; }
  (cd "$edge" && docker compose up -d caddy)
  rm -f "$edge/compose.yml.bak-omp-router-$stamp"
fi

# --- Caddy: `import /sites/*.routes` inside the main site once, then the routes. Validated with every
# real site file in a throwaway container; a failed reload restores the previous files. -----------
conf="$edge/conf/Caddyfile"
routes=/srv/sites/omp-router.routes
new=$(mktemp)
cp "$conf" "$new"
grep -q 'import /sites/\*\.routes' "$new" ||
  sed -i 's|^vps\.8syncdev\.com {$|&\n\t# Per-app routes inside this site: /srv/sites/<app>.routes (host) = /sites\n\timport /sites/*.routes|' "$new"
grep -q 'import /sites/\*\.routes' "$new" || { echo "could not add the routes import to $conf" >&2; exit 1; }
check=$(mktemp -d)
cp /srv/sites/* "$check/" 2>/dev/null || true
cp "$src/omp-router.routes" "$check/"
img=$(docker inspect -f '{{.Config.Image}}' edge-caddy-1)
if ! out=$(docker run --rm -v "$new:/etc/caddy/Caddyfile:ro" -v "$check:/sites:ro" "$img" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1); then
  echo "$out" | tail -5 >&2
  echo "Caddy config invalid, nothing changed" >&2
  rm -rf "$new" "$check"
  exit 1
fi
rm -rf "$check"
prev_conf="$conf.bak-omp-router-$stamp"
prev_routes=$(mktemp)
had_routes=0; [ -f "$routes" ] && { cp "$routes" "$prev_routes"; had_routes=1; }
changed=0; cmp -s "$new" "$conf" || { cp "$conf" "$prev_conf"; install -m 644 "$new" "$conf"; changed=1; }
install -m 644 "$src/omp-router.routes" "$routes"
rm -f "$new"
if ! docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  [ $changed = 1 ] && install -m 644 "$prev_conf" "$conf"
  if [ $had_routes = 1 ]; then install -m 644 "$prev_routes" "$routes"; else rm -f "$routes"; fi
  docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
  rm -f "$prev_routes"
  echo "caddy reload failed, previous config restored" >&2
  exit 1
fi
rm -f "$prev_routes" "$prev_conf"
echo "caddy reloaded"
