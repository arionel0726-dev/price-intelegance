/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'

import { computeLimitedProgress, formatElapsedSeconds } from './job-progress-math'

describe('computeLimitedProgress', () => {
	test('a mid-run limited job', () => {
		expect(computeLimitedProgress(25, 100)).toEqual({ processed: 25, limit: 100, percent: 25 })
	})

	test('a completed limited job never exceeds 100%', () => {
		// Defends against an off-by-one from the worker (processedCount
		// momentarily one past limit) - still clamps to exactly the limit,
		// never a percent over 100.
		expect(computeLimitedProgress(101, 100)).toEqual({ processed: 100, limit: 100, percent: 100 })
	})

	test('zero processed so far', () => {
		expect(computeLimitedProgress(0, 50)).toEqual({ processed: 0, limit: 50, percent: 0 })
	})

	test('a limit of 0 reads as 0% - never NaN/Infinity', () => {
		expect(computeLimitedProgress(0, 0)).toEqual({ processed: 0, limit: 0, percent: 0 })
	})

	test('a negative processedCount is clamped to 0', () => {
		expect(computeLimitedProgress(-5, 10)).toEqual({ processed: 0, limit: 10, percent: 0 })
	})
})

describe('formatElapsedSeconds', () => {
	test('under a minute shows seconds only', () => {
		expect(formatElapsedSeconds(45)).toBe('45s')
	})

	test('over a minute shows minutes and seconds', () => {
		expect(formatElapsedSeconds(125)).toBe('2m 5s')
	})

	test('negative/garbage input never goes negative', () => {
		expect(formatElapsedSeconds(-10)).toBe('0s')
	})
})
