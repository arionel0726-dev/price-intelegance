import { formatCount } from '../lib/format'
import type { DashboardSummary } from '../types/dashboard'

type GapDistributionChartProps = {
	summary: DashboardSummary
}

// Plain CSS bars - no charting library needed/installed (per the brief).
// Every bar's count is also given as plain text next to it, so the
// distribution is never color-only or chart-only.
export function GapDistributionChart({ summary }: GapDistributionChartProps) {
	const buckets = summary.gapDistribution
	const max = Math.max(1, ...buckets.map(b => b.count))

	return (
		<section className="rounded border border-hairline bg-card p-5">
			<h2 className="font-medium text-text-primary">Gap distribution</h2>
			<p className="mt-1 text-sm text-text-muted">How far Vizaje's price sits from the competitor's, across every comparable product.</p>

			<ul className="mt-4 flex flex-col gap-2">
				{buckets.map(bucket => {
					const widthPercent = (bucket.count / max) * 100
					const isEqualBucket = bucket.key === 'approximately_equal'
					return (
						<li key={bucket.key} className="flex items-center gap-3 text-sm">
							<span className="w-56 shrink-0 text-text-secondary">{bucket.label}</span>
							<div className="flex-1 overflow-hidden rounded bg-surface">
								<div className={`h-4 rounded ${isEqualBucket ? 'bg-text-muted' : 'bg-accent'}`} style={{ width: `${widthPercent}%` }} />
							</div>
							<span className="w-10 shrink-0 text-right tabular-nums text-text-muted">{formatCount(bucket.count)}</span>
						</li>
					)
				})}
			</ul>
		</section>
	)
}
