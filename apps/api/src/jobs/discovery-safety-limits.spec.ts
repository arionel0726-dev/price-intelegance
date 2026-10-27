import { evaluateSafetyLimits } from './discovery-safety-limits';

function input(overrides: Partial<Parameters<typeof evaluateSafetyLimits>[0]> = {}) {
	return {
		processedCount: 0,
		deferredSoFar: 0,
		searchErrorsSoFar: 0,
		limit: null,
		minSample: 10,
		maxDeferredRatio: 0.3,
		maxSearchErrorRatio: 0.1,
		...overrides,
	};
}

describe('evaluateSafetyLimits', () => {
	it('never trips before minSample attempts, even at 100% deferred', () => {
		expect(evaluateSafetyLimits(input({ processedCount: 0, deferredSoFar: 1 }))).toBeNull();
		expect(evaluateSafetyLimits(input({ processedCount: 1, deferredSoFar: 8 }))).toBeNull();
	});

	it('flags deferred_ratio_exceeded once the minSample floor and ratio are both crossed', () => {
		// attempted = 10 (>= minSample), deferred 4/10 = 40% > 30%
		expect(evaluateSafetyLimits(input({ processedCount: 6, deferredSoFar: 4 }))).toBe('deferred_ratio_exceeded');
	});

	it('does not flag deferred_ratio_exceeded exactly at the threshold', () => {
		// 3/10 = 30%, not > 30%
		expect(evaluateSafetyLimits(input({ processedCount: 7, deferredSoFar: 3 }))).toBeNull();
	});

	it('flags search_error_ratio_exceeded independently of deferred ratio', () => {
		expect(
			evaluateSafetyLimits(input({ processedCount: 10, deferredSoFar: 0, searchErrorsSoFar: 2 })),
		).toBe('search_error_ratio_exceeded');
	});

	it('deferred_ratio is checked before search_error_ratio when both would trip', () => {
		expect(
			evaluateSafetyLimits(input({ processedCount: 0, deferredSoFar: 10, searchErrorsSoFar: 10 })),
		).toBe('deferred_ratio_exceeded');
	});

	it('uses params.limit as the denominator when limited mode provides one', () => {
		// limit=100, deferred=25 -> 25% of 100, under 30% - must NOT trip even
		// though deferred/attemptedSoFar (25/25 = 100%) would.
		expect(evaluateSafetyLimits(input({ processedCount: 0, deferredSoFar: 25, limit: 100 }))).toBeNull();
	});

	it('falls back to attempted-so-far as the denominator in continuous mode (limit=null)', () => {
		expect(evaluateSafetyLimits(input({ processedCount: 0, deferredSoFar: 25, limit: null }))).toBe(
			'deferred_ratio_exceeded',
		);
	});

	// --- realistic outcome sequences (search-error wiring fix) --------------
	// Both scenarios below mirror exactly what DiscoveryWorkerService.runJob's
	// switch does with a real SkuOutcome stream: every outcome increments
	// processedCount OR deferredSoFar (never both), and searchErrorsSoFar is
	// incremented only alongside a deferred outcome whose wasSearchError is
	// true - so searchErrorsSoFar can never exceed deferredSoFar. The two
	// previous tests above ('flags search_error_ratio_exceeded independently'
	// and 'deferred_ratio is checked before search_error_ratio') use
	// hand-picked numbers that don't respect that invariant; these do.
	function runSequence(outcomes: Array<'success' | 'search_error_deferred' | 'cooldown_deferred'>) {
		let processedCount = 0;
		let deferredSoFar = 0;
		let searchErrorsSoFar = 0;
		const trips: Array<string | null> = [];

		for (const outcome of outcomes) {
			if (outcome === 'success') {
				processedCount += 1;
			} else {
				deferredSoFar += 1;
				if (outcome === 'search_error_deferred') searchErrorsSoFar += 1;
			}
			trips.push(evaluateSafetyLimits(input({ processedCount, deferredSoFar, searchErrorsSoFar })));
		}

		return trips;
	}

	it('a sequence of real search-request failures (wasSearchError=true) can trip search_error_ratio_exceeded, without deferred_ratio_exceeded firing first', () => {
		// 1 search-error-deferred SKU every 7 attempts, rest successful - at
		// attempt 14: deferredSoFar=searchErrorsSoFar=2, denom=14.
		// deferredRatio = 2/14 ≈ 0.143, NOT > 0.3 - does not trip.
		// searchErrorRatio = 2/14 ≈ 0.143, > 0.1 - trips.
		const outcomes: Array<'success' | 'search_error_deferred'> = Array.from({ length: 14 }, (_, i) =>
			(i + 1) % 7 === 0 ? 'search_error_deferred' : 'success',
		);
		const trips = runSequence(outcomes);

		expect(trips.slice(0, 13)).toEqual(Array(13).fill(null)); // nothing trips before attempt 14
		expect(trips[13]).toBe('search_error_ratio_exceeded');
		expect(trips).not.toContain('deferred_ratio_exceeded');
	});

	it('a sequence of cooldown-only deferrals (wasSearchError=false throughout) can trip deferred_ratio_exceeded on its own, but can NEVER trip search_error_ratio_exceeded', () => {
		// All 10 attempts are cooldown-deferred, zero real search failures -
		// searchErrorsSoFar stays 0 for the whole sequence.
		const outcomes: Array<'cooldown_deferred'> = Array.from({ length: 10 }, () => 'cooldown_deferred');
		const trips = runSequence(outcomes);

		expect(trips[9]).toBe('deferred_ratio_exceeded'); // 10/10 = 100% > 30%, trips on its own
		expect(trips).not.toContain('search_error_ratio_exceeded'); // numerator never left 0
	});
});
