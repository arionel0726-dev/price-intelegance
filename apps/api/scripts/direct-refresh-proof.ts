import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { createDatabase, eq } from '@price/db';
import {
  competitorProductVariants,
  competitorProducts,
  competitors,
  matches,
} from '@price/db';

import { AppModule } from '../src/app.module';
import { MakeupSyncService } from '../src/competitors/makeup-sync.service';
import { OvicoSyncService } from '../src/competitors/ovico-sync.service';

// Proves the REFRESH workflow (distinct from DISCOVERY - see project notes):
// once a competitor identity is already known (an existing competitor_
// products row, matched or not), refreshing it is just "parse this one
// known URL again", no search involved. Read via direct DB query, refresh
// via the EXISTING syncProduct() path (unchanged), then verify in place.
//
// Run with: bun run scripts/direct-refresh-proof.ts (from apps/api)

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://price:price@localhost:5432/price';

async function main() {
  const { db, client } = createDatabase(DATABASE_URL);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    // --- MAKEUP: refresh via an EXISTING auto match ---
    const [makeupMatch] = await db
      .select({
        matchId: matches.id,
        productId: matches.productId,
        variantId: matches.competitorProductVariantId,
        variantExternalId: competitorProductVariants.externalId,
        variantPrice: competitorProductVariants.price,
        variantUpdatedAt: competitorProductVariants.updatedAt,
        competitorProductId: competitorProducts.id,
        url: competitorProducts.url,
        competitorName: competitors.name,
      })
      .from(matches)
      .innerJoin(competitorProductVariants, eq(matches.competitorProductVariantId, competitorProductVariants.id))
      .innerJoin(competitorProducts, eq(competitorProductVariants.competitorProductId, competitorProducts.id))
      .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
      .where(eq(matches.source, 'auto'))
      .limit(1);

    if (!makeupMatch) {
      console.log('[direct-refresh] no existing auto match found - skipping MAKEUP proof');
    } else {
      console.log('\n=== MAKEUP direct refresh (known match, no search) ===');
      console.log(`  match id=${makeupMatch.matchId} vizajeProductId=${makeupMatch.productId} url=${makeupMatch.url}`);
      console.log(`  BEFORE: variantId=${makeupMatch.variantId} price=${makeupMatch.variantPrice} updatedAt=${makeupMatch.variantUpdatedAt}`);

      const service = app.get(MakeupSyncService);
      const refreshResult = await service.syncProduct(makeupMatch.url);

      console.log(`  refresh call result: externalId=${refreshResult.externalId} title=${refreshResult.title} variantsPersisted=${refreshResult.variantsPersisted}`);

      const [after] = await db
        .select({
          variantId: competitorProductVariants.id,
          price: competitorProductVariants.price,
          updatedAt: competitorProductVariants.updatedAt,
        })
        .from(competitorProductVariants)
        .where(eq(competitorProductVariants.id, makeupMatch.variantId))
        .limit(1);

      const [matchAfter] = await db
        .select({ matchId: matches.id, variantId: matches.competitorProductVariantId })
        .from(matches)
        .where(eq(matches.id, makeupMatch.matchId))
        .limit(1);

      console.log(`  AFTER:  variantId=${after?.variantId} price=${after?.price} updatedAt=${after?.updatedAt}`);
      console.log(
        `  match survived: variantId unchanged=${matchAfter?.variantId === makeupMatch.variantId}, ` +
          `same row id (no duplicate)=${after?.variantId === makeupMatch.variantId}`,
      );
    }

    // --- OVICO: refresh via a known competitor_products URL (no OVICO auto
    // match exists yet in this dataset, so this proves the mechanism on an
    // existing, currently-unmatched OVICO product instead). ---
    const [ovicoProduct] = await db
      .select({
        competitorProductId: competitorProducts.id,
        url: competitorProducts.url,
        externalId: competitorProducts.externalId,
      })
      .from(competitorProducts)
      .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id))
      .where(eq(competitors.domain, 'ovico.md'))
      .limit(1);

    if (!ovicoProduct) {
      console.log('\n[direct-refresh] no existing OVICO competitor_products row found - skipping OVICO proof');
    } else {
      const [variantsBefore] = await db
        .select({ id: competitorProductVariants.id, price: competitorProductVariants.price, updatedAt: competitorProductVariants.updatedAt })
        .from(competitorProductVariants)
        .where(eq(competitorProductVariants.competitorProductId, ovicoProduct.competitorProductId))
        .limit(1);

      console.log('\n=== OVICO direct refresh (known URL, no search) ===');
      console.log(`  competitorProductId=${ovicoProduct.competitorProductId} url=${ovicoProduct.url}`);
      console.log(`  BEFORE: variantId=${variantsBefore?.id} price=${variantsBefore?.price} updatedAt=${variantsBefore?.updatedAt}`);

      const service = app.get(OvicoSyncService);
      const refreshResult = await service.syncProduct(ovicoProduct.url);

      console.log(`  refresh call result: externalId=${refreshResult.externalId} title=${refreshResult.title} variantsPersisted=${refreshResult.variantsPersisted}`);

      const [variantsAfter] = await db
        .select({ id: competitorProductVariants.id, price: competitorProductVariants.price, updatedAt: competitorProductVariants.updatedAt })
        .from(competitorProductVariants)
        .where(eq(competitorProductVariants.competitorProductId, ovicoProduct.competitorProductId))
        .limit(1);

      console.log(`  AFTER:  variantId=${variantsAfter?.id} price=${variantsAfter?.price} updatedAt=${variantsAfter?.updatedAt}`);
      console.log(`  same row id (no duplicate)=${variantsAfter?.id === variantsBefore?.id}`);
    }
  } finally {
    await client.end();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[direct-refresh] FAILED', error);
    process.exit(1);
  });
