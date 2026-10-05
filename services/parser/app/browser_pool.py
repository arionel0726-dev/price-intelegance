import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from playwright.async_api import Browser, Page, Playwright, async_playwright

logger = logging.getLogger("app.browser_pool")


class BrowserPool:
    """Owns exactly one long-lived Chromium process for the whole service
    lifetime.

    Previously, every MAKEUP parse/search/crawl call launched its own
    `playwright.chromium.launch()` - a brand new Chromium process per HTTP
    request. Under production volume (one parse per candidate, many
    candidates per discovery run, many runs per day) that launched and
    killed thousands of browser processes. Combined with uvicorn running as
    PID 1 in the container (no init process reaping orphaned children - see
    Dockerfile), any launch/close that didn't fully reap its subprocess
    tree left a zombie; thousands of those exhausted the OS thread/PID
    table (ulimit -u), producing the production symptoms: "pthread_create:
    Resource temporarily unavailable", "Failed to start BrowserThread:IO",
    and "Target page, context or browser has been closed" - a container
    restart (fresh PID 1, zero zombies) dropped it straight back to ~38MB/1
    process.

    Fix: launch Chromium ONCE here (on app startup) and reuse that one
    process for the service's whole lifetime. Each call still gets its own
    fresh BrowserContext + Page for isolation (no shared cookies/storage
    leaking between requests) - only the browser PROCESS is shared, which
    is what actually costs OS processes/threads. A context is an in-process
    Playwright construct, not a new OS process, so creating/closing many of
    those does not reproduce the original problem.
    """

    def __init__(self, max_concurrency: int = 2):
        self._max_concurrency = max_concurrency
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._active_contexts = 0
        self._contexts_opened_total = 0
        self._contexts_closed_total = 0

    async def start(self) -> None:
        if self._browser is not None:
            return

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(headless=True)

        logger.info("BrowserPool: launched shared Chromium browser (max_concurrency=%d)", self._max_concurrency)

    async def stop(self) -> None:
        if self._browser is not None:
            await _safe_close(self._browser, "browser")
            self._browser = None

        if self._playwright is not None:
            try:
                await self._playwright.stop()
            except Exception:
                logger.warning("BrowserPool: error stopping playwright driver", exc_info=True)
            self._playwright = None

        logger.info("BrowserPool: closed shared Chromium browser")

    @property
    def is_running(self) -> bool:
        return self._browser is not None

    @property
    def active_contexts(self) -> int:
        return self._active_contexts

    def diagnostics(self) -> dict:
        return {
            "browser_running": self.is_running,
            "active_contexts": self._active_contexts,
            "contexts_opened_total": self._contexts_opened_total,
            "contexts_closed_total": self._contexts_closed_total,
        }

    @asynccontextmanager
    async def new_page(
        self,
        *,
        locale: str = "ru-RU",
        viewport: dict | None = None,
    ) -> AsyncIterator[Page]:
        if self._browser is None:
            raise RuntimeError("BrowserPool is not started - call start() first")

        async with self._semaphore:
            context = await self._browser.new_context(
                locale=locale,
                viewport=viewport or {"width": 1440, "height": 1000},
            )
            self._active_contexts += 1
            self._contexts_opened_total += 1

            try:
                page = await context.new_page()
                try:
                    yield page
                finally:
                    # Independently guarded - page.close() failing must not
                    # skip context.close() below it (the original bug: two
                    # sequential awaits in one finally, no isolation).
                    await _safe_close(page, "page")
            finally:
                await _safe_close(context, "context")
                self._active_contexts -= 1
                self._contexts_closed_total += 1


async def _safe_close(resource, label: str) -> None:
    try:
        await resource.close()
    except Exception:
        logger.warning("BrowserPool: error closing %s", label, exc_info=True)
