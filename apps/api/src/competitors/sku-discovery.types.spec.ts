import { isValidProductBudgetSeconds, SkuBudget } from './sku-discovery.types';

describe('isValidProductBudgetSeconds', () => {
	it('accepts the suggested presets', () => {
		for (const value of [60, 180, 300, 600]) {
			expect(isValidProductBudgetSeconds(value)).toBe(true);
		}
	});

	it('accepts any integer within [30, 1800]', () => {
		expect(isValidProductBudgetSeconds(30)).toBe(true);
		expect(isValidProductBudgetSeconds(1800)).toBe(true);
		expect(isValidProductBudgetSeconds(912)).toBe(true);
	});

	it('rejects values outside the range', () => {
		expect(isValidProductBudgetSeconds(29)).toBe(false);
		expect(isValidProductBudgetSeconds(1801)).toBe(false);
		expect(isValidProductBudgetSeconds(0)).toBe(false);
		expect(isValidProductBudgetSeconds(-60)).toBe(false);
	});

	it('rejects non-integers and non-numbers', () => {
		expect(isValidProductBudgetSeconds(60.5)).toBe(false);
		expect(isValidProductBudgetSeconds('300')).toBe(false);
		expect(isValidProductBudgetSeconds(null)).toBe(false);
		expect(isValidProductBudgetSeconds(undefined)).toBe(false);
	});
});

describe('SkuBudget', () => {
	it('is not exhausted immediately after construction', () => {
		const budget = new SkuBudget(60);
		expect(budget.isExhausted()).toBe(false);
	});

	it('is exhausted once the configured number of seconds has elapsed', () => {
		jest.useFakeTimers();
		const start = Date.now();
		jest.setSystemTime(start);

		const budget = new SkuBudget(30);
		expect(budget.isExhausted()).toBe(false);

		jest.setSystemTime(start + 29_000);
		expect(budget.isExhausted()).toBe(false);

		jest.setSystemTime(start + 30_000);
		expect(budget.isExhausted()).toBe(true);

		jest.useRealTimers();
	});
});
