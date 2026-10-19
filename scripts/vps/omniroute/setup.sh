#!/bin/sh
# OmniRoute on the 8sync VPS + daily update and cleanup timers. Idempotent: re-run after any change.
# Run as root from the folder holding these files (install.sh copies them to /tmp/omniroute-setup).
#   /srv/apps/omniroute/{compose.yml,.env}       container, secrets generated once (600)
#   /srv/sites/router-ai.routes                  /router-ai on vps.8syncdev.com (API open, dashboard gated)
#   /usr/local/lib/8sync/{omniroute-update,vps-clean}.sh + systemd timers
# The edge stack (/srv/apps/edge: caddy + oauth2-proxy) must already exist. No port in any URL: an
# earlier :8444 dashboard site is retired here (edge compose, oauth2-proxy allowlist, ufw).
set -eu
src=$(cd "$(dirname "$0")" && pwd)
dir=/srv/apps/omniroute
lib=/usr/local/lib/8sync
edge=/srv/apps/edge
stamp=$(date +%Y%m%d-%H%M%S)

install -d -m 755 "$dir" "$lib"
install -m 644 "$src/compose.yml" "$dir/compose.yml"
install -m 755 "$src/omniroute-update.sh" "$lib/omniroute-update.sh"
install -m 755 "$src/vps-clean.sh" "$lib/vps-clean.sh"

if [ ! -f "$dir/.env" ]; then
  umask 077
  {
    echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
    echo "API_KEY_SECRET=$(openssl rand -hex 32)"
    echo "STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    echo "STORAGE_ENCRYPTION_KEY_VERSION=v1"
    echo "OMNIROUTE_WS_BRIDGE_SECRET=$(openssl rand -hex 32)"
    echo "INITIAL_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=\n')"
  } > "$dir/.env"
  chmod 600 "$dir/.env"
  umask 022
fi

cat > /etc/systemd/system/omniroute-update.service <<'EOF'
[Unit]
Description=Update OmniRoute to the latest stable image (rollback on failed health)
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/lib/8sync/omniroute-update.sh
EOF
cat > /etc/systemd/system/omniroute-update.timer <<'EOF'
[Unit]
Description=Daily OmniRoute update check (04:00 Vietnam time)
[Timer]
OnCalendar=*-*-* 21:00:00 UTC
RandomizedDelaySec=15m
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/vps-clean.service <<'EOF'
[Unit]
Description=Clean VPS junk: old unused Docker images/cache, journald, apt cache
After=docker.service
[Service]
Type=oneshot
Nice=19
IOSchedulingClass=idle
ExecStart=/usr/local/lib/8sync/vps-clean.sh
EOF
cat > /etc/systemd/system/vps-clean.timer <<'EOF'
[Unit]
Description=Daily VPS cleanup (04:40 Vietnam time)
[Timer]
OnCalendar=*-*-* 21:40:00 UTC
RandomizedDelaySec=10m
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now omniroute-update.timer vps-clean.timer >/dev/null

# Container: pull only when there is no image yet (later updates are the timer's job).
cd "$dir"
img=$(docker compose config --images | head -n 1)
docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img"
docker compose up -d --pull never
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' omniroute)" = healthy ]; do
  i=$((i + 1)); [ $i -gt 60 ] && { docker logs --tail 60 omniroute; echo "omniroute not healthy" >&2; exit 1; }
  sleep 5
done
echo "omniroute healthy"

# Edge: retire the :8444 dashboard site of the first install (port in compose, allowlist, ufw, site file).
if grep -q '8444' "$edge/compose.yml"; then
  cp "$edge/compose.yml" "$edge/compose.yml.bak-omniroute-$stamp"
  sed -i -e '/# OmniRoute dashboard (sites\/router-ai.caddy)/d' -e '/"8444:8444/d' -e 's|,vps\.8syncdev\.com:8444||' "$edge/compose.yml"
  (cd "$edge" && docker compose up -d)
fi
if ufw status | grep -q '^8444/'; then ufw delete allow 8444/tcp >/dev/null; ufw delete allow 8444/udp >/dev/null; fi
rm -f /srv/sites/router-ai.caddy

# Caddy: `import /sites/*.routes` inside the main site once, then the /router-ai routes. Validated
# with every real site file in a throwaway container; a failed reload restores the previous files.
conf="$edge/conf/Caddyfile"
routes=/srv/sites/router-ai.routes
new=$(mktemp)
cp "$conf" "$new"
grep -q 'import /sites/\*\.routes' "$new" ||
  sed -i 's|^vps\.8syncdev\.com {$|&\n\t# Per-app routes inside this site: /srv/sites/<app>.routes (host) = /sites\n\timport /sites/*.routes|' "$new"
grep -q 'import /sites/\*\.routes' "$new" || { echo "could not add the routes import to $conf" >&2; exit 1; }
check=$(mktemp -d)
cp /srv/sites/* "$check/" 2>/dev/null || true
cp "$src/router-ai.routes" "$check/"
docker run --rm -v "$new:/etc/caddy/Caddyfile:ro" -v "$check:/sites:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 ||
  { echo "Caddy config invalid, nothing changed" >&2; rm -rf "$new" "$check"; exit 1; }
rm -rf "$check"
prev_conf="$conf.bak-omniroute-$stamp"
prev_routes=$(mktemp)
had_routes=0; [ -f "$routes" ] && { cp "$routes" "$prev_routes"; had_routes=1; }
changed=0; cmp -s "$new" "$conf" || { cp "$conf" "$prev_conf"; install -m 644 "$new" "$conf"; changed=1; }
install -m 644 "$src/router-ai.routes" "$routes"
rm -f "$new"
if ! docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  [ $changed = 1 ] && install -m 644 "$prev_conf" "$conf"
  if [ $had_routes = 1 ]; then install -m 644 "$prev_routes" "$routes"; else rm -f "$routes"; fi
  docker exec edge-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || true
  rm -f "$prev_routes"
  echo "caddy reload failed, previous config restored" >&2
  exit 1
fi
rm -f "$prev_routes"
echo "caddy reloaded"
