import { MakeupCooldownTracker } from './makeup-cooldown-tracker';

describe('MakeupCooldownTracker', () => {
	it('does not detect a cooldown before the threshold run length is reached', () => {
		const tracker = new MakeupCooldownTracker(7);
		for (let i = 0; i < 6; i++) tracker.recordResultCount(0);
		expect(tracker.isCooldownDetected()).toBe(false);
	});

	it('detects a cooldown once a sliding window of consecutive-empty results reaches the threshold - fed one at a time, like the worker does', () => {
		const tracker = new MakeupCooldownTracker(7);
		for (let i = 0; i < 7; i++) tracker.recordResultCount(0);
		expect(tracker.isCooldownDetected()).toBe(true);
	});

	it('is the same rule as the legacy batch detector - same threshold, same semantics, fed differently', () => {
		// detectCooldownPattern([0,0,0,0,0,0,0], 7) === true in the legacy
		// batch call shape; the tracker must agree when fed the same counts
		// one at a time.
		const tracker = new MakeupCooldownTracker(7);
		const counts = [5, 3, 0, 0, 0, 0, 0, 0, 0];
		let detectedAt = -1;
		counts.forEach((count, i) => {
			tracker.recordResultCount(count);
			if (detectedAt === -1 && tracker.isCooldownDetected()) detectedAt = i;
		});
		// 7 consecutive zeros start at index 2 and complete at index 8
		// (2..8 inclusive is 7 entries).
		expect(detectedAt).toBe(8);
	});

	it('a single non-empty result resets the consecutive-empty run', () => {
		const tracker = new MakeupCooldownTracker(7);
		for (let i = 0; i < 6; i++) tracker.recordResultCount(0);
		tracker.recordResultCount(3); // breaks the run
		for (let i = 0; i < 6; i++) tracker.recordResultCount(0);
		expect(tracker.isCooldownDetected()).toBe(false);
	});

	it('reset() clears the window so a recovered probe needs a fresh run to re-trigger', () => {
		const tracker = new MakeupCooldownTracker(7);
		for (let i = 0; i < 7; i++) tracker.recordResultCount(0);
		expect(tracker.isCooldownDetected()).toBe(true);

		tracker.reset();
		expect(tracker.isCooldownDetected()).toBe(false);

		for (let i = 0; i < 6; i++) tracker.recordResultCount(0);
		expect(tracker.isCooldownDetected()).toBe(false);
	});

	it('cooldownEventsInRun is caller-managed state, not touched by recordResultCount/reset', () => {
		const tracker = new MakeupCooldownTracker(7);
		tracker.cooldownEventsInRun = 2;
		tracker.recordResultCount(0);
		tracker.reset();
		expect(tracker.cooldownEventsInRun).toBe(2);
	});
});
