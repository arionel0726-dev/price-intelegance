import { Suspense } from 'react'

import { CatalogHeader } from '@/features/products/components/catalog-header'
import { JobsPage } from '@/features/jobs/components/jobs-page'

export default function DiscoveryJobsPage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1200px] px-5 py-10 md:px-8">
				{/* JobsPage's history list reads useSearchParams() - same
					Suspense requirement as Catalog/AiReviewList. */}
				<Suspense fallback={null}>
					<JobsPage />
				</Suspense>
			</main>
		</div>
	)
}
