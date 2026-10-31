/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
	ADMIN_PREFERENCES_KEY,
	ADMIN_PRODUCT_DEFAULTS,
	parseAdminProductSearchParams,
	readAdminPreferences,
	resolveAdminProductFilters,
	serializeAdminProductFilters,
	writeAdminPreferences,
	type AdminPreferences
} from './admin-url-state'

function makeFakeLocalStorage() {
	const store = new Map<string, string>()
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear()
	}
}

describe('parseAdminProductSearchParams', () => {
	test('reads a fully-specified URL', () => {
		const params = new URLSearchParams('q=foo&brand=Nivea&category=skincare&imageState=missing&overrideState=has_override&exclusionReason=duplicate&page=3')
		expect(parseAdminProductSearchParams(params)).toEqual({
			search: 'foo',
			brand: 'Nivea',
			category: 'skincare',
			imageState: 'missing',
			overrideState: 'has_override',
			exclusionReason: 'duplicate',
			page: 3
		})
	})

	test('an empty URL yields no fields - caller falls back to defaults', () => {
		expect(parseAdminProductSearchParams(new URLSearchParams())).toEqual({})
	})

	test('a non-integer or zero/negative page is ignored', () => {
		expect(parseAdminProductSearchParams(new URLSearchParams('page=abc'))).toEqual({})
		expect(parseAdminProductSearchParams(new URLSearchParams('page=0'))).toEqual({})
	})
})

describe('serializeAdminProductFilters', () => {
	test('default-valued fields are omitted entirely', () => {
		expect(serializeAdminProductFilters(ADMIN_PRODUCT_DEFAULTS)).toBe('')
	})

	test('non-default fields round-trip through the query string', () => {
		const filters = { search: 'foo', brand: 'Nivea', category: 'skincare', imageState: 'placeholder', overrideState: 'inherit', exclusionReason: 'other', page: 2 }
		const query = serializeAdminProductFilters(filters)
		expect(parseAdminProductSearchParams(new URLSearchParams(query))).toEqual(filters)
	})
})

describe('resolveAdminProductFilters', () => {
	test('an unspecified field falls back to ADMIN_PRODUCT_DEFAULTS', () => {
		expect(resolveAdminProductFilters({})).toEqual(ADMIN_PRODUCT_DEFAULTS)
	})

	test('URL values win over defaults', () => {
		expect(resolveAdminProductFilters({ brand: 'Nivea', page: 4 })).toEqual({ ...ADMIN_PRODUCT_DEFAULTS, brand: 'Nivea', page: 4 })
	})
})

describe('readAdminPreferences / writeAdminPreferences', () => {
	const realLocalStorage = globalThis.localStorage

	beforeEach(() => {
		// @ts-expect-error - test-only stand-in for the Storage interface.
		globalThis.localStorage = makeFakeLocalStorage()
	})

	afterEach(() => {
		globalThis.localStorage = realLocalStorage
	})

	test('missing key falls back to the default page size', () => {
		expect(readAdminPreferences()).toEqual({ pageSize: 20 })
	})

	test('writes round-trip through a real read', () => {
		const preferences: AdminPreferences = { pageSize: 50 }
		writeAdminPreferences(preferences)
		expect(readAdminPreferences()).toEqual(preferences)
	})

	test('garbage JSON falls back to defaults, never throws', () => {
		localStorage.setItem(ADMIN_PREFERENCES_KEY, '{not json')
		expect(readAdminPreferences()).toEqual({ pageSize: 20 })
	})

	test('an out-of-range pageSize is rejected as invalid', () => {
		localStorage.setItem(ADMIN_PREFERENCES_KEY, JSON.stringify({ pageSize: 5 }))
		expect(readAdminPreferences()).toEqual({ pageSize: 20 })
	})
})
