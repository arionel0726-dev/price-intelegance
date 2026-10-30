/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'

import { ApiError } from '@/lib/api/client'

import { buildEnqueuePayload, presentEnqueueError, validateNewJobForm, type NewJobFormState } from './job-form-logic'

function makeForm(overrides: Partial<NewJobFormState> = {}): NewJobFormState {
	return {
		competitor: 'makeup',
		mode: 'limited',
		brand: 'all',
		inStock: false,
		onlyUnmatched: true,
		productBudgetSeconds: 180,
		limit: 50,
		...overrides
	}
}

describe('validateNewJobForm', () => {
	test('limited mode requires a positive integer limit', () => {
		expect(validateNewJobForm(makeForm({ mode: 'limited', limit: 50 }))).toBeNull()
		expect(validateNewJobForm(makeForm({ mode: 'limited', limit: 0 }))).not.toBeNull()
		expect(validateNewJobForm(makeForm({ mode: 'limited', limit: -1 }))).not.toBeNull()
		expect(validateNewJobForm(makeForm({ mode: 'limited', limit: 1.5 }))).not.toBeNull()
	})

	test('continuous mode never requires a limit, even if the field holds a stale bad value', () => {
		expect(validateNewJobForm(makeForm({ mode: 'continuous', limit: 0 }))).toBeNull()
		expect(validateNewJobForm(makeForm({ mode: 'continuous', limit: -5 }))).toBeNull()
	})
})

describe('buildEnqueuePayload', () => {
	test('limited mode includes limit', () => {
		const payload = buildEnqueuePayload(makeForm({ mode: 'limited', limit: 75 }))
		expect(payload).toEqual({
			competitor: 'makeup',
			mode: 'limited',
			brand: null,
			inStock: false,
			onlyUnmatched: true,
			productBudgetSeconds: 180,
			limit: 75
		})
	})

	test('continuous mode omits limit entirely - not just sets it to null/undefined', () => {
		const payload = buildEnqueuePayload(makeForm({ mode: 'continuous', limit: 999 }))
		expect('limit' in payload).toBe(false)
	})

	test('"all" brand is sent as null (no filter), not the literal string "all"', () => {
		expect(buildEnqueuePayload(makeForm({ brand: 'all' })).brand).toBeNull()
	})

	test('a real brand filter passes through', () => {
		expect(buildEnqueuePayload(makeForm({ brand: 'Nivea' })).brand).toBe('Nivea')
	})
})

describe('presentEnqueueError', () => {
	test('a 409 is shown as a clean duplicate-active-job explanation, not a generic error', () => {
		const error = new ApiError(409, 'A discovery job is already queued or running for MAKEUP')
		const presentation = presentEnqueueError(error)
		expect(presentation.duplicateActiveJobMessage).toBe('A discovery job is already queued or running for MAKEUP')
		expect(presentation.otherErrorMessage).toBeNull()
	})

	test('any other ApiError status is a generic error, not the duplicate-job message', () => {
		const error = new ApiError(400, 'Bad request')
		const presentation = presentEnqueueError(error)
		expect(presentation.duplicateActiveJobMessage).toBeNull()
		expect(presentation.otherErrorMessage).toBe('Bad request')
	})

	test('a plain Error also surfaces as a generic error', () => {
		const presentation = presentEnqueueError(new Error('network down'))
		expect(presentation.otherErrorMessage).toBe('network down')
	})

	test('no error at all yields no messages', () => {
		expect(presentEnqueueError(null)).toEqual({ duplicateActiveJobMessage: null, otherErrorMessage: null })
	})
})
