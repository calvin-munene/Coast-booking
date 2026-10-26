# Coast Bookings search visibility

Primary domain: **https://coastbookings.org/** (confirmed by the site owner).
This is a static website: public content, links and metadata are in the HTML;
there is no database, server-side application or JavaScript rendering requirement.

## Changes implemented

- Removed the large base64 logo from the four redesigned HTML files. The logo
  now loads directly from `assets/logo.webp`, a reusable 96×96 file under 4 KB.
- Reduced those four HTML documents from about 627 KB combined to about 67 KB.
  This is an uncompressed source-size comparison, not a Core Web Vitals score.
- Added WebP photographs and 640-pixel-wide variants, native lazy loading,
  responsive `srcset`/`sizes`, image dimensions and hero image prioritization.
  Kept source photographs, visible credits and license information.
- Added consistent self-referencing canonical URLs, unique descriptions and
  search-focused titles, social metadata, semantic landmarks and structured
  Organization, WebSite, WebPage, Service and breadcrumb data.
- Added a visible accommodation FAQ with matching structured data. FAQ markup
  does not guarantee a Google rich result, and is not a ranking promise.
- Added specific rooming, meal, itinerary and quote-comparison guidance to
  existing group pages, rather than generating near-duplicate location pages.
- Made group-card links available in the original HTML and linked the university
  and tour-group pages from the homepage.
- Updated sitemap dates only because the listed pages were actually edited.
- Added Render asset-cache configuration and gzip/asset caching to the VPS
  setup template. Existing VPS servers need the corresponding Nginx settings
  applied separately; copying website files does not change a running server's
  Nginx configuration. Render Blueprint/header settings must also be applied
  by the hosting service before they affect live responses.

## Checks before future updates

Run from the repository root:

```sh
python3 scripts/check-seo.py
node --check redesign-integration.js
node --check destination-walkthrough.js
```

For optional browser smoke checks, start Chromium with a local debugging port
(`--headless --remote-debugging-port=9222`) and run
`node scripts/browser-smoke.cjs https://your-test-host`. This exercises all
16 pages at four widths, keyboard controls, no-JavaScript rendering and the
WhatsApp quote handoff without sending a message.

The SEO check also runs in GitHub Actions before the VPS deployment job, even
when VPS credentials are not configured. It checks every HTML page for image
inlining, HTML size, unique metadata, canonical consistency, broken local
references, missing image dimensions, invalid JSON-LD, orphan pages and sitemap
coverage. It also checks that FAQ schema matches visible content.

## Owner actions after the update is live

1. Verify `coastbookings.org` in Google Search Console. A domain property requires
   the DNS verification record supplied by Google; do not invent a token or put
   private credentials in this repository.
2. Submit **https://coastbookings.org/sitemap.xml**. Use URL Inspection on the
   homepage, Mombasa, Diani and school-trip pages to check Google's selected
   canonical and request indexing where appropriate.
3. Run PageSpeed Insights against the public website on mobile. Evaluate its
   lab results separately from real-user Core Web Vitals; local browser checks
   and smaller files do not prove that live LCP, INP or CLS targets are met.
4. At the hosting/domain level, verify HTTPS and consistent redirects from
   alternate hostnames. Do not serve the same site as two competing primary
   domains. Keep the canonical host consistent on both Render and the VPS.
5. If the business is eligible for a Google Business Profile, keep its real
   business details and contact information accurate. Never invent an office
   address, opening hours, hotel partnerships, ratings or customer reviews.
6. Add original trip-planning guidance and genuine case studies, photographs
   or testimonials only when permission and the underlying facts are available.
   Destination photographs are not proof of customer trips or partnerships.

Use Search Console impressions, relevant query clicks and qualified enquiries
to evaluate progress over time. No technical change guarantees a position or
an indexing deadline; relevance, competition and earned authority still matter.
