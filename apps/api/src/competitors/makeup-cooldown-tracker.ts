import { detectCooldownPattern, MAKEUP_COOLDOWN_CONSECUTIVE_EMPTY_THRESHOLD } from './makeup-discovery-pacing';

// Milestone 2 adaptation of MAKEUP's batch-level cooldown detection
// (detectCooldownPattern() in makeup-discovery-pacing.ts, UNCHANGED) to
// one-SKU-at-a-time processing. The legacy batch sync() feeds one batch's
// worth of result counts to detectCooldownPattern() at once; the worker
// only ever has ONE result count per call, so this tracker keeps a rolling
// window of the last N counts (N = the same threshold constant) and runs
// the identical detector against that window after every single search -
// a sliding-window decomposition of the same rule, not a different rule.
// Only the last `threshold` entries matter for detecting a currently-
// forming consecutive-empty run, so the window never needs to grow past
// that size. See project notes: this is a reported architectural
// adaptation, not a change to the cooldown threshold/wait/probe constants
// themselves (those stay exactly as configured in makeup-discovery-pacing.ts).
export class MakeupCooldownTracker {
	private readonly window: number[] = [];
	private readonly threshold: number;
	cooldownEventsInRun = 0;

	constructor(threshold: number = MAKEUP_COOLDOWN_CONSECUTIVE_EMPTY_THRESHOLD) {
		this.threshold = threshold;
	}

	recordResultCount(count: number): void {
		this.window.push(count);
		if (this.window.length > this.threshold) this.window.shift();
	}

	isCooldownDetected(): boolean {
		return detectCooldownPattern(this.window, this.threshold);
	}

	// Cooldown probe recovered (non-empty result) - reset so a fresh
	// consecutive-empty run has to build up again, matching the legacy
	// batch path's `cooldownActive = false` reset on probe success.
	reset(): void {
		this.window.length = 0;
	}
}
