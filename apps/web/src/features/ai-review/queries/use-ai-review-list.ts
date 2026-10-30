import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getAiReviewList, type GetAiReviewListParams } from '../api/ai-review-api'

export const aiReviewListQueryKey = (params: GetAiReviewListParams) => [
	'ai-review',
	params.page,
	params.limit,
	params.competitor,
	params.reviewStatus
]

export function useAiReviewList(params: GetAiReviewListParams) {
	return useQuery({
		queryKey: aiReviewListQueryKey(params),
		queryFn: () => getAiReviewList(params),
		placeholderData: keepPreviousData
	})
}
