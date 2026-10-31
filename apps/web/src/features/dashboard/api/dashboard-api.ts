import { apiFetch } from '@/lib/api/client'

import type {
	CompetitorFilter,
	DashboardBrandsResponse,
	DashboardOpportunitiesResponse,
	DashboardSummary,
	DiscoveryHealth,
	PricePosition
} from '../types/dashboard'

export function getDashboardSummary(competitor: CompetitorFilter) {
	return apiFetch<DashboardSummary>('/dashboard/summary', { params: { competitor } })
}

export function getDashboardBrands(competitor: CompetitorFilter, sort?: string) {
	return apiFetch<DashboardBrandsResponse>('/dashboard/brands', { params: { competitor, sort } })
}

export type GetOpportunitiesParams = {
	competitor: CompetitorFilter
	brand?: string
	position?: PricePosition
	sort?: 'gapPercent' | 'gapAmount' | 'name'
	direction?: 'asc' | 'desc'
	page?: number
	pageSize?: number
}

export function getDashboardOpportunities(params: GetOpportunitiesParams) {
	return apiFetch<DashboardOpportunitiesResponse>('/dashboard/opportunities', { params })
}

export function getDiscoveryHealth() {
	return apiFetch<DiscoveryHealth>('/dashboard/discovery-health')
}
