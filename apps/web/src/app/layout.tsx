import { Toaster } from '@/components/ui/sonner'
import { QueryProvider } from '@/providers/query-provider'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'

// Geist stays the primary UI font (Milestone 2.5: weights 300/400/500 only
// in the catalog - see project notes - no heavier 600/700 "SaaS dashboard"
// look). Geist Mono is added for labels/metadata (article/barcode values,
// small uppercase tags) where a monospace numeral reads more editorial
// than another sans weight. Both are exposed as CSS variables so
// globals.css's --font-sans/--font-mono can reference them, instead of
// relying on the previous (unused) `className`-only wiring.
const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin']
})

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
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
			<body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
				<QueryProvider>
					{children}
					<Toaster />
				</QueryProvider>
			</body>
		</html>
	)
}
