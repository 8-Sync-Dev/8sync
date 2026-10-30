#!/usr/bin/env bash
# UAT (no model, free): `8sync watchdog install` registers the CPU/RAM/GPU guard with the OS service
# manager (Windows Scheduled Task, macOS launch agent), the guard starts by itself, and
# `8sync watchdog status` reports it running; then `uninstall` removes it and the guard stops.
# Uses the runner's real HOME (the service manager runs as this user). CI only: it replaces any
# watchdog already installed for this user.
# Usage: scripts/uat/watchdog-service.sh [path/to/8sync]   Exit 0 = pass.
set -uo pipefail
case "$(uname -s)" in
  Darwin | MINGW* | MSYS* | CYGWIN*) ;;
  *) echo "skipped: Windows/macOS only (Linux needs a user systemd session)"; exit 2 ;;
esac
B="${1:-target/debug/8sync}"
[ -f "$B" ] || [ -f "$B.exe" ] || { echo "missing $B"; exit 2; }
fail=0
"$B" watchdog install || { echo "FAIL: install"; exit 1; }
ok=""
for _ in $(seq 1 30); do
  if "$B" watchdog status | grep -q '^guard     running'; then ok=1; break; fi
  sleep 2
done
"$B" watchdog status
[ -n "$ok" ] && echo "PASS: guard running after install" || { echo "FAIL: guard not running within 60 s"; fail=1; }
"$B" watchdog uninstall || { echo "FAIL: uninstall"; fail=1; }
gone=""
for _ in $(seq 1 10); do
  if "$B" watchdog status | grep -q '^guard     not running'; then gone=1; break; fi
  sleep 1
done
[ -n "$gone" ] && echo "PASS: guard stopped after uninstall" || { echo "FAIL: guard still running after uninstall"; fail=1; }
exit $fail
