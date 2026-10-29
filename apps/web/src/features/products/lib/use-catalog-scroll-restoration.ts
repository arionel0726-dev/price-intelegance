'use client'

import { useEffect, useRef } from 'react'

// Scoped narrowly to the catalog<->product-detail path (Milestone 2.5) -
// NOT a general scroll-restoration mechanism for the whole app. Keyed by
// the catalog's own URL (search+pathname), so returning to a DIFFERENT
// catalog URL (a filter changed while away, or a fresh visit) never
// restores a stale position.
const STORAGE_PREFIX = 'price-intelligence.catalog.scroll.'

function storageKeyFor(catalogUrl: string): string {
	return `${STORAGE_PREFIX}${catalogUrl}`
}

// Call once from the catalog page. Restores scroll (if a position was
// saved for this EXACT url) on mount, and saves the current position
// whenever the user navigates away to a product (so Back can restore it).
// Does nothing - and throws nothing - if sessionStorage is unavailable.
export function useCatalogScrollRestoration(catalogUrl: string): {
	saveScrollBeforeNavigatingAway: () => void
} {
	const hasRestoredRef = useRef(false)

	useEffect(() => {
		hasRestoredRef.current = false

		try {
			const saved = sessionStorage.getItem(storageKeyFor(catalogUrl))
			if (saved === null) return

			const y = Number(saved)
			if (!Number.isFinite(y) || y < 0) return

			// Restore after the products for this URL have painted, not on
			// the skeleton - a double rAF lets layout settle first.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					window.scrollTo(0, y)
					hasRestoredRef.current = true
				})
			})
		} catch {
			// Private-mode/blocked storage - fresh scroll (top) is the safe
			// fallback, same as a first-ever visit.
		}
		// Only re-run when the URL this restoration is scoped to changes -
		// e.g. a filter change should start at the top, not reuse a
		// position saved for a different query.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [catalogUrl])

	function saveScrollBeforeNavigatingAway() {
		try {
			sessionStorage.setItem(storageKeyFor(catalogUrl), String(window.scrollY))
		} catch {
			// Nothing to restore later - not a functional problem, the
			// product page still opens normally.
		}
	}

	return { saveScrollBeforeNavigatingAway }
}
