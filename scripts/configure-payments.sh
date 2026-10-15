#!/usr/bin/env bash
# Import both merchant accounts without changing frontend files; keep ordering closed.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run as root on the production server' >&2; exit 1; }
bundle=${1:?Usage: configure-payments.sh MERCHANT_BUNDLE.json}
root=/opt/gettoken/verify/current
wrapper=/usr/local/bin/gettoken-verify
[[ -f "$root/server/verify/onboard.mjs" && -x "$wrapper" ]] || { echo 'Deploy the payment backend first' >&2; exit 1; }
node_bin=$(sed -n 's/^exec runuser .* -- \([^ ]*\/bin\/node\) .*/\1/p' "$wrapper")
[[ -x "$node_bin" ]] || { echo 'Installed Node runtime not found' >&2; exit 1; }
env_file=/etc/gettoken/verify.env
keys_root=/etc/gettoken/keys
"$node_bin" --disable-warning=ExperimentalWarning "$root/server/verify/onboard.mjs" configure "$bundle" "$env_file" "$keys_root"
chown -R root:gettoken-verify "$keys_root"
find "$keys_root" -type d -exec chmod 750 {} +
find "$keys_root" -type f -exec chmod 640 {} +
backup=$(mktemp /etc/gettoken/verify.env.rollback.XXXXXXXX)
cp -p "$env_file" "$backup"
rollback() {
  trap - ERR
  cp -p "$backup" "$env_file"
  systemctl restart gettoken-verify || true
  echo 'Payment configuration failed; previous settings restored' >&2
  exit 1
}
trap rollback ERR
mv -f "$env_file.candidate" "$env_file"
chown root:root "$env_file"
chmod 600 "$env_file"
systemctl restart gettoken-verify
healthy=false
for _ in $(seq 1 20); do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8790/api/verify/health >/dev/null; then healthy=true; break; fi
  sleep 0.5
done
$healthy
"$wrapper" doctor
echo 'Both merchants installed. New orders are closed until live acceptance and activation.'
