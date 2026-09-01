import { Catalog } from '@/features/products/components/catalog'
import { CatalogHeader } from '@/features/products/components/catalog-header'

export default function HomePage() {
	return (
		<div className="min-h-screen bg-background">
			<CatalogHeader />

			<main className="mx-auto max-w-[1600px] px-5 py-10 md:px-8">
				<Catalog />
			</main>
		</div>
	)
}
