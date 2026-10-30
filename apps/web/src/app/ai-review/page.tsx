import { Suspense } from 'react'

import { AiReviewList } from '@/features/ai-review/components/ai-review-list'
import { CatalogHeader } from '@/features/products/components/catalog-header'

export default function AiReviewPage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1000px] px-5 py-10 md:px-8">
				<h1 className="text-3xl font-light tracking-tight text-text-primary">AI Review</h1>
				<p className="mt-1 text-sm text-text-muted">Ambiguous matches DeepSeek couldn&apos;t auto-confirm.</p>

				<div className="mt-8">
					{/* AiReviewList reads useSearchParams() - see Catalog's own
						Suspense wrapper in app/page.tsx for why this is required. */}
					<Suspense fallback={null}>
						<AiReviewList />
					</Suspense>
				</div>
			</main>
		</div>
	)
}
