import { Module } from '@nestjs/common';

import { PolicyModule } from '../policy/policy.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PolicyModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  // Milestone 5 - AdminModule reuses ProductsService's existing query
  // machinery (buildWhere/resolveHiddenRawBrands, extended with admin-only
  // filters) rather than a second product-list implementation.
  exports: [ProductsService]
})
export class ProductsModule {}
