import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import {
	type BrandSourcePatch,
	type BrandSourceStatus,
	OvicoBrandSourcesService
} from '../competitors/ovico-catalog/ovico-brand-sources.service';
import { OvicoCatalogSyncService } from '../competitors/ovico-catalog/ovico-catalog-sync.service';

class BrandSourcePatchBody implements BrandSourcePatch {
	sourceUrl?: string;
	status?: BrandSourceStatus;
	enabled?: boolean;
}

class NewBrandSourceBody {
	brandId!: string;
	sourceUrl!: string;
	status?: BrandSourceStatus;
}

// Catalog Ingestion v1 (OVICO) - Admin brand-source management. Protected
// by the same global AuthGuard as every other controller (see
// admin-brands.controller.ts's comment - no separate admin role exists in
// this app).
@Controller('admin/ovico-sources')
export class AdminOvicoSourcesController {
	constructor(
		private readonly sources: OvicoBrandSourcesService,
		private readonly sync: OvicoCatalogSyncService
	) {}

	@Get()
	listAll() {
		return this.sources.listAllWithSources();
	}

	@Post()
	async add(@Body() body: NewBrandSourceBody) {
		const competitorId = await this.sync.getOvicoCompetitorId();

		return this.sources.upsert({
			brandId: body.brandId,
			competitorId,
			sourceUrl: body.sourceUrl,
			status: body.status
		});
	}

	@Patch(':id')
	patch(@Param('id', ParseIntPipe) id: number, @Body() body: BrandSourcePatchBody) {
		return this.sources.patch(id, body);
	}

	@Delete(':id')
	remove(@Param('id', ParseIntPipe) id: number) {
		return this.sources.remove(id);
	}

	@Post(':id/sync')
	triggerSync(@Param('id', ParseIntPipe) id: number) {
		return this.sync.crawlBrandSource(id);
	}
}
