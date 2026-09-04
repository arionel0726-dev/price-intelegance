from urllib.parse import quote

from bs4 import BeautifulSoup

from app.models import SearchResponse, SearchResultItem
from app.ovico_client import ovico_get

# Candidate discovery only - NOT a full product parser (see searchers/makeup.py
# for the same separation of concerns). Confirmed via reconnaissance
# (2026-09-03): OVICO's native Magento catalog search
# (/catalogsearch/result/?q=...) is plain server-rendered HTML, no
# anti-bot/WAF gate, no Playwright needed - same as the existing OVICO
# product parser. Every request here goes through `ovico_get`, which is the
# ONE place enforcing the mandatory 30s Crawl-delay rate limiter shared with
# the rest of the OVICO code - do not bypass it by calling the client
# directly.


class OvicoSearcher:
    BASE_URL = "https://ovico.md"

    async def search(self, client, query: str, limit: int = 5) -> SearchResponse:
        url = f"{self.BASE_URL}/catalogsearch/result/?q={quote(query)}"

        response = await ovico_get(client, url)
        soup = BeautifulSoup(response.text, "html.parser")

        results: list[SearchResultItem] = []

        for card in soup.select(".product-card")[:limit]:
            info = card.select_one(".product-card__info")
            link = card.select_one("a[href]")

            if info is None or link is None:
                continue

            external_id = info.get("data-id")
            href = link.get("href")

            if not external_id or not href:
                continue

            brand_el = card.select_one(".product-card__brand")
            name_el = card.select_one(".product-card__name")
            image_el = card.select_one("img")

            title_parts = [
                brand_el.get_text(strip=True) if brand_el else None,
                name_el.get_text(strip=True) if name_el else None,
            ]
            title = " ".join(part for part in title_parts if part).strip()

            if not title:
                continue

            results.append(
                SearchResultItem(
                    external_id=str(external_id),
                    title=title,
                    brand=brand_el.get_text(strip=True) if brand_el else None,
                    url=href,
                    image_url=image_el.get("src") if image_el else None,
                )
            )

        return SearchResponse(query=query, results=results)
