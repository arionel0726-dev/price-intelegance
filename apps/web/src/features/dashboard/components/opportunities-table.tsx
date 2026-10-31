'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { formatGapAmount, formatGapPercent, formatMdl, POSITION_LABEL } from '../lib/format'
import { useDashboardOpportunities } from '../queries/use-dashboard'
import type { CompetitorFilter, PricePosition } from '../types/dashboard'

type OpportunitiesTableProps = {
	competitor: CompetitorFilter
	brand: string
	position: PricePosition | 'all'
	onPositionChange: (position: PricePosition | 'all') => void
	page: number
	pageSize: number
	sort: 'gapPercent' | 'gapAmount' | 'name'
	direction: 'asc' | 'desc'
	onSortChange: (sort: 'gapPercent' | 'gapAmount' | 'name') => void
	onPageChange: (page: number) => void
}

const TABS: Array<{ key: PricePosition | 'all'; label: string }> = [
	{ key: 'all', label: 'All' },
	{ key: 'more_expensive', label: 'More expensive' },
	{ key: 'cheaper', label: 'Cheaper' },
	{ key: 'approximately_equal', label: 'Approximately equal' }
]

export function OpportunitiesTable({ competitor, brand, position, onPositionChange, page, pageSize, sort, direction, onSortChange, onPageChange }: OpportunitiesTableProps) {
	const [showTechnical, setShowTechnical] = useState<number | null>(null)

	const { data, isLoading, isPlaceholderData, isError } = useDashboardOpportunities({
		competitor,
		brand: brand === 'all' ? undefined : brand,
		position: position === 'all' ? undefined : position,
		sort,
		direction,
		page,
		pageSize
	})

	function toggleSort(key: 'gapPercent' | 'gapAmount' | 'name') {
		onSortChange(key)
	}

	return (
		<div>
			<nav aria-label="Filter by price position" className="flex flex-wrap gap-2">
				{TABS.map(tab => (
					<button
						key={tab.key}
						type="button"
						onClick={() => onPositionChange(tab.key)}
						aria-pressed={position === tab.key}
						className={
							position === tab.key
								? 'rounded border border-accent bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent'
								: 'rounded border border-hairline bg-card px-3 py-1.5 text-sm text-text-secondary hover:border-text-muted'
						}
					>
						{tab.label}
					</button>
				))}
			</nav>

			{isError ? (
				<div className="mt-4 rounded border border-hairline bg-card p-6">
					<p className="text-sm text-text-muted">Failed to load opportunities.</p>
				</div>
			) : isLoading ? (
				<div className="mt-4 flex flex-col gap-2">
					{Array.from({ length: 5 }).map((_, index) => (
						<Skeleton key={index} className="h-12 w-full rounded" />
					))}
				</div>
			) : (data?.items.length ?? 0) === 0 ? (
				<div className="mt-4 rounded border border-hairline bg-surface py-16 text-center">
					<h3 className="font-medium text-text-primary">No products match this filter</h3>
				</div>
			) : (
				<div className={isPlaceholderData ? 'mt-4 opacity-60 transition-opacity' : 'mt-4 transition-opacity'}>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[720px] border-collapse text-sm">
							<thead>
								<tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.06em] text-text-muted">
									<SortableHeader label="Product" active={sort === 'name'} direction={direction} onClick={() => toggleSort('name')} />
									<th className="py-2 pr-3">Vizaje price</th>
									<th className="py-2 pr-3">Competitor price</th>
									<SortableHeader label="Gap" active={sort === 'gapAmount'} direction={direction} onClick={() => toggleSort('gapAmount')} />
									<SortableHeader label="Gap %" active={sort === 'gapPercent'} direction={direction} onClick={() => toggleSort('gapPercent')} />
									<th className="py-2">Position</th>
								</tr>
							</thead>
							<tbody>
								{data!.items.map(item => (
									<tr key={item.productId} className="border-b border-hairline last:border-0">
										<td className="py-2.5 pr-3">
											<Link href={`/products/${item.productId}`} className="font-medium text-text-primary hover:text-accent">
												{item.name}
											</Link>
											<p className="text-xs text-text-muted">{item.brand}</p>
										</td>
										<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{formatMdl(item.vizajePrice)}</td>
										<td className="py-2.5 pr-3 tabular-nums text-text-secondary">
											{formatMdl(item.competitorPrice)}
											{item.competitorSource && <span className="ml-1 text-xs text-text-muted">({item.competitorSource.toUpperCase()})</span>}
										</td>
										<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{formatGapAmount(item.gapAmount)}</td>
										<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{formatGapPercent(item.gapPercent)}</td>
										<td className="py-2.5">
											<span className="text-xs text-text-secondary">{POSITION_LABEL[item.position]}</span>
											<button
												type="button"
												onClick={() => setShowTechnical(showTechnical === item.productId ? null : item.productId)}
												className="ml-2 text-xs text-text-muted hover:text-text-primary"
												aria-expanded={showTechnical === item.productId}
											>
												details
											</button>
											{showTechnical === item.productId && (
												<pre className="mt-1 rounded bg-surface p-2 text-xs text-text-secondary">{JSON.stringify(item, null, 2)}</pre>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{data!.pagination.totalPages > 1 && (
						<nav aria-label="Opportunities pagination" className="mt-6 flex items-center justify-center gap-3">
							<button
								type="button"
								disabled={page <= 1}
								onClick={() => onPageChange(page - 1)}
								className="rounded border border-hairline bg-card px-4 py-2 text-sm text-text-secondary disabled:opacity-40"
							>
								Previous
							</button>
							<span className="text-sm text-text-muted">
								Page {data!.pagination.page} / {data!.pagination.totalPages}
							</span>
							<button
								type="button"
								disabled={page >= data!.pagination.totalPages}
								onClick={() => onPageChange(page + 1)}
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

function SortableHeader({ label, active, direction, onClick }: { label: string; active: boolean; direction: 'asc' | 'desc'; onClick: () => void }) {
	return (
		<th className="py-2 pr-3">
			<button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-text-primary">
				{label}
				{active && (direction === 'asc' ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />)}
			</button>
		</th>
	)
}
