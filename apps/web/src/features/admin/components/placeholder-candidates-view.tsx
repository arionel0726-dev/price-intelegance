'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import { useAddPlaceholder, usePlaceholderCandidates } from '../queries/use-placeholders'

const DEFAULT_THRESHOLD = 3

export function PlaceholderCandidatesView() {
	const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
	const { data, isLoading, isError } = usePlaceholderCandidates(threshold)
	const add = useAddPlaceholder()

	return (
		<div>
			<div className="flex items-center gap-2">
				<label htmlFor="candidate-threshold" className="text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
					Threshold (occurrences)
				</label>
				<input
					id="candidate-threshold"
					type="number"
					min={2}
					value={threshold}
					onChange={event => setThreshold(Math.max(2, Number(event.target.value) || 2))}
					className="h-8 w-20 rounded border border-hairline bg-card px-2 text-sm"
				/>
			</div>

			{isError ? (
				<p className="mt-3 text-sm text-text-muted">Failed to load candidates.</p>
			) : isLoading ? (
				<Skeleton className="mt-3 h-32 w-full rounded" />
			) : (data?.length ?? 0) === 0 ? (
				<div className="mt-3 rounded border border-hairline bg-surface py-10 text-center">
					<p className="text-sm text-text-muted">No image URL is repeated at or above this threshold.</p>
				</div>
			) : (
				<ul className="mt-3 flex flex-col gap-2">
					{data!.map(candidate => (
						<li key={candidate.imageUrl} className="rounded border border-hairline bg-card p-3">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="truncate text-sm font-medium text-text-primary">{candidate.imageUrl}</p>
									<p className="text-xs text-text-muted">
										{candidate.occurrences} occurrences · sample: {candidate.sample.map(p => p.name).join(', ')}
									</p>
								</div>
								<Button
									size="sm"
									disabled={add.isPending}
									onClick={() => add.mutate({ imageUrl: candidate.imageUrl })}
									className="shrink-0 rounded bg-accent text-white hover:bg-accent/90"
								>
									Confirm as placeholder
								</Button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
