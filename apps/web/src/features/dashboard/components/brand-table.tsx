'use client'

import { Skeleton } from '@/components/ui/skeleton'

import { formatCount, formatPercent } from '../lib/format'
import { useDashboardBrands } from '../queries/use-dashboard'
import type { CompetitorFilter } from '../types/dashboard'

type BrandTableProps = {
	competitor: CompetitorFilter
	onBrandClick: (brand: string) => void
}

export function BrandTable({ competitor, onBrandClick }: BrandTableProps) {
	const { data, isLoading, isError } = useDashboardBrands(competitor)

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-6">
				<p className="text-sm text-text-muted">Failed to load brand breakdown.</p>
			</div>
		)
	}

	if (isLoading) {
		return <Skeleton className="h-48 w-full rounded" />
	}

	const items = data?.items ?? []

	if (items.length === 0) {
		return (
			<div className="rounded border border-hairline bg-surface py-16 text-center">
				<p className="text-sm text-text-muted">No eligible monitored brands yet.</p>
			</div>
		)
	}

	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[720px] border-collapse text-sm">
				<thead>
					<tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.06em] text-text-muted">
						<th className="py-2 pr-3">Brand</th>
						<th className="py-2 pr-3">Eligible</th>
						<th className="py-2 pr-3">Covered</th>
						<th className="py-2 pr-3">Coverage</th>
						<th className="py-2 pr-3">Comparable</th>
						<th className="py-2 pr-3">Avg gap</th>
						<th className="py-2 pr-3">Median gap</th>
						<th className="py-2">Unresolved</th>
					</tr>
				</thead>
				<tbody>
					{items.map(row => (
						<tr key={row.brand} className="border-b border-hairline last:border-0">
							<td className="py-2.5 pr-3">
								<button type="button" onClick={() => onBrandClick(row.brand)} className="font-medium text-text-primary hover:text-accent">
									{row.brand}
								</button>
							</td>
							<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{formatCount(row.eligible)}</td>
							<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{formatCount(row.covered)}</td>
							<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{formatPercent(row.coveragePercent)}</td>
							<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{formatCount(row.comparable)}</td>
							<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{row.avgGapPercent !== null ? `${row.avgGapPercent.toFixed(1)}%` : '—'}</td>
							<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{row.medianGapPercent !== null ? `${row.medianGapPercent.toFixed(1)}%` : '—'}</td>
							<td className="py-2.5 tabular-nums text-text-secondary">{formatCount(row.unresolved)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
