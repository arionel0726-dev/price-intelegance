from fastapi import FastAPI, HTTPException
from playwright.async_api import async_playwright
from pydantic import BaseModel

from app.crawlers.makeup import MakeupCrawler
from app.crawlers.ovico import OvicoCrawler
from app.crawlers.vizaje import VizajeCrawler
from app.models import (
    BatchParseFailure,
    BatchParseResult,
    CrawlResult,
    ParsedProduct,
    ParsedVizajeFamily,
    SearchBatchResponse,
    SearchResponse,
    VizajeBatchFailure,
    VizajeBatchResult,
    VizajeCrawlResult,
)
from app.ovico_client import create_ovico_client
from app.parsers.makeup import MakeupParser
from app.parsers.ovico import OvicoParser
from app.parsers.vizaje import create_vizaje_client
from app.parsers.vizaje import VizajeParser
from app.searchers.makeup import MakeupSearcher
from app.searchers.ovico import OvicoSearcher


app = FastAPI(
    title="Price Parser",
    version="0.1.0",
)


makeup_parser = MakeupParser()
makeup_crawler = MakeupCrawler()
ovico_parser = OvicoParser()
ovico_crawler = OvicoCrawler()
vizaje_parser = VizajeParser()
vizaje_crawler = VizajeCrawler()
makeup_searcher = MakeupSearcher()
ovico_searcher = OvicoSearcher()


class ParseProductRequest(BaseModel):
    url: str


class CrawlMakeupRequest(BaseModel):
    url: str
    max_products: int | None = None


class BatchParseMakeupRequest(BaseModel):
    url: str
    max_products: int | None = None


class CrawlOvicoRequest(BaseModel):
    url: str
    max_products: int | None = None


class BatchParseOvicoRequest(BaseModel):
    url: str
    max_products: int | None = None


class ParseVizajeProductRequest(BaseModel):
    url: str


class CrawlVizajeRequest(BaseModel):
    max_products: int | None = None


class BatchParseVizajeRequest(BaseModel):
    max_products: int | None = None


class SearchRequest(BaseModel):
    query: str
    limit: int = 5


class SearchBatchRequest(BaseModel):
    queries: list[str]
    limit: int = 5


@app.get("/health")
async def health():
    return {
        "status": "ok",
    }


@app.post(
    "/parse/makeup/product",
    response_model=ParsedProduct,
)
async def parse_makeup_product(
    payload: ParseProductRequest,
):
    try:
        return await makeup_parser.parse_product(
            payload.url
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/parse/ovico/product",
    response_model=ParsedProduct,
)
async def parse_ovico_product(
    payload: ParseProductRequest,
):
    try:
        return await ovico_parser.parse_product(
            payload.url
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/crawl/makeup",
    response_model=CrawlResult,
)
async def crawl_makeup(
    payload: CrawlMakeupRequest,
):
    try:
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

            products = await makeup_crawler.crawl_category(
                page,
                payload.url,
                max_products=payload.max_products,
            )

            await context.close()
            await browser.close()

        return CrawlResult(
            competitor="makeup",
            total=len(products),
            products=products,
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/parse/makeup/batch",
    response_model=BatchParseResult,
)
async def parse_makeup_batch(
    payload: BatchParseMakeupRequest,
):
    try:
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

            crawl_page = await context.new_page()

            refs = await makeup_crawler.crawl_category(
                crawl_page,
                payload.url,
                max_products=payload.max_products,
            )

            await crawl_page.close()

            products: list[ParsedProduct] = []
            failures: list[BatchParseFailure] = []

            parse_page = await context.new_page()

            for ref in refs:
                try:
                    product = await makeup_parser.parse_product_page(
                        parse_page,
                        str(ref.url),
                    )

                    products.append(product)

                except Exception as error:
                    failures.append(
                        BatchParseFailure(
                            external_id=ref.external_id,
                            url=str(ref.url),
                            error=str(error),
                        )
                    )

            await parse_page.close()
            await context.close()
            await browser.close()

        return BatchParseResult(
            competitor="makeup",
            discovered=len(refs),
            attempted=len(refs),
            succeeded=len(products),
            failed=len(failures),
            products=products,
            failures=failures,
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/crawl/ovico",
    response_model=CrawlResult,
)
async def crawl_ovico(
    payload: CrawlOvicoRequest,
):
    try:
        async with create_ovico_client() as client:
            products = await ovico_crawler.crawl_category(
                client,
                payload.url,
                max_products=payload.max_products,
            )

        return CrawlResult(
            competitor="ovico",
            total=len(products),
            products=products,
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/parse/ovico/batch",
    response_model=BatchParseResult,
)
async def parse_ovico_batch(
    payload: BatchParseOvicoRequest,
):
    try:
        async with create_ovico_client() as client:
            refs = await ovico_crawler.crawl_category(
                client,
                payload.url,
                max_products=payload.max_products,
            )

            products: list[ParsedProduct] = []
            failures: list[BatchParseFailure] = []

            for ref in refs:
                try:
                    product = await ovico_parser.parse_product_page(
                        client,
                        str(ref.url),
                    )

                    products.append(product)

                except Exception as error:
                    failures.append(
                        BatchParseFailure(
                            external_id=ref.external_id,
                            url=str(ref.url),
                            error=str(error),
                        )
                    )

        return BatchParseResult(
            competitor="ovico",
            discovered=len(refs),
            attempted=len(refs),
            succeeded=len(products),
            failed=len(failures),
            products=products,
            failures=failures,
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/parse/vizaje/product",
    response_model=ParsedVizajeFamily,
)
async def parse_vizaje_product(
    payload: ParseVizajeProductRequest,
):
    try:
        return await vizaje_parser.parse_product(
            payload.url
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/crawl/vizaje",
    response_model=VizajeCrawlResult,
)
async def crawl_vizaje(
    payload: CrawlVizajeRequest,
):
    try:
        async with create_vizaje_client() as client:
            refs = await vizaje_crawler.discover_families(
                client,
                max_products=payload.max_products,
            )

        return VizajeCrawlResult(
            total=len(refs),
            families=refs,
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/parse/vizaje/batch",
    response_model=VizajeBatchResult,
)
async def parse_vizaje_batch(
    payload: BatchParseVizajeRequest,
):
    try:
        async with create_vizaje_client() as client:
            refs = await vizaje_crawler.discover_families(
                client,
                max_products=payload.max_products,
            )

            families: list[ParsedVizajeFamily] = []
            failures: list[VizajeBatchFailure] = []

            for ref in refs:
                try:
                    family = await vizaje_parser.parse_product_page(
                        client,
                        ref.url,
                    )

                    families.append(family)

                except Exception as error:
                    failures.append(
                        VizajeBatchFailure(
                            external_id=ref.external_id,
                            url=ref.url,
                            error=str(error),
                        )
                    )

        return VizajeBatchResult(
            discovered=len(refs),
            attempted=len(refs),
            succeeded=len(families),
            failed=len(failures),
            families=families,
            failures=failures,
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/search/makeup",
    response_model=SearchResponse,
)
async def search_makeup(
    payload: SearchRequest,
):
    try:
        return await makeup_searcher.search(
            payload.query,
            limit=payload.limit,
        )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/search/makeup/batch",
    response_model=SearchBatchResponse,
)
async def search_makeup_batch(
    payload: SearchBatchRequest,
):
    try:
        results = await makeup_searcher.search_batch(
            payload.queries,
            limit=payload.limit,
        )

        return SearchBatchResponse(results=results)

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error


@app.post(
    "/search/ovico",
    response_model=SearchResponse,
)
async def search_ovico(
    payload: SearchRequest,
):
    try:
        async with create_ovico_client() as client:
            return await ovico_searcher.search(
                client,
                payload.query,
                limit=payload.limit,
            )

    except Exception as error:
        raise HTTPException(
            status_code=422,
            detail=str(error),
        ) from error