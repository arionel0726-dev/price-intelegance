/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'

import { describeFailureClass, describeStopReason, presentEvent } from './job-labels'
import type { JobEvent } from '../types/job'

function makeEvent(overrides: Partial<JobEvent> = {}): JobEvent {
	return {
		id: 1,
		jobRunId: 1,
		productId: null,
		eventType: 'job_queued',
		message: null,
		data: {},
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides
	}
}

describe('describeStopReason', () => {
	test('maps every stopReason value named in the Milestone 4 brief to plain language', () => {
		const briefValues = [
			'limit_reached',
			'pool_exhausted',
			'user_requested',
			'search_error_ratio_exceeded',
			'deferred_ratio_exceeded',
			'cooldown_limit_exceeded',
			'parser_unreachable',
			'heartbeat_lost',
			'unhandled_exception',
			'persist_error'
		]

		for (const value of briefValues) {
			const label = describeStopReason(value)
			expect(label).not.toBeNull()
			// Never just the raw snake_case value re-surfaced verbatim.
			expect(label).not.toBe(value)
		}
	})

	test('also maps the stopReason values the current backend actually emits', () => {
		// apps/api/src/jobs/discovery-worker.service.ts uses 'cooldown_limit'
		// (not 'cooldown_limit_exceeded') and 'unexpected_missing_competitor'.
		expect(describeStopReason('cooldown_limit')).toBe('Cooldown limit exceeded')
		expect(describeStopReason('unexpected_missing_competitor')).toBe('Competitor configuration missing')
	})

	test('null stays null', () => {
		expect(describeStopReason(null)).toBeNull()
	})

	test('an unknown reason falls back to a readable (not raw) string instead of throwing', () => {
		expect(describeStopReason('some_new_reason')).toBe('some new reason')
	})
})

describe('describeFailureClass', () => {
	test('maps both known classes', () => {
		expect(describeFailureClass('operational')).toContain('Operational')
		expect(describeFailureClass('application')).toContain('Application')
	})

	test('null stays null', () => {
		expect(describeFailureClass(null)).toBeNull()
	})
})

describe('presentEvent', () => {
	test('maps every M2/M3 eventType to a non-raw label', () => {
		const eventTypes = [
			'job_queued',
			'job_started',
			'job_recovered',
			'job_stop_requested',
			'job_stopping',
			'job_completed',
			'job_failed',
			'job_cancelled',
			'product_started',
			'product_auto_matched',
			'product_pending_review',
			'product_ai_auto_matched',
			'product_ai_rejected',
			'product_no_match',
			'product_error',
			'product_deferred',
			'cooldown_started',
			'cooldown_finished'
		]

		for (const eventType of eventTypes) {
			const presentation = presentEvent(makeEvent({ eventType }))
			expect(presentation.label.length).toBeGreaterThan(0)
			// None of these should just echo the raw snake_case eventType back.
			expect(presentation.label).not.toBe(eventType)
		}
	})

	test('job_recovered is only ever rendered from a real event - never inferred', () => {
		const presentation = presentEvent(makeEvent({ eventType: 'job_recovered' }))
		expect(presentation.label).toContain('recovered')
		expect(presentation.tone).toBe('warning')
	})

	test('product_ai_auto_matched surfaces confidence from data, success tone', () => {
		const presentation = presentEvent(makeEvent({ eventType: 'product_ai_auto_matched', data: { confidence: 0.91 } }))
		expect(presentation.message).toBe('Confidence 0.91')
		expect(presentation.tone).toBe('success')
	})

	test('job_failed surfaces the error message with danger tone', () => {
		const presentation = presentEvent(makeEvent({ eventType: 'job_failed', data: { error: 'boom' } }))
		expect(presentation.message).toBe('boom')
		expect(presentation.tone).toBe('danger')
	})

	test('an unrecognized eventType falls back to a readable label, never throws', () => {
		const presentation = presentEvent(makeEvent({ eventType: 'some_future_event', message: 'hello' }))
		expect(presentation.label).toBe('some future event')
		expect(presentation.message).toBe('hello')
	})
})
