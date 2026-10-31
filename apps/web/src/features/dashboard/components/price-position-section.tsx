import { TrendingDown, TrendingUp, Equal } from 'lucide-react'

import { formatCount, formatPercent } from '../lib/format'
import type { DashboardSummary } from '../types/dashboard'

type PricePositionSectionProps = {
	summary: DashboardSummary
}

export function PricePositionSection({ summary }: PricePositionSectionProps) {
	const { universe, pricePosition, avgGapPercent, medianGapPercent } = summary

	const rows = [
		{ label: 'More expensive than competitor', count: pricePosition.moreExpensive, percent: pricePosition.moreExpensivePercent, icon: TrendingUp },
		{ label: 'Cheaper than competitor', count: pricePosition.cheaper, percent: pricePosition.cheaperPercent, icon: TrendingDown },
		{ label: 'Approximately equal', count: pricePosition.approximatelyEqual, percent: pricePosition.approximatelyEqualPercent, icon: Equal }
	]

	return (
		<section className="rounded border border-hairline bg-card p-5">
			<h2 className="font-medium text-text-primary">Price position</h2>
			<p className="mt-1 text-sm text-text-muted">Of {formatCount(universe.comparableProducts)} products with a valid price on both sides (never null or zero).</p>

			<div className="mt-4 grid gap-3 sm:grid-cols-3">
				{rows.map(row => (
					<div key={row.label} className="rounded border border-hairline bg-surface p-3">
						<div className="flex items-center gap-1.5 text-xs text-text-muted">
							<row.icon className="size-3.5" aria-hidden="true" />
							{row.label}
						</div>
						<p className="mt-1 text-xl font-light tabular-nums text-text-primary">{formatCount(row.count)}</p>
						<p className="text-xs text-text-muted">{formatPercent(row.percent)} of comparable</p>
					</div>
				))}
			</div>

			<dl className="mt-4 flex gap-6 text-sm">
				<div>
					<dt className="text-xs text-text-muted">Average gap</dt>
					<dd className="font-medium tabular-nums text-text-primary">{avgGapPercent !== null ? `${avgGapPercent.toFixed(1)}%` : '—'}</dd>
				</div>
				<div>
					<dt className="text-xs text-text-muted">Median gap</dt>
					<dd className="font-medium tabular-nums text-text-primary">{medianGapPercent !== null ? `${medianGapPercent.toFixed(1)}%` : '—'}</dd>
				</div>
			</dl>
		</section>
	)
}
