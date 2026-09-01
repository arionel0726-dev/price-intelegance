from fastapi import FastAPI, HTTPException
from playwright.async_api import async_playwright
from pydantic import BaseModel

from app.crawlers.makeup import MakeupCrawler
from app.models import CrawlResult, ParsedProduct
from app.parsers.makeup import MakeupParser


app = FastAPI(
    title="Price Parser",
    version="0.1.0",
)


makeup_parser = MakeupParser()
makeup_crawler = MakeupCrawler()


class ParseProductRequest(BaseModel):
    url: str


class CrawlMakeupRequest(BaseModel):
    url: str
    max_products: int | None = None


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