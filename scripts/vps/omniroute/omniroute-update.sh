#!/bin/sh
# Daily OmniRoute update (omniroute-update.timer). Pulls the image named in compose.yml; when it
# changed, recreates the container and waits for its health check. A failed start (create error or
# not healthy within 3 min) rolls back to the previous image and remembers the bad image id, so the
# same release is not retried every day. The compose tag always ends on an image that runs, so a
# later `docker compose up` (setup.sh) cannot bring the bad one back.
set -eu
# One Docker maintenance job at a time: after downtime both timers fire at boot (Persistent=true),
# and vps-clean's image prune must not run between this script's pull and a rollback.
exec 9>/run/lock/8sync-docker.lock
flock 9
dir=/srv/apps/omniroute
bad="$dir/bad-image"
cd "$dir"
img=$(docker compose config --images | head -n 1)

health() {
  # 3 min covers start-up and database migrations
  i=0
  while [ $i -lt 36 ]; do
    st=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' omniroute 2>/dev/null || echo missing)
    [ "$st" = healthy ] && return 0
    sleep 5; i=$((i + 1))
  done
  return 1
}

old=$(docker inspect -f '{{.Image}}' omniroute 2>/dev/null || echo none)
# Name the running image before pulling: on the containerd image store an image that loses its
# last tag (the pull moves the tag) can no longer be tagged by id.
if [ "$old" != none ]; then docker tag "$old" omniroute:rollback; fi
docker pull -q "$img" >/dev/null
new=$(docker image inspect -f '{{.Id}}' "$img")
if [ "$new" = "$old" ]; then echo "omniroute: up to date ($new)"; exit 0; fi
if [ -f "$bad" ] && [ "$(cat "$bad")" = "$new" ]; then
  [ "$old" != none ] && docker tag omniroute:rollback "$img"
  echo "omniroute: $new failed before, staying on $old"
  exit 0
fi

if docker compose up -d --pull never && health; then
  echo "omniroute: updated $old -> $new"
  rm -f "$bad"
  exit 0
fi

echo "omniroute: $new did not start healthy, rolling back to $old" >&2
echo "$new" > "$bad"
docker logs --tail 40 omniroute >&2 || true
if [ "$old" != none ]; then
  docker tag omniroute:rollback "$img"
  if docker compose up -d --pull never --force-recreate && health; then
    echo "omniroute: rollback ok"
  else
    echo "omniroute: rollback unhealthy" >&2
  fi
fi
exit 1
