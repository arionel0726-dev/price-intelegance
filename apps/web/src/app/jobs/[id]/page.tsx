'use client'

import { useParams } from 'next/navigation'

import { CatalogHeader } from '@/features/products/components/catalog-header'
import { JobDetail } from '@/features/jobs/components/job-detail'

export default function JobDetailPage() {
	const params = useParams()
	const id = Number(params.id)

	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1000px] px-5 py-10 md:px-8">
				<JobDetail jobId={id} />
			</main>
		</div>
	)
}
