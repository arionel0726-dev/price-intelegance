// Single source of truth for the catalog's URL<->state contract (Milestone
// 2.5). The URL is the primary store - search/brand/category/view/page all
// round-trip through it so Back/Forward and shared/reloaded links restore
// the exact same catalog. localStorage is a FALLBACK ONLY for the fields
// listed in CatalogPreferences, and only applies when the URL itself says
// nothing about that field - the URL always wins. No auth/session data
// ever goes through either of these.
export type CatalogView = 'grid' | 'list'

export type CatalogFilters = {
	search: string
	brand: string
	category: string
	view: CatalogView
	page: number
}

export const CATALOG_DEFAULTS: CatalogFilters = {
	search: '',
	brand: 'all',
	category: 'all',
	view: 'grid',
	page: 1
}

const PARAM = {
	search: 'q',
	brand: 'brand',
	category: 'category',
	view: 'view',
	page: 'page'
} as const

function isCatalogView(value: string | null): value is CatalogView {
	return value === 'grid' || value === 'list'
}

function parsePage(value: string | null): number | null {
	if (value === null) return null

	const parsed = Number(value)

	return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

// Reads whatever the URL itself specifies - a field the URL is silent on
// stays `undefined` here so the caller can fall back to localStorage, then
// to CATALOG_DEFAULTS, without the URL's absence being confused with an
// explicit "use the default" instruction. Malformed values (garbage page
// number, unknown view) are treated the same as "URL doesn't specify this"
// - they never throw and never propagate nonsense into the UI.
export function parseCatalogSearchParams(
	searchParams: URLSearchParams
): Partial<CatalogFilters> {
	const result: Partial<CatalogFilters> = {}

	const search = searchParams.get(PARAM.search)
	if (search !== null) result.search = search

	const brand = searchParams.get(PARAM.brand)
	if (brand !== null && brand.length > 0) result.brand = brand

	const category = searchParams.get(PARAM.category)
	if (category !== null && category.length > 0) result.category = category

	const view = searchParams.get(PARAM.view)
	if (isCatalogView(view)) result.view = view

	const page = parsePage(searchParams.get(PARAM.page))
	if (page !== null) result.page = page

	return result
}

// Builds the query string for a FULL filter set. Default-valued fields are
// omitted so the URL stays clean (e.g. the bare catalog URL has no params
// at all) - a reader of the URL can't tell "explicitly set to the default"
// apart from "unset" anyway, and that distinction never matters to this UI.
export function serializeCatalogFilters(filters: CatalogFilters): string {
	const query = new URLSearchParams()

	if (filters.search !== CATALOG_DEFAULTS.search) query.set(PARAM.search, filters.search)
	if (filters.brand !== CATALOG_DEFAULTS.brand) query.set(PARAM.brand, filters.brand)
	if (filters.category !== CATALOG_DEFAULTS.category) query.set(PARAM.category, filters.category)
	if (filters.view !== CATALOG_DEFAULTS.view) query.set(PARAM.view, filters.view)
	if (filters.page !== CATALOG_DEFAULTS.page) query.set(PARAM.page, String(filters.page))

	return query.toString()
}

// --- localStorage fallback (view/page-size/last-used-filters only) -------

export const CATALOG_PREFERENCES_KEY = 'price-intelligence.catalog.preferences.v1'

export type CatalogPreferences = {
	view: CatalogView
	pageSize: number
	lastBrand: string
	lastCategory: string
}

const DEFAULT_PAGE_SIZE = 40
const MIN_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

function isValidPreferences(value: unknown): value is CatalogPreferences {
	if (typeof value !== 'object' || value === null) return false

	const candidate = value as Record<string, unknown>

	return (
		isCatalogView(typeof candidate.view === 'string' ? candidate.view : null) &&
		typeof candidate.pageSize === 'number' &&
		Number.isInteger(candidate.pageSize) &&
		candidate.pageSize >= MIN_PAGE_SIZE &&
		candidate.pageSize <= MAX_PAGE_SIZE &&
		typeof candidate.lastBrand === 'string' &&
		typeof candidate.lastCategory === 'string'
	)
}

// Never throws - a missing key, disabled/blocked storage (private window),
// or garbage JSON from a previous schema version all fall back to defaults
// identically. Versioned in the key itself (".v1") rather than inside the
// payload - a future shape change just picks a new key and abandons the
// old one, no migration code needed.
export function readCatalogPreferences(): CatalogPreferences {
	const fallback: CatalogPreferences = {
		view: CATALOG_DEFAULTS.view,
		pageSize: DEFAULT_PAGE_SIZE,
		lastBrand: CATALOG_DEFAULTS.brand,
		lastCategory: CATALOG_DEFAULTS.category
	}

	try {
		// Referenced as the bare global (not `window.localStorage`) so this
		// also works unmodified under a test runner with no DOM - SSR (no
		// `localStorage` global at all) and a disabled/blocked store (throws
		// on access) both fall through to the same `fallback`.
		if (typeof localStorage === 'undefined') return fallback

		const raw = localStorage.getItem(CATALOG_PREFERENCES_KEY)
		if (!raw) return fallback

		const parsed = JSON.parse(raw)

		return isValidPreferences(parsed) ? parsed : fallback
	} catch {
		return fallback
	}
}

export function writeCatalogPreferences(preferences: CatalogPreferences): void {
	try {
		if (typeof localStorage === 'undefined') return

		localStorage.setItem(CATALOG_PREFERENCES_KEY, JSON.stringify(preferences))
	} catch {
		// Storage unavailable/full/blocked - preferences are a convenience,
		// never required for the catalog to function.
	}
}

// Resolves the field-by-field URL override onto stored preferences, then
// onto hard defaults - the URL always wins, exactly where it says
// something; localStorage only fills gaps the URL leaves open.
export function resolveCatalogFilters(
	fromUrl: Partial<CatalogFilters>,
	preferences: CatalogPreferences
): CatalogFilters {
	return {
		search: fromUrl.search ?? CATALOG_DEFAULTS.search,
		brand: fromUrl.brand ?? preferences.lastBrand,
		category: fromUrl.category ?? preferences.lastCategory,
		view: fromUrl.view ?? preferences.view,
		page: fromUrl.page ?? CATALOG_DEFAULTS.page
	}
}
