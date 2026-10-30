import { AlertTriangle, Check, RotateCcw, XCircle } from 'lucide-react'
import Link from 'next/link'

import { buildJobCounterSummary } from '../lib/job-counters-math'
import type { JobRun } from '../types/job'

type JobCountersProps = {
	job: JobRun
}

// Grouped exactly per the brief: Confirmed (autoCount + aiAutoCount),
// Needs review (aiReviewCount - a LIVE current count, see M3's
// recomputeCounters semantics: it can go back down after the job
// finishes as AI/manual review resolves candidates, it's not a frozen
// job-completion-time snapshot), No match, Errors, Retries.
export function JobCounters({ job }: JobCountersProps) {
	const summary = buildJobCounterSummary(job)

	return (
		<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
			<Counter icon={Check} tone="success" label="Confirmed" value={summary.confirmed} />
			<NeedsReviewCounter value={summary.needsReview} />
			<Counter icon={XCircle} tone="neutral" label="No match" value={summary.noMatch} />
			<Counter icon={AlertTriangle} tone="danger" label="Errors" value={summary.errors} />
			<Counter icon={RotateCcw} tone="neutral" label="Retries" value={summary.retries} />
		</div>
	)
}

function NeedsReviewCounter({ value }: { value: number }) {
	return (
		<div className="rounded border border-hairline bg-card p-3">
			<div className="flex items-center gap-1.5 text-xs text-text-muted">
				<AlertTriangle className="size-3.5" aria-hidden="true" />
				Needs review
			</div>
			<p className="mt-1 text-xl font-light tabular-nums text-text-primary">{value}</p>
			{value > 0 && (
				<Link href="/ai-review" className="mt-1 inline-block text-xs text-accent hover:underline">
					{value} candidate{value === 1 ? '' : 's'} need review → Open AI Review
				</Link>
			)}
		</div>
	)
}

const TONE_CLASS: Record<'success' | 'neutral' | 'danger', string> = {
	success: 'text-accent',
	neutral: 'text-text-muted',
	danger: 'text-destructive'
}

function Counter({
	icon: Icon,
	tone,
	label,
	value
}: {
	icon: typeof Check
	tone: 'success' | 'neutral' | 'danger'
	label: string
	value: number
}) {
	return (
		<div className="rounded border border-hairline bg-card p-3">
			<div className={`flex items-center gap-1.5 text-xs text-text-muted`}>
				<Icon className={`size-3.5 ${value > 0 ? TONE_CLASS[tone] : ''}`} aria-hidden="true" />
				{label}
			</div>
			<p className="mt-1 text-xl font-light tabular-nums text-text-primary">{value}</p>
		</div>
	)
}
