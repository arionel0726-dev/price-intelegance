import json
import re

from bs4 import BeautifulSoup

from app.models import ParsedProduct, ParsedVariant
from app.ovico_client import create_ovico_client, ovico_get
from app.parsers.base import ProductParser


class OvicoParser(ProductParser):
    BASE_URL = "https://ovico.md"

    async def parse_product(self, url: str) -> ParsedProduct:
        async with create_ovico_client() as client:
            return await self.parse_product_page(client, url)

    async def parse_product_page(self, client, url: str) -> ParsedProduct:
        response = await ovico_get(client, url)

        soup = BeautifulSoup(response.text, "html.parser")

        title = self._extract_title(soup)
        brand = self._extract_brand(soup)
        image_url = self._extract_image(soup)

        config = self._extract_config(soup)

        if config is not None:
            external_id = self._stringify(config.get("productId"))
            variants = self._extract_variants(config)
        else:
            # Simple (non-configurable) product: one offer, no variant matrix.
            external_id = self._extract_simple_product_id(soup)
            variants = [
                ParsedVariant(
                    external_id=external_id,
                    label=None,
                    volume=None,
                    price=self._extract_simple_price(soup),
                    available=True,
                )
            ]

        return ParsedProduct(
            competitor="ovico",
            external_id=external_id,
            title=title,
            brand=brand,
            currency="MDL",
            barcode=None,
            image_url=image_url,
            url=url,
            variants=variants,
        )

    def _stringify(self, value) -> str | None:
        if value is None:
            return None

        return str(value)

    def _extract_title(self, soup: BeautifulSoup) -> str:
        heading = soup.find("h1")

        return heading.get_text(strip=True) if heading else ""

    def _extract_brand(self, soup: BeautifulSoup) -> str | None:
        element = soup.select_one(
            ".product-page__details-brand, .product-page__info-brand-title"
        )

        if element:
            text = element.get_text(strip=True)

            return text or None

        return None

    def _extract_image(self, soup: BeautifulSoup) -> str | None:
        meta = soup.find("meta", attrs={"property": "og:image"})

        if meta:
            content = meta.get("content")

            if isinstance(content, str) and content.strip():
                return content.strip()

        return None

    # Magento renders the configurable-product option matrix (variant ids,
    # SKUs, per-variant prices, images) as one HTML-entity-encoded JSON blob
    # on a data attribute. The attribute name varies with the widget type
    # (radio swatches use `data-product`, a <select> dropdown - as seen for
    # some color/shade attributes - uses `data-product-colors`), so we match
    # by content signature rather than a fixed attribute name.
    def _extract_config(self, soup: BeautifulSoup) -> dict | None:
        for tag in soup.find_all(attrs=True):
            for attr_name, attr_value in tag.attrs.items():
                if not attr_name.startswith("data-product"):
                    continue

                if not isinstance(attr_value, str) or "optionPrices" not in attr_value:
                    continue

                try:
                    return json.loads(attr_value)
                except json.JSONDecodeError:
                    continue

        return None

    def _extract_variants(self, config: dict) -> list[ParsedVariant]:
        sku_by_variant: dict[str, str] = config.get("sku", {}) or {}
        option_prices: dict = config.get("optionPrices", {}) or {}
        attributes: dict = config.get("attributes", {}) or {}

        label_by_variant: dict[str, str] = {}
        is_volume_by_variant: dict[str, bool] = {}

        for attribute in attributes.values():
            is_volume = attribute.get("code") == "volume"

            for option in attribute.get("options", []):
                label = option.get("label")

                for variant_id in option.get("products", []):
                    label_by_variant[variant_id] = label
                    is_volume_by_variant[variant_id] = is_volume

        variants: list[ParsedVariant] = []

        for variant_id in sku_by_variant:
            price_info = option_prices.get(variant_id, {})
            final_price = price_info.get("finalPrice", {}).get("amount")

            raw_label = label_by_variant.get(variant_id)
            is_volume = is_volume_by_variant.get(variant_id, False)

            if is_volume and raw_label:
                label = self._normalize_volume_label(raw_label)
                volume = label
            else:
                label = raw_label
                volume = None

            variants.append(
                ParsedVariant(
                    external_id=variant_id,
                    label=label,
                    volume=volume,
                    price=float(final_price) if final_price is not None else None,
                    available=True,
                )
            )

        return variants

    def _normalize_volume_label(self, label: str) -> str:
        match = re.match(
            r"^\s*(\d+(?:[.,]\d+)?)\s*(ml|мл|g|г|l|л)\s*$",
            label,
            flags=re.IGNORECASE,
        )

        if not match:
            return label.strip()

        amount = match.group(1).replace(",", ".")
        unit = match.group(2).lower()

        unit_map = {"мл": "ml", "г": "g", "л": "l"}
        unit = unit_map.get(unit, unit)

        return f"{amount} {unit}"

    def _extract_simple_product_id(self, soup: BeautifulSoup) -> str | None:
        hidden_input = soup.find("input", attrs={"name": "product"})

        if hidden_input:
            value = hidden_input.get("value")

            if isinstance(value, str) and value.strip():
                return value.strip()

        code_element = soup.select_one(".product-page__details-code.sku")

        if code_element:
            key = code_element.get("data-product-key")

            if isinstance(key, str) and key.strip():
                return key.strip()

        return None

    def _extract_simple_price(self, soup: BeautifulSoup) -> float | None:
        meta = soup.find("meta", attrs={"property": "product:price:amount"})

        if meta:
            content = meta.get("content")

            if isinstance(content, str):
                try:
                    return float(content)
                except ValueError:
                    return None

        return None
