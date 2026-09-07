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


class BatchParseFailure(BaseModel):
    external_id: str | None = None
    url: str
    error: str


class BatchParseResult(BaseModel):
    competitor: str

    discovered: int
    attempted: int
    succeeded: int
    failed: int

    products: list[ParsedProduct]
    failures: list[BatchParseFailure]


# ---------------------------------------------------------------------------
# Vizaje-Nica (master catalog, not a competitor) - kept separate from the
# competitor models above because the semantics genuinely differ: a Vizaje
# "family" page groups sellable SKUs (variants), each of which becomes its
# own `products` row, not a parent+offer structure.
# ---------------------------------------------------------------------------


class ParsedVizajeVariant(BaseModel):
    sku: str  # raw Vizaje/1C ID_nom, as exposed by the website

    volume: str | None = None
    color: str | None = None

    regular_price: float | None = None
    price: float | None = None  # discounted price when present, else regular

    available: bool = True

    image_url: str | None = None

    # Display/reference only - the page's visible "Артикул" value. NOT an
    # identity field (see vizaje.py's article extraction for why only one
    # variant per family ever carries this).
    article: str | None = None


class ParsedVizajeFamily(BaseModel):
    external_id: str  # website product.id (family/grouping id)

    title: str
    brand: str | None = None
    category: str | None = None
    sex: str | None = None

    canonical_url: str
    image_url: str | None = None

    variants: list[ParsedVizajeVariant]


class VizajeFamilyRef(BaseModel):
    external_id: str
    url: str


class VizajeCrawlResult(BaseModel):
    total: int
    families: list[VizajeFamilyRef]


class VizajeBatchFailure(BaseModel):
    external_id: str | None = None
    url: str
    error: str


class VizajeBatchResult(BaseModel):
    discovered: int
    attempted: int
    succeeded: int
    failed: int

    families: list[ParsedVizajeFamily]
    failures: list[VizajeBatchFailure]


# ---------------------------------------------------------------------------
# Targeted competitor search (candidate discovery, not full parsing) - see
# app/searchers/. A search result is intentionally a small subset of
# ParsedProduct's fields: enough to decide whether a URL is worth handing to
# the existing full parser, nothing more.
# ---------------------------------------------------------------------------


class SearchResultItem(BaseModel):
    external_id: str
    title: str
    brand: str | None = None
    url: str
    image_url: str | None = None


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]


class SearchBatchResponse(BaseModel):
    results: list[SearchResponse]