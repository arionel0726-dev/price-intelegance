'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SECTIONS = [
	{ href: '/admin/brands', label: 'Brands' },
	{ href: '/admin/products', label: 'Products' },
	{ href: '/admin/discovery', label: 'Discovery Rules' },
	{ href: '/admin/data-quality', label: 'Data Quality' }
]

export function AdminNav() {
	const pathname = usePathname()

	return (
		<nav aria-label="Admin sections" className="flex flex-wrap items-center gap-2 border-b border-hairline pb-4">
			{SECTIONS.map(section => {
				const active = pathname.startsWith(section.href)
				return (
					<Link
						key={section.href}
						href={section.href}
						aria-current={active ? 'page' : undefined}
						className={
							active
								? 'rounded border border-accent bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent'
								: 'rounded border border-hairline bg-card px-4 py-1.5 text-sm text-text-secondary transition-colors hover:border-text-muted'
						}
					>
						{section.label}
					</Link>
				)
			})}
		</nav>
	)
}
