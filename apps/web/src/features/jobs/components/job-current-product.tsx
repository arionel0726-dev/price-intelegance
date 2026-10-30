import { ExternalLink } from 'lucide-react'
import Link from 'next/link'

import { useProductDetails } from '@/features/products/queries/use-product-details'

type JobCurrentProductProps = {
	productId: number
}

// Reuses the existing products API (same call AiReviewCard uses) rather
// than a bare numeric id - shows name/brand and links to the real
// /products/[id] detail route already built in Milestone 2.5.
export function JobCurrentProduct({ productId }: JobCurrentProductProps) {
	const { data, isLoading } = useProductDetails(productId)

	if (isLoading) {
		return <p className="text-sm text-text-muted">Loading current product…</p>
	}

	if (!data) {
		return <p className="text-sm text-text-muted">Product #{productId}</p>
	}

	const { product } = data

	return (
		<Link
			href={`/products/${productId}`}
			className="group inline-flex items-center gap-2 text-sm text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
		>
			<span className="font-medium uppercase tracking-[0.08em] text-text-muted">{product.brand}</span>
			<span className="truncate">{product.name}</span>
			<ExternalLink className="size-3.5 shrink-0 text-text-muted group-hover:text-accent" aria-hidden="true" />
		</Link>
	)
}
