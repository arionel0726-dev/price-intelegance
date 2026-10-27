// Milestone 2 worker tuning - all env-overridable, same class of value as
// the existing MAKEUP_* pacing constants (operational knobs, not business
// settings - see project notes on why these stay out of app_settings).

// How often the poller looks for a queued job. Short on purpose - claiming
// is a cheap, atomic UPDATE, so polling often costs little and keeps
// enqueue-to-start latency low.
export const DISCOVERY_POLL_INTERVAL_MS = Number(process.env.DISCOVERY_POLL_INTERVAL_MS ?? 5_000);

// Heartbeat cadence - INDEPENDENT of productBudgetSeconds. Ticks on its own
// fixed interval for the whole time a job is 'running', regardless of how
// long the current SKU's search/parse call takes.
export const DISCOVERY_HEARTBEAT_INTERVAL_MS = Number(process.env.DISCOVERY_HEARTBEAT_INTERVAL_MS ?? 20_000);

// A job whose heartbeat is older than this is considered dead by
// reconciliation. Deliberately fixed, not derived from productBudgetSeconds
// (a 10-minute SKU budget must not make the lease 10x looser).
export const DISCOVERY_LEASE_STALE_MS = Number(process.env.DISCOVERY_LEASE_STALE_MS ?? 75_000);

// Reconciliation sweep cadence (in addition to the one-time bootstrap run).
export const DISCOVERY_RECONCILE_CRON = process.env.DISCOVERY_RECONCILE_CRON ?? '*/1 * * * *';

// Minimum number of SKUs attempted in a single worker execution before the
// deferred/search-error ratio safety limits are even consulted - without
// this, one deferred/erroring SKU out of the first one or two attempted
// would trip a >30%/>10% ratio immediately. The legacy batch sync() avoids
// this problem entirely by using the WHOLE planned batch as denominator
// from the start; continuous/worker mode has no such fixed total, so this
// floor is the Milestone 2 adaptation - see project notes (reported
// deviation).
export const DISCOVERY_SAFETY_MIN_SAMPLE = Number(process.env.DISCOVERY_SAFETY_MIN_SAMPLE ?? 10);
