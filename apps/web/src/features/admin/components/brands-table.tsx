'use client'

import { useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import { useBrands, useBulkPatchBrands, usePatchBrand } from '../queries/use-brands'
import type { Brand, BrandPolicyPatch } from '../types/admin'
import { PolicyToggle } from './policy-toggle'

// Brand | Catalog | MAKEUP | OVICO | Price monitoring - exactly the row
// structure the brief specifies. No master "discovery enabled" column:
// the schema has no such field (a brand-wide pause is already fully
// expressible as both competitor flags false - see schema.ts's note on
// `brands`), so this table only ever shows the two concrete toggles.
export function BrandsTable() {
	const { data: brands, isLoading, isError } = useBrands()
	const patchBrand = usePatchBrand()
	const bulkPatch = useBulkPatchBrands()
	const [selected, setSelected] = useState<Set<string>>(new Set())

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-8">
				<h2 className="font-medium text-text-primary">Failed to load brands</h2>
			</div>
		)
	}

	if (isLoading) {
		return (
			<div className="flex flex-col gap-2">
				{Array.from({ length: 6 }).map((_, index) => (
					<Skeleton key={index} className="h-12 w-full rounded" />
				))}
			</div>
		)
	}

	const items = brands ?? []

	function toggleSelected(canonicalKey: string) {
		setSelected(prev => {
			const next = new Set(prev)
			if (next.has(canonicalKey)) next.delete(canonicalKey)
			else next.add(canonicalKey)
			return next
		})
	}

	function toggleSelectAll() {
		setSelected(prev => (prev.size === items.length ? new Set() : new Set(items.map(b => b.canonicalKey))))
	}

	function applyBulk(patch: BrandPolicyPatch) {
		if (selected.size === 0) return
		bulkPatch.mutate(
			{ canonicalKeys: Array.from(selected), patch },
			{ onSuccess: () => setSelected(new Set()) }
		)
	}

	function pauseBrandEntirely(brand: Brand) {
		// A bulk "pause brand entirely" UI action - just two field writes
		// in one PATCH, no dedicated master-discovery field (see schema
		// note above).
		patchBrand.mutate({ canonicalKey: brand.canonicalKey, patch: { makeupDiscoveryEnabled: false, ovicoDiscoveryEnabled: false } })
	}

	return (
		<div>
			{items.length === 0 ? (
				<div className="rounded border border-hairline bg-surface py-16 text-center">
					<p className="text-sm text-text-muted">No brands yet.</p>
				</div>
			) : (
				<>
					{selected.size > 0 && (
						<div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-accent bg-accent/5 px-3 py-2">
							<span className="text-sm text-text-secondary">{selected.size} selected</span>
							<button type="button" onClick={() => applyBulk({ visibleInCatalog: true })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Show in catalog
							</button>
							<button type="button" onClick={() => applyBulk({ visibleInCatalog: false })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Hide from catalog
							</button>
							<button type="button" onClick={() => applyBulk({ makeupDiscoveryEnabled: true })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Enable MAKEUP discovery
							</button>
							<button type="button" onClick={() => applyBulk({ makeupDiscoveryEnabled: false })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Disable MAKEUP discovery
							</button>
							<button type="button" onClick={() => applyBulk({ ovicoDiscoveryEnabled: true })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Enable OVICO discovery
							</button>
							<button type="button" onClick={() => applyBulk({ ovicoDiscoveryEnabled: false })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Disable OVICO discovery
							</button>
							<button type="button" onClick={() => applyBulk({ priceMonitoringEnabled: true })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Enable price monitoring
							</button>
							<button type="button" onClick={() => applyBulk({ priceMonitoringEnabled: false })} className="rounded border border-hairline bg-card px-2.5 py-1 text-xs text-text-secondary">
								Disable price monitoring
							</button>
							{bulkPatch.isPending && <span className="text-xs text-text-muted">Applying…</span>}
						</div>
					)}

					<div className="overflow-x-auto">
					<table className="w-full min-w-[640px] border-collapse text-sm">
						<thead>
							<tr className="border-b border-hairline text-left text-xs uppercase tracking-[0.06em] text-text-muted">
								<th className="w-8 py-2">
									<input
										type="checkbox"
										aria-label="Select all brands"
										checked={selected.size === items.length && items.length > 0}
										onChange={toggleSelectAll}
										className="size-4"
									/>
								</th>
								<th className="py-2 pr-3">Brand</th>
								<th className="py-2 pr-3">Catalog</th>
								<th className="py-2 pr-3">MAKEUP</th>
								<th className="py-2 pr-3">OVICO</th>
								<th className="py-2 pr-3">Price monitoring</th>
								<th className="py-2">Actions</th>
							</tr>
						</thead>
						<tbody>
							{items.map(brand => (
								<tr key={brand.canonicalKey} className="border-b border-hairline last:border-0">
									<td className="py-2.5">
										<input
											type="checkbox"
											aria-label={`Select ${brand.displayName}`}
											checked={selected.has(brand.canonicalKey)}
											onChange={() => toggleSelected(brand.canonicalKey)}
											className="size-4"
										/>
									</td>
									<td className="py-2.5 pr-3 font-medium text-text-primary">{brand.displayName}</td>
									<td className="py-2.5 pr-3">
										<PolicyToggle
											label="Catalog visibility"
											value={brand.visibleInCatalog}
											disabled={patchBrand.isPending}
											onChange={value => patchBrand.mutate({ canonicalKey: brand.canonicalKey, patch: { visibleInCatalog: value } })}
										/>
									</td>
									<td className="py-2.5 pr-3">
										<PolicyToggle
											label="MAKEUP discovery"
											value={brand.makeupDiscoveryEnabled}
											disabled={patchBrand.isPending}
											onChange={value => patchBrand.mutate({ canonicalKey: brand.canonicalKey, patch: { makeupDiscoveryEnabled: value } })}
										/>
									</td>
									<td className="py-2.5 pr-3">
										<PolicyToggle
											label="OVICO discovery"
											value={brand.ovicoDiscoveryEnabled}
											disabled={patchBrand.isPending}
											onChange={value => patchBrand.mutate({ canonicalKey: brand.canonicalKey, patch: { ovicoDiscoveryEnabled: value } })}
										/>
									</td>
									<td className="py-2.5 pr-3">
										<PolicyToggle
											label="Price monitoring"
											value={brand.priceMonitoringEnabled}
											disabled={patchBrand.isPending}
											onChange={value => patchBrand.mutate({ canonicalKey: brand.canonicalKey, patch: { priceMonitoringEnabled: value } })}
										/>
									</td>
									<td className="py-2.5">
										{(brand.makeupDiscoveryEnabled || brand.ovicoDiscoveryEnabled) && (
											<button
												type="button"
												onClick={() => pauseBrandEntirely(brand)}
												className="text-xs text-text-muted hover:text-destructive"
											>
												Pause discovery entirely
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					</div>
				</>
			)}
		</div>
	)
}
