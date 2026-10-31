import { Body, Controller, Get, Param, Patch } from '@nestjs/common';

import { AdminBrandsService, type BrandPolicyPatch } from './admin-brands.service';

class BrandPatchBody implements BrandPolicyPatch {
	visibleInCatalog?: boolean;
	makeupDiscoveryEnabled?: boolean;
	ovicoDiscoveryEnabled?: boolean;
	priceMonitoringEnabled?: boolean;
}

class BulkBrandPatchBody {
	canonicalKeys!: string[];
	patch!: BrandPolicyPatch;
}

// Protected by the global AuthGuard (see auth.module.ts) like every other
// controller in this API - this is a single shared-account app, there is
// no separate "admin role" (confirmed by reading auth.module.ts/
// auth.guard.ts: one APP_GUARD, no roles/claims anywhere).
@Controller('admin/brands')
export class AdminBrandsController {
	constructor(private readonly brands: AdminBrandsService) {}

	@Get()
	list() {
		return this.brands.list();
	}

	@Get(':canonicalKey')
	get(@Param('canonicalKey') canonicalKey: string) {
		return this.brands.getOrThrow(canonicalKey);
	}

	@Patch(':canonicalKey')
	patch(@Param('canonicalKey') canonicalKey: string, @Body() body: BrandPatchBody) {
		return this.brands.patch(canonicalKey, body);
	}

	@Patch()
	bulkPatch(@Body() body: BulkBrandPatchBody) {
		return this.brands.bulkPatch(body.canonicalKeys ?? [], body.patch ?? {});
	}
}
