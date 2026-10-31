// URL<->state contract for /admin/products (Milestone 5), same pattern as
// features/products/lib/catalog-url-state.ts and features/jobs/lib/
// jobs-url-state.ts: the URL is the primary store (shareable, Back/
// Forward-safe, survives refresh); localStorage is a fallback ONLY for
// page-size, and only applies where the URL itself says nothing - the URL
// always wins.
export type AdminProductFilters = {
	search: string
	brand: string
	category: string
	imageState: string
	overrideState: string
	exclusionReason: string
	page: number
}

export const ADMIN_PRODUCT_DEFAULTS: AdminProductFilters = {
	search: '',
	brand: 'all',
	category: 'all',
	imageState: 'all',
	overrideState: 'all',
	exclusionReason: 'all',
	page: 1
}

const PARAM = {
	search: 'q',
	brand: 'brand',
	category: 'category',
	imageState: 'imageState',
	overrideState: 'overrideState',
	exclusionReason: 'exclusionReason',
	page: 'page'
} as const

function parsePage(value: string | null): number | null {
	if (value === null) return null
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

export function parseAdminProductSearchParams(searchParams: URLSearchParams): Partial<AdminProductFilters> {
	const result: Partial<AdminProductFilters> = {}

	const search = searchParams.get(PARAM.search)
	if (search !== null) result.search = search

	const brand = searchParams.get(PARAM.brand)
	if (brand !== null && brand.length > 0) result.brand = brand

	const category = searchParams.get(PARAM.category)
	if (category !== null && category.length > 0) result.category = category

	const imageState = searchParams.get(PARAM.imageState)
	if (imageState !== null && imageState.length > 0) result.imageState = imageState

	const overrideState = searchParams.get(PARAM.overrideState)
	if (overrideState !== null && overrideState.length > 0) result.overrideState = overrideState

	const exclusionReason = searchParams.get(PARAM.exclusionReason)
	if (exclusionReason !== null && exclusionReason.length > 0) result.exclusionReason = exclusionReason

	const page = parsePage(searchParams.get(PARAM.page))
	if (page !== null) result.page = page

	return result
}

export function serializeAdminProductFilters(filters: AdminProductFilters): string {
	const query = new URLSearchParams()

	if (filters.search !== ADMIN_PRODUCT_DEFAULTS.search) query.set(PARAM.search, filters.search)
	if (filters.brand !== ADMIN_PRODUCT_DEFAULTS.brand) query.set(PARAM.brand, filters.brand)
	if (filters.category !== ADMIN_PRODUCT_DEFAULTS.category) query.set(PARAM.category, filters.category)
	if (filters.imageState !== ADMIN_PRODUCT_DEFAULTS.imageState) query.set(PARAM.imageState, filters.imageState)
	if (filters.overrideState !== ADMIN_PRODUCT_DEFAULTS.overrideState) query.set(PARAM.overrideState, filters.overrideState)
	if (filters.exclusionReason !== ADMIN_PRODUCT_DEFAULTS.exclusionReason) query.set(PARAM.exclusionReason, filters.exclusionReason)
	if (filters.page !== ADMIN_PRODUCT_DEFAULTS.page) query.set(PARAM.page, String(filters.page))

	return query.toString()
}

export function resolveAdminProductFilters(fromUrl: Partial<AdminProductFilters>): AdminProductFilters {
	return {
		search: fromUrl.search ?? ADMIN_PRODUCT_DEFAULTS.search,
		brand: fromUrl.brand ?? ADMIN_PRODUCT_DEFAULTS.brand,
		category: fromUrl.category ?? ADMIN_PRODUCT_DEFAULTS.category,
		imageState: fromUrl.imageState ?? ADMIN_PRODUCT_DEFAULTS.imageState,
		overrideState: fromUrl.overrideState ?? ADMIN_PRODUCT_DEFAULTS.overrideState,
		exclusionReason: fromUrl.exclusionReason ?? ADMIN_PRODUCT_DEFAULTS.exclusionReason,
		page: fromUrl.page ?? ADMIN_PRODUCT_DEFAULTS.page
	}
}

// --- localStorage fallback (page-size only) --------------------------

export const ADMIN_PREFERENCES_KEY = 'price-intelligence.admin.preferences.v1'

export type AdminPreferences = { pageSize: number }

const DEFAULT_PAGE_SIZE = 20
const MIN_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

function isValidPreferences(value: unknown): value is AdminPreferences {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.pageSize === 'number' &&
		Number.isInteger(candidate.pageSize) &&
		candidate.pageSize >= MIN_PAGE_SIZE &&
		candidate.pageSize <= MAX_PAGE_SIZE
	)
}

export function readAdminPreferences(): AdminPreferences {
	const fallback: AdminPreferences = { pageSize: DEFAULT_PAGE_SIZE }

	try {
		if (typeof localStorage === 'undefined') return fallback
		const raw = localStorage.getItem(ADMIN_PREFERENCES_KEY)
		if (!raw) return fallback
		const parsed = JSON.parse(raw)
		return isValidPreferences(parsed) ? parsed : fallback
	} catch {
		return fallback
	}
}

export function writeAdminPreferences(preferences: AdminPreferences): void {
	try {
		if (typeof localStorage === 'undefined') return
		localStorage.setItem(ADMIN_PREFERENCES_KEY, JSON.stringify(preferences))
	} catch {
		// Storage unavailable/full/blocked - a convenience only.
	}
}
