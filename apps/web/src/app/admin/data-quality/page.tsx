import { CatalogHeader } from '@/features/products/components/catalog-header'
import { AdminNav } from '@/features/admin/components/admin-nav'
import { DataQualityView } from '@/features/admin/components/data-quality-view'

export default function AdminDataQualityPage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1100px] px-5 py-10 md:px-8">
				<h1 className="text-3xl font-light tracking-tight text-text-primary">Admin</h1>
				<p className="mt-1 text-sm text-text-muted">Image classification, data-quality counts and the placeholder registry.</p>

				<div className="mt-6">
					<AdminNav />
				</div>

				<div className="mt-6">
					<DataQualityView />
				</div>
			</main>
		</div>
	)
}
