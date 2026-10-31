'use client'

import { Skeleton } from '@/components/ui/skeleton'

import { formatCount, formatPercent } from '../lib/format'
import { useDashboardSummary } from '../queries/use-dashboard'

// MAKEUP vs OVICO, side by side - descriptive, not judgmental (no
// "winner"/"loser" framing, just the same metrics shown per competitor).
export function CompetitorBreakdown() {
	const makeup = useDashboardSummary('makeup')
	const ovico = useDashboardSummary('ovico')

	if (makeup.isLoading || ovico.isLoading) {
		return <Skeleton className="h-40 w-full rounded" />
	}

	if (makeup.isError || ovico.isError) {
		return (
			<div className="rounded border border-hairline bg-card p-6">
				<p className="text-sm text-text-muted">Failed to load competitor breakdown.</p>
			</div>
		)
	}

	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{([{ label: 'MAKEUP', data: makeup.data }, { label: 'OVICO', data: ovico.data }] as const).map(({ label, data }) => (
				<div key={label} className="rounded border border-hairline bg-card p-5">
					<h3 className="font-medium text-text-primary">{label}</h3>
					{data && (
						<dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
							<Fact label="Coverage" value={formatPercent(data.coverage.coveragePercent)} />
							<Fact label="Comparable products" value={formatCount(data.universe.comparableProducts)} />
							<Fact label="More expensive" value={formatCount(data.pricePosition.moreExpensive)} />
							<Fact label="Cheaper" value={formatCount(data.pricePosition.cheaper)} />
							<Fact label="Avg gap" value={data.avgGapPercent !== null ? `${data.avgGapPercent.toFixed(1)}%` : '—'} />
							<Fact label="Median gap" value={data.medianGapPercent !== null ? `${data.medianGapPercent.toFixed(1)}%` : '—'} />
						</dl>
					)}
				</div>
			))}
		</div>
	)
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-xs text-text-muted">{label}</dt>
			<dd className="font-medium tabular-nums text-text-primary">{value}</dd>
		</div>
	)
}
