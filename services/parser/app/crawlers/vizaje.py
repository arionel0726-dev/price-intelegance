import re

import httpx

from app.models import VizajeFamilyRef

SITEMAP_URL = "https://vizaje-nica.com/sitemap.xml"

_LOC_RE = re.compile(r"<loc>(.*?)</loc>")

# Product-family pages: /ru/katalog/{category-slug}/{id-or-slug} - exactly
# one more path segment than a category listing page
# (/ru/katalog/{category-slug}). Excludes RO duplicates, news, brands, and
# every other non-catalog sitemap entry.
_PRODUCT_PATH_RE = re.compile(r"^https://vizaje-nica\.com/ru/katalog/[^/]+/[^/]+$")


class VizajeCrawler:
    async def discover_families(
        self,
        client: httpx.AsyncClient,
        *,
        max_products: int | None = None,
    ) -> list[VizajeFamilyRef]:
        response = await client.get(SITEMAP_URL)
        response.raise_for_status()

        refs: list[VizajeFamilyRef] = []
        seen_urls: set[str] = set()

        for url in _LOC_RE.findall(response.text):
            url = url.strip()

            if not _PRODUCT_PATH_RE.match(url):
                continue

            if url in seen_urls:
                continue

            seen_urls.add(url)

            # Discovery-time reference only - the real family id (JSON
            # product.id) is only known once the page is actually parsed.
            slug_id = url.rsplit("/", 1)[-1]

            refs.append(VizajeFamilyRef(external_id=slug_id, url=url))

            if max_products is not None and len(refs) >= max_products:
                break

        return refs
