import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
	addOvicoBrandSource,
	getOvicoBrandSources,
	patchOvicoBrandSource,
	removeOvicoBrandSource,
	syncOvicoBrandSource
} from '../api/admin-api'
import type { OvicoBrandSource, OvicoBrandSourceStatus } from '../types/admin'

export const ovicoSourcesQueryKey = ['admin', 'ovico-sources']

export function useOvicoBrandSources() {
	return useQuery({ queryKey: ovicoSourcesQueryKey, queryFn: getOvicoBrandSources })
}

// Add/edit/disable/remove are all confirmed-response-only (no optimistic
// update) - same bulk/high-impact treatment as useBulkPatchBrands, since a
// wrong optimistic state here (e.g. showing a source as added before the
// server confirms it) would be more confusing than a brief wait.
export function useAddOvicoBrandSource() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			brandId,
			sourceUrl,
			status
		}: {
			brandId: string
			sourceUrl: string
			status?: OvicoBrandSourceStatus
		}) => addOvicoBrandSource(brandId, sourceUrl, status),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ovicoSourcesQueryKey })
		}
	})
}

export function usePatchOvicoBrandSource() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({
			id,
			patch
		}: {
			id: number
			patch: Partial<Pick<OvicoBrandSource, 'sourceUrl' | 'status' | 'enabled'>>
		}) => patchOvicoBrandSource(id, patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ovicoSourcesQueryKey })
		}
	})
}

export function useRemoveOvicoBrandSource() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: number) => removeOvicoBrandSource(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ovicoSourcesQueryKey })
		}
	})
}

// A sync run can legitimately take a while (OVICO's robots.txt Crawl-delay
// is enforced per request, and a brand page is one request) - confirmed-
// response-only, same as the mutations above.
export function useSyncOvicoBrandSource() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (id: number) => syncOvicoBrandSource(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ovicoSourcesQueryKey })
		}
	})
}
