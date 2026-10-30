// URL<->state contract for the /jobs history list (Milestone 4), same
// pattern as features/products/lib/catalog-url-state.ts: the URL is the
// primary store (shareable, Back/Forward-safe, survives refresh);
// localStorage is a fallback ONLY for page-size, and only applies where
// the URL itself says nothing - the URL always wins.
import type { JobCompetitor, JobStatus } from '../types/job'

export type JobHistoryFilters = {
	competitor: JobCompetitor | 'all'
	status: JobStatus | 'all'
	page: number
}

export const JOB_HISTORY_DEFAULTS: JobHistoryFilters = {
	competitor: 'all',
	status: 'all',
	page: 1
}

const PARAM = {
	competitor: 'competitor',
	status: 'status',
	page: 'page'
} as const

function isJobCompetitor(value: string | null): value is JobCompetitor {
	return value === 'makeup' || value === 'ovico'
}

function isJobStatus(value: string | null): value is JobStatus {
	return (
		value === 'queued' ||
		value === 'running' ||
		value === 'stopping' ||
		value === 'completed' ||
		value === 'failed' ||
		value === 'cancelled'
	)
}

function parsePage(value: string | null): number | null {
	if (value === null) return null
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

// A field the URL is silent on stays `undefined` here - malformed values
// (garbage page, unknown competitor/status) are treated the same as
// "unset", never throw, never propagate nonsense into the UI.
export function parseJobHistorySearchParams(searchParams: URLSearchParams): Partial<JobHistoryFilters> {
	const result: Partial<JobHistoryFilters> = {}

	const competitor = searchParams.get(PARAM.competitor)
	if (competitor === 'all' || isJobCompetitor(competitor)) result.competitor = competitor

	const status = searchParams.get(PARAM.status)
	if (status === 'all' || isJobStatus(status)) result.status = status

	const page = parsePage(searchParams.get(PARAM.page))
	if (page !== null) result.page = page

	return result
}

export function serializeJobHistoryFilters(filters: JobHistoryFilters): string {
	const query = new URLSearchParams()

	if (filters.competitor !== JOB_HISTORY_DEFAULTS.competitor) query.set(PARAM.competitor, filters.competitor)
	if (filters.status !== JOB_HISTORY_DEFAULTS.status) query.set(PARAM.status, filters.status)
	if (filters.page !== JOB_HISTORY_DEFAULTS.page) query.set(PARAM.page, String(filters.page))

	return query.toString()
}

export function resolveJobHistoryFilters(fromUrl: Partial<JobHistoryFilters>): JobHistoryFilters {
	return {
		competitor: fromUrl.competitor ?? JOB_HISTORY_DEFAULTS.competitor,
		status: fromUrl.status ?? JOB_HISTORY_DEFAULTS.status,
		page: fromUrl.page ?? JOB_HISTORY_DEFAULTS.page
	}
}

// --- localStorage fallback (page-size preference only) --------------------

export const JOBS_PREFERENCES_KEY = 'price-intelligence.jobs.preferences.v1'

export type JobsPreferences = {
	pageSize: number
}

const DEFAULT_PAGE_SIZE = 20
const MIN_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

function isValidPreferences(value: unknown): value is JobsPreferences {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.pageSize === 'number' &&
		Number.isInteger(candidate.pageSize) &&
		candidate.pageSize >= MIN_PAGE_SIZE &&
		candidate.pageSize <= MAX_PAGE_SIZE
	)
}

// Never throws - a missing key, disabled/blocked storage, or garbage JSON
// from a previous schema version all fall back to the same default.
export function readJobsPreferences(): JobsPreferences {
	const fallback: JobsPreferences = { pageSize: DEFAULT_PAGE_SIZE }

	try {
		if (typeof localStorage === 'undefined') return fallback

		const raw = localStorage.getItem(JOBS_PREFERENCES_KEY)
		if (!raw) return fallback

		const parsed = JSON.parse(raw)
		return isValidPreferences(parsed) ? parsed : fallback
	} catch {
		return fallback
	}
}

export function writeJobsPreferences(preferences: JobsPreferences): void {
	try {
		if (typeof localStorage === 'undefined') return
		localStorage.setItem(JOBS_PREFERENCES_KEY, JSON.stringify(preferences))
	} catch {
		// Storage unavailable/full/blocked - a convenience only.
	}
}
