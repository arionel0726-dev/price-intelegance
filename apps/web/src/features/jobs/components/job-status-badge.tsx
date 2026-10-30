import { CheckCircle2, Clock, Loader2, OctagonX, XCircle } from 'lucide-react'

import type { JobStatus } from '../types/job'
import { JOB_STATUS_LABEL } from '../lib/job-labels'

type JobStatusBadgeProps = {
	status: JobStatus
	className?: string
}

// All 6 job_runs statuses, each pairing an icon AND the plain-language
// label - never color-only (see Milestone 4 brief). Tone classes reuse
// the existing accent/destructive/text-muted tokens only, no new colors.
const STATUS_ICON: Record<JobStatus, typeof Clock> = {
	queued: Clock,
	running: Loader2,
	stopping: Loader2,
	completed: CheckCircle2,
	failed: OctagonX,
	cancelled: XCircle
}

const STATUS_TONE: Record<JobStatus, string> = {
	queued: 'border-hairline text-text-secondary',
	running: 'border-accent text-accent',
	stopping: 'border-accent text-accent',
	completed: 'border-hairline text-text-primary',
	failed: 'border-destructive/40 text-destructive',
	cancelled: 'border-hairline text-text-muted'
}

export function JobStatusBadge({ status, className = '' }: JobStatusBadgeProps) {
	const Icon = STATUS_ICON[status]
	const spinning = status === 'running' || status === 'stopping'

	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded border bg-card px-2.5 py-1 text-xs font-medium ${STATUS_TONE[status]} ${className}`}
		>
			<Icon className={`size-3.5 ${spinning ? 'animate-spin' : ''}`} aria-hidden="true" />
			{JOB_STATUS_LABEL[status]}
		</span>
	)
}

export { STATUS_ICON as JOB_STATUS_ICON }
