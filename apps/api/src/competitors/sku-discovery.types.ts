// Structured outcome every per-SKU discovery function returns (Milestone 2
// one-SKU-at-a-time refactor) - the DiscoveryWorkerService maps these to
// job_runs counters/job_events, and the legacy batch sync() loops map them
// to their own existing in-memory counters, so both callers agree on one
// vocabulary instead of each inventing its own.
// parseSuccesses on every variant - how many candidate-page parses actually
// succeeded for this one SKU (0 for outcomes decided before any parse was
// attempted, e.g. no_match from an empty search) - so a caller that wants
// an exact total across many SKUs (the legacy sync() methods' reported
// `candidatesParsedTotal`) can sum it without needing its own parse-count
// bookkeeping duplicated outside the one place parsing actually happens.
export type SkuOutcome =
	| {
			kind: 'auto';
			score: number;
			variantId: number;
			matchOutcome: string;
			competitorExternalId: string;
			competitorTitle: string;
			variantLabel: string | null;
			variantVolume: string | null;
			price: number | null;
			parseSuccesses: number;
	  }
	// candidateId is the discovery_candidates row id just written - the
	// Milestone 3 AI review path needs it to evaluate this exact candidate
	// without a second lookup-by-unique-key round trip (see
	// DiscoveryWorkerService.runJob's 'ambiguous' handling).
	| { kind: 'ambiguous'; score: number; parseSuccesses: number; candidateId: number }
	| { kind: 'no_match'; parseSuccesses: number }
	| { kind: 'error'; reason: string; parseSuccesses: number }
	// Only ever produced by the MAKEUP path - a batch/cooldown-level signal,
	// never OVICO (which has no batching). A deferred SKU is NOT persisted
	// to discovery_attempts - it was never actually searched, so it stays
	// indistinguishable from "never checked" and is simply retried later.
	| { kind: 'deferred'; reason: string; wasSearchError: boolean };

// Soft total per-SKU budget (Milestone 2, product requirement: "soft total
// budget for processing one Vizaje SKU... do not hard-abort a running
// bounded Playwright/network operation"). Never used to cancel an in-flight
// call - only consulted BEFORE starting another one.
export class SkuBudget {
	private readonly deadline: number;

	constructor(seconds: number) {
		this.deadline = Date.now() + seconds * 1000;
	}

	isExhausted(): boolean {
		return Date.now() >= this.deadline;
	}
}

// Accepted productBudgetSeconds values for the enqueue API - any of the
// four suggested presets, or any positive integer in [30, 1800] (30s floor:
// below that a single bounded parser call could routinely exceed the
// "budget" before even one attempt finishes; 1800s/30min ceiling: a budget
// beyond that stops being a safety control and starts being "no budget").
export function isValidProductBudgetSeconds(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 30 && value <= 1800;
}
