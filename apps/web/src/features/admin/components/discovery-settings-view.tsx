'use client'

import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { useAdminSettings, usePatchAiSettings } from '../queries/use-admin-settings'

// AI settings are editable (ai.enabled / ai.auto_confirm_threshold -
// business settings, see AppSettingsService). The operational section
// below is read-only by design: env-derived pacing/safety knobs, not
// business settings, per the project's established app_settings-vs-env
// split - visually distinguished with a lock icon and muted styling so
// it never looks like another editable form.
export function DiscoverySettingsView() {
	const { data, isLoading, isError } = useAdminSettings()
	const patch = usePatchAiSettings()

	const [enabled, setEnabled] = useState(false)
	const [thresholdPercent, setThresholdPercent] = useState(90)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (data) {
			setEnabled(data.ai.enabled)
			setThresholdPercent(Math.round(data.ai.autoConfirmThreshold * 100))
		}
	}, [data])

	if (isError) return <p className="text-sm text-text-muted">Failed to load settings.</p>
	if (isLoading || !data) return <Skeleton className="h-64 w-full rounded" />

	function handleSave() {
		const decimal = thresholdPercent / 100
		if (!Number.isFinite(decimal) || decimal < 0 || decimal > 1) {
			setError('Threshold must be between 0% and 100%')
			return
		}
		setError(null)
		patch.mutate({ enabled, autoConfirmThreshold: decimal })
	}

	return (
		<div className="flex flex-col gap-8">
			<section className="rounded border border-hairline bg-card p-5">
				<h2 className="font-medium text-text-primary">AI review settings</h2>
				<p className="mt-1 text-sm text-text-muted">Business settings - editable here.</p>

				<div className="mt-4 flex flex-col gap-4">
					<label className="flex items-center gap-2 text-sm text-text-secondary">
						<input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="size-4 accent-[#0007cb]" />
						AI review enabled
					</label>

					<div>
						<label htmlFor="threshold" className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
							Auto-confirm threshold ({thresholdPercent}%)
						</label>
						<input
							id="threshold"
							type="number"
							min={0}
							max={100}
							value={thresholdPercent}
							onChange={event => setThresholdPercent(Number(event.target.value))}
							className="h-8 w-32 rounded border border-hairline bg-transparent px-2.5 text-sm text-text-primary"
						/>
						<p className="mt-1 text-xs text-text-muted">Stored as a 0-1 decimal ({(thresholdPercent / 100).toFixed(2)}). Out-of-range values are rejected, never clamped.</p>
					</div>

					{error && <p className="text-sm text-destructive" role="alert">{error}</p>}
					{patch.isError && <p className="text-sm text-destructive" role="alert">{patch.error instanceof Error ? patch.error.message : 'Failed to save'}</p>}
					{patch.isSuccess && <p className="text-sm text-accent">Saved.</p>}

					<div>
						<Button onClick={handleSave} disabled={patch.isPending} className="rounded bg-accent text-white hover:bg-accent/90">
							{patch.isPending ? 'Saving…' : 'Save'}
						</Button>
					</div>
				</div>
			</section>

			<section className="rounded border border-hairline bg-surface p-5">
				<div className="flex items-center gap-2">
					<Lock className="size-4 text-text-muted" aria-hidden="true" />
					<h2 className="font-medium text-text-secondary">Operational visibility (read-only)</h2>
				</div>
				<p className="mt-1 text-sm text-text-muted">Environment-derived pacing/safety constants - not editable here.</p>

				<dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
					<Fact label="No-match retry (days)" value={data.operational.discoveryNoMatchRetryDays} />
					<Fact label="Error retry (hours)" value={data.operational.discoveryErrorRetryHours} />
					<Fact label="Product budget presets (s)" value={data.operational.productBudgetPresetsSeconds.join(', ')} />
					<Fact label="Heartbeat interval (ms)" value={data.operational.discoveryHeartbeatIntervalMs} />
					<Fact label="Lease stale after (ms)" value={data.operational.discoveryLeaseStaleMs} />
					<Fact label="Max search-error ratio" value={data.operational.makeupMaxSearchErrorRatio} />
					<Fact label="Max deferred ratio" value={data.operational.makeupMaxDeferredRatio} />
					<Fact label="Max cooldown events/run" value={data.operational.makeupMaxCooldownEventsPerRun} />
					<Fact label="Safety min sample" value={data.operational.discoverySafetyMinSample} />
				</dl>
			</section>
		</div>
	)
}

function Fact({ label, value }: { label: string; value: string | number }) {
	return (
		<div>
			<dt className="text-xs text-text-muted">{label}</dt>
			<dd className="font-medium tabular-nums text-text-secondary">{value}</dd>
		</div>
	)
}
