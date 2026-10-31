import { Controller, Get, Query } from '@nestjs/common';

import { ProductsService } from '../products/products.service';

// Protected by the global AuthGuard like every other controller.
@Controller('admin/data-quality')
export class AdminDataQualityController {
	constructor(private readonly products: ProductsService) {}

	@Get('summary')
	summary() {
		return this.products.getDataQualitySummary();
	}

	@Get('images')
	images(@Query('page') page?: string, @Query('limit') limit?: string, @Query('imageState') imageState?: string) {
		return this.products.listImagesForAdmin({
			page: page ? Number(page) : undefined,
			limit: limit ? Number(limit) : undefined,
			imageState: imageState as never,
		});
	}
}
