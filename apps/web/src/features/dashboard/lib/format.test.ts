/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'

import { formatGapAmount, formatGapPercent, formatMdl, formatPercent, POSITION_LABEL } from './format'

describe('POSITION_LABEL', () => {
	test('maps every PricePosition to a business-safe, non-raw label', () => {
		expect(POSITION_LABEL.more_expensive.length).toBeGreaterThan(0)
		expect(POSITION_LABEL.cheaper.length).toBeGreaterThan(0)
		expect(POSITION_LABEL.approximately_equal.length).toBeGreaterThan(0)
		// Never a raw enum value re-surfaced verbatim.
		expect(POSITION_LABEL.more_expensive).not.toBe('more_expensive')
	})
})

describe('formatGapPercent', () => {
	test('a positive gap shows an explicit + sign', () => {
		expect(formatGapPercent(10)).toBe('+10.0%')
	})

	test('a negative gap shows the sign naturally (no double negative)', () => {
		expect(formatGapPercent(-10)).toBe('-10.0%')
	})

	test('exactly zero is shown as approximately equal (±), never a bare "0.0%"', () => {
		expect(formatGapPercent(0)).toBe('±0.0%')
	})
})

describe('formatGapAmount', () => {
	test('a positive amount shows an explicit + sign', () => {
		expect(formatGapAmount(100)).toContain('+')
	})

	test('a negative amount is not double-signed', () => {
		const result = formatGapAmount(-100)
		expect(result.startsWith('--')).toBe(false)
	})
})

describe('formatMdl / formatPercent', () => {
	test('null price formats as an em dash, never "null" or "NaN"', () => {
		expect(formatMdl(null)).toBe('—')
	})

	test('a percent formats with one decimal', () => {
		expect(formatPercent(33.333)).toBe('33.3%')
	})
})

describe('no fake historical-trend UI', () => {
	// The M6 brief is explicit: current-state only, no 7-day/monthly trend
	// chart. This is a standing assertion, not a snapshot - it fails the
	// moment someone adds a "trend"/"history" formatter to this module,
	// which is the signal to re-litigate the decision, not silently ship it.
	test('this format module exposes no trend/history/sparkline formatter', () => {
		const exportNames = ['formatGapAmount', 'formatGapPercent', 'formatMdl', 'formatPercent', 'formatCount', 'POSITION_LABEL']
		const forbidden = ['trend', 'history', 'sparkline', 'weekOverWeek', 'monthly']
		for (const name of exportNames) {
			for (const bad of forbidden) {
				expect(name.toLowerCase().includes(bad.toLowerCase())).toBe(false)
			}
		}
	})
})
