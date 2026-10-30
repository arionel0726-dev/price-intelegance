import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api/client'

import { approveAiReviewCandidate, rejectAiReviewCandidate, type GetAiReviewListParams } from '../api/ai-review-api'
import type { AiReviewListPage } from '../types/ai-review'

// Shared by useApproveAiReview/useRejectAiReview - optimistically removes
// the decided candidate from every currently-cached ai-review list page
// (so the list updates instantly without a full refetch/reload, keeping
// whatever filters/page the user had), rolls that back on failure, and
// always refetches afterward to reconcile with the server - including the
// one case that must NOT be treated as a hard failure: a 409 means
// someone else (or a prior click) already resolved this candidate, so the
// right response is "remove it from the list and say so", not an error
// toast that implies nothing happened.
function useAiReviewDecisionMutation(
	action: (id: number) => Promise<unknown>,
	successMessage: string
) {
	const queryClient = useQueryClient()

	return useMutation({
		mutationFn: action,
		onMutate: async (id: number) => {
			await queryClient.cancelQueries({ queryKey: ['ai-review'] });

			const previous = queryClient.getQueriesData<AiReviewListPage>({ queryKey: ['ai-review'] })

			queryClient.setQueriesData<AiReviewListPage>({ queryKey: ['ai-review'] }, data => {
				if (!data) return data
				return { ...data, items: data.items.filter(item => item.id !== id), total: Math.max(0, data.total - 1) }
			})

			return { previous }
		},
		onError: (error, _id, context) => {
			// A 409 (already resolved by a prior click or another reviewer)
			// is NOT rolled back - the optimistic removal was actually
			// correct (the row is gone from this queue either way); it's
			// just surfaced as information, not a failure.
			if (error instanceof ApiError && error.status === 409) {
				toast.info('Already resolved - removed from the queue.')
				return
			}

			context?.previous.forEach(([queryKey, data]) => {
				queryClient.setQueryData(queryKey, data)
			})
			toast.error(error instanceof Error ? error.message : 'Something went wrong')
		},
		onSuccess: () => {
			toast.success(successMessage)
		},
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ['ai-review'] })
		}
	})
}

export function useApproveAiReview() {
	return useAiReviewDecisionMutation(approveAiReviewCandidate, 'Match approved')
}

export function useRejectAiReview() {
	return useAiReviewDecisionMutation((id: number) => rejectAiReviewCandidate(id), 'Candidate rejected')
}

export type { GetAiReviewListParams }
