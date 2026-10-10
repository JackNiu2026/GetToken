#!/usr/bin/env bash
set -Eeuo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST or GETTOKEN_HOST}"
: "${DEPLOY_USER:?Set DEPLOY_USER or GETTOKEN_USER}"
: "${DEPLOY_PORT:=22}"
: "${DEPLOY_REVISION:?Set DEPLOY_REVISION}"
: "${DEPLOY_SSH_KEY:?Configure the GETTOKEN_SSH_KEY GitHub Actions secret}"
: "${DEPLOY_KNOWN_HOSTS:?Configure the GETTOKEN_KNOWN_HOSTS GitHub Actions secret}"

[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid host'; exit 1; }
[[ "$DEPLOY_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]] || { echo 'Invalid SSH user'; exit 1; }
[[ "$DEPLOY_PORT" =~ ^[0-9]+$ ]] && (( DEPLOY_PORT >= 1 && DEPLOY_PORT <= 65535 )) || { echo 'Invalid SSH port'; exit 1; }
[[ "$DEPLOY_REVISION" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA'; exit 1; }
[[ -f site.tar.gz && -f scripts/server-deploy.sh && -f scripts/configure-seo-routing.py && -f scripts/nginx-seo-locations.conf ]] || { echo 'Missing deployment artifact'; exit 1; }

ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
umask 077
printf '%s\n' "$DEPLOY_SSH_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
unset DEPLOY_SSH_KEY DEPLOY_KNOWN_HOSTS

ssh_options=(-F /dev/null -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts")
target="$DEPLOY_USER@$DEPLOY_HOST"
remote_dir=$(ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" 'umask 077; mktemp -d /tmp/gettoken-deploy.XXXXXXXX')
[[ "$remote_dir" =~ ^/tmp/gettoken-deploy\.[a-zA-Z0-9]+$ ]] || { echo 'Invalid remote directory'; exit 1; }
cleanup() {
  ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" "rm -rf '$remote_dir'" >/dev/null 2>&1 || true
  rm -rf "$ssh_dir"
}
trap cleanup EXIT

scp "${ssh_options[@]}" -P "$DEPLOY_PORT" site.tar.gz "$target:$remote_dir/site.tar.gz"
scp "${ssh_options[@]}" -P "$DEPLOY_PORT" scripts/server-deploy.sh "$target:$remote_dir/server-deploy.sh"
scp "${ssh_options[@]}" -P "$DEPLOY_PORT" scripts/configure-seo-routing.py scripts/nginx-seo-locations.conf "$target:$remote_dir/"
ssh "${ssh_options[@]}" -p "$DEPLOY_PORT" "$target" \
  "bash '$remote_dir/server-deploy.sh' '$remote_dir/site.tar.gz' '$DEPLOY_REVISION' '$DEPLOY_HOST'"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Deployed commit `%s`. Server checks passed.\n\nURL: http://%s/\n' "$DEPLOY_REVISION" "$DEPLOY_HOST" >> "$GITHUB_STEP_SUMMARY"
fi
