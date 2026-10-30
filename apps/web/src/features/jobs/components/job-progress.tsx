import type { JobRun } from '../types/job'
import { computeLimitedProgress, formatElapsedSeconds } from '../lib/job-progress-math'

type JobProgressProps = {
	job: JobRun
}

// Limited mode has a real, known total -> a real progress bar.
// Continuous mode has no total by design (it runs until the pool is
// exhausted or stopped) -> deliberately no percentage/bar, just the raw
// counters + elapsed time (brief: "explicitly NO fake percentage").
export function JobProgress({ job }: JobProgressProps) {
	if (job.mode === 'limited') {
		const { processed, limit, percent } = computeLimitedProgress(job.processedCount, job.params.limit ?? 0)

		return (
			<div>
				<div className="flex items-baseline justify-between text-sm">
					<span className="text-text-secondary">
						<span className="font-medium tabular-nums text-text-primary">{processed}</span> / {limit} processed
					</span>
					<span className="text-text-muted tabular-nums">{percent}%</span>
				</div>

				<div
					role="progressbar"
					aria-valuenow={processed}
					aria-valuemin={0}
					aria-valuemax={limit}
					aria-label="Job progress"
					className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface"
				>
					<div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
				</div>
			</div>
		)
	}

	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
			<span className="text-text-secondary">
				<span className="font-medium tabular-nums text-text-primary">{job.processedCount}</span> products processed
			</span>
			<span className="text-text-muted">Continuous mode - no fixed total</span>
			<ElapsedTime startedAt={job.startedAt} finishedAt={job.finishedAt} />
		</div>
	)
}

export function ElapsedTime({ startedAt, finishedAt }: { startedAt: string | null; finishedAt: string | null }) {
	if (!startedAt) return null

	const start = new Date(startedAt).getTime()
	const end = finishedAt ? new Date(finishedAt).getTime() : Date.now()
	const label = formatElapsedSeconds((end - start) / 1000)

	return (
		<span className="text-text-muted">
			{finishedAt ? 'Ran for' : 'Elapsed'} <span className="tabular-nums text-text-secondary">{label}</span>
		</span>
	)
}
