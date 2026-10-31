import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api/client'

import { addPlaceholder, getPlaceholderCandidates, getPlaceholders, removePlaceholder, updatePlaceholderNote } from '../api/admin-api'

const placeholdersQueryKey = ['admin', 'placeholders']

export function usePlaceholders() {
	return useQuery({ queryKey: placeholdersQueryKey, queryFn: getPlaceholders })
}

export function usePlaceholderCandidates(threshold: number) {
	return useQuery({
		queryKey: ['admin', 'placeholders', 'candidates', threshold],
		queryFn: () => getPlaceholderCandidates(threshold),
		enabled: Number.isInteger(threshold) && threshold >= 2
	})
}

// Confirming a candidate is a real write (it changes live catalog
// classification for every affected product) - waits for the confirmed
// server response rather than an optimistic add. A 409 (already
// confirmed by someone else, or a duplicate click) is shown as
// information, not an error, matching M3's approve/reject 409 handling.
export function useAddPlaceholder() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ imageUrl, note }: { imageUrl: string; note?: string | null }) => addPlaceholder(imageUrl, note),
		onSuccess: () => {
			toast.success('Confirmed as placeholder')
			queryClient.invalidateQueries({ queryKey: placeholdersQueryKey })
			queryClient.invalidateQueries({ queryKey: ['admin', 'data-quality'] })
			queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
		},
		onError: error => {
			if (error instanceof ApiError && error.status === 409) {
				toast.info(error.message)
				queryClient.invalidateQueries({ queryKey: placeholdersQueryKey })
				return
			}
			toast.error(error instanceof Error ? error.message : 'Failed to confirm placeholder')
		}
	})
}

export function useUpdatePlaceholderNote() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: ({ imageUrl, note }: { imageUrl: string; note: string | null }) => updatePlaceholderNote(imageUrl, note),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: placeholdersQueryKey })
		}
	})
}

export function useRemovePlaceholder() {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: (imageUrl: string) => removePlaceholder(imageUrl),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: placeholdersQueryKey })
			queryClient.invalidateQueries({ queryKey: ['admin', 'data-quality'] })
			queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
		},
		onError: error => {
			toast.error(error instanceof Error ? error.message : 'Failed to remove placeholder')
		}
	})
}
