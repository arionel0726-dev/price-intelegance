import { Module } from '@nestjs/common';

import { PolicyModule } from '../policy/policy.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PolicyModule],
  controllers: [ProductsController],
  providers: [ProductsService]
})
export class ProductsModule {}
