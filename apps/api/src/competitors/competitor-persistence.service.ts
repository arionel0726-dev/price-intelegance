import { Injectable } from '@nestjs/common';

import {
  competitorProductVariants,
  competitorProducts,
  competitors,
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import type { ParsedProduct } from './parser-client.types';

export type CompetitorIdentity = {
  name: string;
  domain: string;
};

// Shared upsert logic for any competitor whose data already fits the
// competitors -> competitor_products -> competitor_product_variants model
// (currently MAKEUP and OVICO). Scraping/parsing stays competitor-specific;
// only this persistence shape is common enough to share.
@Injectable()
export class CompetitorPersistenceService {
  constructor(private readonly database: DatabaseService) {}

  async getOrCreateCompetitor(identity: CompetitorIdentity) {
    const [competitor] = await this.database.db
      .insert(competitors)
      .values(identity)
      .onConflictDoUpdate({
        target: competitors.domain,
        set: { name: identity.name },
      })
      .returning();

    return competitor;
  }

  async persistProduct(
    competitorId: number,
    parsed: ParsedProduct,
  ): Promise<{
    productId: number;
    variantsPersisted: number;
    // externalId -> competitor_product_variants.id, for callers that need to
    // reference a specific persisted variant right after persisting it (e.g.
    // targeted-search sync writing a `matches` row for the exact variant it
    // just scored) without a separate lookup query.
    variantIdByExternalId: Map<string, number>;
  }> {
    const db = this.database.db;

    const [productRow] = await db
      .insert(competitorProducts)
      .values({
        competitorId,
        externalId: parsed.external_id!,
        title: parsed.title,
        brand: parsed.brand,
        imageUrl: parsed.image_url,
        url: parsed.url,
        currency: parsed.currency,
      })
      .onConflictDoUpdate({
        target: [competitorProducts.competitorId, competitorProducts.externalId],
        set: {
          title: parsed.title,
          brand: parsed.brand,
          imageUrl: parsed.image_url,
          url: parsed.url,
          currency: parsed.currency,
          updatedAt: new Date(),
        },
      })
      .returning();

    let variantsPersisted = 0;
    const variantIdByExternalId = new Map<string, number>();

    for (const variant of parsed.variants) {
      if (!variant.external_id) {
        continue;
      }

      const price = variant.price != null ? variant.price.toFixed(2) : null;

      const [variantRow] = await db
        .insert(competitorProductVariants)
        .values({
          competitorProductId: productRow.id,
          externalId: variant.external_id,
          label: variant.label,
          volume: variant.volume,
          price,
          available: variant.available,
        })
        .onConflictDoUpdate({
          target: [
            competitorProductVariants.competitorProductId,
            competitorProductVariants.externalId,
          ],
          set: {
            label: variant.label,
            volume: variant.volume,
            price,
            available: variant.available,
            updatedAt: new Date(),
          },
        })
        .returning();

      variantIdByExternalId.set(variant.external_id, variantRow.id);
      variantsPersisted += 1;
    }

    return { productId: productRow.id, variantsPersisted, variantIdByExternalId };
  }
}
