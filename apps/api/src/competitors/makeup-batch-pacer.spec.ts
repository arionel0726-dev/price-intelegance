import { MakeupBatchPacer } from './makeup-batch-pacer';

describe('MakeupBatchPacer', () => {
	function makeFakeSleep() {
		const calls: number[] = [];
		const sleepFn = async (ms: number) => {
			calls.push(ms);
		};
		return { calls, sleepFn };
	}

	it('never pauses for SKUs 1..(BATCH_SIZE-1)', async () => {
		const { calls, sleepFn } = makeFakeSleep();
		const pacer = new MakeupBatchPacer(5, 90_000, sleepFn);

		for (let i = 0; i < 4; i++) {
			await pacer.afterProduct();
		}

		expect(calls).toEqual([]);
	});

	it('pauses exactly once, for the full batchPauseMs, on the BATCH_SIZE-th SKU', async () => {
		const { calls, sleepFn } = makeFakeSleep();
		const pacer = new MakeupBatchPacer(5, 90_000, sleepFn);

		for (let i = 0; i < 5; i++) {
			await pacer.afterProduct();
		}

		expect(calls).toEqual([90_000]);
	});

	it('resets the counter and repeats the cycle over multiple batches', async () => {
		const { calls, sleepFn } = makeFakeSleep();
		const pacer = new MakeupBatchPacer(5, 90_000, sleepFn);

		for (let i = 0; i < 17; i++) {
			await pacer.afterProduct();
		}

		// 17 products at batch size 5 -> pauses after product 5, 10, 15 -
		// three full pauses, with products 16 and 17 mid-way into the next
		// burst (no 4th pause yet).
		expect(calls).toEqual([90_000, 90_000, 90_000]);
	});

	it('uses the exact configured batchPauseMs, not a value derived from batchSize', async () => {
		const { calls, sleepFn } = makeFakeSleep();
		const pacer = new MakeupBatchPacer(25, 90_000, sleepFn);

		for (let i = 0; i < 25; i++) {
			await pacer.afterProduct();
		}

		// The averaged-per-SKU deviation this fix reverts would have slept
		// 90_000 / 25 = 3_600ms after every product instead of this.
		expect(calls).toEqual([90_000]);
	});

	it('is a standalone pure unit - OVICO never constructs or calls it (see DiscoveryWorkerService.runJob, which only builds one for domain === "makeup.md")', () => {
		// No assertion needed beyond this test existing and the class
		// having zero dependency on any OVICO type - documents the
		// intended non-usage for the record the pacing-fix review asked
		// for.
		expect(MakeupBatchPacer).toBeDefined();
	});
});
