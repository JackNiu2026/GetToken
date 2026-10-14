#!/usr/bin/env bash
# Server-side ordering switch. Closing preserves reconciliation and refunds.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run as root on the production server' >&2; exit 1; }
mode=${1:?Usage: set-payment-opening.sh open|close}
[[ "$mode" == 'open' || "$mode" == 'close' ]] || { echo 'Expected open or close' >&2; exit 1; }
env_file=/etc/gettoken/verify.env
if [[ "$mode" == 'open' ]]; then
  /usr/local/bin/gettoken-verify doctor
  value=true
else value=false; fi
backup=$(mktemp /etc/gettoken/verify.env.opening.XXXXXXXX)
cp -p "$env_file" "$backup"
rollback() {
  trap - ERR
  cp -p "$backup" "$env_file"
  systemctl restart gettoken-verify || true
  echo 'Opening change failed; previous settings restored' >&2
  exit 1
}
trap rollback ERR
candidate="$env_file.opening-candidate"
( umask 077; sed '/^VERIFY_ACCEPT_NEW_ORDERS=/d' "$backup" > "$candidate" )
printf "VERIFY_ACCEPT_NEW_ORDERS='%s'\n" "$value" >> "$candidate"
chmod 600 "$candidate"
mv -f "$candidate" "$env_file"
systemctl restart gettoken-verify
healthy=false
for _ in $(seq 1 20); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8790/api/verify/health >/dev/null; then healthy=true; break; fi
  sleep 0.5
done
$healthy
/usr/local/bin/gettoken-verify status
