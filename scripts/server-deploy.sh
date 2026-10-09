#!/usr/bin/env bash
set -euo pipefail

archive=${1:?Usage: server-deploy.sh ARCHIVE COMMIT HOST}
revision=${2:?Missing commit SHA}
site_host=${3:?Missing site hostname}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid commit SHA'; exit 1; }
[[ "$site_host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid hostname'; exit 1; }
[[ $EUID -eq 0 ]] || { echo 'This installer needs root to configure Nginx'; exit 1; }
[[ -f "$archive" ]] || { echo 'Archive not found'; exit 1; }

exec 9>/var/lock/gettoken-deploy.lock
flock -w 120 9

if ! command -v nginx >/dev/null || ! command -v curl >/dev/null; then
  if command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y nginx curl
  elif command -v dnf >/dev/null; then
    dnf install -y nginx curl
  elif command -v yum >/dev/null; then
    yum install -y nginx curl
  else
    echo 'Install Nginx and curl with your operating system package manager first'
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
had_config=false
[[ ! -f "$config" ]] || { cp "$config" "$config_backup"; had_config=true; }
switched=false
config_changed=false
cleanup() { rm -f "$config_backup"; }
rollback() {
  trap - ERR
  set +e
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
    nginx -t && systemctl reload nginx
  fi
  echo 'Deployment failed; previous release and Nginx configuration restored.' >&2
  exit 1
}
trap cleanup EXIT
trap rollback ERR

tar -xzf "$archive" --no-same-owner -C "$stage"
test -f "$stage/index.html"
test -f "$stage/assets/gettoken/home.mjs"
test -f "$stage/assets/gettoken/home.css"
test -f "$stage/assets/gettoken/pages.css"
test -f "$stage/navigation/index.html"
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
    location ~ ^/(navigation|guides/[a-z0-9-]+)\$ {
        absolute_redirect off;
        return 301 /\$1/\$is_args\$args;
    }
    location ~ ^/(navigation|guides/[a-z0-9-]+)/index\.html\$ {
        absolute_redirect off;
        if (\$request_uri ~ "^/(navigation|guides/[a-z0-9-]+)/index\.html(?:\?.*)?\$") {
            return 301 /\$1/\$is_args\$args;
        }
        try_files \$uri =404;
        add_header Cache-Control "no-cache";
    }
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
for resource in robots.txt sitemap.xml assets/gettoken/pages.css; do
  curl --fail --silent --show-error --max-time 15 -H "Host: $site_host" "http://127.0.0.1/$resource" -o /dev/null
done
missing_status=$(curl --silent --show-error --max-time 15 -o /dev/null -w '%{http_code}' -H "Host: $site_host" http://127.0.0.1/__gettoken_seo_missing_page__/)
[[ "$missing_status" == '404' ]]
alias_headers=$(curl --silent --show-error --max-time 15 -I -H "Host: $site_host" http://127.0.0.1/navigation/index.html)
[[ "$alias_headers" == *'301'* && "$alias_headers" == *'/navigation/'* ]]
js_headers=$(curl --fail --silent --show-error --max-time 15 -I -H "Host: $site_host" http://127.0.0.1/assets/gettoken/home.mjs)
[[ "$js_headers" == *'Content-Type: application/javascript'* ]]
deployed_version=$(curl --fail --silent --show-error --max-time 15 -H "Host: $site_host" http://127.0.0.1/deployment.json)
[[ "$deployed_version" == "{\"commit\":\"$revision\"}" ]]
trap - ERR
echo "Deployed $revision to $site_root/current"
echo "Server checks passed. Open http://$site_host/ after allowing inbound TCP port 80."
