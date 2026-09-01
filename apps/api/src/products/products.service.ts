import { Injectable, NotFoundException } from '@nestjs/common';

import {
  competitorProducts,
  competitors,
  eq,
  matches,
  ne,
  products,
} from '@price/db';

import { DatabaseService } from '../database/database.service';

@Injectable()
export class ProductsService {
  constructor(private readonly database: DatabaseService) {}

  findAll() {
    return this.database.db.select().from(products);
  }

  async findOne(id: number) {
    const [product] = await this.database.db
      .select()
      .from(products)
      .where(eq(products.id, id))
      .limit(1);

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const competitorRows = await this.database.db
      .select({
        id: competitorProducts.id,
        competitorName: competitors.name,
        title: competitorProducts.title,
        imageUrl: competitorProducts.imageUrl,
        price: competitorProducts.price,
        url: competitorProducts.url,
      })
      .from(matches)
      .innerJoin(
        competitorProducts,
        eq(matches.competitorProductId, competitorProducts.id),
      )
      .innerJoin(
        competitors,
        eq(competitorProducts.competitorId, competitors.id),
      )
      .where(eq(matches.productId, id));

    const similarProducts = await this.database.db
      .select({
        id: products.id,
        brand: products.brand,
        name: products.name,
        volume: products.volume,
        imageUrl: products.imageUrl,
        price: products.price,
      })
      .from(products)
      .where(ne(products.id, id))
      .limit(4);

    return {
      product,
      competitors: competitorRows,
      similarProducts,
    };
  }
}
