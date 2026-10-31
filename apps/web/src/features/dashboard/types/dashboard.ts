// Milestone 6 - types mirroring apps/api/src/dashboard/*.controller.ts's
// exact response shapes (read directly, not guessed).

export type CompetitorFilter = 'all' | 'makeup' | 'ovico'
export type PricePosition = 'more_expensive' | 'cheaper' | 'approximately_equal'

export type DashboardSummary = {
	competitor: CompetitorFilter
	universe: { eligibleMonitoredProducts: number; comparableProducts: number }
	coverage: {
		productCoverage: number
		offerCoverage: number
		makeupCoverage: number
		ovicoCoverage: number
		bothCoverage: number
		coveragePercent: number
	}
	pricePosition: {
		moreExpensive: number
		cheaper: number
		approximatelyEqual: number
		moreExpensivePercent: number
		cheaperPercent: number
		approximatelyEqualPercent: number
	}
	gapDistribution: Array<{ key: string; label: string; count: number }>
	avgGapPercent: number | null
	medianGapPercent: number | null
}

export type DashboardBrandRow = {
	brand: string
	eligible: number
	covered: number
	coveragePercent: number
	comparable: number
	avgGapPercent: number | null
	medianGapPercent: number | null
	unresolved: number
}

export type DashboardBrandsResponse = { items: DashboardBrandRow[] }

export type DashboardOpportunity = {
	productId: number
	brand: string
	name: string
	category: string | null
	vizajePrice: number | null
	competitorPrice: number | null
	competitorSource: 'makeup' | 'ovico' | null
	gapAmount: number
	gapPercent: number
	position: PricePosition
}

export type DashboardOpportunitiesResponse = {
	items: DashboardOpportunity[]
	pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export type DiscoveryHealth = {
	websiteConfirmedProducts: number
	unmatched: number
	pendingAiReview: number
	retryEligible: number
	recentErrors: number
	neverCheckedEstimate: number
}
