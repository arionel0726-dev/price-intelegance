import { useQuery } from '@tanstack/react-query'

import { getProductDetails } from '../api/get-product-details'

export function useProductDetails(id: number) {
	return useQuery({
		queryKey: ['product', id],
		queryFn: () => getProductDetails(id),
		enabled: Number.isFinite(id)
	})
}
