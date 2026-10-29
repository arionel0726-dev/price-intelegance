import { Suspense } from 'react'

import { Catalog } from '@/features/products/components/catalog'
import { CatalogHeader } from '@/features/products/components/catalog-header'

export default function HomePage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1600px] px-5 py-10 md:px-8">
				{/* Catalog reads useSearchParams() for its URL-state contract -
					Next requires (and will otherwise de-opt the whole page to
					client rendering during prerendering) a Suspense boundary
					around any component that calls it. */}
				<Suspense fallback={null}>
					<Catalog />
				</Suspense>
			</main>
		</div>
	)
}
