'use client'

import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { logout } from '@/features/auth/api/logout'

export function CatalogHeader() {
	async function handleLogout() {
		await logout()
		window.location.href = '/login'
	}

	return (
		<header className="border-b bg-background">
			<div className="mx-auto max-w-[1600px] px-5 md:px-8">
				<div className="flex h-20 items-center justify-between gap-8">
					<div className="shrink-0">
						<span className="text-xl font-semibold tracking-tight">Price</span>
					</div>

					<Button
						variant="ghost"
						size="icon"
						className="shrink-0 rounded-full text-muted-foreground"
						onClick={handleLogout}
						aria-label="Sign out"
						title="Sign out"
					>
						<LogOut className="size-5" />
					</Button>
				</div>
			</div>
		</header>
	)
}
