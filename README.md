# CoastBookings

This repository's root website is a static HTML, CSS, and JavaScript site. It has
no application server, database, package installation, or build step.

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

The Render configuration in `render.yaml` points to the separate `ai-agent/`
service and is not used by this static website.