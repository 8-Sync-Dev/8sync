#!/usr/bin/env bash
# Install or update OmniRoute on the 8sync VPS from this repo, then check it end to end.
#   bash scripts/vps/omniroute/install.sh [ssh-host]      (default host: 8sync-vps)
# Needs: ssh access with passwordless sudo, the edge stack (caddy + oauth2-proxy) already on the VPS.
set -euo pipefail
host=${1:-8sync-vps}
here=$(cd "$(dirname "$0")" && pwd)
files=(compose.yml router-ai.routes omniroute-update.sh vps-clean.sh setup.sh)

ssh -o BatchMode=yes "$host" 'rm -rf /tmp/omniroute-setup && mkdir -p /tmp/omniroute-setup'
(cd "$here" && scp -q -o BatchMode=yes "${files[@]}" "$host:/tmp/omniroute-setup/")
ssh -o BatchMode=yes "$host" 'sudo sh /tmp/omniroute-setup/setup.sh && rm -rf /tmp/omniroute-setup'

# Checks (status read from the header dump: curl.exe on Windows prints 000 for -w %{http_code}).
status() { curl -sS -D - -o /dev/null "$1" | tr -d '\r' | awk 'NR==1 {print $2} tolower($1)=="location:" {print $2}' | paste -sd' '; }
fail=0
expect() { local got; got=$(status "$2"); case "$got" in "$3"*) echo "ok   $1: $got";; *) echo "FAIL $1: $got (want $3)"; fail=1;; esac; }
expect "dashboard needs GitHub login" https://vps.8syncdev.com/router-ai "302 /oauth2/sign_in?rd=https://vps.8syncdev.com/router-ai"
expect "API needs a key" https://vps.8syncdev.com/router-ai/v1/models "401"
expect "HQ link unchanged" https://vps.8syncdev.com/hq/ "302 /oauth2/sign_in"
# No port in any URL: the retired :8444 site must not answer.
if curl -sS -m 8 -o /dev/null https://vps.8syncdev.com:8444/ 2>/dev/null; then echo "FAIL port 8444 still answers"; fail=1; else echo "ok   port 8444 closed"; fi
ssh -o BatchMode=yes "$host" 'systemctl list-timers omniroute-update.timer vps-clean.timer --no-pager | head -3'
exit $fail
