import Image from 'next/image'
import Link from 'next/link'

import { comparePrices } from '../lib/price-comparison'
import type { ProductFamily } from '../types/product'
import { PriceText } from './price-text'

type ProductListRowProps = {
	product: ProductFamily
	onNavigateAway?: () => void
}

// Horizontal row representation of a catalog family card - same data as
// ProductCard, laid out for scanning many rows at once. The whole row is
// the click/keyboard target (a real <Link>).
export function ProductListRow({ product, onNavigateAway }: ProductListRowProps) {
	const variantLabel = product.variantLabel ?? product.volume
	const matchState = comparePrices(product.price, product.competitorPrice)
	const coverageLabel =
		product.competitorPrice === null
			? 'No competitor match yet'
			: matchState === 'favorable'
				? 'Cheaper here'
				: matchState === 'unfavorable'
					? 'Pricier here'
					: 'Same price'

	return (
		<Link
			href={`/products/${product.id}`}
			onNavigate={onNavigateAway}
			className="group grid grid-cols-[56px_1fr] items-center gap-4 rounded border border-hairline bg-card px-4 py-3 transition-colors hover:border-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:grid-cols-[64px_1fr_160px]"
		>
			<div className="relative aspect-square size-14 shrink-0 overflow-hidden rounded bg-surface">
				{product.imageUrl ? (
					<Image
						src={product.imageUrl}
						alt={product.name}
						fill
						className="object-contain p-2"
					/>
				) : (
					<div className="flex h-full items-center justify-center text-[10px] text-text-muted">
						No image
					</div>
				)}
			</div>

			<div className="min-w-0">
				<p className="text-xs font-medium uppercase tracking-[0.1em] text-text-secondary">
					{product.brand}
				</p>

				<h2 className="mt-0.5 truncate text-sm font-normal leading-snug text-text-primary sm:text-base">
					{product.name}
				</h2>

				{variantLabel && <p className="mt-0.5 text-xs text-text-muted sm:text-sm">{variantLabel}</p>}

				<p className="mt-0.5 text-xs text-text-muted">{coverageLabel}</p>

				{/* Price lives here on mobile (no third grid column yet) and moves
					into its own aligned column at sm+ via the sibling below. */}
				<p className="mt-1.5 text-base font-medium tabular-nums sm:hidden">
					<PriceText
						price={product.price}
						prefix={product.priceVaries ? 'from ' : undefined}
						state={matchState}
					/>
				</p>
			</div>

			<div className="hidden text-right text-base font-medium tabular-nums sm:block">
				<PriceText
					price={product.price}
					prefix={product.priceVaries ? 'from ' : undefined}
					state={matchState}
				/>
			</div>
		</Link>
	)
}
