'use client'

import { Button } from '@/components/ui/button'

type PaginationProps = {
	page: number
	totalPages: number
	onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
	if (totalPages <= 1) return null

	const pages = getPageWindow(page, totalPages)

	return (
		<nav
			aria-label="Pagination"
			className="mt-10 flex items-center justify-center gap-2"
		>
			<Button
				variant="outline"
				size="sm"
				disabled={page <= 1}
				onClick={() => onPageChange(page - 1)}
			>
				Previous
			</Button>

			<div className="flex items-center gap-1">
				{pages.map((item, index) =>
					item === 'ellipsis' ? (
						<span
							key={`ellipsis-${index}`}
							className="px-1 text-sm text-muted-foreground"
						>
							…
						</span>
					) : (
						<button
							key={item}
							onClick={() => onPageChange(item)}
							aria-current={item === page ? 'page' : undefined}
							className={
								item === page
									? 'flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-sm text-background'
									: 'flex size-8 shrink-0 items-center justify-center rounded-full text-sm hover:bg-muted'
							}
						>
							{item}
						</button>
					)
				)}
			</div>

			<Button
				variant="outline"
				size="sm"
				disabled={page >= totalPages}
				onClick={() => onPageChange(page + 1)}
			>
				Next
			</Button>
		</nav>
	)
}

// Compact window: first page, last page, current page +/-1, ellipses for
// the gaps. Keeps the control usable on mobile regardless of totalPages.
function getPageWindow(current: number, total: number): (number | 'ellipsis')[] {
	const radius = 1
	const pages: (number | 'ellipsis')[] = [1]

	const start = Math.max(2, current - radius)
	const end = Math.min(total - 1, current + radius)

	if (start > 2) pages.push('ellipsis')

	for (let i = start; i <= end; i++) {
		pages.push(i)
	}

	if (end < total - 1) pages.push('ellipsis')
	if (total > 1) pages.push(total)

	return pages
}
