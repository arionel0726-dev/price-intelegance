// Pure decision function - no DB, no Nest DI - so it can be unit tested
// directly (see discovery-safety-limits.spec.ts). Extracted out of
// DiscoveryWorkerService.runJob() so the "is this run going badly enough
// to fail itself" decision has exactly one implementation, testable in
// isolation from Postgres/the parser.
//
// Deviation from the legacy batch sync() methods (reported in project
// notes): those divide by the run's WHOLE planned target count, fixed
// before the run starts. Continuous/worker mode has no such fixed total
// up front, so the denominator here is `limit` when known (limited mode -
// closest to the legacy semantics) or the count actually attempted so far
// (continuous mode). `minSample` guards against a tiny early sample (e.g.
// one deferred SKU out of the first one or two attempted) tripping a ratio
// that would never have tripped against a real planned-total denominator.
export type SafetyLimitInput = {
	processedCount: number;
	deferredSoFar: number;
	searchErrorsSoFar: number;
	limit: number | null;
	minSample: number;
	maxDeferredRatio: number;
	maxSearchErrorRatio: number;
};

export function evaluateSafetyLimits(input: SafetyLimitInput): string | null {
	const attemptedSoFar = input.processedCount + input.deferredSoFar;
	if (attemptedSoFar < input.minSample) return null;

	const denominator = input.limit ?? Math.max(attemptedSoFar, 1);

	if (input.deferredSoFar / denominator > input.maxDeferredRatio) return 'deferred_ratio_exceeded';
	if (input.searchErrorsSoFar / denominator > input.maxSearchErrorRatio) return 'search_error_ratio_exceeded';
	return null;
}
