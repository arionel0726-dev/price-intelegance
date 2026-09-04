import asyncio
import time

import httpx

# OVICO's robots.txt declares "Crawl-delay: 30" for all user agents. This
# throttle is the single place that sleeps for OVICO requests - both the
# parser and the crawler call ovico_get() so the delay is enforced globally,
# regardless of which module makes the request.
OVICO_MIN_INTERVAL_SECONDS = 30.0

OVICO_USER_AGENT = (
    "PriceMonitoringBot/1.0 "
    "(+internal price comparison tool for Vizaje-Nica; low volume, respects robots.txt)"
)

OVICO_REQUEST_TIMEOUT_SECONDS = 20.0


class _RateLimiter:
    def __init__(self, min_interval_seconds: float):
        self._min_interval = min_interval_seconds
        self._lock = asyncio.Lock()
        self._last_request_at: float | None = None

    async def throttle(self) -> None:
        async with self._lock:
            now = time.monotonic()

            if self._last_request_at is not None:
                elapsed = now - self._last_request_at
                wait_for = self._min_interval - elapsed

                if wait_for > 0:
                    await asyncio.sleep(wait_for)

            self._last_request_at = time.monotonic()


# Module-level singleton: one throttle per process, shared by every caller.
_rate_limiter = _RateLimiter(OVICO_MIN_INTERVAL_SECONDS)


def create_ovico_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        headers={"User-Agent": OVICO_USER_AGENT},
        timeout=OVICO_REQUEST_TIMEOUT_SECONDS,
    )


async def ovico_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    await _rate_limiter.throttle()

    response = await client.get(url)
    response.raise_for_status()

    return response
