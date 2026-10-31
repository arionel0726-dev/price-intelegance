import { Controller, Get, Query } from '@nestjs/common';

import { DashboardService, type CompetitorFilter } from './dashboard.service';
import type { PricePosition } from './price-gap';

function parseCompetitor(value: string | undefined): CompetitorFilter {
	return value === 'makeup' || value === 'ovico' ? value : 'all';
}

// Protected by the global AuthGuard like every other controller - same
// single-shared-account convention as every M2-M5 controller, no
// separate admin/manager role to build.
@Controller('dashboard')
export class DashboardController {
	constructor(private readonly dashboard: DashboardService) {}

	@Get('summary')
	summary(@Query('competitor') competitor?: string) {
		return this.dashboard.getSummary(parseCompetitor(competitor));
	}

	@Get('brands')
	brands(@Query('competitor') competitor?: string, @Query('sort') sort?: string) {
		return this.dashboard.getBrands(parseCompetitor(competitor), sort);
	}

	@Get('opportunities')
	opportunities(
		@Query('competitor') competitor?: string,
		@Query('brand') brand?: string,
		@Query('position') position?: string,
		@Query('sort') sort?: string,
		@Query('direction') direction?: string,
		@Query('page') page?: string,
		@Query('pageSize') pageSize?: string
	) {
		return this.dashboard.getOpportunities({
			competitor: parseCompetitor(competitor),
			brand,
			position: position === 'more_expensive' || position === 'cheaper' || position === 'approximately_equal' ? (position as PricePosition) : undefined,
			sort: sort === 'gapAmount' || sort === 'name' ? sort : 'gapPercent',
			direction: direction === 'asc' ? 'asc' : 'desc',
			page: page ? Number(page) : undefined,
			pageSize: pageSize ? Number(pageSize) : undefined
		});
	}

	@Get('discovery-health')
	discoveryHealth() {
		return this.dashboard.getDiscoveryHealth();
	}
}
