'use client'

import Link from 'next/link'

import { Skeleton } from '@/components/ui/skeleton'

import { formatCount } from '../lib/format'
import { useDiscoveryHealth } from '../queries/use-dashboard'

// Links out to the existing Jobs/AI Review/Admin screens rather than
// duplicating them - this section is a pointer, not a second workflow.
export function DiscoveryHealthSection() {
	const { data, isLoading, isError } = useDiscoveryHealth()

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-6">
				<p className="text-sm text-text-muted">Failed to load discovery health.</p>
			</div>
		)
	}

	if (isLoading || !data) {
		return <Skeleton className="h-32 w-full rounded" />
	}

	const items = [
		{ label: 'Unmatched products', value: data.unmatched, href: '/admin/products?overrideState=all', cta: 'View in Admin' },
		{ label: 'Pending AI review', value: data.pendingAiReview, href: '/ai-review', cta: 'Open AI Review' },
		{ label: 'Retry-eligible', value: data.retryEligible, href: '/jobs', cta: 'View jobs' },
		{ label: 'Recent errors', value: data.recentErrors, href: '/jobs', cta: 'View jobs' },
		{ label: 'Never checked (estimate)', value: data.neverCheckedEstimate, href: '/jobs', cta: 'Start a job' }
	]

	return (
		<section className="rounded border border-hairline bg-card p-5">
			<h2 className="font-medium text-text-primary">Discovery &amp; unresolved</h2>
			<p className="mt-1 text-sm text-text-muted">{formatCount(data.websiteConfirmedProducts)} website-confirmed products in total.</p>

			<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
				{items.map(item => (
					<div key={item.label} className="rounded border border-hairline bg-surface p-3">
						<p className="text-xs text-text-muted">{item.label}</p>
						<p className="mt-1 text-xl font-light tabular-nums text-text-primary">{formatCount(item.value)}</p>
						<Link href={item.href} className="mt-1 inline-block text-xs text-accent hover:underline">
							{item.cta} →
						</Link>
					</div>
				))}
			</div>
		</section>
	)
}
