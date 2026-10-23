#!/usr/bin/env bash
# Install or update the omp router on the 8sync VPS from this repo, then check it from outside.
#   bash scripts/vps/omp-router/install.sh [ssh-host]      (default host: 8sync-vps)
# Needs: ssh with passwordless sudo and the edge stack (caddy + oauth2-proxy) on the VPS. The first
# run copies omp >= 18.12 from /home/agent/.local/bin/omp into /opt/omp-router/bin (setup.sh refuses
# older); later updates are the timer's job.
set -euo pipefail
host=${1:-8sync-vps}
here=$(cd "$(dirname "$0")" && pwd)
files=(setup.sh omp-gw omp-router-update vps-clean.sh omp-router.routes index.html)

# mktemp: a fixed /tmp name could be pre-created by another user (CI jobs run on this box) and its
# setup.sh swapped before root runs it.
d=$(ssh -o BatchMode=yes "$host" 'mktemp -d /tmp/omp-router-setup.XXXXXXXX')
(cd "$here" && scp -q -o BatchMode=yes "${files[@]}" "$host:$d/")
ssh -o BatchMode=yes "$host" "sudo sh $d/setup.sh; rc=\$?; rm -rf $d; exit \$rc"

# Checks (status read from the header dump: curl.exe on Windows prints 000 for -w %{http_code}).
status() { curl -sS -D - -o /dev/null "$@" | tr -d '\r' | awk 'NR==1 {print $2} tolower($1)=="location:" {print $2}' | paste -sd' '; }
fail=0
expect() { local want=$1 label=$2 got; shift 2; got=$(status "$@"); case "$got" in "$want"*) echo "ok   $label: $got";; *) echo "FAIL $label: $got (want $want)"; fail=1;; esac; }
expect 200 "guide is public" https://vps.8syncdev.com/omp-router/
expect "308 /omp-router/" "bare path redirects" https://vps.8syncdev.com/omp-router
expect "302 /oauth2/sign_in" "HQ still behind GitHub login" https://vps.8syncdev.com/hq/
expect "302 /oauth2/sign_in" "terminal still behind GitHub login" https://vps.8syncdev.com/term/
# Every API route with a throwaway key, from the VPS itself (check.sh; also runs alone:
# ssh 8sync-vps 'sudo bash -s' < scripts/vps/omp-router/check.sh).
ssh -o BatchMode=yes "$host" 'sudo bash -s' < "$here/check.sh" || fail=1
exit $fail
