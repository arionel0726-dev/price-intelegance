import { Suspense } from 'react'

import { CatalogHeader } from '@/features/products/components/catalog-header'
import { AdminNav } from '@/features/admin/components/admin-nav'
import { AdminProductsList } from '@/features/admin/components/admin-products-list'

export default function AdminProductsPage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1100px] px-5 py-10 md:px-8">
				<h1 className="text-3xl font-light tracking-tight text-text-primary">Admin</h1>
				<p className="mt-1 text-sm text-text-muted">Per-product tri-state overrides (catalog / discovery / price monitoring).</p>

				<div className="mt-6">
					<AdminNav />
				</div>

				<div className="mt-6">
					{/* AdminProductsList reads useSearchParams() - same Suspense
						requirement as Catalog/AiReviewList/JobsPage. */}
					<Suspense fallback={null}>
						<AdminProductsList />
					</Suspense>
				</div>
			</main>
		</div>
	)
}
