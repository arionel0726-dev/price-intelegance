import { AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react'

import { formatCount, formatPercent } from '../lib/format'
import type { DashboardSummary } from '../types/dashboard'

type ExecutiveSummaryProps = {
	summary: DashboardSummary
}

// Visually prioritized per the brief - NOT 20 identical KPI cards. Three
// things a manager actually scans for: how much of the catalog is even
// being compared (coverage), how often Vizaje loses on price (more
// expensive), and how many concrete opportunities that produces. Every
// other number lives in the sections below, in supporting detail.
export function ExecutiveSummary({ summary }: ExecutiveSummaryProps) {
	const { universe, coverage, pricePosition } = summary

	return (
		<div className="grid gap-4 sm:grid-cols-3">
			<div className="rounded border border-hairline bg-card p-5">
				<div className="flex items-center gap-2 text-text-muted">
					<CheckCircle2 className="size-4" aria-hidden="true" />
					<p className="text-xs font-medium uppercase tracking-[0.06em]">Coverage</p>
				</div>
				<p className="mt-2 text-3xl font-light text-text-primary">{formatPercent(coverage.coveragePercent)}</p>
				<p className="mt-1 text-sm text-text-muted">
					{formatCount(coverage.productCoverage)} of {formatCount(universe.eligibleMonitoredProducts)} products currently eligible for competitor price monitoring have a
					confirmed competitor match
				</p>
			</div>

			<div className="rounded border border-hairline bg-card p-5">
				<div className="flex items-center gap-2 text-text-muted">
					<TrendingUp className="size-4" aria-hidden="true" />
					<p className="text-xs font-medium uppercase tracking-[0.06em]">More expensive than competitor</p>
				</div>
				<p className="mt-2 text-3xl font-light text-text-primary">{formatPercent(pricePosition.moreExpensivePercent)}</p>
				<p className="mt-1 text-sm text-text-muted">
					{formatCount(pricePosition.moreExpensive)} of {formatCount(universe.comparableProducts)} products with a comparable price
				</p>
			</div>

			<div className="rounded border border-hairline bg-card p-5">
				<div className="flex items-center gap-2 text-text-muted">
					{pricePosition.moreExpensive > 0 ? <AlertTriangle className="size-4" aria-hidden="true" /> : <TrendingDown className="size-4" aria-hidden="true" />}
					<p className="text-xs font-medium uppercase tracking-[0.06em]">Pricing opportunities</p>
				</div>
				<p className="mt-2 text-3xl font-light text-text-primary">{formatCount(pricePosition.moreExpensive)}</p>
				<p className="mt-1 text-sm text-text-muted">products where Vizaje is more expensive than the competitor</p>
			</div>
		</div>
	)
}
