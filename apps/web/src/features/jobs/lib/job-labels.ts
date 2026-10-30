import type { JobEvent, JobStatus } from '../types/job'

// --- status -----------------------------------------------------------

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
	queued: 'Queued',
	running: 'Running',
	stopping: 'Stopping safely…',
	completed: 'Completed',
	failed: 'Failed',
	cancelled: 'Cancelled'
}

// --- stopReason (apps/api/src/jobs/discovery-worker.service.ts /
// discovery-safety-limits.ts) ------------------------------------------
// Every value the brief lists is mapped here; a handful more that the
// current backend actually produces (cooldown_limit,
// unexpected_missing_competitor) are included too so nothing real falls
// through to the raw-value fallback below.
const STOP_REASON_LABEL: Record<string, string> = {
	limit_reached: 'Reached the requested limit',
	pool_exhausted: 'No more eligible products to check',
	user_requested: 'Stopped by request',
	search_error_ratio_exceeded: 'Too many search errors - stopped for safety',
	deferred_ratio_exceeded: 'Too many deferred products - stopped for safety',
	cooldown_limit_exceeded: 'Cooldown limit exceeded',
	cooldown_limit: 'Cooldown limit exceeded',
	parser_unreachable: "Competitor site couldn't be reached",
	heartbeat_lost: 'Lost contact with the worker',
	unhandled_exception: 'An unexpected error stopped the job',
	persist_error: 'Failed to save results',
	unexpected_missing_competitor: 'Competitor configuration missing'
}

export function describeStopReason(stopReason: string | null): string | null {
	if (!stopReason) return null
	return STOP_REASON_LABEL[stopReason] ?? stopReason.replace(/_/g, ' ')
}

const FAILURE_CLASS_LABEL: Record<string, string> = {
	operational: 'Operational issue (safety limit, external site, worker)',
	application: 'Application error (a bug in the job)'
}

export function describeFailureClass(failureClass: string | null): string | null {
	if (!failureClass) return null
	return FAILURE_CLASS_LABEL[failureClass] ?? failureClass
}

// --- product budget seconds <-> UI labels ------------------------------

export const PRODUCT_BUDGET_OPTIONS = [
	{ seconds: 60, label: '1 min' },
	{ seconds: 180, label: '3 min' },
	{ seconds: 300, label: '5 min' },
	{ seconds: 600, label: '10 min' }
] as const

// --- event timeline -----------------------------------------------------

export type EventPresentation = {
	label: string
	message: string | null
	tone: 'neutral' | 'success' | 'warning' | 'danger'
}

// Every job_events eventType emitted by the backend (see
// discovery-jobs.service.ts/discovery-worker.service.ts/
// discovery-ai-review.service.ts) mapped to a plain-language label + a
// short message built from that event's own `data` - never a raw JSON
// dump by default (the raw object is still available for a "technical
// details" disclosure, see JobEventTimeline).
export function presentEvent(event: JobEvent): EventPresentation {
	const data = event.data ?? {}

	switch (event.eventType) {
		case 'job_queued':
			return { label: 'Job queued', message: null, tone: 'neutral' }
		case 'job_started':
			return { label: 'Job started', message: null, tone: 'neutral' }
		case 'job_recovered':
			// Only ever rendered when the backend actually emitted this event
			// (worker restart recovery) - never inferred client-side.
			return { label: 'Worker connection lost — job recovered', message: null, tone: 'warning' }
		case 'job_stop_requested':
			return { label: 'Stop requested', message: null, tone: 'neutral' }
		case 'job_stopping':
			return { label: 'Stopping safely…', message: null, tone: 'neutral' }
		case 'job_completed':
			return { label: 'Job completed', message: null, tone: 'success' }
		case 'job_failed':
			return { label: 'Job failed', message: typeof data.error === 'string' ? data.error : null, tone: 'danger' }
		case 'job_cancelled':
			return { label: 'Job cancelled', message: describeStopReason(typeof data.stopReason === 'string' ? data.stopReason : null), tone: 'neutral' }
		case 'product_started':
			return { label: 'Checking product', message: null, tone: 'neutral' }
		case 'product_auto_matched':
			return { label: 'Auto-matched', message: null, tone: 'success' }
		case 'product_pending_review':
			return { label: 'Ambiguous match - needs review', message: null, tone: 'warning' }
		case 'product_ai_auto_matched':
			return {
				label: 'AI auto-confirmed match',
				message: typeof data.confidence === 'number' ? `Confidence ${data.confidence.toFixed(2)}` : null,
				tone: 'success'
			}
		case 'product_ai_rejected':
			return {
				label: 'AI rejected the candidate',
				message: typeof data.confidence === 'number' ? `Confidence ${data.confidence.toFixed(2)}` : null,
				tone: 'neutral'
			}
		case 'product_no_match':
			return { label: 'No match found', message: null, tone: 'neutral' }
		case 'product_error':
			return { label: 'Error processing product', message: typeof data.reason === 'string' ? describeStopReason(data.reason) : null, tone: 'danger' }
		case 'product_deferred':
			return { label: 'Product deferred', message: typeof data.reason === 'string' ? data.reason.replace(/_/g, ' ') : null, tone: 'neutral' }
		case 'cooldown_started':
			return { label: 'Cooldown started', message: null, tone: 'neutral' }
		case 'cooldown_finished':
			return { label: 'Cooldown finished', message: data.recovered === false ? 'Not recovered' : null, tone: 'neutral' }
		default:
			return { label: event.eventType.replace(/_/g, ' '), message: event.message, tone: 'neutral' }
	}
}
