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

## Hosting

The `render.yaml` configuration publishes the repository root as a static site.