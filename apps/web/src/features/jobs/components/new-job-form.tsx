'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProductFilters } from '@/features/products/queries/use-product-filters'

import { buildEnqueuePayload, presentEnqueueError, validateNewJobForm } from '../lib/job-form-logic'
import { PRODUCT_BUDGET_OPTIONS } from '../lib/job-labels'
import { useEnqueueJob } from '../queries/use-enqueue-job'
import type { JobCompetitor, JobMode } from '../types/job'

type NewJobFormProps = {
	onDone: () => void
}

const COMPETITOR_LABEL: Record<JobCompetitor, string> = {
	makeup: 'MAKEUP',
	ovico: 'OVICO'
}

// Discovery job enqueue form - mirrors apps/api's EnqueueDiscoveryJobBody
// field-for-field. Submits via POST /jobs/discovery; a 409 (a job is
// already active for this competitor, see job_runs_active_per_competitor)
// is shown as a clean inline explanation, not a raw error banner.
export function NewJobForm({ onDone }: NewJobFormProps) {
	const { data: filters } = useProductFilters()
	const enqueue = useEnqueueJob()

	const [competitor, setCompetitor] = useState<JobCompetitor>('makeup')
	const [mode, setMode] = useState<JobMode>('limited')
	const [brand, setBrand] = useState('all')
	const [inStock, setInStock] = useState(false)
	const [onlyUnmatched, setOnlyUnmatched] = useState(true)
	const [productBudgetSeconds, setProductBudgetSeconds] = useState(180)
	const [limit, setLimit] = useState(50)
	const [validationError, setValidationError] = useState<string | null>(null)

	const { duplicateActiveJobMessage, otherErrorMessage } = presentEnqueueError(enqueue.error)

	function handleSubmit(event: React.FormEvent) {
		event.preventDefault()

		const form = { competitor, mode, brand, inStock, onlyUnmatched, productBudgetSeconds, limit }
		const error = validateNewJobForm(form)
		if (error) {
			setValidationError(error)
			return
		}
		setValidationError(null)

		enqueue.mutate(buildEnqueuePayload(form), { onSuccess: onDone })
	}

	return (
		<form onSubmit={handleSubmit} className="rounded border border-hairline bg-card p-5">
			<div className="flex items-center justify-between">
				<h2 className="font-medium text-text-primary">New discovery job</h2>
				<button
					type="button"
					onClick={onDone}
					className="text-sm text-text-muted hover:text-text-primary"
					aria-label="Cancel new job"
				>
					Cancel
				</button>
			</div>

			<div className="mt-4 grid gap-4 sm:grid-cols-2">
				<Field label="Competitor" htmlFor="job-competitor">
					<Select value={competitor} onValueChange={value => value && setCompetitor(value as JobCompetitor)}>
						<SelectTrigger id="job-competitor" aria-label="Competitor" className="w-full rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="makeup">{COMPETITOR_LABEL.makeup}</SelectItem>
							<SelectItem value="ovico">{COMPETITOR_LABEL.ovico}</SelectItem>
						</SelectContent>
					</Select>
				</Field>

				<Field label="Mode" htmlFor="job-mode">
					<Select value={mode} onValueChange={value => value && setMode(value as JobMode)}>
						<SelectTrigger id="job-mode" aria-label="Mode" className="w-full rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="limited">Limited</SelectItem>
							<SelectItem value="continuous">Continuous</SelectItem>
						</SelectContent>
					</Select>
				</Field>

				<Field label="Brand filter" htmlFor="job-brand">
					<Select value={brand} onValueChange={value => value && setBrand(value)}>
						<SelectTrigger id="job-brand" aria-label="Brand filter" className="w-full rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All brands</SelectItem>
							{(filters?.brands ?? []).map(item => (
								<SelectItem key={item} value={item}>
									{item}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>

				<Field label="Time budget per product" htmlFor="job-budget">
					<Select
						value={String(productBudgetSeconds)}
						onValueChange={value => value && setProductBudgetSeconds(Number(value))}
					>
						<SelectTrigger id="job-budget" aria-label="Time budget per product" className="w-full rounded border-hairline bg-card">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PRODUCT_BUDGET_OPTIONS.map(option => (
								<SelectItem key={option.seconds} value={String(option.seconds)}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>

				{mode === 'limited' && (
					<Field label="Limit (products)" htmlFor="job-limit">
						<input
							id="job-limit"
							type="number"
							min={1}
							required
							value={limit}
							onChange={event => setLimit(Number(event.target.value))}
							className="h-8 w-full rounded border border-hairline bg-transparent px-2.5 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
						/>
					</Field>
				)}
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-6">
				<label className="flex items-center gap-2 text-sm text-text-secondary">
					<input
						type="checkbox"
						checked={inStock}
						onChange={event => setInStock(event.target.checked)}
						className="size-4 rounded border-hairline accent-[#0007cb]"
					/>
					In stock only
				</label>

				<label className="flex items-center gap-2 text-sm text-text-secondary">
					<input
						type="checkbox"
						checked={onlyUnmatched}
						onChange={event => setOnlyUnmatched(event.target.checked)}
						className="size-4 rounded border-hairline accent-[#0007cb]"
					/>
					Only unmatched products
				</label>
			</div>

			{validationError && (
				<p className="mt-4 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
					{validationError}
				</p>
			)}

			{duplicateActiveJobMessage && (
				<p className="mt-4 rounded border border-hairline bg-surface px-3 py-2 text-sm text-text-secondary">
					{duplicateActiveJobMessage}
				</p>
			)}

			{otherErrorMessage && (
				<p className="mt-4 rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					{otherErrorMessage}
				</p>
			)}

			<div className="mt-5 flex items-center gap-3">
				<Button type="submit" disabled={enqueue.isPending} className="rounded bg-accent text-white hover:bg-accent/90">
					{enqueue.isPending ? 'Starting…' : 'Start job'}
				</Button>
			</div>
		</form>
	)
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
	return (
		<div>
			<label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-text-muted">
				{label}
			</label>
			{children}
		</div>
	)
}
