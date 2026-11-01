import { Module } from '@nestjs/common';

import { OvicoCatalogModule } from '../competitors/ovico-catalog/ovico-catalog.module';
import { PolicyModule } from '../policy/policy.module';
import { ProductsModule } from '../products/products.module';
import { AdminBrandsController } from './admin-brands.controller';
import { AdminBrandsService } from './admin-brands.service';
import { AdminDataQualityController } from './admin-data-quality.controller';
import { AdminOvicoSourcesController } from './admin-ovico-sources.controller';
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
// Catalog Ingestion v1 (OVICO) - AdminOvicoSourcesController reuses
// OvicoCatalogModule's services rather than duplicating brand-source CRUD.
@Module({
	imports: [PolicyModule, ProductsModule, OvicoCatalogModule],
	controllers: [AdminBrandsController, AdminProductsController, AdminSettingsController, AdminDataQualityController, AdminPlaceholdersController, AdminOvicoSourcesController],
	providers: [AdminBrandsService, AdminPlaceholdersService],
})
export class AdminModule {}
