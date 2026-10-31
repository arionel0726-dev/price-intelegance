'use client'

import { useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { useAdminImages, useDataQualitySummary } from '../queries/use-data-quality'
import { PlaceholderCandidatesView } from './placeholder-candidates-view'
import { PlaceholderRegistry } from './placeholder-registry'

export function DataQualityView() {
	const { data: summary, isLoading, isError } = useDataQualitySummary()
	const [imageState, setImageState] = useState<'all' | 'missing' | 'placeholder' | 'real'>('missing')
	const [page, setPage] = useState(1)

	const { data: images, isLoading: imagesLoading } = useAdminImages({ page, limit: 20, imageState: imageState === 'all' ? undefined : imageState })

	if (isError) return <p className="text-sm text-text-muted">Failed to load data quality summary.</p>

	return (
		<div className="flex flex-col gap-10">
			<section>
				<h2 className="mb-3 font-medium text-text-primary">Summary</h2>
				{isLoading || !summary ? (
					<Skeleton className="h-28 w-full rounded" />
				) : (
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
						<SummaryCard label="Missing images" value={summary.images.missing} />
						<SummaryCard label="Placeholder images" value={summary.images.placeholder} />
						<SummaryCard label="Real images" value={summary.images.real} />
						<SummaryCard label="No URL" value={summary.productsWithNoUrl} />
						<SummaryCard label="Empty brand" value={summary.productsWithEmptyBrand} note="Impossible: brand is NOT NULL in the schema" />
					</div>
				)}
			</section>

			<section>
				<div className="flex items-center justify-between">
					<h2 className="font-medium text-text-primary">Images</h2>
					<Select value={imageState} onValueChange={value => { if (value) { setImageState(value as typeof imageState); setPage(1) } }}>
						<SelectTrigger aria-label="Filter by image state" className="w-[160px] rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="missing">Missing</SelectItem>
							<SelectItem value="placeholder">Placeholder</SelectItem>
							<SelectItem value="real">Real</SelectItem>
							<SelectItem value="all">All</SelectItem>
						</SelectContent>
					</Select>
				</div>

				{imagesLoading || !images ? (
					<Skeleton className="mt-3 h-40 w-full rounded" />
				) : images.items.length === 0 ? (
					<div className="mt-3 rounded border border-hairline bg-surface py-10 text-center">
						<p className="text-sm text-text-muted">No products match this filter.</p>
					</div>
				) : (
					<ul className="mt-3 flex flex-col gap-1">
						{images.items.map(item => (
							<li key={item.id} className="flex items-center justify-between rounded border border-hairline bg-card px-3 py-2 text-sm">
								<span className="truncate">
									<span className="font-medium uppercase tracking-[0.06em] text-text-muted">{item.brand}</span> {item.name}
								</span>
								<span className="shrink-0 text-xs text-text-muted">{item.imageStatus}</span>
							</li>
						))}
					</ul>
				)}

				{images && images.pagination.totalPages > 1 && (
					<nav aria-label="Images pagination" className="mt-4 flex items-center justify-center gap-3">
						<button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded border border-hairline bg-card px-3 py-1.5 text-sm disabled:opacity-40">
							Previous
						</button>
						<span className="text-sm text-text-muted">
							Page {page} / {images.pagination.totalPages}
						</span>
						<button
							type="button"
							disabled={page >= images.pagination.totalPages}
							onClick={() => setPage(p => p + 1)}
							className="rounded border border-hairline bg-card px-3 py-1.5 text-sm disabled:opacity-40"
						>
							Next
						</button>
					</nav>
				)}
			</section>

			<section>
				<h2 className="mb-3 font-medium text-text-primary">Placeholder registry</h2>
				<PlaceholderRegistry />
			</section>

			<section>
				<h2 className="mb-3 font-medium text-text-primary">Placeholder candidates</h2>
				<p className="mb-3 text-sm text-text-muted">Read-only diagnostic - never registers anything automatically.</p>
				<PlaceholderCandidatesView />
			</section>
		</div>
	)
}

function SummaryCard({ label, value, note }: { label: string; value: number; note?: string }) {
	return (
		<div className="rounded border border-hairline bg-card p-3" title={note}>
			<p className="text-xs text-text-muted">{label}</p>
			<p className="mt-1 text-xl font-light tabular-nums text-text-primary">{value}</p>
			{note && <p className="mt-1 text-[11px] text-text-muted">{note}</p>}
		</div>
	)
}
