#!/bin/sh
# Daily VPS cleanup (vps-clean.timer). Only things that are rebuilt or re-downloaded on demand:
# unused Docker images/build cache older than 7 days, stopped containers older than 3 days,
# journald over 300 MB / 14 days, apt's package cache. CI caches have their own timer
# (8sync-ci-cache-prune); volumes and anything under /srv or /home are never touched.
set -u
exec 9>/run/lock/8sync-docker.lock
flock 9
before=$(df -B1 --output=used / | tail -1)
docker container prune -f --filter "until=72h" >/dev/null
docker image prune -af --filter "until=168h" >/dev/null
docker builder prune -af --filter "until=168h" >/dev/null 2>&1 || true
journalctl --vacuum-size=300M --vacuum-time=14d >/dev/null 2>&1
apt-get clean
after=$(df -B1 --output=used / | tail -1)
echo "vps-clean: freed $(( (before - after) / 1048576 )) MiB; disk $(df -h --output=used,size,pcent / | tail -1)"
