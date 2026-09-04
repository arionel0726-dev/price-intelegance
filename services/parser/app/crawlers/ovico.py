from bs4 import BeautifulSoup
from httpx import AsyncClient

from app.models import CrawledProductRef
from app.ovico_client import ovico_get

# Safety cap on pages attempted per crawl, independent of max_products.
# Out-of-range Magento page numbers wrap back to page 1's results instead of
# erroring or returning empty (verified: ?p=10 on a 6-page category returned
# the same 60 products as ?p=1) - the real stopping signal is "this page
# added zero products we hadn't already seen", not an empty page or a
# non-200 response. This cap just guards against an unforeseen pagination
# shape doing the same thing indefinitely.
MAX_PAGES = 50


class OvicoCrawler:
    BASE_URL = "https://ovico.md"

    async def crawl_category(
        self,
        client: AsyncClient,
        url: str,
        *,
        max_products: int | None = None,
    ) -> list[CrawledProductRef]:
        products: dict[str, CrawledProductRef] = {}

        page = 1

        while page <= MAX_PAGES:
            page_url = self._page_url(url, page)

            response = await ovico_get(client, page_url)

            soup = BeautifulSoup(response.text, "html.parser")

            before = len(products)

            self._collect_product_links(soup, products)

            added = len(products) - before

            print(
                "OVICO discovery page",
                page,
                ":",
                added,
                "new,",
                len(products),
                "total",
            )

            if max_products is not None and len(products) >= max_products:
                break

            # A page that adds nothing we haven't already seen means we've
            # wrapped past the last real page (Magento repeats page 1 rather
            # than returning empty) - stop here.
            if added == 0:
                break

            page += 1

        result = list(products.values())

        if max_products is not None:
            result = result[:max_products]

        return result

    def _page_url(self, base_url: str, page: int) -> str:
        separator = "&" if "?" in base_url else "?"

        return f"{base_url}{separator}p={page}"

    def _collect_product_links(
        self,
        soup: BeautifulSoup,
        products: dict[str, CrawledProductRef],
    ) -> None:
        for info in soup.select(".product-card__info[data-id]"):
            external_id = info.get("data-id")

            if not external_id or external_id in products:
                continue

            card = info.find_parent(class_="product-card") or info.parent

            link = card.find("a", href=True) if card else None

            if not link:
                continue

            products[external_id] = CrawledProductRef(
                external_id=external_id,
                url=link["href"],
            )
