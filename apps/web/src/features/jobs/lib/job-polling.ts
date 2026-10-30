import { TERMINAL_JOB_STATUSES, type JobStatus } from '../types/job'

// Pure decision used by both use-job-detail.ts's refetchInterval function
// and job-stop-button.tsx's visibility check - a job that's already
// terminal never needs another poll, and never shows a Stop control.
export function isTerminalStatus(status: JobStatus): boolean {
	return (TERMINAL_JOB_STATUSES as string[]).includes(status)
}

export function canStopJob(status: JobStatus): boolean {
	return status === 'queued' || status === 'running' || status === 'stopping'
}

// What a TanStack Query `refetchInterval` function should return for a
// job detail/events poll: false once the job is terminal (stop polling a
// dead job for good), otherwise the given active interval.
export function nextPollDelay(status: JobStatus | undefined, activeIntervalMs: number): number | false {
	if (status !== undefined && isTerminalStatus(status)) return false
	return activeIntervalMs
}
