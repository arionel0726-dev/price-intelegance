/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
	DASHBOARD_DEFAULTS,
	DASHBOARD_PREFERENCES_KEY,
	parseDashboardSearchParams,
	readDashboardPreferences,
	resolveDashboardFilters,
	serializeDashboardFilters,
	writeDashboardPreferences,
	type DashboardPreferences
} from './dashboard-url-state'

function makeFakeLocalStorage() {
	const store = new Map<string, string>()
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear()
	}
}

describe('parseDashboardSearchParams', () => {
	test('reads a fully-specified URL', () => {
		const params = new URLSearchParams('competitor=makeup&brand=Nivea&position=cheaper&sort=gapAmount&direction=asc&page=3')
		expect(parseDashboardSearchParams(params)).toEqual({
			competitor: 'makeup',
			brand: 'Nivea',
			position: 'cheaper',
			sort: 'gapAmount',
			direction: 'asc',
			page: 3
		})
	})

	test('an empty URL yields no fields - caller falls back to defaults', () => {
		expect(parseDashboardSearchParams(new URLSearchParams())).toEqual({})
	})

	test('an unknown competitor/position/sort is treated as unset, never throws', () => {
		const params = new URLSearchParams('competitor=bogus&position=bogus&sort=bogus&page=0')
		expect(parseDashboardSearchParams(params)).toEqual({})
	})

	test('"all" is a valid explicit value for competitor and position', () => {
		const params = new URLSearchParams('competitor=all&position=all')
		expect(parseDashboardSearchParams(params)).toEqual({ competitor: 'all', position: 'all' })
	})
})

describe('serializeDashboardFilters', () => {
	test('default-valued fields are omitted entirely', () => {
		expect(serializeDashboardFilters(DASHBOARD_DEFAULTS)).toBe('')
	})

	test('non-default fields round-trip through the query string', () => {
		const filters = { competitor: 'ovico' as const, brand: 'Nivea', position: 'more_expensive' as const, sort: 'name' as const, direction: 'asc' as const, page: 2 }
		const query = serializeDashboardFilters(filters)
		expect(parseDashboardSearchParams(new URLSearchParams(query))).toEqual(filters)
	})
})

describe('resolveDashboardFilters', () => {
	test('an unspecified field falls back to DASHBOARD_DEFAULTS', () => {
		expect(resolveDashboardFilters({})).toEqual(DASHBOARD_DEFAULTS)
	})

	test('URL values win over defaults', () => {
		expect(resolveDashboardFilters({ competitor: 'makeup', page: 5 })).toEqual({ ...DASHBOARD_DEFAULTS, competitor: 'makeup', page: 5 })
	})
})

describe('readDashboardPreferences / writeDashboardPreferences', () => {
	const realLocalStorage = globalThis.localStorage

	beforeEach(() => {
		// @ts-expect-error - test-only stand-in for the Storage interface.
		globalThis.localStorage = makeFakeLocalStorage()
	})

	afterEach(() => {
		globalThis.localStorage = realLocalStorage
	})

	test('missing key falls back to the default page size', () => {
		expect(readDashboardPreferences()).toEqual({ pageSize: 20 })
	})

	test('writes round-trip through a real read', () => {
		const preferences: DashboardPreferences = { pageSize: 50 }
		writeDashboardPreferences(preferences)
		expect(readDashboardPreferences()).toEqual(preferences)
	})

	test('garbage JSON falls back to defaults, never throws', () => {
		localStorage.setItem(DASHBOARD_PREFERENCES_KEY, '{not json')
		expect(readDashboardPreferences()).toEqual({ pageSize: 20 })
	})
})
