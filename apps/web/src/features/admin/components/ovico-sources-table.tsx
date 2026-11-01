'use client'

import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import {
	useAddOvicoBrandSource,
	useOvicoBrandSources,
	usePatchOvicoBrandSource,
	useRemoveOvicoBrandSource,
	useSyncOvicoBrandSource
} from '../queries/use-ovico-sources'
import type { OvicoBrandSourcesEntry, OvicoBrandSourceStatus } from '../types/admin'

// Catalog Ingestion v1 (OVICO) - per Vizaje brand: canonical name, number
// of OVICO source pages, each source URL + status + enabled + last
// synced, with add/edit/disable/remove/sync actions. Only brands that
// already have at least one OVICO source row are shown, plus an "add
// source" form at the top keyed by canonical brand - no auto-discovery
// here (per spec), a source only ever comes from this milestone's known
// mappings (seed-ovico-brand-sources.ts) or a human adding one here.
export function OvicoSourcesTable() {
	const { data: entries, isLoading, isError } = useOvicoBrandSources()

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-8">
				<h2 className="font-medium text-text-primary">Failed to load OVICO sources</h2>
			</div>
		)
	}

	if (isLoading) {
		return (
			<div className="flex flex-col gap-2">
				{Array.from({ length: 4 }).map((_, index) => (
					<Skeleton key={index} className="h-16 w-full rounded" />
				))}
			</div>
		)
	}

	const withSources = (entries ?? []).filter(entry => entry.sources.length > 0)

	return (
		<div className="flex flex-col gap-6">
			<AddSourceForm brandOptions={entries ?? []} />

			{withSources.length === 0 ? (
				<div className="rounded border border-hairline bg-card p-8 text-sm text-text-muted">
					No OVICO brand sources yet. Run `bun run scripts/seed-ovico-brand-sources.ts` (from
					apps/api) to persist the milestone&apos;s known mappings, or add one above.
				</div>
			) : (
				<div className="flex flex-col gap-4">
					{withSources.map(entry => (
						<BrandSourcesCard key={entry.brand.canonicalKey} entry={entry} />
					))}
				</div>
			)}
		</div>
	)
}

function AddSourceForm({ brandOptions }: { brandOptions: OvicoBrandSourcesEntry[] }) {
	const add = useAddOvicoBrandSource()
	const [brandId, setBrandId] = useState('')
	const [sourceUrl, setSourceUrl] = useState('')

	function submit(event: React.FormEvent) {
		event.preventDefault()
		if (!brandId || !sourceUrl.trim()) return

		add.mutate(
			{ brandId, sourceUrl: sourceUrl.trim(), status: 'needs_review' },
			{ onSuccess: () => setSourceUrl('') }
		)
	}

	return (
		<form
			onSubmit={submit}
			className="flex flex-wrap items-end gap-3 rounded border border-hairline bg-card p-4"
		>
			<div className="flex flex-col gap-1">
				<label className="text-xs uppercase tracking-[0.1em] text-text-muted" htmlFor="ovico-source-brand">
					Brand
				</label>
				<select
					id="ovico-source-brand"
					value={brandId}
					onChange={event => setBrandId(event.target.value)}
					className="rounded border border-hairline bg-background px-3 py-1.5 text-sm text-text-primary"
				>
					<option value="">Select brand</option>
					{brandOptions.map(entry => (
						<option key={entry.brand.canonicalKey} value={entry.brand.canonicalKey}>
							{entry.brand.displayName}
						</option>
					))}
				</select>
			</div>

			<div className="flex min-w-[260px] flex-1 flex-col gap-1">
				<label className="text-xs uppercase tracking-[0.1em] text-text-muted" htmlFor="ovico-source-url">
					OVICO source URL
				</label>
				<input
					id="ovico-source-url"
					type="url"
					required
					placeholder="https://ovico.md/ru/..."
					value={sourceUrl}
					onChange={event => setSourceUrl(event.target.value)}
					className="rounded border border-hairline bg-background px-3 py-1.5 text-sm text-text-primary"
				/>
			</div>

			<button
				type="submit"
				disabled={add.isPending || !brandId || !sourceUrl.trim()}
				className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
			>
				Add source
			</button>
		</form>
	)
}

function BrandSourcesCard({ entry }: { entry: OvicoBrandSourcesEntry }) {
	return (
		<div className="rounded border border-hairline bg-card p-4">
			<div className="flex items-center justify-between gap-2">
				<h3 className="font-medium text-text-primary">{entry.brand.displayName}</h3>
				<span className="text-xs text-text-muted">
					{entry.sources.length} source{entry.sources.length === 1 ? '' : 's'}
				</span>
			</div>

			<div className="mt-3 flex flex-col divide-y divide-hairline">
				{entry.sources.map(source => (
					<SourceRow key={source.id} sourceId={source.id} source={source} />
				))}
			</div>
		</div>
	)
}

function SourceRow({
	sourceId,
	source
}: {
	sourceId: number
	source: OvicoBrandSourcesEntry['sources'][number]
}) {
	const patch = usePatchOvicoBrandSource()
	const remove = useRemoveOvicoBrandSource()
	const sync = useSyncOvicoBrandSource()
	const [editing, setEditing] = useState(false)
	const [url, setUrl] = useState(source.sourceUrl)

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
			<div className="min-w-0 flex-1">
				{editing ? (
					<form
						onSubmit={event => {
							event.preventDefault()
							patch.mutate(
								{ id: sourceId, patch: { sourceUrl: url } },
								{ onSuccess: () => setEditing(false) }
							)
						}}
						className="flex items-center gap-2"
					>
						<input
							value={url}
							onChange={event => setUrl(event.target.value)}
							className="min-w-0 flex-1 rounded border border-hairline bg-background px-2 py-1 text-sm"
						/>
						<button type="submit" className="text-xs font-medium text-accent">
							Save
						</button>
						<button type="button" onClick={() => setEditing(false)} className="text-xs text-text-muted">
							Cancel
						</button>
					</form>
				) : (
					<a
						href={source.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="truncate text-sm text-text-primary hover:underline"
					>
						{source.sourceUrl}
					</a>
				)}

				<div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
					<StatusBadge status={source.status} />
					{!source.enabled && <span className="text-text-muted">· disabled</span>}
					<span>
						· last synced{' '}
						{source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : 'never'}
					</span>
					{source.lastSyncStatus === 'failed' && source.lastSyncError && (
						<span className="text-destructive">· {source.lastSyncError}</span>
					)}
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<button
					type="button"
					onClick={() => sync.mutate(sourceId)}
					disabled={sync.isPending}
					className="rounded border border-hairline px-3 py-1 text-xs font-medium text-text-secondary hover:border-text-muted disabled:opacity-50"
				>
					{sync.isPending ? 'Syncing…' : 'Sync now'}
				</button>

				<button
					type="button"
					onClick={() => setEditing(true)}
					className="rounded border border-hairline px-3 py-1 text-xs text-text-secondary hover:border-text-muted"
				>
					Edit
				</button>

				<button
					type="button"
					onClick={() => patch.mutate({ id: sourceId, patch: { enabled: !source.enabled } })}
					className="rounded border border-hairline px-3 py-1 text-xs text-text-secondary hover:border-text-muted"
				>
					{source.enabled ? 'Disable' : 'Enable'}
				</button>

				<button
					type="button"
					onClick={() => patch.mutate({ id: sourceId, patch: { status: 'missing' } })}
					disabled={source.status === 'missing'}
					className="rounded border border-hairline px-3 py-1 text-xs text-text-secondary hover:border-text-muted disabled:opacity-50"
				>
					Mark missing
				</button>

				<button
					type="button"
					onClick={() => remove.mutate(sourceId)}
					className="rounded border border-hairline px-3 py-1 text-xs text-destructive hover:border-destructive"
				>
					Remove
				</button>
			</div>
		</div>
	)
}

function StatusBadge({ status }: { status: OvicoBrandSourceStatus }) {
	const label = status === 'confirmed' ? 'Confirmed' : status === 'missing' ? 'Missing' : 'Needs review'

	return (
		<span
			className={
				status === 'confirmed'
					? 'rounded border border-accent bg-accent/10 px-1.5 py-0.5 text-accent'
					: 'rounded border border-hairline px-1.5 py-0.5 text-text-muted'
			}
		>
			{label}
		</span>
	)
}
