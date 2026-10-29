'use client'

import { X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select'

import type { CategoryGroup } from '../types/product'
import { type CatalogView, ViewToggle } from './view-toggle'

type CatalogToolbarProps = {
	search: string
	category: string
	brand: string
	view: CatalogView

	brands: string[]
	categories: CategoryGroup[]
	productCount: number | undefined
	isLoading: boolean

	onSearchChange: (value: string) => void
	onCategoryChange: (value: string) => void
	onBrandChange: (value: string) => void
	onViewChange: (view: CatalogView) => void
	onReset: () => void
}

// Hierarchy (Milestone 2.5): title/count -> search -> primary filter
// (brand) -> secondary filters (category chips) -> Grid/List -> active-
// filter summary/reset. No sort control - the catalog API has no sort
// parameter today (see get-products.ts/ProductsListQuery) and this
// milestone adds no new backend capability, so a sort control is
// deliberately out of scope rather than wired to nothing.
export function CatalogToolbar({
	search,
	category,
	brand,
	view,
	brands,
	categories,
	productCount,
	isLoading,
	onSearchChange,
	onCategoryChange,
	onBrandChange,
	onViewChange,
	onReset
}: CatalogToolbarProps) {
	const hasActiveFilters = search.length > 0 || brand !== 'all' || category !== 'all'

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h1 className="text-3xl font-light tracking-tight text-text-primary">
						Products
					</h1>

					<p className="mt-1 text-sm text-text-muted" aria-live="polite">
						{isLoading ? 'Loading products…' : `${productCount ?? 0} products`}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<label className="sr-only" htmlFor="catalog-search">
						Search products
					</label>
					<Input
						id="catalog-search"
						type="search"
						value={search}
						onChange={event => onSearchChange(event.target.value)}
						placeholder="Search by name, article or barcode"
						className="h-10 w-[260px] rounded border-hairline bg-card focus-visible:ring-accent"
					/>

					<Select
						value={brand}
						onValueChange={value => {
							if (value !== null) onBrandChange(value)
						}}
					>
						<SelectTrigger
							aria-label="Filter by brand"
							className="w-[180px] rounded border-hairline bg-card focus-visible:ring-accent"
						>
							<SelectValue placeholder="Brand" />
						</SelectTrigger>

						<SelectContent>
							<SelectItem value="all">All brands</SelectItem>

							{brands.map(item => (
								<SelectItem key={item} value={item}>
									{item}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<ViewToggle view={view} onViewChange={onViewChange} />
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{[{ key: 'all', label: 'All' }, ...categories].map(item => {
					const active = category === item.key

					return (
						<button
							key={item.key}
							type="button"
							onClick={() => onCategoryChange(item.key)}
							aria-pressed={active}
							className={
								active
									? 'rounded border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent'
									: 'rounded border border-hairline bg-card px-4 py-1.5 text-sm text-text-secondary transition-colors hover:border-text-muted'
							}
						>
							{item.label}
						</button>
					)
				})}

				{hasActiveFilters && (
					<button
						type="button"
						onClick={onReset}
						className="ml-1 inline-flex items-center gap-1 rounded px-2 py-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
					>
						<X className="size-3.5" aria-hidden="true" />
						Reset filters
					</button>
				)}
			</div>
		</div>
	)
}
