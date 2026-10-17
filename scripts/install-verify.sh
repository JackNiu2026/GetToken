#!/usr/bin/env bash
# Installs or updates the review API (/api/verify/) on the server; called by server-deploy.sh as root.
# Node.js service on 127.0.0.1:8790, data in /var/lib/gettoken-verify. Secrets live in
# /etc/gettoken/verify.env (created once, never overwritten) and /etc/gettoken/keys/.
# Exit 0: running and healthy. Exit 3: skipped (no runtime for this server). Other: failed, and
# the previous release is running again. A bundled API failure blocks website deployment.
set -euo pipefail

package=${1:?Usage: install-verify.sh PACKAGE REVISION NODE_VERSION [RUNTIME_ARCHIVE]}
revision=${2:?Missing commit SHA}
node_version=${3:?Missing Node.js version}
runtime_archive=${4:-}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
[[ "$node_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid Node.js version' >&2; exit 1; }
[[ -f "$package" ]] || { echo 'Review API package not found' >&2; exit 1; }

root=/opt/gettoken/verify
runtime="/opt/gettoken/runtime/node-$node_version-linux-x64"
previous=$(readlink -f "$root/current" || true)
switched=false

revert() {
  trap - ERR
  set +e
  if $switched; then
    if [[ -n "$previous" && -d "$previous" ]]; then
      ln -sfn "$previous" "$root/.rollback-$$" && mv -Tf "$root/.rollback-$$" "$root/current"
      systemctl restart gettoken-verify
      echo "Review API: restored the previous release $previous" >&2
    else
      systemctl stop gettoken-verify
    fi
  fi
  exit 1
}
trap revert ERR

if [[ ! -x "$runtime/bin/node" ]]; then
  if [[ ! -f "$runtime_archive" ]]; then
    echo 'Review API: Node.js runtime not available for this server, skipped' >&2
    exit 3
  fi
  mkdir -p /opt/gettoken/runtime
  tar -xJf "$runtime_archive" --no-same-owner -C /opt/gettoken/runtime
fi
if ! "$runtime/bin/node" --version >/dev/null 2>&1; then
  echo "Review API: the bundled Node.js cannot run on this server ($(ldd --version 2>&1 | head -1 || true)), skipped" >&2
  exit 3
fi

if ! id gettoken-verify >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/gettoken-verify --no-create-home --shell "$(command -v nologin || echo /bin/false)" gettoken-verify
fi
install -d -m 700 -o gettoken-verify -g gettoken-verify /var/lib/gettoken-verify
install -d -m 755 /etc/gettoken
if [[ ! -f /etc/gettoken/verify.env ]]; then
  secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  ( umask 077; printf '%s\n' '# GetToken review API. See DEPLOYMENT.md for payment settings.' \
    "VERIFY_SECRET=$secret" 'VERIFY_PAY_MODE=off' 'VERIFY_PUBLIC_ORIGIN=https://gettoken.cc' > /etc/gettoken/verify.env )
fi
chown root:root /etc/gettoken/verify.env
chmod 600 /etc/gettoken/verify.env
if [[ -d /etc/gettoken/keys ]]; then
  chown -R root:gettoken-verify /etc/gettoken/keys
  chmod 750 /etc/gettoken/keys
  find /etc/gettoken/keys -type f -exec chmod 640 {} +
fi

mkdir -p "$root/releases"
# A fresh directory per run, so re-deploying the same commit never touches the live release.
release=$(mktemp -d "$root/releases/$revision.XXXXXXXX")
tar -xzf "$package" --no-same-owner -C "$release"
test -f "$release/server/verify/server.mjs"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
chmod 755 "$release/scripts/configure-payments.sh" "$release/scripts/set-payment-opening.sh"

# Check before changing the running release. Additive schema migration is safe
# for the previous binary; existing orders must receive private recovery links.
(
  set -a
  . /etc/gettoken/verify.env
  set +a
  runuser -u gettoken-verify -- "$runtime/bin/node" --disable-warning=ExperimentalWarning "$release/server/verify/cli.mjs" access-check
  # Run as root so the initial plaintext credential stays outside the service
  # account and database directory. Existing passwords and sessions are preserved.
  "$runtime/bin/node" --disable-warning=ExperimentalWarning "$release/server/verify/bootstrap.mjs"
)

cat > /etc/systemd/system/gettoken-verify.service <<UNIT
[Unit]
Description=GetToken review verification API
After=network-online.target
Wants=network-online.target

[Service]
User=gettoken-verify
Group=gettoken-verify
EnvironmentFile=/etc/gettoken/verify.env
ExecStart=$runtime/bin/node --disable-warning=ExperimentalWarning $root/current/server/verify/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
UMask=0077
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gettoken-verify

[Install]
WantedBy=multi-user.target
UNIT
cat > /usr/local/bin/gettoken-verify <<WRAP
#!/bin/sh
# Admin tool for the review API: passwd | status | doctor | reconcile | decision
set -a
. /etc/gettoken/verify.env
set +a
exec runuser -u gettoken-verify -- $runtime/bin/node --disable-warning=ExperimentalWarning $root/current/server/verify/cli.mjs "\$@"
WRAP
chmod 755 /usr/local/bin/gettoken-verify
ln -sfn "$root/current/scripts/configure-payments.sh" /usr/local/sbin/gettoken-configure-payments
ln -sfn "$root/current/scripts/set-payment-opening.sh" /usr/local/sbin/gettoken-payment-opening

ln -sfn "$release" "$root/.current-$$"
mv -Tf "$root/.current-$$" "$root/current"
switched=true
systemctl daemon-reload
systemctl enable gettoken-verify >/dev/null 2>&1
systemctl restart gettoken-verify

health=''
for _ in $(seq 1 20); do
  health=$(curl --silent --max-time 2 http://127.0.0.1:8790/api/verify/health || true)
  if [[ "$health" == *'"ok":true'* ]]; then break; fi
  sleep 0.5
done
if [[ "$health" != *'"ok":true'* ]]; then
  journalctl -u gettoken-verify -n 30 --no-pager >&2 || true
  echo 'Review API failed its health check' >&2
  revert
fi
echo "Review API running: $health"

# Keep the five newest releases.
mapfile -t releases < <(ls -1dt "$root"/releases/*/ 2>/dev/null || true)
for old in "${releases[@]:5}"; do rm -rf "$old"; done
exit 0
