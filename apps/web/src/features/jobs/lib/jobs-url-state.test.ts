/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
	JOB_HISTORY_DEFAULTS,
	JOBS_PREFERENCES_KEY,
	parseJobHistorySearchParams,
	readJobsPreferences,
	resolveJobHistoryFilters,
	serializeJobHistoryFilters,
	writeJobsPreferences,
	type JobsPreferences
} from './jobs-url-state'

// Same in-memory Storage stand-in convention as
// features/products/lib/catalog-url-state.test.ts.
function makeFakeLocalStorage() {
	const store = new Map<string, string>()
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear()
	}
}

describe('parseJobHistorySearchParams', () => {
	test('reads a fully-specified URL', () => {
		const params = new URLSearchParams('competitor=makeup&status=failed&page=3')
		expect(parseJobHistorySearchParams(params)).toEqual({ competitor: 'makeup', status: 'failed', page: 3 })
	})

	test('an empty URL yields no fields - caller falls back to defaults', () => {
		expect(parseJobHistorySearchParams(new URLSearchParams())).toEqual({})
	})

	test('an unknown competitor/status is treated as unset, never throws', () => {
		const params = new URLSearchParams('competitor=bogus&status=bogus&page=0')
		expect(parseJobHistorySearchParams(params)).toEqual({})
	})

	test('"all" is a valid explicit value for competitor/status', () => {
		const params = new URLSearchParams('competitor=all&status=all')
		expect(parseJobHistorySearchParams(params)).toEqual({ competitor: 'all', status: 'all' })
	})

	test('a non-integer or zero/negative page is ignored', () => {
		expect(parseJobHistorySearchParams(new URLSearchParams('page=abc'))).toEqual({})
		expect(parseJobHistorySearchParams(new URLSearchParams('page=0'))).toEqual({})
		expect(parseJobHistorySearchParams(new URLSearchParams('page=-1'))).toEqual({})
	})
})

describe('serializeJobHistoryFilters', () => {
	test('default-valued fields are omitted entirely', () => {
		expect(serializeJobHistoryFilters(JOB_HISTORY_DEFAULTS)).toBe('')
	})

	test('non-default fields round-trip through the query string', () => {
		const query = serializeJobHistoryFilters({ competitor: 'ovico', status: 'running', page: 2 })
		const reparsed = parseJobHistorySearchParams(new URLSearchParams(query))
		expect(reparsed).toEqual({ competitor: 'ovico', status: 'running', page: 2 })
	})
})

describe('resolveJobHistoryFilters', () => {
	test('URL values win over defaults', () => {
		expect(resolveJobHistoryFilters({ competitor: 'makeup', status: 'completed', page: 5 })).toEqual({
			competitor: 'makeup',
			status: 'completed',
			page: 5
		})
	})

	test('an unspecified field falls back to JOB_HISTORY_DEFAULTS', () => {
		expect(resolveJobHistoryFilters({})).toEqual(JOB_HISTORY_DEFAULTS)
	})
})

describe('readJobsPreferences / writeJobsPreferences', () => {
	const realLocalStorage = globalThis.localStorage

	beforeEach(() => {
		// @ts-expect-error - test-only stand-in for the Storage interface.
		globalThis.localStorage = makeFakeLocalStorage()
	})

	afterEach(() => {
		globalThis.localStorage = realLocalStorage
	})

	test('missing key falls back to the default page size', () => {
		expect(readJobsPreferences()).toEqual({ pageSize: 20 })
	})

	test('writes round-trip through a real read', () => {
		const preferences: JobsPreferences = { pageSize: 50 }
		writeJobsPreferences(preferences)
		expect(readJobsPreferences()).toEqual(preferences)
	})

	test('garbage JSON falls back to defaults, never throws', () => {
		localStorage.setItem(JOBS_PREFERENCES_KEY, '{not json')
		expect(readJobsPreferences()).toEqual({ pageSize: 20 })
	})

	test('an out-of-range pageSize is rejected as invalid', () => {
		localStorage.setItem(JOBS_PREFERENCES_KEY, JSON.stringify({ pageSize: 5 }))
		expect(readJobsPreferences()).toEqual({ pageSize: 20 })

		localStorage.setItem(JOBS_PREFERENCES_KEY, JSON.stringify({ pageSize: 500 }))
		expect(readJobsPreferences()).toEqual({ pageSize: 20 })
	})

	test('a disabled/throwing store falls back to defaults, never throws', () => {
		// @ts-expect-error - deliberately broken Storage stand-in.
		globalThis.localStorage = {
			getItem: () => {
				throw new Error('blocked')
			}
		}
		expect(readJobsPreferences()).toEqual({ pageSize: 20 })
		expect(() => writeJobsPreferences({ pageSize: 10 })).not.toThrow()
	})
})
