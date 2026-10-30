import { ApiError } from '@/lib/api/client'

import type { EnqueueJobInput, JobCompetitor, JobMode } from '../types/job'

export type NewJobFormState = {
	competitor: JobCompetitor
	mode: JobMode
	brand: string
	inStock: boolean
	onlyUnmatched: boolean
	productBudgetSeconds: number
	limit: number
}

// Mirrors apps/api's EnqueueDiscoveryJobBody field-for-field. `limit` is
// included ONLY for limited mode - continuous mode never sends it, even
// if the form happens to still hold a stale value from a previous mode
// selection (brief: "continuous hides/omits it").
export function buildEnqueuePayload(form: NewJobFormState): EnqueueJobInput {
	return {
		competitor: form.competitor,
		mode: form.mode,
		brand: form.brand === 'all' ? null : form.brand,
		inStock: form.inStock,
		onlyUnmatched: form.onlyUnmatched,
		productBudgetSeconds: form.productBudgetSeconds,
		...(form.mode === 'limited' ? { limit: form.limit } : {})
	}
}

// Mirrors the backend's own enqueue() validation (apps/api/src/jobs/
// discovery-jobs.service.ts) closely enough to give the user instant
// feedback before the request even goes out - the backend remains the
// actual source of truth/enforcement.
export function validateNewJobForm(form: NewJobFormState): string | null {
	if (form.mode === 'limited' && (!Number.isInteger(form.limit) || form.limit <= 0)) {
		return 'Limited mode requires a positive integer limit'
	}
	return null
}

export type EnqueueErrorPresentation = {
	duplicateActiveJobMessage: string | null
	otherErrorMessage: string | null
}

// A 409 from POST /jobs/discovery means a job is already active for this
// competitor (job_runs_active_per_competitor) - shown as a clean inline
// explanation naming the conflict, never a raw error banner. Any other
// failure falls through to a plain error message.
export function presentEnqueueError(error: unknown): EnqueueErrorPresentation {
	if (error instanceof ApiError && error.status === 409) {
		return { duplicateActiveJobMessage: error.message, otherErrorMessage: null }
	}
	if (error instanceof Error) {
		return { duplicateActiveJobMessage: null, otherErrorMessage: error.message }
	}
	return { duplicateActiveJobMessage: null, otherErrorMessage: null }
}
