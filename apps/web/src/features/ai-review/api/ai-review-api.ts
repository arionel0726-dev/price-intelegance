import { apiFetch } from '@/lib/api/client'

import type { AiReviewCandidate, AiReviewListPage } from '../types/ai-review'

export type GetAiReviewListParams = {
	page?: number
	limit?: number
	competitor?: string
	reviewStatus?: string
}

export function getAiReviewList(params: GetAiReviewListParams) {
	return apiFetch<AiReviewListPage>('/ai-review', {
		params: {
			page: params.page,
			limit: params.limit,
			competitor: params.competitor,
			reviewStatus: params.reviewStatus
		}
	})
}

export function approveAiReviewCandidate(id: number) {
	return apiFetch<AiReviewCandidate>(`/ai-review/${id}/approve`, { method: 'POST' })
}

export function rejectAiReviewCandidate(id: number, note?: string) {
	return apiFetch<AiReviewCandidate>(`/ai-review/${id}/reject`, {
		method: 'POST',
		body: JSON.stringify({ note })
	})
}
