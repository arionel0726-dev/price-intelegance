// Milestone 4: Discovery Jobs UI - types mirroring the exact job_runs/
// job_events response shapes returned by apps/api/src/jobs/discovery-jobs.*
// (read directly, not guessed). Timestamps come back as ISO strings;
// job_runs has no numeric() columns, so counters stay real numbers (unlike
// ProductFamily.price elsewhere in this app).

export type JobCompetitor = 'makeup' | 'ovico'

export type JobMode = 'limited' | 'continuous'

export type JobStatus = 'queued' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled'

export const ACTIVE_JOB_STATUSES: JobStatus[] = ['queued', 'running', 'stopping']
export const TERMINAL_JOB_STATUSES: JobStatus[] = ['completed', 'failed', 'cancelled']

export type JobFailureClass = 'operational' | 'application'

// Persisted verbatim into job_runs.params at enqueue time - see
// DiscoveryJobParams in apps/api/src/jobs/discovery-jobs.types.ts.
export type JobParams = {
	brand: string | null
	inStock: boolean
	onlyUnmatched: boolean
	limit: number | null
	productBudgetSeconds: number
}

// Mirrors the JobRunWithCompetitor shape the API returns (job_runs row +
// a joined competitor label - Milestone 4's one additive API change, see
// apps/api/src/jobs/discovery-jobs.service.ts).
export type JobRun = {
	id: number

	competitorId: number
	competitorSlug: JobCompetitor | null
	competitorName: string

	jobType: string
	mode: JobMode
	status: JobStatus
	params: JobParams

	stopRequested: boolean
	stopRequestedAt: string | null
	stopReason: string | null
	failureClass: JobFailureClass | null

	eligibleAtStart: number | null
	processedCount: number
	autoCount: number
	aiAutoCount: number
	aiReviewCount: number
	noMatchCount: number
	errorCount: number
	retryCount: number

	currentProductId: number | null
	currentProductStartedAt: string | null

	workerId: string | null
	heartbeatAt: string | null

	startedAt: string | null
	finishedAt: string | null
	createdAt: string
	error: string | null
}

export type JobEvent = {
	id: number
	jobRunId: number
	productId: number | null
	eventType: string
	message: string | null
	data: Record<string, unknown> | null
	createdAt: string
}

export type JobListPage = {
	items: JobRun[]
	page: number
	limit: number
	total: number
}

export type JobEventsPage = {
	items: JobEvent[]
	page: number
	limit: number
	total: number
}

export type EnqueueJobInput = {
	competitor: JobCompetitor
	mode: JobMode
	brand?: string | null
	inStock?: boolean
	onlyUnmatched?: boolean
	limit?: number
	productBudgetSeconds: number
}
