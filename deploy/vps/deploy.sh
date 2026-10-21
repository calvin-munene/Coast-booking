#!/usr/bin/env bash
set -euo pipefail

required=(VPS_HOST VPS_USER VPS_SSH_PRIVATE_KEY VPS_KNOWN_HOSTS)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required deployment setting: $name" >&2
    exit 1
  fi
done

if [[ ! "$VPS_HOST" =~ ^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$ ]]; then
  echo "VPS_HOST must be a DNS name or IPv4 address." >&2
  exit 1
fi
if [[ ! "$VPS_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ || "$VPS_USER" == "root" ]]; then
  echo "VPS_USER must be a valid non-root Linux username." >&2
  exit 1
fi

VPS_SSH_PORT="${VPS_SSH_PORT:-22}"
if [[ ! "$VPS_SSH_PORT" =~ ^[0-9]{1,5}$ ]] || ((VPS_SSH_PORT < 1 || VPS_SSH_PORT > 65535)); then
  echo "VPS_SSH_PORT must be a TCP port from 1 to 65535." >&2
  exit 1
fi

site_dir="$RUNNER_TEMP/coastbookings-site"
if [[ ! -d "$site_dir" || ! -f "$site_dir/index.html" ]]; then
  echo "Prepared website files are missing; run the workflow preparation step first." >&2
  exit 1
fi

key_file="$(mktemp "$RUNNER_TEMP/coastbookings-key.XXXXXX")"
known_hosts_file="$(mktemp "$RUNNER_TEMP/coastbookings-known-hosts.XXXXXX")"
cleanup() {
  rm -f -- "$key_file" "$known_hosts_file"
}
trap cleanup EXIT
umask 077
printf '%s\n' "$VPS_SSH_PRIVATE_KEY" > "$key_file"
printf '%s\n' "$VPS_KNOWN_HOSTS" > "$known_hosts_file"
chmod 600 "$key_file" "$known_hosts_file"

known_host_lookup="$VPS_HOST"
if [[ "$VPS_SSH_PORT" != "22" ]]; then
  known_host_lookup="[$VPS_HOST]:$VPS_SSH_PORT"
fi
if ! ssh-keygen -F "$known_host_lookup" -f "$known_hosts_file" >/dev/null; then
  echo "VPS_KNOWN_HOSTS does not contain a matching host key for VPS_HOST and VPS_SSH_PORT." >&2
  exit 1
fi

ssh_options=(
  -i "$key_file"
  -p "$VPS_SSH_PORT"
  -o IdentitiesOnly=yes
  -o BatchMode=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$known_hosts_file"
)
remote="$VPS_USER@$VPS_HOST"

ssh "${ssh_options[@]}" "$remote" \
  'test -d /var/www/coastbookings && test ! -L /var/www/coastbookings && test -w /var/www/coastbookings && test -f /var/lib/coastbookings-vps-deploy/managed'

rsync --archive --delete --human-readable \
  --rsh="ssh -i $key_file -p $VPS_SSH_PORT -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$known_hosts_file" \
  "$site_dir/" "$remote:/var/www/coastbookings/"

echo "CoastBookings deployed to $VPS_HOST."
