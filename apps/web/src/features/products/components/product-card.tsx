import Image from 'next/image'
import Link from 'next/link'

import type { Product } from '../types/product'

type ProductCardProps = {
	product: Product
}

export function ProductCard({ product }: ProductCardProps) {
	return (
		<Link
			href={`/products/${product.id}`}
			className="group block"
		>
			<article>
				<div className="relative aspect-[1/1.12] overflow-hidden bg-[#f6f6f6]">
					{product.imageUrl ? (
						<Image
							src={product.imageUrl}
							alt={product.name}
							fill
							className="object-contain p-8"
						/>
					) : (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							No image
						</div>
					)}
				</div>

				<div className="pt-4">
					<p className="text-xs font-semibold uppercase tracking-[0.12em]">
						{product.brand}
					</p>

					<h2 className="mt-2 line-clamp-2 text-base font-medium leading-snug">
						{product.name}
					</h2>

					{product.volume && (
						<p className="mt-1 text-sm text-muted-foreground">
							{product.volume}
						</p>
					)}

					<div className="mt-4 flex items-center justify-between gap-3">
						<p className="text-lg font-semibold tabular-nums">
							{product.price
								? `${Number(product.price).toLocaleString('ro-MD')} MDL`
								: '—'}
						</p>

						<span className="text-xs font-medium text-muted-foreground underline-offset-4 group-hover:underline">
							Compare
						</span>
					</div>
				</div>
			</article>
		</Link>
	)
}
