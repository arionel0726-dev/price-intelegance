'use client'

import { useEffect, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { useDebouncedValue } from '@/lib/use-debounced-value'

import { useProductFilters } from '../queries/use-product-filters'
import { useProducts } from '../queries/use-products'
import { CatalogToolbar } from './catalog-toolbar'
import { Pagination } from './pagination'
import { ProductCard } from './product-card'

const PAGE_SIZE = 40

export function Catalog() {
	const [page, setPage] = useState(1)
	const [search, setSearch] = useState('')
	const [brand, setBrand] = useState('all')
	const [category, setCategory] = useState('all')

	const debouncedSearch = useDebouncedValue(search, 300)

	const { data: filters } = useProductFilters()

	const {
		data,
		isLoading,
		isPlaceholderData,
		isError
	} = useProducts({
		page,
		limit: PAGE_SIZE,
		search: debouncedSearch,
		brand,
		category
	})

	// Search/brand/category change -> back to page 1. Watches the DEBOUNCED
	// search value (not every keystroke) so this only fires once per actual
	// query change, not on every character typed.
	useEffect(() => {
		setPage(1)
	}, [debouncedSearch, brand, category])

	function resetFilters() {
		setSearch('')
		setBrand('all')
		setCategory('all')
	}

	if (isError) {
		return (
			<div className="border p-8">
				<h2 className="font-medium">Failed to load catalog</h2>

				<p className="mt-1 text-sm text-muted-foreground">
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
				search={search}
				brand={brand}
				category={category}
				brands={filters?.brands ?? []}
				categories={filters?.categories ?? []}
				onSearchChange={setSearch}
				onBrandChange={setBrand}
				onCategoryChange={setCategory}
				onReset={resetFilters}
			/>

			<div className="mt-5 flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					{isLoading
						? 'Loading products...'
						: `${pagination?.total ?? 0} products`}
				</p>
			</div>

			{isLoading ? (
				<CatalogSkeleton />
			) : products.length > 0 ? (
				<div
					aria-busy={isPlaceholderData}
					className={`mt-8 grid grid-cols-2 gap-x-5 gap-y-10 transition-opacity md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${
						isPlaceholderData ? 'opacity-50' : ''
					}`}
				>
					{products.map(product => (
						<div key={product.id}>
							<ProductCard product={product} />
						</div>
					))}
				</div>
			) : (
				<div className="mt-5 border py-24 text-center">
					<h2 className="font-medium">No products found</h2>

					<p className="mt-2 text-sm text-muted-foreground">
						Try another name, article, barcode or filter.
					</p>
				</div>
			)}

			{pagination && (
				<Pagination
					page={pagination.page}
					totalPages={pagination.totalPages}
					onPageChange={setPage}
				/>
			)}
		</>
	)
}

function CatalogSkeleton() {
	return (
		<div className="mt-5 grid grid-cols-1 border-l border-t md:grid-cols-2 xl:grid-cols-3">
			{Array.from({ length: 6 }).map((_, index) => (
				<div
					key={index}
					className="min-h-[260px] border-b border-r p-5"
				>
					<Skeleton className="h-3 w-20 rounded-none" />
					<Skeleton className="mt-8 h-5 w-4/5 rounded-none" />
					<Skeleton className="mt-2 h-5 w-3/5 rounded-none" />
					<Skeleton className="mt-24 h-6 w-28 rounded-none" />
				</div>
			))}
		</div>
	)
}
