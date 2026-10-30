'use client'

import { AlertTriangle, CheckCircle2, Circle, Info } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { useJobEvents } from '../queries/use-job-events'
import type { JobEvent, JobStatus } from '../types/job'
import { presentEvent } from '../lib/job-labels'

type JobEventTimelineProps = {
	jobId: number
	jobStatus: JobStatus
}

const PAGE_SIZE = 50

export function JobEventTimeline({ jobId, jobStatus }: JobEventTimelineProps) {
	const [page, setPage] = useState(1)
	const { data, isLoading, isError } = useJobEvents(jobId, { page, limit: PAGE_SIZE }, jobStatus)

	if (isError) {
		return <p className="text-sm text-text-muted">Failed to load the event timeline.</p>
	}

	if (isLoading) {
		return (
			<div className="flex flex-col gap-2">
				{Array.from({ length: 4 }).map((_, index) => (
					<Skeleton key={index} className="h-10 w-full rounded" />
				))}
			</div>
		)
	}

	const items = data?.items ?? []

	if (items.length === 0) {
		return (
			<div className="rounded border border-hairline bg-surface py-10 text-center">
				<p className="text-sm text-text-muted">Waiting for activity…</p>
			</div>
		)
	}

	const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

	return (
		<div>
			<ol className="flex flex-col gap-2">
				{items.map(event => (
					<EventRow key={event.id} event={event} />
				))}
			</ol>

			{totalPages > 1 && (
				<nav aria-label="Event pagination" className="mt-4 flex items-center justify-center gap-3">
					<button
						type="button"
						disabled={page <= 1}
						onClick={() => setPage(p => p - 1)}
						className="rounded border border-hairline bg-card px-3 py-1.5 text-sm text-text-secondary disabled:opacity-40"
					>
						Previous
					</button>
					<span className="text-sm text-text-muted">
						Page {page} / {totalPages}
					</span>
					<button
						type="button"
						disabled={page >= totalPages}
						onClick={() => setPage(p => p + 1)}
						className="rounded border border-hairline bg-card px-3 py-1.5 text-sm text-text-secondary disabled:opacity-40"
					>
						Next
					</button>
				</nav>
			)}
		</div>
	)
}

const TONE_ICON = {
	neutral: Circle,
	success: CheckCircle2,
	warning: AlertTriangle,
	danger: AlertTriangle
}

const TONE_CLASS = {
	neutral: 'text-text-muted',
	success: 'text-accent',
	warning: 'text-text-secondary',
	danger: 'text-destructive'
}

function EventRow({ event }: { event: JobEvent }) {
	const [showRaw, setShowRaw] = useState(false)
	const presentation = presentEvent(event)
	const Icon = TONE_ICON[presentation.tone]

	return (
		<li className="rounded border border-hairline bg-card px-3 py-2">
			<div className="flex items-start gap-2.5">
				<Icon className={`mt-0.5 size-4 shrink-0 ${TONE_CLASS[presentation.tone]}`} aria-hidden="true" />

				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<p className="text-sm font-medium text-text-primary">{presentation.label}</p>
						<time dateTime={event.createdAt} className="shrink-0 text-xs tabular-nums text-text-muted">
							{new Date(event.createdAt).toLocaleString('ro-MD')}
						</time>
					</div>

					{presentation.message && <p className="mt-0.5 text-sm text-text-secondary">{presentation.message}</p>}

					{event.productId !== null && (
						<Link href={`/products/${event.productId}`} className="mt-0.5 inline-block text-xs text-accent hover:underline">
							View product #{event.productId}
						</Link>
					)}

					{event.data && Object.keys(event.data).length > 0 && (
						<button
							type="button"
							onClick={() => setShowRaw(v => !v)}
							className="mt-1 inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
							aria-expanded={showRaw}
						>
							<Info className="size-3" aria-hidden="true" />
							{showRaw ? 'Hide technical details' : 'Technical details'}
						</button>
					)}

					{showRaw && (
						<pre className="mt-1 overflow-x-auto rounded bg-surface p-2 text-xs text-text-secondary">
							{JSON.stringify(event.data, null, 2)}
						</pre>
					)}
				</div>
			</div>
		</li>
	)
}
