#!/usr/bin/env bash
# This branch is a temporary maintenance operation, not a website release.
set -euo pipefail
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}"
: "${DEPLOY_PORT:=22}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]]
[[ "$DEPLOY_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]
[[ "$DEPLOY_PORT" =~ ^[0-9]+$ ]]
operation=20261018-onetime-admin
ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
ssh_options=(-F /dev/null -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts")
target="$DEPLOY_USER@$DEPLOY_HOST"
remote_dir="/var/lib/gettoken-ops/$operation"
node=/opt/gettoken/runtime/node-v22.22.0-linux-x64/bin/node
ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" "test -x '$node'; install -d -m 700 '$remote_dir'"
scp "${ssh_options[@]}" -P "$DEPLOY_PORT" ops/admin-password-reset/remote.mjs "$target:$remote_dir/remote.mjs"
if [[ -f ops/admin-password-reset/payload.bin ]]; then
  scp "${ssh_options[@]}" -P "$DEPLOY_PORT" ops/admin-password-reset/payload.bin "$target:$remote_dir/payload.bin"
  ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" "$node --disable-warning=ExperimentalWarning '$remote_dir/remote.mjs' apply '$remote_dir'"
else
  ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" "$node --disable-warning=ExperimentalWarning '$remote_dir/remote.mjs' prepare '$remote_dir'"
fi
