#!/bin/sh
# Daily light cleanup on the 8sync VPS (8sync-vps-clean.timer). Docker images and build cache are
# docker-prune.timer's job (weekly), CI caches 8sync-ci-cache-prune's (daily); this covers the rest:
# - journald (hard cap SystemMaxUse=100M is setup.sh's drop-in; this trims archives), apt's cache;
# - /tmp (tmpfs: it lives in RAM/swap) leftovers that CI jobs and dead .NET runners leave behind,
#   matched by name, older than a day, and only when no process holds them open. Sockets and dirs
#   of live sessions (tmux-*, cc-socks, claude-*, omp-*, systemd-private-*) never match.
set -u
journalctl --vacuum-size=100M >/dev/null 2>&1
apt-get clean
freed=0
for p in /tmp/encore-nsqd* /tmp/encore-test* /tmp/zus-linux-* /tmp/clr-debug-pipe-* /tmp/dotnet-diagnostic-*; do
  [ -e "$p" ] || continue
  [ -n "$(find "$p" -maxdepth 0 -mmin +1440)" ] || continue
  # .NET runner pipes carry their pid: keep them while that process lives
  pid=$(basename "$p" | sed -n 's/^\(clr-debug-pipe\|dotnet-diagnostic\)-\([0-9]*\)-.*/\2/p')
  [ -n "$pid" ] && [ -d "/proc/$pid" ] && continue
  if [ -d "$p" ]; then lsof +D "$p" >/dev/null 2>&1 && continue; else lsof -- "$p" >/dev/null 2>&1 && continue; fi
  rm -rf -- "$p" && freed=$((freed + 1))
done
echo "8sync-vps-clean: removed $freed /tmp leftovers; journal $(journalctl --disk-usage 2>/dev/null | grep -o '[0-9.]*[KMG]B*' | head -1); disk $(df -h --output=pcent / | tail -1 | tr -d ' ')"
