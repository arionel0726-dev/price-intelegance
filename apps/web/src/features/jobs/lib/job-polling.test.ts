/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'

import { canStopJob, isTerminalStatus, nextPollDelay } from './job-polling'
import type { JobStatus } from '../types/job'

const ALL_STATUSES: JobStatus[] = ['queued', 'running', 'stopping', 'completed', 'failed', 'cancelled']

describe('isTerminalStatus / canStopJob', () => {
	test('exactly the 3 terminal statuses are terminal, the other 3 are not', () => {
		const terminal = ALL_STATUSES.filter(isTerminalStatus)
		expect(terminal.sort()).toEqual(['cancelled', 'completed', 'failed'])
	})

	test('Stop is offered exactly for queued/running/stopping', () => {
		const stoppable = ALL_STATUSES.filter(canStopJob)
		expect(stoppable.sort()).toEqual(['queued', 'running', 'stopping'])
	})

	test('canStopJob and isTerminalStatus are perfect complements over all 6 statuses', () => {
		for (const status of ALL_STATUSES) {
			expect(canStopJob(status)).toBe(!isTerminalStatus(status))
		}
	})
})

describe('nextPollDelay', () => {
	test('polling continues for an active job', () => {
		expect(nextPollDelay('running', 2500)).toBe(2500)
		expect(nextPollDelay('queued', 2500)).toBe(2500)
		expect(nextPollDelay('stopping', 2500)).toBe(2500)
	})

	test('polling stops entirely once a job reaches a terminal status - never re-fetches a dead job on a timer', () => {
		expect(nextPollDelay('completed', 2500)).toBe(false)
		expect(nextPollDelay('failed', 2500)).toBe(false)
		expect(nextPollDelay('cancelled', 2500)).toBe(false)
	})

	test('status not yet known (initial load) keeps polling at the active interval', () => {
		expect(nextPollDelay(undefined, 2500)).toBe(2500)
	})
})
