import { formatCount, formatPercent } from '../lib/format'
import type { DashboardSummary } from '../types/dashboard'

type CoverageSectionProps = {
	summary: DashboardSummary
}

// Product-count vs offer-count are kept visually and textually distinct
// (per the brief) - offerCoverage can exceed productCoverage when a
// product matches both competitors, and conflating them would silently
// double-count.
export function CoverageSection({ summary }: CoverageSectionProps) {
	const { universe, coverage } = summary

	const bars = [
		{ label: 'Any competitor', count: coverage.productCoverage, tone: 'accent' as const },
		{ label: 'MAKEUP', count: coverage.makeupCoverage, tone: 'neutral' as const },
		{ label: 'OVICO', count: coverage.ovicoCoverage, tone: 'neutral' as const },
		{ label: 'Both competitors', count: coverage.bothCoverage, tone: 'neutral' as const }
	]

	return (
		<section className="rounded border border-hairline bg-card p-5">
			<h2 className="font-medium text-text-primary">Coverage</h2>
			<p className="mt-1 text-sm text-text-muted">
				Share of {formatCount(universe.eligibleMonitoredProducts)} products currently eligible for competitor price monitoring (website-confirmed, not excluded by brand or
				product policy) with at least one confirmed competitor match. Product coverage counts each product once, even if it matches both competitors; offer coverage below
				counts every confirmed match row.
			</p>

			<div className="mt-4 flex flex-col gap-3">
				{bars.map(bar => {
					const percent = universe.eligibleMonitoredProducts > 0 ? (bar.count / universe.eligibleMonitoredProducts) * 100 : 0
					return (
						<div key={bar.label}>
							<div className="flex items-baseline justify-between text-sm">
								<span className="text-text-secondary">{bar.label}</span>
								<span className="tabular-nums text-text-muted">
									{formatCount(bar.count)} ({formatPercent(percent)})
								</span>
							</div>
							<div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={`${bar.label} coverage`}>
								<div className={`h-full rounded-full ${bar.tone === 'accent' ? 'bg-accent' : 'bg-text-muted'}`} style={{ width: `${percent}%` }} />
							</div>
						</div>
					)
				})}
			</div>

			<p className="mt-4 text-xs text-text-muted">Offer coverage (total confirmed match rows, can exceed product coverage): {formatCount(coverage.offerCoverage)}</p>
		</section>
	)
}
