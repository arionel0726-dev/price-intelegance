import { Module } from '@nestjs/common';

import { PolicyModule } from '../policy/policy.module';
import { ProductsModule } from '../products/products.module';
import { AdminBrandsController } from './admin-brands.controller';
import { AdminBrandsService } from './admin-brands.service';
import { AdminDataQualityController } from './admin-data-quality.controller';
import { AdminPlaceholdersController } from './admin-placeholders.controller';
import { AdminPlaceholdersService } from './admin-placeholders.service';
import { AdminProductsController } from './admin-products.controller';
import { AdminSettingsController } from './admin-settings.controller';

// Milestone 5 - Admin Control Center. Exposes existing policy/product/
// settings state through new endpoints; reuses ProductsService (product
// list/detail/policy-override machinery) and AppSettingsService (ai.*
// read/write) rather than re-implementing either. DatabaseService is
// @Global (see database.module.ts), so AdminBrandsService/
// AdminPlaceholdersService need no extra module import for it.
@Module({
	imports: [PolicyModule, ProductsModule],
	controllers: [AdminBrandsController, AdminProductsController, AdminSettingsController, AdminDataQualityController, AdminPlaceholdersController],
	providers: [AdminBrandsService, AdminPlaceholdersService],
})
export class AdminModule {}
