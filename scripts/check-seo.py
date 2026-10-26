#!/usr/bin/env python3
"""Dependency-free checks for the public static HTML, also run by GitHub Actions."""
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://coastbookings.org"


class Page(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.ids = set()
        self.refs = []
        self.links = []
        self.metas = {}
        self.images = []
        self.schemas = []
        self.visible = []
        self.title = ""
        self.capture_title = False
        self.hidden = None
        self.script = ""
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.tags.append(tag)
        if "id" in a:
            assert a["id"] not in self.ids, f"Duplicate ID: {a['id']}"
            self.ids.add(a["id"])
        if tag == "title":
            self.capture_title = True
        if tag in ("script", "style"):
            self.hidden = tag
            self.script = ""
            self.json_script = a.get("type") == "application/ld+json"
        if tag == "meta":
            key = a.get("name", a.get("property"))
            assert key not in self.metas, f"Duplicate meta tag: {key}"
            self.metas[key] = a.get("content", "")
        if tag == "link":
            self.links.append(a)
        if tag == "img":
            self.images.append(a)
        for key in ("src", "href"):
            if a.get(key):
                self.refs.append(a[key])
        if tag in ("img", "link") and a.get("srcset", a.get("imagesrcset")):
            self.refs.extend(part.strip().split()[0] for part in
                             a.get("srcset", a.get("imagesrcset")).split(","))

    def handle_endtag(self, tag):
        if tag == "title":
            self.capture_title = False
        if tag == self.hidden:
            if tag == "script" and self.json_script:
                self.schemas.append(json.loads(self.script))
            self.hidden = None

    def handle_data(self, data):
        if self.capture_title:
            self.title += data
        if self.hidden:
            self.script += data
        else:
            self.visible.append(data)


def check():
    pages, titles, descriptions, canonicals = {}, set(), set(), set()
    for file in sorted(ROOT.glob("*.html")):
        source = file.read_text()
        assert len(source.encode()) < 100_000, f"Bloated HTML: {file.name}"
        assert "data:image/" not in source, f"Embedded image: {file.name}"
        assert "quotes@coastbookings.org" not in source, f"Old email: {file.name}"
        assert re.search(r'<html\b[^>]*lang=', source), f"Missing language: {file.name}"
        page = Page(source)
        pages[file.name] = page
        assert page.tags.count("title") == 1 and page.title not in titles, file.name
        assert 30 <= len(page.title) <= 75, f"Title length: {file.name}"
        titles.add(page.title)
        desc = page.metas.get("description", "")
        assert 110 <= len(desc) <= 185 and desc not in descriptions, file.name
        descriptions.add(desc)
        assert page.tags.count("h1") == 1 and page.tags.count("main") == 1, file.name
        assert "noindex" not in page.metas.get("robots", ""), file.name
        expected = ORIGIN + ("/" if file.name == "index.html" else "/" + file.name)
        canonical = [a["href"] for a in page.links if a.get("rel") == "canonical"]
        assert canonical == [expected], f"Canonical: {file.name}"
        canonicals.add(expected)
        for key in ("og:title", "og:description", "og:image", "twitter:card",
                    "twitter:title", "twitter:description", "twitter:image"):
            assert page.metas.get(key), f"Missing {key}: {file.name}"
        page.refs.extend([page.metas["og:image"], page.metas["twitter:image"]])
        assert page.metas.get("og:url") == expected, file.name
        assert page.schemas, f"No structured data: {file.name}"
        nodes = [n for schema in page.schemas for n in schema.get("@graph", [schema])]
        assert any(n.get("@type") == "WebPage" and n.get("url") == expected
                   for n in nodes), file.name
        visible = re.sub(r"\s+", " ", " ".join(page.visible))
        for node in nodes:
            if node.get("@type") == "FAQPage":
                for question in node["mainEntity"]:
                    assert question["name"] in visible, file.name
                    assert question["acceptedAnswer"]["text"] in visible, file.name
        for image in page.images:
            assert "alt" in image, f"Missing alt: {file.name}"
            assert int(image.get("width", 0)) > 0 and int(image.get("height", 0)) > 0, file.name
            if not image.get("fetchpriority") == "high" and "logo" not in image.get("src", ""):
                assert image.get("loading") == "lazy", f"Image loading: {file.name}"
        print(f"PASS {file.name}: metadata, semantic HTML, images and schema")

    incoming = set()
    for name, page in pages.items():
        for ref in page.refs:
            url = urlsplit(ref)
            if url.netloc and url.netloc != urlsplit(ORIGIN).netloc:
                continue
            if url.scheme and url.scheme not in ("http", "https"):
                continue
            target = unquote(url.path).lstrip("/") or ("index.html" if url.netloc else name)
            assert ".." not in Path(target).parts, f"Unsafe local path: {ref}"
            assert (ROOT / target).exists(), f"Broken reference in {name}: {ref}"
            if target in pages:
                if target != name:
                    incoming.add(target)
                if url.fragment:
                    assert url.fragment in pages[target].ids, f"Broken anchor: {name} {ref}"
    assert set(pages) - {"index.html"} <= incoming, "Orphan HTML page"
    sitemap = ET.parse(ROOT / "sitemap.xml")
    urls = sitemap.findall("{*}url")
    locations = [u.find("{*}loc").text for u in urls]
    assert len(locations) == len(set(locations)), "Duplicate sitemap entries"
    assert set(locations) == canonicals, "Sitemap/canonical mismatch"
    robots = (ROOT / "robots.txt").read_text()
    assert f"Sitemap: {ORIGIN}/sitemap.xml" in robots and "Disallow: /" not in robots
    assert (ROOT / "assets/logo.webp").stat().st_size < 10_000, "Logo too large"
    print(f"PASS all {len(pages)} pages: local links, anchors, sitemap, robots and logo budget")


if __name__ == "__main__":
    try:
        check()
    except (AssertionError, ValueError, KeyError, ET.ParseError) as error:
        print(f"SEO CHECK FAILED: {error}", file=sys.stderr)
        sys.exit(1)
