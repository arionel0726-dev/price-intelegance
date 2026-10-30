/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'

import { buildJobCounterSummary } from './job-counters-math'
import type { JobRun } from '../types/job'

function makeJob(overrides: Partial<JobRun> = {}): JobRun {
	return {
		id: 1,
		competitorId: 1,
		competitorSlug: 'makeup',
		competitorName: 'MAKEUP',
		jobType: 'discovery',
		mode: 'limited',
		status: 'running',
		params: { brand: null, inStock: false, onlyUnmatched: true, limit: 100, productBudgetSeconds: 180 },
		stopRequested: false,
		stopRequestedAt: null,
		stopReason: null,
		failureClass: null,
		eligibleAtStart: null,
		processedCount: 0,
		autoCount: 0,
		aiAutoCount: 0,
		aiReviewCount: 0,
		noMatchCount: 0,
		errorCount: 0,
		retryCount: 0,
		currentProductId: null,
		currentProductStartedAt: null,
		workerId: null,
		heartbeatAt: null,
		startedAt: null,
		finishedAt: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		error: null,
		...overrides
	}
}

describe('buildJobCounterSummary', () => {
	test('Confirmed is autoCount + aiAutoCount', () => {
		const job = makeJob({ autoCount: 10, aiAutoCount: 3 })
		expect(buildJobCounterSummary(job).confirmed).toBe(13)
	})

	test('every other counter passes through unchanged', () => {
		const job = makeJob({ aiReviewCount: 2, noMatchCount: 5, errorCount: 1, retryCount: 4 })
		const summary = buildJobCounterSummary(job)
		expect(summary.needsReview).toBe(2)
		expect(summary.noMatch).toBe(5)
		expect(summary.errors).toBe(1)
		expect(summary.retries).toBe(4)
	})

	test('a fresh job (all zero counters)', () => {
		expect(buildJobCounterSummary(makeJob())).toEqual({ confirmed: 0, needsReview: 0, noMatch: 0, errors: 0, retries: 0 })
	})
})
