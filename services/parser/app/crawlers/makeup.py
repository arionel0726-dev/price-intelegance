import re
from urllib.parse import urljoin

from playwright.async_api import Page

from app.models import CrawledProductRef


class MakeupCrawler:
    BASE_URL = "https://makeup.md"

    PRODUCT_PATTERN = re.compile(
        r"/(?:ru/)?product/(\d+)/?"
    )

    async def crawl_category(
        self,
        page: Page,
        url: str,
        *,
        max_products: int | None = None,
    ) -> list[CrawledProductRef]:
        await page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=30_000,
        )

        await page.wait_for_timeout(1_000)

        products: dict[str, CrawledProductRef] = {}

        previous_count = -1
        stable_rounds = 0

        while True:
            await self._collect_product_links(
                page,
                products,
            )

            current_count = len(products)

            print(
                "MAKEUP discovery:",
                current_count,
                "products",
            )

            if (
                max_products is not None
                and current_count >= max_products
            ):
                break

            if current_count == previous_count:
                stable_rounds += 1
            else:
                stable_rounds = 0

            # Если после нескольких scroll вниз
            # список больше не растёт —
            # считаем категорию загруженной.
            if stable_rounds >= 3:
                break

            previous_count = current_count

            await page.evaluate(
                """
                window.scrollTo(
                    0,
                    document.body.scrollHeight
                )
                """
            )

            await page.wait_for_timeout(800)

        result = list(products.values())

        if max_products is not None:
            result = result[:max_products]

        return result

    async def _collect_product_links(
        self,
        page: Page,
        products: dict[str, CrawledProductRef],
    ) -> None:
        links = page.locator(
            "a[href*='/product/']"
        )

        for index in range(
            await links.count()
        ):
            href = await links.nth(
                index
            ).get_attribute("href")

            if not href:
                continue

            match = self.PRODUCT_PATTERN.search(
                href
            )

            if not match:
                continue

            external_id = match.group(1)

            normalized_url = (
                f"{self.BASE_URL}/ru/product/"
                f"{external_id}/"
            )

            products[external_id] = (
                CrawledProductRef(
                    external_id=external_id,
                    url=normalized_url,
                )
            )