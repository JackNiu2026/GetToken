#!/usr/bin/env bash
set -euo pipefail

archive=${1:?Usage: server-deploy.sh ARCHIVE COMMIT HOST [NODE_VERSION]}
revision=${2:?Missing commit SHA}
site_host=${3:?Missing site hostname}
node_version=${4:-}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA'; exit 1; }
[[ "$site_host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid hostname'; exit 1; }
[[ -z "$node_version" || "$node_version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid Node.js version'; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'This installer needs root to configure Nginx'; exit 1; }
[[ -f "$archive" ]] || { echo 'Archive not found'; exit 1; }

exec 9>/var/lock/gettoken-deploy.lock
flock -w 120 9

if ! command -v nginx >/dev/null || ! command -v curl >/dev/null || ! command -v python3 >/dev/null; then
  if command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl python3
  elif command -v dnf >/dev/null; then
    dnf install -y nginx curl python3
  elif command -v yum >/dev/null; then
    yum install -y nginx curl python3
  else
    echo 'Install Nginx, curl and Python 3 with your operating system package manager first'
    exit 1
  fi
fi

site_root=/var/www/gettoken
mkdir -p "$site_root/releases"
if [[ -e "$site_root/current" && ! -L "$site_root/current" ]]; then
  echo "$site_root/current already exists and is not a release symlink"
  exit 1
fi
old_release=$(readlink -f "$site_root/current" || true)
stage=$(mktemp -d "$site_root/releases/$revision.XXXXXXXX")
config=/etc/nginx/conf.d/gettoken.conf
config_backup=$(mktemp)
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
routing_state=$(mktemp -d /tmp/gettoken-seo-routing.XXXXXXXX)
routing_changed=false
keep_routing_backup=false
had_config=false
[[ ! -f "$config" ]] || { cp "$config" "$config_backup"; had_config=true; }
switched=false
config_changed=false
verify_root=/opt/gettoken/verify
verify_old=$(readlink -f "$verify_root/current" || true)
verify_switched=false
verify_ready=false
cleanup() {
  rm -f "$config_backup"
  if ! $keep_routing_backup; then rm -rf "$routing_state"; fi
}
rollback() {
  trap - ERR
  set +e
  if $verify_switched; then
    if [[ -n "$verify_old" && -d "$verify_old" ]]; then
      ln -sfn "$verify_old" "$verify_root/.rollback-$$" && mv -Tf "$verify_root/.rollback-$$" "$verify_root/current"
      systemctl restart gettoken-verify
    else
      systemctl stop gettoken-verify
    fi
  fi
  if $switched; then
    if [[ -n "$old_release" && -d "$old_release" ]]; then
      ln -s "$old_release" "$site_root/.rollback-$$"
      mv -Tf "$site_root/.rollback-$$" "$site_root/current"
    else
      rm -f "$site_root/current"
    fi
  fi
  if $config_changed; then
    if $had_config; then cp "$config_backup" "$config"; else rm -f "$config"; fi
  fi
  if $routing_changed; then
    if ! python3 "$script_dir/configure-seo-routing.py" restore --state-dir "$routing_state"; then
      keep_routing_backup=true
      echo "Routing restore failed; private backups retained at $routing_state" >&2
    fi
  fi
  nginx -t && systemctl reload nginx
  if $keep_routing_backup; then echo 'Deployment failed; routing backup needs recovery.' >&2; exit 1; fi
  echo 'Deployment failed; previous release and Nginx configuration restored.' >&2
  exit 1
}
trap cleanup EXIT
trap rollback ERR

tar -xzf "$archive" --no-same-owner -C "$stage"
test -f "$stage/index.html"
test -f "$stage/assets/gettoken/home.mjs"
test -f "$stage/assets/gettoken/home.css"
test -f "$stage/assets/guides/guides.css"
test -f "$stage/assets/gettoken/product.css"
test -f "$stage/assets/gettoken/product.mjs"
test -f "$stage/assets/gettoken/shop.mjs"
test -f "$stage/claude/index.html"
test -f "$stage/verify/index.html"
test -f "$stage/verify/admin/index.html"
test -f "$stage/assets/gettoken/verify.mjs"
test -f "$stage/guides/index.html"
test -f "$stage/guides/feed.xml"
test -f "$stage/robots.txt"
test -f "$stage/sitemap.xml"
mapfile -t sitemap_urls < <(sed -n 's:.*<loc>\([^<]*\)</loc>.*:\1:p' "$stage/sitemap.xml")
[[ ${#sitemap_urls[@]} -gt 1 ]] || { echo 'Sitemap must include the SEO pages'; exit 1; }
seo_paths=()
for address in "${sitemap_urls[@]}"; do
  [[ "$address" == https://* ]] || { echo 'Sitemap URLs must use HTTPS'; exit 1; }
  without_scheme=${address#https://}
  route="/${without_scheme#*/}"
  [[ "$route" =~ ^/([a-z0-9-]+/)*$ ]] || { echo 'Invalid sitemap path'; exit 1; }
  test -f "$stage${route}index.html"
  seo_paths+=("$route")
done
printf '{"commit":"%s"}\n' "$revision" > "$stage/deployment.json"
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
if command -v restorecon >/dev/null; then restorecon -RF "$site_root"; fi

# Review API (/api/verify/): Node.js service on 127.0.0.1:8790, data in /var/lib/gettoken-verify.
# Secrets live in /etc/gettoken/verify.env (created once, never overwritten) and /etc/gettoken/keys/.
install_verify() {
  [[ -n "$node_version" && -f "$script_dir/verify-api.tar.gz" ]] || { echo 'Review API: no package or Node.js version, skipped' >&2; return 0; }
  local runtime="/opt/gettoken/runtime/node-$node_version-linux-x64"
  if [[ ! -x "$runtime/bin/node" ]]; then
    if [[ ! -f "$script_dir/node-runtime.tar.xz" ]]; then echo 'WARNING: Node.js runtime not available; review API not installed' >&2; return 0; fi
    mkdir -p /opt/gettoken/runtime
    tar -xJf "$script_dir/node-runtime.tar.xz" --no-same-owner -C /opt/gettoken/runtime
  fi
  if ! "$runtime/bin/node" --version >/dev/null 2>&1; then
    echo "WARNING: the bundled Node.js cannot run here ($(ldd --version 2>&1 | head -1)); review API not installed" >&2
    return 0
  fi
  if ! id gettoken-verify >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/gettoken-verify --no-create-home --shell "$(command -v nologin || echo /bin/false)" gettoken-verify
  fi
  install -d -m 700 -o gettoken-verify -g gettoken-verify /var/lib/gettoken-verify
  install -d -m 755 /etc/gettoken
  if [[ ! -f /etc/gettoken/verify.env ]]; then
    ( umask 077; printf '%s\n' '# GetToken review API. See DEPLOYMENT.md for payment settings.' \
      "VERIFY_SECRET=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" 'VERIFY_PAY_MODE=off' 'VERIFY_PUBLIC_ORIGIN=https://gettoken.cc' > /etc/gettoken/verify.env )
  fi
  chown root:root /etc/gettoken/verify.env
  chmod 600 /etc/gettoken/verify.env
  if [[ -d /etc/gettoken/keys ]]; then
    chown -R root:gettoken-verify /etc/gettoken/keys
    chmod 750 /etc/gettoken/keys
    find /etc/gettoken/keys -type f -exec chmod 640 {} +
  fi
  mkdir -p "$verify_root/releases"
  local release="$verify_root/releases/$revision"
  rm -rf "$release"
  mkdir -p "$release"
  tar -xzf "$script_dir/verify-api.tar.gz" --no-same-owner -C "$release"
  find "$release" -type d -exec chmod 755 {} +
  find "$release" -type f -exec chmod 644 {} +
  cat > /etc/systemd/system/gettoken-verify.service <<UNIT
[Unit]
Description=GetToken review verification API
After=network-online.target
Wants=network-online.target

[Service]
User=gettoken-verify
Group=gettoken-verify
EnvironmentFile=/etc/gettoken/verify.env
ExecStart=$runtime/bin/node --disable-warning=ExperimentalWarning $verify_root/current/server/verify/server.mjs
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
# Admin tool for the review API: gettoken-verify passwd | status
set -a
. /etc/gettoken/verify.env
set +a
exec runuser -u gettoken-verify -- $runtime/bin/node --disable-warning=ExperimentalWarning $verify_root/current/server/verify/cli.mjs "\$@"
WRAP
  chmod 755 /usr/local/bin/gettoken-verify
  ln -sfn "$release" "$verify_root/.current-$$"
  mv -Tf "$verify_root/.current-$$" "$verify_root/current"
  verify_switched=true
  systemctl daemon-reload
  systemctl enable gettoken-verify >/dev/null 2>&1
  systemctl restart gettoken-verify
  local health=''
  for _ in $(seq 1 20); do
    health=$(curl --silent --max-time 2 http://127.0.0.1:8790/api/verify/health || true)
    [[ "$health" == *'"ok":true'* ]] && break
    sleep 0.5
  done
  if [[ "$health" != *'"ok":true'* ]]; then
    journalctl -u gettoken-verify -n 30 --no-pager >&2 || true
    echo 'Review API failed its health check' >&2
    return 1
  fi
  verify_ready=true
  echo "Review API running: $health"
  for old in $(ls -1dt "$verify_root"/releases/* 2>/dev/null | tail -n +6); do rm -rf "$old"; done
}
install_verify

routing_changed=true
python3 "$script_dir/configure-seo-routing.py" apply --state-dir "$routing_state" \
  --root "$site_root/current" --snippet "$site_root/seo-locations.conf" \
  --source "$script_dir/nginx-seo-locations.conf"
mkdir -p /etc/nginx/conf.d
config_changed=true
cat > "$config" <<EOF
server {
    listen 80;
    server_name $site_host;
    root $site_root/current;
    index index.html;
    autoindex off;
    gzip on;
    gzip_vary on;
    gzip_types text/css application/javascript application/xml text/xml image/svg+xml;
    add_header X-Content-Type-Options nosniff always;
    location / {
        try_files \$uri \$uri/ =404;
        add_header Cache-Control "no-cache";
    }
    location ~ \.m?js\$ {
        types { application/javascript js mjs; }
        default_type application/javascript;
        try_files \$uri =404;
        add_header Cache-Control "public, max-age=300";
        add_header X-Content-Type-Options nosniff always;
    }
    location ~ /\. { deny all; }
    include $site_root/seo-locations.conf;
}
EOF
nginx -t
ln -s "$stage" "$site_root/.current-$$"
mv -Tf "$site_root/.current-$$" "$site_root/current"
switched=true
systemctl enable --now nginx
systemctl reload nginx

curl --fail --silent --show-error --max-time 15 -H "Host: $site_host" http://127.0.0.1/ -o /dev/null
curl --fail --silent --show-error --max-time 15 -H "Host: $site_host" http://127.0.0.1/assets/gettoken/home.css -o /dev/null
for route in "${seo_paths[@]}"; do
  curl --fail --silent --show-error --max-time 15 -H "Host: $site_host" "http://127.0.0.1$route" -o /dev/null
done
for resource in robots.txt sitemap.xml assets/guides/guides.css assets/gettoken/product.css assets/gettoken/product.mjs assets/gettoken/shop.mjs assets/gettoken/verify.css assets/gettoken/verify.mjs assets/gettoken/qr.mjs verify/admin/ guides/feed.xml; do
  curl --fail --silent --show-error --max-time 15 -H "Host: $site_host" "http://127.0.0.1/$resource" -o /dev/null
done
missing_status=$(curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' -H "Host: $site_host" http://127.0.0.1/__gettoken_seo_missing_page__/)
[[ "$missing_status" == '404' ]]
alias_headers=$(curl --silent --show-error --max-time 15 -I -H "Host: $site_host" http://127.0.0.1/guides/index.html)
[[ "$alias_headers" == *'301'* && "$alias_headers" == *'/guides/'* ]]
product_headers=$(curl --silent --show-error --max-time 15 -I -H "Host: $site_host" http://127.0.0.1/claude)
[[ "$product_headers" == *'301'* && "$product_headers" == *'/claude/'* ]]
retired_headers=$(curl --silent --show-error --max-time 15 -I -H "Host: $site_host" http://127.0.0.1/navigation/)
[[ "$retired_headers" == *'301'* && "$retired_headers" == *'/guides/'* ]]
js_headers=$(curl --fail --silent --show-error --max-time 15 -I -H "Host: $site_host" http://127.0.0.1/assets/gettoken/home.mjs)
[[ "$js_headers" == *'Content-Type: application/javascript'* ]]
if $verify_ready; then
  api_health=$(curl --silent --max-time 15 -H "Host: $site_host" http://127.0.0.1/api/verify/health || true)
  [[ "$api_health" == *'"ok":true'* ]] || echo "WARNING: Nginx does not forward /api/verify/ for $site_host yet; check the domain vhost includes $site_root/seo-locations.conf" >&2
fi
deployed_version=$(curl --fail --silent --show-error --max-time 15 -H "Host: $site_host" http://127.0.0.1/deployment.json)
[[ "$deployed_version" == "{\"commit\":\"$revision\"}" ]]
trap - ERR
echo "Deployed $revision to $site_root/current"
$verify_ready || echo 'NOTE: the review API is not running; /verify/ shows that the service is unavailable.'
echo "Server checks passed. Open http://$site_host/ after allowing inbound TCP port 80."
