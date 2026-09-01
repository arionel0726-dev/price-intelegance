import json
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from app.models import ParsedProduct, ParsedVariant
from app.parsers.base import ProductParser


class MakeupParser(ProductParser):
    BASE_URL = "https://makeup.md"

    async def parse_product(
        self,
        url: str,
    ) -> ParsedProduct:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True,
            )

            context = await browser.new_context(
                locale="ru-RU",
                viewport={
                    "width": 1440,
                    "height": 1000,
                },
            )

            page = await context.new_page()

            try:
                return await self.parse_product_page(
                    page,
                    url,
                )
            finally:
                await context.close()
                await browser.close()


    async def parse_product_page(
        self,
        page,
        url: str,
    ) -> ParsedProduct:
        normalized_url = self._normalize_url(
            url
        )

        response = await page.goto(
            normalized_url,
            wait_until="domcontentloaded",
            timeout=30_000,
        )

        if response is None:
            raise ValueError(
                "MAKEUP returned no response"
            )

        await page.wait_for_selector(
            "h1",
            timeout=20_000,
        )

        title = (
            await page.locator("h1")
            .first
            .inner_text()
        ).strip()

        brand = await self._extract_brand_from_page(
            page
        )

        image_url = await self._extract_image_from_page(
            page
        )

        variants = await self._extract_variants_from_page(
            page
        )

        html = await page.content()

        soup = BeautifulSoup(
            html,
            "html.parser",
        )

        return ParsedProduct(
            competitor="makeup",
            external_id=self._extract_external_id(
                soup
            ),
            title=title,
            brand=brand,
            currency="MDL",
            barcode=None,
            image_url=(
                image_url
                or self._extract_image(soup)
            ),
            url=normalized_url,
            variants=variants,
        )

    def _normalize_url(self, url: str) -> str:
        parsed = urlparse(url)

        match = re.search(
            r"/product/(\d+)/?",
            parsed.path,
        )

        if not match:
            raise ValueError(
                "Invalid MAKEUP product URL"
            )

        product_id = match.group(1)

        return (
            f"https://makeup.md/ru/product/"
            f"{product_id}/"
        )

    def _extract_external_id(
        self,
        soup: BeautifulSoup,
    ) -> str | None:
        text = soup.get_text(
            " ",
            strip=True,
        )

        patterns = [
            r"код товара:\s*(\d+)",
            r"Cod produs:\s*(\d+)",
        ]

        for pattern in patterns:
            match = re.search(
                pattern,
                text,
                flags=re.IGNORECASE,
            )

            if match:
                return match.group(1)

        return None

    def _extract_image(
        self,
        soup: BeautifulSoup,
    ) -> str | None:
        product = self._extract_json_ld(
            soup
        )

        if product:
            image = product.get("image")

            if isinstance(image, str):
                return image

            if (
                isinstance(image, list)
                and image
                and isinstance(
                    image[0],
                    str,
                )
            ):
                return image[0]

        meta = soup.find(
            "meta",
            attrs={
                "property": "og:image",
            },
        )

        if meta:
            content = meta.get(
                "content"
            )

            if isinstance(
                content,
                str,
            ):
                return content

        return None

    def _extract_brand(
        self,
        soup: BeautifulSoup,
    ) -> str | None:
        product = self._extract_json_ld(
            soup
        )

        if product:
            brand = product.get("brand")

            if isinstance(
                brand,
                dict,
            ):
                name = brand.get("name")

                if isinstance(
                    name,
                    str,
                ):
                    return name.strip()

            if isinstance(
                brand,
                str,
            ):
                return brand.strip()

        # Для MAKEUP бренд также находится
        # около product title.
        heading = soup.find("h1")

        if heading:
            previous_text = " ".join(
                heading.parent.stripped_strings
            )

            title = heading.get_text(
                " ",
                strip=True,
            )

            prefix = previous_text.split(
                title,
                1,
            )[0]

            if "/" in prefix:
                brand = (
                    prefix
                    .split("/")[-2]
                    .strip()
                )

                if brand:
                    return brand

        return None

    def _extract_availability(
        self,
        soup: BeautifulSoup,
    ) -> bool:
        text = (
            soup
            .get_text(
                " ",
                strip=True,
            )
            .lower()
        )

        available_markers = [
            "есть в наличии",
            "în stoc",
        ]

        if any(
            marker in text
            for marker
            in available_markers
        ):
            return True

        unavailable_markers = [
            "нет в наличии",
            "indisponibil",
            "nu este disponibil",
        ]

        if any(
            marker in text
            for marker
            in unavailable_markers
        ):
            return False

        return True

    def _extract_json_ld(
        self,
        soup: BeautifulSoup,
    ) -> dict | None:
        scripts = soup.find_all(
            "script",
            attrs={
                "type":
                    "application/ld+json",
            },
        )

        for script in scripts:
            content = script.string

            if not content:
                continue

            try:
                data = json.loads(
                    content
                )
            except json.JSONDecodeError:
                continue

            candidates = (
                data
                if isinstance(data, list)
                else [data]
            )

            for candidate in candidates:
                if not isinstance(
                    candidate,
                    dict,
                ):
                    continue

                if (
                    candidate.get(
                        "@type"
                    )
                    == "Product"
                ):
                    return candidate

                graph = candidate.get(
                    "@graph"
                )

                if isinstance(
                    graph,
                    list,
                ):
                    for item in graph:
                        if (
                            isinstance(
                                item,
                                dict,
                            )
                            and
                            item.get(
                                "@type"
                            )
                            == "Product"
                        ):
                            return item

        return None

    async def _extract_brand_from_page(
        self,
        page,
    ) -> str | None:
        heading = page.locator("h1").first

        parent = heading.locator(
            "xpath=.."
        )

        text = await parent.inner_text()

        title = (
            await heading.inner_text()
        ).strip()

        lines = [
            line.strip()
            for line in text.splitlines()
            if line.strip()
        ]

        for line in lines:
            if line == title:
                continue

            if line.upper() in {
                "HIT",
                "NEW",
                "TOP",
            }:
                continue

            if "/" in line:
                brand = (
                    line
                    .split("/", 1)[0]
                    .strip()
                )

                if brand:
                    return brand

        return None

    async def _extract_image_from_page(
        self,
        page,
    ) -> str | None:
        images = page.locator(
            "img[src*='i.makeup.md']"
        )

        candidates: list[
            tuple[float, str]
        ] = []

        for index in range(
            await images.count()
        ):
            image = images.nth(index)

            if not await image.is_visible():
                continue

            box = await image.bounding_box()

            if box is None:
                continue

            width = box["width"]
            height = box["height"]

            # Отбрасываем иконки и thumbnails.
            if width < 120 or height < 120:
                continue

            # Отбрасываем длинные рекламные banners.
            ratio = width / height

            if ratio > 2.5 or ratio < 0.25:
                continue

            src = await image.get_attribute(
                "src"
            )

            if not src:
                continue

            area = width * height

            candidates.append(
                (
                    area,
                    src,
                )
            )

        if not candidates:
            return None

        # Основное product image обычно
        # самое крупное изображение товара.
        candidates.sort(
            key=lambda item: item[0],
            reverse=True,
        )

        return candidates[0][1]

    async def _extract_variants_from_page(
        self,
        page,
    ) -> list[ParsedVariant]:
        offers = page.locator(
            ".ProductBuySection__variants > [itemprop='offers'][id]"
        )

        variants: list[ParsedVariant] = []

        for index in range(
            await offers.count()
        ):
            offer = offers.nth(index)

            variant_id = await offer.get_attribute(
                "id"
            )

            if not variant_id:
                continue

            name_meta = offer.locator(
                "meta[itemprop='name']"
            )

            price_meta = offer.locator(
                "meta[itemprop='price']"
            )

            if (
                await name_meta.count() == 0
                or await price_meta.count() == 0
            ):
                continue

            name = await name_meta.first.get_attribute(
                "content"
            )

            price_raw = await price_meta.first.get_attribute(
                "content"
            )

            if not name or not price_raw:
                continue

            try:
                price = float(price_raw)
            except ValueError:
                continue

            label = self._extract_variant_label(
                name
            )

            volume = self._normalize_volume(
                label
            )

            availability = offer.locator(
                "link[itemprop='availability']"
            )

            available = True

            if await availability.count() > 0:
                href = (
                    await availability
                    .first
                    .get_attribute("href")
                )

                if href:
                    available = (
                        href.rstrip("/")
                        .endswith("InStock")
                    )

            variants.append(
                ParsedVariant(
                    external_id=variant_id,
                    label=label,
                    volume=volume,
                    price=price,
                    available=available,
                )
            )

        return variants

    def _extract_variant_label(
        self,
        name: str,
    ) -> str:
        volume_match = re.search(
            r"(\d+(?:[.,]\d+)?)\s*(ml|мл|g|г)\s*$",
            name,
            flags=re.IGNORECASE,
        )

        if volume_match:
            amount = volume_match.group(1)
            unit = volume_match.group(2)

            return f"{amount} {unit}"

        # Для будущих вариантов вроде оттенков.
        if " - " in name:
            return name.rsplit(
                " - ",
                1,
            )[-1].strip()

        return name.strip()

    def _normalize_volume(
        self,
        label: str | None,
    ) -> str | None:
        if not label:
            return None

        match = re.fullmatch(
            r"\s*(\d+(?:[.,]\d+)?)\s*(ml|мл|g|г)\s*",
            label,
            flags=re.IGNORECASE,
        )

        if not match:
            return None

        amount = (
            match
            .group(1)
            .replace(",", ".")
        )

        unit = match.group(2).lower()

        if unit == "мл":
            unit = "ml"

        if unit == "г":
            unit = "g"

        return f"{amount} {unit}"