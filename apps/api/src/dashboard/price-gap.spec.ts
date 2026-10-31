import { computeGap, EQUAL_TOLERANCE_PERCENT } from './price-gap';

describe('computeGap', () => {
	it('is more_expensive when Vizaje costs more than the tolerance allows', () => {
		const gap = computeGap(1100, 1000);
		expect(gap.gapAmount).toBe(100);
		expect(gap.gapPercent).toBeCloseTo(10, 5);
		expect(gap.position).toBe('more_expensive');
	});

	it('is cheaper when Vizaje costs less than the tolerance allows', () => {
		const gap = computeGap(900, 1000);
		expect(gap.gapAmount).toBe(-100);
		expect(gap.gapPercent).toBeCloseTo(-10, 5);
		expect(gap.position).toBe('cheaper');
	});

	it('denominator is ALWAYS the competitor price, never Vizaje price or an average', () => {
		// 1000 vs 500: using competitor (500) as denominator gives 100%,
		// using Vizaje (1000) would give 50% - must be the former.
		const gap = computeGap(1000, 500);
		expect(gap.gapPercent).toBeCloseTo(100, 5);
	});

	it('exactly at the +1% boundary is approximately_equal (<=, not <)', () => {
		expect(EQUAL_TOLERANCE_PERCENT).toBe(1);
		// competitor=1000, vizaje=1010 -> gapPercent exactly 1.0
		const gap = computeGap(1010, 1000);
		expect(gap.gapPercent).toBeCloseTo(1, 10);
		expect(gap.position).toBe('approximately_equal');
	});

	it('exactly at the -1% boundary is also approximately_equal', () => {
		// competitor=1000, vizaje=990 -> gapPercent exactly -1.0
		const gap = computeGap(990, 1000);
		expect(gap.gapPercent).toBeCloseTo(-1, 10);
		expect(gap.position).toBe('approximately_equal');
	});

	it('just past +1% (1.01%) is more_expensive, not approximately_equal', () => {
		// competitor=10000, vizaje=10101 -> gapPercent = 1.01
		const gap = computeGap(10101, 10000);
		expect(gap.gapPercent).toBeGreaterThan(1);
		expect(gap.position).toBe('more_expensive');
	});

	it('just past -1% (-1.01%) is cheaper, not approximately_equal', () => {
		// competitor=10000, vizaje=9899 -> gapPercent = -1.01
		const gap = computeGap(9899, 10000);
		expect(gap.gapPercent).toBeLessThan(-1);
		expect(gap.position).toBe('cheaper');
	});

	it('equal prices are exactly approximately_equal', () => {
		const gap = computeGap(1000, 1000);
		expect(gap.gapAmount).toBe(0);
		expect(gap.gapPercent).toBe(0);
		expect(gap.position).toBe('approximately_equal');
	});
});
