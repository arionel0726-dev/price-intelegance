import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';

import { ProductsService } from './products.service';

class ProductsListQueryDto {
  page?: string;
  limit?: string;
  search?: string;
  brand?: string;
  category?: string;
}

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query() query: ProductsListQueryDto) {
    return this.productsService.findAll({
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      search: query.search,
      brand: query.brand,
      category: query.category,
    });
  }

  // Registered BEFORE ':id' - Nest/Express match routes in declaration
  // order, and ':id' uses ParseIntPipe, which would otherwise try (and
  // fail) to parse "filters" as a product id.
  @Get('filters')
  getFilters() {
    return this.productsService.getFilters();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.productsService.findOne(id);
  }
}
