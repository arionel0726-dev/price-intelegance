import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';

import { DiscoveryJobsService } from './discovery-jobs.service';
import type { DiscoveryCompetitorSlug } from './discovery-jobs.types';

class EnqueueDiscoveryJobBody {
  competitor!: DiscoveryCompetitorSlug;
  mode!: 'limited' | 'continuous';
  brand?: string | null;
  inStock?: boolean;
  onlyUnmatched?: boolean;
  limit?: number;
  productBudgetSeconds!: number;
}

// Protected by the global AuthGuard (see auth.module.ts) like every other
// controller in this API - no @Public() here, so job control is never
// reachable without the existing session cookie.
@Controller('jobs/discovery')
export class DiscoveryJobsController {
  constructor(private readonly jobs: DiscoveryJobsService) {}

  @Post()
  enqueue(@Body() body: EnqueueDiscoveryJobBody) {
    return this.jobs.enqueue({
      competitor: body.competitor,
      mode: body.mode,
      brand: body.brand,
      inStock: body.inStock,
      onlyUnmatched: body.onlyUnmatched,
      limit: body.limit,
      productBudgetSeconds: body.productBudgetSeconds,
    });
  }

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('competitor') competitor?: DiscoveryCompetitorSlug,
    @Query('status') status?: string,
  ) {
    return this.jobs.list(page ? Number(page) : 1, limit ? Number(limit) : 20, {
      competitor,
      statuses: status ? status.split(',') : undefined,
    });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.getOrThrow(id);
  }

  @Get(':id/events')
  events(@Param('id', ParseIntPipe) id: number, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.jobs.listEvents(id, page ? Number(page) : 1, limit ? Number(limit) : 50);
  }

  @Post(':id/stop')
  stop(@Param('id', ParseIntPipe) id: number) {
    return this.jobs.requestStop(id);
  }
}
