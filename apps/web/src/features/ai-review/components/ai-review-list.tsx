'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Skeleton } from '@/components/ui/skeleton'

import { useAiReviewList } from '../queries/use-ai-review-list'
import { AiReviewCard } from './ai-review-card'

const PAGE_SIZE = 20

// URL-driven page/competitor filter, same pattern as the catalog (see
// features/products/lib/catalog-url-state.ts) - kept inline here since
// this list has only two params, not enough to warrant its own module.
export function AiReviewList() {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()

	const page = Math.max(1, Number(searchParams.get('page')) || 1)
	const competitor = searchParams.get('competitor') ?? undefined

	const { data, isLoading, isPlaceholderData, isError } = useAiReviewList({
		page,
		limit: PAGE_SIZE,
		competitor,
		reviewStatus: 'pending'
	})

	function goToPage(nextPage: number) {
		const query = new URLSearchParams(searchParams.toString())
		if (nextPage <= 1) query.delete('page')
		else query.set('page', String(nextPage))
		router.push(query.toString() ? `${pathname}?${query.toString()}` : pathname)
	}

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-8">
				<h2 className="font-medium text-text-primary">Failed to load the AI review queue</h2>
				<p className="mt-1 text-sm text-text-muted">Make sure the API and PostgreSQL are running.</p>
			</div>
		)
	}

	if (isLoading) {
		return (
			<div className="flex flex-col gap-4">
				{Array.from({ length: 3 }).map((_, index) => (
					<Skeleton key={index} className="h-48 w-full rounded" />
				))}
			</div>
		)
	}

	const items = data?.items ?? []

	return (
		<div className={isPlaceholderData ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
			<p className="mb-4 text-sm text-text-muted" aria-live="polite">
				{data?.total ?? 0} candidate{data?.total === 1 ? '' : 's'} awaiting review
			</p>

			{items.length === 0 ? (
				<div className="rounded border border-hairline bg-card py-24 text-center">
					<h2 className="font-medium text-text-primary">Nothing to review</h2>
					<p className="mt-2 text-sm text-text-muted">New ambiguous matches will show up here.</p>
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{items.map(candidate => (
						<AiReviewCard key={candidate.id} candidate={candidate} />
					))}
				</div>
			)}

			{data && data.total > PAGE_SIZE && (
				<nav aria-label="Pagination" className="mt-6 flex items-center justify-center gap-3">
					<button
						type="button"
						disabled={page <= 1}
						onClick={() => goToPage(page - 1)}
						className="rounded border border-hairline bg-card px-4 py-2 text-sm text-text-secondary disabled:opacity-40"
					>
						Previous
					</button>
					<span className="text-sm text-text-muted">Page {page}</span>
					<button
						type="button"
						disabled={page * PAGE_SIZE >= data.total}
						onClick={() => goToPage(page + 1)}
						className="rounded border border-hairline bg-card px-4 py-2 text-sm text-text-secondary disabled:opacity-40"
					>
						Next
					</button>
				</nav>
			)}
		</div>
	)
}
