from pydantic import BaseModel, HttpUrl


class ParsedVariant(BaseModel):
    external_id: str | None = None
    label: str | None = None

    volume: str | None = None

    price: float | None = None
    available: bool = True

class ParsedProduct(BaseModel):
    competitor: str

    external_id: str | None = None

    title: str
    brand: str | None = None

    currency: str = "MDL"

    barcode: str | None = None

    image_url: str | None = None
    url: HttpUrl

    variants: list[ParsedVariant]

class CrawledProductRef(BaseModel):
    external_id: str
    url: HttpUrl


class CrawlResult(BaseModel):
    competitor: str
    total: int
    products: list[CrawledProductRef]