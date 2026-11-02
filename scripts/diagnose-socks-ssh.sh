#!/usr/bin/env bash
set -Eeuo pipefail
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PORT:=22}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}" "${SUBSCRIPTION_HASH:?}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && "$DEPLOY_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ && "$DEPLOY_PORT" =~ ^[0-9]+$ && "$SUBSCRIPTION_HASH" =~ ^[0-9a-f]{64}$ ]]
ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
ssh -F /dev/null -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 \
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts" -p "$DEPLOY_PORT" \
  "$DEPLOY_USER@$DEPLOY_HOST" \
  "/opt/gettoken/runtime/node-v22.22.0-linux-x64/bin/node --env-file=/etc/gettoken/verify.env --disable-warning=ExperimentalWarning --input-type=module - '$SUBSCRIPTION_HASH' '202.52.109.196' '7058'" < scripts/diagnose-socks.mjs
