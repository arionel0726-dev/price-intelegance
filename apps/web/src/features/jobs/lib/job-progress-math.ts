// Pure math extracted out of components/job-progress.tsx so the "real
// progress bar for limited mode" / "never a fake percentage for
// continuous mode" behaviors are unit-testable without rendering React
// (this repo has no component-rendering test infra - see
// catalog-url-state.test.ts for the established pure-logic convention).

export type LimitedProgress = {
	processed: number
	limit: number
	percent: number
}

// Clamps processed to the limit (a job can't logically exceed its own
// limit, but defends against a stray off-by-one from the worker) and
// derives a 0-100 percent. limit<=0 (shouldn't happen for a real limited
// job, but defensively) reads as 0%, never NaN/Infinity.
export function computeLimitedProgress(processedCount: number, limit: number): LimitedProgress {
	const safeLimit = Math.max(0, limit)
	const processed = Math.min(Math.max(0, processedCount), safeLimit)
	const percent = safeLimit > 0 ? Math.round((processed / safeLimit) * 100) : 0

	return { processed, limit: safeLimit, percent }
}

export function formatElapsedSeconds(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds))
	const minutes = Math.floor(seconds / 60)
	const secs = seconds % 60
	return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`
}
