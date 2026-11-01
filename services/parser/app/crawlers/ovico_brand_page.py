from httpx import AsyncClient

from app.ovico_client import ovico_get

# Catalog Ingestion v1 (OVICO-only) - deliberately separate from
# crawlers/ovico.py's crawl_category(), which drives the existing per-SKU
# search/discovery path (link collection + N individual product-detail
# fetches). A brand page's listing HTML already carries everything v1
# needs per card (name, concentration, price, image, url, external id) -
# see OvicoBrandPageFetcher's docstring below - so there is no N+1 detail
# fetch here, and the actual field parsing deliberately lives on the
# apps/api side (see ovico-catalog/ovico-listing-parser.ts) rather than in
# this service: this repo has no Python test infrastructure at all
# (confirmed - no pytest config, no test_*.py beyond one manual script),
# while apps/api already has a proven Jest + fixture-file convention. This
# module's only job is the network fetch - reusing ovico_get() means the
# existing global 30s OVICO crawl-delay throttle applies to this request
# exactly as it does to every other OVICO request this service makes.


class OvicoBrandPageFetcher:
    BASE_URL = "https://ovico.md"

    async def fetch_brand_page_html(self, client: AsyncClient, url: str) -> str:
        response = await ovico_get(client, url)

        return response.text
