'use client'

import { Skeleton } from '@/components/ui/skeleton'

import { useJobsList } from '../queries/use-jobs-list'
import { ActiveJobCard } from './active-job-card'

const ACTIVE_POLL_MS = 4000

// There can be one active job PER COMPETITOR at once (job_runs_active_
// per_competitor), so this renders zero, one, or two cards - never
// assumes "at most one active job overall".
export function ActiveJobsSection() {
	const { data, isLoading, isError } = useJobsList(
		{ status: 'queued,running,stopping', limit: 10 },
		{ refetchInterval: ACTIVE_POLL_MS }
	)

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-6">
				<p className="text-sm text-text-muted">Couldn&apos;t load active jobs.</p>
			</div>
		)
	}

	if (isLoading) {
		return <Skeleton className="h-48 w-full rounded" />
	}

	const items = data?.items ?? []

	if (items.length === 0) {
		return (
			<div className="rounded border border-hairline bg-surface py-10 text-center">
				<p className="text-sm text-text-muted">No active jobs right now.</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			{items.map(job => (
				<ActiveJobCard key={job.id} job={job} />
			))}
		</div>
	)
}
