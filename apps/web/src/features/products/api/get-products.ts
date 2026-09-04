import { apiFetch } from '@/lib/api/client'

import type { ProductsPage } from '../types/product'

export type GetProductsParams = {
	page?: number
	limit?: number
	search?: string
	brand?: string
	category?: string
}

export function getProducts(params: GetProductsParams) {
	return apiFetch<ProductsPage>('/products', {
		params: {
			page: params.page,
			limit: params.limit,
			search: params.search || undefined,
			brand: params.brand && params.brand !== 'all' ? params.brand : undefined,
			category:
				params.category && params.category !== 'all' ? params.category : undefined
		}
	})
}
