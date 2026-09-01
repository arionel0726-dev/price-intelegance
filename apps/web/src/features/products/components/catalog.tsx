'use client'

import { useMemo, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { useProducts } from '../queries/use-products'
import { CatalogToolbar } from './catalog-toolbar'
import { ProductCard } from './product-card'

export function Catalog() {
	const { data: products = [], isLoading, isError } = useProducts()

	const [search, setSearch] = useState('')
	const [brand, setBrand] = useState('all')
	const [category, setCategory] = useState('all')

	const brands = useMemo(() => {
		return [
			...new Set(products.map(product => product.brand).filter(Boolean))
		].sort()
	}, [products])

	const categories = useMemo(() => {
		return [
			...new Set(
				products
					.map(product => product.category)
					.filter((value): value is string => value !== null)
			)
		].sort()
	}, [products])

	const filteredProducts = useMemo(() => {
		const normalizedSearch = search.trim().toLowerCase()

		return products.filter(product => {
			const matchesBrand = brand === 'all' || product.brand === brand

			const matchesCategory =
				category === 'all' || product.category === category

			const matchesSearch =
				normalizedSearch.length === 0 ||
				[
					product.name,
					product.brand,
					product.article,
					product.barcode,
					product.volume
				]
					.filter(Boolean)
					.some(value => value!.toLowerCase().includes(normalizedSearch))

			return matchesBrand && matchesCategory && matchesSearch
		})
	}, [products, search, brand, category])

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

	return (
		<>
			<CatalogToolbar
				search={search}
				brand={brand}
				category={category}
				brands={brands}
				categories={categories}
				onSearchChange={setSearch}
				onBrandChange={setBrand}
				onCategoryChange={setCategory}
				onReset={resetFilters}
			/>

			<div className="mt-5 flex items-center justify-between">
				<p className="text-sm text-muted-foreground">
					{isLoading
						? 'Loading products...'
						: `${filteredProducts.length} products`}
				</p>
			</div>

			{isLoading ? (
				<CatalogSkeleton />
			) : filteredProducts.length > 0 ? (
				<div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{filteredProducts.map(product => (
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
