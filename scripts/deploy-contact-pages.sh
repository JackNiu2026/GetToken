#!/usr/bin/env bash
set -Eeuo pipefail
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PORT:=22}" "${DEPLOY_SSH_KEY:?}" "${DEPLOY_KNOWN_HOSTS:?}"
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ && "$DEPLOY_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ && "$DEPLOY_PORT" =~ ^[0-9]+$ ]]
(( DEPLOY_PORT >= 1 && DEPLOY_PORT <= 65535 ))
[[ -f contact-pages.tar.gz && -f scripts/install-contact-pages.py ]]
ssh_dir=$(mktemp -d)
remote_dir=''
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS
options=(-F /dev/null -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts")
target="$DEPLOY_USER@$DEPLOY_HOST"
cleanup() {
  if [[ "$remote_dir" =~ ^/tmp/gettoken-contact\.[a-zA-Z0-9]+$ ]]; then
    ssh "${options[@]}" -p "$DEPLOY_PORT" "$target" "rm -rf '$remote_dir'" >/dev/null 2>&1 || true
  fi
  rm -rf "$ssh_dir"
}
trap cleanup EXIT
remote_dir=$(ssh "${options[@]}" -p "$DEPLOY_PORT" "$target" 'umask 077; mktemp -d /tmp/gettoken-contact.XXXXXXXX')
[[ "$remote_dir" =~ ^/tmp/gettoken-contact\.[a-zA-Z0-9]+$ ]]
scp "${options[@]}" -P "$DEPLOY_PORT" contact-pages.tar.gz "$target:$remote_dir/contact-pages.tar.gz"
scp "${options[@]}" -P "$DEPLOY_PORT" scripts/install-contact-pages.py "$target:$remote_dir/install-contact-pages.py"
ssh "${options[@]}" -p "$DEPLOY_PORT" "$target" "flock -w 120 /var/lock/gettoken-deploy.lock python3 '$remote_dir/install-contact-pages.py' '$remote_dir/contact-pages.tar.gz'"
