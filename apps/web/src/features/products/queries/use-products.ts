import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getProducts, type GetProductsParams } from '../api/get-products'

export function useProducts(params: GetProductsParams) {
	return useQuery({
		queryKey: [
			'products',
			params.page,
			params.limit,
			params.search,
			params.brand,
			params.category
		],
		queryFn: () => getProducts(params),
		// Keeps the previous page's data on screen while the next page/filter
		// loads, instead of clearing the grid - see Catalog's isPlaceholderData.
		placeholderData: keepPreviousData
	})
}
