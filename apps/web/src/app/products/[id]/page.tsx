'use client'

import { CatalogHeader } from '@/features/products/components/catalog-header'
import { useProductDetails } from '@/features/products/queries/use-product-details'
import { ArrowLeft, Barcode, Check, Copy, ExternalLink } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
export default function ProductDetailsPage() {
	const params = useParams()
	const router = useRouter()
	const id = Number(params.id)

	const { data, isLoading, isError } = useProductDetails(id)

	if (isLoading) {
		return (
			<div className="min-h-screen bg-background">
				<CatalogHeader />
				<main className="mx-auto max-w-[1600px] px-5 py-10 md:px-8">
					Loading...
				</main>
			</div>
		)
	}

	if (isError || !data) {
		return (
			<div className="min-h-screen bg-background">
				<CatalogHeader />
				<main className="mx-auto max-w-[1600px] px-5 py-10 md:px-8">
					Failed to load product
				</main>
			</div>
		)
	}

	const { product, variantType, siblings, competitors } = data
	const hasVariantSelector = siblings.length > 1

	function goToVariant(variantId: number) {
		if (variantId === product.id) return
		router.push(`/products/${variantId}`)
	}

	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1600px] px-5 py-10 md:px-8">
				<Link
					href="/"
					className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
				>
					<ArrowLeft className="size-4" />
					Back to catalog
				</Link>

				<section className="mt-8 grid gap-10 lg:grid-cols-[320px_minmax(0,1fr)]">
					<div className="relative aspect-square overflow-hidden bg-[#f6f6f6]">
						{product.imageUrl ? (
							<Image
								src={product.imageUrl}
								alt={product.name}
								fill
								className="object-contain p-10"
							/>
						) : (
							<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
								No image
							</div>
						)}
					</div>

					<div>
						<p className="text-sm uppercase tracking-[0.14em] text-muted-foreground">
							{product.brand}
						</p>

						<h1 className="mt-3 text-4xl font-semibold tracking-tight">
							{product.name}
						</h1>

						<p className="mt-6 text-3xl font-semibold">
							{product.price
								? `${Number(product.price).toLocaleString('ro-MD')} MDL`
								: '—'}
						</p>

						{product.url && (
							<a
								href={product.url}
								target="_blank"
								rel="noopener noreferrer"
								className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:underline underline-offset-4"
							>
								Open on Vizaje-Nica
								<ExternalLink className="size-4" />
							</a>
						)}

						{hasVariantSelector && (
							<div className="mt-8">
								<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
									{variantType === 'volume'
										? 'Volume'
										: variantType === 'shade'
											? 'Shade'
											: 'Variant'}
								</p>

								<div className="mt-3 flex flex-wrap gap-2">
									{siblings.map(sibling => {
										const isCurrent = sibling.id === product.id
										const label =
											variantType === 'shade'
												? (sibling.color ?? sibling.volume ?? `#${sibling.id}`)
												: (sibling.volume ?? sibling.color ?? `#${sibling.id}`)

										return (
											<button
												key={sibling.id}
												type="button"
												onClick={() => goToVariant(sibling.id)}
												aria-current={isCurrent ? 'true' : undefined}
												className={
													isCurrent
														? 'rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background'
														: 'rounded-full border px-4 py-2 text-sm font-medium hover:bg-muted'
												}
											>
												{label}
											</button>
										)
									})}
								</div>
							</div>
						)}

						<div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
							<InfoItem
								label="Article"
								value={product.article}
								copyable
							/>

							<InfoItem
								label="Barcode"
								value={product.barcode}
								icon={<Barcode className="size-4" />}
								copyable
							/>
							<InfoItem
								label="Sex"
								value={product.sex}
							/>
							<InfoItem
								label="Volume"
								value={product.volume}
							/>
							<InfoItem
								label="Color"
								value={product.color}
							/>
							<InfoItem
								label="Category"
								value={product.category}
							/>
						</div>
					</div>
				</section>

				<section className="mt-16">
					<div className="flex items-center justify-between gap-4">
						<h2 className="text-3xl font-semibold tracking-tight">
							Compare buying options
						</h2>

						<p className="text-sm text-muted-foreground">
							{competitors.length} competitors
						</p>
					</div>

					<div className="mt-8 overflow-hidden rounded-[24px] border">
						<div className="hidden grid-cols-[1.2fr_1.6fr_180px_180px] gap-6 border-b bg-muted/30 px-6 py-4 text-xs uppercase tracking-[0.12em] text-muted-foreground lg:grid">
							<div>Sold by</div>
							<div>Item</div>
							<div>Price</div>
							<div></div>
						</div>

						<div className="divide-y">
							{competitors.length > 0 ? (
								competitors.map(item => (
									<div
										key={item.id}
										className="grid gap-5 px-6 py-6 lg:grid-cols-[1.2fr_1.6fr_180px_180px] lg:items-center"
									>
										<div className="flex items-center gap-4">
											<div className="relative size-20 overflow-hidden rounded-2xl bg-[#f6f6f6]">
												{item.imageUrl ? (
													<Image
														src={item.imageUrl}
														alt={item.title}
														fill
														className="object-contain p-3"
													/>
												) : (
													<div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
														No image
													</div>
												)}
											</div>

											<div>
												<p className="text-lg font-semibold">
													{item.competitorName}
												</p>

												<p className="mt-1 text-sm text-muted-foreground">
													Matched competitor
												</p>
											</div>
										</div>

										<div>
											<p className="text-base font-medium leading-relaxed">
												{item.title}
											</p>
										</div>

										<div className="text-2xl font-semibold tabular-nums">
											{item.price
												? `${Number(item.price).toLocaleString('ro-MD')} MDL`
												: '—'}
										</div>

										<div>
											<a
												href={item.url}
												target="_blank"
												rel="noreferrer"
												className="inline-flex h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm font-medium hover:bg-muted"
											>
												Open site
												<ExternalLink className="size-4" />
											</a>
										</div>
									</div>
								))
							) : (
								<div className="px-6 py-16 text-center">
									<h3 className="text-lg font-medium">
										No competitor matches yet
									</h3>

									<p className="mt-2 text-sm text-muted-foreground">
										This product does not have linked competitor products yet.
									</p>
								</div>
							)}
						</div>
					</div>
				</section>
			</main>
		</div>
	)
}

function InfoItem({
	label,
	value,
	icon,
	copyable = false
}: {
	label: string
	value: string | null
	icon?: React.ReactNode
	copyable?: boolean
}) {
	const [copied, setCopied] = useState(false)

	async function handleCopy() {
		if (!value) return

		await navigator.clipboard.writeText(value)

		setCopied(true)

		toast.success(`${label} copied`)

		window.setTimeout(() => {
			setCopied(false)
		}, 1500)
	}

	return (
		<div className="flex min-h-[76px] items-center justify-between gap-4 rounded-2xl border bg-background px-4 py-4">
			<div className="min-w-0">
				<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
					{label}
				</p>

				<div className="mt-2 flex items-center gap-2">
					{icon}

					<p className="truncate text-sm font-medium">{value ?? '—'}</p>
				</div>
			</div>

			{copyable && value && (
				<button
					type="button"
					onClick={handleCopy}
					className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label={`Copy ${label}`}
					title={`Copy ${label}`}
				>
					{copied ? <Check className="size-4" /> : <Copy className="size-4" />}
				</button>
			)}
		</div>
	)
}
