// Milestone 2: DB-backed discovery job execution - shared types for the
// enqueue/list/get/stop API and the worker that actually executes a job.

export type DiscoveryCompetitorSlug = 'makeup' | 'ovico';

export type EnqueueDiscoveryJobInput = {
	competitor: DiscoveryCompetitorSlug;
	mode: 'limited' | 'continuous';
	brand?: string | null;
	inStock?: boolean;
	onlyUnmatched?: boolean;
	limit?: number;
	productBudgetSeconds: number;
};

// Persisted verbatim into job_runs.params - an immutable record of exactly
// what the caller asked for. Never mutated after insert, and never grows
// to carry policy state - policy is always re-evaluated live by the worker
// (see discovery-targets.ts's selectNextContinuousTarget).
export type DiscoveryJobParams = {
	brand: string | null;
	inStock: boolean;
	onlyUnmatched: boolean;
	limit: number | null;
	productBudgetSeconds: number;
};

export const DISCOVERY_COMPETITOR_DOMAINS: Record<DiscoveryCompetitorSlug, 'makeup.md' | 'ovico.md'> = {
	makeup: 'makeup.md',
	ovico: 'ovico.md',
};
