import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
	getDashboardBrands,
	getDashboardOpportunities,
	getDashboardSummary,
	getDiscoveryHealth,
	type GetOpportunitiesParams
} from '../api/dashboard-api'
import type { CompetitorFilter } from '../types/dashboard'

// No 2-3s polling here (per the brief - this is a management view, not a
// live job monitor) - mount/focus refetch (React Query's defaults) plus
// a slow 60s background refresh so a dashboard left open all day doesn't
// go stale, and keepPreviousData across every filter change so switching
// competitor/brand/page never flashes to an empty state.
const BACKGROUND_REFRESH_MS = 60_000

export function useDashboardSummary(competitor: CompetitorFilter) {
	return useQuery({
		queryKey: ['dashboard', 'summary', competitor],
		queryFn: () => getDashboardSummary(competitor),
		placeholderData: keepPreviousData,
		refetchInterval: BACKGROUND_REFRESH_MS
	})
}

export function useDashboardBrands(competitor: CompetitorFilter, sort?: string) {
	return useQuery({
		queryKey: ['dashboard', 'brands', competitor, sort],
		queryFn: () => getDashboardBrands(competitor, sort),
		placeholderData: keepPreviousData,
		refetchInterval: BACKGROUND_REFRESH_MS
	})
}

export function useDashboardOpportunities(params: GetOpportunitiesParams) {
	return useQuery({
		queryKey: ['dashboard', 'opportunities', params.competitor, params.brand, params.position, params.sort, params.direction, params.page, params.pageSize],
		queryFn: () => getDashboardOpportunities(params),
		placeholderData: keepPreviousData
	})
}

export function useDiscoveryHealth() {
	return useQuery({
		queryKey: ['dashboard', 'discovery-health'],
		queryFn: getDiscoveryHealth,
		refetchInterval: BACKGROUND_REFRESH_MS
	})
}
