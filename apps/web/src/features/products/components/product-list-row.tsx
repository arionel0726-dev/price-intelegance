import Image from 'next/image'
import Link from 'next/link'

import { comparePrices } from '../lib/price-comparison'
import type { ProductFamily } from '../types/product'
import { PriceText } from './price-text'

type ProductListRowProps = {
	product: ProductFamily
}

// Horizontal dashboard-row representation of a catalog family card - same
// data as ProductCard, laid out for scanning many rows at once. Grid-based
// so the image/details/price columns stay aligned across rows on desktop,
// collapsing to a compact stacked layout on narrow viewports instead of
// forcing horizontal scroll.
export function ProductListRow({ product }: ProductListRowProps) {
	const variantLabel = product.variantLabel ?? product.volume

	return (
		<Link
			href={`/products/${product.id}`}
			className="group grid grid-cols-[56px_1fr] items-center gap-4 rounded-2xl border px-4 py-3 transition-colors hover:bg-muted/50 sm:grid-cols-[64px_1fr_140px]"
		>
			<div className="relative aspect-square size-14 shrink-0 overflow-hidden rounded-xl bg-[#f6f6f6]">
				{product.imageUrl ? (
					<Image
						src={product.imageUrl}
						alt={product.name}
						fill
						className="object-contain p-2"
					/>
				) : (
					<div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
						No image
					</div>
				)}
			</div>

			<div className="min-w-0">
				<p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
					{product.brand}
				</p>

				<h2 className="mt-0.5 truncate text-sm font-medium leading-snug sm:text-base">
					{product.name}
				</h2>

				{variantLabel && (
					<p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
						{variantLabel}
					</p>
				)}

				{/* Price lives here on mobile (no third grid column yet) and moves
					into its own aligned column at sm+ via the sibling below. */}
				<p className="mt-1.5 text-base font-semibold tabular-nums sm:hidden">
					<PriceText
						price={product.price}
						prefix={product.priceVaries ? 'from ' : undefined}
						state={comparePrices(product.price, product.competitorPrice)}
					/>
				</p>
			</div>

			<div className="hidden text-right text-base font-semibold tabular-nums sm:block">
				<PriceText
					price={product.price}
					prefix={product.priceVaries ? 'from ' : undefined}
					state={comparePrices(product.price, product.competitorPrice)}
				/>
			</div>
		</Link>
	)
}
