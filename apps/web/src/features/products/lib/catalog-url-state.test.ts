/// <reference types="bun-types" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
	CATALOG_DEFAULTS,
	CATALOG_PREFERENCES_KEY,
	parseCatalogSearchParams,
	readCatalogPreferences,
	resolveCatalogFilters,
	serializeCatalogFilters,
	writeCatalogPreferences,
	type CatalogPreferences
} from './catalog-url-state'

// Minimal in-memory stand-in for the Storage interface - bun:test runs with
// no DOM, so there is no real `localStorage` global; this is enough to
// exercise read/write/fallback behavior without pulling in a DOM shim.
function makeFakeLocalStorage() {
	const store = new Map<string, string>()

	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
		removeItem: (key: string) => store.delete(key),
		clear: () => store.clear()
	}
}

const DEFAULT_PREFERENCES: CatalogPreferences = {
	view: 'grid',
	pageSize: 40,
	lastBrand: 'all',
	lastCategory: 'all'
}

describe('parseCatalogSearchParams (URL -> partial filters)', () => {
	test('reads every known param', () => {
		const params = new URLSearchParams(
			'q=serum&brand=Nivea&category=skincare&view=list&page=3'
		)

		expect(parseCatalogSearchParams(params)).toEqual({
			search: 'serum',
			brand: 'Nivea',
			category: 'skincare',
			view: 'list',
			page: 3
		})
	})

	test('an empty URL yields an empty partial - nothing to fall back FROM', () => {
		expect(parseCatalogSearchParams(new URLSearchParams(''))).toEqual({})
	})

	test('a malformed page number is dropped, never thrown or NaN', () => {
		const params = new URLSearchParams('page=not-a-number')
		expect(parseCatalogSearchParams(params).page).toBeUndefined()

		expect(parseCatalogSearchParams(new URLSearchParams('page=0')).page).toBeUndefined()
		expect(parseCatalogSearchParams(new URLSearchParams('page=-5')).page).toBeUndefined()
		expect(parseCatalogSearchParams(new URLSearchParams('page=2.5')).page).toBeUndefined()
	})

	test('an unknown view value is dropped, never passed through', () => {
		const params = new URLSearchParams('view=carousel')
		expect(parseCatalogSearchParams(params).view).toBeUndefined()
	})

	test('an empty brand/category param is treated as unset, not as an explicit empty filter', () => {
		const params = new URLSearchParams('brand=&category=')
		expect(parseCatalogSearchParams(params)).toEqual({})
	})
})

describe('serializeCatalogFilters (filters -> URL)', () => {
	test('default-valued fields are omitted entirely', () => {
		expect(serializeCatalogFilters(CATALOG_DEFAULTS)).toBe('')
	})

	test('non-default fields round-trip back to the same filters', () => {
		const filters = { search: 'serum', brand: 'Nivea', category: 'skincare', view: 'list' as const, page: 3 }
		const query = serializeCatalogFilters(filters)

		expect(parseCatalogSearchParams(new URLSearchParams(query))).toEqual(filters)
	})

	test('page=1 (the default) is omitted even when other filters are set', () => {
		const query = serializeCatalogFilters({ ...CATALOG_DEFAULTS, brand: 'Nivea' })
		expect(query).toBe('brand=Nivea')
	})
})

describe('resolveCatalogFilters (URL precedence over localStorage)', () => {
	test('the URL wins field-by-field when it specifies a value', () => {
		const resolved = resolveCatalogFilters(
			{ brand: 'Nivea', view: 'list' },
			{ ...DEFAULT_PREFERENCES, lastBrand: 'Dove', view: 'grid' }
		)

		expect(resolved.brand).toBe('Nivea')
		expect(resolved.view).toBe('list')
	})

	test('localStorage fills fields the URL is silent on', () => {
		const resolved = resolveCatalogFilters(
			{},
			{ ...DEFAULT_PREFERENCES, lastBrand: 'Dove', view: 'list' }
		)

		expect(resolved.brand).toBe('Dove')
		expect(resolved.view).toBe('list')
	})

	test('search and page never fall back to localStorage - always default when the URL is silent', () => {
		const resolved = resolveCatalogFilters({}, DEFAULT_PREFERENCES)

		expect(resolved.search).toBe(CATALOG_DEFAULTS.search)
		expect(resolved.page).toBe(CATALOG_DEFAULTS.page)
	})

	test('a fully empty URL with default preferences resolves to CATALOG_DEFAULTS', () => {
		expect(resolveCatalogFilters({}, DEFAULT_PREFERENCES)).toEqual(CATALOG_DEFAULTS)
	})
})

describe('readCatalogPreferences / writeCatalogPreferences (localStorage, versioned key)', () => {
	let previousLocalStorage: unknown

	beforeEach(() => {
		previousLocalStorage = (globalThis as Record<string, unknown>).localStorage
		;(globalThis as Record<string, unknown>).localStorage = makeFakeLocalStorage()
	})

	afterEach(() => {
		(globalThis as Record<string, unknown>).localStorage = previousLocalStorage
	})

	test('no stored value falls back to defaults', () => {
		expect(readCatalogPreferences()).toEqual({
			view: 'grid',
			pageSize: 40,
			lastBrand: 'all',
			lastCategory: 'all'
		})
	})

	test('a value written through writeCatalogPreferences round-trips exactly', () => {
		const prefs: CatalogPreferences = { view: 'list', pageSize: 60, lastBrand: 'Nivea', lastCategory: 'skincare' }

		writeCatalogPreferences(prefs)

		expect(readCatalogPreferences()).toEqual(prefs)
		expect(localStorage.getItem(CATALOG_PREFERENCES_KEY)).not.toBeNull()
	})

	test('garbage JSON falls back to defaults instead of throwing', () => {
		localStorage.setItem(CATALOG_PREFERENCES_KEY, '{not json')

		expect(readCatalogPreferences()).toEqual({
			view: 'grid',
			pageSize: 40,
			lastBrand: 'all',
			lastCategory: 'all'
		})
	})

	test('a value from a different/older schema shape falls back to defaults instead of throwing', () => {
		localStorage.setItem(CATALOG_PREFERENCES_KEY, JSON.stringify({ view: 'carousel', pageSize: 'lots' }))

		expect(readCatalogPreferences()).toEqual({
			view: 'grid',
			pageSize: 40,
			lastBrand: 'all',
			lastCategory: 'all'
		})
	})

	test('a pageSize outside the sane range falls back to defaults', () => {
		localStorage.setItem(
			CATALOG_PREFERENCES_KEY,
			JSON.stringify({ view: 'grid', pageSize: 999999, lastBrand: 'all', lastCategory: 'all' })
		)

		expect(readCatalogPreferences().pageSize).toBe(40)
	})
})
