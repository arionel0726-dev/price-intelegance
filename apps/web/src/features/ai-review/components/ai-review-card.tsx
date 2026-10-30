'use client'

import { Check, ExternalLink, X } from 'lucide-react'
import Image from 'next/image'

import { useProductDetails } from '@/features/products/queries/use-product-details'

import { useApproveAiReview, useRejectAiReview } from '../queries/use-ai-review-decision'
import type { AiReviewCandidate } from '../types/ai-review'

type AiReviewCardProps = {
	candidate: AiReviewCandidate
}

// Side-by-side Vizaje vs competitor comparison + the AI's own verdict, for
// one discovery_candidates row. Uses the M2.5 editorial tokens (text-
// primary/secondary/muted, bg-card/bg-surface, border-hairline, accent) -
// no new visual system introduced here.
export function AiReviewCard({ candidate }: AiReviewCardProps) {
	const { data: product } = useProductDetails(candidate.productId)
	const approve = useApproveAiReview()
	const reject = useRejectAiReview()

	const isPending = approve.isPending || reject.isPending
	const confidence = candidate.aiConfidence !== null ? Number(candidate.aiConfidence) : null
	const threshold = candidate.aiThresholdUsed !== null ? Number(candidate.aiThresholdUsed) : null

	return (
		<article className="rounded border border-hairline bg-card p-5">
			<div className="grid gap-5 sm:grid-cols-2">
				<ProductSide
					label="Vizaje-Nica"
					imageUrl={product?.product.imageUrl ?? null}
					brand={product?.product.brand ?? '—'}
					name={product?.product.name ?? '…'}
					variant={product?.product.volume ?? product?.product.color ?? null}
					price={product?.product.price ?? null}
					url={product?.product.url ?? null}
				/>

				<ProductSide
					label="Competitor"
					imageUrl={candidate.snapshotImageUrl}
					brand={null}
					name={candidate.snapshotTitle}
					variant={candidate.snapshotVariantLabel ?? candidate.snapshotVariantVolume}
					price={candidate.snapshotPrice}
					url={candidate.snapshotUrl}
				/>
			</div>

			<AiBlock candidate={candidate} confidence={confidence} threshold={threshold} />

			<div className="mt-4 flex items-center gap-3">
				<button
					type="button"
					disabled={isPending}
					onClick={() => approve.mutate(candidate.id)}
					className="inline-flex h-10 items-center gap-2 rounded border border-hairline bg-card px-4 text-sm font-medium text-text-primary transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Check className="size-4" aria-hidden="true" />
					Approve
				</button>

				<button
					type="button"
					disabled={isPending}
					onClick={() => reject.mutate(candidate.id)}
					className="inline-flex h-10 items-center gap-2 rounded border border-hairline bg-card px-4 text-sm font-medium text-text-secondary transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
				>
					<X className="size-4" aria-hidden="true" />
					Reject
				</button>

				<span className="text-xs text-text-muted">Rule score: {candidate.ruleScore}</span>
			</div>
		</article>
	)
}

function ProductSide({
	label,
	imageUrl,
	brand,
	name,
	variant,
	price,
	url
}: {
	label: string
	imageUrl: string | null
	brand: string | null
	name: string
	variant: string | null
	price: string | null
	url: string | null
}) {
	return (
		<div className="flex gap-4">
			<div className="relative size-20 shrink-0 overflow-hidden rounded bg-surface">
				{imageUrl ? (
					<Image src={imageUrl} alt={name} fill className="object-contain p-2" />
				) : (
					<div className="flex h-full items-center justify-center text-[10px] text-text-muted">No image</div>
				)}
			</div>

			<div className="min-w-0">
				<p className="text-xs font-medium uppercase tracking-[0.1em] text-text-muted">{label}</p>
				{brand && <p className="mt-1 text-xs font-medium uppercase tracking-[0.1em] text-text-secondary">{brand}</p>}
				<p className="mt-0.5 truncate text-sm font-medium text-text-primary">{name}</p>
				{variant && <p className="text-xs text-text-muted">{variant}</p>}
				{price && <p className="mt-1 text-sm font-medium tabular-nums text-text-primary">{Number(price).toLocaleString('ro-MD')} MDL</p>}
				{url && (
					<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						className="mt-1 inline-flex items-center gap-1 text-xs text-text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
					>
						Open link
						<ExternalLink className="size-3" aria-hidden="true" />
					</a>
				)}
			</div>
		</div>
	)
}

function AiBlock({
	candidate,
	confidence,
	threshold
}: {
	candidate: AiReviewCandidate
	confidence: number | null
	threshold: number | null
}) {
	const signals = candidate.ruleSignals as Record<string, unknown>

	return (
		<div className="mt-4 rounded border border-hairline bg-surface p-4">
			<div className="flex flex-wrap items-center gap-3">
				<VerdictBadge verdict={candidate.aiVerdict} />
				{confidence !== null && (
					<span className="text-xs text-text-secondary">
						Confidence <span className="font-medium tabular-nums text-text-primary">{confidence.toFixed(2)}</span>
						{threshold !== null && <span className="text-text-muted"> / threshold {threshold.toFixed(2)}</span>}
					</span>
				)}
			</div>

			{candidate.aiReason && <p className="mt-2 text-sm text-text-secondary">{candidate.aiReason}</p>}

			<p className="mt-2 text-xs text-text-muted">
				Signals: brandMatched={String(signals.brandMatched ?? '—')}, volumeConflict={String(signals.volumeConflict ?? '—')}, shadeConflict=
				{String(signals.shadeConflict ?? '—')}
			</p>
		</div>
	)
}

// Never color-only - every verdict pairs an icon AND a word, not just a
// background color.
function VerdictBadge({ verdict }: { verdict: 'approve' | 'reject' | null }) {
	if (verdict === null) {
		return <span className="rounded border border-hairline px-2 py-0.5 text-xs font-medium text-text-muted">Not yet evaluated</span>
	}

	if (verdict === 'approve') {
		return (
			<span className="inline-flex items-center gap-1 rounded border border-accent bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
				<Check className="size-3" aria-hidden="true" />
				AI: Approve
			</span>
		)
	}

	return (
		<span className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
			<X className="size-3" aria-hidden="true" />
			AI: Reject
		</span>
	)
}
