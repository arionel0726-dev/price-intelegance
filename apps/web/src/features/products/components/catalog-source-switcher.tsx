import type { CatalogSource } from '../lib/catalog-url-state'

const SOURCES: Array<{ key: CatalogSource; label: string }> = [
	{ key: 'vizaje', label: 'Vizaje' },
	{ key: 'ovico', label: 'OVICO' }
]

// Catalog Ingestion v1 (OVICO) - [ Vizaje ] [ OVICO ] switcher at the top
// of the existing Catalog page. Same active-pill visual pattern as
// CatalogToolbar's category pills (border-accent/bg-accent/text-accent
// when active) - no new styling introduced.
export function CatalogSourceSwitcher({
	source,
	onSourceChange
}: {
	source: CatalogSource
	onSourceChange: (source: CatalogSource) => void
}) {
	return (
		<div className="flex items-center gap-2" role="tablist" aria-label="Catalog source">
			{SOURCES.map(item => {
				const active = source === item.key

				return (
					<button
						key={item.key}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onSourceChange(item.key)}
						className={
							active
								? 'rounded border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent'
								: 'rounded border border-hairline bg-card px-4 py-1.5 text-sm text-text-secondary transition-colors hover:border-text-muted'
						}
					>
						{item.label}
					</button>
				)
			})}
		</div>
	)
}
