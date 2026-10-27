// Milestone 2 pacing fix: restores the legacy MakeupTargetedSyncService
// batch-pause shape ("process up to MAKEUP_DISCOVERY_BATCH_SIZE products,
// then wait the full MAKEUP_DISCOVERY_BATCH_PAUSE_MS once, then continue")
// in the one-SKU-at-a-time DiscoveryWorkerService path, which has no
// batch boundary of its own to pause at. A single averaged-per-SKU delay
// (BATCH_PAUSE_MS / BATCH_SIZE after every SKU) is NOT equivalent anti-bot
// behavior and was rejected - see project notes.
//
// Deliberately NOT ticked for a 'deferred' (cooldown) outcome: that SKU's
// search never actually ran, and runMakeupOne's own cooldown handling
// already sleeps MAKEUP_COOLDOWN_WAIT_MS for it - ticking this pacer too
// would double up pauses, and the legacy batch loop has the same
// exclusion (a cooldown-triggering batch `continue`s past its own
// end-of-batch pause).
export class MakeupBatchPacer {
	private productsSinceBatchPause = 0;

	constructor(
		private readonly batchSize: number,
		private readonly batchPauseMs: number,
		private readonly sleepFn: (ms: number) => Promise<void>,
	) {}

	// Call once per SKU that was actually searched (i.e. every outcome
	// except 'deferred'). Resolves immediately except on the
	// batchSize-th call in a row, where it awaits the full pause and
	// resets the counter so the cycle repeats.
	async afterProduct(): Promise<void> {
		this.productsSinceBatchPause += 1;

		if (this.productsSinceBatchPause >= this.batchSize) {
			this.productsSinceBatchPause = 0;
			await this.sleepFn(this.batchPauseMs);
		}
	}
}
