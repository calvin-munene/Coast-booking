# CoastBookings

This repository is a static HTML, CSS, and JavaScript website. It needs no
application server, database, package installation, or compiled build.

## Run locally

Serve the repository root with any static file server. For example:

```sh
python3 -m http.server 5000
```

Then open `http://localhost:5000`.

## Quote requests

The quote form validates the information in the browser and opens WhatsApp with
the request prefilled. The visitor sends the message in WhatsApp; the website
does not store or transmit requests to a database.

## Hosting on Render and a VPS

The supplied redesign is integrated in `index.html`, `mombasa.html`,
`diani.html`, and `school-trips.html`. Its logo and advertisement images are in
`assets/`; shared mobile navigation, accessibility and quote-form fixes are in
`redesign-integration.css` and `redesign-integration.js`. Other destination and
group pages remain available at their existing URLs.

Diani, Mombasa and school-trip pages include locally bundled photographs of
the actual destinations. See [`PHOTO-CREDITS.md`](PHOTO-CREDITS.md) for sources
and licenses; credits are also visible beside the images.

This is a static website and can deploy to both providers from `main`:

- **Render:** [`render.yaml`](render.yaml) configures a static site. Its build
  publishes only the website files into `dist/`, not the repository's deployment
  scripts or configuration.
- **Ubuntu/Debian VPS:** See [`deploy/vps/README.md`](deploy/vps/README.md) for
  one-time server setup and GitHub Actions secrets. Once configured, pushes to
  `main` deploy the site to the VPS.

Render auto-deploys when its static site is connected to this repository with
auto-deploy enabled. The VPS uses the GitHub Actions workflow. Neither target
requires an application server or database.