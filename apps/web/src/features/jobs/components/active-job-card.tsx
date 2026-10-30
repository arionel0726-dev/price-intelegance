import Link from 'next/link'

import { JobCounters } from './job-counters'
import { JobCurrentProduct } from './job-current-product'
import { JobProgress } from './job-progress'
import { JobStatusBadge } from './job-status-badge'
import { JobStopButton } from './job-stop-button'
import type { JobRun } from '../types/job'

type ActiveJobCardProps = {
	job: JobRun
}

// One card per competitor that currently has an active job (there can be
// up to two at once - one per competitor, see job_runs_active_per_
// competitor). Links through to the full /jobs/[id] detail for the event
// timeline and failure details.
export function ActiveJobCard({ job }: ActiveJobCardProps) {
	return (
		<article className="rounded border border-hairline bg-card p-5">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Link href={`/jobs/${job.id}`} className="font-medium text-text-primary hover:text-accent">
						{job.competitorName || job.competitorSlug?.toUpperCase()}
					</Link>
					<JobStatusBadge status={job.status} />
					<span className="text-xs text-text-muted">{job.mode === 'limited' ? 'Limited' : 'Continuous'}</span>
				</div>
				<JobStopButton job={job} />
			</div>

			<div className="mt-4">
				<JobProgress job={job} />
			</div>

			{job.currentProductId !== null && (
				<div className="mt-3">
					<JobCurrentProduct productId={job.currentProductId} />
				</div>
			)}

			<div className="mt-4">
				<JobCounters job={job} />
			</div>

			<Link href={`/jobs/${job.id}`} className="mt-4 inline-block text-sm text-accent hover:underline">
				View full details →
			</Link>
		</article>
	)
}
