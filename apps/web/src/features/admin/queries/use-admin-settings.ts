import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getAdminSettings, patchAiSettings } from '../api/admin-api'
import type { AiSettingsPatch } from '../types/admin'

export const adminSettingsQueryKey = ['admin', 'settings']

export function useAdminSettings() {
	return useQuery({ queryKey: adminSettingsQueryKey, queryFn: getAdminSettings })
}

// A business setting (AI enabled / auto-confirm threshold), not a
// low-risk per-row toggle - waits for the confirmed server response
// (which also re-validates range) rather than optimistically assuming
// success.
export function usePatchAiSettings() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (patch: AiSettingsPatch) => patchAiSettings(patch),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: adminSettingsQueryKey })
		}
	})
}
