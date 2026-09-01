'use client'

import { ScanBarcode, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function CatalogHeader() {
	return (
		<header className="border-b bg-background">
			<div className="mx-auto max-w-[1600px] px-5 md:px-8">
				<div className="flex h-20 items-center gap-8">
					<div className="shrink-0">
						<span className="text-xl font-semibold tracking-tight">Price</span>
					</div>

					<div className="relative max-w-3xl flex-1">
						<Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />

						<Input
							placeholder="Search by product, article or barcode"
							className="h-12 rounded-full border-0 bg-muted/60 pl-12 pr-14 text-base shadow-none"
						/>

						<Button
							variant="ghost"
							size="icon"
							className="absolute right-1.5 top-1/2 size-9 -translate-y-1/2 rounded-full"
						>
							<ScanBarcode className="size-5" />
						</Button>
					</div>
				</div>

				<nav className="flex h-12 items-center gap-8 overflow-x-auto whitespace-nowrap border-t text-sm font-medium">
					<button className="font-semibold">Catalog</button>

					<button>Perfume</button>
					<button>Makeup</button>
					<button>Skincare</button>
					<button>Hair</button>
					<button>Men</button>
					<button>Brands</button>
				</nav>
			</div>
		</header>
	)
}
