#!/usr/bin/env bash
# End-to-end check of the omp router, run ON the VPS as root (install.sh pipes it over ssh).
# Mints a throwaway key limited to one model, calls every public route through Caddy with it, then
# revokes it and proves the revoke. Exit status = number of failed checks. Costs a few hundred tokens.
set -u
base=https://vps.8syncdev.com/omp-router
model=${OMP_PROBE_MODEL:-zai/glm-5.3-flash}   # in the GLM Coding Plan (docs.z.ai/devpack/faq)
name=check-$(date +%s)
fail=0
ok()   { echo "ok   $1"; }
bad()  { echo "FAIL $1"; fail=$((fail + 1)); }
code() { curl -s -o /dev/null -w '%{http_code}' -m 60 "$@"; }
expect() { local want=$1 label=$2 got; shift 2; got=$(code "$@"); [ "$got" = "$want" ] && ok "$label: $got" || bad "$label: $got (want $want)"; }

# --- services ----------------------------------------------------------------------------------------
for u in omp-auth-broker omp-auth-gateway omp-gw.socket omp-router-update.timer omp-gw-guard.timer 8sync-vps-clean.timer; do
  [ "$(systemctl is-active "$u")" = active ] && ok "$u active" || bad "$u not active"
done
for u in omp-auth-broker omp-auth-gateway; do
  who=$(ps -o user= -p "$(systemctl show -p MainPID --value $u)" 2>/dev/null)
  [ "$who" = omprouter ] && ok "$u runs as omprouter (own vault)" || bad "$u runs as '$who'"
done
omp-gw guard >/dev/null 2>&1 && ok "guard: no Anthropic subscription login" || bad "guard refused"
omp-gw login anthropic >/dev/null 2>&1; rc=$?
[ $rc = 1 ] && [ "$(systemctl is-active omp-auth-gateway)" = active ] && ok "omp-gw login anthropic refused, gateway untouched" || bad "omp-gw login anthropic: exit $rc"
n=$(omp-gw accounts 2>/dev/null | grep -c '^  #[0-9]* .* ok,')
[ "$n" -ge 1 ] && ok "accounts: $n healthy login(s)" || bad "accounts: no healthy login"
grep -qs '^SystemMaxUse=100M' /etc/systemd/journald.conf.d/8sync.conf && ok "journald capped at 100M" || bad "journald cap missing"
pool=$(systemctl show -p Environment --value omp-auth-gateway | tr ' ' '\n' | sed -n 's/^OMP_AUTH_BROKER_ACCOUNT_POOL_FILE=//p')
[ -n "$pool" ] && jq -e '.anthropic.accounts == []' "$pool" >/dev/null 2>&1 && ok "account pool hides Anthropic OAuth ($pool)" || bad "account pool missing on the gateway"
ver=$(curl -s -m 10 "$base/healthz")
case "$ver" in *'"ok":true'*) ok "public healthz $ver";; *) bad "public healthz: $ver";; esac

# --- auth --------------------------------------------------------------------------------------------
key=$(omp-gw key add "$name" --models "$model" | grep -o 'ogw_[A-Za-z0-9_-]*')
[ -n "$key" ] || { bad "key add printed no key"; exit $fail; }
trap 'omp-gw key rm "$name" >/dev/null 2>&1' EXIT
sleep 11   # the gateway re-reads clients.json every 10 s
auth=(-H "Authorization: Bearer $key")
json=(-H 'Content-Type: application/json')
expect 401 "no key" "$base/v1/models"
expect 401 "wrong key" -H "Authorization: Bearer ogw_wrong" "$base/v1/models"
expect 401 "key in x-api-key" -H "x-api-key: $key" "$base/v1/models"
expect 400 "key in the URL" "${auth[@]}" "$base/v1/models?key=$key"
expect 403 "client key on /v1/usage" "${auth[@]}" "$base/v1/usage"
got=$(curl -s -m 30 "${auth[@]}" "$base/v1/models" | jq -r '[.data[].id] | join(",")')
[ "$got" = "$model" ] && ok "scoped key lists only $model" || bad "scoped key lists: $got"
got=$(OMP_ROUTER_KEY=$key omp-gw models 2>&1 | awk '{print $1}' | paste -sd,)
[ "$got" = "$model" ] && ok "omp-gw models with OMP_ROUTER_KEY: $got" || bad "omp-gw models with OMP_ROUTER_KEY: $got"
expect 404 "model outside the key's list" "${auth[@]}" "${json[@]}" -d '{"model":"zai/glm-5.3","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}' "$base/v1/chat/completions"

# --- every wire format, plain and streamed ------------------------------------------------------------
ask='"Reply with the single word: ok"'
out=$(curl -s -m 120 "${auth[@]}" "${json[@]}" -d "{\"model\":\"$model\",\"max_tokens\":256,\"messages\":[{\"role\":\"user\",\"content\":$ask}]}" "$base/v1/chat/completions" | jq -r '.choices[0].message.content // empty')
[ -n "$out" ] && ok "chat completions: $out" || bad "chat completions: empty"
out=$(curl -sN -m 120 "${auth[@]}" "${json[@]}" -d "{\"model\":\"$model\",\"stream\":true,\"max_tokens\":256,\"messages\":[{\"role\":\"user\",\"content\":$ask}]}" "$base/v1/chat/completions" | grep -c '^data: ')
[ "$out" -ge 2 ] && ok "chat completions stream: $out SSE events" || bad "chat completions stream: $out events"
out=$(curl -s -m 120 "${auth[@]}" "${json[@]}" -d "{\"model\":\"$model\",\"max_tokens\":256,\"messages\":[{\"role\":\"user\",\"content\":$ask}]}" "$base/v1/messages" | jq -r '[.content[] | select(.type=="text") | .text] | join("")')
[ -n "$out" ] && ok "anthropic messages: $out" || bad "anthropic messages: empty"
out=$(curl -sN -m 120 "${auth[@]}" "${json[@]}" -d "{\"model\":\"$model\",\"stream\":true,\"max_tokens\":256,\"messages\":[{\"role\":\"user\",\"content\":$ask}]}" "$base/v1/messages" | grep -c '^event: message_stop')
[ "$out" = 1 ] && ok "anthropic messages stream: message_stop" || bad "anthropic messages stream: no message_stop"
out=$(curl -s -m 120 "${auth[@]}" "${json[@]}" -d "{\"model\":\"$model\",\"max_output_tokens\":256,\"input\":$ask}" "$base/v1/responses" | jq -r '.status')
[ "$out" = completed ] && ok "responses: $out" || bad "responses: $out"
out=$(curl -sN -m 120 "${auth[@]}" "${json[@]}" -d "{\"model\":\"$model\",\"stream\":true,\"max_output_tokens\":256,\"input\":$ask}" "$base/v1/responses" | grep -c '"type":"response.completed"')
[ "$out" = 1 ] && ok "responses stream: response.completed" || bad "responses stream: no response.completed"

# --- the gateway logged the key's name ---------------------------------------------------------------
log=/home/omprouter/.omp/logs/omp.$(date -u +%F).$(systemctl show -p MainPID --value omp-auth-gateway).log
grep -q "\"client\":\"$name\"" "$log" 2>/dev/null && ok "request log names the key ($log)" || bad "no request line for $name in $log"

# --- revoke ------------------------------------------------------------------------------------------
omp-gw key rm "$name" >/dev/null && trap - EXIT
sleep 11
expect 401 "revoked key" "${auth[@]}" "$base/v1/models"

echo "$([ $fail = 0 ] && echo 'all checks passed' || echo "$fail check(s) failed")"
exit $fail
