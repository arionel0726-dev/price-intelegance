import { CatalogHeader } from '@/features/products/components/catalog-header'
import { AdminNav } from '@/features/admin/components/admin-nav'
import { DiscoverySettingsView } from '@/features/admin/components/discovery-settings-view'

export default function AdminDiscoveryPage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[900px] px-5 py-10 md:px-8">
				<h1 className="text-3xl font-light tracking-tight text-text-primary">Admin</h1>
				<p className="mt-1 text-sm text-text-muted">AI review settings and operational visibility.</p>

				<div className="mt-6">
					<AdminNav />
				</div>

				<div className="mt-6">
					<DiscoverySettingsView />
				</div>
			</main>
		</div>
	)
}
