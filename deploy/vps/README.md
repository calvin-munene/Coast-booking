# CoastBookings VPS deployment

This repository is a static website. The GitHub Actions workflow deploys the
website files to an Ubuntu/Debian VPS after pushes to `main`. It does not need
Node.js, an application server, or a database on the VPS.

## 1. Prepare the VPS once

Use an existing non-root SSH account for deployments. Add a dedicated SSH public
key to that account's `~/.ssh/authorized_keys`, then run this from a checkout of
the repository on the VPS:

```sh
sudo bash deploy/vps/setup-ubuntu.sh <deploy-user> <domain-or-public-ip>
```

For example, the second argument can be `coast.example.com` or the VPS's public
IPv4 address. The setup installs Nginx and rsync, creates
`/var/www/coastbookings`, and adds a matching Nginx site. It refuses to overwrite
an unrelated non-empty web root or an existing Nginx site with the same name.
It does not disable or replace other Nginx sites.

The setup exposes the site over HTTP on port 80. Point the chosen domain's DNS
to the VPS before using the domain, and configure HTTPS separately once DNS is
working.

## 2. Configure GitHub Actions

In the GitHub repository, open **Settings → Secrets and variables → Actions**.
Add these repository secrets:

- `VPS_HOST` — the VPS's public IPv4 address or DNS hostname
- `VPS_USER` — the non-root deploy account
- `VPS_SSH_PRIVATE_KEY` — the private key matching the public key installed
  for that account
- `VPS_KNOWN_HOSTS` — the VPS host key entry, verified against the provider's
  console or another trusted source

The SSH private key belongs in GitHub Secrets, not in this repository, Replit
Secrets, or chat. Use a dedicated key that can log in only as the non-root
deploy account. The workflow skips deployment until all four secrets exist.

SSH uses port 22 by default. For another port, add a repository variable named
`VPS_SSH_PORT` in the same **Secrets and variables → Actions** area.

## 3. Automatic deployments

After the secrets are set, every push to `main` deploys the static site.
`workflow_dispatch` also allows a manual run from GitHub Actions.

The workflow syncs only the site's HTML, CSS, JavaScript, sitemap, robots file,
and assets into `/var/www/coastbookings`. It uses `rsync --delete` inside that
dedicated directory so removed website files do not remain online. Do not use
that path for another site or for files you need to keep.

## Render alongside the VPS

The repository also includes a static Render Blueprint in
[`../../render.yaml`](../../render.yaml). It builds a `dist/` directory
containing only the public website files and publishes that directory, so the
VPS scripts and repository configuration are not exposed as site content.

Connect the Render static site to this repository and enable auto-deploys from
`main`. This is independent of the VPS workflow; each provider deploys the same
static website when `main` changes.
