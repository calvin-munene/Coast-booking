#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: sudo bash deploy/vps/setup-ubuntu.sh <existing-non-root-ssh-user> <domain-or-vps-ip>" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this setup script with sudo." >&2
  exit 1
fi

deploy_user="$1"
site_host="$2"

if [[ ! "$deploy_user" =~ ^[a-z_][a-z0-9_-]{0,31}$ || "$deploy_user" == "root" ]] || ! id "$deploy_user" >/dev/null 2>&1; then
  echo "The deploy user must be an existing, non-root Linux account." >&2
  exit 1
fi

host_pattern='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$'
if [[ ! "$site_host" =~ $host_pattern ]]; then
  echo "Use a DNS hostname or the VPS public IPv4 address." >&2
  exit 1
fi

web_root="/var/www/coastbookings"
nginx_site="/etc/nginx/sites-available/coastbookings"
nginx_link="/etc/nginx/sites-enabled/coastbookings"
managed_marker="/var/lib/coastbookings-vps-deploy/managed"

if [[ -L "$web_root" ]]; then
  echo "$web_root is a symlink; refusing to use an unexpected deployment path." >&2
  exit 1
fi
if [[ -d "$web_root" && ! -f "$managed_marker" ]]; then
  existing_entry="$(find "$web_root" -mindepth 1 -maxdepth 1 -print -quit)"
  if [[ -n "$existing_entry" ]]; then
    echo "$web_root is not empty and is not marked as managed by this setup; refusing to overwrite it." >&2
    exit 1
  fi
fi
if [[ ( -e "$nginx_site" || -L "$nginx_site" || -e "$nginx_link" || -L "$nginx_link" ) && ! -f "$managed_marker" ]]; then
  echo "An Nginx site named coastbookings already exists; refusing to overwrite it." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y nginx rsync

if [[ ! -f "$managed_marker" ]] && grep -R -F -q -- "$site_host" /etc/nginx/sites-enabled 2>/dev/null; then
  echo "The host $site_host appears in an enabled Nginx site; choose a unique hostname or IP." >&2
  exit 1
fi

install -d -o "$deploy_user" -g www-data -m 2755 "$web_root"
install -d -o root -g root -m 0755 /etc/nginx/sites-available /etc/nginx/sites-enabled

temporary_config="$(mktemp)"
trap 'rm -f -- "$temporary_config"' EXIT
cat > "$temporary_config" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $site_host;

    root $web_root;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/javascript application/json application/xml text/xml image/svg+xml;

    location ~* \\.(?:css|js|jpg|jpeg|png|webp|svg|ico|woff2)$ {
        expires 1d;
        try_files \$uri =404;
    }

    location / {
        try_files \$uri \$uri/ =404;
    }

    location ~ /\.(?!well-known) {
        deny all;
    }
}
EOF

install -o root -g root -m 0644 "$temporary_config" "$nginx_site"
if [[ -L "$nginx_link" && "$(readlink -f "$nginx_link")" != "$nginx_site" ]]; then
  echo "The enabled Nginx path $nginx_link points elsewhere; refusing to replace it." >&2
  exit 1
fi
ln -sfn "$nginx_site" "$nginx_link"

nginx -t
systemctl enable --now nginx
systemctl reload nginx

install -d -o root -g root -m 0755 /var/lib/coastbookings-vps-deploy
printf 'managed\n' > "$managed_marker"
chmod 0644 "$managed_marker"

echo "Nginx is configured for $site_host."
echo "Deployment directory: $web_root"
echo "The site will be available after the first successful GitHub Actions deployment."
