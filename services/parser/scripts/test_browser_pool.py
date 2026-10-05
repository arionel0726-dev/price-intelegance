"""Standalone lifecycle regression check for BrowserPool (app/browser_pool.py).

Not a pytest suite - this project has no Python test framework installed
(no pytest in requirements.txt) and the goal here is a runnable, dependency-
free check, matching the project's existing convention of plain asyncio
verification scripts (see apps/api/scripts/verify-*.ts for the TypeScript
equivalent). Exits non-zero on any failed assertion.

Usage (from services/parser): .venv/bin/python3 scripts/test_browser_pool.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.browser_pool import BrowserPool  # noqa: E402

failures = 0


def check(label: str, condition: bool) -> None:
    global failures
    status = "PASS" if condition else "FAIL"
    print(f"  {status}  {label}")
    if not condition:
        failures += 1


async def test_sequential_lifecycle(pool: BrowserPool) -> None:
    print("=== sequential open/close lifecycle ===")

    for i in range(1, 6):
        async with pool.new_page() as page:
            check(f"iteration {i}: active_contexts == 1 while open", pool.active_contexts == 1)
            await page.goto("about:blank")

        check(f"iteration {i}: active_contexts == 0 after close", pool.active_contexts == 0)

    diag = pool.diagnostics()
    check("contexts_opened_total == 5", diag["contexts_opened_total"] == 5)
    check("contexts_closed_total == 5", diag["contexts_closed_total"] == 5)


async def test_failure_path_cleanup(pool: BrowserPool) -> None:
    print("=== cleanup on exception inside the `async with` block ===")

    before = pool.diagnostics()["contexts_closed_total"]
    raised = False

    try:
        async with pool.new_page() as page:
            await page.goto("about:blank")
            raise RuntimeError("simulated failure mid-parse")
    except RuntimeError:
        raised = True

    check("the real exception still propagates (not swallowed by cleanup)", raised)
    check("active_contexts == 0 after an exception", pool.active_contexts == 0)
    check(
        "contexts_closed_total incremented despite the exception",
        pool.diagnostics()["contexts_closed_total"] == before + 1,
    )


async def test_concurrency_cap(pool: BrowserPool, max_concurrency: int) -> None:
    print(f"=== concurrency cap (max_concurrency={max_concurrency}) ===")

    peak = 0
    peak_lock = asyncio.Lock()

    async def one_call():
        nonlocal peak
        async with pool.new_page() as page:
            async with peak_lock:
                peak = max(peak, pool.active_contexts)
            await page.goto("about:blank")
            await asyncio.sleep(0.15)  # hold the slot long enough for overlap to be observable

    await asyncio.gather(*(one_call() for _ in range(max_concurrency * 3)))

    check(f"peak concurrent contexts ({peak}) never exceeded cap ({max_concurrency})", peak <= max_concurrency)
    check("active_contexts == 0 after all concurrent calls finish", pool.active_contexts == 0)


async def test_real_makeup_page(pool: BrowserPool) -> None:
    print("=== optional: one real MAKEUP page load (network-dependent, soft-fail) ===")

    try:
        async with pool.new_page() as page:
            response = await page.goto(
                "https://makeup.md/ru/product/458146/",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            check("real MAKEUP page responded", response is not None and response.ok)
        check("active_contexts == 0 after real page load", pool.active_contexts == 0)
    except Exception as error:  # noqa: BLE001
        print(f"  SKIP  real MAKEUP page check unavailable ({error}) - not counted as a failure")


async def main() -> None:
    pool = BrowserPool(max_concurrency=2)

    print("Starting pool...")
    await pool.start()
    check("is_running after start()", pool.is_running)

    await test_sequential_lifecycle(pool)
    await test_failure_path_cleanup(pool)
    await test_concurrency_cap(pool, max_concurrency=2)
    await test_real_makeup_page(pool)

    print("Stopping pool...")
    await pool.stop()
    check("is_running is False after stop()", not pool.is_running)

    print()
    if failures:
        print(f"{failures} assertion(s) FAILED")
        sys.exit(1)

    print("All assertions PASSED")


if __name__ == "__main__":
    asyncio.run(main())
