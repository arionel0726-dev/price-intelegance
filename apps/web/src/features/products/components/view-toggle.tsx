import { LayoutGrid, List } from 'lucide-react'

import { cn } from '@/lib/utils'

export type CatalogView = 'grid' | 'list'

type ViewToggleProps = {
	view: CatalogView
	onViewChange: (view: CatalogView) => void
}

export function ViewToggle({ view, onViewChange }: ViewToggleProps) {
	return (
		<div
			role="group"
			aria-label="Catalog view"
			className="inline-flex items-center gap-0.5 rounded border border-hairline bg-card p-1"
		>
			<ViewToggleButton
				label="Grid view"
				active={view === 'grid'}
				onClick={() => onViewChange('grid')}
			>
				<LayoutGrid className="size-4" />
			</ViewToggleButton>

			<ViewToggleButton
				label="List view"
				active={view === 'list'}
				onClick={() => onViewChange('list')}
			>
				<List className="size-4" />
			</ViewToggleButton>
		</div>
	)
}

function ViewToggleButton({
	label,
	active,
	onClick,
	children
}: {
	label: string
	active: boolean
	onClick: () => void
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			aria-label={label}
			title={label}
			className={cn(
				'flex size-7 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
				active
					? 'bg-surface text-text-primary'
					: 'text-text-muted hover:text-text-primary'
			)}
		>
			{children}
		</button>
	)
}
