import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getAdminProductDetail, getAdminProducts, patchProductPolicy, type GetAdminProductsParams } from '../api/admin-api'
import type { ProductPolicyPatch } from '../types/admin'

export const adminProductsQueryKey = (params: GetAdminProductsParams) => [
	'admin',
	'products',
	params.page,
	params.limit,
	params.search,
	params.brand,
	params.category,
	params.imageState,
	params.overrideState,
	params.exclusionReason
]

export function useAdminProducts(params: GetAdminProductsParams) {
	return useQuery({
		queryKey: adminProductsQueryKey(params),
		queryFn: () => getAdminProducts(params),
		placeholderData: keepPreviousData
	})
}

export const adminProductDetailQueryKey = (id: number) => ['admin', 'products', 'detail', id]

export function useAdminProductDetail(id: number) {
	return useQuery({
		queryKey: adminProductDetailQueryKey(id),
		queryFn: () => getAdminProductDetail(id),
		enabled: Number.isFinite(id)
	})
}

// A tri-state override on one dimension is a low-risk, single-field
// toggle - optimistic update on the detail cache with rollback on error,
// matching M3/M4's convention. The admin products LIST is invalidated
// (not optimistically patched) since its `effective`/`hasOverride` fields
// depend on brand policy too and are cheaper to just refetch.
export function usePatchProductPolicy(id: number) {
	const queryClient = useQueryClient()
	const detailKey = adminProductDetailQueryKey(id)

	return useMutation({
		mutationFn: (patch: ProductPolicyPatch) => patchProductPolicy(id, patch),
		onMutate: async (patch: ProductPolicyPatch) => {
			await queryClient.cancelQueries({ queryKey: detailKey })

			const previous = queryClient.getQueryData(detailKey)

			queryClient.setQueryData(detailKey, (data: Awaited<ReturnType<typeof getAdminProductDetail>> | undefined) => {
				if (!data) return data
				return {
					...data,
					override: data.override
						? { ...data.override, ...patch }
						: { productId: id, catalogEnabledOverride: null, discoveryEnabledOverride: null, priceMonitoringEnabledOverride: null, exclusionReason: null, reasonNote: null, createdAt: '', updatedAt: '', updatedBy: null, ...patch }
				}
			})

			return { previous }
		},
		onError: (_error, _vars, context) => {
			if (context?.previous) queryClient.setQueryData(detailKey, context.previous)
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: detailKey })
			queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
		}
	})
}
