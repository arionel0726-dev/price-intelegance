// URL<->state contract for /dashboard (Milestone 6), same convention as
// M2.5/M4/M5: the URL is the primary store (shareable, Back/Forward-safe,
// survives refresh); localStorage is a fallback ONLY for page-size, and
// only applies where the URL itself says nothing - the URL always wins.
import type { CompetitorFilter, PricePosition } from '../types/dashboard'

export type DashboardFilters = {
	competitor: CompetitorFilter
	brand: string
	position: PricePosition | 'all'
	sort: 'gapPercent' | 'gapAmount' | 'name'
	direction: 'asc' | 'desc'
	page: number
}

export const DASHBOARD_DEFAULTS: DashboardFilters = {
	competitor: 'all',
	brand: 'all',
	position: 'all',
	sort: 'gapPercent',
	direction: 'desc',
	page: 1
}

const PARAM = {
	competitor: 'competitor',
	brand: 'brand',
	position: 'position',
	sort: 'sort',
	direction: 'direction',
	page: 'page'
} as const

function isCompetitor(value: string | null): value is CompetitorFilter {
	return value === 'all' || value === 'makeup' || value === 'ovico'
}

function isPosition(value: string | null): value is PricePosition | 'all' {
	return value === 'all' || value === 'more_expensive' || value === 'cheaper' || value === 'approximately_equal'
}

function isSort(value: string | null): value is DashboardFilters['sort'] {
	return value === 'gapPercent' || value === 'gapAmount' || value === 'name'
}

function parsePage(value: string | null): number | null {
	if (value === null) return null
	const parsed = Number(value)
	return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

export function parseDashboardSearchParams(searchParams: URLSearchParams): Partial<DashboardFilters> {
	const result: Partial<DashboardFilters> = {}

	const competitor = searchParams.get(PARAM.competitor)
	if (isCompetitor(competitor)) result.competitor = competitor

	const brand = searchParams.get(PARAM.brand)
	if (brand !== null && brand.length > 0) result.brand = brand

	const position = searchParams.get(PARAM.position)
	if (isPosition(position)) result.position = position

	const sort = searchParams.get(PARAM.sort)
	if (isSort(sort)) result.sort = sort

	const direction = searchParams.get(PARAM.direction)
	if (direction === 'asc' || direction === 'desc') result.direction = direction

	const page = parsePage(searchParams.get(PARAM.page))
	if (page !== null) result.page = page

	return result
}

export function serializeDashboardFilters(filters: DashboardFilters): string {
	const query = new URLSearchParams()

	if (filters.competitor !== DASHBOARD_DEFAULTS.competitor) query.set(PARAM.competitor, filters.competitor)
	if (filters.brand !== DASHBOARD_DEFAULTS.brand) query.set(PARAM.brand, filters.brand)
	if (filters.position !== DASHBOARD_DEFAULTS.position) query.set(PARAM.position, filters.position)
	if (filters.sort !== DASHBOARD_DEFAULTS.sort) query.set(PARAM.sort, filters.sort)
	if (filters.direction !== DASHBOARD_DEFAULTS.direction) query.set(PARAM.direction, filters.direction)
	if (filters.page !== DASHBOARD_DEFAULTS.page) query.set(PARAM.page, String(filters.page))

	return query.toString()
}

export function resolveDashboardFilters(fromUrl: Partial<DashboardFilters>): DashboardFilters {
	return {
		competitor: fromUrl.competitor ?? DASHBOARD_DEFAULTS.competitor,
		brand: fromUrl.brand ?? DASHBOARD_DEFAULTS.brand,
		position: fromUrl.position ?? DASHBOARD_DEFAULTS.position,
		sort: fromUrl.sort ?? DASHBOARD_DEFAULTS.sort,
		direction: fromUrl.direction ?? DASHBOARD_DEFAULTS.direction,
		page: fromUrl.page ?? DASHBOARD_DEFAULTS.page
	}
}

// --- localStorage fallback (page-size only) --------------------------

export const DASHBOARD_PREFERENCES_KEY = 'price-intelligence.dashboard.preferences.v1'

export type DashboardPreferences = { pageSize: number }

const DEFAULT_PAGE_SIZE = 20
const MIN_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

function isValidPreferences(value: unknown): value is DashboardPreferences {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.pageSize === 'number' &&
		Number.isInteger(candidate.pageSize) &&
		candidate.pageSize >= MIN_PAGE_SIZE &&
		candidate.pageSize <= MAX_PAGE_SIZE
	)
}

export function readDashboardPreferences(): DashboardPreferences {
	const fallback: DashboardPreferences = { pageSize: DEFAULT_PAGE_SIZE }
	try {
		if (typeof localStorage === 'undefined') return fallback
		const raw = localStorage.getItem(DASHBOARD_PREFERENCES_KEY)
		if (!raw) return fallback
		const parsed = JSON.parse(raw)
		return isValidPreferences(parsed) ? parsed : fallback
	} catch {
		return fallback
	}
}

export function writeDashboardPreferences(preferences: DashboardPreferences): void {
	try {
		if (typeof localStorage === 'undefined') return
		localStorage.setItem(DASHBOARD_PREFERENCES_KEY, JSON.stringify(preferences))
	} catch {
		// Storage unavailable/full/blocked - a convenience only.
	}
}
