'use client'

import { X } from 'lucide-react'

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'

type CatalogToolbarProps = {
	search: string
	category: string
	brand: string

	brands: string[]
	categories: string[]

	onSearchChange: (value: string) => void
	onCategoryChange: (value: string) => void
	onBrandChange: (value: string) => void
	onReset: () => void
}

export function CatalogToolbar({
	search,
	category,
	brand,
	brands,
	categories,
	onSearchChange,
	onCategoryChange,
	onBrandChange,
	onReset
}: CatalogToolbarProps) {
	const hasActiveFilters =
		search.length > 0 || brand !== 'all' || category !== 'all'

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-end justify-between gap-6">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">Products</h1>
				</div>

				<div className="flex items-center gap-3">
					<Input
						value={search}
						onChange={event => onSearchChange(event.target.value)}
						placeholder="Search by name, article or barcode"
						className="h-10 w-[240px] rounded-full"
					/>

					<Select
						value={brand}
						onValueChange={value => {
							if (value !== null) {
								onBrandChange(value)
							}
						}}
					>
						<SelectTrigger className="w-[180px] rounded-full">
							<SelectValue placeholder="Brand" />
						</SelectTrigger>

						<SelectContent>
							<SelectItem value="all">All brands</SelectItem>

							{brands.map(item => (
								<SelectItem
									key={item}
									value={item}
								>
									{item}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					{hasActiveFilters && (
						<button
							onClick={onReset}
							className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
						>
							<X className="size-4" />
							Reset
						</button>
					)}
				</div>
			</div>

			<div className="flex gap-2 overflow-x-auto">
				{['all', ...categories].map(item => {
					const active = category === item

					return (
						<button
							key={item}
							onClick={() => onCategoryChange(item)}
							className={
								active
									? 'rounded-full bg-foreground px-5 py-2 text-sm text-background'
									: 'rounded-full bg-muted px-5 py-2 text-sm'
							}
						>
							{item === 'all' ? 'All' : item}
						</button>
					)
				})}
			</div>
		</div>
	)
}
