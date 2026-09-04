import json
import re

import httpx
from bs4 import BeautifulSoup

from app.models import ParsedVizajeFamily, ParsedVizajeVariant

BASE_URL = "https://vizaje-nica.com"

VIZAJE_USER_AGENT = (
    "PriceMonitoringBot/1.0 "
    "(+internal price comparison tool for Vizaje-Nica; low volume, respects robots.txt)"
)

REQUEST_TIMEOUT_SECONDS = 20.0

# The site suffixes every page <title>/product title with this - strip it for
# a clean product name.
_TITLE_SUFFIX_RE = re.compile(r"\s*\|\s*Vizaje-Nica\s*$", re.IGNORECASE)

# Sitemap/canonical product URLs end in /{id} when the site has no meaningful
# grouping code for that product's family (see _standalone_sku).
_TRAILING_ID_RE = re.compile(r"/(\d+)/?$")


def create_vizaje_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": VIZAJE_USER_AGENT},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def _absolute_url(path: str | None) -> str | None:
    if not path:
        return None

    if path.startswith("http://") or path.startswith("https://"):
        return path

    return f"{BASE_URL}{path}" if path.startswith("/") else f"{BASE_URL}/{path}"


def _first_image_url(images: list[dict] | None) -> str | None:
    if not images:
        return None

    src = images[0].get("src")

    return _absolute_url(src)


def _clean_title(raw_title: str) -> str:
    return _TITLE_SUFFIX_RE.sub("", raw_title).strip()


def _standalone_sku(product: dict, canonical_url: str) -> str:
    # IMPORTANT: for a standalone family, `product.sku` is NOT reliably the
    # Vizaje/1C ID_nom - it mirrors JobVN's VariativeNomenclature (the site's
    # own family/grouping code) when that code is non-empty, and only equals
    # ID_nom when there is no grouping code. Verified on real data: e.g.
    # product.sku "sparkljo42" / "VAMP!DUO" / "1502artdeco" are grouping
    # codes, while the canonical URL's trailing numeric segment (101483 /
    # 101176 / 105079) is the real ID_nom in each case. The URL is therefore
    # the more reliable source; product.sku is only a fallback for the rare
    # slug-only URL where it happens to already equal ID_nom (no grouping
    # code for that product).
    match = _TRAILING_ID_RE.search(canonical_url)
    if match:
        return match.group(1)

    return str(product.get("sku"))


def _effective_price(regular_price, discount_price) -> float | None:
    if discount_price is not None:
        return float(discount_price)

    return float(regular_price) if regular_price is not None else None


class VizajeParser:
    async def parse_product(self, url: str) -> ParsedVizajeFamily:
        async with create_vizaje_client() as client:
            return await self.parse_product_page(client, url)

    async def parse_product_page(
        self,
        client: httpx.AsyncClient,
        url: str,
    ) -> ParsedVizajeFamily:
        response = await client.get(url)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        data = self._extract_product_page_data(soup)

        if data is None:
            raise ValueError(f"No #product-page-data JSON found on {url}")

        product = data.get("product") or {}
        raw_variations = data.get("variations") or []

        canonical_url = self._extract_canonical_url(soup) or url
        parent_image = _first_image_url(product.get("images"))
        meta_fields = self._extract_meta_fields(soup)

        if raw_variations:
            variants = [
                self._build_variant(v, parent_image) for v in raw_variations
            ]
        else:
            # Standalone family: the JSON has no variations[] entry, so
            # synthesize the single sellable SKU from the parent product
            # fields directly. Availability isn't in `product`, so fall
            # back to the JSON-LD Offer.availability for this one case.
            available = self._extract_jsonld_availability(soup)

            variants = [
                ParsedVizajeVariant(
                    sku=_standalone_sku(product, canonical_url),
                    volume=(product.get("volume") or None),
                    color=None,
                    regular_price=(
                        float(product["price"])
                        if product.get("price") is not None
                        else None
                    ),
                    price=_effective_price(
                        product.get("price"), product.get("discountPrice")
                    ),
                    available=available,
                    image_url=parent_image,
                )
            ]

        return ParsedVizajeFamily(
            external_id=str(product.get("id")),
            title=_clean_title(product.get("title") or ""),
            brand=product.get("brand") or None,
            category=product.get("category") or None,
            sex=meta_fields.get("Пол"),
            canonical_url=canonical_url,
            image_url=parent_image,
            variants=variants,
        )

    def _build_variant(
        self,
        raw: dict,
        parent_image: str | None,
    ) -> ParsedVizajeVariant:
        image_url = None

        if raw.get("hasOwnImages"):
            image_url = _first_image_url(raw.get("images"))

        if not image_url:
            image_url = parent_image

        return ParsedVizajeVariant(
            sku=str(raw.get("sku")),
            volume=(raw.get("volume") or None),
            color=(raw.get("color") or None),
            regular_price=(
                float(raw["price"]) if raw.get("price") is not None else None
            ),
            price=_effective_price(raw.get("price"), raw.get("discountPrice")),
            available=bool(raw.get("available", True)),
            image_url=image_url,
        )

    def _extract_product_page_data(self, soup: BeautifulSoup) -> dict | None:
        tag = soup.find("script", id="product-page-data")

        if not tag or not tag.string:
            return None

        try:
            return json.loads(tag.string)
        except json.JSONDecodeError:
            return None

    def _extract_canonical_url(self, soup: BeautifulSoup) -> str | None:
        link = soup.find("link", rel="canonical")

        if link and link.get("href"):
            return link["href"].strip()

        return None

    # Reads the <dl class="product-meta"> key/value rows (Артикул, Штрих код,
    # Пол, ...). Only "Пол" is currently used (family-level sex) - Артикул
    # and Штрих код are intentionally NOT relied on here: they reflect
    # whichever single variant the server happened to render for this
    # specific URL, not the full variant set, and barcode enrichment for
    # every variant is handled separately (via JobVN ID_nom lookup, not by
    # scraping this row).
    def _extract_meta_fields(self, soup: BeautifulSoup) -> dict[str, str]:
        fields: dict[str, str] = {}

        for row in soup.select(".product-meta__row"):
            dt = row.find("dt")
            dd = row.find("dd")

            if not dt or not dd:
                continue

            key = dt.get_text(strip=True).rstrip(":").strip()
            value = dd.get_text(strip=True)

            if key and value:
                fields[key] = value

        return fields

    def _extract_jsonld_availability(self, soup: BeautifulSoup) -> bool:
        for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
            if not tag.string:
                continue

            try:
                data = json.loads(tag.string)
            except json.JSONDecodeError:
                continue

            graph = data.get("@graph") if isinstance(data, dict) else None

            if not isinstance(graph, list):
                continue

            for node in graph:
                if not isinstance(node, dict) or node.get("@type") != "Product":
                    continue

                offers = node.get("offers")

                if isinstance(offers, dict):
                    availability = offers.get("availability", "")

                    return "OutOfStock" not in availability

        return True
