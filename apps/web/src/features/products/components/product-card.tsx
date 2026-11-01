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

	// Catalog Ingestion v1 (OVICO) - `product.id` for an OVICO card is a
	// competitor_products row id, a completely different id space from
	// Vizaje's own `products.id`. Linking it to /products/:id (the Vizaje
	// detail page) would load the wrong product or 404. No internal OVICO
	// product detail page exists yet (out of scope - "minimal" per spec),
	// so an OVICO card links straight to the real ovico.md product page
	// instead, in a new tab - same spirit as the existing external "Open
	// site" link on the Vizaje detail page's competitor rows.
	if (product.source === 'ovico') {
		return (
			<a
				href={product.url ?? undefined}
				target="_blank"
				rel="noopener noreferrer"
				className="group block rounded outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
			>
				<OvicoCardBody product={product} />
			</a>
		)
	}

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

// Catalog Ingestion v1 (OVICO) - a competitor catalog card: no price-match
// coverage (that's matching, explicitly out of scope this milestone), no
// variant-family grouping (v1 is one variant per product). Shows the OVICO
// external code and availability per the spec's card-field list instead.
function OvicoCardBody({ product }: { product: ProductFamily }) {
	return (
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
				<div className="flex items-center justify-between gap-2">
					<p className="text-xs font-medium uppercase tracking-[0.12em] text-text-secondary">
						{product.brand}
					</p>

					<span className="rounded border border-hairline px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">
						OVICO
					</span>
				</div>

				<h2 className="mt-1.5 line-clamp-2 text-base font-normal leading-snug text-text-primary">
					{product.name}
				</h2>

				{product.volume && <p className="mt-1 text-sm text-text-muted">{product.volume}</p>}

				<div className="mt-3 flex items-baseline justify-between gap-3">
					<p className="text-lg font-medium tabular-nums">
						<PriceText price={product.price} state="neutral" />
					</p>

					{product.availability === false && (
						<span className="text-xs text-text-muted">Unavailable</span>
					)}
				</div>

				{product.externalCode && (
					<p className="mt-1 text-xs text-text-muted">Code: {product.externalCode}</p>
				)}
			</div>
		</article>
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
