'use client'

import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

import { useAddPlaceholder, usePlaceholders, useRemovePlaceholder } from '../queries/use-placeholders'

export function PlaceholderRegistry() {
	const { data, isLoading, isError } = usePlaceholders()
	const add = useAddPlaceholder()
	const remove = useRemovePlaceholder()

	const [imageUrl, setImageUrl] = useState('')
	const [note, setNote] = useState('')

	function handleAdd(event: React.FormEvent) {
		event.preventDefault()
		if (!imageUrl.trim()) return
		add.mutate({ imageUrl: imageUrl.trim(), note: note.trim() || null }, { onSuccess: () => { setImageUrl(''); setNote('') } })
	}

	if (isError) return <p className="text-sm text-text-muted">Failed to load placeholder registry.</p>

	return (
		<div>
			<form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
				<div className="min-w-[260px] flex-1">
					<label htmlFor="placeholder-url" className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
						Image URL
					</label>
					<Input id="placeholder-url" value={imageUrl} onChange={event => setImageUrl(event.target.value)} className="h-9 rounded border-hairline bg-card" />
				</div>
				<div className="min-w-[200px] flex-1">
					<label htmlFor="placeholder-note" className="mb-1 block text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
						Note (optional)
					</label>
					<Input id="placeholder-note" value={note} onChange={event => setNote(event.target.value)} className="h-9 rounded border-hairline bg-card" />
				</div>
				<Button type="submit" disabled={add.isPending || !imageUrl.trim()} className="rounded bg-accent text-white hover:bg-accent/90">
					{add.isPending ? 'Adding…' : 'Confirm placeholder'}
				</Button>
			</form>

			{isLoading ? (
				<Skeleton className="mt-4 h-32 w-full rounded" />
			) : (data?.length ?? 0) === 0 ? (
				<div className="mt-4 rounded border border-hairline bg-surface py-10 text-center">
					<p className="text-sm text-text-muted">No confirmed placeholder images yet.</p>
				</div>
			) : (
				<ul className="mt-4 flex flex-col gap-1">
					{data!.map(entry => (
						<li key={entry.imageUrl} className="flex items-center justify-between gap-3 rounded border border-hairline bg-card px-3 py-2 text-sm">
							<div className="min-w-0">
								<p className="truncate font-medium text-text-primary">{entry.imageUrl}</p>
								<p className="text-xs text-text-muted">
									{entry.affectedProductCount} product{entry.affectedProductCount === 1 ? '' : 's'}
									{entry.note ? ` · ${entry.note}` : ''}
									{entry.confirmedBy ? ` · confirmed by ${entry.confirmedBy}` : ''}
								</p>
							</div>
							<button
								type="button"
								aria-label={`Remove ${entry.imageUrl} from the placeholder registry`}
								disabled={remove.isPending}
								onClick={() => remove.mutate(entry.imageUrl)}
								className="shrink-0 text-text-muted hover:text-destructive disabled:opacity-50"
							>
								<Trash2 className="size-4" aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
