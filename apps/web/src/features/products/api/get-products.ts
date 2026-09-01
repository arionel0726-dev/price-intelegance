import { apiFetch } from '@/lib/api/client'

import type { Product } from '../types/product'

export function getProducts() {
	return apiFetch<Product[]>('/products')
}
