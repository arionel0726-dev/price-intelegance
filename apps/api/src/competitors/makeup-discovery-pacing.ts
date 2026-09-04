// Pacing/cooldown config for MAKEUP targeted-search DISCOVERY only (see
// project notes: discovery vs refresh are separate workflows - refresh uses
// a known URL and never touches this). All tunable via env so real-world
// numbers can be adjusted without code changes; defaults reflect what was
// actually observed during the reliability milestone (2026-09-04).
//
// The goal is reliable unattended operation, not maximum throughput - do
// not raise these to "go faster" without new evidence the site tolerates it.

// How many Vizaje products' search queries go into one /search/makeup/batch
// call (one shared browser session - see searchers/makeup.py). Kept
// conservative on purpose.
export const MAKEUP_DISCOVERY_BATCH_SIZE = Number(
  process.env.MAKEUP_DISCOVERY_BATCH_SIZE ?? 25,
);

// Deliberate pause between batches, independent of cooldown handling.
export const MAKEUP_DISCOVERY_BATCH_PAUSE_MS = Number(
  process.env.MAKEUP_DISCOVERY_BATCH_PAUSE_MS ?? 90_000,
);

// Cooldown detection: a run of this many CONSECUTIVE distinct queries (each
// for a different Vizaje product/brand) all coming back HTTP-success with
// zero results is treated as the search subsystem being cooled down, not as
// that many unrelated products legitimately not existing on MAKEUP back to
// back - real reconnaissance data shows genuine zero-result runs that long
// are not expected from a healthy search endpoint.
export const MAKEUP_COOLDOWN_CONSECUTIVE_EMPTY_THRESHOLD = Number(
  process.env.MAKEUP_COOLDOWN_THRESHOLD ?? 7,
);

// How long to wait once a cooldown is detected before probing again. Matches
// the observed real recovery window (~10-12 minutes) with a small margin.
export const MAKEUP_COOLDOWN_WAIT_MS = Number(
  process.env.MAKEUP_COOLDOWN_WAIT_MS ?? 12 * 60 * 1000,
);

// Small probe issued after the cooldown wait, before resuming full batches -
// avoids immediately re-hammering the endpoint with a full batch if it
// hasn't actually recovered yet.
export const MAKEUP_COOLDOWN_PROBE_SIZE = Number(
  process.env.MAKEUP_COOLDOWN_PROBE_SIZE ?? 3,
);

// --- Per-run safety limits (scheduling milestone, 2026-09-04) ---
// A scheduled run must be able to decide "this isn't going well today" and
// stop cleanly rather than keep hammering MAKEUP to finish the queue.
// Unprocessed products simply remain eligible for the next scheduled run.

// If a 3rd cooldown event would occur in one run, stop immediately (skip
// the wait/probe cycle entirely) instead of accepting another 12+ minute
// wait - two recoveries in one run is already atypical.
export const MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN = Number(
  process.env.MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN ?? 2,
);

// Denominators for both ratios below are the run's total planned target
// count (targets.length), not a shifting "so far" count - a stable rule
// that doesn't flip on early-run noise.
export const MAKEUP_MAX_DEFERRED_RATIO = Number(
  process.env.MAKEUP_MAX_DEFERRED_RATIO ?? 0.3,
);
export const MAKEUP_MAX_SEARCH_ERROR_RATIO = Number(
  process.env.MAKEUP_MAX_SEARCH_ERROR_RATIO ?? 0.1,
);

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cooldown pattern detector - see the threshold comment above for why a run
// length, not a single empty result, is the signal.
export function detectCooldownPattern(
  searchResultCounts: number[],
  threshold: number = MAKEUP_COOLDOWN_CONSECUTIVE_EMPTY_THRESHOLD,
): boolean {
  let consecutiveEmpty = 0;

  for (const count of searchResultCounts) {
    if (count === 0) {
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= threshold) return true;
    } else {
      consecutiveEmpty = 0;
    }
  }

  return false;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}
