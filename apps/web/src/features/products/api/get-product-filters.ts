import { apiFetch } from '@/lib/api/client'

import type { ProductFilters } from '../types/product'

export function getProductFilters() {
	return apiFetch<ProductFilters>('/products/filters')
}
