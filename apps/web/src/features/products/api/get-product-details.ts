import { apiFetch } from '@/lib/api/client'

import type { ProductDetailsResponse } from '../types/product-details'

export function getProductDetails(id: number) {
	return apiFetch<ProductDetailsResponse>(`/products/${id}`)
}
