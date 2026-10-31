'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useProductFilters } from '@/features/products/queries/use-product-filters'
import { useDebouncedValue } from '@/lib/use-debounced-value'

import {
	ADMIN_PRODUCT_DEFAULTS,
	parseAdminProductSearchParams,
	readAdminPreferences,
	resolveAdminProductFilters,
	serializeAdminProductFilters,
	writeAdminPreferences,
	type AdminProductFilters
} from '../lib/admin-url-state'
import { useAdminProducts } from '../queries/use-admin-products'
import { ProductPolicyPanel } from './product-policy-panel'

const PAGE_SIZE_OPTIONS = [10, 20, 50]

export function AdminProductsList() {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()

	const fromUrl = parseAdminProductSearchParams(searchParams)
	const filters = resolveAdminProductFilters(fromUrl)

	const [searchInput, setSearchInput] = useState(filters.search)
	const debouncedSearch = useDebouncedValue(searchInput, 300)

	const [pageSize, setPageSize] = useState(20)
	useEffect(() => {
		setPageSize(readAdminPreferences().pageSize)
	}, [])

	const [expandedId, setExpandedId] = useState<number | null>(null)

	function buildUrl(next: Partial<AdminProductFilters>): string {
		const query = serializeAdminProductFilters({ ...filters, ...next })
		return query ? `${pathname}?${query}` : pathname
	}

	useEffect(() => {
		if (debouncedSearch === filters.search) return
		router.replace(buildUrl({ search: debouncedSearch, page: ADMIN_PRODUCT_DEFAULTS.page }), { scroll: false })
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedSearch])

	function commitFilterChange(next: Partial<AdminProductFilters>) {
		router.push(buildUrl({ ...next, page: ADMIN_PRODUCT_DEFAULTS.page }), { scroll: false })
	}

	function changePage(page: number) {
		router.push(buildUrl({ page }))
	}

	function changePageSize(size: number) {
		setPageSize(size)
		writeAdminPreferences({ pageSize: size })
		router.push(buildUrl({ page: ADMIN_PRODUCT_DEFAULTS.page }), { scroll: false })
	}

	const { data: filterOptions } = useProductFilters()

	const { data, isLoading, isPlaceholderData, isError } = useAdminProducts({
		page: filters.page,
		limit: pageSize,
		search: filters.search,
		brand: filters.brand === 'all' ? undefined : filters.brand,
		category: filters.category === 'all' ? undefined : filters.category,
		imageState: filters.imageState === 'all' ? undefined : filters.imageState,
		overrideState: filters.overrideState === 'all' ? undefined : filters.overrideState,
		exclusionReason: filters.exclusionReason === 'all' ? undefined : filters.exclusionReason
	})

	const items = data?.items ?? []
	const totalPages = data?.pagination.totalPages ?? 1

	return (
		<div>
			<div className="flex flex-wrap items-center gap-3">
				<Input
					type="search"
					value={searchInput}
					onChange={event => setSearchInput(event.target.value)}
					placeholder="Search by name, article or barcode"
					aria-label="Search admin products"
					className="h-9 w-[260px] rounded border-hairline bg-card"
				/>

				<Select value={filters.brand} onValueChange={value => value && commitFilterChange({ brand: value })}>
					<SelectTrigger aria-label="Filter by brand" className="w-[150px] rounded border-hairline bg-card">
						<SelectValue placeholder="Brand" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All brands</SelectItem>
						{(filterOptions?.brands ?? []).map(brand => (
							<SelectItem key={brand} value={brand}>
								{brand}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={filters.imageState} onValueChange={value => value && commitFilterChange({ imageState: value })}>
					<SelectTrigger aria-label="Filter by image state" className="w-[150px] rounded border-hairline bg-card">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All images</SelectItem>
						<SelectItem value="missing">Missing</SelectItem>
						<SelectItem value="placeholder">Placeholder</SelectItem>
						<SelectItem value="real">Real</SelectItem>
					</SelectContent>
				</Select>

				<Select value={filters.overrideState} onValueChange={value => value && commitFilterChange({ overrideState: value })}>
					<SelectTrigger aria-label="Filter by override state" className="w-[150px] rounded border-hairline bg-card">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All overrides</SelectItem>
						<SelectItem value="has_override">Has override</SelectItem>
						<SelectItem value="inherit">Inherits</SelectItem>
					</SelectContent>
				</Select>

				<Select value={String(pageSize)} onValueChange={value => value && changePageSize(Number(value))}>
					<SelectTrigger aria-label="Rows per page" className="w-[110px] rounded border-hairline bg-card">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PAGE_SIZE_OPTIONS.map(size => (
							<SelectItem key={size} value={String(size)}>
								{size} / page
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{isError ? (
				<div className="mt-4 rounded border border-hairline bg-card p-6">
					<p className="text-sm text-text-muted">Failed to load admin products.</p>
				</div>
			) : isLoading ? (
				<div className="mt-4 flex flex-col gap-2">
					{Array.from({ length: 5 }).map((_, index) => (
						<Skeleton key={index} className="h-12 w-full rounded" />
					))}
				</div>
			) : items.length === 0 ? (
				<div className="mt-4 rounded border border-hairline bg-surface py-16 text-center">
					<h3 className="font-medium text-text-primary">No products match these filters</h3>
				</div>
			) : (
				<div className={isPlaceholderData ? 'mt-4 opacity-60 transition-opacity' : 'mt-4 transition-opacity'}>
					<ul className="flex flex-col gap-2">
						{items.map(item => (
							<li key={item.id} className="rounded border border-hairline bg-card">
								<button
									type="button"
									onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
									aria-expanded={expandedId === item.id}
									className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
								>
									<div className="min-w-0">
										<p className="text-xs font-medium uppercase tracking-[0.06em] text-text-muted">{item.brand}</p>
										<p className="truncate text-sm font-medium text-text-primary">{item.name}</p>
									</div>
									<div className="flex shrink-0 items-center gap-2 text-xs text-text-secondary">
										<ImageStatusBadge status={item.imageStatus} />
										{item.hasOverride && <span className="rounded border border-accent bg-accent/10 px-2 py-0.5 text-accent">Override</span>}
										{!item.effective.visibleInCatalog && <span className="rounded border border-hairline px-2 py-0.5 text-text-muted">Hidden</span>}
									</div>
								</button>

								{expandedId === item.id && (
									<div className="border-t border-hairline p-4">
										<ProductPolicyPanel productId={item.id} />
									</div>
								)}
							</li>
						))}
					</ul>

					{totalPages > 1 && (
						<nav aria-label="Admin products pagination" className="mt-6 flex items-center justify-center gap-3">
							<button
								type="button"
								disabled={filters.page <= 1}
								onClick={() => changePage(filters.page - 1)}
								className="rounded border border-hairline bg-card px-4 py-2 text-sm text-text-secondary disabled:opacity-40"
							>
								Previous
							</button>
							<span className="text-sm text-text-muted">
								Page {filters.page} / {totalPages}
							</span>
							<button
								type="button"
								disabled={filters.page >= totalPages}
								onClick={() => changePage(filters.page + 1)}
								className="rounded border border-hairline bg-card px-4 py-2 text-sm text-text-secondary disabled:opacity-40"
							>
								Next
							</button>
						</nav>
					)}
				</div>
			)}
		</div>
	)
}

function ImageStatusBadge({ status }: { status: 'missing' | 'placeholder' | 'real' }) {
	const label = status === 'missing' ? 'No image' : status === 'placeholder' ? 'Placeholder image' : 'Real image'
	return <span className="rounded border border-hairline px-2 py-0.5 text-text-secondary">{label}</span>
}
