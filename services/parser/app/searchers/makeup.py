from app.models import SearchResponse, SearchResultItem

# Candidate discovery only - NOT a full product parser. Finds a small set of
# plausible MAKEUP parent-product URLs for a Vizaje product; the existing
# MakeupParser (app/parsers/makeup.py) is still what parses a chosen
# candidate's full page + variants. Keeping this logic out of the category
# crawler on purpose - crawling and targeted search are different jobs with
# different shapes (see project notes on the targeted-search milestone).


class MakeupSearcher:
    BASE_URL = "https://makeup.md"

    # The real product-search API. Confirmed via manual reconnaissance
    # (2026-09-03): plain HTTP without a browser session gets an AWS WAF
    # "challenge" response (HTTP 202, x-amzn-waf-action: challenge) - the
    # JSON itself is clean and complete, but a real browser context is
    # required to satisfy the WAF first, same as the existing product-page
    # parser's use of Playwright.
    SEARCH_API_PATH = "/shop/v1/search/products/"

    async def search(self, query: str, limit: int = 5) -> SearchResponse:
        results = await self.search_batch([query], limit)
        return results[0]

    # Reuses ONE browser session (one WAF-cleared context) across every
    # query, instead of launching a fresh browser per search. Added after a
    # real controlled-sync run showed the naive one-browser-per-search
    # version failing ~65% of searches under moderate volume (empty-body
    # responses from the search API) - a burst of many distinct "new
    # sessions" from the same IP in quick succession reads as bot-like to
    # the WAF. One session issuing many in-page fetch() calls does not.
    async def search_batch(self, queries: list[str], limit: int = 5) -> list[SearchResponse]:
        from playwright.async_api import async_playwright

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)

            context = await browser.new_context(
                locale="ru-RU",
                viewport={"width": 1440, "height": 1000},
            )

            page = await context.new_page()

            try:
                # One page load establishes the WAF session cookie for the
                # whole batch - the search API alone, with no prior
                # navigation, still gets challenged even from a real browser.
                await page.goto(
                    f"{self.BASE_URL}/",
                    wait_until="domcontentloaded",
                    timeout=30_000,
                )

                results: list[SearchResponse] = []

                for query in queries:
                    try:
                        results.append(await self._search_in_page(page, query, limit))
                    except Exception:
                        # One bad query (a transient site hiccup, a single
                        # unlucky WAF re-challenge) must not lose every other
                        # result already gathered in this batch.
                        results.append(SearchResponse(query=query, results=[]))

                return results
            finally:
                await context.close()
                await browser.close()

    async def _search_in_page(self, page, query: str, limit: int) -> SearchResponse:
        api_url = f"{self.BASE_URL}{self.SEARCH_API_PATH}?query={query}&offset=0"

        # IMPORTANT: Playwright's page.request.get() shares cookies with the
        # browser context but does NOT run through the page's own JS engine,
        # and gets the same AWS WAF "challenge" (empty 202) as plain HTTP.
        # Only a fetch() executed *inside* the page via page.evaluate() -
        # i.e. the same call path a real visitor's browser would make -
        # reliably passes the WAF. Confirmed via manual reconnaissance.
        data = await page.evaluate(
            """async (url) => {
                const res = await fetch(url, { headers: { Accept: 'application/json' } });
                if (!res.ok) {
                    throw new Error(`MAKEUP search returned ${res.status}`);
                }
                return res.json();
            }""",
            api_url,
        )

        products = data.get("products") or []

        results: list[SearchResultItem] = []

        for product in products[:limit]:
            if product.get("type") != "product":
                # Promo/banner entries ("Акция от <brand>") show up in the
                # same list for some queries - not a real product.
                continue

            brand = product.get("brand") or {}
            image_url = self._extract_image(product)

            results.append(
                SearchResultItem(
                    external_id=str(product.get("id")),
                    title=self._extract_title(product),
                    brand=brand.get("title"),
                    url=self._absolute_url(product.get("link")),
                    image_url=image_url,
                )
            )

        return SearchResponse(query=query, results=results)

    def _extract_title(self, product: dict) -> str:
        # IMPORTANT (found during reconnaissance): for some brands - notably
        # Clinique and Matis - `title` is a generic Russian category phrase
        # ("Сыворотка интеллектуальная антивозрастная") and the actual
        # distinguishing product name only appears in `subTitle` ("Clinique
        # Smart Clinical Repair Wrinkle Correcting Serum"). Most other
        # products are the reverse - `title` is the real name and `subTitle`
        # is just a type label ("Туалетная вода"). There's no reliable field
        # to tell these apart, so both are always combined here; this keeps
        # the distinguishing tokens available for the matcher either way.
        title = (product.get("title") or "").strip()
        sub_title = (product.get("subTitle") or "").strip()

        if sub_title and sub_title.lower() not in title.lower():
            return f"{title} {sub_title}".strip()

        return title

    def _extract_image(self, product: dict) -> str | None:
        media = product.get("media") or []

        if not media:
            return None

        sizes = media[0].get("sizes") or {}
        large = sizes.get("lg") or {}

        return large.get("url") or media[0].get("url")

    def _absolute_url(self, link: str | None) -> str:
        if not link:
            return self.BASE_URL

        if link.startswith("http"):
            return link

        return f"{self.BASE_URL}{link}"
