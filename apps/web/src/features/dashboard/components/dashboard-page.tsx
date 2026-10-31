'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Skeleton } from '@/components/ui/skeleton'

import {
	DASHBOARD_DEFAULTS,
	parseDashboardSearchParams,
	readDashboardPreferences,
	resolveDashboardFilters,
	serializeDashboardFilters,
	type DashboardFilters
} from '../lib/dashboard-url-state'
import { useDashboardSummary } from '../queries/use-dashboard'
import type { CompetitorFilter, PricePosition } from '../types/dashboard'
import { BrandTable } from './brand-table'
import { CompetitorBreakdown } from './competitor-breakdown'
import { CoverageSection } from './coverage-section'
import { DashboardFiltersBar } from './dashboard-filters'
import { DiscoveryHealthSection } from './discovery-health-section'
import { ExecutiveSummary } from './executive-summary'
import { GapDistributionChart } from './gap-distribution-chart'
import { OpportunitiesTable } from './opportunities-table'
import { PricePositionSection } from './price-position-section'

export function DashboardPage() {
	const router = useRouter()
	const pathname = usePathname()
	const searchParams = useSearchParams()

	const fromUrl = parseDashboardSearchParams(searchParams)
	const filters = resolveDashboardFilters(fromUrl)

	const [pageSize, setPageSize] = useState(20)
	useEffect(() => {
		setPageSize(readDashboardPreferences().pageSize)
	}, [])

	function buildUrl(next: Partial<DashboardFilters>): string {
		const query = serializeDashboardFilters({ ...filters, ...next })
		return query ? `${pathname}?${query}` : pathname
	}

	function setCompetitor(competitor: CompetitorFilter) {
		router.push(buildUrl({ competitor, page: DASHBOARD_DEFAULTS.page }), { scroll: false })
	}

	function setBrand(brand: string) {
		router.push(buildUrl({ brand, page: DASHBOARD_DEFAULTS.page }), { scroll: false })
	}

	function setPosition(position: PricePosition | 'all') {
		router.push(buildUrl({ position, page: DASHBOARD_DEFAULTS.page }), { scroll: false })
	}

	function setSort(sort: DashboardFilters['sort']) {
		const direction = filters.sort === sort && filters.direction === 'desc' ? 'asc' : 'desc'
		router.push(buildUrl({ sort, direction }), { scroll: false })
	}

	function setPage(page: number) {
		router.push(buildUrl({ page }))
	}

	function resetFilters() {
		router.push(pathname)
	}

	const { data: summary, isLoading, isError } = useDashboardSummary(filters.competitor)

	if (isError) {
		return (
			<div className="rounded border border-hairline bg-card p-8">
				<h2 className="font-medium text-text-primary">Failed to load the dashboard</h2>
				<p className="mt-1 text-sm text-text-muted">Make sure the API and PostgreSQL are running.</p>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-10">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-light tracking-tight text-text-primary">Dashboard</h1>
					<p className="mt-1 text-sm text-text-muted">Current price position against MAKEUP and OVICO - no historical trends, this reflects today&apos;s data only.</p>
				</div>
				<DashboardFiltersBar filters={filters} onCompetitorChange={setCompetitor} onBrandChange={setBrand} onReset={resetFilters} />
			</div>

			{isLoading || !summary ? (
				<Skeleton className="h-28 w-full rounded" />
			) : (
				<ExecutiveSummary summary={summary} />
			)}

			<div className="grid gap-6 lg:grid-cols-2">
				{isLoading || !summary ? <Skeleton className="h-64 w-full rounded" /> : <CoverageSection summary={summary} />}
				{isLoading || !summary ? <Skeleton className="h-64 w-full rounded" /> : <PricePositionSection summary={summary} />}
			</div>

			{isLoading || !summary ? <Skeleton className="h-64 w-full rounded" /> : <GapDistributionChart summary={summary} />}

			<section>
				<h2 className="mb-3 font-medium text-text-primary">Brand breakdown</h2>
				<BrandTable competitor={filters.competitor} onBrandClick={setBrand} />
			</section>

			<section>
				<h2 className="mb-3 font-medium text-text-primary">Opportunities</h2>
				<OpportunitiesTable
					competitor={filters.competitor}
					brand={filters.brand}
					position={filters.position}
					onPositionChange={setPosition}
					page={filters.page}
					pageSize={pageSize}
					sort={filters.sort}
					direction={filters.direction}
					onSortChange={setSort}
					onPageChange={setPage}
				/>
			</section>

			<section>
				<h2 className="mb-3 font-medium text-text-primary">Competitor breakdown</h2>
				<CompetitorBreakdown />
			</section>

			<DiscoveryHealthSection />
		</div>
	)
}
