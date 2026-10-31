'use client'

import { X } from 'lucide-react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProductFilters } from '@/features/products/queries/use-product-filters'

import type { DashboardFilters } from '../lib/dashboard-url-state'
import type { CompetitorFilter } from '../types/dashboard'

type DashboardFiltersBarProps = {
	filters: DashboardFilters
	onCompetitorChange: (value: CompetitorFilter) => void
	onBrandChange: (value: string) => void
	onReset: () => void
}

export function DashboardFiltersBar({ filters, onCompetitorChange, onBrandChange, onReset }: DashboardFiltersBarProps) {
	const { data: filterOptions } = useProductFilters()
	const hasActiveFilters = filters.competitor !== 'all' || filters.brand !== 'all'

	return (
		<div className="flex flex-wrap items-center gap-3">
			<Select value={filters.competitor} onValueChange={value => value && onCompetitorChange(value as CompetitorFilter)}>
				<SelectTrigger aria-label="Filter by competitor" className="w-[150px] rounded border-hairline bg-card">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">All competitors</SelectItem>
					<SelectItem value="makeup">MAKEUP</SelectItem>
					<SelectItem value="ovico">OVICO</SelectItem>
				</SelectContent>
			</Select>

			<Select value={filters.brand} onValueChange={value => value && onBrandChange(value)}>
				<SelectTrigger aria-label="Filter by brand" className="w-[180px] rounded border-hairline bg-card">
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

			{hasActiveFilters && (
				<button type="button" onClick={onReset} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
					<X className="size-3.5" aria-hidden="true" />
					Reset filters
				</button>
			)}
		</div>
	)
}
