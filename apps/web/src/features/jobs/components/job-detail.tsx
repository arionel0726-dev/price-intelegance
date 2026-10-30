'use client'

import Link from 'next/link'

import { Skeleton } from '@/components/ui/skeleton'

import { useJobDetail } from '../queries/use-job-detail'
import { describeFailureClass, describeStopReason, PRODUCT_BUDGET_OPTIONS } from '../lib/job-labels'
import { JobCounters } from './job-counters'
import { JobCurrentProduct } from './job-current-product'
import { JobEventTimeline } from './job-event-timeline'
import { ElapsedTime, JobProgress } from './job-progress'
import { JobStatusBadge } from './job-status-badge'
import { JobStopButton } from './job-stop-button'

type JobDetailProps = {
	jobId: number
}

export function JobDetail({ jobId }: JobDetailProps) {
	const { data: job, isLoading, isError } = useJobDetail(jobId)

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-8">
				<h2 className="font-medium text-text-primary">Job not found</h2>
				<p className="mt-1 text-sm text-text-muted">
					<Link href="/jobs" className="text-accent hover:underline">
						Back to jobs
					</Link>
				</p>
			</div>
		)
	}

	if (isLoading || !job) {
		return (
			<div className="flex flex-col gap-4">
				<Skeleton className="h-10 w-1/2 rounded" />
				<Skeleton className="h-32 w-full rounded" />
				<Skeleton className="h-48 w-full rounded" />
			</div>
		)
	}

	const budgetLabel = PRODUCT_BUDGET_OPTIONS.find(o => o.seconds === job.params.productBudgetSeconds)?.label ?? `${job.params.productBudgetSeconds}s`

	return (
		<div className="flex flex-col gap-6">
			<div>
				<Link href="/jobs" className="text-sm text-text-muted hover:text-text-primary">
					← All jobs
				</Link>

				<div className="mt-2 flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<h1 className="text-2xl font-light tracking-tight text-text-primary">
							Job #{job.id} — {job.competitorName || job.competitorSlug?.toUpperCase()}
						</h1>
						<JobStatusBadge status={job.status} />
					</div>
					<JobStopButton job={job} />
				</div>
			</div>

			<section className="rounded border border-hairline bg-card p-5">
				<h2 className="text-sm font-medium uppercase tracking-[0.06em] text-text-muted">Progress</h2>
				<div className="mt-3">
					<JobProgress job={job} />
				</div>
				{job.currentProductId !== null && job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled' && (
					<div className="mt-3">
						<p className="mb-1 text-xs text-text-muted">Currently checking</p>
						<JobCurrentProduct productId={job.currentProductId} />
					</div>
				)}
			</section>

			{(job.status === 'failed' || job.status === 'cancelled') && (
				<section className="rounded border border-destructive/40 bg-destructive/5 p-5">
					<h2 className="text-sm font-medium uppercase tracking-[0.06em] text-destructive">
						{job.status === 'failed' ? 'Failure details' : 'Cancellation details'}
					</h2>
					<dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
						<div>
							<dt className="text-text-muted">Reason</dt>
							<dd className="text-text-primary">{describeStopReason(job.stopReason) ?? '—'}</dd>
						</div>
						{job.failureClass && (
							<div>
								<dt className="text-text-muted">Category</dt>
								<dd className="text-text-primary">{describeFailureClass(job.failureClass)}</dd>
							</div>
						)}
						{job.error && (
							<div className="sm:col-span-2">
								<dt className="text-text-muted">Error</dt>
								<dd className="text-text-primary">{job.error}</dd>
							</div>
						)}
					</dl>
				</section>
			)}

			<section className="rounded border border-hairline bg-card p-5">
				<h2 className="text-sm font-medium uppercase tracking-[0.06em] text-text-muted">Results</h2>
				<div className="mt-3">
					<JobCounters job={job} />
				</div>
			</section>

			<section className="rounded border border-hairline bg-card p-5">
				<h2 className="text-sm font-medium uppercase tracking-[0.06em] text-text-muted">Parameters</h2>
				<dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
					<Param label="Mode" value={job.mode === 'limited' ? 'Limited' : 'Continuous'} />
					<Param label="Brand filter" value={job.params.brand ?? 'All brands'} />
					<Param label="In stock only" value={job.params.inStock ? 'Yes' : 'No'} />
					<Param label="Only unmatched" value={job.params.onlyUnmatched ? 'Yes' : 'No'} />
					{job.mode === 'limited' && <Param label="Limit" value={String(job.params.limit)} />}
					<Param label="Time budget / product" value={budgetLabel} />
				</dl>
			</section>

			<section className="rounded border border-hairline bg-card p-5">
				<h2 className="text-sm font-medium uppercase tracking-[0.06em] text-text-muted">Timestamps</h2>
				<dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
					<Param label="Created" value={new Date(job.createdAt).toLocaleString('ro-MD')} />
					<Param label="Started" value={job.startedAt ? new Date(job.startedAt).toLocaleString('ro-MD') : '—'} />
					<Param label="Finished" value={job.finishedAt ? new Date(job.finishedAt).toLocaleString('ro-MD') : '—'} />
					<div>
						<dt className="text-xs text-text-muted">Elapsed</dt>
						<dd className="text-text-primary">
							<ElapsedTime startedAt={job.startedAt} finishedAt={job.finishedAt} /> {!job.startedAt && '—'}
						</dd>
					</div>
				</dl>
			</section>

			<section>
				<h2 className="mb-3 text-sm font-medium uppercase tracking-[0.06em] text-text-muted">Event timeline</h2>
				<JobEventTimeline jobId={job.id} jobStatus={job.status} />
			</section>
		</div>
	)
}

function Param({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt className="text-xs text-text-muted">{label}</dt>
			<dd className="text-text-primary">{value}</dd>
		</div>
	)
}
