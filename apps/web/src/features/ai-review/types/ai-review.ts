export type AiReviewSignals = {
	brand?: string
	productType?: string
	volume?: string
	shade?: string
	concentration?: string
	variant?: string
}

// Mirrors the discovery_candidates row shape the API returns verbatim
// (apps/api/src/ai/ai-review.service.ts) - numeric columns come back as
// strings (drizzle-orm/postgres-js convention, same as ProductFamily.price
// elsewhere in this app), timestamps as ISO strings.
export type AiReviewCandidate = {
	id: number
	productId: number
	competitorId: number
	competitorProductVariantId: number
	jobRunId: number | null

	snapshotTitle: string
	snapshotVariantLabel: string | null
	snapshotVariantVolume: string | null
	snapshotPrice: string | null
	snapshotUrl: string
	snapshotImageUrl: string | null

	ruleScore: number
	ruleDecision: string
	ruleSignals: Record<string, unknown>

	aiVerdict: 'approve' | 'reject' | null
	aiConfidence: string | null
	aiReason: string | null
	aiThresholdUsed: string | null
	aiModel: string | null

	reviewStatus: 'not_required' | 'pending' | 'approved' | 'rejected'
	reviewedAt: string | null
	reviewedBy: string | null
	reviewNote: string | null

	outcome: string | null
	resolvedAt: string | null
	createdAt: string
}

export type AiReviewListPage = {
	items: AiReviewCandidate[]
	page: number
	limit: number
	total: number
}
