import { apiFetch } from '@/lib/api/client'

import type { CatalogSource } from '../lib/catalog-url-state'
import type { ProductsPage } from '../types/product'

export type GetProductsParams = {
	page?: number
	limit?: number
	search?: string
	brand?: string
	category?: string
	// Catalog Ingestion v1 (OVICO) - omitted entirely when 'vizaje' (the
	// default), matching every other filter's "unset means default" shape.
	source?: CatalogSource
}

export function getProducts(params: GetProductsParams) {
	return apiFetch<ProductsPage>('/products', {
		params: {
			page: params.page,
			limit: params.limit,
			search: params.search || undefined,
			brand: params.brand && params.brand !== 'all' ? params.brand : undefined,
			category:
				params.category && params.category !== 'all' ? params.category : undefined,
			source: params.source && params.source !== 'vizaje' ? params.source : undefined
		}
	})
}
