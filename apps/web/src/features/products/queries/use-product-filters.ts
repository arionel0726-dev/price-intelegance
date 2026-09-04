import { useQuery } from '@tanstack/react-query'

import { getProductFilters } from '../api/get-product-filters'

export function useProductFilters() {
	return useQuery({
		queryKey: ['product-filters'],
		queryFn: getProductFilters,
		// Brand/category lists change rarely (only after a Vizaje/competitor
		// sync) - no need to refetch on every catalog visit.
		staleTime: 5 * 60 * 1000
	})
}
