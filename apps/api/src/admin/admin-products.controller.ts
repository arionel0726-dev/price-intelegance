import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { ProductsService } from '../products/products.service';

class ProductPolicyPatchBody {
	catalogEnabledOverride?: boolean | null;
	discoveryEnabledOverride?: boolean | null;
	priceMonitoringEnabledOverride?: boolean | null;
	exclusionReason?: string | null;
	reasonNote?: string | null;
}

// Protected by the global AuthGuard like every other controller - see
// AdminBrandsController's comment on there being no separate admin role.
@Controller('admin/products')
export class AdminProductsController {
	constructor(private readonly products: ProductsService) {}

	@Get()
	list(
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Query('search') search?: string,
		@Query('brand') brand?: string,
		@Query('category') category?: string,
		@Query('imageState') imageState?: string,
		@Query('overrideState') overrideState?: string,
		@Query('exclusionReason') exclusionReason?: string,
	) {
		return this.products.findAllAdmin({
			page: page ? Number(page) : undefined,
			limit: limit ? Number(limit) : undefined,
			search,
			brand,
			category,
			imageState: imageState as never,
			overrideState: overrideState as never,
			exclusionReason,
		});
	}

	@Get(':id')
	get(@Param('id', ParseIntPipe) id: number) {
		return this.products.getAdminProductDetail(id);
	}

	@Patch(':id/policy')
	patchPolicy(@Param('id', ParseIntPipe) id: number, @Body() body: ProductPolicyPatchBody, @Req() req: Request) {
		return this.products.updateProductPolicy(id, body, actorFromRequest(req));
	}
}

// Same shared-account actor convention as M3's reviewedByFromRequest in
// ai-review.controller.ts - the single shared account's email, attached by
// AuthGuard as req.session.email. No separate identity model introduced.
function actorFromRequest(req: Request): string | null {
	const session = (req as Request & { session?: { email: string } }).session;
	return session?.email ?? null;
}
