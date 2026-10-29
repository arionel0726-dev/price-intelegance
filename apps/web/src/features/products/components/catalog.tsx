'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { useDebouncedValue } from '@/lib/use-debounced-value'

import {
	CATALOG_DEFAULTS,
	parseCatalogSearchParams,
	readCatalogPreferences,
	resolveCatalogFilters,
	serializeCatalogFilters,
	writeCatalogPreferences,
	type CatalogFilters,
	type CatalogView
} from '../lib/catalog-url-state'
import { useCatalogScrollRestoration } from '../lib/use-catalog-scroll-restoration'
import { useProductFilters } from '../queries/use-product-filters'
import { useProducts } from '../queries/use-products'
import { CatalogToolbar } from './catalog-toolbar'
import { Pagination } from './pagination'
import { ProductCard } from './product-card'
import { ProductListRow } from './product-list-row'

const PAGE_SIZE = 40

export function Catalog() {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()

	const fromUrl = parseCatalogSearchParams(searchParams)

	// Preferences start at hard defaults on every render (server AND first
	// client render agree, so there's no hydration mismatch) and are
	// replaced with the real stored values in an effect right after mount -
	// a one-tick delay for a cosmetic fallback is an acceptable trade for
	// never flashing mismatched SSR/CSR output.
	const [preferences, setPreferences] = useState(() => ({
		view: CATALOG_DEFAULTS.view,
		pageSize: PAGE_SIZE,
		lastBrand: CATALOG_DEFAULTS.brand,
		lastCategory: CATALOG_DEFAULTS.category
	}))

	useEffect(() => {
		setPreferences(readCatalogPreferences())
	}, [])

	const filters = resolveCatalogFilters(fromUrl, preferences)

	// Local, immediate-typing search box state - the URL only updates once
	// this settles (see the debounced effect below), so every keystroke
	// doesn't touch history/the querystring.
	const [searchInput, setSearchInput] = useState(filters.search)
	const debouncedSearch = useDebouncedValue(searchInput, 300)

	// If the URL's search changes from OUTSIDE this component (Back/
	// Forward, a shared link), resync the input box to match it.
	useEffect(() => {
		setSearchInput(filters.search)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [fromUrl.search])

	function buildUrl(next: Partial<CatalogFilters>): string {
		const query = serializeCatalogFilters({ ...filters, ...next })
		return query ? `${pathname}?${query}` : pathname
	}

	// Debounced search settling is a "major filter change" - it resets
	// page to 1, but is NOT a user-initiated committed action by itself
	// (nobody pressed Enter), so it uses replace: no history entry per
	// settled keystroke, same spirit as not polluting history per
	// character typed.
	useEffect(() => {
		if (debouncedSearch === filters.search) return

		router.replace(buildUrl({ search: debouncedSearch, page: CATALOG_DEFAULTS.page }), { scroll: false })
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedSearch])

	function commitFilterChange(next: Partial<CatalogFilters>) {
		// Any filter change besides view/page itself resets page to 1 -
		// callers of this pass only the major filter being changed.
		router.push(buildUrl({ ...next, page: CATALOG_DEFAULTS.page }), { scroll: false })

		if (next.brand !== undefined || next.category !== undefined) {
			const updated = {
				...preferences,
				lastBrand: next.brand ?? filters.brand,
				lastCategory: next.category ?? filters.category
			}
			setPreferences(updated)
			writeCatalogPreferences(updated)
		}
	}

	function changeView(view: CatalogView) {
		// Display preference, not a filter - must NOT reset page, and
		// (per the brief) shouldn't pollute history either; replace keeps
		// Back from needing to step through every Grid<->List toggle.
		router.replace(buildUrl({ view }), { scroll: false })

		const updated = { ...preferences, view }
		setPreferences(updated)
		writeCatalogPreferences(updated)
	}

	function changePage(page: number) {
		// Explicit pagination click - a committed navigation, real history
		// entry, and the one case that must NOT reset itself back to 1.
		router.push(buildUrl({ page }))
	}

	function resetFilters() {
		router.push(buildUrl({ search: CATALOG_DEFAULTS.search, brand: CATALOG_DEFAULTS.brand, category: CATALOG_DEFAULTS.category }))
	}

	const { data: filterOptions } = useProductFilters()

	const { data, isLoading, isPlaceholderData, isError } = useProducts({
		page: filters.page,
		limit: PAGE_SIZE,
		search: filters.search,
		brand: filters.brand,
		category: filters.category
	})

	const catalogUrl = `${pathname}?${searchParams.toString()}`
	const { saveScrollBeforeNavigatingAway } = useCatalogScrollRestoration(catalogUrl)
	const navigatingAwayRef = useRef(saveScrollBeforeNavigatingAway)
	navigatingAwayRef.current = saveScrollBeforeNavigatingAway

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-8">
				<h2 className="font-medium text-text-primary">Failed to load catalog</h2>

				<p className="mt-1 text-sm text-text-muted">
					Make sure the API and PostgreSQL are running.
				</p>
			</div>
		)
	}

	const products = data?.items ?? []
	const pagination = data?.pagination

	return (
		<>
			<CatalogToolbar
				search={searchInput}
				brand={filters.brand}
				category={filters.category}
				view={filters.view}
				brands={filterOptions?.brands ?? []}
				categories={filterOptions?.categories ?? []}
				productCount={pagination?.total}
				isLoading={isLoading}
				onSearchChange={setSearchInput}
				onBrandChange={value => commitFilterChange({ brand: value })}
				onCategoryChange={value => commitFilterChange({ category: value })}
				onViewChange={changeView}
				onReset={resetFilters}
			/>

			{isLoading ? (
				<CatalogSkeleton />
			) : products.length > 0 ? (
				filters.view === 'grid' ? (
					<div
						aria-busy={isPlaceholderData}
						className={`mt-8 grid grid-cols-2 gap-x-5 gap-y-10 transition-opacity md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${
							isPlaceholderData ? 'opacity-60' : ''
						}`}
					>
						{products.map(product => (
							<ProductCard
								key={product.id}
								product={product}
								onNavigateAway={() => navigatingAwayRef.current()}
							/>
						))}
					</div>
				) : (
					<div
						aria-busy={isPlaceholderData}
						className={`mt-8 flex flex-col gap-2 transition-opacity ${
							isPlaceholderData ? 'opacity-60' : ''
						}`}
					>
						{products.map(product => (
							<ProductListRow
								key={product.id}
								product={product}
								onNavigateAway={() => navigatingAwayRef.current()}
							/>
						))}
					</div>
				)
			) : (
				<div className="mt-5 rounded border border-hairline bg-card py-24 text-center">
					<h2 className="font-medium text-text-primary">No products found</h2>

					<p className="mt-2 text-sm text-text-muted">
						Try another name, article, barcode or filter.
					</p>
				</div>
			)}

			{pagination && (
				<Pagination
					page={pagination.page}
					totalPages={pagination.totalPages}
					onPageChange={changePage}
				/>
			)}
		</>
	)
}

function CatalogSkeleton() {
	return (
		<div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
			{Array.from({ length: 10 }).map((_, index) => (
				<div key={index}>
					<Skeleton className="aspect-[1/1.12] w-full rounded" />
					<Skeleton className="mt-4 h-3 w-16 rounded" />
					<Skeleton className="mt-2 h-4 w-4/5 rounded" />
					<Skeleton className="mt-4 h-5 w-20 rounded" />
				</div>
			))}
		</div>
	)
}
