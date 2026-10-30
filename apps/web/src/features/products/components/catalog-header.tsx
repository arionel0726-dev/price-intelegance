'use client'

import { LogOut } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { logout } from '@/features/auth/api/logout'

// Routes that actually exist today - no Admin/Dashboard placeholders.
const NAV_ITEMS = [
	{ href: '/', label: 'Catalog' },
	{ href: '/jobs', label: 'Jobs' },
	{ href: '/ai-review', label: 'AI Review' }
]

export function CatalogHeader() {
	const pathname = usePathname()

	async function handleLogout() {
		await logout()
		window.location.href = '/login'
	}

	return (
		<header className="border-b border-hairline bg-background">
			<div className="mx-auto max-w-[1600px] px-5 md:px-8">
				<div className="flex h-20 items-center justify-between gap-8">
					<div className="flex shrink-0 items-center gap-8">
						<span className="text-xl font-medium tracking-tight text-text-primary">Price</span>

						<nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
							{NAV_ITEMS.map(item => {
								const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)

								return (
									<Link
										key={item.href}
										href={item.href}
										aria-current={active ? 'page' : undefined}
										className={
											active
												? 'rounded px-3 py-1.5 text-sm font-medium text-accent'
												: 'rounded px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary'
										}
									>
										{item.label}
									</Link>
								)
							})}
						</nav>
					</div>

					<Button
						variant="ghost"
						size="icon"
						className="shrink-0 rounded text-text-muted focus-visible:ring-accent"
						onClick={handleLogout}
						aria-label="Sign out"
						title="Sign out"
					>
						<LogOut className="size-5" aria-hidden="true" />
					</Button>
				</div>

				<nav aria-label="Main" className="flex items-center gap-1 overflow-x-auto pb-3 sm:hidden">
					{NAV_ITEMS.map(item => {
						const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)

						return (
							<Link
								key={item.href}
								href={item.href}
								aria-current={active ? 'page' : undefined}
								className={
									active
										? 'shrink-0 rounded px-3 py-1.5 text-sm font-medium text-accent'
										: 'shrink-0 rounded px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary'
								}
							>
								{item.label}
							</Link>
						)
					})}
				</nav>
			</div>
		</header>
	)
}
