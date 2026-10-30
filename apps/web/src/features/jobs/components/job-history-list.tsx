'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import {
	JOB_HISTORY_DEFAULTS,
	parseJobHistorySearchParams,
	readJobsPreferences,
	resolveJobHistoryFilters,
	serializeJobHistoryFilters,
	writeJobsPreferences,
	type JobHistoryFilters
} from '../lib/jobs-url-state'
import { describeStopReason } from '../lib/job-labels'
import { useJobsList } from '../queries/use-jobs-list'
import { JobStatusBadge } from './job-status-badge'
import type { JobCompetitor, JobRun, JobStatus } from '../types/job'

const HISTORY_POLL_MS = 15000

const STATUS_OPTIONS: Array<JobStatus | 'all'> = ['all', 'queued', 'running', 'stopping', 'completed', 'failed', 'cancelled']
const COMPETITOR_OPTIONS: Array<JobCompetitor | 'all'> = ['all', 'makeup', 'ovico']

export function JobHistoryList() {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()

	const fromUrl = parseJobHistorySearchParams(searchParams)
	const filters = resolveJobHistoryFilters(fromUrl)

	const [pageSize, setPageSize] = useState(20)
	useEffect(() => {
		setPageSize(readJobsPreferences().pageSize)
	}, [])

	function buildUrl(next: Partial<JobHistoryFilters>): string {
		const query = serializeJobHistoryFilters({ ...filters, ...next })
		return query ? `${pathname}?${query}` : pathname
	}

	function commitFilterChange(next: Partial<JobHistoryFilters>) {
		router.push(buildUrl({ ...next, page: JOB_HISTORY_DEFAULTS.page }), { scroll: false })
	}

	function changePage(page: number) {
		router.push(buildUrl({ page }))
	}

	function changePageSize(size: number) {
		setPageSize(size)
		writeJobsPreferences({ pageSize: size })
		router.push(buildUrl({ page: JOB_HISTORY_DEFAULTS.page }), { scroll: false })
	}

	const { data, isLoading, isPlaceholderData, isError } = useJobsList(
		{
			page: filters.page,
			limit: pageSize,
			competitor: filters.competitor === 'all' ? undefined : filters.competitor,
			status: filters.status === 'all' ? undefined : filters.status
		},
		{ refetchInterval: HISTORY_POLL_MS }
	)

	const items = data?.items ?? []
	const total = data?.total ?? 0
	const totalPages = Math.max(1, Math.ceil(total / pageSize))
	const hasActiveFilters = filters.competitor !== 'all' || filters.status !== 'all'

	return (
		<div>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<h2 className="font-medium text-text-primary">Job history</h2>

				<div className="flex flex-wrap items-center gap-3">
					<Select value={filters.competitor} onValueChange={value => value && commitFilterChange({ competitor: value as JobCompetitor | 'all' })}>
						<SelectTrigger aria-label="Filter by competitor" className="w-[150px] rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{COMPETITOR_OPTIONS.map(option => (
								<SelectItem key={option} value={option}>
									{option === 'all' ? 'All competitors' : option.toUpperCase()}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select value={filters.status} onValueChange={value => value && commitFilterChange({ status: value as JobStatus | 'all' })}>
						<SelectTrigger aria-label="Filter by status" className="w-[150px] rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{STATUS_OPTIONS.map(option => (
								<SelectItem key={option} value={option}>
									{option === 'all' ? 'All statuses' : option.charAt(0).toUpperCase() + option.slice(1)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					<Select value={String(pageSize)} onValueChange={value => value && changePageSize(Number(value))}>
						<SelectTrigger aria-label="Rows per page" className="w-[110px] rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{[10, 20, 50].map(size => (
								<SelectItem key={size} value={String(size)}>
									{size} / page
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{isError ? (
				<div className="mt-4 rounded border border-hairline bg-card p-6">
					<p className="text-sm text-text-muted">Failed to load job history.</p>
				</div>
			) : isLoading ? (
				<div className="mt-4 flex flex-col gap-2">
					{Array.from({ length: 4 }).map((_, index) => (
						<Skeleton key={index} className="h-14 w-full rounded" />
					))}
				</div>
			) : items.length === 0 ? (
				<div className="mt-4 rounded border border-hairline bg-surface py-16 text-center">
					<h3 className="font-medium text-text-primary">{hasActiveFilters ? 'No jobs match these filters' : 'No jobs yet'}</h3>
					<p className="mt-2 text-sm text-text-muted">
						{hasActiveFilters ? 'Try a different competitor or status filter.' : 'Start a discovery job above to see it here.'}
					</p>
				</div>
			) : (
				<div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
					<HistoryTable items={items} />
					<HistoryCards items={items} />
				</div>
			)}

			{totalPages > 1 && (
				<nav aria-label="Job history pagination" className="mt-6 flex items-center justify-center gap-3">
					<button
						type="button"
						disabled={filters.page <= 1}
						onClick={() => changePage(filters.page - 1)}
						className="rounded border border-hairline bg-card px-4 py-2 text-sm text-text-secondary disabled:opacity-40"
					>
						Previous
					</button>
					<span className="text-sm text-text-muted">
						Page {filters.page} / {totalPages}
					</span>
					<button
						type="button"
						disabled={filters.page >= totalPages}
						onClick={() => changePage(filters.page + 1)}
						className="rounded border border-hairline bg-card px-4 py-2 text-sm text-text-secondary disabled:opacity-40"
					>
						Next
					</button>
				</nav>
			)}
		</div>
	)
}

function resultSummary(job: JobRun): string {
	if (job.status === 'failed') return describeStopReason(job.stopReason) ?? 'Failed'
	if (job.status === 'cancelled') return describeStopReason(job.stopReason) ?? 'Cancelled'
	if (job.status === 'completed') return `${job.processedCount} processed`
	return '—'
}

function formatDate(value: string | null): string {
	if (!value) return '—'
	return new Date(value).toLocaleString('ro-MD')
}

// Desktop/tablet: a real table. Hidden below `sm` in favor of HistoryCards.
function HistoryTable({ items }: { items: JobRun[] }) {
	return (
		<table className="mt-4 hidden w-full border-collapse text-sm sm:table">
			<thead>
				<tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.06em] text-text-muted">
					<th className="py-2 pr-3">Competitor</th>
					<th className="py-2 pr-3">Mode</th>
					<th className="py-2 pr-3">Status</th>
					<th className="py-2 pr-3">Brand</th>
					<th className="py-2 pr-3">Started</th>
					<th className="py-2 pr-3">Finished</th>
					<th className="py-2 pr-3">Processed</th>
					<th className="py-2">Result</th>
				</tr>
			</thead>
			<tbody>
				{items.map(job => (
					<tr key={job.id} className="border-b border-hairline last:border-0">
						<td className="py-2.5 pr-3">
							<Link href={`/jobs/${job.id}`} className="font-medium text-text-primary hover:text-accent">
								{job.competitorName || job.competitorSlug?.toUpperCase() || '—'}
							</Link>
						</td>
						<td className="py-2.5 pr-3 text-text-secondary">{job.mode === 'limited' ? 'Limited' : 'Continuous'}</td>
						<td className="py-2.5 pr-3">
							<JobStatusBadge status={job.status} />
						</td>
						<td className="py-2.5 pr-3 text-text-secondary">{job.params.brand ?? 'All'}</td>
						<td className="py-2.5 pr-3 text-text-muted">{formatDate(job.startedAt)}</td>
						<td className="py-2.5 pr-3 text-text-muted">{formatDate(job.finishedAt)}</td>
						<td className="py-2.5 pr-3 tabular-nums text-text-secondary">{job.processedCount}</td>
						<td className="py-2.5 text-text-secondary">{resultSummary(job)}</td>
					</tr>
				))}
			</tbody>
		</table>
	)
}

// Mobile: stacked cards instead of a cramped table.
function HistoryCards({ items }: { items: JobRun[] }) {
	return (
		<div className="mt-4 flex flex-col gap-3 sm:hidden">
			{items.map(job => (
				<Link
					key={job.id}
					href={`/jobs/${job.id}`}
					className="block rounded border border-hairline bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					<div className="flex items-center justify-between gap-2">
						<span className="font-medium text-text-primary">{job.competitorName || job.competitorSlug?.toUpperCase() || '—'}</span>
						<JobStatusBadge status={job.status} />
					</div>
					<dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-secondary">
						<div>
							<dt className="text-text-muted">Mode</dt>
							<dd>{job.mode === 'limited' ? 'Limited' : 'Continuous'}</dd>
						</div>
						<div>
							<dt className="text-text-muted">Brand</dt>
							<dd>{job.params.brand ?? 'All'}</dd>
						</div>
						<div>
							<dt className="text-text-muted">Started</dt>
							<dd>{formatDate(job.startedAt)}</dd>
						</div>
						<div>
							<dt className="text-text-muted">Processed</dt>
							<dd className="tabular-nums">{job.processedCount}</dd>
						</div>
					</dl>
					<p className="mt-2 text-xs text-text-secondary">{resultSummary(job)}</p>
				</Link>
			))}
		</div>
	)
}
