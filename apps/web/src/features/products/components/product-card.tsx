import Image from 'next/image'
import Link from 'next/link'

import { comparePrices } from '../lib/price-comparison'
import type { ProductFamily } from '../types/product'
import { PriceText } from './price-text'

type ProductCardProps = {
	product: ProductFamily
	// Fired via Link's onNavigate right before a client-side transition to
	// the product page starts - lets the catalog save its scroll position
	// keyed to its own URL, restored on Back. See
	// use-catalog-scroll-restoration.ts.
	onNavigateAway?: () => void
}

// The whole card is the single click/keyboard target (a real <Link>, not a
// div with onClick) - there is no separate "Compare" control duplicating
// the same navigation.
export function ProductCard({ product, onNavigateAway }: ProductCardProps) {
	const matchState = comparePrices(product.price, product.competitorPrice)

	return (
		<Link
			href={`/products/${product.id}`}
			onNavigate={onNavigateAway}
			className="group block rounded outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
		>
			<article>
				<div className="relative aspect-[1/1.12] overflow-hidden rounded bg-surface">
					{product.imageUrl ? (
						<Image
							src={product.imageUrl}
							alt={product.name}
							fill
							className="object-contain p-8 transition-transform duration-200 group-hover:scale-[1.03]"
						/>
					) : (
						<div className="flex h-full items-center justify-center text-sm text-text-muted">
							No image
						</div>
					)}
				</div>

				<div className="pt-4">
					<p className="text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
						{product.brand}
					</p>

					<h2 className="mt-1.5 line-clamp-2 text-base font-normal leading-snug text-text-primary">
						{product.name}
					</h2>

					{product.variantLabel ? (
						<p className="mt-1 text-sm text-text-muted">{product.variantLabel}</p>
					) : (
						product.volume && <p className="mt-1 text-sm text-text-muted">{product.volume}</p>
					)}

					<div className="mt-3 flex items-baseline justify-between gap-3">
						<p className="text-lg font-medium tabular-nums">
							<PriceText
								price={product.price}
								prefix={product.priceVaries ? 'from ' : undefined}
								state={matchState}
							/>
						</p>
					</div>

					<CompetitorCoverage
						competitorPrice={product.competitorPrice}
						state={matchState}
					/>
				</div>
			</article>
		</Link>
	)
}

// Small coverage/match cue beneath the price - never color-only: the state
// always carries a word ("cheaper"/"pricier"/"no match yet") alongside
// whatever color it renders in. Derived from the EXISTING competitorPrice
// field (no new backend data) - there is no explicit match-status field on
// ProductFamily today, so "has a competitorPrice" stands in for "has a
// confirmed match" here.
function CompetitorCoverage({
	competitorPrice,
	state
}: {
	competitorPrice: string | null
	state: 'neutral' | 'favorable' | 'unfavorable'
}) {
	if (competitorPrice === null) {
		return <p className="mt-1 text-xs text-text-muted">No competitor match yet</p>
	}

	const label = state === 'favorable' ? 'Cheaper here' : state === 'unfavorable' ? 'Pricier here' : 'Same price'

	return (
		<p className="mt-1 text-xs text-text-muted">
			{label} ·{' '}
			<PriceText
				price={competitorPrice}
				className="text-text-muted"
			/>{' '}
			elsewhere
		</p>
	)
}
