import { Toaster } from '@/components/ui/sonner'
import { QueryProvider } from '@/providers/query-provider'
import type { Metadata } from 'next'
import { Geist } from 'next/font/google'

import './globals.css'

const geist = Geist({
	subsets: ['latin']
})

export const metadata: Metadata = {
	title: 'Price',
	description: 'Vizaje-Nica price comparison'
}

export default function RootLayout({
	children
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en">
			<body className={geist.className}>
				<QueryProvider>
					{children}
					<Toaster />
				</QueryProvider>
			</body>
		</html>
	)
}
