#!/usr/bin/env bash
# HQ UI must not talk to the outside world or embed Claude credentials.
set -euo pipefail
cd "$(dirname "$0")/../apps/hq-ui"
fail=0
grep_src() { grep -rnE --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=tests \
  --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.css' -e "$1" app components lib hooks next.config.ts 2>/dev/null || true; }
report() { if [ -n "$2" ]; then echo "hq-offline-check: $1" >&2; echo "$2" >&2; fail=1; fi; }

# fetch/WebSocket/EventSource aimed at a literal non-local URL
net=$(grep_src "(fetch\(|new WebSocket\(|new EventSource\()\s*[\`'\"](https?|wss?)://" \
  | grep -vE "[\`'\"](https?|wss?)://(127\.0\.0\.1|localhost|\[::1\])" || true)
report "remote network target" "$net"
report "remote fonts/scripts/CDN" "$(grep_src 'fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg\.com|jsdelivr|cdnjs')"
report "credential-looking string" "$(grep_src 'sk-ant-|ANTHROPIC_API_KEY=|CLAUDE_CODE_OAUTH_TOKEN=')"
[ "$fail" = 0 ] || exit 1
echo "hq-offline-check: OK"
