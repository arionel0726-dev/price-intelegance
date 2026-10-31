import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { bulkPatchBrands, getBrands, patchBrand } from '../api/admin-api'
import type { Brand, BrandPolicyPatch } from '../types/admin'

export const brandsQueryKey = ['admin', 'brands']

export function useBrands() {
	return useQuery({ queryKey: brandsQueryKey, queryFn: getBrands })
}

// Low-risk single-flag toggle - optimistic update with rollback on error,
// same pattern as M4's job-stop mutation / M3's approve/reject.
export function usePatchBrand() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ canonicalKey, patch }: { canonicalKey: string; patch: BrandPolicyPatch }) => patchBrand(canonicalKey, patch),
		onMutate: async ({ canonicalKey, patch }) => {
			await queryClient.cancelQueries({ queryKey: brandsQueryKey })

			const previous = queryClient.getQueryData<Brand[]>(brandsQueryKey)

			queryClient.setQueryData<Brand[]>(brandsQueryKey, data =>
				data?.map(brand => (brand.canonicalKey === canonicalKey ? { ...brand, ...patch } : brand))
			)

			return { previous }
		},
		onError: (_error, _vars, context) => {
			if (context?.previous) queryClient.setQueryData(brandsQueryKey, context.previous)
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: brandsQueryKey })
		}
	})
}

// Bulk/high-impact action (affects N brands at once) - waits for the
// confirmed server response before showing success, no optimistic update.
export function useBulkPatchBrands() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ canonicalKeys, patch }: { canonicalKeys: string[]; patch: BrandPolicyPatch }) => bulkPatchBrands(canonicalKeys, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: brandsQueryKey })
		}
	})
}
