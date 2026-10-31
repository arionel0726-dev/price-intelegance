import { Suspense } from 'react'

import { CatalogHeader } from '@/features/products/components/catalog-header'
import { DashboardPage } from '@/features/dashboard/components/dashboard-page'

export default function BusinessDashboardPage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1200px] px-5 py-10 md:px-8">
				{/* DashboardPage reads useSearchParams() - same Suspense
					requirement as Catalog/AiReviewList/JobsPage/AdminProductsList. */}
				<Suspense fallback={null}>
					<DashboardPage />
				</Suspense>
			</main>
		</div>
	)
}
