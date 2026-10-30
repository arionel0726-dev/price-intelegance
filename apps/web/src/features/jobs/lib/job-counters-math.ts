import type { JobRun } from '../types/job'

export type JobCounterSummary = {
	confirmed: number
	needsReview: number
	noMatch: number
	errors: number
	retries: number
}

// Grouping extracted out of components/job-counters.tsx - "Confirmed" is
// autoCount + aiAutoCount (deterministic AUTO + AI auto-confirmed); every
// other counter is read straight off job_runs. needsReview is a LIVE
// current count per the Milestone 3 recomputeCounters semantics (it can
// go back down after the job finishes as AI/manual review resolves
// candidates) - this function doesn't change that, it just reads it.
export function buildJobCounterSummary(job: JobRun): JobCounterSummary {
	return {
		confirmed: job.autoCount + job.aiAutoCount,
		needsReview: job.aiReviewCount,
		noMatch: job.noMatchCount,
		errors: job.errorCount,
		retries: job.retryCount
	}
}
