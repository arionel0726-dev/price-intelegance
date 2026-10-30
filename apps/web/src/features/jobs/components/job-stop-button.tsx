import { Square } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { canStopJob } from '../lib/job-polling'
import { useStopJob } from '../queries/use-stop-job'
import type { JobRun } from '../types/job'

type JobStopButtonProps = {
	job: JobRun
}

// Visible only when meaningful (queued/running/stopping - a terminal job
// has nothing left to stop). Disables itself on click to prevent a
// duplicate stop submission while the request is in flight.
export function JobStopButton({ job }: JobStopButtonProps) {
	const stop = useStopJob(job.id)

	if (!canStopJob(job.status)) return null

	const disabled = stop.isPending || job.status === 'stopping'

	return (
		<Button
			variant="outline"
			size="sm"
			disabled={disabled}
			onClick={() => stop.mutate()}
			aria-label={`Stop discovery job ${job.id}`}
			className="gap-1.5 rounded border-hairline text-text-secondary hover:border-destructive hover:text-destructive"
		>
			<Square className="size-3.5" aria-hidden="true" />
			{job.status === 'stopping' ? 'Stopping…' : 'Stop job'}
		</Button>
	)
}
