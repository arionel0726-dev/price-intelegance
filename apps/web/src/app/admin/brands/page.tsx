import { CatalogHeader } from '@/features/products/components/catalog-header'
import { AdminNav } from '@/features/admin/components/admin-nav'
import { BrandsTable } from '@/features/admin/components/brands-table'

export default function AdminBrandsPage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1100px] px-5 py-10 md:px-8">
				<h1 className="text-3xl font-light tracking-tight text-text-primary">Admin</h1>
				<p className="mt-1 text-sm text-text-muted">Brand-level catalog, discovery and price-monitoring policy.</p>

				<div className="mt-6">
					<AdminNav />
				</div>

				<div className="mt-6">
					<BrandsTable />
				</div>
			</main>
		</div>
	)
}
